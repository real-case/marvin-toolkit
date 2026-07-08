import { z } from "zod";

/**
 * ADR corpus data contract (ADR-0027) — feeds the `adr` tool's
 * `structuredContent`, the dashboard's corpus-by-status counts (WP6), and the
 * future decision-log widget. The vocabulary mirrors the server's
 * `storage/adr.ts` (which duplicates the value schema on purpose, so the
 * contract stays importable type-only and never bundles into `dist/server.js`).
 */
export const AdrStatus = z.enum(["proposed", "accepted", "deprecated", "superseded", "rejected"]);
export type AdrStatus = z.infer<typeof AdrStatus>;

/**
 * One parsed decision record, style-agnostic: the same shape whether the file
 * carries marvin's table-style header (`| Status | **Accepted** … |`) or the
 * MADR/Nygard heading style (`## Status`). Number and slug come from the
 * `NNNN-<slug>.md` filename; `path` is project-root-relative.
 */
export const AdrRecord = z.object({
  number: z.number().int().positive(),
  slug: z.string().min(1),
  title: z.string().min(1),
  status: AdrStatus,
  /** `YYYY-MM-DD`; null when the record carries no parseable date. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  /** Numbers of the records this one supersedes (paired links, ADR-0027). */
  supersedes: z.array(z.number().int().positive()),
  /** Numbers of the records that supersede this one. */
  superseded_by: z.array(z.number().int().positive()),
  path: z.string().min(1),
});
export type AdrRecord = z.infer<typeof AdrRecord>;

/** A file in the corpus directory the tolerant parser could not read. */
export const AdrMalformed = z.object({
  filename: z.string().min(1),
  /** Filename number when the `NNNN-` prefix was still parseable. */
  number: z.number().int().positive().nullable(),
  reason: z.string().min(1),
});
export type AdrMalformed = z.infer<typeof AdrMalformed>;

/** `adr list` payload: the parsed corpus plus per-status counts (a dashboard feed). */
export const AdrListPayload = z.object({
  dir: z.string().min(1),
  records: z.array(AdrRecord),
  counts: z.record(AdrStatus, z.number().int().nonnegative()),
  malformed: z.array(AdrMalformed),
});
export type AdrListPayload = z.infer<typeof AdrListPayload>;

/** The corpus-lint classes `adr audit` reports (ADR-0027). */
export const AdrAuditKind = z.enum([
  "malformed",
  "invalid-status",
  "duplicate-number",
  "numbering-hole",
  "dangling-reference",
  "broken-supersede-pair",
  "placeholder-residue",
  "stale-index",
]);
export type AdrAuditKind = z.infer<typeof AdrAuditKind>;

export const AdrAuditFinding = z.object({
  kind: AdrAuditKind,
  /** Errors fail the audit; warnings inform without failing it. */
  severity: z.enum(["error", "warning"]),
  message: z.string().min(1),
  /** Record number the finding points at; null for corpus-level findings. */
  number: z.number().int().positive().nullable(),
  path: z.string().nullable(),
});
export type AdrAuditFinding = z.infer<typeof AdrAuditFinding>;

export const AdrAuditPayload = z.object({
  dir: z.string().min(1),
  /** Parsed records + malformed files = every corpus file the audit saw. */
  checked: z.number().int().nonnegative(),
  findings: z.array(AdrAuditFinding),
  /** True when no error-severity finding exists. */
  ok: z.boolean(),
});
export type AdrAuditPayload = z.infer<typeof AdrAuditPayload>;
