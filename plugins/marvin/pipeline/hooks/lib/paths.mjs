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
