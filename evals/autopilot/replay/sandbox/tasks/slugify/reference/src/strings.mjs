/** The text with its first character upper-cased. */
export function capitalize(text) {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

/**
 * A URL slug: the text lower-cased, every run of characters other than a-z and 0-9 replaced by
 * one hyphen, and leading and trailing hyphens removed.
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
