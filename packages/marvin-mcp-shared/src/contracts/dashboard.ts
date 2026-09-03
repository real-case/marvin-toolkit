import { z } from "zod";
import { StatusRole, TaskCard } from "./task.js";
import { AdrStatus } from "./adr.js";
import { LessonsStats } from "./lessons.js";
import { HelpServer } from "./help.js";
import { Severity } from "./audit.js";
import { MetricsSummary } from "./metrics.js";

/**
 * Marvin infrastructure dashboard contract (ADR-0024 → ADR-0030) — feeds the
 * dashboard widget (#8). The base shape is what the `help` tool computes
 * (project paths, config, board counts, git availability, flat artifact
 * counts); the `dashboard` tool extends it with the whole-toolbox sections —
 * ADR corpus by status, lessons statistics, the usage-log summary, and the v2
 * block below (servers, current work, handoffs, audit findings by severity).
 * Every extension is an OPTIONAL field, so the `help` tool's narrower payload
 * keeps conforming (ADR-0030: the extension is not a schema break).
 *
 * The v1 `SecurityInventory` / `RefactorInventory` blocks were REMOVED with the
 * dashboard widget rework: `DashboardAudits` supersedes them with findings and
 * freshness per area, and `artifacts.audits` still carries the security
 * document count. The refactor register counts by kind have no v2 equivalent
 * and were dropped deliberately, not relocated.
 *
 * Board counts follow ADR-0026: an open per-status-key record plus a closed
 * per-role roll-up, with the configured status set exposed under `config` so a
 * widget can label and order the keys.
 */
export const GateCommands = z.object({
  test: z.string().min(1).optional(),
  lint: z.string().min(1).optional(),
  typecheck: z.string().min(1).optional(),
  build: z.string().min(1).optional(),
});
export type GateCommands = z.infer<typeof GateCommands>;

/** One configured board status (mirrors the server's `StatusDef`, ADR-0026). */
export const StatusDef = z.object({
  key: z.string().min(1),
  role: StatusRole,
  /** Exact remote workflow name; filled at tracker-connection time. */
  tracker_status: z.string().optional(),
});
export type StatusDef = z.infer<typeof StatusDef>;

/** `verification.md` freshness (ADR-0030) — the task pipeline's gate artifact. */
export const VerificationFreshness = z.object({
  exists: z.boolean(),
  /** Whole days since the last write; null when the file does not exist. */
  age_days: z.number().int().nonnegative().nullable(),
});
export type VerificationFreshness = z.infer<typeof VerificationFreshness>;

/**
 * ADR corpus roll-up (ADR-0027 → ADR-0030): per-status counts over the closed
 * vocabulary, present even at 0 (the ADR-0026 per-key counts doctrine).
 */
export const AdrCorpusSummary = z.object({
  /** Resolved corpus directory, project-root-relative. */
  dir: z.string().min(1),
  total: z.number().int().nonnegative(),
  counts: z.record(AdrStatus, z.number().int().nonnegative()),
  /** Files the tolerant parser could not read (surfaced, never dropped). */
  malformed: z.number().int().nonnegative(),
});
export type AdrCorpusSummary = z.infer<typeof AdrCorpusSummary>;

/** One aggregated usage-log entry: a prompt or tool and its invocation count. */
export const UsageTopEntry = z.object({
  kind: z.enum(["prompt", "tool"]),
  name: z.string().min(1),
  count: z.number().int().positive(),
});
export type UsageTopEntry = z.infer<typeof UsageTopEntry>;

/**
 * Usage-log summary (ADR-0030). The `.marvin/usage/events.jsonl` writer ships
 * with WP7; until then the section is simply absent from the dashboard payload.
 */
export const UsageSummary = z.object({
  /** Well-formed events read from the log (malformed lines are skipped). */
  events: z.number().int().nonnegative(),
  /** ISO timestamps of the first and last events; null while the log is empty. */
  window: z.object({ from: z.string(), to: z.string() }).nullable(),
  /** Most-invoked prompts/tools, descending. */
  top: z.array(UsageTopEntry),
});
export type UsageSummary = z.infer<typeof UsageSummary>;

// ── DashboardState v2 (ADR-0024 data-first staging) ─────────────────────────
// Additive sections for the reworked dashboard: the configured MCP servers, a
// current-work digest (active board cards + pipeline specs), recent handoffs,
// and audit findings by severity per area. Every field they add to
// DashboardState below is OPTIONAL, so a v1-narrow producer (the `help` tool)
// keeps conforming (ADR-0030). The sibling dashboard-tool / dashboard-widget
// slices consume them; this slice is data-only.

/**
 * One pipeline spec under `.marvin/task/`, as a dashboard digest row. `id` is
 * the numeric filename prefix (`NNN`) when the spec carries one.
 */
export const DashboardSpec = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  id: z.string().optional(),
});
export type DashboardSpec = z.infer<typeof DashboardSpec>;

/**
 * One recent handoff under `.marvin/handoff/`, slimmed for the dashboard.
 * Unlike the full `HandoffCard` (which carries a `created` datetime), this
 * preview carries a server-computed `age_days` — the deterministic "Nd ago"
 * the rest of `DashboardState` uses — so snapshots and tests stay stable.
 */
export const DashboardHandoff = z.object({
  slug: z.string().min(1),
  objective: z.string().min(1),
  /** Whole days since the handoff was written; null when the age is unknown. */
  age_days: z.number().int().nonnegative().nullable(),
});
export type DashboardHandoff = z.infer<typeof DashboardHandoff>;

/**
 * Audit findings for one area (`.marvin/security/` or `.marvin/refactor/`),
 * counted by severity. `by_severity` is keyed on the closed `Severity`
 * vocabulary, so a non-Severity key fails validation.
 */
export const DashboardAuditArea = z.object({
  /** Whole days since the newest report in the area; null when none exists. */
  scanned_age_days: z.number().int().nonnegative().nullable(),
  total: z.number().int().nonnegative(),
  by_severity: z.record(Severity, z.number().int().nonnegative()),
  /** Filename of the newest report in the area, when one exists. */
  newest_report: z.string().min(1).optional(),
});
export type DashboardAuditArea = z.infer<typeof DashboardAuditArea>;

/**
 * The two audit areas the dashboard surfaces; each is null when its working
 * directory holds no report.
 */
export const DashboardAudits = z.object({
  security: DashboardAuditArea.nullable(),
  refactor: DashboardAuditArea.nullable(),
});
export type DashboardAudits = z.infer<typeof DashboardAudits>;

export const DashboardState = z.object({
  version: z.string(),
  paths: z.object({
    project: z.string(),
    tasks_dir: z.string(),
    config_path: z.string(),
  }),
  config: z.object({
    base_branch: z.string(),
    tracker_url_template: z.string().nullable(),
    gates: GateCommands.optional(),
    statuses: z.array(StatusDef),
  }),
  board_counts: z.record(z.string(), z.number().int().nonnegative()),
  board_role_counts: z.record(StatusRole, z.number().int().nonnegative()),
  git: z.object({
    has_git: z.boolean(),
    has_gh: z.boolean(),
    branch: z.string().nullable(),
  }),
  artifacts: z.object({
    specs: z.number().int().nonnegative(),
    handoffs: z.number().int().nonnegative(),
    audits: z.number().int().nonnegative(),
    lessons: z.number().int().nonnegative(),
    /** ADR-0030 extension — emitted by the `dashboard` tool. */
    verification: VerificationFreshness.optional(),
  }),
  command_groups: z.array(z.object({ group: z.string(), count: z.number().int().nonnegative() })),
  // ── whole-toolbox sections (ADR-0030) — optional so the `help` tool's
  // narrower payload keeps conforming; the `dashboard` tool emits them all.
  adr: AdrCorpusSummary.optional(),
  /** Lessons-store statistics (the shared `LessonsStats`, ADR-0028). */
  lessons: LessonsStats.optional(),
  usage: UsageSummary.optional(),
  // ── v2 sections (ADR-0024 data-first staging) — optional, so a v1-narrow
  // producer keeps conforming (ADR-0030); the reworked `dashboard` tool emits them.
  /** Configured MCP servers with their enabled state (reused `HelpServer`). */
  servers: z.array(HelpServer).optional(),
  /** Current-work digest: active board cards (full `TaskCard`s) + pipeline specs. */
  current_tasks: z.object({ board: z.array(TaskCard), specs: z.array(DashboardSpec) }).optional(),
  /** Recent session-continuation handoffs, newest first. */
  handoffs: z.array(DashboardHandoff).optional(),
  /** Audit findings by severity per area (security / refactor). */
  audits: DashboardAudits.optional(),
  /**
   * The task-metrics series in one line (ADR-0043 §5): record and roll-up
   * counts, the newest record, the median active time and spec gaps per task.
   * Optional and additive — the widget and the site's embeds are untouched
   * until a later pass renders it.
   */
  metrics: MetricsSummary.optional(),
});
export type DashboardState = z.infer<typeof DashboardState>;
