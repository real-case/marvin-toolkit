import { z } from "zod";

/**
 * Spec-corpus lint contract — the payload `spec` returns for
 * `action: "audit"` (`/marvin:task-audit`).
 *
 * The shape mirrors `contracts/adr.ts`'s audit trio field for field, because the
 * two commands are siblings a user reads side by side. Two divergences are
 * deliberate:
 *
 * 1. **A finding carries `slug` beside `number`.** A spec's identity is its slug
 *    (ADR-0022 §2), not its ordering prefix, and the legacy unnumbered
 *    `<slug>.md` form has no number at all — so a finding keyed only on `number`
 *    could not name half the corpus. `null` is a corpus-level finding, which
 *    belongs to no single spec.
 * 2. **`number` is `nonnegative`, not `positive`.** Nothing in the pipeline
 *    emits a `000-` prefix, but the cost of being wrong is inverted: a
 *    `positive` bound would make a corpus containing one such file fail the
 *    payload's own schema — the audit crashing on precisely the malformed input
 *    it exists to report.
 *
 * Data only; no runtime effect until a tool imports the type.
 */

/** The corpus-lint classes `spec audit` reports. */
export const SpecAuditKind = z.enum([
  "malformed",
  "invalid-status",
  "duplicate-number",
  "numbering-hole",
  "slug-collision",
  "dangling-depends-on",
  "missing-seal",
]);
export type SpecAuditKind = z.infer<typeof SpecAuditKind>;

export const SpecAuditFinding = z.object({
  kind: SpecAuditKind,
  /** Errors fail the audit; warnings inform without failing it. */
  severity: z.enum(["error", "warning"]),
  message: z.string().min(1),
  /** The spec the finding points at; null for corpus-level findings. */
  slug: z.string().nullable(),
  /** Ordering prefix; null for a corpus-level finding or a legacy unnumbered spec. */
  number: z.number().int().nonnegative().nullable(),
  path: z.string().nullable(),
});
export type SpecAuditFinding = z.infer<typeof SpecAuditFinding>;

export const SpecAuditPayload = z.object({
  /** Project-root-relative resolved spec directory. */
  dir: z.string().min(1),
  /** Parsed records + unreadable files = every corpus file the audit saw. */
  checked: z.number().int().nonnegative(),
  findings: z.array(SpecAuditFinding),
  /** True when no error-severity finding exists. */
  ok: z.boolean(),
});
export type SpecAuditPayload = z.infer<typeof SpecAuditPayload>;
