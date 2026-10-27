import { isCanonicalPath } from "./plain-path.js";

/**
 * Paths no volatile declaration can cover, whatever it says: what Claude Code, git or the
 * pipeline executes or reads as configuration. A host's hooks keep state under protected
 * directories (`.claude/.rules-loaded/`, a gate script's stamp file), and declaring that state
 * volatile must not also open the hooks, settings, agents or ignore rules beside it. `.git*`
 * files are here because they decide what git ignores, which is what makes a path volatile.
 * Case-insensitive, as the protected list is.
 */
export const NEVER_VOLATILE: readonly RegExp[] = [
  /(^|\/)\.git[^/]*$/i,
  /(^|\/)CLAUDE(\.local)?\.md$/i,
  /^\.claude\/(settings[^/]*\.json|hooks\/|agents\/|skills\/|commands\/|rules\/|output-styles\/|plugins\/)/i,
  /^\.husky\//i,
  /^\.marvin\//i,
  /^\.mcp\.json$/i,
];

const neverVolatile = (path: string) => NEVER_VOLATILE.some((re) => re.test(path));

/**
 * Why `entry` cannot be a `pipeline.protected_volatile` entry, or null if it can. An entry is a
 * repo-relative POSIX path: a trailing `/` makes it a directory and covers what lies under it,
 * anything else names one file. There are no globs, so an entry cannot cover more than it says.
 */
export function volatileEntryProblem(entry: string): string | null {
  const bare = entry.endsWith("/") ? entry.slice(0, -1) : entry;
  if (!isCanonicalPath(bare)) return "it is not a repo-relative POSIX path";
  if (neverVolatile(entry)) return "it is executed or read as configuration";
  return null;
}

/**
 * Is `path` covered by a volatile declaration? Only half of the rule: the gate also requires
 * that git ignores the path (`ignoredPaths`), since a file the branch can carry is the branch's.
 */
export function declaredVolatile(entries: readonly string[], path: string): boolean {
  if (neverVolatile(path)) return false;
  return entries.some((e) => (e.endsWith("/") ? path.startsWith(e) : path === e));
}
