import type {
  EscapedDefects,
  MetricsSeries,
  MetricsSummary,
  SeriesRecordRow,
  SeriesStat,
  TaskMetrics,
} from "@marvin-toolkit/mcp-shared/contracts";
import type { MetricsRecord } from "../storage/metrics.js";

/**
 * The series aggregation (ADR-0043 §5, WP5) — the **pure half** of
 * `metrics action: "series"` and of the dashboard's metrics line. Every record
 * is handed in already read; nothing here opens a file, spawns `gh` or reads a
 * clock (`now` is an input). The IO half is `lib/metrics-collect.ts`.
 *
 * Three rules govern the numbers:
 *
 * - **A stat is computed only over the records where the field is present.**
 *   Null means the source was absent (ADR-0043 §2), so it is excluded from the
 *   denominator rather than counted as zero, and `count` says how many records
 *   contributed. A series in which half the tasks never journalled their
 *   verification reports the half that did, and says so.
 * - **Coverage is reported beside every aggregate.** How many shipped specs
 *   have a record is the number that says whether the series can be trusted
 *   yet; an aggregate over three records out of thirty-three is labelled as one.
 * - **Q11 and Q12 are computed here and never stored** (plan D7). Both change
 *   after delivery — the review-fix commit count with every review round, the
 *   escaped-defect join as later specs ship — so a stored value would go stale.
 */

/** One record as the aggregation sees it. `block` is the LAST terminal block, or null. */
export interface SeriesRecord {
  slug: string;
  filename: string;
  /** Live events on the record, whatever the roll-up state. */
  events: number;
  block: TaskMetrics | null;
  /** Q11, read through `gh` at query time; null without `gh`, a PR URL, or on any error. */
  review_fix_commits: number | null;
}

/** A shipped spec, as the escaped-defect join needs it. */
export interface ShippedSpec {
  slug: string;
  /** The filename's ordering number; null for a legacy unnumbered spec. */
  number: number | null;
  type: string | null;
  created: string | null;
  /** The contract's `files[].path`, normalised. */
  files: string[];
}

export interface SeriesFilters {
  type?: string | undefined;
  since?: string | undefined;
  slug?: string | undefined;
}

export interface SeriesInputs {
  /** Project-relative metrics directory, for the answer. */
  dir: string;
  now: string;
  records: SeriesRecord[];
  /** The shipped specs of the corpus, or null when there is no corpus to join. */
  shipped: ShippedSpec[] | null;
  filters: SeriesFilters;
}

/** `listRecords` output → the aggregation's shape. Q11 is filled by the collector, not here. */
export function toSeriesRecords(
  listed: Array<{ filename: string; slug: string } & MetricsRecord>,
): SeriesRecord[] {
  return listed.map((r) => ({
    slug: r.slug,
    filename: r.filename,
    events: r.events.length,
    block: r.terminal.length ? r.terminal[r.terminal.length - 1]! : null,
    review_fix_commits: null,
  }));
}

/** How a metric is rendered: a duration, a share or rate, a ratio, or a plain count. */
export type SeriesUnit = "ms" | "share" | "ratio" | "count";

export interface SeriesMetric {
  group: "time" | "quality" | "rework";
  /** The key in the answer's `time` / `quality` / `rework` records. */
  key: string;
  /** The proposal's identifier the renderer labels the row with. */
  id: string;
  label: string;
  unit: SeriesUnit;
  /** The record's value, or null when its source was absent. */
  pick: (r: SeriesRecord, extra: { escaped: number | null }) => number | null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const listTotal = (xs: Array<{ ms: number }>) => (xs.length ? sum(xs.map((x) => x.ms)) : null);
const axesTotal = (
  axes: {
    compliance: { blockers: number; warnings: number };
    quality: { blockers: number; warnings: number };
  } | null,
  field: "blockers" | "warnings",
) => (axes ? axes.compliance[field] + axes.quality[field] : null);

/**
 * The metric table — one row per aggregated metric, in the order the answer and
 * the renderer list them. Lists (T6, T7) aggregate as per-record totals; the
 * critic axes (Q6) as per-record blocker and warning sums; Q9 as a 0/1 rate
 * whose mean is the share of tasks whose DoR gate passed first time.
 */
export const SERIES_METRICS: readonly SeriesMetric[] = [
  {
    group: "time",
    key: "intake_ms",
    id: "T1",
    label: "intake",
    unit: "ms",
    pick: (r) => r.block?.time.intake_ms ?? null,
  },
  {
    group: "time",
    key: "implement_ms",
    id: "T2",
    label: "implementation",
    unit: "ms",
    pick: (r) => r.block?.time.implement_ms ?? null,
  },
  {
    group: "time",
    key: "first_green_ms",
    id: "T3",
    label: "to first green full run",
    unit: "ms",
    pick: (r) => r.block?.time.first_green_ms ?? null,
  },
  {
    group: "time",
    key: "active_ms",
    id: "T4",
    label: "active pipeline time",
    unit: "ms",
    pick: (r) => r.block?.time.active_ms ?? null,
  },
  {
    group: "time",
    key: "gate_efficiency",
    id: "T5",
    label: "gate efficiency (wall / sum)",
    unit: "ratio",
    pick: (r) => r.block?.time.gate_efficiency ?? null,
  },
  {
    group: "time",
    key: "oracle_ms_total",
    id: "T6",
    label: "oracles, total per task",
    unit: "ms",
    pick: (r) => (r.block ? listTotal(r.block.time.oracle_ms) : null),
  },
  {
    group: "time",
    key: "gate_ms_total",
    id: "T7",
    label: "gates, total per task",
    unit: "ms",
    pick: (r) => (r.block ? listTotal(r.block.time.gate_ms) : null),
  },
  {
    group: "time",
    key: "critic_ms_total",
    id: "T8",
    label: "inside critic dispatches",
    unit: "ms",
    pick: (r) => r.block?.time.critic_ms.total ?? null,
  },
  {
    group: "quality",
    key: "scope_drift_undeclared",
    id: "Q1",
    label: "undeclared files changed",
    unit: "count",
    pick: (r) => r.block?.quality.scope_drift?.undeclared.length ?? null,
  },
  {
    group: "quality",
    key: "oracle_strength_share",
    id: "Q2",
    label: "criteria with an executable oracle",
    unit: "share",
    pick: (r) => r.block?.quality.oracle_strength?.share ?? null,
  },
  {
    group: "quality",
    key: "red_green_share",
    id: "Q3",
    label: "bugfix criteria proven red→green",
    unit: "share",
    pick: (r) => r.block?.quality.red_green?.share ?? null,
  },
  {
    group: "quality",
    key: "not_run_share",
    id: "Q4",
    label: "gates not run",
    unit: "share",
    pick: (r) => r.block?.quality.not_run?.share ?? null,
  },
  {
    group: "quality",
    key: "freshness_waivers",
    id: "Q5",
    label: "freshness waivers",
    unit: "count",
    pick: (r) => r.block?.quality.freshness_waivers ?? null,
  },
  {
    group: "quality",
    key: "critic_spec_blockers",
    id: "Q6",
    label: "spec-critic blockers (both axes)",
    unit: "count",
    pick: (r) => axesTotal(r.block?.quality.critics.spec ?? null, "blockers"),
  },
  {
    group: "quality",
    key: "critic_spec_warnings",
    id: "Q6",
    label: "spec-critic warnings (both axes)",
    unit: "count",
    pick: (r) => axesTotal(r.block?.quality.critics.spec ?? null, "warnings"),
  },
  {
    group: "quality",
    key: "critic_diff_blockers",
    id: "Q6",
    label: "diff-critic blockers (both axes)",
    unit: "count",
    pick: (r) => axesTotal(r.block?.quality.critics.diff ?? null, "blockers"),
  },
  {
    group: "quality",
    key: "critic_diff_warnings",
    id: "Q6",
    label: "diff-critic warnings (both axes)",
    unit: "count",
    pick: (r) => axesTotal(r.block?.quality.critics.diff ?? null, "warnings"),
  },
  {
    group: "quality",
    key: "spec_gaps",
    id: "Q7",
    label: "spec gaps",
    unit: "count",
    pick: (r) => r.block?.quality.spec_gaps ?? null,
  },
  {
    group: "quality",
    key: "open_items_deferred",
    id: "Q8",
    label: "items deferred at a limit",
    unit: "count",
    pick: (r) => r.block?.quality.open_items?.deferred ?? null,
  },
  {
    group: "quality",
    key: "open_items_blocked",
    id: "Q8",
    label: "items blocked at a limit",
    unit: "count",
    pick: (r) => r.block?.quality.open_items?.blocked ?? null,
  },
  {
    group: "quality",
    key: "dor_first_call",
    id: "Q9",
    label: "DoR passed on first call (rate)",
    unit: "share",
    pick: (r) =>
      r.block?.quality.dor_first_call === null || r.block?.quality.dor_first_call === undefined
        ? null
        : r.block.quality.dor_first_call
          ? 1
          : 0,
  },
  {
    group: "quality",
    key: "oracle_unresolved",
    id: "Q10",
    label: "criteria whose oracle resolved to nothing",
    unit: "count",
    pick: (r) => r.block?.quality.oracle_resolution?.unresolved ?? null,
  },
  {
    group: "quality",
    key: "review_fix_commits",
    id: "Q11",
    label: "review-fix commits after the PR opened",
    unit: "count",
    pick: (r) => r.review_fix_commits,
  },
  {
    group: "quality",
    key: "escaped_defects",
    id: "Q12",
    label: "escaped defects credited to the task",
    unit: "count",
    pick: (_r, extra) => extra.escaped,
  },
  {
    group: "rework",
    key: "seals",
    id: "R1",
    label: "seals",
    unit: "count",
    pick: (r) => r.block?.rework.seals ?? null,
  },
  {
    group: "rework",
    key: "reseals",
    id: "R1",
    label: "reseals",
    unit: "count",
    pick: (r) => r.block?.rework.reseals ?? null,
  },
  {
    group: "rework",
    key: "critic_passes_spec",
    id: "R2",
    label: "spec-critic passes",
    unit: "count",
    pick: (r) => r.block?.rework.critic_passes.spec ?? null,
  },
  {
    group: "rework",
    key: "critic_passes_diff",
    id: "R2",
    label: "diff-critic passes",
    unit: "count",
    pick: (r) => r.block?.rework.critic_passes.diff ?? null,
  },
  {
    group: "rework",
    key: "fix_rounds_verify_gate",
    id: "R3",
    label: "fix rounds, verify-gate loop",
    unit: "count",
    pick: (r) => r.block?.rework.fix_rounds?.verify_gate ?? null,
  },
  {
    group: "rework",
    key: "fix_rounds_critic",
    id: "R3",
    label: "fix rounds, critic loop",
    unit: "count",
    pick: (r) => r.block?.rework.fix_rounds?.critic ?? null,
  },
  {
    group: "rework",
    key: "fix_rounds_red_green",
    id: "R3",
    label: "fix rounds, red-green loop",
    unit: "count",
    pick: (r) => r.block?.rework.fix_rounds?.red_green ?? null,
  },
  {
    group: "rework",
    key: "runs_before_green",
    id: "R4",
    label: "verification runs before the first green",
    unit: "count",
    pick: (r) => r.block?.rework.runs_before_green ?? null,
  },
];

/** count / mean / median / max over the present values; all null at count 0. */
export function stat(values: Array<number | null>): SeriesStat {
  const present = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (present.length === 0) return { count: 0, mean: null, median: null, max: null };
  const sorted = [...present].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return {
    count: present.length,
    mean: round3(sum(present) / present.length),
    median: round3(median),
    max: sorted[sorted.length - 1]!,
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/**
 * Q12 — the escaped-defect join. Shipped specs are ordered by their filename
 * number (null last, then `created`, then slug); for each bugfix, every EARLIER
 * spec whose contract files intersect its own is credited once.
 */
export function escapedDefects(shipped: ShippedSpec[]): EscapedDefects {
  const ordered = [...shipped].sort(
    (a, b) =>
      (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) ||
      (a.created ?? "").localeCompare(b.created ?? "") ||
      a.slug.localeCompare(b.slug),
  );
  const by_spec: Record<string, number> = {};
  const pairs: EscapedDefects["pairs"] = [];
  ordered.forEach((spec, i) => {
    if (spec.type !== "bugfix") return;
    const own = new Set(spec.files);
    const credited = ordered
      .slice(0, i)
      .filter((earlier) => earlier.slug !== spec.slug && earlier.files.some((f) => own.has(f)))
      .map((earlier) => earlier.slug);
    if (credited.length === 0) return;
    pairs.push({ bugfix: spec.slug, credited });
    for (const slug of credited) by_spec[slug] = (by_spec[slug] ?? 0) + 1;
  });
  return { by_spec, pairs };
}

/** Apply the filters: `slug` narrows to one record; `type` and `since` keep only rolled-up records that match. */
export function filterRecords(records: SeriesRecord[], filters: SeriesFilters): SeriesRecord[] {
  let out = records;
  if (filters.slug) out = out.filter((r) => r.slug === filters.slug);
  if (filters.type) out = out.filter((r) => r.block?.type === filters.type);
  if (filters.since) {
    const since = filters.since;
    out = out.filter((r) => !!r.block && r.block.rolled_up_at.slice(0, since.length) >= since);
  }
  return out;
}

/** The aggregate answer. */
export function aggregateSeries(input: SeriesInputs): MetricsSeries {
  const records = filterRecords(input.records, input.filters);
  const escaped = input.shipped ? escapedDefects(input.shipped) : null;
  const shippedSlugs = new Set((input.shipped ?? []).map((s) => s.slug));
  const rolledUp = records.filter((r) => r.block !== null);

  const groups: Record<"time" | "quality" | "rework", Record<string, SeriesStat>> = {
    time: {},
    quality: {},
    rework: {},
  };
  for (const metric of SERIES_METRICS) {
    groups[metric.group][metric.key] = stat(
      rolledUp.map((r) =>
        metric.pick(r, {
          // Q12 is defined for a record whose spec is shipped: 0 credits is a
          // measured zero there, and null everywhere else.
          escaped: escaped && shippedSlugs.has(r.slug) ? (escaped.by_spec[r.slug] ?? 0) : null,
        }),
      ),
    );
  }

  const rows: SeriesRecordRow[] = records.map((r) => ({
    slug: r.slug,
    filename: r.filename,
    type: r.block?.type ?? null,
    rolled_up_at: r.block?.rolled_up_at ?? null,
    active_ms: r.block?.time.active_ms ?? null,
    events: r.events,
  }));

  const single = input.filters.slug ? (records[0]?.block ?? null) : null;

  return {
    generated_at: input.now,
    dir: input.dir,
    filters: {
      type: input.filters.type ?? null,
      since: input.filters.since ?? null,
      slug: input.filters.slug ?? null,
    },
    coverage: {
      records: records.length,
      rolled_up: rolledUp.length,
      events_only: records.filter((r) => r.block === null && r.events > 0).length,
      shipped_specs: input.shipped ? input.shipped.length : null,
      shipped_with_record: input.shipped
        ? input.shipped.filter((s) => rolledUp.some((r) => r.slug === s.slug)).length
        : null,
    },
    time: groups.time,
    quality: groups.quality,
    rework: groups.rework,
    escaped_defects: escaped,
    records: rows,
    record: single,
  };
}

/** The dashboard's line (ADR-0043 §5), over every record in the directory. */
export function summarizeSeries(records: SeriesRecord[]): MetricsSummary {
  const rolledUp = records.filter((r) => r.block !== null);
  const newest = rolledUp
    .map((r) => ({ slug: r.slug, rolled_up_at: r.block!.rolled_up_at }))
    .sort((a, b) => b.rolled_up_at.localeCompare(a.rolled_up_at))[0];
  return {
    records: records.length,
    rolled_up: rolledUp.length,
    newest: newest ?? null,
    median_active_ms: stat(rolledUp.map((r) => r.block!.time.active_ms)).median,
    median_spec_gaps: stat(rolledUp.map((r) => r.block!.quality.spec_gaps)).median,
  };
}

// ── shared rendering helpers ─────────────────────────────────────────────────

/** `12m 3s`, `42s`, `850ms`, `—` for null. */
export function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** A value in its metric's unit. */
export function fmtUnit(value: number | null, unit: SeriesUnit): string {
  if (value === null) return "—";
  switch (unit) {
    case "ms":
      return fmtMs(value);
    case "share":
      return `${Math.round(value * 100)}%`;
    case "ratio":
      return String(round3(value));
    case "count":
      return String(round3(value));
  }
}
