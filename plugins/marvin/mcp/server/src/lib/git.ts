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

/**
 * Strictly additive third parameter — every existing positional `git(args, cwd)`
 * call site is unchanged. `input` feeds a command that reads stdin
 * (`hash-object --stdin-paths`); `maxBuffer` raises Node's 1 MiB `spawnSync`
 * default, which an unbounded git read can otherwise cross, turning a real
 * answer into an ENOBUFS error (ADR-0035).
 */
export interface RunOptions {
  input?: string;
  maxBuffer?: number;
}

function run(cmd: string, args: string[], cwd?: string, opts?: RunOptions): GitResult {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    ...(opts?.input !== undefined ? { input: opts.input } : {}),
    ...(opts?.maxBuffer !== undefined ? { maxBuffer: opts.maxBuffer } : {}),
  });
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

export function git(args: string[], cwd?: string, opts?: RunOptions): GitResult {
  return run("git", args, cwd, opts);
}

export function gh(args: string[], cwd?: string, opts?: RunOptions): GitResult {
  return run("gh", args, cwd, opts);
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

// ── worktree reads behind the evidence digest (ADR-0035) ────────────────────

/**
 * Every read below passes an explicit, generous `maxBuffer` as a second line of
 * defence. It is not the design: the digest's inputs are O(paths changed) by
 * construction, precisely so no buffer size has to be guessed. 5,000 paths of
 * `hash-object` output is ~205 KB, three orders of magnitude inside this.
 */
const WORKTREE_READ_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * The working tree's root, which answers "is this a git worktree" and "which
 * root" in one read. Null outside a repository — the prefix that keeps the whole
 * provenance computation off the path for a non-git project.
 */
export function worktreeRoot(cwd?: string): string | null {
  const r = git(["rev-parse", "--show-toplevel"], cwd);
  return r.ok && r.value ? r.value : null;
}

export function headSha(cwd?: string): string | null {
  const r = git(["rev-parse", "HEAD"], cwd);
  return r.ok && r.value ? r.value : null;
}

export interface DiffOptions {
  /** `name-only` for a plain path list, `name-status` for `status\0path` pairs. */
  format?: "name-only" | "name-status";
  /** Path prefixes to drop, rendered as `:(exclude)<p>` pathspecs. */
  exclude?: string[];
  /** NUL-delimit the output, which removes git's path quoting. */
  nul?: boolean;
}

/**
 * Tracked changes against HEAD (staged + unstaged), as raw stdout. Null on any
 * failure — no repository, no HEAD, a git that could not run.
 *
 * `--no-renames` accompanies `name-status` only, so each path stays an
 * independent `A`/`M`/`D` row and no rename grammar has to be parsed; adding it
 * to `name-only` would change the file set the mode warnings have always seen.
 */
export function diffAgainstHead(cwd?: string, opts: DiffOptions = {}): string | null {
  const format = opts.format ?? "name-only";
  const args = ["diff", "HEAD", `--${format}`];
  if (format === "name-status") args.push("--no-renames");
  if (opts.nul) args.push("-z");
  if (opts.exclude?.length) args.push("--", ...opts.exclude.map((p) => `:(exclude)${p}`));
  const r = git(args, cwd, { maxBuffer: WORKTREE_READ_MAX_BUFFER });
  return r.ok ? r.value : null;
}

/**
 * Untracked, non-ignored paths. Always read NUL-delimited and returned split, so
 * a path with a space or a quote survives the round trip.
 */
export function untrackedFiles(cwd?: string, opts: { exclude?: string[] } = {}): string[] | null {
  const args = ["ls-files", "--others", "--exclude-standard", "-z"];
  if (opts.exclude?.length) args.push("--", ...opts.exclude.map((p) => `:(exclude)${p}`));
  const r = git(args, cwd, { maxBuffer: WORKTREE_READ_MAX_BUFFER });
  if (!r.ok) return null;
  return r.value.split("\0").filter(Boolean);
}

/**
 * Git's content ids for the **working-tree** bytes of each path, in input order.
 * One spawn, 41 bytes of output per path whatever the file weighs — which is
 * what lets the digest carry content identity without any file's bytes entering
 * this process. `hash-object` without `-w` is a pure read: it writes no object.
 */
export function hashObjects(paths: string[], cwd?: string): string[] | null {
  if (paths.length === 0) return [];
  const r = git(["hash-object", "--stdin-paths"], cwd, {
    input: `${paths.join("\n")}\n`,
    maxBuffer: WORKTREE_READ_MAX_BUFFER,
  });
  if (!r.ok) return null;
  const ids = r.value.split("\n").map((s) => s.trim());
  return ids.length === paths.length ? ids : null;
}

/**
 * The files a task changed: `git diff --name-only <base>` (default `HEAD`, i.e.
 * uncommitted changes) plus untracked non-ignored paths, normalised to POSIX
 * separators without a leading `./`, de-duplicated. A failed read contributes
 * nothing rather than failing the caller — the scope gate treats a repository
 * with no readable diff as one with no changes to judge.
 *
 * Two callers share it and must see the same set (ADR-0043): the scope gate in
 * `tools/spec.ts` (is the change inside the contract allowlist?) and the metrics
 * roll-up (which changed files did the contract not declare? — Q1). Declared
 * here so the two can never drift.
 */
export function changedFilesForScope(projectRoot: string, base: string | undefined): string[] {
  const ref = base && base.trim() ? base.trim() : "HEAD";
  const diff = git(["diff", "--name-only", ref], projectRoot);
  const untracked = git(["ls-files", "--others", "--exclude-standard"], projectRoot);
  const lines = [
    ...(diff.ok ? diff.value.split("\n") : []),
    ...(untracked.ok ? untracked.value.split("\n") : []),
  ];
  return [...new Set(lines.map(normalizeScopePath).filter(Boolean))];
}

/** Normalise a path for scope comparison: POSIX separators, no leading `./`, trimmed. */
export function normalizeScopePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/** Does `ref` resolve to a commit in this repository? Null outside a repository. */
export function refExists(ref: string, cwd?: string): boolean {
  return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd).ok;
}

/**
 * Is `path` excluded by the repository's ignore rules? `git check-ignore` exits 0
 * when it is, 1 when it is not, and 128 outside a repository or on a bad path —
 * the last is null, so a caller can say "unknown" instead of guessing.
 */
export function isIgnored(path: string, cwd?: string): boolean | null {
  const r = git(["check-ignore", "-q", "--", path], cwd);
  if (r.ok) return true;
  return r.code === 1 ? false : null;
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
