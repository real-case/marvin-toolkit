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

export const AuditKind = z.enum([
  "scan",
  "secrets",
  "deps",
  "iac",
  "ci",
  "threat-model",
  "compliance",
  "pentest",
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
