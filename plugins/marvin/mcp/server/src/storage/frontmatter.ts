/**
 * Minimal YAML-frontmatter codec for marvin tasks.
 *
 * We do not depend on a YAML library here. Task frontmatter is a flat
 * `key: value` block — no nested structures, no arrays, no quoting
 * subtleties beyond optional double quotes around the title. This keeps
 * the bundle small and the parsing legible.
 *
 * Trade-off: if a future field needs YAML's general expressiveness,
 * swap this for `yaml` or `gray-matter`. Until then, simplicity wins.
 */

export interface FrontmatterFile {
  frontmatter: Record<string, string>;
  body: string;
}

export function parseFrontmatter(text: string): FrontmatterFile {
  if (!text.startsWith("---\n")) {
    return { frontmatter: {}, body: text };
  }
  const endIdx = text.indexOf("\n---", 4);
  if (endIdx === -1) {
    return { frontmatter: {}, body: text };
  }
  const raw = text.slice(4, endIdx);
  const after = text.slice(endIdx + 4);
  const body = after.startsWith("\n") ? after.slice(1) : after;

  const frontmatter: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    frontmatter[key] = stripQuotes(value);
  }
  return { frontmatter, body };
}

export function stringifyFrontmatter(
  frontmatter: Record<string, string | undefined>,
  body: string,
): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${needsQuotes(value) ? JSON.stringify(value) : value}`);
  }
  lines.push("---");
  if (body && !body.startsWith("\n")) lines.push("");
  lines.push(body);
  return lines.join("\n");
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value) as string;
  }
  return value;
}

function needsQuotes(value: string): boolean {
  // Quote when value contains characters YAML treats specially.
  return /[:#"'`\\]|^[\s-]|\s$/.test(value);
}
