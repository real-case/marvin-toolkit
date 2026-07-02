import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { DashboardState } from "@marvin-toolkit/mcp-shared/contracts";
import { readAllTasks } from "../storage/tasks.js";
import { loadConfig } from "../storage/config.js";
import { currentBranch, hasGh, hasGit, inGitRepo } from "../lib/git.js";
import { PROMPTS } from "../prompts/index.js";
import { orderedStatuses, roleOfStatus, type Config, type StatusRole } from "../storage/schema.js";
import type { ServerEnv } from "../lib/env.js";

const HelpInput = z.object({
  section: z
    .string()
    .optional()
    .describe("Filter the command index to one group: core, pr, task, sec, kanban."),
});

export function buildHelpTool(env: ServerEnv, version: string): AnyToolDef {
  return defineTool({
    name: "help",
    description:
      'Marvin dashboard: project state, kanban board counters, dependency status, and the full command index (derived from the prompt registry). Answers "what\'s on the board?" / "marvin help". Pass `section` to filter to one group (core/pr/task/sec/kanban).',
    inputSchema: HelpInput,
    handler: (input) => {
      // Fresh config per call — the task tool's `config` action edits the
      // file mid-session and the dashboard must reflect it immediately.
      const { config } = loadConfig(env.configPath, env.projectDir);
      return Promise.resolve(renderHelp(env, config, version, input.section));
    },
  });
}

function renderHelp(env: ServerEnv, config: Config, version: string, section?: string): ToolResult {
  const { tasks, malformed } = readAllTasks(env.tasksDir, config);
  // Per-status counts over the configured set (open record) plus the closed
  // per-role roll-up (ADR-0026). Every configured key is present, even at 0.
  const counts: Record<string, number> = {};
  for (const s of config.statuses) counts[s.key] = 0;
  const roleCounts: Record<StatusRole, number> = {
    todo: 0,
    wip: 0,
    review: 0,
    done: 0,
    blocked: 0,
  };
  for (const t of tasks) {
    counts[t.frontmatter.status] = (counts[t.frontmatter.status] ?? 0) + 1;
    roleCounts[roleOfStatus(config, t.frontmatter.status)] += 1;
  }

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
  for (const s of orderedStatuses(config)) {
    const roleNote = s.key === s.role ? "" : ` (${s.role})`;
    lines.push(`- ${s.key}${roleNote}: ${counts[s.key] ?? 0}`);
  }
  if (malformed.length > 0) lines.push(`- ⚠ malformed files: ${malformed.length}`);
  lines.push("");
  lines.push("## Git");
  lines.push(`- git: ${has_git ? "✓" : "✗ (lifecycle commands disabled)"}`);
  lines.push(`- gh:  ${has_gh ? "✓" : "✗ (PR commands fall back to printing the command)"}`);
  lines.push(`- branch: \`${branch ?? "(not in a git repo)"}\``);
  lines.push("");
  lines.push(...renderCommandIndex(section));

  // Widget payload for MCP Apps hosts (ADR-0024) — the marvin infrastructure
  // dashboard (#8). The terminal renders the text above and ignores this.
  const dashboard: DashboardState = {
    version,
    paths: { project: env.projectDir, tasks_dir: env.tasksDir, config_path: env.configPath },
    config: {
      base_branch: config.base_branch,
      tracker_url_template: config.tracker_url_template,
      ...(config.gates ? { gates: config.gates } : {}),
      statuses: config.statuses,
    },
    kanban_counts: counts,
    kanban_role_counts: roleCounts,
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

/**
 * The `## Commands` section of the dashboard, derived from the `PROMPTS`
 * registry so it can never drift from the real command set (it replaced a
 * hand-maintained list that only covered the kanban group). `section` filters
 * to one group; an unknown section falls back to the full index with a hint.
 */
function renderCommandIndex(section?: string): string[] {
  const want = section?.trim().toLowerCase();
  const known = !!want && GROUP_ORDER.includes(want);
  const groups = known ? [want] : GROUP_ORDER;

  const lines: string[] = [
    known ? `## Commands · \`${want}\` group` : `## Commands (${PROMPTS.length})`,
  ];
  if (want && !known) {
    lines.push(`_Unknown section \`${want}\` — showing all. Valid: ${GROUP_ORDER.join(", ")}._`);
  }
  for (const group of groups) {
    const inGroup = PROMPTS.filter((p) => groupOf(p.name) === group);
    if (inGroup.length === 0) continue;
    lines.push("", `### ${group} (${inGroup.length})`);
    for (const p of inGroup) lines.push(`- \`/marvin:${p.name}\` — ${shortDesc(p.description)}`);
  }
  return lines;
}

/** First clause of a prompt description, trimmed to one scannable line. */
function shortDesc(desc: string, max = 80): string {
  const oneLine = desc.replace(/\s+/g, " ").trim();
  const firstClause = oneLine.split(/ — | – |\. /)[0] ?? oneLine;
  const base = firstClause.length <= oneLine.length ? firstClause : oneLine;
  if (base.length <= max) return base;
  const cut = base.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
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
