/**
 * Minimal YAML-frontmatter splitter.
 *
 * SKILL.md files in marvin packs begin with a `---`-delimited YAML block
 * (name, description, optional flags). When the same file is served as
 * an MCP prompt body, that block has to be stripped — the model gets
 * the prose, the description lives in the prompt registration.
 *
 * We do not parse the YAML itself here; for that the linter or skill
 * registry is responsible. This helper only locates the delimiters.
 */
export interface FrontmatterSplit {
  /** Raw YAML text between the two `---` lines (no surrounding markers). */
  frontmatter: string;
  /** Markdown body that follows the closing `---` (leading newline trimmed). */
  body: string;
}

export function splitFrontmatter(text: string): FrontmatterSplit {
  if (!text.startsWith("---\n")) {
    return { frontmatter: "", body: text };
  }
  const endIdx = text.indexOf("\n---", 4);
  if (endIdx === -1) {
    return { frontmatter: "", body: text };
  }
  const frontmatter = text.slice(4, endIdx);
  let body = text.slice(endIdx + 4);
  if (body.startsWith("\n")) body = body.slice(1);
  return { frontmatter, body };
}
