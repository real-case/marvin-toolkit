import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";

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
  base: z.string(),
  lang: z.string(),
  orchestratorName: z.string(),
  task: z.object({ original: z.string(), english: z.string() }),
  stageA: z.enum(TIERS),
  stage: Stage,
  haltReason: z.string().nullable(),
  worktree: z.string().nullable(),
  branch: z.string().nullable(),
  specPath: z.string().nullable(),
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
    }),
  ),
  retries: z.record(z.string(), z.number().int()),
  questionsAnswered: z.number().int().min(0),
  testAuthorAttempts: z.number().int().min(0),
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

export function stateRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.MARVIN_PIPELINE_HOME ?? join(homedir(), ".local", "state", "marvin-pipeline");
}

export function runDirFor(
  repoRoot: string,
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(stateRoot(env), basename(repoRoot), id);
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
    tier: null,
    tierReasons: [],
    prUrl: null,
    iteration: 0,
    rung: 0,
    rejections: [],
    retries: {},
    questionsAnswered: 0,
    testAuthorAttempts: 0,
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
  mkdirSync(dir, { recursive: true });
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
  mkdirSync(dir, { recursive: true });
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
