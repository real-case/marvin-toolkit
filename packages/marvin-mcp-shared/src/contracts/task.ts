import { z } from "zod";

/**
 * Kanban-task data contract (ADR-0024) — feeds the task-list (#1), task-detail
 * (#2) and tracker-link-out (#6) widgets, and the text fallback of the kanban
 * `task` tool. The vocabulary mirrors the server's `storage/schema.ts`
 * (`TaskType` / `StatusRole` / `TrackerId`); Stage-1 reconciliation will make
 * `schema.ts` import these so there is a single source of truth.
 *
 * Statuses are per-project configuration (ADR-0026): a card carries the
 * configured status `key` (open string) plus its closed lifecycle `role`, so a
 * widget can render any tracker vocabulary while still reasoning about the
 * lifecycle. Counts are an open per-key record with a closed per-role roll-up.
 */
export const TaskType = z.enum(["bug", "feature", "chore", "spike"]);
export type TaskType = z.infer<typeof TaskType>;

/** Closed lifecycle roles (ADR-0026); the open status keys map onto these. */
export const StatusRole = z.enum(["todo", "wip", "review", "done", "blocked"]);
export type StatusRole = z.infer<typeof StatusRole>;

/** A task's status: the configured key plus its lifecycle role. */
export const TaskStatusRef = z.object({
  key: z.string().min(1),
  role: StatusRole,
});
export type TaskStatusRef = z.infer<typeof TaskStatusRef>;

/** External tracker id, e.g. `OSI-123`. */
export const TrackerId = z.string().regex(/^[A-Z]+-\d+$/, "expected SHORT-123 format");

export const PrState = z.enum(["open", "merged", "closed"]);
export type PrState = z.infer<typeof PrState>;

export const PrRef = z.object({
  url: z.string().url(),
  number: z.number().int().positive().optional(),
  state: PrState.optional(),
});
export type PrRef = z.infer<typeof PrRef>;

export const TaskCard = z.object({
  id: z.string().regex(/^\d{3}$/, "zero-padded 3-digit id"),
  type: TaskType,
  status: TaskStatusRef,
  title: z.string().min(1),
  branch: z.string(),
  tracker_id: TrackerId.optional(),
  /** Derived from `tracker_id` + config template; `null` when unconfigured. */
  tracker_url: z.string().url().nullable(),
  /** Stored field written by the `task` tool's `link-pr` action (ADR-0025).
   *  `null` when no PR exists yet; never live-resolved. */
  pr: PrRef.nullable(),
  /** Slug of the pipeline spec backing this task, when one exists. */
  spec_slug: z.string().optional(),
  created: z.string().datetime(),
  updated: z.string().datetime(),
});
export type TaskCard = z.infer<typeof TaskCard>;

/** Task-detail (#2) — a card plus the rendered task body for `<Markdown>`. */
export const TaskDetail = TaskCard.extend({
  body_markdown: z.string(),
});
export type TaskDetail = z.infer<typeof TaskDetail>;

/** Task-list (#1) payload — cards plus board-header counts (ADR-0026): per
 * configured status key (open record, every configured key present) and the
 * roll-up by lifecycle role. */
export const TaskListPayload = z.object({
  tasks: z.array(TaskCard),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  role_counts: z.record(StatusRole, z.number().int().nonnegative()),
});
export type TaskListPayload = z.infer<typeof TaskListPayload>;
