import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type {
  AdrCorpusSummary,
  DashboardState,
  RefactorInventory,
  SecurityInventory,
  UsageSummary,
  UsageTopEntry,
  VerificationFreshness,
} from "@marvin-toolkit/mcp-shared/contracts";
import type { ServerEnv } from "../lib/env.js";
import { loadConfig } from "../storage/config.js";
import { lessonsStats } from "../storage/lessons.js";
import { ADR_STATUSES, readAdrCorpus, resolveAdrDir, type AdrStatus } from "../storage/adr.js";
import { orderedStatuses, type Config } from "../storage/schema.js";
import { artifactCounts, commandGroups, gitState, kanbanCounts } from "../lib/state.js";

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
  "kanban",
  "artifacts",
  "adr",
  "lessons",
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
      "Whole-toolbox state report (ADR-0030): project paths/config/git, kanban board counters, " +
      "artifact inventories with freshness (task specs + verification.md age, security reports + " +
      "newest-report age, refactor registers by kind, handoffs), lessons statistics, the ADR corpus " +
      'by status, and the local usage summary when .marvin/usage/events.jsonl exists. Answers "what ' +
      'state is the toolbox in?" — the command index stays on the `help` tool. Pass `section` ' +
      `(${SECTION_ORDER.join("/")}) to narrow the text; structuredContent always carries the full ` +
      "DashboardState. Works on a fresh project — missing directories render as zeros.",
    inputSchema: DashboardInput,
    handler: (input) => {
      // Fresh config per call — `task config` edits and hand edits must apply
      // immediately (the help-tool precedent).
      const loaded = loadConfig(env.configPath, env.projectDir);
      return Promise.resolve(renderDashboard(env, loaded.config, loaded.warning, version, input));
    },
  });
}

type DashboardInput = z.infer<typeof DashboardInput>;

function renderDashboard(
  env: ServerEnv,
  config: Config,
  configWarning: string | null,
  version: string,
  input: DashboardInput,
): ToolResult {
  // ── aggregate (every source degrades to zeros on a fresh project) ────────
  const kanban = kanbanCounts(env, config);
  const git = gitState(env.projectDir);
  const verification = verificationFreshness(env.projectDir);
  const artifacts = { ...artifactCounts(env), verification };
  const security: SecurityInventory = {
    reports: artifacts.audits,
    newest_age_days: newestAgeDays(join(env.projectDir, ".marvin", "security")),
  };
  const refactor = refactorInventory(env.projectDir);
  const lessons = lessonsStats(env.memoryDir);
  const adrDir = resolveAdrDir(env.projectDir, config.adr);
  const adr = adrSummary(adrDir.rel, readAdrCorpus(adrDir));
  const usage = readUsageSummary(env.projectDir);
  const groups = commandGroups();

  // ── text report, section by section ───────────────────────────────────────
  const sections: Record<(typeof SECTION_ORDER)[number], string[]> = {
    project: [
      "## Project",
      `- Project: \`${env.projectDir}\``,
      `- Config: \`${env.configPath}\`${existsSync(env.configPath) ? "" : " _(not created yet)_"}`,
      `- Base branch: \`${config.base_branch}\``,
      `- git: ${git.has_git ? "✓" : "✗"} · gh: ${git.has_gh ? "✓" : "✗"} · branch: \`${git.branch ?? "(not in a git repo)"}\``,
      ...(configWarning ? [`- ⚠ config: ${configWarning} — using defaults`] : []),
    ],
    kanban: [
      "## Kanban",
      ...orderedStatuses(config).map((s) => {
        const roleNote = s.key === s.role ? "" : ` (${s.role})`;
        return `- ${s.key}${roleNote}: ${kanban.counts[s.key] ?? 0}`;
      }),
      ...(kanban.malformed > 0 ? [`- ⚠ malformed files: ${kanban.malformed}`] : []),
    ],
    artifacts: [
      "## Artifacts",
      `- Specs: ${artifacts.specs} · \`.marvin/task/\``,
      `- Verification: ${verification.exists ? `\`verification.md\` ${days(verification.age_days ?? 0)} old` : "none yet"}`,
      `- Security reports: ${security.reports} · \`.marvin/security/\`${
        security.newest_age_days !== null ? ` (newest ${days(security.newest_age_days)} old)` : ""
      }`,
      `- Refactor: ${refactor.audits} audit · ${refactor.smells} smells · ${refactor.plans} plan register(s) · \`.marvin/refactor/\``,
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
    kanban_counts: kanban.counts,
    kanban_role_counts: kanban.roleCounts,
    git,
    artifacts,
    command_groups: groups,
    adr,
    security,
    refactor,
    lessons,
    ...(usage ? { usage } : {}),
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

/** Age of the newest `.md` in a directory; null when none exists. */
function newestAgeDays(dir: string): number | null {
  if (!existsSync(dir)) return null;
  let newest: number | null = null;
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const mtime = statSync(join(dir, f)).mtimeMs;
      if (newest === null || mtime > newest) newest = mtime;
    }
  } catch {
    return null;
  }
  return newest === null ? null : Math.max(0, Math.floor((Date.now() - newest) / DAY_MS));
}

/** Registers/plans by kind, from the ADR-0029 filename convention. */
function refactorInventory(projectDir: string): RefactorInventory {
  const dir = join(projectDir, ".marvin", "refactor");
  const inv = { audits: 0, smells: 0, plans: 0 };
  if (!existsSync(dir)) return inv;
  try {
    for (const f of readdirSync(dir)) {
      if (/^\d+-audit-.*\.md$/.test(f)) inv.audits += 1;
      else if (/^\d+-smells-.*\.md$/.test(f)) inv.smells += 1;
      else if (/^\d+-plan-.*\.md$/.test(f)) inv.plans += 1;
    }
  } catch {
    // an unreadable directory counts as empty — the zero-state doctrine
  }
  return inv;
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
