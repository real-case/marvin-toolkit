import { execFileSync } from "node:child_process";
import {
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { HARDENED_GIT_OPTIONS, hardenedGitEnv, type IsolatedGit, isolatedGit } from "./gate.js";

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

const FULL_SHA = /^[0-9a-f]{40}$/;
/**
 * Where vite and vitest (`.vite`, `.vitest`) and babel and webpack loaders (`.cache`) cache, and
 * where vite 6 and later write the bundled config (`.vite-temp`). Vite imports that bundle from
 * there, so its bare imports resolve from the `node_modules` that holds it.
 */
const TOOL_CACHES: ReadonlySet<string> = new Set([".cache", ".vite", ".vite-temp", ".vitest"]);

/**
 * The base tree cannot be prepared from what the run leaves around it, so the work that would run
 * in it is not started: an entry of the run worktree's `node_modules` that cannot be linked, or a
 * directory for the base trees that cannot be made a plain one or cannot hold a tree. A child that
 * writes outside git's view can cause either (a directory left unreadable), and it outlives a
 * restart, so a caller reports it rather than throwing on it.
 */
export class BaseTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaseTreeError";
  }
}

const errorCode = (error: unknown): string =>
  (error as NodeJS.ErrnoException | null)?.code ??
  (error instanceof Error ? error.message : String(error));

const within = (root: string, target: string): string | null => {
  const rel = relative(root, target);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? null : rel;
};

/** Whether `rel` under `root` is a directory reached through directories only, never a link. */
function isPlainDirectory(root: string, rel: string): boolean {
  let current = root;
  for (const part of rel.split("/")) {
    current = join(current, part);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Gives `tree` the run worktree's installed dependencies without copying a byte of them: every
 * `node_modules` directory of the run worktree (git lists each one as an ignored directory) gets
 * a counterpart in `tree` that holds links to its entries.
 *
 * The entries are linked, not the directory. A workspace package is itself a link inside
 * `node_modules` (`@scope/pkg -> ../../packages/pkg`, as npm writes it), and read through one
 * linked `node_modules` it would resolve to the run worktree's package: the implementation the
 * red run must not see. So a link is copied as a link, a relative one then resolving inside
 * `tree`, and an absolute one that points into the run worktree re-rooted into `tree`; a scope
 * directory is mirrored one level down; any other entry is linked by its absolute path. A
 * `node_modules` whose parent the base commit does not have, a package the run added, is left out,
 * and so is one where the base commit already holds something.
 *
 * The caches runners keep in `node_modules` (`TOOL_CACHES`) are left out too, so that a run in
 * `tree` makes its own there and removes it with the tree, instead of writing into the run's.
 *
 * An entry that cannot be listed or linked is a `BaseTreeError`, never a skip: a dependency
 * missing from `tree` would fail a test for a reason other than the missing implementation, and
 * the red run would take that failure as proof.
 */
function linkNodeModules(git: IsolatedGit, from: string, tree: string): void {
  const roots = [...new Set([from, realpathSync(from)])];
  const reroot = (link: string): string => {
    if (!isAbsolute(link)) return link;
    for (const root of roots) {
      const rel = within(root, link);
      if (rel !== null) return join(tree, rel);
    }
    return link;
  };
  const shown = (path: string): string => relative(from, path).split(sep).join("/");
  const mirror = (source: string, target: string, scopes: boolean): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(source, { withFileTypes: true });
    } catch (error) {
      throw new BaseTreeError(`${shown(source)} cannot be listed (${errorCode(error)})`);
    }
    try {
      mkdirSync(target);
    } catch (error) {
      throw new BaseTreeError(`${shown(source)} cannot be mirrored (${errorCode(error)})`);
    }
    for (const entry of entries) {
      if (scopes && TOOL_CACHES.has(entry.name)) continue;
      const src = join(source, entry.name);
      const dst = join(target, entry.name);
      if (scopes && entry.isDirectory() && entry.name.startsWith("@")) {
        mirror(src, dst, false);
        continue;
      }
      try {
        symlinkSync(entry.isSymbolicLink() ? reroot(readlinkSync(src)) : src, dst);
      } catch (error) {
        throw new BaseTreeError(`${shown(src)} cannot be linked (${errorCode(error)})`);
      }
    }
  };
  const listed = git
    .text("ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory")
    .split("\0")
    .filter((entry) => entry.endsWith("/"))
    .map((entry) => entry.slice(0, -1))
    .filter((rel) => {
      const parts = rel.split("/");
      return parts.at(-1) === "node_modules" && !parts.slice(0, -1).includes("node_modules");
    });
  for (const rel of listed) {
    const parent = posix.dirname(rel);
    if (parent !== "." && !isPlainDirectory(tree, parent)) continue;
    if (occupied(join(tree, rel)) || !isDirectory(join(from, rel))) continue;
    mirror(join(from, rel), join(tree, rel), true);
  }
}

/** Whether anything is at `path`, a dangling link included. */
function occupied(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Whether `path` is a directory, or a link to one. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The directory in the common git dir that records the worktree at `tree`, read from the
 * worktree's `.git` before any other code runs in it, and only when that record names `tree` back.
 * It is what is removed by hand when git cannot remove the worktree itself.
 */
function recordOf(tree: string): string | null {
  try {
    const pointer = readFileSync(join(tree, ".git"), "utf8");
    const target = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(pointer)?.[1];
    if (target === undefined) return null;
    const record = realpathSync(resolve(tree, target));
    if (basename(dirname(record)) !== "worktrees") return null;
    // Both pointers are relative where `worktree.useRelativePaths` is set.
    const back = resolve(record, readFileSync(join(record, "gitdir"), "utf8").trim());
    return realpathSync(back) === realpathSync(join(tree, ".git")) ? record : null;
  } catch {
    return null;
  }
}

/**
 * Removes the temporary worktree and git's record of it. Code ran in it (a red run executes test
 * code) and may have broken what `git worktree remove` checks first, the worktree's `.git` for one,
 * so the directory and the record found before that code ran are then removed by hand. Removal
 * never throws: the tree holds nothing the run depends on, what is left of it is cleared by the
 * next call (`clearLeftovers`), and the error a caller needs is the one its own work raised.
 */
function removeTemporaryWorktree(git: IsolatedGit, tree: string, record: string | null): void {
  try {
    git.text("worktree", "remove", "--force", "--force", tree);
  } catch {
    // removed by hand below
  }
  for (const path of record === null ? [tree] : [tree, record]) {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 2 });
    } catch {
      // best effort, as above
    }
  }
}

/**
 * The directory the base worktrees of the run worktree at `worktree` are made in: beside it, under
 * a name no run id can take (a run id starts with a letter or a digit), so that a restarted engine
 * finds what a killed one left there.
 */
const baseTreesDir = (worktree: string): string =>
  join(dirname(worktree), `.base-${basename(worktree)}`);

/** Whether `path` is a symbolic link. */
function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Clears what an engine killed inside `withBaseWorktree` left in `dir` (a `finally` does not run on
 * SIGKILL or a power loss): each tree and git's record of it, without which every crash would
 * leave one more worktree registered in the user's repository. Then `dir` is a plain directory.
 *
 * Test code ran in a leftover and may have broken its `.git`, so each entry is removed by hand
 * first, and only then is git asked to drop the record of a worktree at that path, which for a
 * worktree that is gone it does by the path alone. Nothing here follows a link. An entry that is
 * one is unlinked and never named to git, which resolves the path it is given and would remove
 * the worktree the link points at, another of the user's included; a `dir` that is one is
 * unlinked and made again. Clearing an entry is best effort: one that stays does not block, since
 * every tree gets a fresh name.
 */
function clearLeftovers(git: IsolatedGit, dir: string): void {
  let entries: string[] = [];
  try {
    if (lstatSync(dir).isDirectory()) entries = readdirSync(dir);
    else rmSync(dir, { force: true });
  } catch {
    // absent, or unreadable: there is nothing this call can clear
  }
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // judged below
  }
  if (isLink(dir) || !isDirectory(dir)) {
    throw new BaseTreeError(`${dir} cannot be made a directory for the base trees`);
  }
  for (const name of entries) {
    const path = join(dir, name);
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 2 });
    } catch {
      // best effort, as above
    }
    if (isLink(path)) continue;
    try {
      git.text("worktree", "remove", "--force", "--force", path);
    } catch {
      // no record names this path
    }
  }
}

/**
 * Runs `fn` in a temporary detached worktree of the run's repository at `commit`, and removes the
 * worktree when `fn` returns or throws. It is where a re-seal red-runs revised acceptance tests
 * (D-RESEAL): the code before this task's implementation, which the run worktree stops holding
 * once an executor has committed. `commit` is the base the run recorded when its worktree was
 * made, never `origin/<base>` read now: a child can move a remote-tracking ref in the common git
 * dir, and one moved onto the run branch would hand the red run the implementation.
 *
 * Git runs pinned to the run's private git dir (`isolatedGit`), with hooks and replace refs off.
 * The worktree is made in a directory of its own beside the run worktree (`baseTreesDir`), outside
 * every repository as the run worktree is (D18), so that nothing above it supplies a
 * `node_modules` (S4), and at a fixed place, so that what an engine killed inside it left is
 * cleared before the next one is made (`clearLeftovers`). It gets the run worktree's dependencies
 * by link (see `linkNodeModules`) rather than an install. No branch is created.
 *
 * Throws a `BaseTreeError` when the tree cannot be prepared from what the run left around it;
 * `fn` has not run then.
 */
export function withBaseWorktree<T>(
  o: { worktree: string; gitDir: string; commit: string },
  fn: (tree: string) => T,
): T {
  if (typeof o.commit !== "string" || !FULL_SHA.test(o.commit)) {
    throw new Error("the base commit must be a 40-hex commit SHA");
  }
  if (!isAbsolute(o.worktree) || !isAbsolute(o.gitDir)) {
    throw new Error("worktree and gitDir must be absolute paths");
  }
  const git = isolatedGit(o.worktree, o.gitDir);
  const dir = baseTreesDir(o.worktree);
  clearLeftovers(git, dir);
  let tree: string;
  try {
    tree = mkdtempSync(join(dir, "t-"));
  } catch (error) {
    throw new BaseTreeError(`${dir} cannot hold a base tree (${errorCode(error)})`);
  }
  let record: string | null = null;
  try {
    git.text("worktree", "add", "--detach", tree, o.commit);
    record = recordOf(tree);
    linkNodeModules(git, o.worktree, tree);
    return fn(tree);
  } finally {
    removeTemporaryWorktree(git, tree, record);
    try {
      rmdirSync(dir);
    } catch {
      // something stayed in it, for the next call to clear
    }
  }
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
