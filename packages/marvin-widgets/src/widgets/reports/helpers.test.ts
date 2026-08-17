import { describe, expect, it } from "vitest";
import type { ReportListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { computeKpis, formatAge, matchesSearch, shortCommand, worstSeverity } from "./helpers";
import { REPORTS_NOW, gatesFailedFixture, reportsFixture } from "./fixture";

const minutes = (n: number) => new Date(REPORTS_NOW - n * 60_000).toISOString();

describe("formatAge — deterministic m/h/d granularity", () => {
  it("renders minutes under an hour, hours under a day, then days", () => {
    expect(formatAge(minutes(0), REPORTS_NOW)).toBe("0m");
    expect(formatAge(minutes(34), REPORTS_NOW)).toBe("34m");
    expect(formatAge(minutes(59), REPORTS_NOW)).toBe("59m");
    expect(formatAge(minutes(60), REPORTS_NOW)).toBe("1h");
    expect(formatAge(minutes(5 * 60), REPORTS_NOW)).toBe("5h");
    expect(formatAge(minutes(23 * 60 + 59), REPORTS_NOW)).toBe("23h");
    expect(formatAge(minutes(24 * 60), REPORTS_NOW)).toBe("1d");
    expect(formatAge(minutes(12 * 24 * 60), REPORTS_NOW)).toBe("12d");
  });

  it("clamps future timestamps to 0m and passes unparseable input through", () => {
    expect(formatAge(minutes(-90), REPORTS_NOW)).toBe("0m");
    expect(formatAge("not-a-date", REPORTS_NOW)).toBe("not-a-date");
  });
});

describe("shortCommand / worstSeverity / matchesSearch", () => {
  it("strips the group prefix from producing commands", () => {
    expect(shortCommand("sec-scan")).toBe("scan");
    expect(shortCommand("sec-deps")).toBe("deps");
    expect(shortCommand("refactor-smells")).toBe("smells");
    expect(shortCommand("task-verify")).toBe("verify");
    expect(shortCommand("handoff")).toBe("handoff");
  });

  it("ranks the worst severity critical-first and returns null for a clean summary", () => {
    expect(worstSeverity({ critical: 2, high: 0, medium: 1, low: 0 })).toBe("critical");
    expect(worstSeverity({ critical: 0, high: 1, medium: 5, low: 0 })).toBe("high");
    expect(worstSeverity({ critical: 0, high: 0, medium: 0, low: 3 })).toBe("low");
    expect(worstSeverity({ critical: 0, high: 0, medium: 0, low: 0 })).toBeNull();
  });

  it("matches title, path and group case-insensitively; empty query matches all", () => {
    const scan = reportsFixture.reports[1];
    expect(matchesSearch(scan, "")).toBe(true);
    expect(matchesSearch(scan, "SECURITY SCAN")).toBe(true); // title
    expect(matchesSearch(scan, "scan-report.md")).toBe(true); // path
    expect(matchesSearch(scan, "secur")).toBe(true); // group
    expect(matchesSearch(scan, "handoff")).toBe(false);
  });
});

describe("computeKpis — the KPI strip derivation", () => {
  it("rolls up the fixture: totals from summaries (truncated included), breakdown, gates, stale", () => {
    const kpis = computeKpis(reportsFixture);

    // Summary counts, NOT visible-body counts: 19 + 3 + 11 + 10 = 43.
    expect(kpis.severityCounts).toEqual({ critical: 3, high: 15, medium: 18, low: 7 });
    expect(kpis.openTotal).toBe(43);

    // Criticals: 2 in the scan report + 1 in deps, payload (newest-first) order.
    expect(kpis.criticalTotal).toBe(3);
    expect(kpis.criticalBreakdown).toBe("2 scan · 1 deps");
    expect(kpis.criticalTargetId).toBe(".marvin/security/scan-report.md");

    // Gates come from the newest task-group checks report (verification).
    expect(kpis.gates).toEqual({
      reportId: ".marvin/task/verification.md",
      verdict: "pass",
      done: 4,
      total: 4,
      generatedAt: "2026-07-16T07:00:00.000Z",
    });

    // Exactly one stale report — deps — which is therefore also the oldest.
    expect(kpis.staleCount).toBe(1);
    expect(kpis.oldestStale?.id).toBe(".marvin/security/deps-report.md");
  });

  it("flags a failing verification as verdict fail", () => {
    const kpis = computeKpis(gatesFailedFixture);
    expect(kpis.gates).toMatchObject({ verdict: "fail", done: 2, total: 4 });
  });

  it("marks an in-progress checks report as mixed and ignores non-task checks for gates", () => {
    const payload: ReportListPayload = {
      reports: [
        {
          // A refactor plan is a checks report but NOT the quality-gates source.
          ...reportsFixture.reports[4],
        },
        {
          ...gatesFailedFixture.reports[0],
          summary: { kind: "checks", done: 2, total: 6, failed: 0 },
        },
      ],
    };
    const kpis = computeKpis(payload);
    expect(kpis.gates).toMatchObject({
      reportId: ".marvin/task/verification.md",
      verdict: "mixed",
      done: 2,
      total: 6,
    });
  });

  it("degrades to zeros and nulls on an empty payload", () => {
    const kpis = computeKpis({ reports: [] });
    expect(kpis.openTotal).toBe(0);
    expect(kpis.criticalTotal).toBe(0);
    expect(kpis.criticalBreakdown).toBe("");
    expect(kpis.criticalTargetId).toBeNull();
    expect(kpis.gates).toBeNull();
    expect(kpis.staleCount).toBe(0);
    expect(kpis.oldestStale).toBeNull();
  });
});
