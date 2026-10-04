import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const gitRaw = (cwd: string, ...args: string[]): Buffer =>
  execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

export function createRunWorktree(o: {
  repoRoot: string;
  base: string;
  runId: string;
  worktreesRoot: string;
}): { path: string; branch: string } {
  const branch = `autopilot/${o.runId}`;
  const path = join(o.worktreesRoot, basename(o.repoRoot), o.runId);
  if (existsSync(path)) throw new Error(`worktree path exists: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  git(o.repoRoot, "fetch", "origin", o.base);
  git(o.repoRoot, "worktree", "add", "--no-track", "-b", branch, path, `origin/${o.base}`);
  return { path, branch };
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
  fingerprint: string;
}

interface Snapshot {
  head: string;
  entries: Map<string, SnapshotEntry>;
}

function snapshotTreeImpl(worktree: string): Snapshot {
  const head = git(worktree, "rev-parse", "HEAD");
  const porcelainRaw = gitRaw(worktree, "status", "--porcelain=v1", "-z", "--untracked-files=all");
  const porcelainStr = porcelainRaw.toString("utf8");
  const entries = new Map<string, SnapshotEntry>();

  if (porcelainStr) {
    const records = porcelainStr.split("\0").filter((r) => r);
    for (const record of records) {
      const xy = record.substring(0, 2);
      const path = record.substring(3);
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

      entries.set(path, { xy, path, fingerprint });
    }
  }

  return { head, entries };
}

export function snapshotTree(worktree: string): string {
  const snapshot = snapshotTreeImpl(worktree);
  const lines = [snapshot.head];
  for (const entry of snapshot.entries.values()) {
    lines.push(`${entry.xy}:${entry.path}:${entry.fingerprint}`);
  }
  return lines.join("\n");
}

export function diffSnapshots(before: string, after: string): string[] {
  const lines = before.split("\n");
  const beforeHead = lines[0];
  const beforeEntries = new Map<string, SnapshotEntry>();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const parts = line.split(":");
    const xy = parts[0] ?? "";
    const path = parts[1] ?? "";
    const fingerprint = parts[2] ?? "";
    beforeEntries.set(path, { xy, path, fingerprint });
  }

  const linesAfter = after.split("\n");
  const afterHead = linesAfter[0];
  const afterEntries = new Map<string, SnapshotEntry>();
  for (const line of linesAfter.slice(1)) {
    if (!line) continue;
    const parts = line.split(":");
    const xy = parts[0] ?? "";
    const path = parts[1] ?? "";
    const fingerprint = parts[2] ?? "";
    afterEntries.set(path, { xy, path, fingerprint });
  }

  const diff: string[] = [];

  if (beforeHead !== afterHead) {
    diff.push(`HEAD ${beforeHead} -> ${afterHead}`);
  }

  for (const [path, afterEntry] of afterEntries) {
    const beforeEntry = beforeEntries.get(path);
    if (!beforeEntry) {
      diff.push(`${afterEntry.xy} ${path}`);
    } else if (beforeEntry.fingerprint !== afterEntry.fingerprint) {
      diff.push(`${afterEntry.xy} ${path} (content changed)`);
    }
  }

  for (const [path, beforeEntry] of beforeEntries) {
    if (!afterEntries.has(path)) {
      diff.push(`removed ${beforeEntry.xy} ${path}`);
    }
  }

  return diff;
}
