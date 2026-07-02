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
 * Parse the sequential id out of a task filename. Returns null if the
 * filename does not match the expected pattern.
 */
export function parseSeq(filename: string): string | null {
  const match = filename.match(/^(\d{3})(?:-|--)/);
  return match ? (match[1] ?? null) : null;
}
