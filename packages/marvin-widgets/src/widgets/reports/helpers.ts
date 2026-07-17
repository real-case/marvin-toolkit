import type {
  ReportEnvelope,
  ReportListPayload,
  Severity,
} from "@marvin-toolkit/mcp-shared/contracts";

/**
 * Pure helpers for the reports widget (docs/design/reports-widget.md). All
 * derivation the view needs — KPI roll-ups, age labels, search matching —
 * lives here as plain functions over `ReportListPayload`, so every number the
 * KPI strip shows is unit-testable without a DOM and the view stays a renderer.
 */

/** Chip/row ordering for severities — the audit family's critical-first ramp. */
export const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

/** The four severities the findings summary counts (`info` never rolls up). */
export type SummarySeverity = "critical" | "high" | "medium" | "low";

/**
 * Render an ISO timestamp as a compact age — `34m`, `5h`, `12d`. Deterministic:
 * the reference clock is an explicit parameter (tests and visual stories pin
 * it), defaulting to `Date.now()` in production. Total: an unparseable input is
 * returned unchanged, a future timestamp clamps to `0m` — never a throw.
 */
export function formatAge(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const minutes = Math.max(0, Math.floor((now - t) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * The producing command without its group prefix — `sec-scan` → `scan`,
 * `refactor-smells` → `smells` — for the tight KPI subtitles ("2 scan · 1 deps").
 * Commands without a known prefix (`handoff`) pass through unchanged.
 */
export function shortCommand(generatedBy: string): string {
  return generatedBy.replace(/^(?:sec|refactor|task|track|adr|pr)-/, "");
}

/** Case-insensitive substring match over title, path and group. Empty query matches all. */
export function matchesSearch(report: ReportEnvelope, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [report.title, report.path, report.group].some((v) => v.toLowerCase().includes(q));
}

/** The worst severity present in a findings summary, or null for a clean report. */
export function worstSeverity(counts: Record<SummarySeverity, number>): SummarySeverity | null {
  for (const s of ["critical", "high", "medium", "low"] as const) {
    if (counts[s] > 0) return s;
  }
  return null;
}

/** The quality-gates KPI cell — derived from the newest task-group checks report. */
export interface GatesKpi {
  /** Envelope id — the report the gates card selects when clicked. */
  reportId: string;
  verdict: "pass" | "fail" | "mixed";
  done: number;
  total: number;
  generatedAt: string;
}

/** Everything the KPI strip renders, derived from the payload alone. */
export interface ReportsKpis {
  /** Open findings across every findings-summary report (truncated ones included). */
  openTotal: number;
  severityCounts: Record<SummarySeverity, number>;
  criticalTotal: number;
  /** `"2 scan · 1 deps"` — per producing command, payload order; `""` with no criticals. */
  criticalBreakdown: string;
  /** Newest findings report carrying a critical — the critical card's click target. */
  criticalTargetId: string | null;
  /** Newest task-group checks report (verification), or null before the first verify. */
  gates: GatesKpi | null;
  staleCount: number;
  /** The stale report with the oldest `generatedAt` — the stale card's click target. */
  oldestStale: ReportEnvelope | null;
}

/**
 * Roll the payload up into the four KPI cells. Counts come from each report's
 * server-computed `summary` (which covers truncated findings too — the widget
 * only ever sees the head of a long register), never by re-counting `body`.
 * Reports arrive newest-first, so "first match" is "newest" throughout.
 */
export function computeKpis(payload: ReportListPayload): ReportsKpis {
  const severityCounts: Record<SummarySeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  const breakdown: string[] = [];
  let criticalTargetId: string | null = null;
  let gates: GatesKpi | null = null;
  let staleCount = 0;
  let oldestStale: ReportEnvelope | null = null;

  for (const report of payload.reports) {
    if (report.summary.kind === "findings") {
      const c = report.summary.counts;
      severityCounts.critical += c.critical;
      severityCounts.high += c.high;
      severityCounts.medium += c.medium;
      severityCounts.low += c.low;
      if (c.critical > 0) {
        breakdown.push(`${c.critical} ${shortCommand(report.generatedBy)}`);
        if (criticalTargetId === null) criticalTargetId = report.id;
      }
    }
    if (
      gates === null &&
      report.kind === "checks" &&
      report.group === "task" &&
      report.summary.kind === "checks"
    ) {
      const s = report.summary;
      gates = {
        reportId: report.id,
        verdict: s.failed > 0 ? "fail" : s.total > 0 && s.done === s.total ? "pass" : "mixed",
        done: s.done,
        total: s.total,
        generatedAt: report.generatedAt,
      };
    }
    if (report.stale) {
      staleCount += 1;
      if (
        oldestStale === null ||
        Date.parse(report.generatedAt) < Date.parse(oldestStale.generatedAt)
      ) {
        oldestStale = report;
      }
    }
  }

  return {
    openTotal:
      severityCounts.critical + severityCounts.high + severityCounts.medium + severityCounts.low,
    severityCounts,
    criticalTotal: severityCounts.critical,
    criticalBreakdown: breakdown.join(" · "),
    criticalTargetId,
    gates,
    staleCount,
    oldestStale,
  };
}
