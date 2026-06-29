import { z } from "zod";
import { defineTool, elicit, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { TaskCard, TaskListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createTask,
  findTaskByBranch,
  findTaskById,
  readAllTasks,
  updateStatus,
} from "../storage/tasks.js";
import { trackerUrl } from "../storage/config.js";
import {
  TaskType,
  TaskTitle,
  TrackerId,
  TaskStatus,
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
  action: z.enum(["menu", "create", "list", "status", "start", "review", "done"]).optional(),
  type: TaskType.optional(),
  taskId: z.string().optional(),
});

type TaskInput = z.infer<typeof TaskInput>;

export function buildTaskTool(server: McpServer, env: ServerEnv, config: Config): AnyToolDef {
  return defineTool({
    name: "task",
    description:
      "Marvin tasks CRUD + lifecycle. Defaults to an interactive main menu when called with no arguments.",
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
    const picked = await pickMenuAction(server, env);
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
  }
}

async function pickMenuAction(
  server: McpServer,
  env: ServerEnv,
): Promise<Exclude<TaskInput["action"], "menu" | undefined> | null> {
  const { tasks } = readAllTasks(env.tasksDir);
  const wip = tasks.filter((t) => t.frontmatter.status === "wip").length;
  const data = await elicit(
    server,
    `Marvin · ${tasks.length} tasks · ${wip} in progress`,
    z.object({
      action: z.enum(["create", "list", "status", "start", "review", "done"]),
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
  const created = createTask(env.tasksDir, {
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
        updateStatus(env.tasksDir, created.task, "wip");
        branchInfo = `\nBranch \`${created.task.frontmatter.branch}\` checked out; status → wip.`;
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
  const { tasks, malformed } = readAllTasks(env.tasksDir);
  const branch = currentBranch(env.projectDir);
  const body = renderListTable(tasks, branch);
  const warning =
    malformed.length > 0
      ? `\n\n_⚠ ${malformed.length} malformed file(s): ${malformed.map((m) => m.filename).join(", ")}_`
      : "";
  return {
    content: [{ type: "text", text: `# Tasks (${tasks.length})\n\n${body}${warning}` }],
    // Widget payload for MCP Apps hosts (ADR-0024) — the same data the text
    // renders, typed to the TaskListPayload contract. `pr` is null until PR-URL
    // capture lands; terminals render `content` and ignore this.
    structuredContent: buildTaskListPayload(tasks, config),
  };
}

/** Map kanban tasks to the TaskListPayload widget contract (ADR-0024). */
function buildTaskListPayload(tasks: Task[], config: Config): TaskListPayload {
  const counts = { todo: 0, wip: 0, review: 0, done: 0, blocked: 0 };
  const cards: TaskCard[] = tasks.map((t) => {
    const fm = t.frontmatter;
    counts[fm.status] += 1;
    return {
      id: fm.id,
      type: fm.type,
      status: fm.status,
      title: fm.title,
      branch: fm.branch,
      ...(fm.tracker_id ? { tracker_id: fm.tracker_id } : {}),
      tracker_url: trackerUrl(config, fm.tracker_id),
      pr: null,
      created: fm.created,
      updated: fm.updated,
    };
  });
  return { tasks: cards, counts };
}

function runStatus(_server: McpServer, env: ServerEnv, _config: Config): ToolResult {
  const { tasks } = readAllTasks(env.tasksDir);
  const branch = currentBranch(env.projectDir);
  const linked = branch ? findTaskByBranch(tasks, branch) : null;
  const wip = tasks.filter((t) => t.frontmatter.status === "wip");
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
  const { tasks } = readAllTasks(env.tasksDir);
  const todo = tasks.filter((t) => t.frontmatter.status === "todo");
  if (todo.length === 0) {
    return ok(
      "No `todo` tasks. Use `/marvin:kanban-bug` (or `feature` / `chore` / `spike`) to create one.",
    );
  }

  let taskId = preselected;
  if (!taskId) {
    const data = await elicit(
      server,
      "Which task to start?",
      z.object({
        taskId: z.enum(todo.map((t) => t.frontmatter.id) as [string, ...string[]]),
      }),
    );
    if (!data) return cancelled();
    taskId = data.taskId;
  }

  const task = findTaskById(tasks, taskId);
  if (!task) return errOk(`Task ${taskId} not found`);

  if (hasGit() && inGitRepo(env.projectDir)) {
    const result = branchExists(task.frontmatter.branch, env.projectDir)
      ? checkoutBranch(task.frontmatter.branch, env.projectDir)
      : createBranchFromBase(config.base_branch, task.frontmatter.branch, env.projectDir);
    if (!result.ok) return errOk(`git: ${result.stderr}`);
  }

  updateStatus(env.tasksDir, task, "wip");
  return ok(
    `Started **${task.frontmatter.id}** — ${task.frontmatter.title}\nBranch: \`${task.frontmatter.branch}\` · status → wip`,
  );
}

async function runReview(server: McpServer, env: ServerEnv, config: Config): Promise<ToolResult> {
  const task = await detectCurrentTaskOrPick(server, env, ["wip"]);
  if (!task) return cancelled();
  updateStatus(env.tasksDir, task, "review");
  // PR creation happens in the git tool (action=create-pr); we just hint.
  return ok(
    `Moved **${task.frontmatter.id}** to **review**.\nOpen a PR with \`/marvin:kanban-create-pr\` (base branch: \`${config.base_branch}\`).`,
  );
}

async function runDone(server: McpServer, env: ServerEnv, _config: Config): Promise<ToolResult> {
  const task = await detectCurrentTaskOrPick(server, env, ["wip", "review"]);
  if (!task) return cancelled();
  updateStatus(env.tasksDir, task, "done");
  return ok(
    `Marked **${task.frontmatter.id}** as **done**. Branch cleanup and merge are left to you / CI.`,
  );
}

async function detectCurrentTaskOrPick(
  server: McpServer,
  env: ServerEnv,
  allowedStatuses: Array<typeof TaskStatus._type>,
): Promise<Task | null> {
  const { tasks } = readAllTasks(env.tasksDir);
  const branch = currentBranch(env.projectDir);
  const linked = branch ? findTaskByBranch(tasks, branch) : null;
  if (linked && allowedStatuses.includes(linked.frontmatter.status)) return linked;

  const candidates = tasks.filter((t) => allowedStatuses.includes(t.frontmatter.status));
  if (candidates.length === 0) return null;

  const data = await elicit(
    server,
    "Current branch has no linked task — pick one",
    z.object({
      taskId: z.enum(candidates.map((t) => t.frontmatter.id) as [string, ...string[]]),
    }),
  );
  if (!data) return null;
  return findTaskById(tasks, data.taskId);
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
