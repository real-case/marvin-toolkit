import { z } from "zod";

/**
 * The shared link primitive (ADR-0024). Every marvin artifact stores its links
 * as data — never resolved live — and the widget layer renders them through one
 * of three behaviours keyed off which field is populated:
 *
 *  - `url` present  → external navigation, opened via the host (`app.openLink`).
 *  - `ref` present  → internal navigation within the widget (a slug, an `AC` id,
 *    a task id) — the widget routes it without leaving the iframe.
 *  - neither/both    → the widget decides; `label` is always the display text.
 *
 * `kind` is advisory styling/grouping metadata, not a discriminator — a link may
 * carry both a `url` (open the PR on GitHub) and a `ref` (focus it in a list).
 */
export const LinkKind = z.enum(["pr", "tracker", "adr", "spec", "branch", "commit", "external"]);
export type LinkKind = z.infer<typeof LinkKind>;

export const LinkRef = z.object({
  kind: LinkKind,
  label: z.string().min(1),
  url: z.string().url().optional(),
  ref: z.string().optional(),
});
export type LinkRef = z.infer<typeof LinkRef>;
