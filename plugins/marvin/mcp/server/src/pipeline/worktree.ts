import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

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
  if (git(worktree, "ls-remote", "--heads", "origin", to))
    throw new Error(`branch ${to} already exists on origin`);
  git(worktree, "branch", "-m", to);
}

export function snapshotTree(worktree: string): string {
  return [
    git(worktree, "rev-parse", "HEAD"),
    git(worktree, "status", "--porcelain", "--untracked-files=all"),
  ].join("\n");
}

export function diffSnapshots(before: string, after: string): string[] {
  const seen = new Set(before.split("\n"));
  return after.split("\n").filter((line) => line && !seen.has(line));
}
