import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { DashboardState } from "@marvin-toolkit/mcp-shared/contracts";
import { loadConfig } from "../storage/config.js";
import { orderedStatuses, type Config } from "../storage/schema.js";
import { PROMPTS } from "../prompts/index.js";
import {
  artifactCounts,
  commandGroups,
  gitState,
  groupOf,
  kanbanCounts,
  GROUP_ORDER,
} from "../lib/state.js";
import type { ServerEnv } from "../lib/env.js";

const HelpInput = z.object({
  section: z
    .string()
    .optional()
    .describe("Filter the command index to one group: core, adr, pr, task, sec, refactor, kanban."),
});

export function buildHelpTool(env: ServerEnv, version: string): AnyToolDef {
  return defineTool({
    name: "help",
    description:
      'Marvin dashboard: project state, kanban board counters, dependency status, and the full command index (derived from the prompt registry). Answers "what\'s on the board?" / "marvin help". Pass `section` to filter to one group (core/adr/pr/task/sec/refactor/kanban).',
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
  // Per-status counts over the configured set plus the closed per-role
  // roll-up (ADR-0026), computed by the shared state module (ADR-0030).
  const { counts, roleCounts, malformed } = kanbanCounts(env, config);
  const git = gitState(env.projectDir);

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
  if (malformed > 0) lines.push(`- ⚠ malformed files: ${malformed}`);
  lines.push("");
  lines.push("## Git");
  lines.push(`- git: ${git.has_git ? "✓" : "✗ (lifecycle commands disabled)"}`);
  lines.push(`- gh:  ${git.has_gh ? "✓" : "✗ (PR commands fall back to printing the command)"}`);
  lines.push(`- branch: \`${git.branch ?? "(not in a git repo)"}\``);
  lines.push("");
  lines.push(...renderCommandIndex(section));

  // Widget payload for MCP Apps hosts (ADR-0024) — the marvin infrastructure
  // dashboard (#8). The terminal renders the text above and ignores this.
  // The whole-toolbox sections (adr/security/refactor/lessons/usage) are the
  // `dashboard` tool's extension (ADR-0030) and stay absent here.
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
    git,
    artifacts: artifactCounts(env),
    command_groups: commandGroups(),
  };

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: dashboard,
  };
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
