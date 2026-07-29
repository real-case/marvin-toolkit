import { describe, it, expect } from "vitest";
import {
  AFFORDANCE_COMMANDS,
  SEVERITY_RANK,
  auditAreaState,
  boardSegments,
  boardTotal,
  commandFor,
  formatAge,
  nonZeroEntries,
  severitySegments,
  usageWindowLabel,
} from "./helpers";
import { TOKENS } from "../../theme";

/**
 * Dashboard helper tests (spec dashboard-widget-rework, AC3).
 *
 * Each input here is built so a WRONG reading produces a different value, not
 * merely so the right one passes. Spec 018 shipped two rules green whose tests
 * would have passed identically under the opposite implementation — the
 * fixtures happened to be ordered the way the correct rule sorts them. The
 * inputs below are deliberately hostile to that.
 */

describe("severitySegments — ranked, not document order", () => {
  it("orders critical-first even when the payload lists severities out of rank order", () => {
    // `by_severity` is a plain record, so it PRESERVES insertion order. Listing
    // low first means an implementation that iterates Object.entries directly
    // renders low → critical → medium and fails this assertion. A payload that
    // happened to be in rank order would pass under both readings and prove
    // nothing — which is exactly the gap this input closes.
    const segments = severitySegments({ low: 4, critical: 1, medium: 6, high: 3 });

    expect(segments.map((s) => s.severity)).toEqual(["critical", "high", "medium", "low"]);
    expect(segments.map((s) => s.count)).toEqual([1, 3, 6, 4]);
    // flex is proportional to count, so the widest band is the most numerous
    expect(segments.map((s) => s.flex)).toEqual([1, 3, 6, 4]);
  });

  it("renders present severities only and never pads the partial record", () => {
    const segments = severitySegments({ critical: 1 });

    expect(segments).toHaveLength(1);
    expect(segments[0]!.severity).toBe("critical");
    // padding to all five would put four zero-width bands in the bar and four
    // "0" rows in the legend for a report that found one thing
    expect(segments.map((s) => s.severity)).not.toContain("low");
  });

  it("keeps info in the bar rather than dropping it", () => {
    // info has no BAR_TOKENS entry, so the tempting shortcut is to skip it —
    // but the payload counts it toward `total`, and a bar whose segments do not
    // sum to the stated total misreports the area.
    const segments = severitySegments({ info: 2, high: 1 });

    expect(segments.map((s) => s.severity)).toEqual(["high", "info"]);
    expect(segments.reduce((n, s) => n + s.count, 0)).toBe(3);
    // Pin the actual token, not merely "some non-empty string": `bd2` sits at
    // roughly 1.06:1 against the bar track and is invisible, so a regression to
    // it would pass a `.length > 0` check while hiding the band entirely.
    const info = segments.find((s) => s.severity === "info")!;
    expect(info.fill).toBe(TOKENS.t3);
    expect(info.fill).not.toBe(TOKENS.bd2);
  });

  it("an empty record yields no segments", () => {
    expect(severitySegments({})).toEqual([]);
  });

  it("SEVERITY_RANK matches the server's bucketing order", () => {
    expect([...SEVERITY_RANK]).toEqual(["critical", "high", "medium", "low", "info"]);
  });
});

describe("auditAreaState — never-scanned is not clean", () => {
  const clean = { scanned_age_days: 0, total: 0, by_severity: {}, newest_report: "001-scan.md" };

  it("distinguishes a null area from an area scanned clean", () => {
    // The two states share every renderable number (no findings, no severities).
    // Only the discriminant separates them, so a helper that returned the same
    // tag for both would pass any assertion made on counts alone.
    expect(auditAreaState(null)).toEqual({ kind: "never-scanned" });
    expect(auditAreaState(clean).kind).toBe("clean");
    expect(auditAreaState(null).kind).not.toBe(auditAreaState(clean).kind);
  });

  it("a scanned-clean area still carries its report name and age", () => {
    const state = auditAreaState(clean);
    expect(state.kind).toBe("clean");
    if (state.kind !== "clean") throw new Error("unreachable");
    expect(state.area.newest_report).toBe("001-scan.md");
    expect(state.area.scanned_age_days).toBe(0);
  });

  it("an area with findings carries ranked segments", () => {
    const state = auditAreaState({
      scanned_age_days: 5,
      total: 14,
      by_severity: { medium: 6, critical: 1, low: 4, high: 3 },
    });
    expect(state.kind).toBe("findings");
    if (state.kind !== "findings") throw new Error("unreachable");
    expect(state.segments.map((s) => s.severity)).toEqual(["critical", "high", "medium", "low"]);
    expect(state.area.total).toBe(14);
  });
});

describe("boardSegments — configured order, live statuses only", () => {
  const statuses = [
    { key: "backlog", role: "todo" as const },
    { key: "in-progress", role: "wip" as const },
    { key: "code-review", role: "review" as const },
    { key: "done", role: "done" as const },
    { key: "blocked", role: "blocked" as const },
  ];

  it("follows the configured status order, not the count order", () => {
    // `done` is the largest and `backlog` is declared first. An implementation
    // that sorted by count descending would put done first and fail here, while
    // a fixture whose declaration order already matched its count order would
    // pass under both readings.
    const segments = boardSegments(
      { done: 7, backlog: 4, "in-progress": 2, "code-review": 1, blocked: 1 },
      statuses,
    );

    expect(segments.map((s) => s.key)).toEqual([
      "backlog",
      "in-progress",
      "code-review",
      "done",
      "blocked",
    ]);
    expect(segments.map((s) => s.count)).toEqual([4, 2, 1, 7, 1]);
  });

  it("omits zero-count statuses from the bar", () => {
    const segments = boardSegments({ backlog: 3, "in-progress": 0, done: 0 }, statuses);
    expect(segments.map((s) => s.key)).toEqual(["backlog"]);
  });

  it("a status missing from the counts record counts as zero, not NaN", () => {
    const segments = boardSegments({ backlog: 2 }, statuses);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.flex).toBe(2);
  });

  it("gives each role a distinct bar fill", () => {
    const segments = boardSegments(
      { backlog: 1, "in-progress": 1, "code-review": 1, done: 1, blocked: 1 },
      statuses,
    );
    expect(new Set(segments.map((s) => s.fill)).size).toBe(5);
  });

  it("boardTotal sums every status, including ones absent from the bar", () => {
    expect(boardTotal({ backlog: 4, "in-progress": 2, done: 0 })).toBe(6);
    expect(boardTotal({})).toBe(0);
  });
});

describe("affordance → command mapping", () => {
  it("has eleven entries carrying ten distinct commands", () => {
    const ids = Object.keys(AFFORDANCE_COMMANDS);
    expect(ids).toHaveLength(11);
    // the duplication is deliberate and is WHY the map is keyed by affordance:
    // nav-reports and audit-open-report both open the reports view
    expect(new Set(Object.values(AFFORDANCE_COMMANDS)).size).toBe(10);
    expect(AFFORDANCE_COMMANDS["nav-reports"]).toBe(AFFORDANCE_COMMANDS["audit-open-report"]);
  });

  it("every command is a /marvin: prefix with no arguments baked in", () => {
    for (const [id, command] of Object.entries(AFFORDANCE_COMMANDS)) {
      expect(command, id).toMatch(/^\/marvin:[a-z-]+$/);
    }
  });

  it("commandFor appends a row identifier when one is given", () => {
    expect(commandFor("row-board", "001")).toBe("/marvin:track-show 001");
    expect(commandFor("row-spec", "dashboard-widget-rework")).toBe(
      "/marvin:task-summary dashboard-widget-rework",
    );
    // a bare affordance keeps the prefix exactly
    expect(commandFor("nav-tasks")).toBe("/marvin:track-list");
    // whitespace-only and undefined are the same "no argument" case
    expect(commandFor("row-board", "   ")).toBe("/marvin:track-show");
    expect(commandFor("run-audit", undefined)).toBe("/marvin:sec-scan");
  });
});

describe("small formatters", () => {
  it("formatAge distinguishes never, today and N days", () => {
    expect(formatAge(null)).toBe("none");
    expect(formatAge(0)).toBe("today");
    expect(formatAge(1)).toBe("1d ago");
    expect(formatAge(12)).toBe("12d ago");
  });

  it("nonZeroEntries drops zeros and keeps key order", () => {
    expect(nonZeroEntries({ accepted: 24, proposed: 0, superseded: 3 })).toEqual([
      ["accepted", 24],
      ["superseded", 3],
    ]);
    expect(nonZeroEntries({})).toEqual([]);
  });

  it("usageWindowLabel trims to dates and handles an empty log", () => {
    expect(
      usageWindowLabel({ from: "2026-06-01T09:00:00.000Z", to: "2026-07-07T18:30:00.000Z" }),
    ).toBe("2026-06-01 → 2026-07-07");
    expect(usageWindowLabel(null)).toBe("—");
  });
});
