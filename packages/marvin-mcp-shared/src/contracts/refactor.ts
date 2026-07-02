import { z } from "zod";
import { Severity } from "./audit.js";

/**
 * Refactoring-findings data contract (ADR-0029, staged per ADR-0024). The
 * `refactor-audit` / `refactor-smells` skills emit markdown reports whose
 * findings register carries exactly these fields (`F<n>` id, severity, effort,
 * file:line evidence, suggested direction); this schema is the typed twin —
 * data-only until a consumer imports it (the dashboard aggregation and the
 * widget family are the intended consumers).
 *
 * Severity reuses the shared audit vocabulary; effort is the remediation-size
 * scale the register uses.
 */
export const RefactorEffort = z.enum(["trivial", "small", "medium", "large"]);
export type RefactorEffort = z.infer<typeof RefactorEffort>;

/** One evidenced location — a file, optionally pinned to a line. */
export const RefactorEvidence = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  /** The measurable signal or short note tied to this location (e.g. "changed 47× in 12 mo"). */
  note: z.string().optional(),
});
export type RefactorEvidence = z.infer<typeof RefactorEvidence>;

export const RefactorFinding = z.object({
  /** Register id, report-scoped (`F1`, `F2`, …). */
  id: z.string().regex(/^F\d+$/, "register id like F1"),
  title: z.string().min(1),
  severity: Severity,
  effort: RefactorEffort,
  /** Every finding is evidenced — at least one location. */
  evidence: z.array(RefactorEvidence).min(1),
  /** Suggested refactoring direction, one or two lines. */
  direction: z.string().min(1),
  /** Source report path relative to the project root, e.g. `.marvin/refactor/001-audit-core.md`. */
  source_report: z.string().min(1),
});
export type RefactorFinding = z.infer<typeof RefactorFinding>;
