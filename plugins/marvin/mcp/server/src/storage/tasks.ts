import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import {
  TaskFrontmatter,
  requireRole,
  statusKeys,
  type Config,
  type Task,
  type TaskType,
} from "./schema.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { buildBranch, buildFilename, parseSeq, renderBranchTemplate, slugify } from "./slug.js";

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
 * keep working even when one file is in a bad state. Status keys are
 * validated against the configured set (ADR-0026) — an unknown status is
 * surfaced through the same malformed channel, never silently dropped.
 */
export function readAllTasks(tasksDir: string, config: Config): ReadTasksResult {
  if (!existsSync(tasksDir)) return { tasks: [], malformed: [] };

  const keys = statusKeys(config);
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
    if (!keys.includes(parsed.data.status)) {
      malformed.push({
        filename,
        reason: `unknown status "${parsed.data.status}" — configured statuses: ${keys.join(", ")}`,
      });
      continue;
    }
    tasks.push({ frontmatter: parsed.data, body, filename });
  }

  tasks.sort((a, b) => Number(b.frontmatter.id) - Number(a.frontmatter.id));
  return { tasks, malformed };
}

/**
 * Allocate the next sequential id by scanning ALL `.md` filenames in the
 * tasks directory — including files whose frontmatter fails validation —
 * so a malformed file can never cause its id to be handed out twice.
 * Returns a zero-padded 3-digit string.
 */
export function nextSeq(tasksDir: string): string {
  let max = 0;
  if (existsSync(tasksDir)) {
    for (const filename of readdirSync(tasksDir)) {
      if (!filename.endsWith(".md")) continue;
      const seq = parseSeq(filename);
      if (!seq) continue;
      const n = Number(seq);
      if (n > max) max = n;
    }
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
  /** Set when the configured `branch_template` was unusable and the default scheme was applied. */
  branchWarning?: string;
}

/**
 * Create a new task file. Returns the persisted task with its absolute path.
 * The initial status is the first configured todo-role status (ADR-0026).
 * The branch name follows the ADR-0019 topic-branch convention
 * (`fix/007-OSI-123--login-timeout`) unless the config sets a
 * `branch_template` (WP4); a template that renders an invalid git ref falls
 * back to the default and reports it via `branchWarning` — a bad template
 * must never fail the create. A title that slugifies to nothing (fully
 * non-Latin) falls back to the task type as its slug.
 */
export function createTask(tasksDir: string, config: Config, input: NewTaskInput): CreatedTask {
  mkdirSync(tasksDir, { recursive: true });
  const id = nextSeq(tasksDir);
  const slug = slugify(input.title) || input.type;
  const filename = buildFilename(id, input.tracker_id, slug);
  let branch = buildBranch(input.type, id, input.tracker_id, slug);
  let branchWarning: string | undefined;
  if (config.branch_template) {
    const rendered = renderBranchTemplate(
      config.branch_template,
      input.type,
      id,
      input.tracker_id,
      slug,
    );
    if (rendered !== null) {
      branch = rendered;
    } else {
      branchWarning = `the configured branch_template ${JSON.stringify(config.branch_template)} renders an invalid git branch name — used the default \`${branch}\` instead. Fix the template with /marvin:kanban-config.`;
    }
  }
  const now = new Date().toISOString();
  const status = requireRole(config, "todo").key;

  const frontmatter: Record<string, string | undefined> = {
    id,
    type: input.type,
    status,
    title: input.title,
    tracker_id: input.tracker_id,
    branch,
    created: now,
    updated: now,
  };

  const body = input.description ? `\n${input.description}\n` : "\n";
  const text = stringifyFrontmatter(frontmatter, body);
  const path = join(tasksDir, filename);
  writeFileAtomic(path, text);

  const parsed = TaskFrontmatter.parse({
    id,
    type: input.type,
    status,
    title: input.title,
    ...(input.tracker_id ? { tracker_id: input.tracker_id } : {}),
    branch,
    created: now,
    updated: now,
  });
  return {
    task: { frontmatter: parsed, body, filename },
    path,
    ...(branchWarning ? { branchWarning } : {}),
  };
}

/**
 * Persist a status change for a task. `newStatus` is a configured status key
 * (ADR-0026); transition semantics live in the callers. Rewrites the file
 * atomically (temp file + rename — see `writeFileAtomic`).
 */
export function updateStatus(tasksDir: string, task: Task, newStatus: string): Task {
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
  writeFileAtomic(join(tasksDir, task.filename), stringifyFrontmatter(fm, task.body));
}

/**
 * Crash-safe write: land the bytes in a temp file next to the target, then
 * `rename(2)` over it — readers see the old task file or the new one, never a
 * torn half-write. The temp name never ends in `.md`, so a file left behind
 * by a crash between the two steps is invisible to `readAllTasks`/`nextSeq`.
 */
function writeFileAtomic(path: string, data: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function findTaskByBranch(tasks: Task[], branch: string): Task | null {
  return tasks.find((t) => t.frontmatter.branch === branch) ?? null;
}

export function findTaskById(tasks: Task[], id: string): Task | null {
  return tasks.find((t) => t.frontmatter.id === id) ?? null;
}
