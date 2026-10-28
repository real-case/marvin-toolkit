import { z } from "zod";

/**
 * Autopilot status report contract (ADR-0051) — feeds the autopilot-status widget and the
 * `autopilot-report` tool's text. One report is one file, `<runDir>/status-reports/<n>.json`,
 * written by `marvin-pipe await --report-min <m>` when its interval ends or when something needs
 * the orchestrator at once. The engine owns every number on it; the orchestrator adds only the
 * translation of the English event texts and the callout.
 *
 * Labels are not part of a report: a report carries keys (`state`, the rail's stage keys) and the
 * widget and the tool's text both label them through `autopilotLabels` (`../autopilot-labels.ts`),
 * so the two surfaces cannot word the same report differently.
 */

/** The seven stages the card's rail shows, in order. Every other stage maps onto one of them. */
export const AUTOPILOT_RAIL = [
  "planning",
  "test_authoring",
  "executing",
  "gating",
  "verifying",
  "ci_wait",
  "retro",
] as const;
export type AutopilotRailKey = (typeof AUTOPILOT_RAIL)[number];

export const AutopilotRailStep = z.object({
  key: z.enum(AUTOPILOT_RAIL),
  state: z.enum(["done", "current", "waiting", "failed", "pending"]),
});
export type AutopilotRailStep = z.infer<typeof AutopilotRailStep>;

/** What the card's status pill says: the run is moving, needs an answer, is ready, or stopped. */
export const AutopilotState = z.enum(["running", "waiting", "ready", "halted"]);
export type AutopilotState = z.infer<typeof AutopilotState>;

/** The most event lines one report carries; older ones are counted in `omittedEvents`. */
export const AUTOPILOT_EVENTS_MAX = 8;

export const AutopilotEvent = z.object({
  at: z.string().datetime(),
  kind: z.string(),
  text: z.string(),
});
export type AutopilotEvent = z.infer<typeof AutopilotEvent>;

/**
 * The child session the card's footer describes: the one running, else the one that ran last.
 * `model` is the model the session reported (`claude-opus-5-5`), else the one it was assigned
 * (`opus`). The context figures come from the session's newest top-level assistant turn; the
 * window from a finished session of the same model. Either is null when no log says it.
 */
export const AutopilotSession = z.object({
  name: z.string(),
  role: z.string(),
  model: z.string(),
  effort: z.string(),
  contextTokens: z.number().int().min(0).nullable(),
  contextWindow: z.number().int().min(1).nullable(),
});
export type AutopilotSession = z.infer<typeof AutopilotSession>;

const count = z.number().int().min(0);

/** One role's tokens over the run: every child of that role, a resumed session counted once. */
export const AutopilotRoleTokens = z.object({
  role: z.string(),
  /** How many sessions of the role ran: "Executor × 2". */
  sessions: z.number().int().min(1),
  /** The model the newest session reported, else the one it was assigned. */
  model: z.string(),
  /** Every kind together; null when no session of the role logged a result. */
  total: count.nullable(),
  /** The largest context one top-level turn carried, and the window it was measured against. */
  peakContext: count.nullable(),
  contextWindow: z.number().int().min(1).nullable(),
});
export type AutopilotRoleTokens = z.infer<typeof AutopilotRoleTokens>;

/**
 * What a final report adds (ADR-0051): the whole run, summed up for the reviewer. Every field is
 * nullable, and null means its source was absent, never zero: the card hides what is missing.
 */
export const AutopilotSummary = z.object({
  /** Time spent in each rail stage, in the rail's order; null for a stage the run never entered. */
  stages: z
    .array(z.object({ key: z.enum(AUTOPILOT_RAIL), ms: count.nullable() }))
    .length(AUTOPILOT_RAIL.length),
  /** Wall-clock time in which at least one child ran. */
  activeMs: count.nullable(),
  /** How many roles ran a child. */
  roles: count.nullable(),
  /**
   * Tokens by kind over every child, from the `result` line of each child's `stream-json` log.
   * A kind is null when no child's log reported it; `byRole` lists the roles in the order they
   * first ran.
   */
  tokens: z
    .object({
      total: count.nullable(),
      cacheRead: count.nullable(),
      cacheWrite: count.nullable(),
      input: count.nullable(),
      output: count.nullable(),
      byRole: z.array(AutopilotRoleTokens),
    })
    .nullable(),
  /** The pull request as GitHub reports it; null with no PR, or when `gh` could not say. */
  pr: z
    .object({
      number: z.number().int().min(1).nullable(),
      files: count.nullable(),
      additions: count.nullable(),
      deletions: count.nullable(),
      checksPassed: count.nullable(),
      checksTotal: count.nullable(),
      base: z.string(),
    })
    .nullable(),
  /**
   * The spec's acceptance criteria with the proof the oracle journal holds under the sealed
   * contract: `red_green` for a red run followed by a green one on the same test, `green` for a
   * passing newest run alone, null for neither. Null when the spec could not be read.
   */
  criteria: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        proof: z.enum(["red_green", "green"]).nullable(),
      }),
    )
    .nullable(),
  /** Questions the children asked, by who answered them. */
  questions: z.object({ byOrchestrator: count, byUser: count }).nullable(),
  /** What the retro added to the repository; null when the run did not ship one. */
  retro: z.object({ checks: count, lessons: count }).nullable(),
  /** Assumptions the run made without asking, for the reviewer to check. */
  assumptions: z.array(z.string()),
});
export type AutopilotSummary = z.infer<typeof AutopilotSummary>;

export const AutopilotReport = z.object({
  version: z.literal(1),
  runId: z.string(),
  /** 1 for a run's first report, then one more per report. */
  n: z.number().int().min(1),
  at: z.string().datetime(),
  /** Where the interval this report covers began: the previous report, or the arming of await. */
  since: z.string().datetime(),
  /** When the next report is due at the latest; null on a final report. */
  nextBy: z.string().datetime().nullable(),
  /** The run will not move again: ready, halted, or closed. */
  final: z.boolean(),
  lang: z.string(),
  /** The task as the user wrote it. Kept for readers; the card shows `sessionName` instead. */
  task: z.string(),
  /**
   * The orchestrating session's name with its status prefix taken off (`[in progress] Report
   * card` → `Report card`), or null when it has none left. A report written before the field
   * existed reads as null.
   */
  sessionName: z.string().nullable().default(null),
  state: AutopilotState,
  /** The run's stage as `run.json` names it. */
  stage: z.string(),
  rail: z.array(AutopilotRailStep).length(AUTOPILOT_RAIL.length),
  startedAt: z.string().datetime(),
  elapsedMs: z.number().int().min(0),
  /** The sum over children whose cost is known; null when none is. */
  costUsd: z.number().nullable(),
  /** False when some child's cost is unknown, so `costUsd` is a lower bound. */
  costComplete: z.boolean(),
  /** The change since the previous report; null on the first report or with no cost on either. */
  costDeltaUsd: z.number().nullable(),
  iteration: z.number().int().min(0),
  rung: z.number().int().min(0),
  rejections: z.object({
    total: z.number().int().min(0),
    last: z
      .object({
        source: z.enum(["gate", "verifier", "ci"]),
        blocking: z.number().int().min(0),
      })
      .nullable(),
  }),
  /** Children running when the report was written, so a quiet interval still says who works. */
  active: z.array(
    z.object({
      name: z.string(),
      role: z.string(),
      runningMs: z.number().int().min(0),
    }),
  ),
  /** The open judgment's kind, or null. */
  judgment: z.string().nullable(),
  /** English, from the engine; the orchestrator translates it for the card. */
  callout: z
    .object({
      kind: z.enum(["question", "halt"]),
      text: z.string(),
    })
    .nullable(),
  /** The newest events of the interval, oldest first, English as the engine wrote them. */
  events: z.array(AutopilotEvent).max(AUTOPILOT_EVENTS_MAX),
  omittedEvents: z.number().int().min(0),
  prUrl: z.string().nullable(),
  /** The footer's session; null when no child has started, or for a report older than the field. */
  session: AutopilotSession.nullable().default(null),
  /**
   * The run summed up; only a final report carries it. Null on every periodic report, and on a
   * report older than the field.
   */
  summary: AutopilotSummary.nullable().default(null),
});
export type AutopilotReport = z.infer<typeof AutopilotReport>;

/**
 * What the `autopilot-report` tool hands the widget: the report as the engine wrote it, with the
 * event texts and the callout replaced by the orchestrator's translation when it gave one, and
 * the events of every earlier report of the run, oldest first, so the card can unfold the whole
 * history. An earlier event reads in the language its own report was translated into, or in
 * English when that report was never shown with a translation.
 */
export const AutopilotReportPayload = z.object({
  report: AutopilotReport,
  runDir: z.string(),
  earlier: z.array(AutopilotEvent).default([]),
  /** Events the earlier reports counted in `omittedEvents` and so never carried. */
  earlierOmitted: z.number().int().min(0).default(0),
});
export type AutopilotReportPayload = z.infer<typeof AutopilotReportPayload>;
