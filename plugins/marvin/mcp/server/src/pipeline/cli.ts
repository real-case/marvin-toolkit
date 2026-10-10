import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { assignmentFor, loadRubric, readSignals, tierFor, type Rubric } from "./assess.js";
import { l3Gate, readResult, renderComparisonMarkdown, runBench, writeResult } from "./bench.js";
import { answerJudgment, awaitWork, engineAlive, lockHolderPid, runEngine } from "./loop.js";
import {
  assertOrchestratorName,
  createRuntime,
  orchestratorOf,
  writeOrchestrator,
} from "./runtime.js";
import {
  ROLES,
  TIERS,
  appendEvent,
  initRun,
  loadRun,
  newRunId,
  runDirFor,
  saveRun,
  stateRoot,
  type Run,
  type Tier,
} from "./run-store.js";

/**
 * `marvin-pipe` — the autopilot pipeline's command line, and the only way an orchestrator session
 * acts on a run. Every command prints JSON on stdout, except `await`, which prints its lines; a
 * failure is one line on stderr and exit code 1. It is always invoked through `node`, so the
 * bundle carries no shebang and needs no exec bit.
 *
 * The plugin's shipped assets (roles, schemas, hooks, the default rubric) are resolved from where
 * the bundle lives, `dist/marvin-pipe.js` three levels below the plugin root, and never from the
 * cwd, which is the user's project.
 */

const SELF = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** A background Bash command may run two hours; `await` returns well inside that. */
const AWAIT_DEADLINE_MIN = 110;
const AWAIT_POLL_MS = 2000;

type Flags = Record<string, string | boolean | undefined>;

function flag(flags: Flags, name: string): string {
  const value = flags[name];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`--${name} is required`);
  return value;
}

function optional(flags: Flags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function positive(flags: Flags, name: string): number | undefined {
  const raw = optional(flags, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`);
  return n;
}

const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

/** The run directory the caller named, which must hold a run. */
function runDirOf(flags: Flags): string {
  const dir = resolve(flag(flags, "run"));
  if (!existsSync(join(dir, "run.json"))) throw new Error(`no run at ${dir}`);
  return dir;
}

/** The rubric for a repository: marvin's default deep-merged with the project's own. */
export function rubricFor(pluginRoot: string, repoRoot: string): Rubric {
  const defaults = readFileSync(join(pluginRoot, "pipeline", "rubric.default.yaml"), "utf8");
  const projectFile = join(repoRoot, ".marvin", "pipeline", "rubric.yaml");
  const project = existsSync(projectFile) ? readFileSync(projectFile, "utf8") : null;
  return loadRubric(defaults, project);
}

function init(flags: Flags): void {
  const repoRoot = resolve(flag(flags, "repo"));
  const stageA = flag(flags, "stage-a");
  if (!(TIERS as readonly string[]).includes(stageA)) {
    throw new Error(`--stage-a must be one of ${TIERS.join(", ")}, not ${stageA}`);
  }
  assertOrchestratorName(flag(flags, "orch"));
  const now = new Date();
  const id = newRunId(now);
  const runDir = runDirFor(repoRoot, id);
  if (existsSync(runDir)) throw new Error(`run ${id} already exists at ${runDir}`);
  const run = initRun({
    id,
    repoRoot,
    base: flag(flags, "base"),
    lang: flag(flags, "lang"),
    orchestratorName: flag(flags, "orch"),
    task: readFileSync(flag(flags, "task-file"), "utf8"),
    taskEnglish: readFileSync(flag(flags, "task-en-file"), "utf8"),
    stageA: stageA as Tier,
    now,
  });
  mkdirSync(runDir, { recursive: true });
  saveRun(runDir, run);
  print({ runId: id, runDir });
}

/** How long `start` waits for the engine it launched to take the run's lock. */
const START_WAIT_MS = 15_000;

/**
 * Launches a detached engine and returns once it holds the run's lock, so that an `await` armed
 * right after it never reads the starting engine as down (and a restart, as the skill would then
 * try, never meets "an engine already holds" from the engine it just started). An engine that
 * exits before it took the lock is a failed start, reported with the tail of `engine.log`.
 */
async function start(flags: Flags): Promise<void> {
  const runDir = runDirOf(flags);
  if (engineAlive(runDir)) throw new Error(`an engine already holds ${runDir}`);
  const logFile = join(runDir, "engine.log");
  const log = openSync(logFile, "a");
  let pid: number | undefined;
  let exited = false;
  try {
    const child = spawn(process.execPath, [SELF, "engine", "--run", runDir], {
      detached: true,
      stdio: ["ignore", log, log],
      env: process.env,
    });
    child.once("exit", () => {
      exited = true;
    });
    child.unref();
    pid = child.pid;
  } finally {
    closeSync(log);
  }
  if (pid === undefined) throw new Error("the engine could not be launched");
  const deadline = Date.now() + START_WAIT_MS;
  for (;;) {
    if (lockHolderPid(runDir) === pid) break;
    if (exited) {
      const tail = readFileSync(logFile, "utf8").trim().split("\n").slice(-3).join(" | ");
      throw new Error(
        `the engine exited before it took the run: ${tail || "(engine.log is empty)"}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the engine (pid ${pid}) did not take the run within ${START_WAIT_MS / 1000} s; see ${logFile}`,
      );
    }
    await delay(50);
  }
  print({ pid });
}

async function engine(flags: Flags): Promise<void> {
  const runDir = runDirOf(flags);
  const run = loadRun(runDir);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const deps = createRuntime({
    runDir,
    pluginRoot: PLUGIN_ROOT,
    rubric: rubricFor(PLUGIN_ROOT, run.repoRoot),
    signal: controller.signal,
  });
  const done = await runEngine(runDir, deps);
  print({ id: done.id, stage: done.stage, haltReason: done.haltReason, prUrl: done.prUrl });
}

function attach(flags: Flags): void {
  const runDir = runDirOf(flags);
  const name = flag(flags, "orch");
  writeOrchestrator(runDir, name);
  print({ runDir, orchestrator: name });
}

async function awaitCommand(flags: Flags): Promise<void> {
  const runDir = runDirOf(flags);
  const deadlineMin = positive(flags, "deadline-min") ?? AWAIT_DEADLINE_MIN;
  const repeatSec = positive(flags, "repeat-sec");
  const lines = await awaitWork(runDir, {
    pollMs: AWAIT_POLL_MS,
    deadlineMs: deadlineMin * 60_000,
    ...(repeatSec !== undefined ? { repeatMs: repeatSec * 1000 } : {}),
  });
  process.stdout.write(`${lines.join("\n")}\n`);
}

/** Who settled a judgment's questions; the retro and the calibration record count both. */
const ANSWERERS = ["orchestrator", "user"] as const;

/**
 * Writes an answer, refused when its kind's schema or the run's state would refuse it. With
 * `--answered-by`, an `answer` event records who settled it (`data.answeredBy`), which is what
 * the retro aggregate counts as questions answered by the orchestrator or by the user. The event
 * is appended only after the answer is written, so a refused answer records nothing; it carries
 * no notify flag, so `await` never prints it.
 */
function judge(flags: Flags): void {
  const runDir = runDirOf(flags);
  const id = flag(flags, "id");
  const by = optional(flags, "answered-by");
  if (by !== undefined && !(ANSWERERS as readonly string[]).includes(by)) {
    throw new Error(`--answered-by must be one of ${ANSWERERS.join(", ")}, not ${by}`);
  }
  const run = loadRun(runDir);
  const raw: unknown = JSON.parse(readFileSync(flag(flags, "answer-file"), "utf8"));
  const answer = answerJudgment(runDir, id, raw, {
    rubric: rubricFor(PLUGIN_ROOT, run.repoRoot),
  });
  if (by !== undefined) {
    appendEvent(runDir, {
      ts: new Date().toISOString(),
      kind: "answer",
      actor: "orchestrator",
      text: `${id} answered by ${by}`,
      data: { id, answeredBy: by },
    });
  }
  print({ id, answer, ...(by !== undefined ? { answeredBy: by } : {}) });
}

function status(flags: Flags): void {
  const runDir = runDirOf(flags);
  const run = loadRun(runDir);
  print({
    ...run,
    runDir,
    orchestrator: orchestratorOf(runDir, run),
    engineAlive: engineAlive(runDir),
  });
}

/** Every run under the state root, newest first; `--repo` narrows to one repository's runs. */
function list(flags: Flags): void {
  const root = stateRoot();
  const repo = optional(flags, "repo");
  const repoRoot = repo === undefined ? undefined : resolve(repo);
  const groups = repoRoot === undefined ? subdirs(root) : [basename(repoRoot)];
  const rows = groups.flatMap((group) =>
    subdirs(join(root, group)).flatMap((id) => {
      const runDir = join(root, group, id);
      let run: Run;
      try {
        run = loadRun(runDir);
      } catch {
        return [];
      }
      if (repoRoot !== undefined && !sameDir(run.repoRoot, repoRoot)) return [];
      return [
        {
          id: run.id,
          runDir,
          repoRoot: run.repoRoot,
          stage: run.stage,
          haltReason: run.haltReason,
          prUrl: run.prUrl,
          orchestrator: orchestratorOf(runDir, run),
          engineAlive: engineAlive(runDir),
          updatedAt: run.updatedAt,
        },
      ];
    }),
  );
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  print(rows);
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Two repository roots compared as physical paths; one that no longer exists, as written. */
function sameDir(a: string, b: string): boolean {
  const physical = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return physical(a) === physical(b);
}

/** A dry run of tiering: the tier a spec would get, why, and what each role would run as. */
function assess(flags: Flags): void {
  const specPath = resolve(flag(flags, "spec"));
  const repoRoot = resolve(optional(flags, "repo") ?? process.cwd());
  const rubric = rubricFor(PLUGIN_ROOT, repoRoot);
  const signals = readSignals(readFileSync(specPath, "utf8"), rubric);
  const { tier, reasons } = tierFor(signals, rubric);
  const assignments = Object.fromEntries(
    ROLES.map((role) => {
      const a = assignmentFor(tier, role, 0, rubric);
      return [role, a === "skip" ? "skip" : `${a.model}/${a.effort}`];
    }),
  );
  print({ spec: specPath, tier, reasons, signals, assignments });
}

/**
 * The replay benchmark (plan Task 21): every selected task of `--suite`, `--repeat` times, through
 * the whole pipeline in bench mode, then its hidden tests. Writes `<date>-<variant>.json` and `.md`
 * under `--out` (default: the suite's `../results/`); with `--baseline`, the markdown carries the
 * L3 comparison against that earlier result. Prints the paths, the summary and the verdict.
 */
async function bench(flags: Flags): Promise<void> {
  const suiteFile = resolve(flag(flags, "suite"));
  const judge = optional(flags, "judge") ?? "llm";
  if (judge !== "llm" && judge !== "auto")
    throw new Error(`--judge must be llm or auto, not ${judge}`);
  const repeat = positive(flags, "repeat") ?? 2;
  const tasks = optional(flags, "tasks")
    ?.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const baselineFile = optional(flags, "baseline");
  const baseline = baselineFile ? readResult(resolve(baselineFile)) : null;
  const rubric = optional(flags, "rubric");
  const rolesDir = optional(flags, "roles-dir");
  const workDir = optional(flags, "work-dir");
  const maxMin = positive(flags, "max-min");
  const maxUsd = positive(flags, "max-usd");
  const result = await runBench({
    cliPath: SELF,
    suiteFile,
    variant: flag(flags, "variant"),
    repeat,
    judge,
    ...(tasks ? { tasks } : {}),
    ...(rubric ? { rubricFile: rubric } : {}),
    ...(rolesDir ? { rolesDir } : {}),
    ...(workDir ? { workDir: resolve(workDir) } : {}),
    ...(maxMin !== undefined ? { maxMinutesPerRun: maxMin } : {}),
    ...(maxUsd !== undefined ? { maxUsdPerRun: maxUsd } : {}),
  });
  const verdict = baseline ? l3Gate(baseline, result) : null;
  const out = resolve(optional(flags, "out") ?? join(dirname(suiteFile), "..", "results"));
  const files = writeResult(
    out,
    result,
    baseline && verdict ? renderComparisonMarkdown(baseline, result, verdict) : undefined,
  );
  print({ ...files, summary: result.summary, stopped: result.stopped, verdict });
}

/** The L3 gate over two result files; the comparison markdown goes to stdout or `--out`. */
function benchCompare(flags: Flags): void {
  const baseline = readResult(resolve(flag(flags, "baseline")));
  const candidate = readResult(resolve(flag(flags, "candidate")));
  const verdict = l3Gate(baseline, candidate);
  const md = renderComparisonMarkdown(baseline, candidate, verdict);
  const out = optional(flags, "out");
  if (out) writeFileSync(resolve(out), md);
  print({ verdict, ...(out ? { out: resolve(out) } : { markdown: md }) });
}

const COMMANDS: Record<string, (flags: Flags) => void | Promise<void>> = {
  init,
  start,
  engine,
  attach,
  await: awaitCommand,
  judge,
  status,
  list,
  assess,
  bench,
  "bench-compare": benchCompare,
};

const OPTIONS = {
  repo: { type: "string" },
  base: { type: "string" },
  lang: { type: "string" },
  orch: { type: "string" },
  "stage-a": { type: "string" },
  "task-file": { type: "string" },
  "task-en-file": { type: "string" },
  run: { type: "string" },
  id: { type: "string" },
  "answer-file": { type: "string" },
  "answered-by": { type: "string" },
  "deadline-min": { type: "string" },
  "repeat-sec": { type: "string" },
  spec: { type: "string" },
  suite: { type: "string" },
  variant: { type: "string" },
  rubric: { type: "string" },
  "roles-dir": { type: "string" },
  repeat: { type: "string" },
  tasks: { type: "string" },
  baseline: { type: "string" },
  candidate: { type: "string" },
  judge: { type: "string" },
  out: { type: "string" },
  "work-dir": { type: "string" },
  "max-min": { type: "string" },
  "max-usd": { type: "string" },
} as const;

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const run = command === undefined ? undefined : COMMANDS[command];
  if (run === undefined) {
    process.stderr.write(`usage: marvin-pipe <${Object.keys(COMMANDS).join("|")}> [--flags]\n`);
    return 1;
  }
  try {
    const { values } = parseArgs({ args: [...rest], options: OPTIONS, strict: true });
    await run(values);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`marvin-pipe ${command}: ${message}\n`);
    return 1;
  }
}

// Only as the entry point, so that a test can import `main` and `rubricFor` without running one.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === SELF) {
  process.exitCode = await main(process.argv.slice(2));
}
