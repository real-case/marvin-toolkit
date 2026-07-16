import { basename } from "node:path";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { HelpState } from "@marvin-toolkit/mcp-shared/contracts";
import { loadConfig } from "../storage/config.js";
import { type Config } from "../storage/schema.js";
import { PROMPTS } from "../prompts/index.js";
import { artifactCounts, gitState, groupOf, boardCounts, GROUP_ORDER } from "../lib/state.js";
import {
  COMMAND_BLURBS,
  COMMAND_DETAILS,
  COMMAND_EXAMPLES,
  COMMAND_PROMPTS,
  GROUP_BLURBS,
  HUMAN_RUN,
  SLOGAN,
  projectMcpServers,
  shortDesc,
  type McpServerState,
} from "../lib/help-data.js";
import { HELP_WIDGET_URI } from "../resources/widgets.js";
import type { ServerEnv } from "../lib/env.js";

/*
 * `help` renders top-to-bottom as one panel:
 *
 *   1. Heading      — a text `>_ MARVIN` wordmark heading, the slogan, and the
 *                     version (the version is injected at build).
 *   2. Summary      — DYNAMIC, per project: project name, git branch + base,
 *                     the board counts, and the artifact inventory.
 *   3. MCP servers  — DYNAMIC: the MCP servers configured for this project,
 *                     lit (enabled) / dim (disabled).
 *   4. Command groups — the group taxonomy + one-line blurbs (a TOC).
 *   5. Commands     — STATIC per release: the full per-command reference,
 *                     grouped by command group. Names come from the prompt
 *                     registry (`PROMPTS`, drift-proof); synopses from the
 *                     curated `COMMAND_BLURBS`.
 *
 * `section` narrows 4+5 to a single group's detail.
 *
 * The whole panel is also emitted as a `HelpState` `structuredContent` payload,
 * bound to the `ui://marvin/help.html` widget (ADR-0024): a rich MCP Apps host
 * renders the widget, a text-only terminal renders the markdown below. The two
 * doors share this one computation so they can never drift.
 */

const HelpInput = z.object({
  section: z
    .string()
    .optional()
    .describe(
      "Filter the command reference to one group: core, adr, pr, task, sec, refactor, track.",
    ),
});

export function buildHelpTool(env: ServerEnv, version: string): AnyToolDef {
  return defineTool({
    name: "help",
    description:
      'Marvin welcome banner + dashboard: project summary (project, git branch, task board, artifacts), the configured MCP servers, the command groups, and the full per-command reference. Answers "what\'s on the board?" / "marvin help". Pass `section` to focus the reference on one group (core/adr/pr/task/sec/refactor/track).',
    inputSchema: HelpInput,
    // Bind the help `ui://` widget for MCP Apps hosts (ADR-0024). A plain object
    // literal — no ext-apps import — so tsup never bundles the SDK into
    // dist/server.js. The terminal ignores `_meta` and renders the text content.
    meta: { ui: { resourceUri: HELP_WIDGET_URI } },
    handler: (input) => {
      // Fresh config per call — the task tool's `config` action edits the
      // file mid-session and the dashboard must reflect it immediately.
      const { config } = loadConfig(env.configPath, env.projectDir);
      return Promise.resolve(renderHelp(env, config, version, input.section));
    },
  });
}

function renderHelp(env: ServerEnv, config: Config, version: string, section?: string): ToolResult {
  // Per-status counts over the configured set (ADR-0026), computed by the shared
  // state module (ADR-0030).
  const { counts, malformed } = boardCounts(env, config);
  const git = gitState(env.projectDir);
  const art = artifactCounts(env);
  const servers = projectMcpServers(env.projectDir);

  const project = basename(env.projectDir) || env.projectDir;
  const want = section?.trim().toLowerCase();
  const known = !!want && GROUP_ORDER.includes(want);

  const lines = [
    ...renderBanner(version),
    "",
    "---",
    "",
    ...renderSummary(project, config, git, counts, malformed, art),
    "",
    ...renderMcpServers(servers),
    "",
    ...renderCommands(want, known),
  ];

  // Widget payload for MCP Apps hosts (ADR-0024). The terminal renders the text
  // above and ignores this; a rich host renders `ui://marvin/help.html` from it.
  const help: HelpState = {
    version,
    slogan: SLOGAN,
    project,
    git: {
      branch: git.branch,
      base_branch: config.base_branch,
      has_git: git.has_git,
      has_gh: git.has_gh,
    },
    // Configured order (the project's lifecycle order — todo → … → blocked by
    // default), not the role-grouped `orderedStatuses`, so the board reads in the
    // order the author defined and the widget/mockup agree.
    statuses: config.statuses.map((s) => ({
      key: s.key,
      role: s.role,
      count: counts[s.key] ?? 0,
    })),
    artifacts: {
      specs: art.specs,
      handoffs: art.handoffs,
      audits: art.audits,
      lessons: art.lessons,
    },
    servers,
    groups: GROUP_ORDER.filter((g) => PROMPTS.some((p) => groupOf(p.name) === g)).map((group) => ({
      group,
      blurb: GROUP_BLURBS[group] ?? "",
    })),
    // Full reference, registry order within each group. Names from the registry
    // (drift-proof); blurb + description + phrases are curated (each guarded to full
    // coverage by a test) with a `""` / `[]` fallback, so a missing entry ships an
    // empty value the test catches rather than silent drift. `example` is genuinely
    // optional — it is omitted entirely when absent, so the widget renders the `e.g.`
    // line only when a command has one. `phrases` (the widget's "two ways to call"
    // prose examples, ADR-0024) come from the shared help-content source both the
    // tool and the widget fixture import, so the preview can never drift.
    commands: GROUP_ORDER.flatMap((group) =>
      PROMPTS.filter((p) => groupOf(p.name) === group).map((p) => {
        const example = COMMAND_EXAMPLES[p.name];
        return {
          group,
          name: p.name,
          blurb: COMMAND_BLURBS[p.name] ?? "",
          description: COMMAND_DETAILS[p.name] ?? "",
          ...(example ? { example } : {}),
          phrases: [...(COMMAND_PROMPTS[p.name] ?? [])],
          human: HUMAN_RUN.has(p.name),
        };
      }),
    ),
  };

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: help,
  };
}

/**
 * The heading — a plain-text `>_ MARVIN` wordmark heading, the slogan, and the
 * version. The terminal markdown door has no ANSI, so the CLI uses a heading in
 * place of a coloured wordmark; the rich `ui://` widget draws the gradient
 * wordmark instead (ADR-0024).
 */
function renderBanner(version: string): string[] {
  return ["# >_ MARVIN", "", SLOGAN, `_v${version}_`];
}

/**
 * The project summary — everything that depends on *this* repo: the project
 * name, git branch + base, the board counts over the configured status set,
 * and the artifact inventory. Regenerated on every call.
 */
function renderSummary(
  project: string,
  config: Config,
  git: ReturnType<typeof gitState>,
  counts: Record<string, number>,
  malformed: number,
  art: ReturnType<typeof artifactCounts>,
): string[] {
  const gitVal = git.branch
    ? `\`${git.branch}\` · base \`${config.base_branch}\``
    : "not in a git repo";
  const board = config.statuses
    .map((s) => {
      const n = counts[s.key] ?? 0;
      return `${s.key} ${n > 0 ? `**${n}**` : "0"}`;
    })
    .join(" · ");
  const artifacts = `specs ${art.specs} · handoffs ${art.handoffs} · audits ${art.audits} · lessons ${art.lessons}`;

  const lines = [
    "## Summary",
    `- **project** — \`${project}\``,
    `- **git** — ${gitVal}`,
    `- **board** — ${board}`,
    `- **artifacts** — ${artifacts}`,
  ];

  const notes: string[] = [];
  if (!git.has_git) notes.push("git missing — lifecycle commands disabled");
  if (!git.has_gh) notes.push("gh missing — PR commands print the command instead");
  if (notes.length > 0) lines.push(`- _${notes.join("; ")}._`);
  if (malformed > 0) {
    lines.push(`- ⚠ ${malformed} malformed board file${malformed === 1 ? "" : "s"}`);
  }
  return lines;
}

/**
 * The MCP servers configured for this project (union of `.mcp.json` and the
 * Claude settings files), lit (`●`, enabled) or dim (`○`, disabled). This is
 * what is *configured* with its enable state, not a live-connection probe.
 */
function renderMcpServers(servers: McpServerState[]): string[] {
  return [
    "## MCP servers",
    servers.length
      ? servers.map((s) => `${s.enabled ? "●" : "○"} \`${s.name}\``).join(" · ")
      : "_none configured for this project_",
  ];
}

/**
 * The command reference. Group order and command names come from the registry
 * (`PROMPTS`, drift-proof); the per-group purpose lines come from the authored
 * `GROUP_BLURBS`; per-command synopses come from the curated `COMMAND_BLURBS`
 * (falling back to the prompt's own description only if a blurb is ever missing).
 *
 * Default view: a `## Command groups` table-of-contents, then `## Commands` —
 * the full per-command reference grouped under a `### <group>` heading each.
 * A known `section` narrows to that one group's detail; an unknown one falls
 * back to the full reference with a hint.
 */
function renderCommands(want?: string, known?: boolean): string[] {
  // Focused view: one group's detail, each command as a full `/marvin:<name>`
  // invocation with its synopsis.
  if (known && want) {
    const inGroup = PROMPTS.filter((p) => groupOf(p.name) === want);
    const lines = [`## Commands · ${want}`, "", `_${GROUP_BLURBS[want] ?? ""}_`, ""];
    for (const p of inGroup) {
      const flag = HUMAN_RUN.has(p.name) ? " 👤" : "";
      lines.push(`- \`/marvin:${p.name}\`${flag} — ${blurbOf(p.name, p.description)}`);
    }
    return lines;
  }

  const lines: string[] = [];

  // Command groups — the table of contents (group + blurb, no counts).
  lines.push("## Command groups");
  if (want) {
    lines.push(`_Unknown group \`${want}\` — showing all. Valid: ${GROUP_ORDER.join(", ")}._`);
  }
  for (const group of GROUP_ORDER) {
    if (PROMPTS.some((p) => groupOf(p.name) === group)) {
      lines.push(`- \`${group}\` — ${GROUP_BLURBS[group] ?? ""}`);
    }
  }

  // Commands — the full per-command reference, grouped by `### <group>`. Bare
  // names (no `/marvin:` prefix) keep the lines scannable; 👤 marks human-run.
  lines.push(
    "",
    "## Commands",
    "Run as `/marvin:<name>` or just ask in chat. 👤 = human-run only.",
  );
  for (const group of GROUP_ORDER) {
    const inGroup = PROMPTS.filter((p) => groupOf(p.name) === group);
    if (inGroup.length === 0) continue;
    lines.push("", `### ${group}`);
    for (const p of inGroup) {
      const flag = HUMAN_RUN.has(p.name) ? " 👤" : "";
      lines.push(`- \`${p.name}\`${flag} — ${blurbOf(p.name, p.description)}`);
    }
  }
  return lines;
}

/** Curated blurb for a command, falling back to the prompt description. */
function blurbOf(name: string, description: string): string {
  return COMMAND_BLURBS[name] ?? shortDesc(description);
}
