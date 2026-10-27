import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  AUTOPILOT_EVENTS_MAX,
  AUTOPILOT_RAIL,
  AutopilotReport,
  type AutopilotRailKey,
  type AutopilotRailStep,
  type AutopilotSession,
  type AutopilotState,
} from "@marvin-toolkit/mcp-shared/contracts/autopilot";
import { contextUse, readLogTail } from "./child-activity.js";
import { childKey, type PipelineEvent, type Run, type Stage } from "./run-store.js";

/**
 * The periodic status report (ADR-0051): what `marvin-pipe await --report-min <m>` writes when
 * its interval ends or when something needs the orchestrator at once, and what the
 * `autopilot-report` tool renders as a card. `buildReport` is pure: everything it says comes from
 * `run.json`, the events of the interval, the stage history and the previous report, so the same
 * inputs always give the same card. The schema comes from its own subpath rather than the
 * contracts index, so the bundles do not take in every other contract's zod schemas with it.
 */

/** Where a run's reports live, one `<n>.json` per report. */
export const REPORTS_DIR = "status-reports";

export const reportPath = (runDir: string, n: number) => join(runDir, REPORTS_DIR, `${n}.json`);

/** The stages a run keeps between rail stages, and the rail stage each belongs to. */
const RAIL_OF: Partial<Record<Stage, AutopilotRailKey>> = {
  intake: "planning",
  planning: "planning",
  test_authoring: "test_authoring",
  executing: "executing",
  gating: "gating",
  verifying: "verifying",
  ci_wait: "ci_wait",
  retro: "retro",
  finalizing: "retro",
};

/** The rail stage a judgment of this kind is raised from, when the stage history does not say. */
const RAIL_OF_JUDGMENT: Record<string, AutopilotRailKey> = {
  planner_questions: "planning",
  spec_approval: "planning",
  executor_questions: "executing",
  unverified: "verifying",
  no_ci: "ci_wait",
};

/** `from → to`, as the engine writes a stage event. */
function stageMove(e: PipelineEvent): { from: string; to: string } | null {
  if (e.kind !== "stage") return null;
  const m = /^(\S+) → (\S+)$/.exec(e.text);
  return m?.[1] && m[2] ? { from: m[1], to: m[2] } : null;
}

/** The rail stage a stage belongs to, or undefined for one between rail stages or unknown. */
const railOf = (stage: string | null) => (stage === null ? undefined : RAIL_OF[stage as Stage]);

/** The stage the run was in when it last moved into `stage`, or null when the history has none. */
function cameFrom(history: PipelineEvent[], stage: string): string | null {
  for (const e of [...history].reverse()) {
    const move = stageMove(e);
    if (move && move.to === stage) return move.from;
  }
  return null;
}

const indexOf = (key: AutopilotRailKey) => AUTOPILOT_RAIL.indexOf(key);

function rail(
  current: number,
  mark: AutopilotRailStep["state"],
  retroDone: boolean,
): AutopilotRailStep[] {
  return AUTOPILOT_RAIL.map((key, i) => {
    if (i < current) return { key, state: "done" };
    if (i === current) return { key, state: mark };
    if (key === "retro" && retroDone) return { key, state: "done" };
    return { key, state: "pending" };
  });
}

/**
 * The status pill and the rail. A run waiting on a judgment sits on the stage that raised it; a
 * halted run is marked failed on the stage it halted from, with the retro done if it ran after
 * the halt; a ready run has every stage done.
 */
function position(
  run: Run,
  history: PipelineEvent[],
): { state: AutopilotState; rail: AutopilotRailStep[] } {
  const reached = (stage: string) => history.some((e) => stageMove(e)?.to === stage);
  if (run.stage === "ready" || (run.stage === "done" && run.haltReason === null && run.prUrl)) {
    return { state: "ready", rail: rail(AUTOPILOT_RAIL.length, "done", true) };
  }
  if (run.stage === "halted" || run.stage === "done" || run.haltReason !== null) {
    const from = cameFrom(history, "halted");
    const key = railOf(from) ?? "planning";
    return { state: "halted", rail: rail(indexOf(key), "failed", reached("retro")) };
  }
  let key = RAIL_OF[run.stage];
  if (key === undefined) {
    const from = cameFrom(history, run.stage);
    key = railOf(from) ?? RAIL_OF_JUDGMENT[run.pendingJudgment?.kind ?? ""] ?? "planning";
  }
  const waiting = run.pendingJudgment !== null;
  return {
    state: waiting ? "waiting" : "running",
    rail: rail(indexOf(key), waiting ? "waiting" : "current", false),
  };
}

/**
 * The run's cost so far. Rows that share a session are one resumed session whose rows each carry
 * the session's running total, so the session is charged once, at its last row; a null cost is
 * unknown, never zero.
 */
function cost(run: Run): { usd: number | null; complete: boolean } {
  const last = new Map<string, number | null>();
  run.children.forEach((c, i) => last.set(c.sessionId ?? `row ${i}`, c.costUsd));
  const values = [...last.values()];
  const known = values.filter((v): v is number => v !== null);
  return {
    usd: known.length === 0 ? null : Math.round(known.reduce((a, b) => a + b, 0) * 100) / 100,
    complete: known.length === values.length,
  };
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The session name the card shows: the orchestrator's name without the status prefix the desktop
 * app's title carries (`[in progress] Report card` → `Report card`), since the card has its own
 * status pill. Null when nothing is left.
 */
export function sessionName(orchestrator: string): string | null {
  const name = oneLine(orchestrator.replace(/^\[[^\]]*\]\s*/, ""));
  return name === "" ? null : name;
}

/** How many finished children of the same model are read for a context window, newest first. */
const WINDOW_LOOKBACK = 4;

/**
 * The child the card's footer describes, read from the run directory: the newest running child,
 * else the newest child. Its model and context come from its `stream-json` log; a running child
 * has no `result` line yet, so its window is taken from the newest finished child that ran the
 * same model. Never throws: an unreadable log leaves the figures null.
 */
export function sessionOf(runDir: string, run: Run): AutopilotSession | null {
  const children = run.children;
  let index = -1;
  for (let i = children.length - 1; i >= 0; i -= 1) {
    if (children[i]?.status === "running") {
      index = i;
      break;
    }
  }
  if (index === -1) index = children.length - 1;
  const child = children[index];
  if (!child) return null;
  const useOf = (i: number) => {
    const c = children[i];
    if (!c) return null;
    const tail = readLogTail(join(runDir, `${childKey(children.slice(0, i), c.name)}.log.jsonl`));
    return tail === null ? null : contextUse(tail.text);
  };
  const use = useOf(index);
  const model = use?.model ?? child.assignment.model;
  let window = use?.window ?? null;
  for (let i = children.length - 1, read = 0; window === null && i >= 0; i -= 1) {
    if (i === index || children[i]?.status === "running") continue;
    if (read++ >= WINDOW_LOOKBACK) break;
    const other = useOf(i);
    if (other?.model === model) window = other.window;
  }
  return {
    name: child.name,
    role: child.role,
    model,
    effort: child.assignment.effort,
    contextTokens: use?.tokens ?? null,
    contextWindow: window,
  };
}

export interface ReportInput {
  run: Run;
  /** Every event of the run so far: the stage history the rail is read from. */
  history: PipelineEvent[];
  /** The notify events of this interval, oldest first. */
  events: PipelineEvent[];
  previous: AutopilotReport | null;
  n: number;
  since: Date;
  now: Date;
  /** The interval; null when the report is written without one. */
  intervalMs: number | null;
  /** The orchestrating session's name, as `orchestratorOf` reads it. */
  orchestrator: string;
  /** The footer's session, as `sessionOf` reads it. */
  session: AutopilotSession | null;
}

export function buildReport(i: ReportInput): AutopilotReport {
  const { run, now } = i;
  const { state, rail: steps } = position(run, i.history);
  // A halted run still runs its retro, and a ready one waits in `ready` for nothing more.
  const final = run.stage === "ready" || run.stage === "done";
  const c = cost(run);
  const prevCost = i.previous?.costUsd ?? null;
  const last = run.rejections[run.rejections.length - 1];
  const kept = i.events.slice(-AUTOPILOT_EVENTS_MAX);
  const callout =
    state === "halted"
      ? { kind: "halt" as const, text: oneLine(run.haltReason ?? "closed without a ready PR") }
      : run.pendingJudgment !== null
        ? { kind: "question" as const, text: run.pendingJudgment.kind }
        : null;
  return AutopilotReport.parse({
    version: 1,
    runId: run.id,
    n: i.n,
    at: now.toISOString(),
    since: i.since.toISOString(),
    nextBy:
      final || i.intervalMs === null ? null : new Date(now.getTime() + i.intervalMs).toISOString(),
    final,
    lang: run.lang,
    task: run.task.original,
    sessionName: sessionName(i.orchestrator),
    state,
    stage: run.stage,
    rail: steps,
    startedAt: new Date(run.createdAt).toISOString(),
    elapsedMs: Math.max(0, now.getTime() - Date.parse(run.createdAt)),
    costUsd: c.usd,
    costComplete: c.complete,
    costDeltaUsd:
      c.usd === null || prevCost === null ? null : Math.round((c.usd - prevCost) * 100) / 100,
    iteration: run.iteration,
    rung: run.rung,
    rejections: {
      total: run.rejections.length,
      last: last ? { source: last.source, blocking: last.fingerprints.length } : null,
    },
    active: run.children
      .filter((ch) => ch.status === "running")
      .map((ch) => ({
        name: ch.name,
        role: ch.role,
        runningMs: Math.max(0, now.getTime() - Date.parse(ch.startedAt)),
      })),
    judgment: run.pendingJudgment?.kind ?? null,
    callout,
    events: kept.map((e) => ({
      at: Number.isNaN(Date.parse(e.ts)) ? now.toISOString() : new Date(e.ts).toISOString(),
      kind: e.kind,
      text: oneLine(e.text),
    })),
    omittedEvents: i.events.length - kept.length,
    prUrl: run.prUrl,
    session: i.session,
  });
}

/** The highest report number written so far, or 0. */
export function lastReportNumber(runDir: string): number {
  const dir = join(runDir, REPORTS_DIR);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir)
    .map((f) => /^(\d+)\.json$/.exec(f)?.[1])
    .filter((m): m is string => m !== undefined)
    .reduce((max, m) => Math.max(max, Number(m)), 0);
}

/** A report read back, or null when it is absent or no longer parses. */
export function readReport(runDir: string, n: number): AutopilotReport | null {
  try {
    return AutopilotReport.parse(JSON.parse(readFileSync(reportPath(runDir, n), "utf8")));
  } catch {
    return null;
  }
}

/** Writes the report whole or not at all, and returns its path. */
export function writeReport(runDir: string, report: AutopilotReport): string {
  mkdirSync(join(runDir, REPORTS_DIR), { recursive: true });
  const path = reportPath(runDir, report.n);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(tmp, path);
  return path;
}
