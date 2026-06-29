import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TaskFrontmatter, type Task, type TaskStatus, type TaskType } from "./schema.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { buildFilename, parseSeq, slugify } from "./slug.js";

export interface MalformedTask {
  filename: string;
  reason: string;
}

export interface ReadTasksResult {
  tasks: Task[];
  malformed: MalformedTask[];
}

/**
 * Read every task file in the tasks directory. Files with broken
 * frontmatter are collected separately, so the rest of the surface can
 * keep working even when one file is in a bad state.
 */
export function readAllTasks(tasksDir: string): ReadTasksResult {
  if (!existsSync(tasksDir)) return { tasks: [], malformed: [] };

  const tasks: Task[] = [];
  const malformed: MalformedTask[] = [];

  for (const filename of readdirSync(tasksDir).sort()) {
    if (!filename.endsWith(".md")) continue;
    const seq = parseSeq(filename);
    if (!seq) continue;

    const raw = readFileSync(join(tasksDir, filename), "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const parsed = TaskFrontmatter.safeParse(frontmatter);
    if (!parsed.success) {
      malformed.push({ filename, reason: parsed.error.issues.map((i) => i.message).join("; ") });
      continue;
    }
    if (parsed.data.id !== seq) {
      // Frontmatter id and filename seq disagree — filename wins, but we
      // surface the mismatch so the user can clean it up.
      malformed.push({
        filename,
        reason: `frontmatter id=${parsed.data.id} does not match filename seq=${seq}`,
      });
      continue;
    }
    tasks.push({ frontmatter: parsed.data, body, filename });
  }

  tasks.sort((a, b) => Number(b.frontmatter.id) - Number(a.frontmatter.id));
  return { tasks, malformed };
}

/**
 * Allocate the next sequential id by scanning existing filenames.
 * Returns a zero-padded 3-digit string.
 */
export function nextSeq(tasks: Task[]): string {
  let max = 0;
  for (const t of tasks) {
    const n = Number(t.frontmatter.id);
    if (n > max) max = n;
  }
  return String(max + 1).padStart(3, "0");
}

export interface NewTaskInput {
  type: TaskType;
  title: string;
  tracker_id?: string;
  description?: string;
}

export interface CreatedTask {
  task: Task;
  path: string;
}

/**
 * Create a new task file. Returns the persisted task with its absolute path.
 */
export function createTask(tasksDir: string, input: NewTaskInput): CreatedTask {
  mkdirSync(tasksDir, { recursive: true });
  const { tasks } = readAllTasks(tasksDir);
  const id = nextSeq(tasks);
  const slug = slugify(input.title);
  const filename = buildFilename(id, input.tracker_id, slug);
  const branch = filename.replace(/\.md$/, "");
  const now = new Date().toISOString();

  const frontmatter: Record<string, string | undefined> = {
    id,
    type: input.type,
    status: "todo",
    title: input.title,
    tracker_id: input.tracker_id,
    branch,
    created: now,
    updated: now,
  };

  const body = input.description ? `\n${input.description}\n` : "\n";
  const text = stringifyFrontmatter(frontmatter, body);
  const path = join(tasksDir, filename);
  writeFileSync(path, text);

  const parsed = TaskFrontmatter.parse({
    id,
    type: input.type,
    status: "todo",
    title: input.title,
    ...(input.tracker_id ? { tracker_id: input.tracker_id } : {}),
    branch,
    created: now,
    updated: now,
  });
  return { task: { frontmatter: parsed, body, filename }, path };
}

/**
 * Persist a status change for a task. Rewrites the file atomically.
 */
export function updateStatus(tasksDir: string, task: Task, newStatus: TaskStatus): Task {
  const updated = new Date().toISOString();
  const next: TaskFrontmatter = {
    ...task.frontmatter,
    status: newStatus,
    updated,
  };
  writeTask(tasksDir, { ...task, frontmatter: next });
  return { ...task, frontmatter: next };
}

/**
 * Persist the PR URL captured at `gh pr create` onto a task's frontmatter
 * (ADR-0024). The URL is stored verbatim, never live-resolved; bumps `updated`.
 */
export function setTaskPr(tasksDir: string, task: Task, prUrl: string): Task {
  const updated = new Date().toISOString();
  const next: TaskFrontmatter = {
    ...task.frontmatter,
    pr: prUrl,
    updated,
  };
  writeTask(tasksDir, { ...task, frontmatter: next });
  return { ...task, frontmatter: next };
}

function writeTask(tasksDir: string, task: Task): void {
  const fm: Record<string, string | undefined> = {
    id: task.frontmatter.id,
    type: task.frontmatter.type,
    status: task.frontmatter.status,
    title: task.frontmatter.title,
    tracker_id: task.frontmatter.tracker_id,
    branch: task.frontmatter.branch,
    pr: task.frontmatter.pr,
    created: task.frontmatter.created,
    updated: task.frontmatter.updated,
  };
  writeFileSync(join(tasksDir, task.filename), stringifyFrontmatter(fm, task.body));
}

export function findTaskByBranch(tasks: Task[], branch: string): Task | null {
  return tasks.find((t) => t.frontmatter.branch === branch) ?? null;
}

export function findTaskById(tasks: Task[], id: string): Task | null {
  return tasks.find((t) => t.frontmatter.id === id) ?? null;
}
