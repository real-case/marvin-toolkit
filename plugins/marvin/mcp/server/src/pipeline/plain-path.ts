import { lstatSync } from "node:fs";
import { join, posix } from "node:path";

/**
 * The engine reads and writes paths in a worktree a child has had its hands on. These checks
 * are what every such path goes through first. They lived in `gate.ts` and `learning.ts` until
 * the metrics carry (`metrics-carry.ts`) needed them for a file the gate and finalize read, and
 * the gate and finalize in turn need the carry: one module all three import keeps them free of
 * an import cycle.
 */

/**
 * A repo-relative POSIX path in the one spelling git prints it: no leading `/` or `./`, no
 * backslash, no empty, `.` or `..` segment, no control character. The gate compares these by
 * exact string against what git lists, so `./specs/a.test.mjs` would silently match nothing.
 */
export function isCanonicalPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path !== "" &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(path) &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..") &&
    posix.normalize(path) === path
  );
}

/**
 * Why `rel` is not a plain path beneath `root`, or null. A symbolic link at any component, or a
 * file where a directory belongs, is a problem; a component that does not exist yet is not. With
 * no link below `root`, everything under it is physically under `root`, whatever `root` is.
 */
export function physicalProblem(root: string, rel: string): string | null {
  const parts = rel.split("/");
  let current = root;
  for (const [i, part] of parts.entries()) {
    current = join(current, part);
    const where = parts.slice(0, i + 1).join("/");
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ENOENT" ? null : `${where} cannot be inspected (${code ?? String(error)})`;
    }
    if (stat.isSymbolicLink()) return `${where} is a symbolic link`;
    if (i < parts.length - 1 && !stat.isDirectory()) return `${where} is not a directory`;
  }
  return null;
}

/**
 * The engine writes into a worktree a child has had its hands on, and into a run dir. A planted
 * symbolic link would send a write somewhere else (the main checkout, a dotfile), so every
 * path is checked before it is read, written or removed, and a link is refused, not followed.
 */
export function assertPlain(root: string, rel: string): void {
  const problem = physicalProblem(root, rel);
  if (problem !== null) throw new Error(`refusing to use ${rel} under ${root}: ${problem}`);
}

/**
 * Refuse a regular file with a second hard link: it may be a file somewhere else, and a write
 * that goes through the inode (the lesson store appends in place) would change that one too.
 */
export function assertNotHardLinked(root: string, rel: string): void {
  let stat;
  try {
    stat = lstatSync(join(root, rel));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (stat.isFile() && stat.nlink > 1) {
    throw new Error(`refusing to use ${rel} under ${root}: it is a hard link to another file`);
  }
}
