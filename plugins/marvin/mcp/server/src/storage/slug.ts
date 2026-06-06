/**
 * Derive a kebab-case slug from a task title.
 *
 * Contract: title is expected to be ASCII (enforced by the elicit schema).
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
 * Parse the sequential id out of a task filename. Returns null if the
 * filename does not match the expected pattern.
 */
export function parseSeq(filename: string): string | null {
  const match = filename.match(/^(\d{3})(?:-|--)/);
  return match ? (match[1] ?? null) : null;
}
