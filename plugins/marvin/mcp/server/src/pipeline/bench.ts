import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { modelFamily } from "./command.js";
import { HARDENED_GIT_OPTIONS, hardenedGitEnv } from "./gate.js";
import { ROLES, TIERS, loadRun, type Run, type Tier } from "./run-store.js";
import { MODEL_OVERRIDE_VARIABLE, sandboxSettings } from "./sandbox.js";
import { formatTestOne } from "./seal.js";

/*
 * The replay benchmark (plan Task 21, decision D5): every task of a suite is replayed through the
 * whole pipeline, from a task text to a delivered branch, and judged by tests the pipeline never
 * saw. A process change (an "L3" proposal: a role prompt, a rubric) is accepted only when a
 * comparison against the current baseline on the same suite passes `l3Gate`.
 *
 * A suite names a replay repository. The shipped suite (`evals/autopilot/suites/sandbox.yaml`) is
 * synthetic: the repository is generated from a committed fixture at bench time, so its history
 * carries the `pipeline` configuration the engine reads from a run's base commit and its gates run
 * in seconds. Replaying historic marvin-toolkit commits would have neither (README, "Why a
 * synthetic suite").
 *
 * Every run is a sandbox run in bench mode (`sandbox.ts`): children deliver to a local bare origin
 * through the sandbox `gh` shim, CI is fake and green, and the model override, when set, applies to
 * every child and to the judge. The judge stands in for the user: it answers the children's
 * questions from the task's ground truth, approves the spec, and cancels a halted run.
 */

// --------------------------------------------------------------------------------------- suite

const RelPath = z
  .string()
  .min(1)
  .refine((p) => !isAbsolute(p) && !p.split("/").includes("..") && !p.includes("\\"), {
    message: "must be a relative POSIX path inside the repository",
  });

export const SuiteTask = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "a kebab-case id"),
    base_sha: z.string().min(1),
    reference: z.string().min(1),
    tier_expected: z.enum(TIERS),
    stage_a: z.enum(TIERS).default("standard"),
    reference_spec: RelPath.optional(),
    hidden_tests: z.array(RelPath).min(1),
    task_text: z.string().trim().min(1),
    ground_truth: z.string().trim().min(1),
  })
  .strict();
export type SuiteTask = z.infer<typeof SuiteTask>;

export const Suite = z
  .object({
    version: z.literal(1),
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    replay: z.string().min(1),
    tasks: z.array(SuiteTask).min(1),
  })
  .strict()
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    for (const t of s.tasks) {
      if (seen.has(t.id)) ctx.addIssue({ code: "custom", message: `duplicate task id ${t.id}` });
      seen.add(t.id);
    }
  });
export type Suite = z.infer<typeof Suite>;

export interface LoadedSuite {
  suite: Suite;
  suiteFile: string;
  /** The replay fixture: `project/` (the base) and `tasks/<id>/reference/` (each overlay). */
  replayDir: string;
}

export function loadSuite(file: string): LoadedSuite {
  const suiteFile = resolve(file);
  const parsed = Suite.safeParse(parseYaml(readFileSync(suiteFile, "utf8")));
  if (!parsed.success) throw new Error(`${suiteFile}: ${parsed.error.message}`);
  const replayDir = resolve(dirname(suiteFile), parsed.data.replay);
  if (!existsSync(join(replayDir, "project"))) {
    throw new Error(`${suiteFile}: replay ${replayDir} has no project/ directory`);
  }
  for (const t of parsed.data.tasks) {
    if (!existsSync(join(replayDir, "tasks", t.id, "reference"))) {
      throw new Error(`${suiteFile}: task ${t.id} has no tasks/${t.id}/reference/ overlay`);
    }
    if (t.reference_spec && !existsSync(join(replayDir, t.reference_spec))) {
      throw new Error(`${suiteFile}: task ${t.id} names a missing reference_spec`);
    }
  }
  return { suite: parsed.data, suiteFile, replayDir };
}

/** The tasks `--tasks a,b` selects, in suite order; every name must exist. */
export function selectTasks(suite: Suite, names: readonly string[] | undefined): SuiteTask[] {
  if (!names || names.length === 0) return suite.tasks;
  const unknown = names.filter((n) => !suite.tasks.some((t) => t.id === n));
  if (unknown.length > 0) throw new Error(`no such task in ${suite.name}: ${unknown.join(", ")}`);
  return suite.tasks.filter((t) => names.includes(t.id));
}

// ------------------------------------------------------------------------------ replay repository

/** The identity and clock every replay commit is made with, so the history is the same each time. */
const REPLAY_IDENTITY = {
  GIT_AUTHOR_NAME: "Bench Replay",
  GIT_AUTHOR_EMAIL: "bench@example.invalid",
  GIT_COMMITTER_NAME: "Bench Replay",
  GIT_COMMITTER_EMAIL: "bench@example.invalid",
};

const benchGit = (cwd: string, args: string[], extra: Record<string, string> = {}): string =>
  execFileSync("git", [...HARDENED_GIT_OPTIONS, "-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: hardenedGitEnv({ ...REPLAY_IDENTITY, ...extra }),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const commitAt = (repo: string, message: string, n: number) => {
  const date = new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
  benchGit(repo, ["add", "-A"]);
  benchGit(repo, ["commit", "-q", "--allow-empty", "-m", message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
};

export const baseTag = (id: string) => `bench/${id}/base`;
export const referenceTag = (id: string) => `bench/${id}/reference`;

/**
 * Builds the replay repository under `dir`: the base project as the root commit on `dev`, then,
 * for each task of the suite in order, a reference commit applying `tasks/<id>/reference/` over
 * its parent, tagged `bench/<id>/base` (the parent) and `bench/<id>/reference`. Every suite
 * revision and hidden test is then checked to resolve. Returns the repository's path.
 */
export function buildReplayRepo(loaded: LoadedSuite, dir: string): string {
  const repo = join(dir, "replay");
  mkdirSync(repo, { recursive: true });
  benchGit(repo, ["init", "-q", "-b", "dev"]);
  cpSync(join(loaded.replayDir, "project"), repo, { recursive: true });
  commitAt(repo, "chore: replay base project", 0);
  loaded.suite.tasks.forEach((t, i) => {
    benchGit(repo, ["tag", baseTag(t.id)]);
    cpSync(join(loaded.replayDir, "tasks", t.id, "reference"), repo, { recursive: true });
    commitAt(repo, `feat(${t.id}): reference change`, i + 1);
    benchGit(repo, ["tag", referenceTag(t.id)]);
  });
  for (const t of loaded.suite.tasks) {
    const base = resolveRevision(repo, t.base_sha);
    const reference = resolveRevision(repo, t.reference);
    if (base === reference) throw new Error(`task ${t.id}: base and reference are one commit`);
    for (const path of t.hidden_tests) {
      try {
        benchGit(repo, ["cat-file", "-e", `${reference}:${path}`]);
      } catch {
        throw new Error(`task ${t.id}: hidden test ${path} is not in its reference commit`);
      }
    }
  }
  return repo;
}

export function resolveRevision(repo: string, revision: string): string {
  try {
    return benchGit(repo, ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`]);
  } catch {
    throw new Error(`revision ${revision} does not resolve in the replay repository`);
  }
}

/**
 * One run's repositories: a bare origin whose `dev` is the task's base commit, holding that
 * commit's history and nothing else (no tag, no reference commit, so no child can read a hidden
 * test), and a clone of it as the main checkout the run is started from.
 */
export function prepareTaskRepo(
  replayRepo: string,
  baseSha: string,
  dir: string,
): { origin: string; repo: string } {
  mkdirSync(dir, { recursive: true });
  const origin = join(dir, "origin.git");
  benchGit(dir, ["init", "-q", "--bare", "-b", "dev", origin]);
  benchGit(replayRepo, ["push", "-q", "--no-tags", origin, `${baseSha}:refs/heads/dev`]);
  const repo = join(dir, "bench-sandbox");
  benchGit(dir, ["clone", "-q", "--no-tags", origin, repo]);
  return { origin, repo };
}

/** `gates.test_one` as the task's base commit holds it, which is the template its children ran. */
export function testOneTemplate(replayRepo: string, baseSha: string): string {
  const text = benchGit(replayRepo, ["show", `${baseSha}:.marvin/config.json`]);
  const template = (JSON.parse(text) as { gates?: { test_one?: unknown } }).gates?.test_one;
  if (typeof template !== "string" || template.trim() === "") {
    throw new Error(`the base ${baseSha.slice(0, 12)} has no gates.test_one`);
  }
  return template;
}

// --------------------------------------------------------------------------------- hidden tests

export interface HiddenFile {
  path: string;
  passed: boolean;
  exitCode: number | null;
  /** The tail of the runner's output, for a file that did not pass. */
  detail?: string;
}
export interface HiddenResult {
  passed: number;
  total: number;
  ratio: number;
  files: HiddenFile[];
  /** Why nothing could run, when nothing did (no worktree). */
  skipped?: string;
}

const insideRoot = (root: string, rel: string): string => {
  const full = normalize(join(root, rel));
  if (!full.startsWith(root + sep)) throw new Error(`hidden test ${rel} leaves the worktree`);
  return full;
};

/**
 * Copies every hidden test from the reference commit into the run's worktree, replacing a file
 * the pipeline wrote under the same name, then runs each through `gates.test_one`, the shared
 * whole-file template the seal stage uses (`formatTestOne`, which quotes the path through
 * `lib/shell-quote.ts`). A file passes when its runner exits 0.
 */
export function runHiddenTests(o: {
  worktree: string | null;
  replayRepo: string;
  reference: string;
  paths: readonly string[];
  testOne: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): HiddenResult {
  const total = o.paths.length;
  if (o.worktree === null || !existsSync(o.worktree)) {
    return {
      passed: 0,
      total,
      ratio: 0,
      files: o.paths.map((path) => ({ path, passed: false, exitCode: null })),
      skipped: "the run left no worktree",
    };
  }
  const root = resolve(o.worktree);
  for (const path of o.paths) {
    const target = insideRoot(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, benchGit(o.replayRepo, ["show", `${o.reference}:${path}`]) + "\n");
  }
  const env = { ...(o.env ?? process.env) };
  delete env.NODE_TEST_CONTEXT;
  const files = o.paths.map((path): HiddenFile => {
    const r = spawnSync("sh", ["-c", formatTestOne(o.testOne, path)], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: o.timeoutMs ?? 300_000,
    });
    const passed = r.status === 0;
    const tail = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-6).join("\n");
    return { path, passed, exitCode: r.status, ...(passed ? {} : { detail: tail.slice(0, 600) }) };
  });
  const passed = files.filter((f) => f.passed).length;
  return { passed, total, ratio: total === 0 ? 0 : passed / total, files };
}

// --------------------------------------------------------------------------------------- judge

export interface Question {
  id: string;
  text: string;
  recommendation?: string;
  options?: string[];
}
export type QuestionKind = "planner_questions" | "executor_questions";
export type QuestionAnswer =
  { kind: "answers"; text: string; count: number } | { kind: "revise_tests"; text: string };

export interface QuestionJudge {
  name: string;
  /** The model the judge runs on, or null for one that runs none. */
  model: string | null;
  answer(input: {
    kind: QuestionKind;
    questions: Question[];
    dispute: unknown;
    task: SuiteTask;
  }): Promise<{ answer: QuestionAnswer; costUsd: number }>;
}

/** Answers every question with the child's own recommendation; a dispute keeps the sealed test. */
export const autoJudge: QuestionJudge = {
  name: "auto",
  model: null,
  async answer({ questions }) {
    if (questions.length === 0) {
      return {
        answer: {
          kind: "answers",
          text: "The sealed test stands: it asserts what the spec says. Make it pass.",
          count: 0,
        },
        costUsd: 0,
      };
    }
    const text = questions
      .map((q) => `${q.id}: ${q.recommendation ?? "Use your best judgment."}`)
      .join("\n");
    return { answer: { kind: "answers", text, count: questions.length }, costUsd: 0 };
  },
};

/** The model the `llm` judge runs on: the sandbox override when one is set, else Opus. Never Fable. */
export function judgeModel(env: NodeJS.ProcessEnv = process.env): string {
  const model = sandboxSettings(env).modelOverride ?? "opus";
  modelFamily(model);
  return model;
}

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "answers"],
  properties: {
    decision: { type: "string", enum: ["answers", "revise_tests"] },
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "answer"],
        properties: { id: { type: "string" }, answer: { type: "string", minLength: 1 } },
      },
    },
    revise_text: { type: "string" },
  },
} as const;

const JudgeOutput = z.object({
  decision: z.enum(["answers", "revise_tests"]),
  answers: z.array(z.object({ id: z.string(), answer: z.string().trim().min(1) })),
  revise_text: z.string().optional(),
});

/** The `claude -p` result line the judge reads: `structured_output` and the notional cost. */
const ClaudeResult = z
  .object({
    is_error: z.boolean().optional(),
    subtype: z.string().optional(),
    result: z.string().optional(),
    structured_output: z.unknown().optional(),
    total_cost_usd: z.number().optional(),
  })
  .passthrough();

export type RunClaude = (argv: string[], cwd: string) => Promise<string>;

/** Spawns `claude` with stdin closed (F7) and returns its stdout. */
export const spawnClaude: RunClaude = (argv, cwd) =>
  new Promise((resolvePromise, reject) => {
    const [cmd = "claude", ...args] = argv;
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (out += d));
    child.stderr.on("data", (d: string) => (err += d));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0 || out.trim() !== "") resolvePromise(out);
      else reject(new Error(`claude exited ${code}: ${err.trim().slice(0, 300)}`));
    });
  });

/** Thrown when the judge's own session hits the account's usage limit: the bench stops there. */
export class UsageLimitError extends Error {}
const LIMIT_TEXT = /usage limit|rate limit|limit reached|out of extra usage/i;

/**
 * The simulated user: a headless `claude -p` given the task text and its ground truth (never the
 * hidden tests), with no tools, no MCP server and no settings, in an empty directory. It answers
 * each question the way the user who asked for the change would; for a sealed-test dispute it
 * decides whether the test is wrong (`revise_tests`) or stands.
 */
export function llmJudge(o: {
  model: string;
  effort?: string;
  workDir: string;
  runClaude?: RunClaude;
}): QuestionJudge {
  modelFamily(o.model);
  const run = o.runClaude ?? spawnClaude;
  let calls = 0;
  return {
    name: "llm",
    model: o.model,
    async answer({ kind, questions, dispute, task }) {
      calls += 1;
      const prompt = [
        "You are the developer who asked for the change below. An automated pipeline is",
        "implementing it and has questions for you. Answer them as that developer would, from",
        "the ground truth: what the finished change actually is. Be short and decisive; answer",
        "every question by its id; never ask anything back. Do not mention a ground truth or a",
        "reference change; speak as the requester. English only.",
        "",
        "## Task as you wrote it",
        task.task_text,
        "",
        "## Ground truth (what the finished change is)",
        task.ground_truth,
        "",
        `## Questions from the ${kind === "planner_questions" ? "planner" : "executor"}`,
        JSON.stringify(questions, null, 2),
        ...(dispute
          ? [
              "",
              "## Dispute about a sealed acceptance test",
              JSON.stringify(dispute, null, 2),
              "",
              'Set decision to "revise_tests" with revise_text only if the sealed test',
              'contradicts the ground truth; otherwise decision is "answers" and you say why the',
              "test stands.",
            ]
          : ["", 'Set decision to "answers".']),
      ].join("\n");
      const argv = [
        "claude",
        "-p",
        prompt,
        "-n",
        `bench-judge-${task.id}-${calls}`,
        "--model",
        o.model,
        "--effort",
        o.effort ?? "medium",
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(JUDGE_SCHEMA),
        "--permission-mode",
        "dontAsk",
        "--permission-prompts",
        "none",
        "--strict-mcp-config",
        "--setting-sources",
        "project",
        "--disallowedTools",
        "Bash",
        "Read",
        "Grep",
        "Glob",
        "Edit",
        "Write",
        "WebFetch",
        "WebSearch",
        "Agent",
      ];
      mkdirSync(o.workDir, { recursive: true });
      const stdout = await run(argv, o.workDir);
      const line = stdout.trim().split("\n").filter(Boolean).at(-1) ?? "";
      let result: z.infer<typeof ClaudeResult>;
      try {
        result = ClaudeResult.parse(JSON.parse(line));
      } catch {
        if (LIMIT_TEXT.test(stdout)) throw new UsageLimitError(stdout.trim().slice(0, 200));
        throw new Error(`the judge printed no result: ${stdout.trim().slice(0, 200)}`);
      }
      const costUsd = result.total_cost_usd ?? 0;
      if (result.is_error || result.structured_output === undefined) {
        const text = `${result.subtype ?? ""} ${result.result ?? ""}`;
        if (LIMIT_TEXT.test(text)) throw new UsageLimitError(text.trim().slice(0, 200));
        throw new Error(`the judge failed: ${text.trim().slice(0, 200)}`);
      }
      const out = JudgeOutput.parse(result.structured_output);
      if (out.decision === "revise_tests" && kind === "executor_questions" && out.revise_text) {
        return { answer: { kind: "revise_tests", text: out.revise_text }, costUsd };
      }
      const byId = new Map(out.answers.map((a) => [a.id, a.answer]));
      const lines = questions.map(
        (q) => `${q.id}: ${byId.get(q.id) ?? q.recommendation ?? "Use your best judgment."}`,
      );
      const text =
        lines.length > 0
          ? lines.join("\n")
          : (out.answers[0]?.answer ?? "The sealed test stands. Make it pass.");
      return { answer: { kind: "answers", text, count: questions.length }, costUsd };
    },
  };
}

export interface JudgmentDecision {
  answer: Record<string, unknown>;
  answeredBy?: "orchestrator" | "user";
  costUsd: number;
  /** Set when the question judge failed and the child's recommendations stood in. */
  fallback?: string;
}

/**
 * The fixed policy of the simulated user around its question judge: approve the spec as planned,
 * cancel a halted run (so its retro still runs), proceed past a missing CI, retry one unverified
 * PASS and cancel a second, and hand every question to the judge. A judge that fails falls back to
 * the child's own recommendations, recorded, so one bad judge call does not lose the run; a judge
 * that hits the usage limit stops the bench.
 */
export async function decideJudgment(
  kind: string,
  payload: Record<string, unknown>,
  ctx: { judge: QuestionJudge; task: SuiteTask; seen: Map<string, number> },
): Promise<JudgmentDecision> {
  const seen = (ctx.seen.get(kind) ?? 0) + 1;
  ctx.seen.set(kind, seen);
  switch (kind) {
    case "spec_approval":
      return { answer: { kind: "approve" }, costUsd: 0 };
    case "halt":
      return {
        answer: { kind: "cancel", reason: `bench: ${String(payload.reason ?? "halted")}` },
        costUsd: 0,
      };
    case "no_ci":
      return { answer: { kind: "proceed", reason: "the bench has no CI" }, costUsd: 0 };
    case "unverified":
      return {
        answer:
          seen > 1 ? { kind: "cancel", reason: "bench: unverified twice" } : { kind: "retry" },
        costUsd: 0,
      };
    case "planner_questions":
    case "executor_questions": {
      const questions = (Array.isArray(payload.questions) ? payload.questions : []) as Question[];
      const by = ctx.judge.model === null ? "orchestrator" : "user";
      try {
        const { answer, costUsd } = await ctx.judge.answer({
          kind,
          questions,
          dispute: payload.dispute ?? null,
          task: ctx.task,
        });
        return { answer, answeredBy: by, costUsd };
      } catch (error) {
        if (error instanceof UsageLimitError) throw error;
        const { answer } = await autoJudge.answer({
          kind,
          questions,
          dispute: payload.dispute ?? null,
          task: ctx.task,
        });
        return {
          answer,
          answeredBy: "orchestrator",
          costUsd: 0,
          fallback: error instanceof Error ? error.message : String(error),
        };
      }
    }
    default:
      return {
        answer: { kind: "cancel", reason: `bench: unhandled judgment ${kind}` },
        costUsd: 0,
      };
  }
}

// ------------------------------------------------------------------------------------- metrics

export type RunOutcome = "ready" | "done" | "limited" | "aborted" | "error";

export interface RoleMetrics {
  children: number;
  costUsd: number;
  cacheReadTokens: number;
}

export interface RunMetrics {
  task: string;
  repeat: number;
  runId: string | null;
  outcome: RunOutcome;
  stage: string | null;
  haltReason: string | null;
  abortReason: string | null;
  tierExpected: Tier;
  tierAssigned: Tier | null;
  tierMatch: boolean;
  hidden: HiddenResult;
  gatesGreen: boolean;
  rejections: { total: number; gate: number; verifier: number; ci: number };
  iterations: number;
  questions: { judgments: number; asked: number; fallbacks: number };
  perRole: Record<string, RoleMetrics>;
  totalCostUsd: number;
  cacheReadTokens: number;
  judgeCostUsd: number;
  wallMs: number;
}

/** The pipeline-side metrics of one finished run, read from its `run.json`. */
export function runMetrics(run: Run): Pick<
  RunMetrics,
  "stage" | "haltReason" | "tierAssigned" | "gatesGreen" | "rejections" | "iterations"
> & {
  perRole: Record<string, RoleMetrics>;
  totalCostUsd: number;
  cacheReadTokens: number;
  limited: boolean;
} {
  const perRole: Record<string, RoleMetrics> = {};
  for (const role of ROLES) perRole[role] = { children: 0, costUsd: 0, cacheReadTokens: 0 };
  for (const c of run.children) {
    const m = perRole[c.role] ?? { children: 0, costUsd: 0, cacheReadTokens: 0 };
    m.children += 1;
    m.costUsd += c.costUsd ?? 0;
    m.cacheReadTokens += c.cacheReadTokens ?? 0;
    perRole[c.role] = m;
  }
  const count = (source: string) => run.rejections.filter((r) => r.source === source).length;
  const executors = new Set(
    run.children.filter((c) => c.role === "executor").map((c) => c.iteration),
  );
  return {
    stage: run.stage,
    haltReason: run.haltReason,
    tierAssigned: run.tier,
    gatesGreen: (run.gateReport as { passed?: unknown } | null)?.passed === true,
    rejections: {
      total: run.rejections.length,
      gate: count("gate"),
      verifier: count("verifier"),
      ci: count("ci"),
    },
    iterations: executors.size,
    perRole,
    totalCostUsd: round4(Object.values(perRole).reduce((s, m) => s + m.costUsd, 0)),
    cacheReadTokens: Object.values(perRole).reduce((s, m) => s + m.cacheReadTokens, 0),
    limited: run.children.some((c) => c.status === "limited"),
  };
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

// --------------------------------------------------------------------------------------- results

export interface TaskResult {
  id: string;
  tierExpected: Tier;
  runs: RunMetrics[];
}

export interface BenchSummary {
  runs: number;
  readyRuns: number;
  incompleteRuns: number;
  hiddenPassed: number;
  hiddenTotal: number;
  /** Hidden test files passed over hidden test files run, across every run of every task. */
  hiddenPassRate: number;
  tierMatches: number;
  /** The sum of the CLI's `total_cost_usd` over every child: a notional API-price figure. */
  totalCostUsd: number;
  judgeCostUsd: number;
  wallMs: number;
}

export interface BenchResult {
  version: 1;
  suite: string;
  variant: string;
  date: string;
  startedAt: string;
  finishedAt: string;
  /** Costs are the CLI's notional API-price figures, not money billed (README). */
  costIsNotional: true;
  settings: {
    repeat: number;
    tasks: string[];
    modelOverride: string | null;
    judge: string;
    judgeModel: string | null;
    rubric: string | null;
    rolesDir: string | null;
  };
  /** Why the bench stopped before every run was made, if it did (a usage limit). */
  stopped: string | null;
  tasks: TaskResult[];
  summary: BenchSummary;
}

export function summarize(tasks: readonly TaskResult[]): BenchSummary {
  const runs = tasks.flatMap((t) => t.runs);
  const hiddenPassed = runs.reduce((s, r) => s + r.hidden.passed, 0);
  const hiddenTotal = runs.reduce((s, r) => s + r.hidden.total, 0);
  return {
    runs: runs.length,
    readyRuns: runs.filter((r) => r.outcome === "ready").length,
    incompleteRuns: runs.filter((r) => isIncomplete(r)).length,
    hiddenPassed,
    hiddenTotal,
    hiddenPassRate: hiddenTotal === 0 ? 0 : round4(hiddenPassed / hiddenTotal),
    tierMatches: runs.filter((r) => r.tierMatch).length,
    totalCostUsd: round4(runs.reduce((s, r) => s + r.totalCostUsd, 0)),
    judgeCostUsd: round4(runs.reduce((s, r) => s + r.judgeCostUsd, 0)),
    wallMs: runs.reduce((s, r) => s + r.wallMs, 0),
  };
}

/** A run that says nothing about the variant: stopped by a usage limit, a cap, or a bench fault. */
const isIncomplete = (r: RunMetrics) =>
  r.outcome === "limited" || r.outcome === "aborted" || r.outcome === "error";

// --------------------------------------------------------------------------------------- L3 gate

export interface L3Verdict {
  decision: "accept" | "reject" | "inconclusive";
  reasons: string[];
  baseline: { passRate: number; costUsd: number };
  candidate: { passRate: number; costUsd: number };
  checks: {
    passRateHeld: boolean;
    /** Tasks whose hidden ratio fell below the baseline's in every candidate repeat. */
    regressedInEveryRepeat: string[];
    costWithinBound: boolean;
    passRateRose: boolean;
  };
}

/**
 * The L3 gate (plan D5, Task 21). A candidate variant is accepted against the baseline on the same
 * suite when, with every task run at least `minRepeats` times on both sides:
 *
 * 1. the hidden pass rate (files passed over files run, all runs) does not fall;
 * 2. no task regresses in every repeat, a repeat regressing when its hidden ratio is below the
 *    mean of that task's baseline ratios; and
 * 3. the total notional cost is at most baseline × `costFactor` (1.15), or the pass rate rose.
 *
 * It is inconclusive, never an accept, when the suites or task sets differ, a task has too few
 * repeats, or any run is incomplete (a usage limit, a cap, a bench fault): such a run measured the
 * environment, not the variant.
 */
export function l3Gate(
  baseline: BenchResult,
  candidate: BenchResult,
  o: { minRepeats?: number; costFactor?: number } = {},
): L3Verdict {
  const minRepeats = o.minRepeats ?? 2;
  const costFactor = o.costFactor ?? 1.15;
  const b = summarize(baseline.tasks);
  const c = summarize(candidate.tasks);
  const reasons: string[] = [];
  const inconclusive: string[] = [];
  if (baseline.suite !== candidate.suite) {
    inconclusive.push(`different suites: ${baseline.suite} vs ${candidate.suite}`);
  }
  const ids = (r: BenchResult) =>
    r.tasks
      .map((t) => t.id)
      .sort()
      .join(",");
  if (ids(baseline) !== ids(candidate)) {
    inconclusive.push(`different task sets: [${ids(baseline)}] vs [${ids(candidate)}]`);
  }
  for (const [label, r] of [
    ["baseline", baseline],
    ["candidate", candidate],
  ] as const) {
    for (const t of r.tasks) {
      if (t.runs.length < minRepeats) {
        inconclusive.push(`${label} ran ${t.id} ${t.runs.length}× (needs ${minRepeats})`);
      }
      const bad = t.runs.filter(isIncomplete);
      if (bad.length > 0) {
        inconclusive.push(
          `${label} has ${bad.length} incomplete run(s) of ${t.id} (${bad.map((x) => x.outcome).join(", ")})`,
        );
      }
    }
  }

  const passRateHeld = c.hiddenPassRate >= b.hiddenPassRate - 1e-9;
  const passRateRose = c.hiddenPassRate > b.hiddenPassRate + 1e-9;
  const costWithinBound = c.totalCostUsd <= b.totalCostUsd * costFactor + 1e-9;
  const regressedInEveryRepeat: string[] = [];
  for (const t of candidate.tasks) {
    const base = baseline.tasks.find((x) => x.id === t.id);
    if (!base || base.runs.length === 0 || t.runs.length === 0) continue;
    const mean = base.runs.reduce((s, r) => s + r.hidden.ratio, 0) / base.runs.length;
    if (t.runs.every((r) => r.hidden.ratio < mean - 1e-9)) regressedInEveryRepeat.push(t.id);
  }

  if (!passRateHeld) {
    reasons.push(`hidden pass rate fell: ${pct(b.hiddenPassRate)} → ${pct(c.hiddenPassRate)}`);
  }
  if (regressedInEveryRepeat.length > 0) {
    reasons.push(`regressed in every repeat: ${regressedInEveryRepeat.join(", ")}`);
  }
  if (!costWithinBound && !passRateRose) {
    reasons.push(
      `notional cost ${usd(c.totalCostUsd)} exceeds ${costFactor} × baseline ${usd(b.totalCostUsd)} without a higher pass rate`,
    );
  }
  const decision =
    inconclusive.length > 0 ? "inconclusive" : reasons.length > 0 ? "reject" : "accept";
  return {
    decision,
    reasons: [...inconclusive, ...reasons],
    baseline: { passRate: b.hiddenPassRate, costUsd: b.totalCostUsd },
    candidate: { passRate: c.hiddenPassRate, costUsd: c.totalCostUsd },
    checks: { passRateHeld, regressedInEveryRepeat, costWithinBound, passRateRose },
  };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const usd = (n: number) => `$${n.toFixed(2)}`;
const minutes = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;

// --------------------------------------------------------------------------------------- markdown

export function renderResultMarkdown(r: BenchResult): string {
  const s = r.summary;
  const lines = [
    `# Bench ${r.suite} — ${r.variant} (${r.date})`,
    "",
    `Costs are the Claude Code CLI's \`total_cost_usd\`: a **notional** API-price figure, not money`,
    "billed. Runs on a subscription are not charged per token.",
    "",
    `- Tasks: ${r.settings.tasks.join(", ")}; repeats: ${r.settings.repeat}`,
    `- Model override: ${r.settings.modelOverride ?? "none (the rubric's models)"}; judge: ${r.settings.judge}${r.settings.judgeModel ? ` on ${r.settings.judgeModel}` : ""}`,
    `- Rubric variant: ${r.settings.rubric ?? "none"}; roles variant: ${r.settings.rolesDir ?? "none"}`,
    `- Hidden pass rate: **${pct(s.hiddenPassRate)}** (${s.hiddenPassed}/${s.hiddenTotal} files); ready ${s.readyRuns}/${s.runs}; tier as expected ${s.tierMatches}/${s.runs}`,
    `- Notional cost: **${usd(s.totalCostUsd)}** (judge ${usd(s.judgeCostUsd)}); wall time ${minutes(s.wallMs)}`,
    ...(r.stopped ? [`- **Stopped early:** ${r.stopped}`] : []),
    "",
    "| Task | # | Outcome | Tier (assigned / expected) | Hidden | Gates | Iter. | Rejections (g/v/ci) | Questions | Cost | Cache reads | Wall |",
    "|------|---|---------|----------------------------|--------|-------|-------|---------------------|-----------|------|-------------|------|",
  ];
  for (const t of r.tasks) {
    for (const m of t.runs) {
      const outcome =
        m.outcome === "done" && m.haltReason
          ? `done (${m.haltReason})`
          : m.abortReason
            ? `${m.outcome} (${m.abortReason})`
            : m.outcome;
      lines.push(
        `| ${t.id} | ${m.repeat} | ${outcome} | ${m.tierAssigned ?? "—"} / ${m.tierExpected}${m.tierMatch ? "" : " ✗"} | ${m.hidden.passed}/${m.hidden.total} | ${m.gatesGreen ? "green" : "not green"} | ${m.iterations} | ${m.rejections.total} (${m.rejections.gate}/${m.rejections.verifier}/${m.rejections.ci}) | ${m.questions.asked} in ${m.questions.judgments} | ${usd(m.totalCostUsd)} | ${m.cacheReadTokens.toLocaleString("en-US")} | ${minutes(m.wallMs)} |`,
      );
    }
  }
  lines.push(
    "",
    "## Cost per role (notional)",
    "",
    "| Task | # | " + ROLES.join(" | ") + " |",
    "|------|---|" + ROLES.map(() => "---").join("|") + "|",
  );
  for (const t of r.tasks) {
    for (const m of t.runs) {
      lines.push(
        `| ${t.id} | ${m.repeat} | ${ROLES.map((role) => {
          const x = m.perRole[role];
          return x && x.children > 0 ? `${usd(x.costUsd)} (${x.children})` : "—";
        }).join(" | ")} |`,
      );
    }
  }
  const failing = r.tasks.flatMap((t) =>
    t.runs.flatMap((m) =>
      m.hidden.files
        .filter((f) => !f.passed)
        .map(
          (f) =>
            `- ${t.id} #${m.repeat}: \`${f.path}\` failed${m.hidden.skipped ? ` (${m.hidden.skipped})` : ""}`,
        ),
    ),
  );
  if (failing.length > 0) lines.push("", "## Failing hidden tests", "", ...failing);
  return `${lines.join("\n")}\n`;
}

export function renderComparisonMarkdown(
  baseline: BenchResult,
  candidate: BenchResult,
  verdict: L3Verdict,
): string {
  const lines = [
    `## L3 comparison: ${candidate.variant} against ${baseline.variant}`,
    "",
    `**Decision: ${verdict.decision}.**`,
    "",
    "| | Baseline | Candidate |",
    "|---|---|---|",
    `| Variant | ${baseline.variant} (${baseline.date}) | ${candidate.variant} (${candidate.date}) |`,
    `| Hidden pass rate | ${pct(verdict.baseline.passRate)} | ${pct(verdict.candidate.passRate)} |`,
    `| Notional cost | ${usd(verdict.baseline.costUsd)} | ${usd(verdict.candidate.costUsd)} |`,
    `| Repeats | ${baseline.settings.repeat} | ${candidate.settings.repeat} |`,
    "",
    "| Task | Baseline hidden ratios | Candidate hidden ratios |",
    "|------|------------------------|-------------------------|",
  ];
  for (const t of candidate.tasks) {
    const base = baseline.tasks.find((x) => x.id === t.id);
    const ratios = (runs: readonly RunMetrics[] | undefined) =>
      runs && runs.length > 0
        ? runs.map((m) => `${m.hidden.passed}/${m.hidden.total}`).join(", ")
        : "—";
    lines.push(`| ${t.id} | ${ratios(base?.runs)} | ${ratios(t.runs)} |`);
  }
  lines.push(
    "",
    `- Pass rate held: ${verdict.checks.passRateHeld ? "yes" : "no"}; rose: ${verdict.checks.passRateRose ? "yes" : "no"}`,
    `- Regressed in every repeat: ${verdict.checks.regressedInEveryRepeat.join(", ") || "none"}`,
    `- Cost within 1.15 × baseline: ${verdict.checks.costWithinBound ? "yes" : "no"}`,
    ...(verdict.reasons.length > 0
      ? ["", "Reasons:", ...verdict.reasons.map((x) => `- ${x}`)]
      : []),
  );
  return `${lines.join("\n")}\n`;
}

/** Writes `<date>-<variant>.json` and `.md` under `dir`, never over an earlier pair. */
export function writeResult(
  dir: string,
  result: BenchResult,
  comparison?: string,
): { json: string; md: string } {
  mkdirSync(dir, { recursive: true });
  const taken = new Set(readdirSync(dir));
  let stem = `${result.date}-${result.variant}`;
  for (let n = 2; taken.has(`${stem}.json`) || taken.has(`${stem}.md`); n += 1) {
    stem = `${result.date}-${result.variant}-${n}`;
  }
  const json = join(dir, `${stem}.json`);
  const md = join(dir, `${stem}.md`);
  writeFileSync(json, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(md, renderResultMarkdown(result) + (comparison ? `\n${comparison}` : ""));
  return { json, md };
}

export function readResult(file: string): BenchResult {
  const raw = JSON.parse(readFileSync(file, "utf8")) as BenchResult;
  if (raw.version !== 1 || !Array.isArray(raw.tasks))
    throw new Error(`${file} is not a bench result`);
  return raw;
}

// ----------------------------------------------------------------------------------------- runner

export interface BenchOptions {
  /** The `marvin-pipe` bundle the bench drives, as `node <cliPath> <command>`. */
  cliPath: string;
  suiteFile: string;
  variant: string;
  repeat: number;
  tasks?: string[];
  rubricFile?: string;
  rolesDir?: string;
  judge: QuestionJudge | "llm" | "auto";
  /** Where the bench keeps its replay repository and runs; a fresh temp dir when absent. */
  workDir?: string;
  maxMinutesPerRun?: number;
  maxUsdPerRun?: number;
  awaitDeadlineMin?: number;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  log?: (line: string) => void;
}

/**
 * The environment every process of a bench run sees: the caller's, minus what would steer the run
 * from outside (a test runner's context, the fixture judge, marvin's own config pointers, git
 * repository overrides), plus bench mode on top of sandbox mode with green fake CI. A failing `gh`
 * stub goes first on PATH for the engine; children find the sandbox shim before it.
 */
export function benchEnv(
  base: NodeJS.ProcessEnv,
  o: { stateHome: string; stubBin: string; rolesDir?: string },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const keptGit = new Set(["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"]);
  for (const [k, v] of Object.entries(base)) {
    if (k === "NODE_TEST_CONTEXT") continue;
    if (k === "MARVIN_PIPELINE_JUDGE" || k === "MARVIN_PIPELINE_FIXTURES") continue;
    if (k.startsWith("MARVIN_TASKS_") || k === "MARVIN_PIPELINE_HOME") continue;
    if (k.startsWith("GIT_") && !keptGit.has(k)) continue;
    env[k] = v;
  }
  Object.assign(env, {
    PATH: `${o.stubBin}:${base.PATH ?? ""}`,
    MARVIN_PIPELINE_HOME: o.stateHome,
    MARVIN_PIPELINE_SANDBOX: "1",
    MARVIN_PIPELINE_BENCH: "1",
    MARVIN_PIPELINE_FAKE_CI: "green",
  });
  if (o.rolesDir) env.MARVIN_PIPELINE_ROLES_DIR = o.rolesDir;
  else delete env.MARVIN_PIPELINE_ROLES_DIR;
  return env;
}

export async function runBench(o: BenchOptions): Promise<BenchResult> {
  const now = o.now ?? (() => new Date());
  const log = o.log ?? ((line: string) => process.stderr.write(`[bench] ${line}\n`));
  const loaded = loadSuite(o.suiteFile);
  const tasks = selectTasks(loaded.suite, o.tasks);
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(o.variant)) {
    throw new Error(`--variant must be kebab-case: ${o.variant}`);
  }
  if (!Number.isInteger(o.repeat) || o.repeat < 1) throw new Error("--repeat must be at least 1");
  const rolesDir = o.rolesDir ? resolve(o.rolesDir) : undefined;
  const rubricText = o.rubricFile ? readFileSync(resolve(o.rubricFile), "utf8") : null;
  const work = o.workDir ?? mkdtempSync(join(tmpdir(), "marvin-bench-"));
  mkdirSync(work, { recursive: true });
  const stubBin = join(work, "bin");
  mkdirSync(stubBin, { recursive: true });
  writeFileSync(join(stubBin, "gh"), "#!/bin/sh\necho 'gh: bench stub' >&2\nexit 97\n", {
    mode: 0o755,
  });
  const callerEnv = o.env ?? process.env;
  const modelOverride = callerEnv[MODEL_OVERRIDE_VARIABLE]?.trim() || null;
  const probe = benchEnv(callerEnv, {
    stateHome: join(work, "state"),
    stubBin,
    ...(rolesDir ? { rolesDir } : {}),
  });
  // Every switch is checked here, before the replay repository exists, with the engine's rules.
  sandboxSettings(probe);
  const judge: QuestionJudge =
    o.judge === "auto"
      ? autoJudge
      : o.judge === "llm"
        ? llmJudge({ model: judgeModel(probe), workDir: join(work, "judge") })
        : o.judge;

  const replayRepo = buildReplayRepo(loaded, work);
  log(`replay repository ${replayRepo}; work dir ${work}`);
  const startedAt = now();
  const results: TaskResult[] = tasks.map((t) => ({
    id: t.id,
    tierExpected: t.tier_expected,
    runs: [],
  }));
  let stopped: string | null = null;

  outer: for (let repeat = 1; repeat <= o.repeat; repeat += 1) {
    for (const [i, task] of tasks.entries()) {
      const metrics = await runOne({
        o,
        task,
        repeat,
        replayRepo,
        dir: join(work, "runs", `${task.id}-${repeat}`),
        env: benchEnv(callerEnv, {
          stateHome: join(work, "state", `${task.id}-${repeat}`),
          stubBin,
          ...(rolesDir ? { rolesDir } : {}),
        }),
        rubricText,
        judge,
        log,
      });
      results[i]?.runs.push(metrics);
      log(
        `${task.id} #${repeat}: ${metrics.outcome}, hidden ${metrics.hidden.passed}/${metrics.hidden.total}, tier ${metrics.tierAssigned ?? "—"}/${metrics.tierExpected}, $${metrics.totalCostUsd.toFixed(2)}, ${minutes(metrics.wallMs)}`,
      );
      if (metrics.outcome === "limited") {
        stopped = `usage limit reached in ${task.id} #${repeat}; the remaining runs were not made`;
        break outer;
      }
    }
  }

  const finishedAt = now();
  return {
    version: 1,
    suite: loaded.suite.name,
    variant: o.variant,
    date: startedAt.toISOString().slice(0, 10),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    costIsNotional: true,
    settings: {
      repeat: o.repeat,
      tasks: tasks.map((t) => t.id),
      modelOverride,
      judge: judge.name,
      judgeModel: judge.model,
      rubric: o.rubricFile ?? null,
      rolesDir: o.rolesDir ?? null,
    },
    stopped,
    tasks: results,
    summary: summarize(results),
  };
}

interface RunOneInput {
  o: BenchOptions;
  task: SuiteTask;
  repeat: number;
  replayRepo: string;
  dir: string;
  env: NodeJS.ProcessEnv;
  rubricText: string | null;
  judge: QuestionJudge;
  log: (line: string) => void;
}

async function runOne(x: RunOneInput): Promise<RunMetrics> {
  const { o, task, repeat, env, log } = x;
  const baseSha = resolveRevision(x.replayRepo, task.base_sha);
  const reference = resolveRevision(x.replayRepo, task.reference);
  const empty = (outcome: RunOutcome, abortReason: string): RunMetrics => ({
    task: task.id,
    repeat,
    runId: null,
    outcome,
    stage: null,
    haltReason: null,
    abortReason,
    tierExpected: task.tier_expected,
    tierAssigned: null,
    tierMatch: false,
    hidden: {
      passed: 0,
      total: task.hidden_tests.length,
      ratio: 0,
      files: task.hidden_tests.map((path) => ({ path, passed: false, exitCode: null })),
      skipped: abortReason,
    },
    gatesGreen: false,
    rejections: { total: 0, gate: 0, verifier: 0, ci: 0 },
    iterations: 0,
    questions: { judgments: 0, asked: 0, fallbacks: 0 },
    perRole: {},
    totalCostUsd: 0,
    cacheReadTokens: 0,
    judgeCostUsd: 0,
    wallMs: 0,
  });

  const { repo } = prepareTaskRepo(x.replayRepo, baseSha, x.dir);
  if (x.rubricText !== null) {
    // The variant rubric as the project's own: `rubricFor` deep-merges it over marvin's default,
    // and `.marvin/*` is ignored, so the file is no change to the run's tree.
    mkdirSync(join(repo, ".marvin", "pipeline"), { recursive: true });
    writeFileSync(join(repo, ".marvin", "pipeline", "rubric.yaml"), x.rubricText);
  }
  const taskFile = join(x.dir, "task.txt");
  writeFileSync(taskFile, `${task.task_text}\n`);

  const pipe = (...args: string[]): string => {
    const r = spawnSync(process.execPath, [o.cliPath, ...args], { env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`marvin-pipe ${args[0]}: ${(r.stderr ?? "").trim()}`);
    return r.stdout;
  };

  let runDir: string;
  let enginePid: number;
  try {
    ({ runDir } = JSON.parse(
      pipe(
        "init",
        "--repo",
        repo,
        "--base",
        "dev",
        "--lang",
        "en",
        "--orch",
        "Bench",
        "--stage-a",
        task.stage_a,
        "--task-file",
        taskFile,
        "--task-en-file",
        taskFile,
      ),
    ) as { runDir: string });
    ({ pid: enginePid } = JSON.parse(pipe("start", "--run", runDir)) as { pid: number });
  } catch (error) {
    return empty("error", error instanceof Error ? error.message : String(error));
  }
  log(`${task.id} #${repeat}: run ${runDir}`);

  const started = Date.now();
  const maxMs = (o.maxMinutesPerRun ?? 60) * 60_000;
  const maxUsd = o.maxUsdPerRun ?? 5;
  const answered = new Set<string>();
  const seen = new Map<string, number>();
  let judgments = 0;
  let asked = 0;
  let fallbacks = 0;
  let judgeCost = 0;
  let abortReason: string | null = null;
  let limited = false;
  let restarts = 0;
  const readRun = () => loadRun(runDir);
  const spent = (run: Run) => run.children.reduce((s, c) => s + (c.costUsd ?? 0), 0);

  const killAll = (reason: string) => {
    abortReason = reason;
    log(`${task.id} #${repeat}: aborting: ${reason}`);
    try {
      process.kill(enginePid, "SIGTERM");
    } catch {
      /* already gone */
    }
    for (const c of readRun().children) {
      if (c.status === "running" && c.pid) {
        try {
          process.kill(-c.pid, "SIGTERM");
        } catch {
          /* already gone */
        }
      }
    }
  };

  loop: for (;;) {
    const r = spawnSync(
      process.execPath,
      [o.cliPath, "await", "--run", runDir, "--deadline-min", String(o.awaitDeadlineMin ?? 3)],
      { env, encoding: "utf8" },
    );
    if (r.status !== 0) {
      killAll(`await failed: ${(r.stderr ?? "").trim().slice(0, 200)}`);
      break;
    }
    for (const line of r.stdout.split("\n").filter(Boolean)) {
      const [head, ...rest] = line.split(" ");
      if (head === "JUDGMENT") {
        const [id = "", kind = ""] = rest;
        if (answered.has(id)) continue;
        const path = rest.slice(2).join(" ");
        const request = JSON.parse(readFileSync(path, "utf8")) as {
          payload: Record<string, unknown>;
        };
        let decision: JudgmentDecision;
        try {
          decision = await decideJudgment(kind, request.payload, { judge: x.judge, task, seen });
        } catch (error) {
          if (error instanceof UsageLimitError) {
            limited = true;
            killAll(`the judge hit the usage limit: ${error.message}`);
            break loop;
          }
          throw error;
        }
        if (kind === "planner_questions" || kind === "executor_questions") {
          judgments += 1;
          asked += Array.isArray(request.payload.questions) ? request.payload.questions.length : 0;
          if (decision.fallback) fallbacks += 1;
        }
        judgeCost += decision.costUsd;
        const file = join(x.dir, `answer-${id}.json`);
        writeFileSync(file, JSON.stringify(decision.answer));
        const args = ["judge", "--run", runDir, "--id", id, "--answer-file", file];
        if (decision.answeredBy) args.push("--answered-by", decision.answeredBy);
        try {
          pipe(...args);
          answered.add(id);
        } catch (error) {
          log(`${task.id} #${repeat}: answer to ${id} refused: ${(error as Error).message}`);
        }
      }
      if (head === "STAGE" && (rest[0] === "ready" || rest[0] === "done")) break loop;
      if (head === "ENGINE" && rest[0] === "down") {
        const run = readRun();
        if (run.stage === "ready" || run.stage === "done") break loop;
        if (++restarts > 3) {
          killAll("the engine kept failing");
          break loop;
        }
        try {
          pipe("start", "--run", runDir);
        } catch (error) {
          log(`${task.id} #${repeat}: restart failed: ${(error as Error).message}`);
        }
      }
    }
    const run = readRun();
    if (run.stage === "ready" || run.stage === "done") break;
    if (spent(run) > maxUsd) {
      killAll(`notional cost ${usd(spent(run))} over the ${usd(maxUsd)} cap`);
      break;
    }
    if (Date.now() - started > maxMs) {
      killAll(`wall time over ${o.maxMinutesPerRun ?? 60} min`);
      break;
    }
  }
  const wallMs = Date.now() - started;
  // Let a stopping engine release the run before it is read for the last time.
  if (abortReason !== null) await new Promise((r) => setTimeout(r, 1000));

  const run = readRun();
  const m = runMetrics(run);
  const outcome: RunOutcome =
    limited || m.limited
      ? "limited"
      : abortReason !== null
        ? "aborted"
        : run.stage === "ready"
          ? "ready"
          : run.stage === "done"
            ? "done"
            : "error";
  const hidden = runHiddenTests({
    worktree: run.worktree,
    replayRepo: x.replayRepo,
    reference,
    paths: task.hidden_tests,
    testOne: testOneTemplate(x.replayRepo, baseSha),
    env,
  });
  return {
    task: task.id,
    repeat,
    runId: run.id,
    outcome,
    stage: m.stage,
    haltReason: m.haltReason,
    abortReason,
    tierExpected: task.tier_expected,
    tierAssigned: m.tierAssigned,
    tierMatch: m.tierAssigned === task.tier_expected,
    hidden,
    gatesGreen: m.gatesGreen,
    rejections: m.rejections,
    iterations: m.iterations,
    questions: { judgments, asked, fallbacks },
    perRole: m.perRole,
    totalCostUsd: m.totalCostUsd,
    cacheReadTokens: m.cacheReadTokens,
    judgeCostUsd: round4(judgeCost),
    wallMs,
  };
}
