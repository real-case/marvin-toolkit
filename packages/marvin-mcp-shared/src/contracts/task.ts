import { z } from "zod";

/**
 * Kanban-task data contract (ADR-0024) — feeds the task-list (#1), task-detail
 * (#2) and tracker-link-out (#6) widgets, and the text fallback of the kanban
 * `task` tool. The vocabulary mirrors the server's `storage/schema.ts`
 * (`TaskType` / `TaskStatus` / `TrackerId`); Stage-1 reconciliation will make
 * `schema.ts` import these so there is a single source of truth.
 *
 * Two fields are NOT yet stored on the kanban frontmatter and are the data work
 * this contract gates:
 *  - `pr` — written by the `git` tool at `gh pr create` time (today the returned
 *    URL is dropped). Stored in the artifact, never live-resolved via `gh pr view`.
 *  - `tracker_url` — derived from `tracker_id` + the config `tracker_url_template`
 *    (the existing `trackerUrl()` builder), not a stored field.
 */
export const TaskType = z.enum(["bug", "feature", "chore", "spike"]);
export type TaskType = z.infer<typeof TaskType>;

export const TaskStatus = z.enum(["todo", "wip", "review", "done", "blocked"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

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
  status: TaskStatus,
  title: z.string().min(1),
  branch: z.string(),
  tracker_id: TrackerId.optional(),
  /** Derived from `tracker_id` + config template; `null` when unconfigured. */
  tracker_url: z.string().url().nullable(),
  /** NEW stored field — see file header. `null` when no PR exists yet. */
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

/** Task-list (#1) payload — cards plus per-status counts for the board header. */
export const TaskListPayload = z.object({
  tasks: z.array(TaskCard),
  counts: z.record(TaskStatus, z.number().int().nonnegative()),
});
export type TaskListPayload = z.infer<typeof TaskListPayload>;
