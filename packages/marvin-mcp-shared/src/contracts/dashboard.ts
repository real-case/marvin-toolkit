import { z } from "zod";
import { StatusRole } from "./task.js";
import { AdrStatus } from "./adr.js";
import { LessonsStats } from "./lessons.js";

/**
 * Marvin infrastructure dashboard contract (ADR-0024 → ADR-0030) — feeds the
 * dashboard widget (#8). The base shape is what the `help` tool computes
 * (project paths, config, board counts, git availability, flat artifact
 * counts); the `dashboard` tool extends it with the whole-toolbox sections —
 * ADR corpus by status, security/refactor report inventories with ages,
 * lessons statistics, and the usage-log summary. Every extension is an
 * OPTIONAL field, so the `help` tool's narrower payload keeps conforming
 * (ADR-0030: the extension is not a schema break).
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

/** Security-report inventory under `.marvin/security/` (ADR-0030). */
export const SecurityInventory = z.object({
  reports: z.number().int().nonnegative(),
  /** Whole days since the newest report; null when no report exists. */
  newest_age_days: z.number().int().nonnegative().nullable(),
});
export type SecurityInventory = z.infer<typeof SecurityInventory>;

/**
 * Refactor inventory under `.marvin/refactor/`, counted by kind from the
 * ADR-0029 naming convention (`NNN-audit-*` / `NNN-smells-*` / `NNN-plan-*`).
 */
export const RefactorInventory = z.object({
  audits: z.number().int().nonnegative(),
  smells: z.number().int().nonnegative(),
  plans: z.number().int().nonnegative(),
});
export type RefactorInventory = z.infer<typeof RefactorInventory>;

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
  security: SecurityInventory.optional(),
  refactor: RefactorInventory.optional(),
  /** Lessons-store statistics (the shared `LessonsStats`, ADR-0028). */
  lessons: LessonsStats.optional(),
  usage: UsageSummary.optional(),
});
export type DashboardState = z.infer<typeof DashboardState>;
