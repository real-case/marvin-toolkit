import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type {
  AdrCorpusSummary,
  DashboardAudits,
  DashboardHandoff,
  DashboardSpec,
  DashboardState,
  MetricsSummary,
  TaskCard,
  UsageSummary,
  UsageTopEntry,
  VerificationFreshness,
} from "@marvin-toolkit/mcp-shared/contracts";
import type { ServerEnv } from "../lib/env.js";
import { loadConfig, type LoadedConfig } from "../storage/config.js";
import { lessonsStats } from "../storage/lessons.js";
import { listRecords } from "../storage/metrics.js";
import { fmtMs, summarizeSeries, toSeriesRecords } from "../lib/metrics-series.js";
import { ADR_STATUSES, readAdrCorpus, resolveAdrDir, type AdrStatus } from "../storage/adr.js";
import { resolveSpecDir } from "../storage/spec.js";
import { orderedStatuses } from "../storage/schema.js";
import {
  artifactCounts,
  auditDigest,
  boardCounts,
  boardDigest,
  commandGroups,
  gitState,
  handoffDigest,
  specDigest,
} from "../lib/state.js";
import { projectMcpServers } from "../lib/help-data.js";
import { DASHBOARD_WIDGET_URI } from "../resources/widgets.js";

/**
 * The whole-toolbox dashboard (ADR-0030): one deterministic aggregation over
 * everything marvin knows about the project — board, config, git, the
 * `.marvin/` artifact inventories with freshness, the lessons store, the ADR
 * corpus, and the local usage log when one exists. Renders a sectioned
 * terminal report and emits the extended `DashboardState` as
 * `structuredContent` (ADR-0024 data-first staging — the future widget
 * consumes the same payload). Every section degrades to a sensible zero state
 * on a fresh project.
 */

const SECTION_ORDER = [
  "project",
  "board",
  "work",
  "handoffs",
  "audits",
  "artifacts",
  "adr",
  "lessons",
  "metrics",
  "usage",
  "commands",
] as const;

const DashboardInput = z.object({
  section: z
    .string()
    .optional()
    .describe(`Narrow the text report to one section: ${SECTION_ORDER.join(", ")}.`),
});

export function buildDashboardTool(env: ServerEnv, version: string): AnyToolDef {
  return defineTool({
    name: "dashboard",
    description:
      "Whole-toolbox state report (ADR-0030): project paths/config/git/MCP servers, task-board " +
      "counters, the current-work digest (active board cards + pipeline specs in flight), recent " +
      "handoffs with their age, audit findings by severity for the newest security and refactor " +
      "report, artifact inventories with freshness (task specs + verification.md age, handoffs), " +
      "lessons statistics, the " +
      "ADR corpus by status, the task-metrics series in one line (ADR-0043), and the local usage summary when .marvin/usage/events.jsonl exists. " +
      'Answers "what state is the toolbox in?" — the command index stays on the `help` tool. Pass ' +
      `\`section\` (${SECTION_ORDER.join("/")}) to narrow the text; structuredContent always ` +
      "carries the full DashboardState. Works on a fresh project — missing directories render as " +
      "zeros.",
    inputSchema: DashboardInput,
    // Bind the dashboard `ui://` widget for MCP Apps hosts (ADR-0024 #8). A plain
    // object literal — no ext-apps import — so tsup never bundles the SDK into
    // dist/server.js. The terminal ignores `_meta` and renders the text content.
    meta: { ui: { resourceUri: DASHBOARD_WIDGET_URI } },
    handler: (input) => {
      // Fresh config per call — `task config` edits and hand edits must apply
      // immediately (the help-tool precedent).
      const loaded = loadConfig(env.configPath, env.projectDir);
      return Promise.resolve(renderDashboard(env, loaded, version, input));
    },
  });
}

type DashboardInput = z.infer<typeof DashboardInput>;

function renderDashboard(
  env: ServerEnv,
  loaded: LoadedConfig,
  version: string,
  input: DashboardInput,
): ToolResult {
  const { config, warning: configWarning, settingWarnings } = loaded;
  // ── aggregate (every source degrades to zeros on a fresh project) ────────
  const board = boardCounts(env, config);
  const git = gitState(env.projectDir);
  const verification = verificationFreshness(env.projectDir);
  // Resolve the spec directory ONCE and hand it to both readers (ADR-0037): the
  // Artifacts count and the current-work digest must read the same place, or one
  // render names two directories. Mirrors `adrSummary(adrDir.rel, …)` below.
  const specDir = resolveSpecDir(env.projectDir, config.spec);
  const artifacts = { ...artifactCounts(env, specDir), verification };
  const lessons = lessonsStats(env.memoryDir);
  // The task-metrics series in one line (ADR-0043 §5) — every record under the
  // metrics directory, the roll-ups among them, the newest, and two medians.
  // Q11 is not read here: it costs a `gh` round-trip per record and belongs to
  // `/marvin:task-metrics`, not to a dashboard render.
  const metrics: MetricsSummary = summarizeSeries(toSeriesRecords(listRecords(env.metricsDir)));
  const adrDir = resolveAdrDir(env.projectDir, config.adr);
  const adr = adrSummary(adrDir.rel, readAdrCorpus(adrDir));
  const usage = readUsageSummary(env.projectDir);
  const groups = commandGroups();
  // v2 sections (ADR-0024) — always emitted, empty rather than absent, so a
  // consumer can tell "the dashboard ran and found nothing" from the `help`
  // tool's narrower payload. `auditDigest` honours MARVIN_SECURITY_DIR, matching
  // the `report` tool.
  const servers = projectMcpServers(env.projectDir);
  const currentTasks = {
    board: boardDigest(env, config),
    specs: specDigest(env.projectDir, specDir),
  };
  const handoffs = handoffDigest(env.handoffDir);
  const audits = auditDigest({
    security: env.securityDir,
    refactor: join(env.projectDir, ".marvin", "refactor"),
  });

  // ── text report, section by section ───────────────────────────────────────
  const sections: Record<(typeof SECTION_ORDER)[number], string[]> = {
    project: [
      "## Project",
      `- Project: \`${env.projectDir}\``,
      `- Config: \`${env.configPath}\`${existsSync(env.configPath) ? "" : " _(not created yet)_"}`,
      `- Base branch: \`${config.base_branch}\``,
      `- git: ${git.has_git ? "✓" : "✗"} · gh: ${git.has_gh ? "✓" : "✗"} · branch: \`${git.branch ?? "(not in a git repo)"}\``,
      `- MCP servers: ${
        servers.length > 0
          ? servers.map((s) => `\`${s.name}\` ${s.enabled ? "✓" : "✗"}`).join(" · ")
          : "_none configured_"
      }`,
      ...(configWarning ? [`- ⚠ config: ${configWarning} — using defaults`] : []),
      // Per-setting fallbacks, not a whole-file one: the rest of the config
      // stands, so these carry no "using defaults" clause.
      ...settingWarnings.map((w) => `- ⚠ config: ${w}`),
    ],
    board: [
      "## Board",
      ...orderedStatuses(config).map((s) => {
        const roleNote = s.key === s.role ? "" : ` (${s.role})`;
        return `- ${s.key}${roleNote}: ${board.counts[s.key] ?? 0}`;
      }),
      ...(board.malformed > 0 ? [`- ⚠ malformed files: ${board.malformed}`] : []),
    ],
    work: ["## Current work", ...renderWork(currentTasks.board, currentTasks.specs, specDir.rel)],
    handoffs: ["## Handoffs", ...renderHandoffs(handoffs)],
    audits: [
      "## Audits",
      renderAuditArea("Security", audits.security, "/marvin:sec-scan"),
      renderAuditArea("Refactor", audits.refactor, "/marvin:refactor-audit"),
    ],
    // Security and refactor are NOT counted here. The Audits section above
    // reports their findings, and a document count beside a finding count
    // measured two different things (every report versus the newest parseable
    // one), which read as a contradiction. `artifacts.audits` still carries the
    // security document count in the payload for the widget's Artifacts card.
    artifacts: [
      "## Artifacts",
      // The trailing slash marks it as a directory, as the Handoffs line does;
      // `rel` never carries one, whatever tier produced it.
      `- Specs: ${artifacts.specs} · \`${specDir.rel}/\``,
      `- Verification: ${verification.exists ? `\`verification.md\` ${days(verification.age_days ?? 0)} old` : "none yet"}`,
      `- Handoffs: ${artifacts.handoffs} · \`.marvin/handoff/\``,
    ],
    adr: [
      "## Decisions (ADR)",
      `- Corpus: \`${adr.dir}\` (${adrDir.source}) · ${adr.total} record(s)`,
      ...(adr.total > 0
        ? [`- ${nonZero(adr.counts).join(" · ")}`]
        : ["- _No records yet — `/marvin:adr` drafts the first one._"]),
      ...(adr.malformed > 0 ? [`- ⚠ malformed: ${adr.malformed} file(s)`] : []),
    ],
    lessons: [
      "## Lessons",
      lessons.total > 0
        ? `- ${lessons.total} lesson(s) — ${nonZero(lessons.by_type).join(" · ")}`
        : "- _No lessons captured yet in `.marvin/memory`._",
    ],
    metrics: ["## Metrics", ...renderMetrics(metrics)],
    usage: [
      "## Usage",
      ...(usage === null
        ? [
            "- _No usage log yet — the local `.marvin/usage/` events log arrives with usage telemetry (ADR-0030)._",
          ]
        : renderUsage(usage)),
    ],
    commands: [
      "## Commands",
      `- ${groups.reduce((n, g) => n + g.count, 0)} prompt(s): ${groups.map((g) => `${g.group} ${g.count}`).join(" · ")}`,
      "- Full index: `/marvin:help`",
    ],
  };

  const want = input.section?.trim().toLowerCase();
  const known = !!want && (SECTION_ORDER as readonly string[]).includes(want);
  const lines: string[] = [`# marvin · toolbox dashboard · v${version}`, ""];
  if (want && !known) {
    lines.push(
      `_Unknown section \`${want}\` — showing all. Valid: ${SECTION_ORDER.join(", ")}._`,
      "",
    );
  }
  for (const name of SECTION_ORDER) {
    if (known && name !== want) continue;
    lines.push(...sections[name], "");
  }

  // ── widget payload (ADR-0024): the extended DashboardState, always full —
  // the section filter narrows the text only.
  const state: DashboardState = {
    version,
    paths: { project: env.projectDir, tasks_dir: env.tasksDir, config_path: env.configPath },
    config: {
      base_branch: config.base_branch,
      tracker_url_template: config.tracker_url_template,
      ...(config.gates ? { gates: config.gates } : {}),
      statuses: config.statuses,
    },
    board_counts: board.counts,
    board_role_counts: board.roleCounts,
    git,
    artifacts,
    command_groups: groups,
    adr,
    lessons,
    metrics,
    ...(usage ? { usage } : {}),
    servers,
    current_tasks: currentTasks,
    handoffs,
    audits,
  };

  return {
    content: [{ type: "text", text: lines.join("\n").trimEnd() }],
    structuredContent: state,
  };
}

// ── aggregation helpers ─────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** `verification.md` presence + age (the task pipeline's gate artifact). */
function verificationFreshness(projectDir: string): VerificationFreshness {
  const path = join(projectDir, ".marvin", "task", "verification.md");
  const age = fileAgeDays(path);
  return age === null ? { exists: false, age_days: null } : { exists: true, age_days: age };
}

/** Whole days since the file's last write; null when it cannot be stat-ed. */
function fileAgeDays(path: string): number | null {
  try {
    return Math.max(0, Math.floor((Date.now() - statSync(path).mtimeMs) / DAY_MS));
  } catch {
    return null;
  }
}

/** Corpus roll-up: every status of the closed vocabulary present, even at 0. */
function adrSummary(rel: string, corpus: ReturnType<typeof readAdrCorpus>): AdrCorpusSummary {
  const counts = Object.fromEntries(ADR_STATUSES.map((s) => [s, 0])) as Record<AdrStatus, number>;
  for (const r of corpus.records) counts[r.status] += 1;
  return {
    dir: rel,
    total: corpus.records.length,
    counts,
    malformed: corpus.malformed.length,
  };
}

/** How many top commands the usage section shows. */
const TOP_COMMANDS = 5;

/**
 * Defensive reader over `.marvin/usage/events.jsonl` (ADR-0030). The writer
 * ships with WP7; this parses whatever exists — one JSON object per line with
 * `ts` (ISO string), `kind` (`prompt` | `tool`), `name` — and skips anything
 * malformed (torn writes, foreign lines) without failing. No file → null, and
 * the usage section is absent from the payload.
 */
function readUsageSummary(projectDir: string): UsageSummary | null {
  const path = join(projectDir, ".marvin", "usage", "events.jsonl");
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }

  let events = 0;
  let from: string | null = null;
  let to: string | null = null;
  const tally = new Map<string, UsageTopEntry>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const { ts, kind, name } = parsed as Record<string, unknown>;
    if (typeof ts !== "string" || ts === "" || typeof name !== "string" || name === "") continue;
    if (kind !== "prompt" && kind !== "tool") continue;
    events += 1;
    // ISO timestamps compare correctly as strings.
    if (from === null || ts < from) from = ts;
    if (to === null || ts > to) to = ts;
    const key = `${kind}:${name}`;
    const entry = tally.get(key);
    if (entry) entry.count += 1;
    else tally.set(key, { kind, name, count: 1 });
  }

  const top = [...tally.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_COMMANDS);
  return { events, window: from !== null && to !== null ? { from, to } : null, top };
}

// ── rendering helpers ───────────────────────────────────────────────────────

/**
 * Current work — the two in-flight lists side by side: active board cards
 * (wip/review) and pipeline specs that have not shipped. Each is an italic
 * zero-state line when empty, so the section keeps its shape on a fresh project.
 */
function renderWork(board: TaskCard[], specs: DashboardSpec[], specDirRel: string): string[] {
  const lines: string[] = [];
  if (board.length === 0) {
    lines.push("- _No active board cards — nothing in wip or review._");
  } else {
    lines.push("- Active cards (wip/review):");
    for (const c of board) {
      lines.push(
        `  - \`${c.id}\` ${c.title} · ${c.status.key} · updated ${c.updated.slice(0, 10)}`,
      );
    }
  }
  if (specs.length === 0) {
    lines.push(`- _No pipeline specs in flight under \`${specDirRel}/\`._`);
  } else {
    lines.push("- Pipeline specs in flight:");
    for (const s of specs) lines.push(`  - ${s.id ? `\`${s.id}\` ` : ""}${s.title}`);
  }
  return lines;
}

/** Recent handoffs, newest id first, each with the age of its `created` date. */
function renderHandoffs(handoffs: DashboardHandoff[]): string[] {
  if (handoffs.length === 0) {
    return ["- _No handoffs yet — `/marvin:handoff` captures the first one._"];
  }
  return handoffs.map(
    (h) =>
      `- \`${h.slug}\` ${h.objective}${h.age_days === null ? "" : ` · ${days(h.age_days)} old`}`,
  );
}

/**
 * One audit area: findings of its newest report bucketed by severity. A `null`
 * area is "never scanned", which is deliberately distinct from a report that
 * found nothing (`0 finding(s)`).
 */
function renderAuditArea(
  label: string,
  area: DashboardAudits["security"],
  command: string,
): string {
  if (area === null) return `- ${label}: _no report yet — \`${command}\` writes one._`;
  const severities = nonZero(area.by_severity);
  return [
    `- ${label}: ${area.total} finding(s)`,
    ...(severities.length > 0 ? [severities.join(" · ")] : []),
    ...(area.newest_report ? [`\`${area.newest_report}\``] : []),
    ...(area.scanned_age_days === null ? [] : [`${days(area.scanned_age_days)} old`]),
  ].join(" · ");
}

/**
 * The task-metrics series in one line (ADR-0043 §5). The zero state names the
 * command that writes the first record, because a fresh project has none and
 * that is not a defect.
 */
function renderMetrics(m: MetricsSummary): string[] {
  if (m.records === 0) {
    return [
      "- _No metrics records yet — the next `/marvin:task-implement` on a sealed spec creates one under `.marvin/metrics/`, and `/marvin:task-deliver` fills it in (ADR-0043/0044)._",
    ];
  }
  // `empty` sits beside the total on purpose (ADR-0044): the seal anchor creates
  // a record per started run, so a bare record count reads as "tasks measured"
  // while counting files nothing has written to.
  const parts = [`${m.records} record(s)`, `${m.rolled_up} rolled up`];
  if (m.empty > 0) parts.push(`${m.empty} started but empty`);
  if (m.newest) parts.push(`newest \`${m.newest.slug}\` (${m.newest.rolled_up_at.slice(0, 10)})`);
  if (m.median_active_ms !== null) parts.push(`median active time ${fmtMs(m.median_active_ms)}`);
  if (m.median_spec_gaps !== null) parts.push(`spec gaps per task ${m.median_spec_gaps}`);
  return [`- ${parts.join(" · ")}`, "- Full series: `/marvin:task-metrics`"];
}

function renderUsage(usage: UsageSummary): string[] {
  if (usage.events === 0) return ["- Usage log present but empty — 0 event(s)."];
  const window = usage.window
    ? ` between ${usage.window.from.slice(0, 10)} and ${usage.window.to.slice(0, 10)}`
    : "";
  const lines = [`- ${usage.events} event(s)${window}`];
  if (usage.top.length > 0) {
    lines.push(
      `- Top: ${usage.top.map((t) => `\`${t.name}\` (${t.kind}) ×${t.count}`).join(" · ")}`,
    );
  }
  return lines;
}

/** `key: n` fragments for the non-zero entries of a counts record. */
function nonZero(counts: Record<string, number>): string[] {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}: ${n}`);
}

/** `N day(s)` with the house pluralisation style. */
function days(n: number): string {
  return `${n} day(s)`;
}
