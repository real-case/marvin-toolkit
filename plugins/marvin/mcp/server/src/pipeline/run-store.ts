import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { z } from "zod";
import { isSafeBranchRef } from "../storage/slug.js";

export const STAGES = [
  "intake",
  "planning",
  "awaiting_answer",
  "awaiting_approval",
  "test_authoring",
  "executing",
  "gating",
  "verifying",
  "ci_wait",
  "retro",
  "finalizing",
  "ready",
  "done",
  "halted",
] as const;
export const Stage = z.enum(STAGES);
export type Stage = z.infer<typeof Stage>;

export const TIERS = ["light", "standard", "heavy"] as const;
export type Tier = (typeof TIERS)[number];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];
export const Assignment = z.object({ model: z.string().min(1), effort: z.enum(EFFORTS) });
export type Assignment = z.infer<typeof Assignment>;

export const ROLES = ["planner", "test-author", "executor", "verifier", "retro"] as const;
export type Role = (typeof ROLES)[number];

const Json = z.record(z.string(), z.unknown());

export const Child = z.object({
  name: z.string(),
  role: z.enum(ROLES),
  iteration: z.number().int().min(0),
  sessionId: z.string().nullable(),
  pid: z.number().int().nullable(),
  assignment: Assignment,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  status: z.enum([
    "running",
    "needs_input",
    "spec_ready",
    "done",
    "failed",
    "crashed",
    "stalled",
    "limited",
  ]),
  costUsd: z.number().nullable(),
  cacheReadTokens: z.number().nullable(),
});
export type Child = z.infer<typeof Child>;

export const Run = z.object({
  version: z.literal(2),
  id: z.string(),
  repoRoot: z.string(),
  // `createRunWorktree` fetches it and children are told it, so it is a branch name or nothing.
  base: z.string().refine(isSafeBranchRef, { message: "base is not a safe branch name" }),
  lang: z.string(),
  orchestratorName: z.string(),
  task: z.object({ original: z.string(), english: z.string() }),
  stageA: z.enum(TIERS),
  stage: Stage,
  haltReason: z.string().nullable(),
  worktree: z.string().nullable(),
  branch: z.string().nullable(),
  specPath: z.string().nullable(),
  /**
   * The commit in which the engine put the approved spec, and its metrics record unless git
   * ignores it, on the run branch; null until the approval. Absent from runs written before it
   * existed.
   */
  specCommit: z.string().nullable().default(null),
  tier: z.enum(TIERS).nullable(),
  tierReasons: z.array(z.string()),
  prUrl: z.string().nullable(),
  iteration: z.number().int().min(0),
  rung: z.number().int().min(0),
  rejections: z.array(
    z.object({
      iteration: z.number().int(),
      source: z.enum(["gate", "verifier", "ci"]),
      fingerprints: z.array(z.string()),
      /**
       * The rejection named only the pipeline's own service files (a committed journal or
       * receipt), so it moved no rung and counts against `caps.bookkeeping_rejections` rather
       * than `caps.rejections`. Absent from runs written before it existed.
       */
      bookkeeping: z.boolean().optional(),
    }),
  ),
  retries: z.record(z.string(), z.number().int()),
  questionsAnswered: z.number().int().min(0),
  testAuthorAttempts: z.number().int().min(0),
  /** Rounds in which the executor asked a question or raised a dispute. Absent from older run files. */
  executorQuestionRounds: z.number().int().min(0).default(0),
  sealed: z.array(
    z.object({ path: z.string(), sha256: z.string(), criteria: z.array(z.string()) }),
  ),
  assumptions: z.array(z.string()),
  previousFindings: z.array(Json),
  minorFindings: z.array(Json),
  claims: z.array(z.string()),
  gateReport: Json.nullable(),
  awaitingRole: z.enum(["planner", "executor"]).nullable(),
  pendingJudgment: z.object({ id: z.string(), kind: z.string() }).nullable(),
  pendingWork: z.object({ work: z.string(), data: Json.optional() }).nullable(),
  haltRole: z.enum(ROLES).nullable(),
  finalized: z.boolean(),
  /** When the current wait for CI began; null outside a CI wait. Absent from runs written before it existed. */
  ciSince: z.string().nullable().default(null),
  lastSpawn: z.record(z.string(), Json),
  children: z.array(Child),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Run = z.infer<typeof Run>;

const NEXT: Record<Stage, readonly Stage[]> = {
  intake: ["planning"],
  planning: ["awaiting_answer", "awaiting_approval"],
  awaiting_answer: ["planning", "test_authoring", "executing"],
  awaiting_approval: ["planning", "test_authoring", "executing"],
  test_authoring: ["awaiting_answer", "executing"],
  executing: ["awaiting_answer", "gating"],
  gating: ["executing", "verifying"],
  verifying: ["executing", "test_authoring", "ci_wait"],
  ci_wait: ["executing", "retro"],
  retro: ["finalizing"],
  finalizing: ["ready", "done"],
  ready: ["done"],
  done: [],
  halted: ["retro"],
};

/**
 * The state root as configured, unchecked: MARVIN_PIPELINE_HOME, else
 * ~/.local/state/marvin-pipeline. The `pipeline` tool reads it this way so that it can answer a
 * bad value with a refusal of its own; everything that writes uses `checkedStateRoot`.
 */
export function stateRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.MARVIN_PIPELINE_HOME ?? join(homedir(), ".local", "state", "marvin-pipeline");
}

/**
 * The state root, refused when MARVIN_PIPELINE_HOME is set but empty or relative. Such a root
 * would resolve against the cwd, which for `marvin-pipe` is the user's project: runs and their
 * worktrees would land inside the repository the run works on, and a later call from another
 * directory would not find them.
 */
export function checkedStateRoot(env: NodeJS.ProcessEnv = process.env): string {
  const root = stateRoot(env);
  if (!isAbsolute(root)) {
    throw new Error(
      `MARVIN_PIPELINE_HOME is set to ${JSON.stringify(root)}, which is not an absolute path. ` +
        "Set it to an absolute path, or unset it for ~/.local/state/marvin-pipeline.",
    );
  }
  return root;
}

/**
 * Creates `dir` and any missing parent owner-only (0700): run state holds the task, child
 * transcripts and session ids. Directories that already exist keep their mode.
 */
export function mkdirPrivate(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function runDirFor(
  repoRoot: string,
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(checkedStateRoot(env), basename(repoRoot), id);
}

export function newRunId(now: Date, rand: () => number = Math.random): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
  return `r${stamp}-${Math.floor(rand() * 0xffff)
    .toString(16)
    .padStart(4, "0")}`;
}

export function initRun(o: {
  id: string;
  repoRoot: string;
  base: string;
  lang: string;
  orchestratorName: string;
  task: string;
  taskEnglish: string;
  stageA: Tier;
  now: Date;
}): Run {
  const ts = o.now.toISOString();
  return Run.parse({
    version: 2,
    id: o.id,
    repoRoot: o.repoRoot,
    base: o.base,
    lang: o.lang,
    orchestratorName: o.orchestratorName,
    task: { original: o.task, english: o.taskEnglish },
    stageA: o.stageA,
    stage: "intake",
    haltReason: null,
    worktree: null,
    branch: null,
    specPath: null,
    specCommit: null,
    tier: null,
    tierReasons: [],
    prUrl: null,
    iteration: 0,
    rung: 0,
    rejections: [],
    retries: {},
    questionsAnswered: 0,
    testAuthorAttempts: 0,
    executorQuestionRounds: 0,
    sealed: [],
    assumptions: [],
    previousFindings: [],
    minorFindings: [],
    claims: [],
    gateReport: null,
    awaitingRole: null,
    pendingJudgment: null,
    pendingWork: null,
    haltRole: null,
    finalized: false,
    ciSince: null,
    lastSpawn: {},
    children: [],
    createdAt: ts,
    updatedAt: ts,
  });
}

export function saveRun(dir: string, run: Run): void {
  mkdirPrivate(dir);
  const target = join(dir, "run.json");
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(Run.parse(run), null, 2)}\n`);
  renameSync(tmp, target);
}

export function loadRun(dir: string): Run {
  return Run.parse(JSON.parse(readFileSync(join(dir, "run.json"), "utf8")));
}

export function transition(run: Run, to: Stage, now: Date, reason?: string): Run {
  if (to === "halted") {
    if (run.stage === "done" || run.stage === "halted")
      throw new Error(`cannot halt a run in stage ${run.stage}`);
    if (!reason) throw new Error("halting requires a reason");
    return { ...run, stage: to, haltReason: reason, updatedAt: now.toISOString() };
  }
  if (!NEXT[run.stage].includes(to)) throw new Error(`illegal transition ${run.stage} -> ${to}`);
  return { ...run, stage: to, updatedAt: now.toISOString() };
}

export const EventKind = z.enum([
  "stage",
  "assignment",
  "report",
  "question",
  "answer",
  "verdict",
  "escalation",
  "note",
]);
export interface PipelineEvent {
  ts: string;
  kind: z.infer<typeof EventKind>;
  actor: string;
  text: string;
  data?: Record<string, unknown>;
}

export function appendEvent(dir: string, event: PipelineEvent): void {
  EventKind.parse(event.kind);
  mkdirPrivate(dir);
  appendFileSync(join(dir, "events.jsonl"), `${JSON.stringify(event)}\n`);
}

export function readEvents(dir: string): PipelineEvent[] {
  const file = join(dir, "events.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as PipelineEvent);
}

/**
 * The file key of a child launched as `name` after `before`: the name, and from the second
 * launch under that name (a crash retry repeats the iteration, so it repeats the name) a
 * `.<attempt>` suffix. It is derived from the children before it alone, so the spawn that wrote
 * the files and the wait that reads them, in this engine or a restarted one, always agree.
 */
export function childKey(before: readonly Child[], name: string): string {
  const attempt = before.filter((c) => c.name === name).length + 1;
  return attempt === 1 ? name : `${name}.${attempt}`;
}

/**
 * The file `marvin-pipe attach` writes when another session takes the run over. `run.json` has
 * one writer, the engine, so a new orchestrator name cannot go there while an engine runs; it
 * goes beside it, and every child spawned after it reports to the name it holds. A child already
 * running keeps the name it was launched with.
 */
export const ORCHESTRATOR_FILE = "orchestrator.txt";

/** The orchestrator children report to: the `attach`ed name, else the one the run began with. */
export function orchestratorOf(runDir: string, run: Run): string {
  let text: string;
  try {
    text = readFileSync(join(runDir, ORCHESTRATOR_FILE), "utf8").trim();
  } catch {
    return run.orchestratorName;
  }
  return text === "" ? run.orchestratorName : text;
}
