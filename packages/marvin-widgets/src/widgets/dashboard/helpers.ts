import type {
  DashboardAuditArea,
  DashboardState,
  Severity,
} from "@marvin-toolkit/mcp-shared/contracts";
import { BAR_TOKENS, TOKENS, type MvSeverityToken } from "../../theme";

/**
 * Pure derivations for the dashboard widget (spec dashboard-widget-rework).
 *
 * Everything the view needs that is computation rather than markup lives here,
 * so each number the panel renders is unit-testable without a DOM and the view
 * stays a renderer. The reports widget's `helpers.ts` is the precedent.
 */

// ── tones ────────────────────────────────────────────────────────────────────

/** A pill tone: a SEVERITY_TOKENS key, or the neutral dot-less tag. */
export type Tone = MvSeverityToken | "neutral";

export const ROLE_ORDER = ["todo", "wip", "review", "done", "blocked"] as const;
export type BoardRole = (typeof ROLE_ORDER)[number];

/**
 * The board role roll-up (ADR-0026) borrows the severity ramp semantically:
 * wip reads informational, review cautionary, done green, blocked red; todo
 * stays neutral.
 */
export const ROLE_TONE: Record<BoardRole, Tone> = {
  todo: "neutral",
  wip: "low",
  review: "medium",
  done: "pass",
  blocked: "fail",
};

/** Solid fill for a board segment — the bar ramp, not the text ramp. */
const ROLE_FILL: Record<BoardRole, string> = {
  todo: TOKENS.bd2,
  wip: TOKENS.blu,
  review: TOKENS.amb,
  done: TOKENS.grn,
  blocked: TOKENS.red,
};

// ── ages ─────────────────────────────────────────────────────────────────────

/** Human-friendly file/report age: null → "none", 0 → "today", n → "Nd ago". */
export function formatAge(days: number | null): string {
  if (days === null) return "none";
  if (days === 0) return "today";
  return `${days}d ago`;
}

/** `[key, n]` for the non-zero entries of a counts record, in key order. */
export function nonZeroEntries(counts: Record<string, number>): Array<[string, number]> {
  return Object.entries(counts).filter(([, n]) => n > 0);
}

/** `2026-06-01 → 2026-07-07`, or "—" when the log is empty. */
export function usageWindowLabel(window: { from: string; to: string } | null): string {
  return window ? `${window.from.slice(0, 10)} → ${window.to.slice(0, 10)}` : "—";
}

// ── board distribution bar ───────────────────────────────────────────────────

export interface BoardSegment {
  key: string;
  role: BoardRole;
  count: number;
  /** Flex basis for the bar; proportional to `count`. */
  flex: number;
  /** Solid fill token reference for the bar segment and its legend swatch. */
  fill: string;
}

/**
 * Board segments in the CONFIGURED status order (ADR-0026 — the project owns
 * its vocabulary, so neither this function nor the view may re-sort by count).
 * Only statuses with a live count appear: a zero-count segment would render as
 * a min-width sliver that reads like real work.
 */
export function boardSegments(
  counts: DashboardState["board_counts"],
  statuses: DashboardState["config"]["statuses"],
): BoardSegment[] {
  const segments: BoardSegment[] = [];
  for (const status of statuses) {
    const count = counts[status.key] ?? 0;
    if (count <= 0) continue;
    const role = status.role as BoardRole;
    segments.push({
      key: status.key,
      role,
      count,
      flex: count,
      fill: ROLE_FILL[role] ?? TOKENS.bd2,
    });
  }
  return segments;
}

/** Total cards on the board, over every configured status. */
export function boardTotal(counts: DashboardState["board_counts"]): number {
  return Object.values(counts).reduce((n, c) => n + c, 0);
}

// ── audit severity spark-bar ─────────────────────────────────────────────────

/**
 * Severity rank, most severe first. The SAME order `auditDigest` uses server
 * side. Bucketing walks THIS array rather than the payload's key order, so a
 * report that happens to list its findings out of rank order still renders
 * ranked — `by_severity` is a plain record and preserves insertion order, so
 * iterating it directly would leak document order into the bar.
 */
export const SEVERITY_RANK: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

export interface SeveritySegment {
  severity: Severity;
  count: number;
  flex: number;
  fill: string;
}

/**
 * `info` has no BAR_TOKENS entry — the ramp is defined for the four ranked
 * severities only — so it renders on the tertiary TEXT token. It is NOT
 * dropped: the payload counts it toward `total`, and a bar whose segments do
 * not sum to the stated total misreports the area.
 *
 * `t3` rather than the border token `bd2`: the bar track is `srf2`, against
 * which `bd2` sits at roughly 1.06:1 and is invisible. An invisible band does
 * not make the bar sum any better than a dropped one — it just hides the
 * discrepancy instead of showing it.
 */
const severityFill = (severity: Severity): string =>
  severity === "info" ? TOKENS.t3 : BAR_TOKENS[severity];

/**
 * Present severities only, ranked critical-first, whatever order the payload
 * lists them in. `by_severity` is a partial record by design (ADR-0024): only
 * severities actually found appear, and it must not be padded to all five.
 */
export function severitySegments(bySeverity: DashboardAuditArea["by_severity"]): SeveritySegment[] {
  const segments: SeveritySegment[] = [];
  for (const severity of SEVERITY_RANK) {
    const count = bySeverity[severity] ?? 0;
    if (count <= 0) continue;
    segments.push({ severity, count, flex: count, fill: severityFill(severity) });
  }
  return segments;
}

// ── audit area state ─────────────────────────────────────────────────────────

/**
 * The three states an audit area can be in. The distinction that matters is
 * `never-scanned` versus `clean`: a null area means no report exists, while
 * `total: 0` means a report ran and found nothing. Collapsing them makes a
 * never-scanned project read as a clean bill of health, which is the single
 * most misleading thing this widget could say.
 */
export type AuditAreaState =
  | { kind: "never-scanned" }
  | { kind: "clean"; area: DashboardAuditArea }
  | { kind: "findings"; area: DashboardAuditArea; segments: SeveritySegment[] };

export function auditAreaState(area: DashboardAuditArea | null): AuditAreaState {
  if (area === null) return { kind: "never-scanned" };
  if (area.total <= 0) return { kind: "clean", area };
  return { kind: "findings", area, segments: severitySegments(area.by_severity) };
}

// ── affordance → command mapping ─────────────────────────────────────────────

/**
 * Every control in the widget that issues a marvin command, keyed by a stable
 * affordance id.
 *
 * **Keyed by affordance, NOT by command.** Two ids carry `/marvin:reports`
 * (`nav-reports` and `audit-open-report`) and three CONTROLS do, since
 * `audit-open-report` renders once per audit area. Keying by command would
 * collapse them into one entry, and a dead control would hide behind a live one
 * carrying the same string.
 *
 * **Values are command PREFIXES, not finished strings.** Row affordances append
 * their own row's identifier — `row-board` a card id, `row-spec` a slug — so the
 * invariant part is what belongs in the map and {@link commandFor} completes it.
 *
 * AC9's test ITERATES this map, so it must stay an exported value: an entry
 * added without a rendered control fails that test.
 */
export const AFFORDANCE_COMMANDS = {
  "nav-dashboard": "/marvin:dashboard",
  "nav-tasks": "/marvin:track-list",
  "nav-reports": "/marvin:reports",
  "nav-settings": "/marvin:track-config",
  "new-task": "/marvin:track-new",
  "row-board": "/marvin:track-show",
  "row-spec": "/marvin:task-summary",
  "new-handoff": "/marvin:handoff",
  "row-handoff": "/marvin:handoff-list",
  "run-audit": "/marvin:sec-scan",
  "audit-open-report": "/marvin:reports",
} as const satisfies Record<string, string>;

export type AffordanceId = keyof typeof AFFORDANCE_COMMANDS;

/** The full command for an affordance, with a row identifier when it takes one. */
export function commandFor(id: AffordanceId, arg?: string): string {
  const prefix = AFFORDANCE_COMMANDS[id];
  const trimmed = arg?.trim();
  return trimmed ? `${prefix} ${trimmed}` : prefix;
}
