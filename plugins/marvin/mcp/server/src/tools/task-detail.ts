import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { TaskDetail } from "@marvin-toolkit/mcp-shared/contracts";
import { findTaskById, findTaskByBranch, readAllTasks } from "../storage/tasks.js";
import { loadConfig } from "../storage/config.js";
import { currentBranch } from "../lib/git.js";
import { buildTaskCard } from "../flows/card.js";
import type { Task } from "../storage/schema.js";
import type { ServerEnv } from "../lib/env.js";
import { TASK_DETAIL_WIDGET_URI } from "../resources/widgets.js";

/**
 * The task-detail read tool (ADR-0024 widget #2). It surfaces ONE board task's
 * full detail — the TaskCard fields plus its markdown body — as text (the
 * terminal fallback) and as a `TaskDetail` `structuredContent` payload the
 * task-detail `ui://` widget renders in an MCP Apps host.
 *
 * It is a *separate* tool from `task` on purpose: a widget is bound on the tool
 * descriptor via `_meta.ui.resourceUri` and resolved once by the host, so one
 * tool surfaces exactly one widget. `task` is already bound to task-list; a
 * single-task detail therefore needs its own tool (ADR-0024; see the spec
 * `.marvin/task/…-widget-task-detail.md`). Read-only — no elicitation, no writes.
 */
const TaskDetailInput = z.object({
  taskId: z
    .string()
    .optional()
    .describe(
      "The task id to show, e.g. 007. Omit to show the task linked to the current git branch.",
    ),
});

export function buildTaskDetailTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "task-detail",
    description:
      'Show one board task in full — its fields (id, type, status, branch, tracker/PR links) plus its markdown body. Given a `taskId` (e.g. 007), or with none the task linked to the current git branch, returns the task detail as text and, for MCP Apps hosts, binds the task-detail widget (ADR-0024). Read-only. Serves requests like "show task 3", "open the details for the current task", or "what\'s in OSI-42".',
    inputSchema: TaskDetailInput,
    // Bind the task-detail `ui://` widget for MCP Apps hosts (ADR-0024). A plain
    // object literal — no ext-apps import — so tsup never bundles the SDK into
    // dist/server.js. The terminal ignores `_meta` and renders the text content.
    meta: { ui: { resourceUri: TASK_DETAIL_WIDGET_URI } },
    handler: async (input) => {
      // Config is (re)loaded per call so a mid-session `task config` edit (and
      // hand edits) apply without a restart — same contract as the `task` tool.
      const { config } = loadConfig(env.configPath, env.projectDir);
      const { tasks } = readAllTasks(env.tasksDir, config);

      let task: Task | null;
      if (input.taskId) {
        task = findTaskById(tasks, input.taskId);
        if (!task) {
          return errOk(`Task ${input.taskId} not found${tasksHint(tasks)}`);
        }
      } else {
        const branch = currentBranch(env.projectDir);
        task = branch ? findTaskByBranch(tasks, branch) : null;
        if (!task) {
          if (tasks.length === 0) {
            return ok(
              "No tasks on the board yet. Use `/marvin:track-new` (bug / feature / chore / spike) to create one.",
            );
          }
          return errOk(
            `No task is linked to the current branch — pass \`taskId\` to pick one.${tasksHint(tasks)}`,
          );
        }
      }

      // TaskDetail = the shared card mapping + the task's markdown body. `body`
      // is the raw file body (created as the description wrapped in newlines).
      const detail: TaskDetail = { ...buildTaskCard(task, config), body_markdown: task.body };
      const result: ToolResult = {
        content: [{ type: "text", text: renderDetailText(detail) }],
        structuredContent: detail,
      };
      return result;
    },
  });
}

/** A trailing " Tasks: 001 (title), …" hint listing what is on the board. */
function tasksHint(tasks: Task[]): string {
  if (tasks.length === 0) return "";
  const listed = tasks.map((t) => `${t.frontmatter.id} (${t.frontmatter.title})`).join(", ");
  return ` Tasks: ${listed}.`;
}

/** The terminal fallback — the task rendered as markdown (fields list + body). */
function renderDetailText(d: TaskDetail): string {
  const lines: string[] = [];
  lines.push(`# ${d.title}`);
  lines.push("");
  lines.push(`- **ID:** ${d.id}`);
  lines.push(`- **Type:** ${d.type}`);
  lines.push(`- **Status:** ${d.status.key} (${d.status.role})`);
  lines.push(`- **Branch:** \`${d.branch}\``);
  if (d.tracker_id) {
    lines.push(
      `- **Tracker:** ${d.tracker_url ? `[${d.tracker_id}](${d.tracker_url})` : d.tracker_id}`,
    );
  }
  if (d.pr) {
    lines.push(`- **PR:** ${d.pr.number ? `[#${d.pr.number}](${d.pr.url})` : d.pr.url}`);
  }
  if (d.spec_slug) lines.push(`- **Spec:** ${d.spec_slug}`);
  lines.push(`- **Updated:** ${d.updated}`);
  // The body is authored markdown; separate it from the fields with a rule.
  const body = d.body_markdown.trim();
  if (body) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push(body);
  }
  return lines.join("\n");
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function errOk(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
