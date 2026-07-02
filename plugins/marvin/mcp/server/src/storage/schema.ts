import { z } from "zod";

export const TaskType = z.enum(["bug", "feature", "chore", "spike"]);
export type TaskType = z.infer<typeof TaskType>;

/**
 * Closed lifecycle roles (ADR-0026). Status keys are open, per-project data
 * (`Config.statuses`); the lifecycle commands reason about roles only. Mirrors
 * `StatusRole` in `marvin-mcp-shared/contracts` — the contract stays imported
 * type-only, so the value schema is duplicated here on purpose.
 */
export const StatusRole = z.enum(["todo", "wip", "review", "done", "blocked"]);
export type StatusRole = z.infer<typeof StatusRole>;

/** One configured board status: a local key, its lifecycle role, and (later,
 * at tracker-connection time) the exact remote workflow name. */
export const StatusDef = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase alphanumerics and hyphens"),
  role: StatusRole,
  tracker_status: z.string().min(1).optional(),
});
export type StatusDef = z.infer<typeof StatusDef>;

/**
 * Default vocabulary: five statuses whose key equals the role, so boards
 * created before ADR-0026 parse unchanged with no configuration.
 */
export const DEFAULT_STATUSES: StatusDef[] = [
  { key: "todo", role: "todo" },
  { key: "wip", role: "wip" },
  { key: "review", role: "review" },
  { key: "done", role: "done" },
  { key: "blocked", role: "blocked" },
];

/** Roles the lifecycle cannot run without; `review` and `blocked` are optional. */
const REQUIRED_ROLES: StatusRole[] = ["todo", "wip", "done"];

const Statuses = z.array(StatusDef).superRefine((statuses, ctx) => {
  const seen = new Set<string>();
  for (const s of statuses) {
    if (seen.has(s.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate status key "${s.key}"` });
    }
    seen.add(s.key);
  }
  for (const role of REQUIRED_ROLES) {
    if (!statuses.some((s) => s.role === role)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `at least one status with role "${role}" is required`,
      });
    }
  }
});

/** Title contract — ASCII only, 3..120 chars. */
export const TaskTitle = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[\x20-\x7E]+$/, "ASCII printable only");

/** External tracker ID, e.g. OSI-123. */
export const TrackerId = z.string().regex(/^[A-Z]+-\d+$/, "Expected SHORT-123 format");

export const TaskFrontmatter = z.object({
  id: z.string().regex(/^\d{3}$/),
  type: TaskType,
  /**
   * A configured status key (ADR-0026). The schema only requires a string;
   * membership in the configured set is checked by `readAllTasks`, which
   * routes unknown keys through the malformed-file channel.
   */
  status: z.string().min(1),
  title: TaskTitle,
  tracker_id: TrackerId.optional(),
  branch: z.string(),
  /**
   * PR URL captured by the `task` tool's `link-pr` action (ADR-0024/0025).
   * Stored, never live-resolved; absent until a PR is opened for the task.
   */
  pr: z.string().url().optional(),
  created: z.string().datetime(),
  updated: z.string().datetime(),
});
export type TaskFrontmatter = z.infer<typeof TaskFrontmatter>;

export interface Task {
  frontmatter: TaskFrontmatter;
  body: string;
  /** File path relative to MARVIN_TASKS_DIR. */
  filename: string;
}

/**
 * Runtime validation schema for the YAML frontmatter on a handoff artifact
 * (`.marvin/handoff/<NNN>-<slug>.md`, ADR-0024). Mirrors the `HandoffCard`
 * data contract in `marvin-mcp-shared/contracts`; the contract is imported
 * type-only by the tool so zod never bundles into `dist/server.js`. `pr_url`
 * is `.optional()` here (the writer omits the line when no PR exists) and
 * maps to the contract's nullable field when the card is built.
 */
export const HandoffFrontmatter = z.object({
  id: z.string().regex(/^\d{3}$/),
  slug: z.string().min(1),
  objective: z.string().min(1),
  branch: z.string().min(1),
  base: z.string().min(1).optional(),
  pr_url: z.string().url().optional(),
  spec_slug: z.string().min(1).optional(),
  created: z.string().datetime(),
});
export type HandoffFrontmatter = z.infer<typeof HandoffFrontmatter>;

export interface Handoff {
  frontmatter: HandoffFrontmatter;
  body: string;
  /** File path relative to the handoff dir. */
  filename: string;
}

/**
 * Per-gate command overrides for the `verify` tool, declared once per project
 * (ADR-0009). Any gate set here wins over auto-detection (config-first); gates
 * left unset fall back to stack detection. Keys match the verify gate names.
 */
export const GateCommands = z.object({
  test: z.string().min(1).optional(),
  lint: z.string().min(1).optional(),
  typecheck: z.string().min(1).optional(),
  build: z.string().min(1).optional(),
});
export type GateCommands = z.infer<typeof GateCommands>;

export const Config = z.object({
  base_branch: z.string().default("dev"),
  tracker_url_template: z.string().nullable().default(null),
  gates: GateCommands.optional(),
  /** The board's status vocabulary (ADR-0026); defaults to key == role. */
  statuses: Statuses.default(DEFAULT_STATUSES),
});
export type Config = z.infer<typeof Config>;

// ── status helpers (ADR-0026) ────────────────────────────────────────────

/** Board render order: role priority first, configuration order within a role. */
export const ROLE_ORDER: StatusRole[] = ["wip", "review", "todo", "blocked", "done"];

/** The configured statuses in render order (see ROLE_ORDER). */
export function orderedStatuses(config: Config): StatusDef[] {
  return ROLE_ORDER.flatMap((role) => config.statuses.filter((s) => s.role === role));
}

/** First configured status of a role — what the lifecycle commands target. */
export function firstOfRole(config: Config, role: StatusRole): StatusDef | null {
  return config.statuses.find((s) => s.role === role) ?? null;
}

/** `firstOfRole` for the roles the config schema guarantees (todo/wip/done). */
export function requireRole(config: Config, role: StatusRole): StatusDef {
  const status = firstOfRole(config, role);
  if (!status) throw new Error(`no status with role "${role}" is configured`);
  return status;
}

/**
 * Role of a configured status key. Callers pass keys already validated by
 * `readAllTasks`; an unknown key here is a programming error, not user input.
 */
export function roleOfStatus(config: Config, key: string): StatusRole {
  const status = config.statuses.find((s) => s.key === key);
  if (!status) throw new Error(`unknown status key "${key}"`);
  return status.role;
}

/** All configured status keys, in configuration order. */
export function statusKeys(config: Config): string[] {
  return config.statuses.map((s) => s.key);
}

/** Keys of the statuses with one of the given roles, in configuration order. */
export function keysOfRoles(config: Config, roles: StatusRole[]): string[] {
  return config.statuses.filter((s) => roles.includes(s.role)).map((s) => s.key);
}
