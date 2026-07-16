import { z } from "zod";
import { LinkRef } from "./links.js";
import { Finding } from "./audit.js";

/**
 * Unified report envelope (reports widget, docs/design/reports-widget.md).
 * Every document marvin generates under `.marvin/` — security reports,
 * refactor registers and plans, task specs, `verification.md`, handoffs —
 * arrives in one envelope and renders through one of three body kinds. The
 * `report` tool assembles the payload server-side; the widget only renders.
 * Everything the widget shows (staleness verdicts, summary chips, continuation
 * commands) is derivable data — the widget never owns policy or assembles
 * command strings itself.
 */

/** Which `.marvin/` family produced the report. */
export const ReportGroup = z.enum(["security", "refactor", "task", "handoff"]);
export type ReportGroup = z.infer<typeof ReportGroup>;

/** How the report body renders: finding rows, check rows, or markdown. */
export const ReportBodyKind = z.enum(["findings", "checks", "document"]);
export type ReportBodyKind = z.infer<typeof ReportBodyKind>;

/** Remediation-size scale carried by refactor-register findings. */
export const ReportEffort = z.enum(["S", "M", "L"]);
export type ReportEffort = z.infer<typeof ReportEffort>;

/**
 * One finding row — the audit `Finding` fields extended with the refactor
 * register's `effort`/`direction` and an optional server-derived `fixCommand`
 * (e.g. `/marvin:sec-fix scan F1`; the widget renders it as a copyable chip).
 * `category` relaxes to optional: refactor findings carry no taxonomy ref.
 */
export const ReportFinding = Finding.extend({
  category: z.string().optional(),
  effort: ReportEffort.optional(),
  /** Suggested refactoring direction (refactor registers). */
  direction: z.string().optional(),
  /** Ready-to-run continuation command, supplied by the tool as data. */
  fixCommand: z.string().optional(),
});
export type ReportFinding = z.infer<typeof ReportFinding>;

/** Severity-ranked findings body (`sec-*` reports, refactor registers). */
export const FindingsBody = z.object({
  findings: z.array(ReportFinding),
  /** How many further findings the source file holds beyond this list. */
  truncated: z.number().int().nonnegative().optional(),
});
export type FindingsBody = z.infer<typeof FindingsBody>;

export const ReportCheckStatus = z.enum(["pass", "fail", "pending"]);
export type ReportCheckStatus = z.infer<typeof ReportCheckStatus>;

/** Pass/fail/pending rows (verification gates, refactor plan steps). */
export const ChecksBody = z.object({
  checks: z.array(
    z.object({
      name: z.string().min(1),
      status: ReportCheckStatus,
      note: z.string().optional(),
    }),
  ),
});
export type ChecksBody = z.infer<typeof ChecksBody>;

/** Rendered-markdown body (task specs, handoff documents). */
export const DocumentBody = z.object({
  markdown: z.string(),
});
export type DocumentBody = z.infer<typeof DocumentBody>;

export const ReportBody = z.union([FindingsBody, ChecksBody, DocumentBody]);
export type ReportBody = z.infer<typeof ReportBody>;

/**
 * The list-row summary chip, discriminated by body kind: severity counts for
 * findings reports, a done/total/failed roll-up for checks, a neutral kind tag
 * (`spec`, `handoff`) for documents.
 */
export const FindingsSummary = z.object({
  kind: z.literal("findings"),
  counts: z.object({
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
  }),
});
export type FindingsSummary = z.infer<typeof FindingsSummary>;

export const ChecksSummary = z.object({
  kind: z.literal("checks"),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type ChecksSummary = z.infer<typeof ChecksSummary>;

export const DocumentSummary = z.object({
  kind: z.literal("document"),
  tag: z.string().min(1),
});
export type DocumentSummary = z.infer<typeof DocumentSummary>;

export const ReportSummary = z.discriminatedUnion("kind", [
  FindingsSummary,
  ChecksSummary,
  DocumentSummary,
]);
export type ReportSummary = z.infer<typeof ReportSummary>;

/** One generated document in the unified envelope. */
export const ReportEnvelope = z.object({
  /** Stable key — the project-relative path, e.g. `.marvin/security/scan-report.md`. */
  id: z.string().min(1),
  group: ReportGroup,
  kind: ReportBodyKind,
  title: z.string().min(1),
  /** Project-relative source file path. */
  path: z.string().min(1),
  /** Producing command, e.g. `sec-scan`. */
  generatedBy: z.string().min(1),
  /** ISO timestamp — the source file's mtime. */
  generatedAt: z.string().datetime(),
  /** Server-computed freshness verdict (the widget renders, never decides). */
  stale: z.boolean(),
  summary: ReportSummary,
  body: ReportBody,
  links: z.array(LinkRef).default([]),
  /** Ready-to-run regeneration command, e.g. `/marvin:sec-scan`. */
  rerunCommand: z.string().optional(),
});
export type ReportEnvelope = z.infer<typeof ReportEnvelope>;

/** The `report` tool's `structuredContent` — every envelope, newest first. */
export const ReportListPayload = z.object({
  reports: z.array(ReportEnvelope),
  /** Deep-link: envelope id to pre-select in the widget. */
  selected: z.string().optional(),
});
export type ReportListPayload = z.infer<typeof ReportListPayload>;
