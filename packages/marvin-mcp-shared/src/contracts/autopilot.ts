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
  /** The task as the user wrote it. */
  task: z.string(),
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
});
export type AutopilotReport = z.infer<typeof AutopilotReport>;

/**
 * What the `autopilot-report` tool hands the widget: the report as the engine wrote it, with the
 * event texts and the callout replaced by the orchestrator's translation when it gave one.
 */
export const AutopilotReportPayload = z.object({
  report: AutopilotReport,
  runDir: z.string(),
});
export type AutopilotReportPayload = z.infer<typeof AutopilotReportPayload>;
