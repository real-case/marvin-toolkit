import { z } from "zod";
import { StatusRole } from "./task.js";

/**
 * Marvin infrastructure dashboard contract (ADR-0024) — feeds the dashboard
 * widget (#8). Everything here is already computed by the `help` tool today
 * (project paths, config, kanban counts, git availability); Stage-1 work is to
 * emit it as `structuredContent` rather than only rendering it to text.
 *
 * Kanban counts follow ADR-0026: an open per-status-key record plus a closed
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
  kanban_counts: z.record(z.string(), z.number().int().nonnegative()),
  kanban_role_counts: z.record(StatusRole, z.number().int().nonnegative()),
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
  }),
  command_groups: z.array(z.object({ group: z.string(), count: z.number().int().nonnegative() })),
});
export type DashboardState = z.infer<typeof DashboardState>;
