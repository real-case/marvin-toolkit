import { z } from "zod";
import { defineTool, elicit, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { PrRef, TaskCard, TaskListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createTask,
  findTaskByBranch,
  findTaskById,
  readAllTasks,
  setTaskPr,
  updateStatus,
} from "../storage/tasks.js";
import { trackerUrl } from "../storage/config.js";
import {
  TaskType,
  TaskTitle,
  TrackerId,
  firstOfRole,
  keysOfRoles,
  requireRole,
  roleOfStatus,
  statusKeys,
  type StatusRole,
  type Task,
  type Config,
} from "../storage/schema.js";
import {
  checkoutBranch,
  branchExists,
  createBranchFromBase,
  currentBranch,
  hasGit,
  inGitRepo,
} from "../lib/git.js";
import type { ServerEnv } from "../lib/env.js";
import { formatTaskLine, renderListTable } from "../flows/format.js";

const TaskInput = z.object({
  action: z
    .enum(["menu", "create", "list", "status", "start", "review", "done", "move", "link-pr"])
    .optional(),
  type: TaskType.optional(),
  taskId: z.string().optional(),
  url: z.string().optional().describe("PR URL to persist onto the task (link-pr action)"),
});

type TaskInput = z.infer<typeof TaskInput>;

export function buildTaskTool(server: McpServer, env: ServerEnv, config: Config): AnyToolDef {
  return defineTool({
    name: "task",
    description:
      'The marvin kanban board — create, list, and move tasks (bug/feature/chore/spike) on the per-project board under .marvin/kanban/: pick up work, send it to review, mark it done, move it to any configured status, or link a PR URL to a task (link-pr). Statuses are role-driven and configurable per project (ADR-0026). Serves chat requests like "add a bug to the board" or "what am I working on?". Defaults to an interactive main menu when called with no arguments.',
    inputSchema: TaskInput,
    handler: (input) => dispatchTask(server, env, config, input),
  });
}

async function dispatchTask(
  server: McpServer,
  env: ServerEnv,
  config: Config,
  input: TaskInput,
): Promise<ToolResult> {
  let action = input.action;
  // "menu" and undefined both mean "show the picker".
  if (!action || action === "menu") {
    const picked = await pickMenuAction(server, env, config);
    if (!picked) return cancelled();
    action = picked;
  }

  switch (action) {
    case "create":
      return runCreate(server, env, config, input.type);
    case "list":
      return runList(env, config);
    case "status":
      return runStatus(server, env, config);
    case "start":
      return runStart(server, env, config, input.taskId);
    case "review":
      return runReview(server, env, config);
    case "done":
      return runDone(server, env, config);
    case "move":
      return runMove(server, env, config, input.taskId);
    case "link-pr":
      return runLinkPr(env, config, input.taskId, input.url);
  }
}

async function pickMenuAction(
  server: McpServer,
  env: ServerEnv,
  config: Config,
): Promise<Exclude<TaskInput["action"], "menu" | undefined> | null> {
  const { tasks } = readAllTasks(env.tasksDir, config);
  const wip = tasks.filter((t) => roleOfStatus(config, t.frontmatter.status) === "wip").length;
  const data = await elicit(
    server,
    `Marvin · ${tasks.length} tasks · ${wip} in progress`,
    z.object({
      action: z.enum(["create", "list", "status", "start", "review", "done", "move"]),
    }),
  );
  return data?.action ?? null;
}

async function runCreate(
  server: McpServer,
  env: ServerEnv,
  config: Config,
  preType: ReturnType<typeof TaskType.parse> | undefined,
): Promise<ToolResult> {
  const formSchema = preType
    ? z.object({
        title: TaskTitle,
        tracker_id: TrackerId.optional(),
        description: z.string().optional(),
      })
    : z.object({
        type: TaskType,
        title: TaskTitle,
        tracker_id: TrackerId.optional(),
        description: z.string().optional(),
      });

  const data = await elicit(server, "New task", formSchema as never);
  if (!data) return cancelled();

  const type = preType ?? (data as { type: ReturnType<typeof TaskType.parse> }).type;
  const created = createTask(env.tasksDir, config, {
    type,
    title: (data as { title: string }).title,
    ...((data as { tracker_id?: string }).tracker_id
      ? { tracker_id: (data as { tracker_id?: string }).tracker_id }
      : {}),
    ...((data as { description?: string }).description
      ? { description: (data as { description?: string }).description }
      : {}),
  });

  let branchInfo = "";
  if (hasGit() && inGitRepo(env.projectDir)) {
    const confirm = await elicit(
      server,
      `Create branch \`${created.task.frontmatter.branch}\` from \`${config.base_branch}\` and check it out?`,
      z.object({ checkout: z.enum(["yes", "no"]) }),
    );
    if (confirm?.checkout === "yes") {
      const result = createBranchFromBase(
        config.base_branch,
        created.task.frontmatter.branch,
        env.projectDir,
      );
      if (result.ok) {
        const wipStatus = requireRole(config, "wip");
        updateStatus(env.tasksDir, created.task, wipStatus.key);
        branchInfo = `\nBranch \`${created.task.frontmatter.branch}\` checked out; status → ${wipStatus.key}.`;
      } else {
        branchInfo = `\nBranch creation failed: ${result.stderr}`;
      }
    }
  }

  return ok(
    `Created task **${created.task.frontmatter.id}** — ${created.task.frontmatter.title}\nFile: \`${created.path}\`${branchInfo}`,
  );
}

function runList(env: ServerEnv, config: Config): ToolResult {
  const { tasks, malformed } = readAllTasks(env.tasksDir, config);
  const branch = currentBranch(env.projectDir);
  const body = renderListTable(tasks, branch, config);
  const warning =
    malformed.length > 0
      ? `\n\n_⚠ ${malformed.length} malformed file(s): ${malformed.map((m) => m.filename).join(", ")}_`
      : "";
  return {
    content: [{ type: "text", text: `# Tasks (${tasks.length})\n\n${body}${warning}` }],
    // Widget payload for MCP Apps hosts (ADR-0024) — the same data the text
    // renders, typed to the TaskListPayload contract. `pr` is populated from the
    // URL captured by link-pr; terminals render `content` and ignore this.
    structuredContent: buildTaskListPayload(tasks, config),
  };
}

/**
 * Map kanban tasks to the TaskListPayload widget contract (ADR-0024). Statuses
 * follow ADR-0026: each card carries `{ key, role }`, `counts` is an open
 * record over the configured keys, and `role_counts` is the closed roll-up.
 */
function buildTaskListPayload(tasks: Task[], config: Config): TaskListPayload {
  const counts: Record<string, number> = {};
  for (const s of config.statuses) counts[s.key] = 0;
  const role_counts: Record<StatusRole, number> = {
    todo: 0,
    wip: 0,
    review: 0,
    done: 0,
    blocked: 0,
  };
  const cards: TaskCard[] = tasks.map((t) => {
    const fm = t.frontmatter;
    const role = roleOfStatus(config, fm.status);
    counts[fm.status] = (counts[fm.status] ?? 0) + 1;
    role_counts[role] += 1;
    return {
      id: fm.id,
      type: fm.type,
      status: { key: fm.status, role },
      title: fm.title,
      branch: fm.branch,
      ...(fm.tracker_id ? { tracker_id: fm.tracker_id } : {}),
      tracker_url: trackerUrl(config, fm.tracker_id),
      pr: prRefFromUrl(fm.pr),
      created: fm.created,
      updated: fm.updated,
    };
  });
  return { tasks: cards, counts, role_counts };
}

/**
 * Map a stored PR URL to the PrRef widget contract (ADR-0024). The PR number is
 * derived from the URL (`…/pull/<n>`); `state` is intentionally omitted — marvin
 * stores the URL at create time and never live-resolves the PR's current state.
 */
function prRefFromUrl(url: string | undefined): PrRef | null {
  if (!url) return null;
  const match = url.match(/\/pull\/(\d+)/);
  return match ? { url, number: Number(match[1]) } : { url };
}

function runStatus(_server: McpServer, env: ServerEnv, config: Config): ToolResult {
  const { tasks } = readAllTasks(env.tasksDir, config);
  const branch = currentBranch(env.projectDir);
  const linked = branch ? findTaskByBranch(tasks, branch) : null;
  const wip = tasks.filter((t) => roleOfStatus(config, t.frontmatter.status) === "wip");
  const lines: string[] = [];
  lines.push(`**Branch:** \`${branch ?? "(not in a git repo)"}\``);
  lines.push(
    linked
      ? `**Linked task:** ${formatTaskLine(linked)}`
      : "**Linked task:** none (no task matches the current branch)",
  );
  lines.push("");
  lines.push(`**WIP tasks (${wip.length}):**`);
  if (wip.length === 0) {
    lines.push("_None — use `/marvin:kanban-start` to pick one up._");
  } else {
    for (const t of wip) lines.push(`- ${formatTaskLine(t)}`);
  }
  return ok(lines.join("\n"));
}

async function runStart(
  server: McpServer,
  env: ServerEnv,
  config: Config,
  preselected: string | undefined,
): Promise<ToolResult> {
  const { tasks } = readAllTasks(env.tasksDir, config);
  const todoKeys = keysOfRoles(config, ["todo"]);
  const todo = tasks.filter((t) => todoKeys.includes(t.frontmatter.status));

  let task: Task | null;
  if (preselected) {
    // The preselected path goes through the same role filter as the picker
    // (finding 14): a task outside a todo-role status cannot be "started".
    task = findTaskById(tasks, preselected);
    if (!task) return errOk(`Task ${preselected} not found`);
    if (!todoKeys.includes(task.frontmatter.status)) {
      return errOk(
        `Task ${preselected} is in status "${task.frontmatter.status}" — starting requires a todo-role status (${todoKeys.join(", ")}). Use the \`move\` action for other transitions.`,
      );
    }
  } else {
    if (todo.length === 0) {
      return ok(
        `No tasks in a todo-role status (${todoKeys.join(", ")}). Use \`/marvin:kanban-bug\` (or \`feature\` / \`chore\` / \`spike\`) to create one.`,
      );
    }
    const data = await elicit(
      server,
      "Which task to start?",
      z.object({
        taskId: z.enum(todo.map((t) => t.frontmatter.id) as [string, ...string[]]),
      }),
    );
    if (!data) return cancelled();
    task = findTaskById(tasks, data.taskId);
    if (!task) return errOk(`Task ${data.taskId} not found`);
  }

  if (hasGit() && inGitRepo(env.projectDir)) {
    const result = branchExists(task.frontmatter.branch, env.projectDir)
      ? checkoutBranch(task.frontmatter.branch, env.projectDir)
      : createBranchFromBase(config.base_branch, task.frontmatter.branch, env.projectDir);
    if (!result.ok) return errOk(`git: ${result.stderr}`);
  }

  const wipStatus = requireRole(config, "wip");
  updateStatus(env.tasksDir, task, wipStatus.key);
  return ok(
    `Started **${task.frontmatter.id}** — ${task.frontmatter.title}\nBranch: \`${task.frontmatter.branch}\` · status → ${wipStatus.key}`,
  );
}

async function runReview(server: McpServer, env: ServerEnv, config: Config): Promise<ToolResult> {
  const target = firstOfRole(config, "review");
  if (!target) {
    return errOk(
      'No status with role "review" is configured — add one to `statuses` in `.marvin/config.json`, or use the `move` action.',
    );
  }
  const pick = await detectCurrentTaskOrPick(server, env, config, ["wip"]);
  if (pick.kind === "cancelled") return cancelled();
  if (pick.kind === "none") {
    return ok(
      `No tasks in a wip-role status (${keysOfRoles(config, ["wip"]).join(", ")}) — nothing to move to review.`,
    );
  }
  updateStatus(env.tasksDir, pick.task, target.key);
  // PR creation is prose-driven — the kanban-aware pr-create skill (ADR-0025); we just hint.
  return ok(
    `Moved **${pick.task.frontmatter.id}** to **${target.key}**.\nOpen a PR with \`/marvin:pr-create\` (base branch: \`${config.base_branch}\`).`,
  );
}

async function runDone(server: McpServer, env: ServerEnv, config: Config): Promise<ToolResult> {
  const roles: StatusRole[] = ["wip", "review"];
  const pick = await detectCurrentTaskOrPick(server, env, config, roles);
  if (pick.kind === "cancelled") return cancelled();
  if (pick.kind === "none") {
    return ok(
      `No tasks in a wip- or review-role status (${keysOfRoles(config, roles).join(", ")}) — nothing to mark done.`,
    );
  }
  const doneStatus = requireRole(config, "done");
  updateStatus(env.tasksDir, pick.task, doneStatus.key);
  return ok(
    `Marked **${pick.task.frontmatter.id}** as **${doneStatus.key}**. Branch cleanup and merge are left to you / CI.`,
  );
}

/**
 * Generic transition to any configured status (ADR-0026) — the door to the
 * statuses the lifecycle verbs don't reach (e.g. `blocked`, or a second
 * review-role status like `qa`). Resolves the task like the other actions:
 * explicit taskId, else the current branch's task, else an interactive picker.
 */
async function runMove(
  server: McpServer,
  env: ServerEnv,
  config: Config,
  preselected: string | undefined,
): Promise<ToolResult> {
  const { tasks } = readAllTasks(env.tasksDir, config);
  if (tasks.length === 0) {
    return ok(
      "No tasks on the board yet. Use `/marvin:kanban-bug` (or `feature` / `chore` / `spike`) to create one.",
    );
  }

  let task: Task | null = null;
  if (preselected) {
    task = findTaskById(tasks, preselected);
    if (!task) return errOk(`Task ${preselected} not found`);
  } else {
    const branch = currentBranch(env.projectDir);
    task = branch ? findTaskByBranch(tasks, branch) : null;
  }
  if (!task) {
    const data = await elicit(
      server,
      "Which task to move?",
      z.object({
        taskId: z.enum(tasks.map((t) => t.frontmatter.id) as [string, ...string[]]),
      }),
    );
    if (!data) return cancelled();
    task = findTaskById(tasks, data.taskId);
    if (!task) return errOk(`Task ${data.taskId} not found`);
  }

  const keys = statusKeys(config);
  const target = await elicit(
    server,
    `Move ${task.frontmatter.id} (${task.frontmatter.status}) to`,
    z.object({ status: z.enum(keys as [string, ...string[]]) }),
  );
  if (!target) return cancelled();
  if (target.status === task.frontmatter.status) {
    return ok(`**${task.frontmatter.id}** is already in \`${target.status}\` — nothing to do.`);
  }

  const from = task.frontmatter.status;
  updateStatus(env.tasksDir, task, target.status);
  return ok(
    `Moved **${task.frontmatter.id}** — ${task.frontmatter.title}\n\`${from}\` → \`${target.status}\``,
  );
}

/**
 * Persist a PR URL onto a task's frontmatter (ADR-0024 widget data, ADR-0025).
 * The deterministic tail of the prose-driven pr-create flow: judgement (what PR
 * to open, title, body) lives in the skill; the state write lands here.
 */
function runLinkPr(
  env: ServerEnv,
  config: Config,
  taskId: string | undefined,
  url: string | undefined,
): ToolResult {
  if (!url) {
    return errOk(
      "Missing `url` — pass the PR URL to link, e.g. https://github.com/acme/widget/pull/42.",
    );
  }
  if (!isHttpUrl(url)) {
    return errOk(
      `Not an http(s) URL: \`${url}\` — pass the PR URL as printed by \`gh pr create\`.`,
    );
  }

  const { tasks } = readAllTasks(env.tasksDir, config);
  let task: Task | null;
  if (taskId) {
    task = findTaskById(tasks, taskId);
    if (!task) return errOk(`Task ${taskId} not found.`);
  } else {
    const branch = currentBranch(env.projectDir);
    task = branch ? findTaskByBranch(tasks, branch) : null;
    if (!task) {
      return errOk(
        "No task is linked to the current branch — no board task's `branch` frontmatter matches it. Pass `taskId` to pick the task explicitly.",
      );
    }
  }

  const saved = setTaskPr(env.tasksDir, task, url);
  return ok(`Linked PR to **${saved.frontmatter.id}** — ${saved.frontmatter.title}\nPR: ${url}`);
}

function isHttpUrl(raw: string): boolean {
  try {
    const protocol = new URL(raw).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Resolve "the task this command should act on" for the lifecycle verbs:
 * the current branch's task when its status role is allowed, else an
 * interactive picker over the allowed-role candidates. The empty-candidate
 * case is distinguished from a user cancel (finding 8) so callers can answer
 * honestly instead of pretending something was cancelled.
 */
type TaskPick = { kind: "task"; task: Task } | { kind: "none" } | { kind: "cancelled" };

async function detectCurrentTaskOrPick(
  server: McpServer,
  env: ServerEnv,
  config: Config,
  roles: StatusRole[],
): Promise<TaskPick> {
  const { tasks } = readAllTasks(env.tasksDir, config);
  const allowedKeys = keysOfRoles(config, roles);
  const branch = currentBranch(env.projectDir);
  const linked = branch ? findTaskByBranch(tasks, branch) : null;
  if (linked && allowedKeys.includes(linked.frontmatter.status)) {
    return { kind: "task", task: linked };
  }

  const candidates = tasks.filter((t) => allowedKeys.includes(t.frontmatter.status));
  if (candidates.length === 0) return { kind: "none" };

  const data = await elicit(
    server,
    "Current branch has no linked task — pick one",
    z.object({
      taskId: z.enum(candidates.map((t) => t.frontmatter.id) as [string, ...string[]]),
    }),
  );
  if (!data) return { kind: "cancelled" };
  const picked = findTaskById(tasks, data.taskId);
  return picked ? { kind: "task", task: picked } : { kind: "none" };
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function errOk(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function cancelled(): ToolResult {
  return ok("Cancelled — no changes made.");
}
