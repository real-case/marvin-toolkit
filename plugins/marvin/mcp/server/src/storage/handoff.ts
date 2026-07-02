import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HandoffFrontmatter, type Handoff } from "./schema.js";
import { parseFrontmatter } from "./frontmatter.js";
import { parseSeq } from "./slug.js";

export interface MalformedHandoff {
  filename: string;
  reason: string;
}

export interface ReadHandoffsResult {
  handoffs: Handoff[];
  malformed: MalformedHandoff[];
}

/**
 * Read every handoff document under the handoff dir (ADR-0024). Mirrors
 * `readAllTasks`: numeric-prefixed `.md` files are parsed and zod-validated
 * against `HandoffFrontmatter`; anything with broken or missing frontmatter
 * (e.g. a legacy handoff written before the frontmatter convention) is
 * collected separately so the rest of the listing keeps working. Sorted
 * newest-first by the numeric id.
 */
export function readAllHandoffs(handoffDir: string): ReadHandoffsResult {
  if (!existsSync(handoffDir)) return { handoffs: [], malformed: [] };

  const handoffs: Handoff[] = [];
  const malformed: MalformedHandoff[] = [];

  for (const filename of readdirSync(handoffDir).sort()) {
    if (!filename.endsWith(".md")) continue;
    const seq = parseSeq(filename);
    if (!seq) continue;

    const raw = readFileSync(join(handoffDir, filename), "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const parsed = HandoffFrontmatter.safeParse(frontmatter);
    if (!parsed.success) {
      malformed.push({ filename, reason: parsed.error.issues.map((i) => i.message).join("; ") });
      continue;
    }
    if (parsed.data.id !== seq) {
      malformed.push({
        filename,
        reason: `frontmatter id=${parsed.data.id} does not match filename seq=${seq}`,
      });
      continue;
    }
    handoffs.push({ frontmatter: parsed.data, body, filename });
  }

  handoffs.sort((a, b) => Number(b.frontmatter.id) - Number(a.frontmatter.id));
  return { handoffs, malformed };
}
