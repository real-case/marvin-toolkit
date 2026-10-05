import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { HARDENED_GIT_OPTIONS, hardenedGitEnv } from "./gate.js";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", [...HARDENED_GIT_OPTIONS, ...args], {
    cwd,
    env: hardenedGitEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const gitRaw = (cwd: string, ...args: string[]): Buffer =>
  execFileSync("git", [...HARDENED_GIT_OPTIONS, ...args], {
    cwd,
    env: hardenedGitEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });

export function createRunWorktree(o: {
  repoRoot: string;
  base: string;
  runId: string;
  worktreesRoot: string;
}): { path: string; branch: string; baseSha: string; gitDir: string } {
  const branch = `autopilot/${o.runId}`;
  const path = join(o.worktreesRoot, basename(o.repoRoot), o.runId);
  if (existsSync(path)) throw new Error(`worktree path exists: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  git(o.repoRoot, "fetch", "origin", o.base);
  const baseSha = git(
    o.repoRoot,
    "rev-parse",
    "--verify",
    "--end-of-options",
    `refs/remotes/origin/${o.base}^{commit}`,
  );
  git(o.repoRoot, "worktree", "add", "--no-track", "-b", branch, path, baseSha);
  const gitDir = git(path, "rev-parse", "--absolute-git-dir");
  return { path, branch, baseSha, gitDir };
}

export function branchName(template: string, v: { tracker: string; slug: string }): string {
  return template.replace("{tracker}", v.tracker).replace("{slug}", v.slug);
}

export function renameRunBranch(worktree: string, to: string): void {
  const output = git(worktree, "ls-remote", "--heads", "origin", `refs/heads/${to}`);
  if (output) throw new Error(`branch ${to} already exists on origin`);
  git(worktree, "branch", "-m", to);
}

interface SnapshotEntry {
  xy: string;
  path: string;
  orig: string | null;
  fingerprint: string;
}

interface SnapshotData {
  head: string;
  entries: SnapshotEntry[];
}

function snapshotTreeImpl(worktree: string): SnapshotData {
  const head = git(worktree, "rev-parse", "HEAD");
  const porcelainRaw = gitRaw(worktree, "status", "--porcelain=v1", "-z", "--untracked-files=all");
  const porcelainStr = porcelainRaw.toString("utf8");
  const entries: SnapshotEntry[] = [];

  if (porcelainStr) {
    const records = porcelainStr.split("\0");
    let i = 0;
    while (i < records.length) {
      const record = records[i];
      if (!record) {
        i++;
        continue;
      }

      const xy = record.substring(0, 2);
      const path = record.substring(3);
      let orig: string | null = null;

      if ((xy[0] === "R" || xy[0] === "C") && i + 1 < records.length) {
        orig = records[i + 1] ?? null;
        i += 2;
      } else {
        i++;
      }

      let fingerprint: string;
      try {
        const fprint = git(worktree, "hash-object", "--", join(worktree, path));
        fingerprint = fprint;
      } catch {
        try {
          execFileSync("test", ["-d", join(worktree, path)], {
            stdio: "ignore",
          });
          fingerprint = "dir";
        } catch {
          fingerprint = "missing";
        }
      }

      entries.push({ xy, path, orig, fingerprint });
    }
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { head, entries };
}

export function snapshotTree(worktree: string): string {
  return JSON.stringify(snapshotTreeImpl(worktree));
}

export function diffSnapshots(before: string, after: string): string[] {
  const beforeData: SnapshotData = JSON.parse(before);
  const afterData: SnapshotData = JSON.parse(after);

  const beforeMap = new Map<string, SnapshotEntry>();
  for (const entry of beforeData.entries) {
    const key = `${entry.xy}\0${entry.path}`;
    beforeMap.set(key, entry);
  }

  const afterMap = new Map<string, SnapshotEntry>();
  for (const entry of afterData.entries) {
    const key = `${entry.xy}\0${entry.path}`;
    afterMap.set(key, entry);
  }

  const diff: string[] = [];

  if (beforeData.head !== afterData.head) {
    diff.push(`HEAD ${beforeData.head} -> ${afterData.head}`);
  }

  for (const [key, afterEntry] of afterMap) {
    const beforeEntry = beforeMap.get(key);
    if (!beforeEntry) {
      diff.push(`${afterEntry.xy} ${afterEntry.path}`);
    } else if (beforeEntry.fingerprint !== afterEntry.fingerprint) {
      diff.push(`${afterEntry.xy} ${afterEntry.path} (content changed)`);
    }
  }

  for (const [key, beforeEntry] of beforeMap) {
    if (!afterMap.has(key)) {
      diff.push(`removed ${beforeEntry.xy} ${beforeEntry.path}`);
    }
  }

  return diff;
}
