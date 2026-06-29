import { z } from "zod";

export const TaskType = z.enum(["bug", "feature", "chore", "spike"]);
export type TaskType = z.infer<typeof TaskType>;

export const TaskStatus = z.enum(["todo", "wip", "review", "done", "blocked"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

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
  status: TaskStatus,
  title: TaskTitle,
  tracker_id: TrackerId.optional(),
  branch: z.string(),
  /**
   * PR URL captured at `gh pr create` time (ADR-0024). Stored, never
   * live-resolved; absent until a PR is opened for the task.
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
});
export type Config = z.infer<typeof Config>;
