import { z } from "zod";

/**
 * Handoff data contract (ADR-0024) — feeds the handoff widget (#5). The handoff
 * artifact is narrative by design (a cold-reader brief), so this is a HYBRID:
 * a thin structured header carries the list-able and linkable fields, while the
 * decisions/context stay markdown rendered by `<Markdown>`.
 *
 * Stage-1 work: the handoff skill currently emits a bodyless markdown document
 * with no frontmatter. The `HandoffCard` fields (objective, branch, base,
 * pr_url, spec_slug) must be promoted from prose ("Open PR: <url>") into YAML
 * frontmatter so the list view and links need no prose parsing.
 */
export const HandoffCard = z.object({
  id: z.string().regex(/^\d{3}$/, "zero-padded 3-digit id"),
  slug: z.string(),
  objective: z.string().min(1),
  branch: z.string(),
  base: z.string().optional(),
  pr_url: z.string().url().nullable(),
  spec_slug: z.string().optional(),
  created: z.string().datetime(),
});
export type HandoffCard = z.infer<typeof HandoffCard>;

/** Handoff detail — header plus the paste-ready continuation prompt and body. */
export const HandoffDetail = HandoffCard.extend({
  continue_prompt: z.string(),
  body_markdown: z.string(),
});
export type HandoffDetail = z.infer<typeof HandoffDetail>;

export const HandoffListPayload = z.object({
  handoffs: z.array(HandoffCard),
});
export type HandoffListPayload = z.infer<typeof HandoffListPayload>;
