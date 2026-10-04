/**
 * Physical path resolution for the pipeline guards.
 *
 * A lexical comparison (`path.relative` on the strings) is what let a child write the
 * main checkout through a symlink inside its worktree, and what denied a worktree
 * named `/tmp/...` whose writes arrive as `/private/tmp/...`. Both sides are compared
 * here by the path the kernel would open: every existing component is resolved through
 * its symlinks — a dangling link included, which `realpath` refuses and `existsSync`
 * reports as absent — and only the components that do not exist yet are appended as
 * written.
 */

import { lstatSync, readlinkSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_LINKS = 40;

/**
 * The physical path `path` names. `..` is applied after the symlink before it is
 * resolved, as the kernel applies it. Throws on a symlink loop or on any lstat error
 * other than a missing component.
 *
 * @param {string} path An absolute path.
 * @returns {string}
 */
export function physicalPath(path, hops = { count: 0 }) {
  if (!isAbsolute(path)) throw new Error(`not an absolute path: ${path}`);
  const parts = path.split(sep);
  let current = sep;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === "" || part === ".") continue;
    if (part === "..") {
      current = resolve(current, "..");
      continue;
    }
    const next = join(current, part);
    let stat;
    try {
      stat = lstatSync(next);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        return resolve(next, ...parts.slice(i + 1).filter(Boolean));
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      hops.count += 1;
      if (hops.count > MAX_LINKS) throw new Error(`too many symbolic links: ${path}`);
      const link = readlinkSync(next);
      current = physicalPath(isAbsolute(link) ? link : `${current}${sep}${link}`, hops);
    } else {
      current = next;
    }
  }
  return current;
}

/**
 * `target` relative to `root` as a POSIX path (`""` for the root itself), or null when
 * `target` lies outside `root`. Both must already be physical paths.
 *
 * @param {string} target
 * @param {string} root
 * @returns {string | null}
 */
export function relativeInside(target, root) {
  const rel = relative(root, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return null;
  return rel.split(sep).join("/");
}

/**
 * The distinct absolute paths an edit of `target` can name: the one as written, which the
 * kernel resolves with `..` applied AFTER the symlink before it, and the lexically normalised
 * one, which a tool that cleans the path first would open. Either may be the file a write lands
 * on, so a guard judges both.
 *
 * @param {string} target The tool's `file_path` or `notebook_path`, absolute or relative to `root`.
 * @param {string} root The worktree (`CLAUDE_PROJECT_DIR`).
 * @returns {string[]}
 */
export function candidatePaths(target, root) {
  const written = isAbsolute(target) ? target : `${root}/${target}`;
  return [...new Set([written, resolve(root, target)])];
}

/**
 * Why an edit of `target` may not proceed, or null. The target must name a file inside the
 * worktree under both readings of `..` (as a physical path, every symlink followed), and
 * `judge` is asked about the worktree-relative POSIX path of each reading.
 *
 * @param {unknown} target
 * @param {unknown} root The worktree (`CLAUDE_PROJECT_DIR`).
 * @param {(rel: string) => string | null} judge A reason to deny `rel`, or null.
 * @returns {string | null}
 */
export function worktreeViolation(target, root, judge) {
  if (typeof target !== "string" || target === "") return "the edit names no file";
  if (typeof root !== "string" || !isAbsolute(root)) {
    return "the run's worktree (CLAUDE_PROJECT_DIR) is unknown";
  }
  const realRoot = physicalPath(resolve(root));
  for (const candidate of candidatePaths(target, root)) {
    const rel = relativeInside(physicalPath(candidate), realRoot);
    if (rel === null) return `${target} is outside this run's worktree (${root})`;
    if (rel === "") return `${target} is the worktree itself, not a file in it`;
    const why = judge(rel);
    if (why !== null) return why;
  }
  return null;
}
