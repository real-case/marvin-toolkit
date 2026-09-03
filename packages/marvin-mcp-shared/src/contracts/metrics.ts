import { z } from "zod";
import { AxisVerdict, CritiqueCritic, TerminalVerdict } from "./critique.js";

/**
 * The task-metrics record (ADR-0043, `docs/proposals/task-metrics.md`) — one
 * file per spec under `.marvin/metrics/`, holding live `metric-event` blocks
 * appended during the run and a terminal `task-metrics` block derived at
 * delivery, of which the LAST is authoritative.
 *
 * This module ships schemas ONLY. The `metrics` tool validates every event it
 * records against `MetricEvent` (a half-written event does not validate) and
 * every terminal block it derives against `TaskMetrics`; the storage codec in
 * `plugins/marvin/mcp/server/src/storage/metrics.ts` reads them back through
 * the same schemas, so a block a reader accepts is a block the writer could
 * have written.
 *
 * Every metric field of the terminal block is NULLABLE, and null means the
 * source was absent, never zero. A task that ran with no per-spec verification
 * appears in the series as a measured gap rather than a silent absence, and a
 * record with no live events reports the event-sourced counters as null,
 * because a session that recorded nothing is indistinguishable from one with
 * nothing to record. The `sources` map is what makes that distinction visible.
 */

/** The kebab-case rule every slug in the pipeline obeys (`Critique.subject`, `verify`'s `specSlug`). */
const Slug = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case");

// ── live events ─────────────────────────────────────────────────────────────

/**
 * The six live-event kinds — exactly the information that is otherwise lost
 * when context compaction destroys the session's own count. Everything else
 * about a task is derived at delivery from the artifacts already on disk.
 */
export const MetricEventKind = z.enum([
  "fix-round",
  "spec-gap",
  "open-item",
  "critic-dispatch",
  "critic-verdict",
  "gate-call",
]);
export type MetricEventKind = z.infer<typeof MetricEventKind>;

/** Which prose site wrote the event; step ids collide across the pipelines. */
export const MetricEventSource = z.enum([
  "task-start",
  "task-implement",
  "task-deliver",
  "marvin-tm-executor",
]);
export type MetricEventSource = z.infer<typeof MetricEventSource>;

/** The three loops of the fix-cycle protocol, each with its own budget. */
export const FixLoop = z.enum(["verify-gate", "critic", "red-green"]);
export type FixLoop = z.infer<typeof FixLoop>;

/** How an item left open at a loop's limit was classified. */
export const OpenItemClassification = z.enum(["deferred", "blocked"]);
export type OpenItemClassification = z.infer<typeof OpenItemClassification>;

/** The Definition-of-Ready gate's own three-value vocabulary (`spec action: "dor"`). */
export const DorVerdict = z.enum(["PASS", "PASS WITH WARNINGS", "FAIL"]);
export type DorVerdict = z.infer<typeof DorVerdict>;

/** The deterministic gates a `gate-call` event may name. One today. */
export const MetricGate = z.enum(["dor"]);
export type MetricGate = z.infer<typeof MetricGate>;

const MetricEventShape = z.object({
  slug: Slug,
  source: MetricEventSource,
  /** The writer's own step id — `"7F"`, `"8B"`, `"6F"`, `"fix-cycle"`, `"§3"`. */
  step: z.string().min(1),
  kind: MetricEventKind,
  /** The seal in force, when the writer knows one. */
  contract_sha: z.string().nullable().optional(),
  /** ISO 8601, stamped by the tool. */
  at: z.string().datetime(),
  /** One line, where the kind carries one. Never a credential, token or customer datum. */
  detail: z.string().min(1).optional(),
  // fix-round
  loop: FixLoop.optional(),
  round: z.number().int().positive().optional(),
  // open-item
  classification: OpenItemClassification.optional(),
  // critic-dispatch / critic-verdict
  critic: CritiqueCritic.optional(),
  /** The dispatch number for this critic on this task; a NEEDS_CONTEXT re-dispatch reuses it. */
  pass: z.number().int().positive().optional(),
  /** A `TerminalVerdict` on a `critic-verdict`, a `DorVerdict` on a `gate-call`. */
  verdict: z.string().min(1).optional(),
  blockers: z.number().int().nonnegative().optional(),
  warnings: z.number().int().nonnegative().optional(),
  // gate-call
  gate: MetricGate.optional(),
  /** The call number for this gate on this task, incremented per re-run. */
  call: z.number().int().positive().optional(),
});

/**
 * The fields each kind REQUIRES, beyond the common ones. Declared as data so the
 * refinement below and the `metrics` tool's error message read one table.
 */
export const REQUIRED_EVENT_FIELDS: Record<
  MetricEventKind,
  readonly (keyof z.infer<typeof MetricEventShape>)[]
> = {
  "fix-round": ["loop", "round"],
  "spec-gap": ["detail"],
  "open-item": ["classification", "detail"],
  "critic-dispatch": ["critic", "pass"],
  "critic-verdict": ["critic", "pass", "verdict", "blockers", "warnings"],
  "gate-call": ["gate", "call", "verdict"],
};

/**
 * One live entry. The refinement makes the event fail-closed per kind: an event
 * missing one of its kind's fields does not validate, so a half-written block
 * can never be counted as a whole one. A `critic-verdict` carries a terminal
 * critic verdict; a `gate-call` carries the DoR gate's own vocabulary.
 */
export const MetricEvent = MetricEventShape.superRefine((value, ctx) => {
  for (const field of REQUIRED_EVENT_FIELDS[value.kind]) {
    if (value[field] === undefined || value[field] === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `a ${value.kind} event requires ${field}`,
      });
    }
  }
  if (value.kind === "critic-verdict" && value.verdict !== undefined) {
    if (!TerminalVerdict.safeParse(value.verdict).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verdict"],
        message: `a critic-verdict records a terminal verdict: ${TerminalVerdict.options.join(" | ")}`,
      });
    }
  }
  if (value.kind === "gate-call" && value.verdict !== undefined) {
    if (!DorVerdict.safeParse(value.verdict).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verdict"],
        message: `a gate-call records the gate's verdict: ${DorVerdict.options.join(" | ")}`,
      });
    }
  }
});
export type MetricEvent = z.infer<typeof MetricEvent>;

// ── the terminal block ──────────────────────────────────────────────────────

/** Whether a roll-up input was on disk. `absent` is what nulls that input's rows. */
export const SourcePresence = z.enum(["present", "absent"]);
export type SourcePresence = z.infer<typeof SourcePresence>;

/** The eight inputs the roll-up reads, each present or absent. */
export const MetricsSources = z.object({
  spec: SourcePresence,
  progress: SourcePresence,
  oracles: SourcePresence,
  verify_journal: SourcePresence,
  verify_result: SourcePresence,
  critique: SourcePresence,
  events: SourcePresence,
  git: SourcePresence,
});
export type MetricsSources = z.infer<typeof MetricsSources>;

const NullableMs = z.number().nullable();
const NullableInt = z.number().int().nullable();

/** One critic's time inside one dispatch, from the dispatch event to its verdict. */
export const CriticDispatchMs = z.object({
  critic: CritiqueCritic,
  pass: z.number().int().positive(),
  ms: z.number(),
});
export type CriticDispatchMs = z.infer<typeof CriticDispatchMs>;

/** Time: how long the work took (T1–T8). Milliseconds throughout. */
export const TaskMetricsTime = z.object({
  /** T1 — step 1.5 to the last task-start step. */
  intake_ms: NullableMs,
  /** T2 — step 2.5 to the last recorded criterion. */
  implement_ms: NullableMs,
  /** T3 — the last recorded criterion to the first green full verification run. */
  first_green_ms: NullableMs,
  /** T4 — T1 + T2 + T3, null when any addend is null. */
  active_ms: NullableMs,
  /** T5 — wallClockMs / sumOfGatesMs of the final run. */
  gate_efficiency: z.number().nullable(),
  /** T6 — each criterion's latest oracle run at the current seal. */
  oracle_ms: z.array(z.object({ criterion: z.string().min(1), ms: z.number() })),
  /** T7 — each gate of the final run. */
  gate_ms: z.array(z.object({ gate: z.string().min(1), ms: z.number() })),
  /** T8 — inside critic dispatches, per (critic, pass) pair and in total. */
  critic_ms: z.object({ total: NullableMs, dispatches: z.array(CriticDispatchMs) }),
});
export type TaskMetricsTime = z.infer<typeof TaskMetricsTime>;

/** Q2 — criteria with an executable proof, over all criteria. */
export const OracleStrength = z.object({
  criteria: z.number().int().nonnegative(),
  executable: z.number().int().nonnegative(),
  share: z.number(),
});
export type OracleStrength = z.infer<typeof OracleStrength>;

/** Q3 — criteria with a red→green pair at the current seal, over all criteria. */
export const RedGreenCompleteness = z.object({
  criteria: z.number().int().nonnegative(),
  proven: z.number().int().nonnegative(),
  share: z.number(),
});
export type RedGreenCompleteness = z.infer<typeof RedGreenCompleteness>;

/** One critic's two judged axes, from its newest receipt for the task. */
export const CriticAxes = z.object({ compliance: AxisVerdict, quality: AxisVerdict });
export type CriticAxes = z.infer<typeof CriticAxes>;

/** Quality: what the work produced (Q1–Q10; Q11 and Q12 are computed by `series` and never stored). */
export const TaskMetricsQuality = z.object({
  /** Q1 — changed files against the base minus the contract's declared paths. */
  scope_drift: z
    .object({
      declared: z.number().int().nonnegative(),
      changed: z.number().int().nonnegative(),
      undeclared: z.array(z.string().min(1)),
    })
    .nullable(),
  /** Q2 — criteria with an executable (test or command) oracle. */
  oracle_strength: OracleStrength.nullable(),
  /** Q3 — bugfix only: criteria with a red→green pair at the current seal. */
  red_green: RedGreenCompleteness.nullable(),
  /** Q4 — gates recorded `not-run` in the final run. */
  not_run: z
    .object({
      gates: z.number().int().nonnegative(),
      not_run: z.number().int().nonnegative(),
      share: z.number(),
    })
    .nullable(),
  /** Q5 — ALLOW decisions taken over stale evidence through `allowStale`. */
  freshness_waivers: NullableInt,
  /** Q6 — both axes of each critic's newest receipt. */
  critics: z.object({ spec: CriticAxes.nullable(), diff: CriticAxes.nullable() }),
  /** Q7 — SPEC GAPs recorded. */
  spec_gaps: NullableInt,
  /** Q8 — items left open at a loop's limit, by classification. */
  open_items: z
    .object({ deferred: z.number().int().nonnegative(), blocked: z.number().int().nonnegative() })
    .nullable(),
  /** Q9 — whether the DoR gate passed on its first call. */
  dor_first_call: z.boolean().nullable(),
  /** Q10 — the resolution rung of each criterion's latest oracle run; `unresolved` counts a null source. */
  oracle_resolution: z
    .object({
      by_source: z.record(z.string(), z.number().int().nonnegative()),
      unresolved: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type TaskMetricsQuality = z.infer<typeof TaskMetricsQuality>;

/** Rework: where the two axes meet (R1–R4). */
export const TaskMetricsRework = z.object({
  /** R1 — distinct non-null seals recorded in the progress journal. */
  seals: NullableInt,
  /** R1 — `seals - 1`, floored at zero. */
  reseals: NullableInt,
  /** R2 — the highest pass number each critic reached. */
  critic_passes: z.object({ spec: NullableInt, diff: NullableInt }),
  /** R3 — fix-cycle rounds spent, per loop. */
  fix_rounds: z
    .object({
      verify_gate: z.number().int().nonnegative(),
      critic: z.number().int().nonnegative(),
      red_green: z.number().int().nonnegative(),
    })
    .nullable(),
  /** R4 — verification runs before the first green full run. */
  runs_before_green: NullableInt,
});
export type TaskMetricsRework = z.infer<typeof TaskMetricsRework>;

/**
 * The terminal ` ```json task-metrics ` block, derived at delivery. Identity
 * from the spec's frontmatter (null where the spec was absent or the key
 * unset), the `sources` map, the three groups, and the anomalies the roll-up
 * met — a negative interval, an unpaired dispatch, a stamp that disagrees with
 * its block — as one line each.
 */
export const TaskMetrics = z.object({
  slug: Slug,
  contract_sha: z.string().nullable(),
  type: z.string().nullable(),
  risk: z.string().nullable(),
  breaking: z.boolean().nullable(),
  spike_required: z.boolean().nullable(),
  created: z.string().nullable(),
  /** ISO 8601, when the block was derived. */
  rolled_up_at: z.string().datetime(),
  head_sha: z.string().nullable(),
  base_branch: z.string().min(1),
  sources: MetricsSources,
  time: TaskMetricsTime,
  quality: TaskMetricsQuality,
  rework: TaskMetricsRework,
  notes: z.array(z.string()),
});
export type TaskMetrics = z.infer<typeof TaskMetrics>;
