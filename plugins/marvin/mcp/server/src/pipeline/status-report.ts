import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  AUTOPILOT_EVENTS_MAX,
  AUTOPILOT_RAIL,
  AutopilotReport,
  type AutopilotRailKey,
  type AutopilotRailStep,
  type AutopilotSession,
  type AutopilotState,
  type AutopilotSummary,
} from "@marvin-toolkit/mcp-shared/contracts/autopilot";
import { parseFrontmatter } from "../storage/frontmatter.js";
import { readOracleRuns, redGreenProof } from "../storage/oracles.js";
import { SpecContract, contractHash, extractContractBlock } from "../storage/spec.js";
import { contextUse, logUsage, readLogTail, type LogUsage } from "./child-activity.js";
import { childKey, type PipelineEvent, type Run, type Stage } from "./run-store.js";

/**
 * The record finalize leaves of what the retro added (`RETRO_APPLIED` in `learning.ts`), named
 * here too so the MCP server, which reads final reports, does not bundle the finalize machinery.
 */
const RETRO_APPLIED = "retro-applied.json";

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

/** What only a final report needs from outside `run.json` and the events: logs, spec, GitHub. */
export interface FinalFacts {
  tokens: AutopilotSummary["tokens"];
  pr: AutopilotSummary["pr"];
  criteria: AutopilotSummary["criteria"];
  retro: AutopilotSummary["retro"];
}

const NO_FACTS: FinalFacts = { tokens: null, pr: null, criteria: null, retro: null };

/**
 * The time spent in each rail stage, from the stage history: each move closes the stage it
 * leaves, and the stage the run is in now runs to `now`. A stage between rail stages, such as a
 * wait for an answer, belongs to none.
 */
function stageTimes(run: Run, history: PipelineEvent[], now: Date): AutopilotSummary["stages"] {
  const spent = new Map<AutopilotRailKey, number>();
  let stage: string = "intake";
  let since = Date.parse(run.createdAt);
  const close = (at: number) => {
    const key = railOf(stage);
    if (key !== undefined && Number.isFinite(since) && Number.isFinite(at)) {
      spent.set(key, (spent.get(key) ?? 0) + Math.max(0, at - since));
    }
  };
  for (const e of history) {
    const move = stageMove(e);
    if (!move) continue;
    const at = Date.parse(e.ts);
    close(at);
    stage = move.to;
    since = at;
  }
  close(now.getTime());
  return AUTOPILOT_RAIL.map((key) => ({ key, ms: spent.get(key) ?? null }));
}

/** The wall-clock time in which at least one child ran: the union of their intervals. */
function activeTime(run: Run, now: Date): number | null {
  const spans = run.children
    .map((c) => [Date.parse(c.startedAt), c.endedAt ? Date.parse(c.endedAt) : now.getTime()])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b! >= a!)
    .sort((x, y) => x[0]! - y[0]!) as [number, number][];
  if (spans.length === 0) return null;
  let total = 0;
  let [start, end] = spans[0]!;
  for (const [a, b] of spans.slice(1)) {
    if (a > end) {
      total += end - start;
      [start, end] = [a, b];
    } else end = Math.max(end, b);
  }
  return total + (end - start);
}

/**
 * The final report's summary. The stage times, the active time, the questions (counted as
 * `aggregate` in `learning.ts` counts them) and the assumptions come from `run.json` and the
 * events; the rest is what `finalFacts` read.
 */
function summaryOf(
  run: Run,
  history: PipelineEvent[],
  now: Date,
  facts: FinalFacts,
): AutopilotSummary {
  const answers = history.filter((e) => e.kind === "answer");
  return {
    stages: stageTimes(run, history, now),
    activeMs: activeTime(run, now),
    roles: run.children.length === 0 ? null : new Set(run.children.map((c) => c.role)).size,
    tokens: facts.tokens,
    pr: facts.pr,
    criteria: facts.criteria,
    questions: {
      byOrchestrator: answers.filter((e) => e.data?.answeredBy === "orchestrator").length,
      byUser: answers.filter((e) => e.data?.answeredBy === "user").length,
    },
    retro: facts.retro,
    assumptions: run.assumptions.map(oneLine).filter((a) => a !== ""),
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
  /** What a final report reads from outside the run, as `finalFacts` reads it; ignored otherwise. */
  facts?: FinalFacts | null;
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
    summary: final ? summaryOf(run, i.history, now, i.facts ?? NO_FACTS) : null,
  });
}

const sumOrNull = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
};

/**
 * The run's tokens by kind and by role, from each child's whole log. Rows that share a session
 * are one resumed session, charged once at its last row as `cost` charges it; the peak context
 * is the largest over every row.
 */
function tokensOf(runDir: string, run: Run): AutopilotSummary["tokens"] {
  const children = run.children;
  if (children.length === 0) return null;
  const usages: (LogUsage | null)[] = children.map((c, i) => {
    try {
      const path = join(runDir, `${childKey(children.slice(0, i), c.name)}.log.jsonl`);
      return logUsage(readFileSync(path, "utf8"));
    } catch {
      return null;
    }
  });
  const lastRow = new Map<string, number>();
  children.forEach((c, i) => lastRow.set(c.sessionId ?? `row ${i}`, i));
  const charged = new Set(lastRow.values());
  const kindsOf = (i: number) => (charged.has(i) ? (usages[i]?.kinds ?? null) : null);
  const kind = (key: "input" | "output" | "cacheRead" | "cacheWrite", rows: number[]) =>
    sumOrNull(rows.map((i) => kindsOf(i)?.[key] ?? null));
  const totalOf = (rows: number[]) =>
    sumOrNull(
      rows.map((i) => {
        const k = kindsOf(i);
        return k === null ? null : k.input + k.output + k.cacheRead + k.cacheWrite;
      }),
    );
  const all = children.map((_, i) => i);
  const roles: string[] = [];
  for (const c of children) if (!roles.includes(c.role)) roles.push(c.role);
  const byRole = roles.map((role) => {
    const rows = all.filter((i) => children[i]!.role === role);
    const newest = rows[rows.length - 1]!;
    let peak: number | null = null;
    let window: number | null = null;
    for (const i of rows) {
      const u = usages[i];
      if (u?.peak != null && (peak === null || u.peak > peak)) {
        peak = u.peak;
        window = u.window;
      }
    }
    if (window === null) window = rows.map((i) => usages[i]?.window ?? null).find((w) => w) ?? null;
    return {
      role,
      sessions: new Set(rows.map((i) => children[i]!.sessionId ?? `row ${i}`)).size,
      model: usages[newest]?.model ?? children[newest]!.assignment.model,
      total: totalOf(rows),
      peakContext: peak,
      contextWindow: window,
    };
  });
  return {
    total: totalOf(all),
    cacheRead: kind("cacheRead", all),
    cacheWrite: kind("cacheWrite", all),
    input: kind("input", all),
    output: kind("output", all),
    byRole,
  };
}

/** Runs `gh` with `args` in `cwd` and returns its stdout; throws when it fails. */
export type GhRunner = (args: string[], cwd: string) => string;

const ghRunner: GhRunner = (args, cwd) =>
  execFileSync("gh", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 20_000,
  });

const PASSED_CHECK = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

/** The pull request's size and checks as `gh` reports them; each figure null when it cannot say. */
function prOf(run: Run, gh: GhRunner): AutopilotSummary["pr"] {
  if (run.prUrl === null) return null;
  const number = Number(/\/pull\/(\d+)/.exec(run.prUrl)?.[1] ?? NaN);
  const pr: NonNullable<AutopilotSummary["pr"]> = {
    number: Number.isInteger(number) && number > 0 ? number : null,
    files: null,
    additions: null,
    deletions: null,
    checksPassed: null,
    checksTotal: null,
    base: run.base,
  };
  try {
    const view = JSON.parse(
      gh(
        [
          "pr",
          "view",
          run.prUrl,
          "--json",
          "changedFiles,additions,deletions,baseRefName,statusCheckRollup",
        ],
        run.worktree ?? run.repoRoot,
      ),
    ) as Record<string, unknown>;
    const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null);
    pr.files = int(view.changedFiles);
    pr.additions = int(view.additions);
    pr.deletions = int(view.deletions);
    if (typeof view.baseRefName === "string" && view.baseRefName !== "") pr.base = view.baseRefName;
    if (Array.isArray(view.statusCheckRollup)) {
      const checks = view.statusCheckRollup as Record<string, unknown>[];
      pr.checksTotal = checks.length;
      pr.checksPassed = checks.filter(
        (c) => PASSED_CHECK.has(String(c.conclusion ?? "")) || c.state === "SUCCESS",
      ).length;
    }
  } catch {
    // The figures stay null: the card shows the PR without them.
  }
  return pr;
}

/** The spec the run shipped: from its worktree, else from the run branch in the main checkout. */
function specText(run: Run): string | null {
  if (run.specPath === null) return null;
  if (run.worktree !== null) {
    try {
      return readFileSync(join(run.worktree, run.specPath), "utf8");
    } catch {
      // The worktree is gone; the branch still holds the spec.
    }
  }
  if (run.branch === null) return null;
  try {
    return execFileSync("git", ["show", `${run.branch}:${run.specPath}`], {
      cwd: run.repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * The spec's criteria with their proof. A criterion whose test the seal stage ran red has
 * `red_green` once the run is ready, since the gates then ran it green; so does one the oracle
 * journal proves under the sealed contract. One whose newest journalled run passed has `green`.
 */
function criteriaOf(run: Run): AutopilotSummary["criteria"] {
  const text = specText(run);
  if (text === null) return null;
  const { frontmatter, body } = parseFrontmatter(text);
  const block = extractContractBlock(body);
  if (!block) return null;
  let contract: SpecContract;
  try {
    const parsed = SpecContract.safeParse(parseYaml(block));
    if (!parsed.success) return null;
    contract = parsed.data;
  } catch {
    return null;
  }
  const sha = contractHash(block);
  const slug = frontmatter.slug?.trim() || basename(run.specPath ?? "", ".md").replace(/^\d+-/, "");
  const runs =
    run.worktree === null
      ? []
      : readOracleRuns(join(run.worktree, ".marvin", "task", "runs"), slug);
  const sealedRed = new Set(run.stage === "ready" ? run.sealed.flatMap((s) => s.criteria) : []);
  return contract.criteria.map((c) => {
    const newest = runs.filter((r) => r.contract_sha === sha && r.criterion === c.id).at(-1);
    const proof =
      sealedRed.has(c.id) || redGreenProof(runs, sha, c.id) === "proven"
        ? ("red_green" as const)
        : newest?.status === "pass"
          ? ("green" as const)
          : null;
    return { id: c.id, text: oneLine(c.statement), proof };
  });
}

/** What the retro added, as finalize recorded it; null for a run that shipped no retro. */
function retroOf(runDir: string): AutopilotSummary["retro"] {
  try {
    const raw = JSON.parse(readFileSync(join(runDir, RETRO_APPLIED), "utf8")) as Record<
      string,
      unknown
    >;
    const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);
    return { checks: int(raw.checks), lessons: int(raw.lessons) };
  } catch {
    return null;
  }
}

/**
 * What a final report reads from outside `run.json`: each child's whole log for the tokens, the
 * shipped spec and the oracle journal for the criteria, `gh` for the pull request, and the record
 * finalize left of the retro. Never throws: a source that cannot be read leaves its part null.
 */
export function finalFacts(runDir: string, run: Run, gh: GhRunner = ghRunner): FinalFacts {
  const safely = <T>(read: () => T): T | null => {
    try {
      return read();
    } catch {
      return null;
    }
  };
  return {
    tokens: safely(() => tokensOf(runDir, run)),
    pr: safely(() => prOf(run, gh)),
    criteria: safely(() => criteriaOf(run)),
    retro: retroOf(runDir),
  };
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
