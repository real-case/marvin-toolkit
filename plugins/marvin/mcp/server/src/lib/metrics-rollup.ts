import type {
  CriticDispatchMs,
  Critique,
  MetricEvent,
  MetricsSources,
  SourcePresence,
  TaskMetrics,
  TaskMetricsQuality,
  TaskMetricsRework,
  TaskMetricsTime,
} from "@marvin-toolkit/mcp-shared/contracts";
import type { ProgressEntry } from "../storage/progress.js";
import { redGreenProof, type OracleRun } from "../storage/oracles.js";
import { isGreenFullRun, type VerifyRunEntry } from "../storage/verify-runs.js";
import type { SpecContract } from "../storage/spec.js";
import type { VerifyResult } from "./reports.js";
import { normalizeScopePath } from "./git.js";

/**
 * The metrics roll-up (ADR-0043 §2) — the **pure half** of the `metrics` tool's
 * `rollup` action. It takes every input already read from disk and derives the
 * terminal `task-metrics` block; it opens no file, spawns no process and reads
 * no clock (`now` is an input). The IO half is `lib/metrics-collect.ts`.
 *
 * The derivation table is the plan's (`docs/proposals/task-metrics-implementation-plan.md`,
 * "Where the roll-up reads from"), one rule per metric, and each rule is stated
 * beside its code. Three properties hold throughout:
 *
 * - **Null means absent, never zero.** A metric whose source is missing is null,
 *   and the `sources` map says which input was missing. A record with no live
 *   events reports every event-sourced counter as null, because a session that
 *   recorded nothing is indistinguishable from one with nothing to record.
 * - **Nothing derivable is copied.** Phase boundaries are read from the progress
 *   journal's timestamps; the metrics record never carries a copy that could
 *   disagree with them.
 * - **Anomalies become notes, not numbers.** A negative interval, an unpaired
 *   critic dispatch, a stamp that disagrees with its block — each is reported as
 *   one line in `notes` and the affected metric is null, so a reader is never
 *   handed a confident value the sources do not support.
 */

/** The spec as the collector read it: frontmatter, the parsed contract, and both seals. */
export interface RollupSpec {
  /** Project-relative path of the spec file, POSIX separators. */
  path: string;
  frontmatter: Record<string, string>;
  /** The parsed `spec-contract` block, null when absent or invalid. */
  contract: SpecContract | null;
  /** The `contract_sha` stamped in the frontmatter, null when unsealed. */
  stamped_sha: string | null;
  /** The block's hash as recomputed now, null when there is no block. */
  actual_sha: string | null;
}

export interface RollupGit {
  head_sha: string | null;
  /** Changed files against the base — committed and uncommitted — or null when the base ref could not be resolved. */
  changed_files: string[] | null;
}

/** Every input the roll-up reads. A `null` input is an ABSENT source. */
export interface RollupInputs {
  slug: string;
  base_branch: string;
  /** ISO 8601 — stamped as `rolled_up_at`. */
  now: string;
  spec: RollupSpec | null;
  progress: ProgressEntry[] | null;
  oracles: OracleRun[] | null;
  verify_journal: VerifyRunEntry[] | null;
  /** The `verify-result` block of `runs/<slug>.md` — this spec's final run, never the global artifact. */
  verify_result: VerifyResult | null;
  /** The newest receipt per critic whose `subject` is the slug; null when there is none for either. */
  critique: { spec: Critique | null; diff: Critique | null } | null;
  events: MetricEvent[] | null;
  git: RollupGit | null;
  /** Anomalies the collector met before the roll-up ran; prepended to `notes`. */
  notes?: string[];
}

/** Epoch milliseconds of an ISO timestamp, or null when it does not parse. */
function epoch(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * `to - from` in milliseconds. A negative interval is null WITH a note: the
 * journals are append-only and timestamped by the tool, so a later entry that
 * precedes an earlier one is a clock or a copy problem worth surfacing, not a
 * duration worth summing.
 */
function interval(label: string, from: string, to: string, notes: string[]): number | null {
  const a = epoch(from);
  const b = epoch(to);
  if (a === null || b === null) return null;
  const d = b - a;
  if (d < 0) {
    notes.push(`${label}: negative interval (${to} precedes ${from}) — reported as null`);
    return null;
  }
  return d;
}

function last<T>(items: T[]): T | undefined {
  return items.length ? items[items.length - 1] : undefined;
}

/** `"true"` → true, `"false"` → false, anything else (including absent) → null. */
function flag(value: string | undefined): boolean | null {
  const v = value?.trim().toLowerCase();
  return v === "true" ? true : v === "false" ? false : null;
}

function presence(input: unknown): SourcePresence {
  return input === null || input === undefined ? "absent" : "present";
}

/** Three decimals — a ratio, not a duration. */
function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/**
 * The seal to join the oracle journal on — RECOMPUTED, never taken on the
 * stamp's word (the `summary` tool's rule). A stamp that agrees with its block
 * joins; a missing stamp or block joins against nothing silently, because an
 * unsealed spec never had proofs; a stamp that disagrees joins against nothing
 * AND says so, because every oracle-sourced row going null at once is otherwise
 * indistinguishable from the feature not working.
 */
function sealJoinKey(spec: RollupSpec | null, notes: string[]): string | null {
  if (!spec || !spec.stamped_sha || !spec.actual_sha) return null;
  if (spec.stamped_sha !== spec.actual_sha) {
    notes.push(
      `the spec-contract has been edited since it was sealed (stamped ${spec.stamped_sha}, the block ` +
        `hashes to ${spec.actual_sha}) — oracle-journal rows prove the superseded contract and are joined against nothing`,
    );
    return null;
  }
  return spec.actual_sha;
}

/** The newest journalled oracle run per criterion at the seal in force, oldest-first input → newest wins. */
function latestOraclesAtSeal(
  oracles: OracleRun[] | null,
  seal: string | null,
): Map<string, OracleRun> {
  const latest = new Map<string, OracleRun>();
  if (!oracles || !seal) return latest;
  for (const run of oracles) if (run.contract_sha === seal) latest.set(run.criterion, run);
  return latest;
}

/**
 * T8 — time inside critic dispatches. Events are paired per `(critic, pass)`:
 * a pass's FIRST dispatch to the verdict that closes it, so a `NEEDS_CONTEXT`
 * re-dispatch (which reuses the pass number) is counted inside its pass rather
 * than as a stray. A pass with a dispatch and no verdict, or a verdict and no
 * dispatch, is excluded with a note.
 */
function criticTime(events: MetricEvent[] | null, notes: string[]): TaskMetricsTime["critic_ms"] {
  if (!events) return { total: null, dispatches: [] };
  const key = (e: MetricEvent) => `${e.critic}#${e.pass}`;
  const firstDispatch = new Map<string, MetricEvent>();
  for (const e of events) {
    if (e.kind !== "critic-dispatch") continue;
    const k = key(e);
    if (!firstDispatch.has(k)) firstDispatch.set(k, e);
  }
  const closed = new Set<string>();
  const dispatches: CriticDispatchMs[] = [];
  let strayVerdicts = 0;
  for (const v of events) {
    if (v.kind !== "critic-verdict") continue;
    const k = key(v);
    const d = firstDispatch.get(k);
    if (!d || closed.has(k)) {
      strayVerdicts += 1;
      continue;
    }
    closed.add(k);
    const ms = interval(`T8 ${v.critic} pass ${v.pass}`, d.at, v.at, notes);
    if (ms !== null) dispatches.push({ critic: v.critic!, pass: v.pass!, ms });
  }
  const open = [...firstDispatch.keys()].filter((k) => !closed.has(k)).length;
  if (open > 0) notes.push(`T8: ${open} critic dispatch(es) without a recorded verdict — excluded`);
  if (strayVerdicts > 0) {
    notes.push(`T8: ${strayVerdicts} critic verdict(s) without a recorded dispatch — excluded`);
  }
  return {
    total: dispatches.length ? dispatches.reduce((sum, d) => sum + d.ms, 0) : null,
    dispatches,
  };
}

/** Derive the terminal block from everything the collector read. Pure. */
export function rollUpMetrics(input: RollupInputs): TaskMetrics {
  const notes = [...(input.notes ?? [])];
  const fm = input.spec?.frontmatter ?? {};
  const contract = input.spec?.contract ?? null;
  const seal = sealJoinKey(input.spec, notes);
  const type = fm.type?.trim() || null;
  const { progress, oracles, verify_journal, verify_result, events } = input;

  // ── time ──────────────────────────────────────────────────────────────────
  const lastCriterion = progress ? last(progress.filter((e) => e.kind === "criterion")) : undefined;

  // T1 — `at` of the last task-start step entry minus `at` of its step 1.5 entry.
  let intake_ms: number | null = null;
  if (progress) {
    const start = progress.find((e) => e.source === "task-start" && e.step === "1.5");
    const end = last(progress.filter((e) => e.source === "task-start" && e.kind === "step"));
    if (!start) notes.push("T1: the progress journal has no task-start step 1.5 entry");
    else if (!end || end === start) {
      notes.push(
        "T1: no task-start step entry after 1.5 — the intake was never finalised in the journal",
      );
    } else intake_ms = interval("T1", start.at, end.at, notes);
  }

  // T2 — `at` of the last criterion entry minus `at` of the task-implement step 2.5 entry.
  let implement_ms: number | null = null;
  if (progress) {
    const start = progress.find((e) => e.source === "task-implement" && e.step === "2.5");
    if (!start) notes.push("T2: the progress journal has no task-implement step 2.5 entry");
    else if (!lastCriterion) notes.push("T2: the progress journal records no completed criterion");
    else implement_ms = interval("T2", start.at, lastCriterion.at, notes);
  }

  // T3 — first green FULL run minus the last recorded criterion (D6: T3 starts
  // where T2 ends, so T4 never counts an interval twice). R4 shares the anchor.
  let first_green_ms: number | null = null;
  const runs = verify_journal ? verify_journal.filter((e) => e.kind === "run") : null;
  const firstGreenIndex = runs ? runs.findIndex(isGreenFullRun) : -1;
  if (runs) {
    if (firstGreenIndex === -1) notes.push("T3/R4: no green full verification run recorded");
    else if (lastCriterion) {
      first_green_ms = interval("T3", lastCriterion.at, runs[firstGreenIndex]!.at, notes);
    } else if (!progress) {
      notes.push("T3: no progress journal to anchor the last recorded criterion");
    }
  }

  // T4 — a partial sum would read as a smaller task.
  const active_ms =
    intake_ms !== null && implement_ms !== null && first_green_ms !== null
      ? intake_ms + implement_ms + first_green_ms
      : null;

  // T5 — wall clock over the summed gate time of the final run.
  const gate_efficiency =
    verify_result &&
    typeof verify_result.wallClockMs === "number" &&
    typeof verify_result.sumOfGatesMs === "number" &&
    verify_result.sumOfGatesMs > 0
      ? round3(verify_result.wallClockMs / verify_result.sumOfGatesMs)
      : null;

  // T6 — each criterion's latest run at the current seal.
  const latestOracle = latestOraclesAtSeal(oracles, seal);
  const oracle_ms = [...latestOracle.values()]
    .filter((r) => typeof r.durationMs === "number")
    .map((r) => ({ criterion: r.criterion, ms: r.durationMs! }))
    .sort((a, b) => a.criterion.localeCompare(b.criterion, undefined, { numeric: true }));

  // T7 — each gate of the final run.
  const gate_ms = (verify_result?.gates ?? [])
    .filter((g) => typeof g.durationMs === "number")
    .map((g) => ({ gate: g.name, ms: g.durationMs! }));

  const time: TaskMetricsTime = {
    intake_ms,
    implement_ms,
    first_green_ms,
    active_ms,
    gate_efficiency,
    oracle_ms,
    gate_ms,
    critic_ms: criticTime(events, notes),
  };

  // ── quality ───────────────────────────────────────────────────────────────

  // Q1 — changed files against the base minus the contract's declared paths.
  // marvin's own `.marvin/` artifacts and the spec file are excluded, as the
  // scope gate excludes them: they change on every task by construction.
  let scope_drift: TaskMetricsQuality["scope_drift"] = null;
  if (input.git?.changed_files && contract) {
    const declared = new Set(contract.files.map((f) => normalizeScopePath(f.path)));
    const specPath = input.spec ? normalizeScopePath(input.spec.path) : null;
    const changed = input.git.changed_files
      .map(normalizeScopePath)
      .filter((p) => p && !p.startsWith(".marvin/") && p !== specPath);
    scope_drift = {
      declared: declared.size,
      changed: changed.length,
      undeclared: changed.filter((p) => !declared.has(p)).sort(),
    };
  }

  // Q2 — criteria with an executable proof.
  let oracle_strength: TaskMetricsQuality["oracle_strength"] = null;
  if (contract) {
    const criteria = contract.criteria.length;
    const executable = contract.criteria.filter(
      (c) => c.oracle.kind === "test" || c.oracle.kind === "command",
    ).length;
    oracle_strength = { criteria, executable, share: criteria ? round3(executable / criteria) : 0 };
  }

  // Q3 — bugfix only: criteria with a red→green pair at the current seal.
  let red_green: TaskMetricsQuality["red_green"] = null;
  if (type === "bugfix" && contract && oracles && seal) {
    const criteria = contract.criteria.length;
    const proven = contract.criteria.filter(
      (c) => redGreenProof(oracles, seal, c.id) === "proven",
    ).length;
    red_green = { criteria, proven, share: criteria ? round3(proven / criteria) : 0 };
  }

  // Q4 — gates recorded `not-run` in the final run.
  let not_run: TaskMetricsQuality["not_run"] = null;
  if (verify_result && verify_result.gates.length > 0) {
    const gates = verify_result.gates.length;
    const notRun = verify_result.gates.filter((g) => g.status === "not-run").length;
    not_run = { gates, not_run: notRun, share: round3(notRun / gates) };
  }

  // Q5 — ALLOW decisions taken over stale evidence through `allowStale`.
  const freshness_waivers = verify_journal
    ? verify_journal.filter(
        (e) =>
          e.kind === "gate" &&
          e.decision === "ALLOW" &&
          e.staleness === "stale" &&
          e.allowStale === true,
      ).length
    : null;

  // Q6 — both axes of each critic's newest receipt.
  const axes = (c: Critique | null | undefined) =>
    c ? { compliance: c.compliance, quality: c.quality } : null;
  const critics = { spec: axes(input.critique?.spec), diff: axes(input.critique?.diff) };

  // Q7, Q8 — event counts; null when no events were recorded at all.
  const spec_gaps = events ? events.filter((e) => e.kind === "spec-gap").length : null;
  const open_items = events
    ? {
        deferred: events.filter((e) => e.kind === "open-item" && e.classification === "deferred")
          .length,
        blocked: events.filter((e) => e.kind === "open-item" && e.classification === "blocked")
          .length,
      }
    : null;

  // Q9 — did the DoR gate pass on its first call?
  let dor_first_call: boolean | null = null;
  if (events) {
    const first = events
      .filter((e) => e.kind === "gate-call" && e.gate === "dor")
      .sort((a, b) => (epoch(a.at) ?? 0) - (epoch(b.at) ?? 0) || (a.call ?? 0) - (b.call ?? 0))[0];
    if (first) dor_first_call = first.verdict === "PASS" || first.verdict === "PASS WITH WARNINGS";
  }

  // Q10 — the resolution rung of each criterion's latest run; a null source is unresolved.
  let oracle_resolution: TaskMetricsQuality["oracle_resolution"] = null;
  if (oracles && seal) {
    const by_source: Record<string, number> = {};
    let unresolved = 0;
    for (const run of latestOracle.values()) {
      if (run.source === null) unresolved += 1;
      else by_source[run.source] = (by_source[run.source] ?? 0) + 1;
    }
    oracle_resolution = { by_source, unresolved };
  }

  const quality: TaskMetricsQuality = {
    scope_drift,
    oracle_strength,
    red_green,
    not_run,
    freshness_waivers,
    critics,
    spec_gaps,
    open_items,
    dor_first_call,
    oracle_resolution,
  };

  // ── rework ────────────────────────────────────────────────────────────────

  // R1 — distinct non-null seals across the WHOLE progress journal.
  let seals: number | null = null;
  let reseals: number | null = null;
  if (progress) {
    seals = new Set(progress.map((e) => e.contract_sha).filter((s): s is string => !!s)).size;
    reseals = Math.max(0, seals - 1);
  }

  // R2 — the highest pass each critic reached, over its verdicts.
  const highestPass = (critic: string): number | null => {
    if (!events) return null;
    const passes = events
      .filter((e) => e.kind === "critic-verdict" && e.critic === critic)
      .map((e) => e.pass ?? 0);
    return passes.length ? Math.max(...passes) : null;
  };
  const critic_passes = {
    spec: highestPass("marvin-tm-spec-critic"),
    diff: highestPass("marvin-tm-diff-critic"),
  };

  // R3 — fix-cycle rounds per loop.
  const fix_rounds = events
    ? {
        verify_gate: events.filter((e) => e.kind === "fix-round" && e.loop === "verify-gate")
          .length,
        critic: events.filter((e) => e.kind === "fix-round" && e.loop === "critic").length,
        red_green: events.filter((e) => e.kind === "fix-round" && e.loop === "red-green").length,
      }
    : null;

  // R4 — runs before the first green full run; undefined (null) when none is green.
  const runs_before_green = runs && firstGreenIndex !== -1 ? firstGreenIndex : null;

  const rework: TaskMetricsRework = {
    seals,
    reseals,
    critic_passes,
    fix_rounds,
    runs_before_green,
  };

  const sources: MetricsSources = {
    spec: presence(input.spec),
    progress: presence(progress),
    oracles: presence(oracles),
    verify_journal: presence(verify_journal),
    verify_result: presence(verify_result),
    critique: presence(input.critique),
    events: presence(events),
    git: presence(input.git),
  };

  return {
    slug: input.slug,
    contract_sha: input.spec?.stamped_sha ?? null,
    type,
    risk: fm.risk?.trim() || null,
    breaking: flag(fm.breaking),
    spike_required: flag(fm.spike_required),
    created: fm.created?.trim() || null,
    rolled_up_at: input.now,
    head_sha: input.git?.head_sha ?? null,
    base_branch: input.base_branch,
    sources,
    time,
    quality,
    rework,
    notes,
  };
}
