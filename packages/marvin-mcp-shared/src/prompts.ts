import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { splitFrontmatter } from "./frontmatter.js";
import type { PromptDef } from "./types.js";

/**
 * Resolve a prompt's body. Three sources, in order of precedence:
 *
 *   1. `body` — inline string. Returned as-is.
 *   2. `skill` — name of a SKILL directory under `<packRoot>/skills/`.
 *      The file `<packRoot>/skills/<skill>/SKILL.md` is read and its
 *      YAML frontmatter is stripped before returning.
 *   3. `bodyFile` — filename under `promptsDir`. Returned verbatim
 *      (no frontmatter stripping — this path is meant for hand-written
 *      prompt bodies that already lack frontmatter).
 *
 * Exactly one of `body`, `skill`, `bodyFile` must be set. Setting more
 * than one is a programmer error and throws.
 */
export function resolvePromptBody(
  def: PromptDef,
  ctx: { promptsDir: string; packRoot?: string },
): string {
  const sources = [def.body, def.skill, def.bodyFile].filter((s) => s !== undefined);
  if (sources.length === 0) {
    throw new Error(`Prompt '${def.name}': one of 'body', 'skill', or 'bodyFile' is required`);
  }
  if (sources.length > 1) {
    throw new Error(`Prompt '${def.name}': 'body', 'skill', 'bodyFile' are mutually exclusive`);
  }

  if (def.body !== undefined) return def.body;

  if (def.skill !== undefined) {
    if (!ctx.packRoot) {
      throw new Error(
        `Prompt '${def.name}' uses skill='${def.skill}' but server was started without packRoot`,
      );
    }
    const skillPath = join(ctx.packRoot, "skills", def.skill, "SKILL.md");
    const raw = readFileSync(skillPath, "utf8");
    return splitFrontmatter(raw).body;
  }

  if (def.bodyFile !== undefined) {
    return readFileSync(join(ctx.promptsDir, def.bodyFile), "utf8");
  }

  throw new Error(`Prompt '${def.name}': unreachable`);
}

/**
 * Convenience helper: compute the prompts directory relative to a
 * server entry file. Pack server entries call:
 *
 *   const promptsDir = promptsDirFromMeta(import.meta.url);
 *
 * Pre-build (`src/server.ts`) → `src/prompts/`.
 * Post-bundle (`dist/server.js`) → `dist/prompts/` (only used when the
 * pack still emits `.md` body files alongside the bundle).
 */
export function promptsDirFromMeta(metaUrl: string): string {
  return join(dirname(fileURLToPath(metaUrl)), "prompts");
}

/**
 * Compute the pack root (the directory containing `skills/`, `agents/`,
 * `.mcp.json`) from a server entry's `import.meta.url`. Assumes the
 * standard `plugins/<pack>/mcp/server/{src,dist}/` layout — three
 * directories up from the entry file.
 */
export function packRootFromMeta(metaUrl: string): string {
  return join(dirname(fileURLToPath(metaUrl)), "..", "..", "..");
}

/**
 * Apply prompt argument substitutions to a body. Replaces `{{name}}`
 * with the value the user supplied via the slash UI. Unknown
 * placeholders are left untouched so they're visible during authoring.
 */
export function interpolateArgs(body: string, args: Record<string, string | undefined>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = args[key];
    return value === undefined ? match : value;
  });
}
