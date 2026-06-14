/**
 * YAML-frontmatter codec for marvin (ADR-0007: consolidated onto the `yaml`
 * library, replacing the prior hand-rolled `key: value` parser).
 *
 * Task frontmatter and a spec's identity/lifecycle header are flat blocks of
 * **string** values. We parse with the YAML **failsafe** schema so every scalar
 * stays a string — no surprise coercion of `001` to the number 1 or an ISO
 * timestamp like `2026-06-14T07:52:00.000Z` to a `Date`, either of which would
 * silently corrupt a round-tripped kanban task file. Typed structures (the
 * spec-contract block) are parsed separately, with the default schema, by the
 * spec tool — failsafe lives here, where strings-in-strings-out is the contract.
 */
import { parse, stringify } from "yaml";

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

  let doc: unknown;
  try {
    doc = parse(raw, { schema: "failsafe" });
  } catch {
    // A malformed frontmatter block yields an empty map rather than throwing —
    // callers (kanban `readAllTasks`, the spec gate) treat missing keys as their
    // own validation failure, which is the right place to report it.
    return { frontmatter: {}, body };
  }

  const frontmatter: Record<string, string> = {};
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
      if (value == null) continue;
      // Under the failsafe schema every scalar is already a string; the guard
      // is belt-and-braces for any nested map/seq a caller did not expect.
      frontmatter[key] = typeof value === "string" ? value : String(value);
    }
  }
  return { frontmatter, body };
}

export function stringifyFrontmatter(
  frontmatter: Record<string, string | undefined>,
  body: string,
): string {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value !== undefined) clean[key] = value;
  }
  // failsafe stringify keeps every value a quoted/plain string (never inferring
  // a number or timestamp), so the codec is symmetric with parseFrontmatter.
  const fm = Object.keys(clean).length ? stringify(clean, { schema: "failsafe" }).trimEnd() : "";

  const lines = ["---"];
  if (fm) lines.push(fm);
  lines.push("---");
  if (body && !body.startsWith("\n")) lines.push("");
  lines.push(body);
  return lines.join("\n");
}
