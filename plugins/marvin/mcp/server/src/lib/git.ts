import { execFileSync, spawnSync } from "node:child_process";

/**
 * Thin wrapper over `git` and `gh` CLIs. All commands run synchronously
 * with stdio piped; on failure we return a structured Result instead of
 * throwing — callers convert that into elicit/output messages.
 */

export interface GitOk<T = string> {
  ok: true;
  value: T;
}

export interface GitErr {
  ok: false;
  code: number;
  stderr: string;
}

export type GitResult<T = string> = GitOk<T> | GitErr;

function run(cmd: string, args: string[], cwd?: string): GitResult {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (result.error) {
    return { ok: false, code: -1, stderr: result.error.message };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      code: result.status ?? -1,
      stderr: (result.stderr || result.stdout || "").trim(),
    };
  }
  return { ok: true, value: (result.stdout || "").trim() };
}

export function git(args: string[], cwd?: string): GitResult {
  return run("git", args, cwd);
}

export function gh(args: string[], cwd?: string): GitResult {
  return run("gh", args, cwd);
}

/**
 * Is the cwd inside a git working tree?
 */
export function inGitRepo(cwd?: string): boolean {
  return git(["rev-parse", "--is-inside-work-tree"], cwd).ok;
}

/**
 * Is the `git` CLI available on PATH? Independent from cwd.
 */
export function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Is the `gh` CLI available on PATH? Independent from cwd. */
export function hasGh(): boolean {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function currentBranch(cwd?: string): string | null {
  const r = git(["branch", "--show-current"], cwd);
  return r.ok && r.value ? r.value : null;
}

/**
 * The remote's default branch, read from `origin/HEAD` (e.g. "main").
 * Returns null when origin/HEAD is unset (no remote, or never fetched).
 */
export function defaultBranchFromOrigin(cwd?: string): string | null {
  const r = git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], cwd);
  if (!r.ok || !r.value) return null;
  const name = r.value.replace(/^refs\/remotes\/origin\//, "");
  return name && name !== r.value ? name : null;
}

export function hasUncommittedChanges(cwd?: string): boolean {
  const r = git(["status", "--porcelain"], cwd);
  return r.ok && r.value.length > 0;
}

export function branchExists(name: string, cwd?: string): boolean {
  return git(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], cwd).ok;
}

/**
 * Check out `base`, fast-forward from origin, then create-and-checkout
 * `branch`. Aborts if the working tree is dirty.
 */
export function createBranchFromBase(base: string, branch: string, cwd?: string): GitResult {
  if (hasUncommittedChanges(cwd)) {
    return { ok: false, code: -1, stderr: "uncommitted changes — commit or stash first" };
  }
  const checkoutBase = git(["checkout", base], cwd);
  if (!checkoutBase.ok) return checkoutBase;
  // pull --ff-only is best-effort: ignore failure (e.g. no upstream).
  git(["pull", "--ff-only"], cwd);
  return git(["checkout", "-b", branch], cwd);
}

export function checkoutBranch(branch: string, cwd?: string): GitResult {
  if (hasUncommittedChanges(cwd)) {
    return { ok: false, code: -1, stderr: "uncommitted changes — commit or stash first" };
  }
  return git(["checkout", branch], cwd);
}
