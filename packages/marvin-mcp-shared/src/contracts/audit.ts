import { z } from "zod";
import { LinkRef } from "./links.js";

/**
 * Security-audit data contract (ADR-0024, #7 Tier-2) — feeds the audit widgets.
 * This is the largest Stage-1 data change: today every `sec-*` scanner emits a
 * markdown PROSE report. Tier-2 makes each scanner additionally emit a typed
 * `audit-report` block (alongside its prose) so findings can be filtered, sorted
 * and counted by severity rather than eyeballed.
 */
export const Severity = z.enum(["critical", "high", "medium", "low", "info"]);
export type Severity = z.infer<typeof Severity>;

/**
 * Which `sec-*` command wrote the block. `gate` and `fix` joined the eight
 * scanners in ADR-0038, so `sec-gate` and `sec-fix` can keep a typed record of
 * what they saw and what they closed.
 *
 * Widening is read-compatible in one direction only: an eight-member block
 * still parses here, but a `gate`/`fix` block written under this version parses
 * as `invalid` against an older server. It MUST be applied to the runtime
 * mirror in `lib/reports.ts` in the same commit — otherwise those reports are
 * dropped by all three readers of `parseAuditBlock` with only a skip-note.
 */
export const AuditKind = z.enum([
  "scan",
  "secrets",
  "deps",
  "iac",
  "ci",
  "threat-model",
  "compliance",
  "pentest",
  "gate",
  "fix",
]);
export type AuditKind = z.infer<typeof AuditKind>;

export const Finding = z.object({
  id: z.string(),
  severity: Severity,
  title: z.string().min(1),
  /** Taxonomy ref, e.g. `OWASP A01:2025` or `CWE-89`. */
  category: z.string(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  evidence: z.string().optional(),
  remediation: z.string().optional(),
  links: z.array(LinkRef).optional(),
});
export type Finding = z.infer<typeof Finding>;

export const AuditReport = z.object({
  kind: AuditKind,
  scanned_at: z.string().datetime(),
  target: z.string().optional(),
  summary: z.record(Severity, z.number().int().nonnegative()),
  findings: z.array(Finding),
});
export type AuditReport = z.infer<typeof AuditReport>;

/**
 * The read-side / widget payload (ADR-0024, #7) — every `audit-report` block the
 * `audit` tool recovered from the `.marvin/security/*.md` reports, one entry per
 * report. Wrapper mirrors `HandoffListPayload`; the tool emits it as
 * `structuredContent` and the audit-viewer widget consumes it.
 */
export const AuditListPayload = z.object({
  reports: z.array(AuditReport),
});
export type AuditListPayload = z.infer<typeof AuditListPayload>;
