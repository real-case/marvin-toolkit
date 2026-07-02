import type { TaskType } from "./schema.js";

/**
 * Derive a kebab-case slug from a task title.
 *
 * Contract: titles may be any printable Unicode (the TaskTitle schema);
 * slug output stays ASCII kebab-case, so non-Latin characters are
 * stripped. A fully non-Latin title therefore yields `""` — callers must
 * supply a fallback (createTask falls back to the task type) because
 * filenames and branch names must never end up with an empty slug segment.
 * Output is trimmed to ~40 chars without breaking on the middle of a word
 * where possible.
 */
export function slugify(title: string, maxLen = 40): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (base.length <= maxLen) return base;

  // Trim to last hyphen before maxLen so we don't split a word.
  const cut = base.slice(0, maxLen);
  const lastHyphen = cut.lastIndexOf("-");
  return lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut;
}

/**
 * Compose a task filename: `<seq>[-<tracker>]--<slug>.md`.
 *
 * Examples:
 *   buildFilename("002", "OSI-123", "fix-login")  → "002-OSI-123--fix-login.md"
 *   buildFilename("003", undefined,  "refactor")   → "003--refactor.md"
 */
export function buildFilename(seq: string, tracker: string | undefined, slug: string): string {
  if (tracker) return `${seq}-${tracker}--${slug}.md`;
  return `${seq}--${slug}.md`;
}

/**
 * Task type → topic-branch prefix, following the repo branching convention
 * (ADR-0019: `feat/*`, `fix/*`, `chore/*`, …). `spike` has no ADR-0019
 * counterpart and keeps its own name.
 */
const BRANCH_TYPE_PREFIX: Record<TaskType, string> = {
  bug: "fix",
  feature: "feat",
  chore: "chore",
  spike: "spike",
};

/**
 * Compose a task branch name: `<type-prefix>/<seq>[-<tracker>]--<slug>`.
 *
 * Examples:
 *   buildBranch("bug",     "007", "OSI-123", "login-timeout") → "fix/007-OSI-123--login-timeout"
 *   buildBranch("feature", "008", undefined, "dark-mode")     → "feat/008--dark-mode"
 *
 * Only applied at creation time — existing tasks keep the branch stored in
 * their frontmatter, so renaming the mapping never orphans a board.
 */
export function buildBranch(
  type: TaskType,
  seq: string,
  tracker: string | undefined,
  slug: string,
): string {
  const tail = tracker ? `${seq}-${tracker}--${slug}` : `${seq}--${slug}`;
  return `${BRANCH_TYPE_PREFIX[type]}/${tail}`;
}

/**
 * Human-readable description of the default branch scheme, shown by the
 * config view next to an unset `branch_template`.
 */
export const DEFAULT_BRANCH_SCHEME = "{type_prefix}/{seq}[-{tracker}]--{slug}";

/**
 * Render a configured `branch_template` (WP4). Placeholders:
 *
 *   {type_prefix} — bug→fix, feature→feat, chore→chore, spike→spike
 *   {type}        — the task type verbatim
 *   {seq}         — the zero-padded sequence id, e.g. 007
 *   {tracker}     — the tracker id; when the task has none, the placeholder
 *                   plus one immediately preceding `-`, `_` or `.` collapses
 *                   (matching the default scheme, where the tracker rides
 *                   behind a `-`)
 *   {slug}        — the kebab-case title slug (never empty; type fallback)
 *
 * Returns null when the result is not a safe git branch name — unresolved
 * `{...}` placeholders left over, or a name `isSafeBranchRef` rejects — so
 * the caller can fall back to the default scheme and warn instead of failing
 * the create.
 */
export function renderBranchTemplate(
  template: string,
  type: TaskType,
  seq: string,
  tracker: string | undefined,
  slug: string,
): string | null {
  let name = tracker
    ? template.replace(/\{tracker\}/g, tracker)
    : template.replace(/[-_.]?\{tracker\}/g, "");
  name = name
    .replace(/\{type_prefix\}/g, BRANCH_TYPE_PREFIX[type])
    .replace(/\{type\}/g, type)
    .replace(/\{seq\}/g, seq)
    .replace(/\{slug\}/g, slug);
  if (/[{}]/.test(name)) return null; // unknown placeholder survived substitution
  return isSafeBranchRef(name) ? name : null;
}

/**
 * Conservative approximation of `git check-ref-format --branch`, dependency-
 * free: rejects everything the real check rejects (empty, a leading `-` or
 * `/`, a trailing `/` or `.`, `..`, `//`, `@{`, a lone `@`, control chars and
 * git's forbidden punctuation, empty / dot-leading / `.lock`-ending path
 * segments). May reject a few exotic names git would allow — fine for names
 * we generate ourselves.
 */
export function isSafeBranchRef(name: string): boolean {
  if (!name || name === "@") return false;
  if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/")) return false;
  if (name.endsWith(".")) return false;
  // eslint-disable-next-line no-control-regex -- control chars are exactly what we reject
  if (/[\u0000-\u0020\u007F~^:?*[\\]/.test(name)) return false;
  if (name.includes("..") || name.includes("//") || name.includes("@{")) return false;
  for (const segment of name.split("/")) {
    if (!segment || segment.startsWith(".") || segment.endsWith(".lock")) return false;
  }
  return true;
}

/**
 * Parse the sequential id out of a task filename. Returns null if the
 * filename does not match the expected pattern.
 */
export function parseSeq(filename: string): string | null {
  const match = filename.match(/^(\d{3})(?:-|--)/);
  return match ? (match[1] ?? null) : null;
}
