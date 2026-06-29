import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { DashboardState } from "@marvin-toolkit/mcp-shared/contracts";
import { readAllTasks } from "../storage/tasks.js";
import { currentBranch, hasGh, hasGit, inGitRepo } from "../lib/git.js";
import { PROMPTS } from "../prompts/index.js";
import type { Config, TaskStatus } from "../storage/schema.js";
import type { ServerEnv } from "../lib/env.js";

const HelpInput = z.object({});

const ALL_PROMPTS: Array<{ name: string; desc: string }> = [
  { name: "/marvin:kanban-menu", desc: "Main menu" },
  { name: "/marvin:kanban-bug", desc: "Quick-create a bug task" },
  { name: "/marvin:kanban-feature", desc: "Quick-create a feature task" },
  { name: "/marvin:kanban-chore", desc: "Quick-create a chore task" },
  { name: "/marvin:kanban-spike", desc: "Quick-create a spike task" },
  { name: "/marvin:kanban-start", desc: "Pick a todo task and start it" },
  { name: "/marvin:kanban-review", desc: "Move current task to review" },
  { name: "/marvin:kanban-done", desc: "Mark current task done" },
  { name: "/marvin:kanban-list", desc: "List all tasks" },
  { name: "/marvin:kanban-status", desc: "Current branch + WIP tasks" },
  { name: "/marvin:kanban-help", desc: "This dashboard" },
  { name: "/marvin:kanban-commit", desc: "Commit with task context" },
  { name: "/marvin:kanban-create-pr", desc: "Create PR for current task" },
];

export function buildHelpTool(env: ServerEnv, config: Config, version: string): AnyToolDef {
  return defineTool({
    name: "help",
    description: "Marvin tasks dashboard: project state, dependency status, prompt list.",
    inputSchema: HelpInput,
    handler: () => Promise.resolve(renderHelp(env, config, version)),
  });
}

function renderHelp(env: ServerEnv, config: Config, version: string): ToolResult {
  const { tasks, malformed } = readAllTasks(env.tasksDir);
  const counts: Record<TaskStatus, number> = {
    todo: 0,
    wip: 0,
    review: 0,
    done: 0,
    blocked: 0,
  };
  for (const t of tasks) counts[t.frontmatter.status] += 1;

  const branch = inGitRepo(env.projectDir) ? currentBranch(env.projectDir) : null;
  const has_git = hasGit();
  const has_gh = hasGh();

  const lines: string[] = [];
  lines.push(`# marvin · kanban tracker · v${version}`);
  lines.push("");
  lines.push("## State");
  lines.push(`- Project: \`${env.projectDir}\``);
  lines.push(`- Tasks dir: \`${env.tasksDir}\``);
  lines.push(`- Config: \`${env.configPath}\``);
  lines.push(`- Base branch: \`${config.base_branch}\``);
  lines.push(
    `- Tracker template: ${config.tracker_url_template ? `\`${config.tracker_url_template}\`` : "not configured"}`,
  );
  lines.push("");
  lines.push("## Counters");
  lines.push(`- todo: ${counts.todo}`);
  lines.push(`- wip: ${counts.wip}`);
  lines.push(`- review: ${counts.review}`);
  lines.push(`- done: ${counts.done}`);
  lines.push(`- blocked: ${counts.blocked}`);
  if (malformed.length > 0) lines.push(`- ⚠ malformed files: ${malformed.length}`);
  lines.push("");
  lines.push("## Git");
  lines.push(`- git: ${has_git ? "✓" : "✗ (lifecycle commands disabled)"}`);
  lines.push(`- gh:  ${has_gh ? "✓" : "✗ (PR commands fall back to printing the command)"}`);
  lines.push(`- branch: \`${branch ?? "(not in a git repo)"}\``);
  lines.push("");
  lines.push("## Prompts");
  for (const p of ALL_PROMPTS) lines.push(`- \`${p.name}\` — ${p.desc}`);

  // Widget payload for MCP Apps hosts (ADR-0024) — the marvin infrastructure
  // dashboard (#8). The terminal renders the text above and ignores this.
  const dashboard: DashboardState = {
    version,
    paths: { project: env.projectDir, tasks_dir: env.tasksDir, config_path: env.configPath },
    config: {
      base_branch: config.base_branch,
      tracker_url_template: config.tracker_url_template,
      ...(config.gates ? { gates: config.gates } : {}),
    },
    kanban_counts: counts,
    git: { has_git, has_gh, branch },
    artifacts: artifactCounts(env),
    command_groups: commandGroups(),
  };

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: dashboard,
  };
}

const GROUP_PREFIXES = ["pr", "task", "sec", "kanban"];
const GROUP_ORDER = ["core", "pr", "task", "sec", "kanban"];

/** Group of a prompt by its `<group>-<command>` prefix; bare names are "core". */
function groupOf(name: string): string {
  const prefix = name.split("-")[0] ?? "";
  return GROUP_PREFIXES.includes(prefix) ? prefix : "core";
}

/** Command counts per group, derived from the prompt registry (ADR-0024). */
function commandGroups(): DashboardState["command_groups"] {
  return GROUP_ORDER.map((group) => ({
    group,
    count: PROMPTS.filter((p) => groupOf(p.name) === group).length,
  })).filter((g) => g.count > 0);
}

/** Count the `.md` artifacts under each `.marvin/` subdir for the dashboard. */
function artifactCounts(env: ServerEnv): DashboardState["artifacts"] {
  const marvin = join(env.projectDir, ".marvin");
  return {
    specs: countMarkdown(join(marvin, "task"), ["verification.md"]),
    handoffs: countMarkdown(join(marvin, "handoff")),
    audits: countMarkdown(join(marvin, "security")),
    lessons: countMarkdown(env.memoryDir, ["MEMORY.md"]),
  };
}

function countMarkdown(dir: string, exclude: string[] = []): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md") && !exclude.includes(f)).length;
  } catch {
    return 0;
  }
}
