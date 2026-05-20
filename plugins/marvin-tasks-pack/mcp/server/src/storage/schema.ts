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

export const Config = z.object({
  base_branch: z.string().default("dev"),
  tracker_url_template: z.string().nullable().default(null),
});
export type Config = z.infer<typeof Config>;
