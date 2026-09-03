import { join } from "node:path";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { MetricEvent, MetricsSeries, TaskMetrics } from "@marvin-toolkit/mcp-shared/contracts";
import { projectConfigPath, projectScopedDir, type ServerEnv } from "../lib/env.js";
import { inGitRepo, isIgnored } from "../lib/git.js";
import {
  collectRollupInputs,
  collectSeriesRecords,
  findSpecBySlug,
  readShippedSpecs,
  relFromRoot,
} from "../lib/metrics-collect.js";
import { rollUpMetrics } from "../lib/metrics-rollup.js";
import {
  SERIES_METRICS,
  aggregateSeries,
  fmtMs,
  fmtUnit,
  type SeriesFilters,
} from "../lib/metrics-series.js";
import { loadConfig } from "../storage/config.js";
import type { Config, SpecConfig } from "../storage/schema.js";
import {
  DOR_VERDICTS,
  FIX_LOOPS,
  METRIC_CRITICS,
  METRIC_EVENT_KINDS,
  METRIC_EVENT_SOURCES,
  METRIC_GATES,
  MetricEventSchema,
  OPEN_ITEM_CLASSIFICATIONS,
  REQUIRED_EVENT_FIELDS,
  SLUG_RE,
  TERMINAL_VERDICTS,
  appendMetricEvent,
  appendTaskMetrics,
  findRecord,
  metricsRecordPath,
  readRecord,
  recordBasenameForSpec,
} from "../storage/metrics.js";

/**
 * The `metrics` tool (ADR-0043) — the one writer of `.marvin/metrics/`, the
 * fourteenth tool. Three actions:
 *
 * - `record` appends one live ` ```json metric-event ` block for exactly the
 *   information that context compaction would otherwise destroy — a fix-cycle
 *   round, a SPEC GAP, an item left open at a budget, a critic dispatch and its
 *   verdict, a DoR gate call. The pipeline prose calls it at each such site.
 * - `rollup` derives the terminal ` ```json task-metrics ` block from the
 *   artifacts already on disk and appends it; `task-deliver` calls it after the
 *   delivery gate allows and before the commit, so the record ships in the same
 *   commit as the work. A second delivery appends a second block; readers take
 *   the last.
 * - `series` reads every record back and aggregates the three groups — count,
 *   median, mean and maximum per metric, over the records where the field is
 *   present — with a coverage line, `type` and `since` filters, and a `slug`
 *   mode that renders one record in full. `/marvin:task-metrics` is its door.
 *
 * The input is `.strict()`, like `spec` and `report`: a caller who mistypes a
 * key gets an error, not a successful-looking call that recorded nothing.
 * The slug is validated as kebab-case and REFUSED rather than sanitised — it
 * becomes a filename, and a sanitised slug writes a record under a name the
 * caller never passes again.
 */

const MetricsInput = z.object({
  action: z
    .enum(["record", "rollup", "series"])
    .describe(
      "record: append one live event to the spec's metrics record (a fix-cycle round, a SPEC GAP, an open item, a critic dispatch or verdict, a DoR gate call). rollup: derive the terminal task-metrics block from the spec, the journals, the verify-result block, the receipts and git, and append it — called by /marvin:task-deliver after the gate allows and before the commit. series: aggregate every record — count, median, mean and maximum per metric over the records where it is present — with a coverage line; narrow with type / since, or pass slug to render one record in full.",
    ),
  slug: z
    .string()
    .optional()
    .describe(
      "The spec's kebab-case slug. Required for record and rollup — it names the record (`.marvin/metrics/<NNN>-<slug>.md`, sharing the spec's basename), so it is rejected rather than sanitised. Optional for series: renders that one record in full instead of the aggregate.",
    ),
  projectRoot: z
    .string()
    .optional()
    .describe("Project root. Defaults to CLAUDE_PROJECT_DIR / cwd."),
  source: z
    .enum(METRIC_EVENT_SOURCES)
    .optional()
    .describe("record: which prose site is writing — step ids collide across the pipelines."),
  step: z
    .string()
    .optional()
    .describe('record: the writer\'s own step id ("7F", "8B", "6F", "fix-cycle", "§3").'),
  kind: z
    .enum(METRIC_EVENT_KINDS)
    .optional()
    .describe(
      "record: what happened. fix-round needs loop + round; spec-gap needs detail; open-item needs classification + detail; critic-dispatch needs critic + pass; critic-verdict needs critic + pass + verdict + blockers + warnings; gate-call needs gate + call + verdict.",
    ),
  detail: z
    .string()
    .optional()
    .describe(
      "record: one line, for spec-gap and open-item. Never a credential, token or customer datum.",
    ),
  loop: z
    .enum(FIX_LOOPS)
    .optional()
    .describe("record (fix-round): which fix-cycle loop spent the round."),
  round: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("record (fix-round): the round number within that loop, 1-based."),
  classification: z
    .enum(OPEN_ITEM_CLASSIFICATIONS)
    .optional()
    .describe("record (open-item): how the item left open at the limit was classified."),
  critic: z
    .enum(METRIC_CRITICS)
    .optional()
    .describe("record (critic-dispatch / critic-verdict): which critic."),
  pass: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "record (critic-dispatch / critic-verdict): the dispatch number for this critic on this task; a NEEDS_CONTEXT re-dispatch reuses it.",
    ),
  verdict: z
    .string()
    .optional()
    .describe(
      `record: the verdict. critic-verdict: ${TERMINAL_VERDICTS.join(" | ")}. gate-call: ${DOR_VERDICTS.join(" | ")}.`,
    ),
  blockers: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("record (critic-verdict): the critic's blocker count."),
  warnings: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("record (critic-verdict): the critic's warning count."),
  gate: z
    .enum(METRIC_GATES)
    .optional()
    .describe("record (gate-call): which deterministic gate was called."),
  call: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "record (gate-call): the call number for this gate on this task, incremented per re-run.",
    ),
  contractSha: z
    .string()
    .optional()
    .describe("record: the seal in force, when the writer knows one."),
  base: z
    .string()
    .optional()
    .describe(
      "rollup: the git ref scope drift is measured against. Defaults to the config's base_branch.",
    ),
  type: z
    .enum(["feature", "bugfix"])
    .optional()
    .describe("series: aggregate only the records of this spec type."),
  since: z
    .string()
    .optional()
    .describe("series: aggregate only the records rolled up on or after this date (YYYY-MM-DD)."),
});
type MetricsInput = z.infer<typeof MetricsInput>;

const METRICS_INPUT_FIELDS = Object.keys(MetricsInput.shape).join(", ");
const MetricsInputStrict = MetricsInput.strict(
  `unknown argument for the metrics tool — it accepts only: ${METRICS_INPUT_FIELDS}. ` +
    `An event's fields are named by its kind (see the kind description); a misspelt key would otherwise be dropped and the event recorded without it.`,
);

export function buildMetricsTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "metrics",
    description:
      'The task-metrics record under .marvin/metrics/ (ADR-0043), one committed file per spec. action: "record" appends one live metric-event — a fix-cycle round, a SPEC GAP, an item deferred or blocked at a loop\'s limit, a critic dispatch or verdict with its pass number, a DoR gate call with its verdict — the counters that context compaction otherwise destroys. action: "rollup" derives the terminal task-metrics block at delivery from the spec, the progress / oracle / verification-run journals, the verify-result block, the critique receipts and git: time (intake, implementation, time to first green, gate efficiency, oracle and gate and critic durations), quality (scope drift, oracle strength, red-green completeness, not-run gates, freshness waivers, critic axes, spec gaps, open items, DoR first-call, oracle resolution) and rework (reseals, critic passes, fix rounds, runs before green), each null when its source was absent, plus the sources map that says so. action: "series" aggregates every record — count, median, mean and maximum per metric over the records where it is present, coverage against the shipped corpus, review-fix commits and escaped defects computed at query time — narrowed by type / since, or one record in full with slug; the door is /marvin:task-metrics. Strict input: an unknown key is an error.',
    inputSchema: MetricsInputStrict,
    handler: (input) => Promise.resolve(runMetrics(input, env)),
  });
}

function runMetrics(input: MetricsInput, env: ServerEnv): ToolResult {
  const projectRoot = input.projectRoot ?? env.projectDir;
  const slug = input.slug?.trim();
  // Fail closed BEFORE any path is joined: the slug becomes a filename.
  if (slug !== undefined && !SLUG_RE.test(slug)) {
    return errText(
      `\`slug\` \`${slug}\` is not kebab-case (${SLUG_RE.source}) — nothing was written. ` +
        `The slug names the record, so it is rejected rather than rewritten.`,
    );
  }
  // Fresh config per call, from the config that governs THIS root.
  const { config } = loadConfig(projectConfigPath(env, projectRoot), projectRoot);
  const dir = projectScopedDir(env, projectRoot, env.metricsDir, "metrics");
  if (input.action === "series") return series(input, slug, projectRoot, dir, config);
  if (!slug) {
    return errText(
      `\`action: "${input.action}"\` needs a \`slug\` — it names the spec whose record is written.`,
    );
  }
  return input.action === "record"
    ? recordEvent(input, slug, projectRoot, dir, config.spec)
    : rollup(input, env, slug, projectRoot, dir, config);
}

/**
 * The record's path for a slug: an existing record first (so a slug never gets
 * two files), else the spec's own basename (ADR-0043 §1), else `<slug>.md` for
 * a record written against a draft the corpus cannot yet see.
 */
function recordPathFor(
  dir: string,
  slug: string,
  projectRoot: string,
  specConfig: SpecConfig | undefined,
): string {
  const existing = findRecord(dir, slug);
  if (existing) return existing;
  const specPath = findSpecBySlug(slug, projectRoot, specConfig);
  return metricsRecordPath(dir, specPath ? recordBasenameForSpec(specPath) : slug);
}

const EVENT_FIELDS = [
  "detail",
  "loop",
  "round",
  "classification",
  "critic",
  "pass",
  "verdict",
  "blockers",
  "warnings",
  "gate",
  "call",
] as const;

function recordEvent(
  input: MetricsInput,
  slug: string,
  projectRoot: string,
  dir: string,
  specConfig: SpecConfig | undefined,
): ToolResult {
  const missing = (["source", "step", "kind"] as const).filter(
    (k) => input[k] === undefined || String(input[k]).trim() === "",
  );
  if (missing.length > 0) {
    return errText(
      `\`action: "record"\` needs ${missing.map((m) => `\`${m}\``).join(", ")} — an event that cannot ` +
        `say who wrote it, at which step, or what happened is not one the roll-up can count.`,
    );
  }
  const candidate: Record<string, unknown> = {
    slug,
    source: input.source,
    step: input.step,
    kind: input.kind,
    contract_sha: input.contractSha ?? null,
    at: new Date().toISOString(),
  };
  for (const field of EVENT_FIELDS) if (input[field] !== undefined) candidate[field] = input[field];

  // Fail closed per kind (ADR-0043 §2): a half-written event is refused, never
  // recorded, and the refusal names the kind's own field list.
  const parsed = MetricEventSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    return errText(
      `\`action: "record"\` refused — ${issues}. A \`${input.kind}\` event carries: ` +
        `${REQUIRED_EVENT_FIELDS[input.kind!].join(", ")}. Nothing was written.`,
    );
  }
  const event = parsed.data as MetricEvent;
  const path = recordPathFor(dir, slug, projectRoot, specConfig);
  appendMetricEvent(path, event);
  const record = relFromRoot(path, projectRoot);
  const payload = { action: "record", slug, record, event };
  return {
    content: [
      {
        type: "text",
        text:
          `# Metrics — ${slug}\n\n` +
          `Recorded **${event.kind}** (${event.source}, step ${event.step}).\n` +
          `**Record:** \`${record}\`\n\n` +
          "```json metric-event\n" +
          JSON.stringify(payload) +
          "\n```",
      },
    ],
    structuredContent: payload,
  };
}

function rollup(
  input: MetricsInput,
  env: ServerEnv,
  slug: string,
  projectRoot: string,
  dir: string,
  config: Config,
): ToolResult {
  const base = input.base?.trim() || config.base_branch;
  const inputs = collectRollupInputs(
    env,
    projectRoot,
    config.spec,
    slug,
    base,
    new Date().toISOString(),
  );
  const block = rollUpMetrics(inputs);

  const path = recordPathFor(dir, slug, projectRoot, config.spec);
  appendTaskMetrics(path, block);
  const record = relFromRoot(path, projectRoot);
  const terminalBlocks = readRecord(path).terminal.length;
  // A host project with a blanket `.marvin/` exclusion learns at the FIRST
  // roll-up that its series is not being committed, rather than never.
  const ignored = inGitRepo(projectRoot) ? isIgnored(record, projectRoot) : null;

  const payload = {
    action: "rollup",
    slug,
    record,
    terminal_blocks: terminalBlocks,
    ignored,
    metrics: block,
  };
  return {
    content: [
      {
        type: "text",
        text:
          renderDigest(block, record, terminalBlocks, ignored) +
          "\n\n```json task-metrics\n" +
          JSON.stringify(block) +
          "\n```",
      },
    ],
    structuredContent: payload,
  };
}

// ── the series ───────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function series(
  input: MetricsInput,
  slug: string | undefined,
  projectRoot: string,
  dir: string,
  config: Config,
): ToolResult {
  const since = input.since?.trim();
  if (since && !DATE_RE.test(since)) {
    return errText(`\`since\` \`${since}\` is not a date (YYYY-MM-DD) — nothing was aggregated.`);
  }
  const filters: SeriesFilters = {
    ...(input.type ? { type: input.type } : {}),
    ...(since ? { since } : {}),
    ...(slug ? { slug } : {}),
  };
  // Q11 costs a `gh` round-trip per rolled-up record with a delivered PR, and is
  // computed at query time and never stored (plan D7).
  const records = collectSeriesRecords(projectRoot, dir, config.spec, {
    withReviewFixCommits: true,
  });
  const shipped = readShippedSpecs(projectRoot, config.spec);
  const answer = aggregateSeries({
    dir: relFromRoot(dir, projectRoot),
    now: new Date().toISOString(),
    records,
    shipped,
    filters,
  });
  const text = slug ? renderSingle(answer, slug, dir, projectRoot) : renderSeries(answer);
  return {
    content: [
      {
        type: "text",
        text: text + "\n\n```json metrics-series\n" + JSON.stringify(answer) + "\n```",
      },
    ],
    structuredContent: answer,
  };
}

/** `slug` mode: the one record's terminal block in full, through the roll-up digest. */
function renderSingle(
  answer: MetricsSeries,
  slug: string,
  dir: string,
  projectRoot: string,
): string {
  const row = answer.records[0];
  if (!row) {
    return `# Task metrics — ${slug}\n\nNo metrics record for \`${slug}\` under \`${answer.dir}/\`.`;
  }
  if (!answer.record) {
    return (
      `# Task metrics — ${slug}\n\n` +
      `\`${answer.dir}/${row.filename}\` holds ${row.events} live event(s) and no terminal block — ` +
      `recorded, not yet rolled up. \`/marvin:task-deliver\` rolls it up after the delivery gate allows.`
    );
  }
  const recordPath = join(dir, row.filename);
  const terminal = readRecord(recordPath).terminal.length;
  const ignored = inGitRepo(projectRoot)
    ? isIgnored(relFromRoot(recordPath, projectRoot), projectRoot)
    : null;
  return renderDigest(answer.record, `${answer.dir}/${row.filename}`, terminal, ignored);
}

function renderSeries(a: MetricsSeries): string {
  const c = a.coverage;
  const filters = [
    a.filters.type ? `type ${a.filters.type}` : null,
    a.filters.since ? `since ${a.filters.since}` : null,
  ].filter((f): f is string => f !== null);
  const lines = [
    "# Task metrics — series",
    "",
    `**Directory:** \`${a.dir}/\` · **Filters:** ${filters.length ? filters.join(" · ") : "none"}`,
  ];
  if (c.records === 0) {
    lines.push(
      "",
      filters.length
        ? "_No rolled-up record matches the filters._"
        : "_No metrics records yet — the first `/marvin:task-deliver` on a spec writes one under `.marvin/metrics/` (ADR-0043)._",
    );
    return lines.join("\n");
  }
  const coverage =
    c.shipped_specs === null
      ? "no spec corpus to compare against"
      : `the series covers ${c.shipped_with_record} of ${c.shipped_specs} shipped spec(s)`;
  lines.push(
    `**Coverage:** ${c.records} record(s) · ${c.rolled_up} rolled up · ${c.events_only} recorded but not rolled up · ${coverage}`,
    "",
    "Each metric is computed over the records where it is present (`n`); an absent source is never counted as zero.",
  );
  for (const group of ["time", "quality", "rework"] as const) {
    lines.push(
      "",
      `## ${group[0]!.toUpperCase()}${group.slice(1)}`,
      "",
      "| Id | Metric | n | median | mean | max |",
      "|----|--------|---|--------|------|-----|",
    );
    for (const m of SERIES_METRICS.filter((m) => m.group === group)) {
      const s = a[group][m.key];
      if (!s) continue;
      lines.push(
        `| ${m.id} | ${m.label} | ${s.count} | ${fmtUnit(s.median, m.unit)} | ${fmtUnit(s.mean, m.unit)} | ${fmtUnit(s.max, m.unit)} |`,
      );
    }
  }
  lines.push("", "## Escaped defects (Q12)");
  if (a.escaped_defects === null) lines.push("- _no spec corpus to join_");
  else if (a.escaped_defects.pairs.length === 0) lines.push("- none credited");
  else {
    for (const p of a.escaped_defects.pairs) {
      lines.push(
        `- bugfix \`${p.bugfix}\` → credited to ${p.credited.map((s) => `\`${s}\``).join(", ")}`,
      );
    }
  }
  lines.push("", `## Records (${a.records.length})`);
  for (const r of a.records) {
    lines.push(
      `- \`${r.filename}\`${r.type ? ` ${r.type}` : ""} · ${
        r.rolled_up_at ? `rolled up ${r.rolled_up_at.slice(0, 10)}` : "not rolled up"
      } · active ${fmtMs(r.active_ms)} · ${r.events} event(s)`,
    );
  }
  return lines.join("\n");
}

// ── rendering ────────────────────────────────────────────────────────────────

const pct = (share: number) => `${Math.round(share * 100)}%`;

function renderDigest(
  b: TaskMetrics,
  record: string,
  terminalBlocks: number,
  ignored: boolean | null,
): string {
  const gitLine =
    ignored === null
      ? "not a git repository"
      : ignored
        ? "**IGNORED** — `.gitignore` excludes this record, so the series never reaches a clone; add `!.marvin/metrics/` after the `.marvin/*` exclusion"
        : "tracked";
  const src = Object.entries(b.sources)
    .map(([k, v]) => `${k} ${v === "present" ? "✓" : "✗"}`)
    .join(" · ");
  const t = b.time;
  const q = b.quality;
  const r = b.rework;
  const axesLine = (label: string, a: TaskMetrics["quality"]["critics"]["spec"]) =>
    a
      ? `${label} — compliance ${a.compliance.verdict} (${a.compliance.blockers}/${a.compliance.warnings}) · quality ${a.quality.verdict} (${a.quality.blockers}/${a.quality.warnings})`
      : `${label} — no receipt`;
  const lines = [
    `# Task metrics — ${b.slug}`,
    "",
    `**Record:** \`${record}\` · terminal blocks: ${terminalBlocks}${terminalBlocks > 1 ? " (the last is authoritative)" : ""} · git: ${gitLine}`,
    `**Spec:** type ${b.type ?? "—"} · risk ${b.risk ?? "—"} · seal \`${b.contract_sha ?? "—"}\` · base \`${b.base_branch}\` · head \`${b.head_sha?.slice(0, 7) ?? "—"}\``,
    `**Sources:** ${src}`,
    "",
    "## Time",
    `- T1 intake: ${fmtMs(t.intake_ms)}`,
    `- T2 implementation: ${fmtMs(t.implement_ms)}`,
    `- T3 to first green full run: ${fmtMs(t.first_green_ms)}`,
    `- T4 active pipeline time: ${fmtMs(t.active_ms)}`,
    `- T5 gate efficiency (wall / sum): ${t.gate_efficiency ?? "—"}`,
    `- T6 oracles: ${t.oracle_ms.length ? t.oracle_ms.map((o) => `${o.criterion} ${fmtMs(o.ms)}`).join(" · ") : "—"}`,
    `- T7 gates: ${t.gate_ms.length ? t.gate_ms.map((g) => `${g.gate} ${fmtMs(g.ms)}`).join(" · ") : "—"}`,
    `- T8 critics: ${t.critic_ms.total === null ? "—" : `${fmtMs(t.critic_ms.total)} (${t.critic_ms.dispatches.map((d) => `${d.critic.replace("marvin-tm-", "").replace("-critic", "")} #${d.pass} ${fmtMs(d.ms)}`).join(", ")})`}`,
    "",
    "## Quality",
    `- Q1 scope drift: ${q.scope_drift ? `${q.scope_drift.undeclared.length} undeclared of ${q.scope_drift.changed} changed (declared ${q.scope_drift.declared})${q.scope_drift.undeclared.length ? `: ${q.scope_drift.undeclared.join(", ")}` : ""}` : "—"}`,
    `- Q2 oracle strength: ${q.oracle_strength ? `${q.oracle_strength.executable}/${q.oracle_strength.criteria} executable (${pct(q.oracle_strength.share)})` : "—"}`,
    `- Q3 red-green (bugfix): ${q.red_green ? `${q.red_green.proven}/${q.red_green.criteria} proven (${pct(q.red_green.share)})` : "—"}`,
    `- Q4 not-run gates: ${q.not_run ? `${q.not_run.not_run}/${q.not_run.gates} (${pct(q.not_run.share)})` : "—"}`,
    `- Q5 freshness waivers: ${q.freshness_waivers ?? "—"}`,
    `- Q6 critics: ${axesLine("spec", q.critics.spec)}; ${axesLine("diff", q.critics.diff)}`,
    `- Q7 spec gaps: ${q.spec_gaps ?? "—"}`,
    `- Q8 open items: ${q.open_items ? `deferred ${q.open_items.deferred} · blocked ${q.open_items.blocked}` : "—"}`,
    `- Q9 DoR passed on first call: ${q.dor_first_call === null ? "—" : q.dor_first_call ? "yes" : "no"}`,
    `- Q10 oracle resolution: ${
      q.oracle_resolution
        ? `${
            Object.entries(q.oracle_resolution.by_source)
              .map(([s, n]) => `${s} ${n}`)
              .join(" · ") || "no runs at this seal"
          } · unresolved ${q.oracle_resolution.unresolved}`
        : "—"
    }`,
    "",
    "## Rework",
    `- R1 seals: ${r.seals ?? "—"}${r.reseals !== null ? ` (reseals ${r.reseals})` : ""}`,
    `- R2 critic passes: spec ${r.critic_passes.spec ?? "—"} · diff ${r.critic_passes.diff ?? "—"}`,
    `- R3 fix rounds: ${r.fix_rounds ? `verify-gate ${r.fix_rounds.verify_gate} · critic ${r.fix_rounds.critic} · red-green ${r.fix_rounds.red_green}` : "—"}`,
    `- R4 runs before first green: ${r.runs_before_green ?? "—"}`,
  ];
  if (b.notes.length) lines.push("", "## Notes", ...b.notes.map((n) => `- ${n}`));
  return lines.join("\n");
}

function errText(text: string): ToolResult {
  return {
    content: [{ type: "text", text: `# Metrics tool — invalid input\n\n${text}` }],
    isError: true,
  };
}
