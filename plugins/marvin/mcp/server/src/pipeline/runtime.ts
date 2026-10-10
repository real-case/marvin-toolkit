import { execFileSync, execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { evidenceGap, planGates, resolveGatePlan, unambiguousStackId } from "../lib/gate-plan.js";
import { resolveOracles } from "../lib/oracles.js";
import { type LoadedConfig, loadConfig } from "../storage/config.js";
import { parseFrontmatter } from "../storage/frontmatter.js";
import type { Config } from "../storage/schema.js";
import { isSafeBranchRef } from "../storage/slug.js";
import { contractHash, extractContractBlock } from "../storage/spec.js";
import { readSignals, type Rubric } from "./assess.js";
import { type CiState, classifyCi, fetchCi } from "./ci.js";
import {
  buildChildCommand,
  type ChildCommand,
  READ_ONLY_ROLES,
  readOnlyAllowedTools,
  validatePrefix,
  writingAllowedTools,
} from "./command.js";
import type { Observation, SpawnAction } from "./engine.js";
import {
  type CheckRule,
  type Finding,
  type GateCommand,
  HARDENED_GIT_OPTIONS,
  hardenedGitEnv,
  isCanonicalPath,
  isolatedGit,
  type OracleInput,
  type ProtectedSnapshot,
  protectedChanges,
  reportFindings,
  runGateStage,
  type Runner,
  type SealedFile,
  SEVERITIES,
  sha256Bytes,
  shellRunner,
  snapshotProtected,
} from "./gate.js";
import { launchDetached } from "./launch.js";
import { effectiveAssignment, sandboxChildEnv, sandboxSettings } from "./sandbox.js";
import {
  aggregate,
  efficacy,
  type EfficacyItem,
  finalizeRun,
  type LessonDoc,
  lessonsMarkdown,
  rankLessons,
} from "./learning.js";
import type { EngineDeps, StepInfo, WorkKind } from "./loop.js";
import { composePrompts, RUNTIME_VARS, type RuntimeVar } from "./prompt.js";
import {
  appendEvent,
  type Child,
  type PipelineEvent,
  type Role,
  type Run,
  stateRoot,
} from "./run-store.js";
import { type AuthoredTest, isReseal, sealAuthoredTests, writeSealManifest } from "./seal.js";
import { buildRoleSettings } from "./settings.js";
import { classify, readChildState, summaryLine, type WaitResult } from "./wait.js";
import {
  branchName,
  createRunWorktree,
  diffSnapshots,
  renameRunBranch,
  snapshotTree,
} from "./worktree.js";

/*
 * The engine's hands: `createRuntime` turns the deterministic modules into the `EngineDeps` the
 * loop drives. Everything it leaves behind lives in the run dir, which is never inside a worktree,
 * and everything it does must survive the engine dying half-way and a new engine doing the same
 * step again. The loop tells it which step that is (`StepInfo`); each member below says what it
 * adopts from an earlier attempt instead of doing twice:
 *
 * - `prepare` adopts the run worktree an earlier call created, and repeats neither the bootstrap
 *   nor the protected baseline.
 * - `spawnChild` writes a marker keyed by the step's ref before it launches anything, so a replay
 *   adopts the child already started rather than starting a second one beside it. Files are keyed
 *   by the child's name plus its attempt, so a crash retry of the same iteration, which reuses
 *   the name, writes its own log, exit and result files.
 * - `work` recognises the seal commit, the renamed branch, the ready PR and the finalize commit
 *   an interrupted call already made.
 */

/**
 * The run worktree as `createRunWorktree` made it; `baseSha` and `gitDir` are what the gate
 * trusts. `originUrl` is where `origin` pointed when the run was prepared, before any child could
 * rewrite the repository's config: the gate fetches the base's tip from there (`diffBase`).
 */
const WorktreeRecord = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
  baseSha: z.string().regex(/^[0-9a-f]{40}$/),
  gitDir: z.string().min(1),
  originUrl: z.string().min(1).optional(),
});
type WorktreeRecord = z.infer<typeof WorktreeRecord>;

/** What `spawnChild` records about one launch before and after it happens. */
const SpawnMarker = z.object({
  ref: z.string(),
  key: z.string(),
  name: z.string(),
  startedAt: z.string(),
  pid: z.number().int().nullable(),
});
type SpawnMarker = z.infer<typeof SpawnMarker>;

const SealedEntry = z.object({
  path: z.string(),
  sha256: z.string(),
  criteria: z.array(z.string()),
});
/** One seal step: the verdict once the red runs passed, then the commit that holds it. */
const SealMarker = z.object({
  phase: z.enum(["sealed", "committed"]),
  headBefore: z.string(),
  sealed: z.array(SealedEntry),
  commit: z.string().optional(),
});

const GatedHead = z.object({ head: z.string(), iteration: z.number().int(), passed: z.boolean() });
const CiPoll = z.object({ stage: z.string(), ciSince: z.string().nullable() });

const RegexSource = z
  .string()
  .min(1)
  .refine((source) => {
    try {
      new RegExp(source);
      return true;
    } catch {
      return false;
    }
  }, "is not a valid regular expression");
const CheckRuleShape = z.object({
  id: z.string().min(1),
  pattern: RegexSource,
  path_pattern: RegexSource.optional(),
  exclude_pattern: RegexSource.optional(),
  message: z.string().min(1),
  severity: z.enum(SEVERITIES).optional(),
  category: z.string().min(1).optional(),
});

const CI_STATES: readonly CiState[] = ["green", "red", "pending", "conflict", "no_ci", "closed"];
const FULL_SHA = /^[0-9a-f]{40}$/;
const PLAIN_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CONFIG_PATH = ".marvin/config.json";
const CHECKS_PATH = ".marvin/pipeline/checks.yaml";
const CALIBRATION_PATH = ".marvin/pipeline/calibration.jsonl";
const MEMORY_DIR = ".marvin/memory";
const LESSON_LIMIT = 8;
const GITLINK = "160000";
/** What `snapshotProtected` (`gate.ts`) records for an embedded repository's `<dir>/`. */
const NESTED_REPO = "nested-repo";
/** One `waitChild` lasts at most this long, below the orchestrator's two-hour `await` arm (F11). */
const CHILD_DEADLINE_MS = 110 * 60_000;

export interface RuntimeOptions {
  /** The run dir; a relative one is resolved against the engine's working directory. */
  runDir: string;
  /** marvin's plugin root (`plugins/marvin`): the roles, schemas, hooks and defaults under `pipeline/`. */
  pluginRoot: string;
  rubric: Rubric;
  /**
   * marvin's config for the run; when absent, `.marvin/config.json` as the run's base commit
   * holds it (`runConfig`), and a main checkout whose file the base lacks is checked at prepare.
   */
  config?: Config;
  /**
   * Stops the engine at its next step or wait. Pass it here, or set `signal` on the object
   * `createRuntime` returns: the members read it from that object, so a copy made with spread
   * syntax would not reach them.
   */
  signal?: AbortSignal;
  /** How long a wait sleeps between looks, for an answer and for a child. Default 1000 ms. */
  pollMs?: number;
  /** How long one `waitChild` waits before it reports the child still running. Default 110 min. */
  childDeadlineMs?: number;
  /** Runs the bootstrap, the gates, the oracles and the red runs. Default `shellRunner`. */
  runner?: Runner;
}

/** An absolute path for a non-empty value, else null. */
const resolveOrNull = (value: string | undefined): string | null => (value ? resolve(value) : null);

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Replaces a file whole: a reader (a guard, `await`, a restarted engine) never sees half of it. */
function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function readJson<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success)
    throw new Error(`${path} is not what the runtime wrote: ${parsed.error.message}`);
  return parsed.data;
}

/** The repository's git, hardened the way every other engine git call is (`gate.ts`). */
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", [...HARDENED_GIT_OPTIONS, ...args], {
    cwd,
    env: hardenedGitEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** The events so far; a line a hook tore or garbled is skipped rather than fatal. */
function readEventsTolerant(runDir: string): PipelineEvent[] {
  let text: string;
  try {
    text = readFileSync(join(runDir, "events.jsonl"), "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line): PipelineEvent[] => {
    try {
      const e = JSON.parse(line) as Partial<PipelineEvent> | null;
      return e && typeof e.kind === "string" && typeof e.text === "string"
        ? [e as PipelineEvent]
        : [];
    } catch {
      return [];
    }
  });
}

/** Whether `target` is `root` or lies inside it, comparing physical paths. */
function physicallyInside(root: string, target: string): boolean {
  const rel = relative(realpathSync(root), realpathSync(target));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

type CommittedTree = Pick<WorktreeRecord, "path" | "gitDir" | "baseSha">;

/** `path` as commit `rev` holds it, through the run's pinned git, or null where it has none. */
function committedText(wt: CommittedTree, rev: string, path: string): string | null {
  try {
    return isolatedGit(wt.path, wt.gitDir)
      .bytes("cat-file", "blob", `${rev}:${path}`)
      .toString("utf8");
  } catch {
    return null;
  }
}

/**
 * The marvin config a run works under: `.marvin/config.json` as the run's base commit holds it,
 * which is the schema's rule for `pipeline` and, since D-GATEPLAN, the rule for `gates` too. It
 * is the file every child's own marvin server reads: the plugin pins `MARVIN_TASKS_CONFIG` under
 * `CLAUDE_PROJECT_DIR`, which for a child is the worktree, and the worktree's copy is a protected
 * path. So the gate stage and the executor's `verify` plan the same gates and resolve the same
 * `gates.test_one`, which they would not if the stage read the main checkout's working file: it
 * may carry an uncommitted edit, sit on another branch, or be ignored by git and so never reach a
 * worktree at all. The committed bytes are parsed by the loader every tool uses, from `copy` (in
 * the run dir), which exists exactly when the base commit has the file.
 */
export function runConfig(wt: CommittedTree, copy: string, projectDir: string): LoadedConfig {
  const text = committedText(wt, wt.baseSha, CONFIG_PATH);
  if (text === null) rmSync(copy, { force: true });
  else writeAtomic(copy, text);
  return loadConfig(copy, projectDir);
}

/** One gate of the stage's plan; `missing` names the absent binary of a gate the stage does not run. */
export interface StageGate extends GateCommand {
  missing?: string;
}

/**
 * The blocker for a plan that cannot prove the change, whatever its gates would say: no gate
 * planned at all, no `test` gate that can run, or no gate that can. These are the cases `verify`
 * refuses to deliver (`evidenceGap`, plus an empty plan, for which it writes no verdict), and the
 * stage is authoritative (D20), so it must not accept on the oracles alone what the executor's
 * own delivery gate would refuse. The minor `G-<name>-not-run` findings still name each absent
 * binary; this says why their sum rejects the iteration.
 */
export function evidenceFindings(planned: readonly StageGate[]): Finding[] {
  const absent = planned.flatMap((g) => (g.missing === undefined ? [] : [`\`${g.missing}\``]));
  const fix = "the runner installed, or a command pinned in .marvin/config.json on the base branch";
  if (planned.length === 0) {
    return [
      {
        id: "G-no-evidence",
        severity: "blocker",
        category: "gate",
        claim: "no quality gate is planned for this project, so nothing beyond the oracles is run",
        evidence: "verify's plan: no known stack, no declared script or target, no configured gate",
        expected: `gates declared: ${fix}`,
      },
    ];
  }
  const gap = evidenceGap(planned.map((g) => ({ name: g.name, ran: g.missing === undefined })));
  if (gap === null) return [];
  return [
    {
      id: gap === "test" ? "G-no-test-evidence" : "G-no-evidence",
      severity: "blocker",
      category: "gate",
      claim:
        gap === "test"
          ? "no test evidence: every `test` gate was not run"
          : "no evidence: every planned gate was not run",
      evidence: `not on PATH: ${absent.join(", ")}; verify's delivery gate refuses such a run`,
      expected: fix,
    },
  ];
}

/**
 * The gates the stage runs for a project: `verify`'s plan, through the one shared resolver, and
 * `verify`'s pre-flight probe over it (D-GATEPLAN). A gate whose binary the probe cannot find is
 * marked `missing`, which `verify` records as `not-run` and a warning; failing it here instead
 * would reject, iteration after iteration, a change the executor's own `verify` passes, over a
 * tool the executor cannot install and a config it may not edit.
 */
export function stageGates(projectRoot: string, config: Config): StageGate[] {
  const { gates } = resolveGatePlan({ projectRoot, gates: config.gates });
  return planGates(gates, projectRoot).map(({ gate, probe }) => ({
    name: gate.name,
    command: gate.command,
    ...(probe.kind === "missing" ? { missing: probe.token } : {}),
  }));
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

/** A name a child can address with SendMessage and a hook can quote: one word, no spaces. */
export function assertOrchestratorName(name: string): void {
  if (!/^[\w.-]+$/.test(name)) {
    throw new Error(`invalid orchestrator name: ${JSON.stringify(name)}`);
  }
}

export function writeOrchestrator(runDir: string, name: string): void {
  assertOrchestratorName(name);
  writeAtomic(join(runDir, ORCHESTRATOR_FILE), `${name}\n`);
}

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

/** The environment variable that replaces a role's child with a fixture (`test-author` → `TEST_AUTHOR`). */
export const fakeVariable = (role: Role) =>
  `MARVIN_PIPELINE_FAKE_${role.toUpperCase().replace(/-/g, "_")}`;

/**
 * The environment variable naming a script a fake child runs before it prints its result
 * (`test-author` → `MARVIN_PIPELINE_FAKE_TEST_AUTHOR_SCRIPT`). It is read only for a role whose
 * `fakeVariable` is set, so it can change what a fake does and never turns a real child into
 * anything else. It is how the deterministic sandbox (`test/autopilot-sandbox.test.mjs`) makes a
 * fake planner write its spec, a fake test-author its tests and a fake executor its commits.
 */
export const fakeScriptVariable = (role: Role) => `${fakeVariable(role)}_SCRIPT`;

/**
 * A fake child's argv: `node -e` printing one `result` event whose `structured_output` is the
 * fixture. A fixture holding an array answers the n-th spawn of the role with its n-th element,
 * and its last element after that, so a test can script a FAIL followed by a PASS. With a
 * `script`, the fake first runs it with node in its cwd (the run worktree), passing the 1-based
 * spawn number of the role as its one argument; the script's stdout is discarded so that it
 * cannot corrupt the log, and a script that fails leaves no result, which reads as a crash.
 */
function fakeArgv(
  file: string,
  role: Role,
  run: Run,
  key: string,
  script: string | null,
): string[] {
  const fixture: unknown = JSON.parse(readFileSync(file, "utf8"));
  const earlier = run.children.filter((c) => c.role === role).length;
  const output = Array.isArray(fixture) ? fixture[Math.min(earlier, fixture.length - 1)] : fixture;
  const event = {
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: `fake-${key}`,
    total_cost_usd: 0,
    duration_ms: 0,
    num_turns: 1,
    usage: { cache_read_input_tokens: 0 },
    structured_output: output,
  };
  const before = script
    ? `require("node:child_process").execFileSync(process.execPath, ${JSON.stringify([script, String(earlier + 1)])}, { stdio: ["ignore", "ignore", "inherit"] });`
    : "";
  return [
    process.execPath,
    "-e",
    `${before}process.stdout.write(${JSON.stringify(`${JSON.stringify(event)}\n`)})`,
  ];
}

export function createRuntime(o: RuntimeOptions): EngineDeps {
  const { rubric } = o;
  // Absolute before anything uses it: every child runs in the worktree, so a relative path in
  // its environment, its argv or its wrapper's redirections would name files there, and the
  // wait, finding no log, would neither see the child finish nor ever call it stalled.
  const runDir = resolve(o.runDir);
  const pluginRoot = resolve(o.pluginRoot);
  const pipelineDir = join(pluginRoot, "pipeline");
  const rolesDir = join(pipelineDir, "roles");
  const schemasDir = join(pipelineDir, "schemas");
  const hooksDir = join(pipelineDir, "hooks");
  const runner = o.runner ?? shellRunner;
  const pollMs = o.pollMs ?? 1000;
  const childDeadlineMs = o.childDeadlineMs ?? CHILD_DEADLINE_MS;
  const at = (name: string) => join(runDir, name);
  const now = () => new Date().toISOString();
  // Read once, before any work: a refused combination stops the engine at its start (sandbox.ts).
  const sandbox = sandboxSettings();

  const note = (text: string, data: Record<string, unknown> = {}) =>
    appendEvent(runDir, { ts: now(), kind: "note", actor: "engine", text, data });
  /** A notify event written once per step, so a replayed step does not say it twice. */
  const noteOnce = (ref: string, text: string) => {
    if (readEventsTolerant(runDir).some((e) => e.data?.ref === ref)) return;
    note(text, { notify: true, ref });
  };

  const worktreeRecord = (run: Run): WorktreeRecord => {
    const record = readJson(at("worktree.json"), WorktreeRecord);
    if (!record) throw new Error(`run ${run.id} has no worktree record; prepare has not run`);
    if (run.worktree !== null && run.worktree !== record.path) {
      throw new Error(`the run names worktree ${run.worktree}, its record ${record.path}`);
    }
    return record;
  };

  let cached: Config | null = null;
  /**
   * The run's marvin config (`runConfig`: as its base commit holds it), read once the worktree
   * exists. The pipeline fails closed on a configuration the loader had to repair: a file that
   * did not parse (every setting at its default) or an unusable `pipeline` or `gates.extra`
   * subtree, which the loader reports precisely so that the engine refuses to run on its defaults.
   */
  const configFor = (run: Run): Config => {
    if (o.config) return o.config;
    if (cached) return cached;
    const loaded = runConfig(worktreeRecord(run), at("base-config.json"), run.repoRoot);
    const problems = [...(loaded.warning ? [loaded.warning] : []), ...loaded.pipelineIssues];
    if (problems.length > 0) {
      throw new Error(`the pipeline does not run on this configuration: ${problems.join("; ")}`);
    }
    cached = loaded.config;
    return loaded.config;
  };

  /**
   * The main checkout's `.marvin/config.json` against the one the run works under. Settings that
   * the base commit does not hold at all reach no run and no child, typically because the file is
   * ignored, so a `gates` or `pipeline` there stops the run before it starts rather than letting
   * it run on defaults its author did not choose. A file that differs from a committed one is
   * told once: the committed one is the project's own, and the main checkout may simply be on
   * another branch.
   */
  const checkMainConfig = (run: Run, wt: WorktreeRecord) => {
    let main: string;
    try {
      main = readFileSync(join(run.repoRoot, CONFIG_PATH), "utf8");
    } catch {
      return;
    }
    const base = committedText(wt, wt.baseSha, CONFIG_PATH);
    if (base === main) return;
    if (base !== null) {
      noteOnce(
        "config:main-checkout",
        `the main checkout's ${CONFIG_PATH} differs from the one committed at ${run.base}; the run uses the one committed at ${run.base}, as its children do`,
      );
      return;
    }
    let keys: string[] = [];
    try {
      const json: unknown = JSON.parse(main);
      if (typeof json === "object" && json !== null && !Array.isArray(json)) {
        keys = ["gates", "pipeline"].filter((k) => Object.hasOwn(json, k));
      }
    } catch {
      // Not JSON: nothing in it could have reached a run anyway.
    }
    if (keys.length === 0) return;
    throw new Error(
      `${CONFIG_PATH} is not committed at ${run.base} (${wt.baseSha.slice(0, 12)}), and the main checkout's sets ${keys.map((k) => `\`${k}\``).join(" and ")}, which neither this run nor its children would see: commit it on ${run.base} (\`git add -f\` where .marvin/ is ignored), or remove those keys`,
    );
  };

  const protectedPatterns = (): string[] =>
    z
      .array(z.string())
      .parse(JSON.parse(readFileSync(join(pipelineDir, "protected.default.json"), "utf8")));

  // ------------------------------------------------------------------------------- prepare

  /**
   * The worktree at `path`, adopted after an engine died between creating it and recording it.
   * It must be the root of a worktree of this repository, on the run's own branch; anything else
   * at the run's path is refused rather than used.
   */
  const adoptWorktree = (run: Run, path: string, branch: string): WorktreeRecord => {
    const refuse = (why: string) =>
      new Error(`refusing to adopt ${path} as run ${run.id}'s worktree: ${why}`);
    let top: string;
    let common: string;
    let gitDir: string;
    let onBranch: string;
    try {
      top = git(path, "rev-parse", "--show-toplevel");
      common = git(path, "rev-parse", "--path-format=absolute", "--git-common-dir");
      gitDir = git(path, "rev-parse", "--absolute-git-dir");
      onBranch = git(path, "symbolic-ref", "--short", "HEAD");
    } catch (error) {
      throw refuse(`it is not a git worktree (${errorText(error)})`);
    }
    const repoCommon = git(run.repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir");
    if (realpathSync(top) !== realpathSync(path)) throw refuse(`its top level is ${top}`);
    if (realpathSync(common) !== realpathSync(repoCommon))
      throw refuse("it belongs to another repository");
    if (onBranch !== branch) throw refuse(`it is on ${onBranch}, not ${branch}`);
    // Prepare runs only while the run is at intake, before any child, so nothing has committed
    // on the branch yet and its HEAD is still the base the worktree was created at.
    const baseSha = git(path, "rev-parse", "--verify", "HEAD^{commit}");
    return { path, branch, baseSha, gitDir };
  };

  const setUpWorktree = (run: Run): WorktreeRecord => {
    const saved = readJson(at("worktree.json"), WorktreeRecord);
    if (saved) {
      if (!existsSync(saved.path)) throw new Error(`the run's worktree ${saved.path} is gone`);
      return saved;
    }
    const worktreesRoot = join(stateRoot(), "worktrees");
    const path = join(worktreesRoot, basename(run.repoRoot), run.id);
    const made = existsSync(path)
      ? adoptWorktree(run, path, `autopilot/${run.id}`)
      : createRunWorktree({ repoRoot: run.repoRoot, base: run.base, runId: run.id, worktreesRoot });
    // Read now, while no child has run: `get-url` applies the repository's `insteadOf` rules,
    // which the fetch from the run dir's own repository would no longer see.
    let originUrl: string | undefined;
    try {
      originUrl = git(run.repoRoot, "remote", "get-url", "origin") || undefined;
    } catch {
      originUrl = undefined;
    }
    const record: WorktreeRecord = { ...made, ...(originUrl ? { originUrl } : {}) };
    writeAtomic(at("worktree.json"), `${JSON.stringify(record, null, 2)}\n`);
    return record;
  };

  /**
   * `pipeline.bootstrap` once per run (D18 leaves no `node_modules` to walk up to). HUSKY=0 keeps
   * an install from wiring husky's hooks into the repository's shared git config (D20). It is
   * recorded only once it succeeded, so a bootstrap the engine died inside runs again.
   */
  const bootstrap = (config: Config, worktree: string) => {
    const command = config.pipeline.bootstrap;
    if (!command) return;
    const marker = at("bootstrap.json");
    if (readJson(marker, z.object({ command: z.string() }))?.command === command) return;
    const timeout = config.pipeline.gate_timeout_minutes * 60_000;
    const result = runner(`export HUSKY=0; ${command}`, worktree, timeout);
    if (result.code !== 0) {
      const tail = result.output.trimEnd().split("\n").slice(-20).join("\n");
      throw new Error(`bootstrap \`${command}\` failed (exit ${result.code}):\n${tail}`);
    }
    writeAtomic(marker, `${JSON.stringify({ command })}\n`);
  };

  const prepare = async (run: Run): Promise<Run> => {
    // The worktree comes first: the config is the one its base commit holds.
    const record = setUpWorktree(run);
    const config = configFor(run);
    if (!o.config) checkMainConfig(run, record);
    bootstrap(config, record.path);
    writeAtomic(
      at("test-paths.json"),
      `${JSON.stringify({ pattern: config.pipeline.test_path_pattern })}\n`,
    );
    // sealed-guard denies every edit when it cannot read the manifest, so an executor on a tier
    // without sealed tests needs the empty one.
    if (!existsSync(at("sealed.json"))) writeSealManifest(runDir, []);
    // The gate compares the protected paths against this baseline, taken once, after the
    // bootstrap and before any child: a later baseline would absorb what an earlier child did.
    if (!existsSync(at("protected-baseline.json"))) {
      const baseline = snapshotProtected(record.path, record.gitDir, protectedPatterns());
      writeAtomic(at("protected-baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`);
    }
    return { ...run, worktree: record.path, branch: record.branch };
  };

  // -------------------------------------------------------------------------- prompt vars

  const lessonRoot = (run: Run) => run.worktree ?? run.repoRoot;

  /**
   * The lessons store of the run's tree, read the way `readAllLessons` (`storage/lessons.ts`)
   * reads it but fail-open: that reader stops at the first entry it cannot read. The store lies
   * in the worktree a child writes, and an entry git never lists, such as an empty directory
   * named `x.md`, is one no gate reports; read fail-closed, it would stop the engine at the next
   * spawn and again at every replay of that spawn. Only a regular file is opened, so a FIFO
   * cannot block the engine either. Whatever is skipped is told to the orchestrator once.
   */
  const readLessons = (run: Run) => {
    const dir = join(lessonRoot(run), MEMORY_DIR);
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        noteOnce(
          `lessons:${MEMORY_DIR}`,
          `${MEMORY_DIR} cannot be listed, so no lesson reaches a prompt: ${errorText(error)}`,
        );
      }
      return [];
    }
    return names.flatMap((name) => {
      if (!name.endsWith(".md") || name === "MEMORY.md") return [];
      const path = join(dir, name);
      try {
        if (!lstatSync(path).isFile()) throw new Error("it is not a regular file");
        const { frontmatter, body } = parseFrontmatter(readFileSync(path, "utf8"));
        if (!frontmatter.title) return [];
        const tags = (frontmatter.tags ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        const created = frontmatter.created ?? "";
        return [
          { slug: name.slice(0, -3), title: frontmatter.title, created, tags, body: body.trim() },
        ];
      } catch (error) {
        noteOnce(
          `lessons:${MEMORY_DIR}/${name}`,
          `lesson ${MEMORY_DIR}/${name} was left out of the prompts: ${errorText(error)}`,
        );
        return [];
      }
    });
  };

  const allLessons = (run: Run): LessonDoc[] =>
    readLessons(run).map((l) => ({ id: l.slug, title: l.title, tags: l.tags, body: l.body }));

  /** The spec as the worktree holds it, or null; a path that leaves the worktree is never read. */
  const specOnDisk = (run: Run): string | null => {
    if (run.worktree === null || run.specPath === null || !isCanonicalPath(run.specPath))
      return null;
    const abs = join(run.worktree, run.specPath);
    try {
      if (!physicallyInside(run.worktree, abs)) return null;
      return readFileSync(abs, "utf8");
    } catch {
      return null;
    }
  };

  /**
   * The contract's file paths, which lessons are ranked against. The planner runs before there
   * is a contract, so it gets none ranked here; task-start's own intake recalls lessons through
   * the `lessons` tool.
   */
  const contractPaths = (run: Run): string[] => {
    const text = specOnDisk(run);
    if (text === null) return [];
    try {
      return readSignals(text, rubric).paths;
    } catch {
      return [];
    }
  };

  const recordExposure = (ids: readonly string[]) => {
    if (ids.length === 0) return;
    const known = readJson(at("lessons-exposed.json"), z.array(z.string())) ?? [];
    const merged = [...new Set([...known, ...ids])];
    if (merged.length !== known.length) {
      writeAtomic(at("lessons-exposed.json"), `${JSON.stringify(merged)}\n`);
    }
  };

  const calibrationRecords = (run: Run) => {
    let text: string;
    try {
      text = readFileSync(join(lessonRoot(run), CALIBRATION_PATH), "utf8");
    } catch {
      return [];
    }
    const Record = z.object({
      ts: z.string(),
      findingCategories: z.array(z.string()),
      exposedLessons: z.array(z.string()),
    });
    return text.split("\n").flatMap((line) => {
      try {
        const parsed = Record.safeParse(JSON.parse(line));
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });
  };

  /**
   * The efficacy report the retro prunes from. Only a lesson names the finding category it was
   * written to reduce (its `target:` tag) and the day it was created; a check records neither,
   * so checks are not judged here.
   */
  const efficacyText = (run: Run): string => {
    const items: EfficacyItem[] = readLessons(run).flatMap((l) => {
      const target = l.tags.find((t) => t.startsWith("target:"))?.slice("target:".length);
      return target && l.created
        ? [{ id: l.slug, kind: "lesson" as const, createdAt: l.created, targetCategory: target }]
        : [];
    });
    const results = efficacy(calibrationRecords(run), items);
    if (results.length === 0) return "(none)";
    const rate = (n: number) => n.toFixed(2);
    return results
      .map(
        (r) =>
          `- ${r.id} (lesson): ${r.verdict}; exposed in ${r.exposure} runs; target-category rate ${rate(r.before)} before, ${rate(r.after)} after`,
      )
      .join("\n");
  };

  /**
   * The runtime's half of a fresh spawn's context: exactly `RUNTIME_VARS[role]`, no more. A
   * variable the engine's context already carries is a drift between the two halves, refused
   * here rather than silently overwritten. Every role takes `lessons`, so the ranked ones are
   * recorded as exposed for the calibration record.
   */
  const runtimeVars = (
    run: Run,
    action: SpawnAction,
    name: string,
    config: Config,
  ): Record<string, string> => {
    const { role } = action;
    for (const v of RUNTIME_VARS[role]) {
      if (Object.hasOwn(action.context, v)) {
        throw new Error(`the engine's context for ${role} carries the runtime's ${v}`);
      }
    }
    const ranked = rankLessons(allLessons(run), {
      role,
      paths: contractPaths(run),
      limit: LESSON_LIMIT,
    });
    const supply: Record<RuntimeVar, () => string> = {
      orchestrator: () => orchestratorOf(runDir, run),
      child: () => name,
      lessons: () => lessonsMarkdown(ranked),
      test_path_pattern: () => config.pipeline.test_path_pattern,
      conventions: () => config.pipeline.conventions.trim() || "(none)",
      aggregate: () => JSON.stringify(aggregate(run, readEventsTolerant(runDir)), null, 2),
      efficacy: () => efficacyText(run),
      lessons_index: () => lessonsMarkdown(allLessons(run)),
    };
    const vars = Object.fromEntries(RUNTIME_VARS[role].map((v) => [v, supply[v]()]));
    recordExposure(ranked.map((l) => l.id));
    return vars;
  };

  /**
   * What a verifier may run beyond reading: the part of `gates.test_one` before `{file}`, so it
   * can probe a single test. A prefix the allowlist cannot hold is left out and noted, never
   * widened into something it did not say.
   */
  const probePrefixes = (config: Config): string[] => {
    const template = config.gates?.test_one;
    const cut = template?.indexOf("{file}") ?? -1;
    if (!template || cut < 0) return [];
    const prefix = template.slice(0, cut).trim();
    try {
      validatePrefix(prefix);
      return [prefix];
    } catch (error) {
      note(`the verifier gets no test probe: ${errorText(error)}`);
      return [];
    }
  };

  // ---------------------------------------------------------------------------- children

  const markerPath = (ref: string) => at(join("spawns", `${ref}.json`));

  const runningRow = (run: Run, action: SpawnAction, marker: SpawnMarker): Run => {
    const child: Child = {
      name: marker.name,
      role: action.role,
      iteration: action.iteration,
      sessionId: null,
      pid: marker.pid,
      assignment: action.assignment,
      startedAt: marker.startedAt,
      endedAt: null,
      status: "running",
      costUsd: null,
      cacheReadTokens: null,
    };
    return { ...run, children: [...run.children, child] };
  };

  const spawnChild = (run: Run, planned: SpawnAction, step: StepInfo): Run => {
    // In the sandbox, the override's model replaces the rubric's, and the child row, the event
    // and the argv all name the model the child really runs on.
    const action: SpawnAction = {
      ...planned,
      assignment: effectiveAssignment(planned.assignment, sandbox),
    };
    const config = configFor(run);
    const { role } = action;
    if (run.worktree === null) throw new Error(`cannot spawn ${role}: the run has no worktree`);
    const worktree = run.worktree;
    const name = `${run.id}-${role}-${action.iteration}`;
    const key = childKey(run.children, name);

    // A replay adopts what the step before the restart launched. Its marker names the files; a
    // marker without a pid means the engine died around the launch, and the files the wrapper
    // opens first show whether the child got that far.
    const earlier = step.replay ? readJson(markerPath(step.ref), SpawnMarker) : null;
    const opened = [".log.jsonl", ".err", ".exit"].some((ext) => existsSync(at(`${key}${ext}`)));
    if (earlier) {
      if (earlier.key !== key) {
        throw new Error(
          `spawn ${step.ref} launched ${earlier.key}, and its replay would be ${key}`,
        );
      }
      if (earlier.pid !== null || opened) return runningRow(run, action, earlier);
    } else if (opened) {
      // Another launch already wrote under this key, so the run has lost track of a child. A
      // new launch would truncate its log and could be judged by its stale exit file.
      throw new Error(`files of an earlier launch exist for ${key}; refusing to launch over them`);
    }

    // A fresh spawn renders its template from the engine's context and the runtime's variables;
    // a resume sends the engine's `message` alone.
    const vars = action.resume
      ? { ...action.context }
      : { ...action.context, ...runtimeVars(run, action, name, config) };
    const { system, user } = composePrompts(rolesDir, role, vars, action.resume);
    const systemPromptPath = at(`${role}.system.md`);
    const settingsPath = at(`${role}.settings.json`);
    writeAtomic(systemPromptPath, system);
    writeAtomic(at(`${key}.prompt.md`), user);
    writeAtomic(settingsPath, `${JSON.stringify(buildRoleSettings(role, hooksDir), null, 2)}\n`);
    const schema = readFileSync(join(schemasDir, `${role}.schema.json`), "utf8").trim();
    const allowedTools = READ_ONLY_ROLES.has(role)
      ? readOnlyAllowedTools(role === "verifier" ? probePrefixes(config) : [])
      : writingAllowedTools(config.pipeline.allowed_commands);

    let resumeSessionId: string | undefined;
    if (action.resume) {
      for (const c of run.children)
        if (c.role === role && c.sessionId) resumeSessionId = c.sessionId;
      if (!resumeSessionId) throw new Error(`cannot resume ${role}: no earlier ${role} session`);
    }
    const real = buildChildCommand({
      role,
      name,
      cwd: worktree,
      runDir,
      orchestratorName: orchestratorOf(runDir, run),
      base: run.base,
      assignment: action.assignment,
      prompt: user,
      settingsPath,
      systemPromptPath,
      schema,
      ...(resumeSessionId ? { resumeSessionId } : {}),
      allowedTools,
      ...(role === "test-author" ? { testPathPattern: config.pipeline.test_path_pattern } : {}),
      pluginDir: resolve(process.env.MARVIN_PIPELINE_PLUGIN_DIR || pluginRoot),
      branch: run.branch,
    });
    const sandboxEnv = sandboxChildEnv(runDir, sandbox);
    const live = { ...real, env: { ...real.env, ...sandboxEnv } };
    const fakeFile = process.env[fakeVariable(role)] || null;
    const fakeScript = fakeFile ? resolveOrNull(process.env[fakeScriptVariable(role)]) : null;
    const cmd: ChildCommand = fakeFile
      ? { ...live, argv: fakeArgv(fakeFile, role, run, key, fakeScript) }
      : live;
    const sandboxed = sandbox.enabled
      ? { sandbox: { modelOverride: sandbox.modelOverride, planned: planned.assignment } }
      : {};
    writeAtomic(
      at(`${key}.command.json`),
      `${JSON.stringify({ argv: live.argv, env: live.env, cwd: live.cwd, fake: fakeFile, ...(fakeScript ? { fakeScript } : {}), ...sandboxed }, null, 2)}\n`,
    );

    // D19: the main checkout as it stood before this child, for the leak check after it. A
    // relaunch keeps the snapshot an earlier call took, which predates any launch.
    const mainBefore = at(`${key}.main-before.txt`);
    if (!existsSync(mainBefore)) writeAtomic(mainBefore, snapshotTree(run.repoRoot));

    const marker: SpawnMarker = { ref: step.ref, key, name, startedAt: now(), pid: null };
    writeAtomic(markerPath(step.ref), `${JSON.stringify(marker)}\n`);
    const { pid } = launchDetached(cmd, runDir, key);
    const launched = { ...marker, pid };
    writeAtomic(markerPath(step.ref), `${JSON.stringify(launched)}\n`);
    appendEvent(runDir, {
      ts: now(),
      kind: "assignment",
      actor: "engine",
      text: `${name} started on ${action.assignment.model}/${action.assignment.effort}${action.resume ? " (resumed)" : ""}`,
      data: { ref: step.ref, key, ...(fakeFile ? { fake: true } : {}) },
    });
    return runningRow(run, action, launched);
  };

  /**
   * What the engine learns from a planner's `spec_ready` beyond its words: the signals of the
   * spec it names. A spec the engine cannot read is a crash of the turn that named it, which
   * costs a retry, never the engine.
   */
  const withSignals = (
    run: Run,
    result: WaitResult,
  ): { result: WaitResult; signals?: ReturnType<typeof readSignals> } => {
    const spec = result.structured?.spec as { path?: unknown } | undefined;
    const path = spec?.path;
    // A path that is not canonical is left to `decide`, whose schema refuses it as invalid output.
    if (!isCanonicalPath(path) || run.worktree === null) return { result };
    try {
      const abs = join(run.worktree, path);
      if (!physicallyInside(run.worktree, abs)) throw new Error("it leads out of the worktree");
      return { result, signals: readSignals(readFileSync(abs, "utf8"), rubric) };
    } catch (error) {
      const detail = `spec_ready names ${path}, which the engine cannot read: ${errorText(error)}`;
      return { result: { ...result, outcome: "crashed", detail: detail.slice(0, 300) } };
    }
  };

  /**
   * Signals the process group of a stalled child's wrapper, after confirming that the wrapper
   * still leads it. The pid was recorded at the launch, possibly hours and a reboot ago, and a
   * stalled child (no exit file, an idle log) looks the same as a wrapper that died without
   * writing one, whose pid may since lead another group of the same user. The wrapper is known by
   * its command line, which names this key's log and exit files (`launch.ts`); the file names
   * are matched rather than the whole paths, which `ps` may print escaped. Anything else is left
   * alone and told to the orchestrator.
   */
  const stopStalled = (pid: number, key: string) => {
    let command = "";
    try {
      command = execFileSync("ps", ["-ww", "-o", "command=", "-p", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // `ps` exits non-zero when no process has the pid.
    }
    if (![`${key}.log.jsonl`, `${key}.exit`].every((file) => command.includes(`${sep}${file}`))) {
      noteOnce(
        `stalled:${key}`,
        `${key} stalled, and process group ${pid} was not signalled: its leader is no longer the child's wrapper`,
      );
      return;
    }
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // already gone
    }
  };

  const waitChild = async (run: Run, signal?: AbortSignal) => {
    let index = -1;
    run.children.forEach((c, i) => {
      if (c.status === "running") index = i;
    });
    const child = run.children[index];
    if (!child) throw new Error("no running child to wait for");
    const key = childKey(run.children.slice(0, index), child.name);
    const config = configFor(run);
    const stallMs = config.pipeline.stall_minutes * 60_000;
    const started = Date.now();
    let result: WaitResult;
    for (;;) {
      result = classify({ ...readChildState(runDir, key, Date.now()), stallMs });
      if (result.outcome !== "running" || Date.now() - started >= childDeadlineMs) break;
      await delay(pollMs, undefined, { signal: signal ?? deps.signal });
    }
    if (result.outcome === "running") {
      return { run, obs: { kind: "child", role: child.role, result } satisfies Observation };
    }
    // A stalled child is still alive; it must not keep writing beside the retry that follows.
    if (result.outcome === "stalled" && child.pid) stopStalled(child.pid, key);

    const obs: Extract<Observation, { kind: "child" }> = {
      kind: "child",
      role: child.role,
      result,
    };
    if (child.role === "planner" && result.outcome === "spec_ready") {
      const read = withSignals(run, result);
      obs.result = read.result;
      if (read.signals) obs.signals = read.signals;
    }
    // D19 and S10: anything new in the main checkout. It is shared with other sessions, so the
    // engine raises a halt the orchestrator judges rather than failing the child outright.
    const mainBefore = at(`${key}.main-before.txt`);
    if (existsSync(mainBefore)) {
      const leaked = diffSnapshots(readFileSync(mainBefore, "utf8"), snapshotTree(run.repoRoot));
      if (leaked.length > 0) obs.leaked = leaked;
    } else {
      note(`no main-checkout snapshot for ${key}; its leak check was skipped`, { notify: true });
    }
    // The verifier is read-only: the tree after it must be the tree the snapshot work recorded.
    if (child.role === "verifier") {
      const before = at("snapshot.txt");
      const mutated =
        run.worktree === null
          ? ["the run has no worktree to compare"]
          : existsSync(before)
            ? diffSnapshots(readFileSync(before, "utf8"), snapshotTree(run.worktree))
            : ["no snapshot of the tree was taken before the verifier"];
      if (mutated.length > 0) obs.mutated = mutated;
    }

    const resultPath = at(`${key}.result.json`);
    const first = !existsSync(resultPath);
    const { signals: _signals, ...recorded } = obs;
    writeAtomic(resultPath, `${JSON.stringify(recorded, null, 2)}\n`);
    if (first) {
      appendEvent(runDir, {
        ts: now(),
        kind: "report",
        actor: "engine",
        text: summaryLine(child.name, obs.result),
        data: { notify: true, key },
      });
    }
    const updated: Child = {
      ...child,
      sessionId: obs.result.sessionId ?? child.sessionId,
      costUsd: obs.result.costUsd,
      cacheReadTokens: obs.result.cacheReadTokens,
      status: obs.result.outcome,
      endedAt: now(),
    };
    const children = run.children.map((c, i) => (i === index ? updated : c));
    return { run: { ...run, children }, obs };
  };

  // -------------------------------------------------------------------------------- gate

  /**
   * The commit the gate diffs the branch against. It is the base the run branched from, until
   * the branch merges its base, which is what a CI conflict tells the executor to do (§6 item 5):
   * from then on `baseSha...HEAD` also holds everything that landed on the base meanwhile, and the
   * scope check, the check scan and the protected paths would charge the run with work it cannot
   * undo. So once the branch holds a merge, the engine fetches the base's tip itself and diffs
   * from the merge base of HEAD and that tip.
   *
   * The tip is fetched into a bare repository of the run dir, configured by nobody but the engine,
   * from the URL `origin` had when the run was prepared; it borrows the shared object store
   * through `alternates`, so only what the store lacks is downloaded. The shared repository's refs
   * and its config, both of which a child can write, take no part, so a merge of anything the
   * base does not hold still counts against the run. The merge base must descend from the
   * original base. Whatever goes wrong leaves the original base in force, which can add findings
   * but never hide one, and is told to the orchestrator.
   */
  const diffBase = (run: Run, wt: WorktreeRecord, head: string, timeoutMs: number): string => {
    const merges = isolatedGit(wt.path, wt.gitDir)
      .text("rev-list", "--min-parents=2", "--max-count=1", `${wt.baseSha}..${head}`)
      .trim();
    if (merges === "") return wt.baseSha;
    try {
      if (!wt.originUrl) throw new Error("no origin URL was recorded when the run was prepared");
      if (!isSafeBranchRef(run.base)) throw new Error(`${run.base} is not a safe branch name`);
      const store = at("base.git");
      const env = hardenedGitEnv({ GIT_TERMINAL_PROMPT: "0" });
      const own = (...args: string[]) =>
        execFileSync("git", [...HARDENED_GIT_OPTIONS, ...args], {
          // A relative URL resolves as the repository's own fetches resolve it.
          cwd: run.repoRoot,
          env: { ...env, GIT_DIR: store },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: timeoutMs,
        }).trim();
      if (!existsSync(join(store, "HEAD"))) {
        execFileSync("git", [...HARDENED_GIT_OPTIONS, "init", "-q", "--bare", store], {
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
      const common = git(run.repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir");
      writeAtomic(join(store, "objects", "info", "alternates"), `${join(common, "objects")}\n`);
      own(
        "fetch",
        "--no-tags",
        "--quiet",
        "--",
        wt.originUrl,
        `+refs/heads/${run.base}:refs/heads/base`,
      );
      const tip = own("rev-parse", "--verify", "refs/heads/base^{commit}");
      const mergeBase = own("merge-base", head, tip);
      own("merge-base", "--is-ancestor", wt.baseSha, mergeBase);
      return mergeBase;
    } catch (error) {
      const why = errorText(error).split("\n")[0];
      noteOnce(
        `base-tip:${run.iteration}:${head}`,
        `the base's tip could not be fetched, so the gate diffs iteration ${run.iteration} from the commit the run branched from: ${why}`,
      );
      return wt.baseSha;
    }
  };

  /**
   * The protected baseline as it would have been taken on `to`: every path the base changed
   * between `from` and `to` (a merged base, `diffBase`) carries the fingerprint the base gave it,
   * so that what the base did to a protected file, or a submodule it added, is not charged to the
   * run. The baseline is never rewritten: each gate derives this from the one prepare took. A
   * change the run makes itself still differs from it, and the committed diff from `to` names it.
   */
  const rebaseline = (
    wt: WorktreeRecord,
    baseline: ProtectedSnapshot,
    from: string,
    to: string,
  ): ProtectedSnapshot => {
    if (from === to) return baseline;
    const g = isolatedGit(wt.path, wt.gitDir);
    const raw = g.text("diff", "--raw", "-z", "--no-abbrev", "--no-renames", from, to).split("\0");
    const entries: { path: string; srcMode: string; dstMode: string; dstSha: string }[] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const m = /^:(\d{6}) (\d{6}) [0-9a-f]+ ([0-9a-f]+) /.exec(raw[i] ?? "");
      const path = raw[i + 1];
      if (m?.[1] && m[2] && m[3] && path !== undefined) {
        entries.push({ path, srcMode: m[1], dstMode: m[2], dstSha: m[3] });
      }
    }
    const isProtected = new Set(
      protectedChanges(
        entries.map((e) => e.path),
        protectedPatterns(),
      ),
    );
    const out: ProtectedSnapshot = { ...baseline };
    for (const { path, srcMode, dstMode, dstSha } of entries) {
      // `snapshotProtected` records every gitlink, protected or not, as `<dir>/`.
      if (srcMode === GITLINK) delete out[`${path}/`];
      if (dstMode === GITLINK) out[`${path}/`] = NESTED_REPO;
      if (!isProtected.has(path)) continue;
      delete out[path];
      if (dstMode === "000000" || dstMode === GITLINK) continue;
      const blob = g.bytes("cat-file", "blob", dstSha);
      out[path] = dstMode === "120000" ? `link:${blob.toString("utf8")}` : sha256Bytes(blob);
    }
    return out;
  };

  const parseChecks = (text: string | null, where: string): CheckRule[] => {
    if (text === null) return [];
    const doc: unknown = parseYaml(text);
    if (doc === null || doc === undefined) return [];
    const parsed = z.array(CheckRuleShape).safeParse(doc);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`${where}: ${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
    }
    return parsed.data;
  };

  /**
   * The spec as the gate judges it: as committed at HEAD, since finalize ships the committed
   * spec and refuses a run whose spec is not, and sealed, since nobody may edit a sealed
   * contract. What is wrong with it becomes a blocker for the executor, never a thrown error.
   */
  const gateSpec = (
    run: Run,
    wt: WorktreeRecord,
    head: string,
  ): { text: string | null; findings: Finding[] } => {
    const findings: Finding[] = [];
    const finding = (id: string, claim: string, evidence: string, expected: string): Finding => ({
      id: `SPEC-${id}`,
      severity: "blocker",
      category: "spec",
      ...(run.specPath ? { file: run.specPath } : {}),
      claim,
      evidence,
      expected,
    });
    const path = run.specPath;
    if (path === null || !isCanonicalPath(path)) {
      findings.push(
        finding(
          "path",
          `the run's spec path is not a repo-relative path: ${String(path)}`,
          "run.json specPath",
          "a canonical spec path",
        ),
      );
      return { text: null, findings };
    }
    let text = committedText(wt, head, path);
    if (text === null) {
      text = specOnDisk(run);
      findings.push(
        finding(
          "uncommitted",
          `the spec ${path} is not committed on the run branch`,
          `git cat-file blob HEAD:${path} fails`,
          `commit ${path} on the run branch (git add -f ${path} where it is ignored): finalize ships the committed spec`,
        ),
      );
    }
    if (text === null) {
      findings.push(
        finding(
          "unreadable",
          `the spec ${path} cannot be read`,
          "neither HEAD nor the worktree holds it",
          "the sealed spec",
        ),
      );
      return { text, findings };
    }
    const { frontmatter, body } = parseFrontmatter(text.replace(/\r\n?/g, "\n"));
    const block = extractContractBlock(body);
    const stamped = (frontmatter.contract_sha ?? "").trim();
    if (block === null) {
      findings.push(
        finding(
          "contract",
          `the spec ${path} has no spec-contract block`,
          "no ```yaml spec-contract block",
          "the sealed contract",
        ),
      );
    } else if (!stamped) {
      findings.push(
        finding(
          "unsealed",
          `the spec ${path} is not sealed`,
          "its front matter has no contract_sha",
          "a sealed spec",
        ),
      );
    } else if (contractHash(block) !== stamped) {
      findings.push(
        finding(
          "tampered",
          `the spec ${path} was edited after it was sealed`,
          `contract_sha ${stamped}, the block hashes to ${contractHash(block)}`,
          `the contract as sealed: git checkout <seal commit> -- ${path}`,
        ),
      );
    }
    return { text, findings };
  };

  const gateWork = (run: Run): { run: Run; obs: Observation } => {
    const config = configFor(run);
    const wt = worktreeRecord(run);
    const head = isolatedGit(wt.path, wt.gitDir)
      .text("rev-parse", "--verify", "HEAD^{commit}")
      .trim();
    const spec = gateSpec(run, wt, head);
    const findings = [...spec.findings];

    let oracles: OracleInput[] = [];
    const contractFiles = new Set<string>(
      run.specPath && isCanonicalPath(run.specPath) ? [run.specPath] : [],
    );
    if (spec.text !== null) {
      try {
        oracles = resolveOracles(spec.text, {
          testOne: config.gates?.test_one,
          stack: unambiguousStackId(wt.path),
          projectRoot: wt.path,
        });
      } catch (error) {
        findings.push({
          id: "SPEC-oracles",
          severity: "blocker",
          category: "spec",
          ...(run.specPath ? { file: run.specPath } : {}),
          claim: `the spec's criteria cannot be read: ${errorText(error)}`,
          evidence: "spec-contract criteria",
          expected: "a contract whose criteria the gate can resolve",
        });
      }
      try {
        readSignals(spec.text, rubric).paths.forEach((raw, i) => {
          const path = posix.normalize(raw).replace(/^\.\//, "");
          if (isCanonicalPath(path)) contractFiles.add(path);
          else {
            findings.push({
              id: `SPEC-file-${i + 1}`,
              severity: "blocker",
              category: "spec",
              claim: `contract file ${JSON.stringify(raw)} is not a repo-relative path`,
              evidence: "spec-contract files",
              expected: "contract files named as git names them",
            });
          }
        });
      } catch {
        // An unreadable contract is reported above, by the oracles or the seal check.
      }
    }

    const projectChecks = committedText(wt, wt.baseSha, CHECKS_PATH);
    const checks = [
      ...parseChecks(
        readFileSync(join(pipelineDir, "checks.default.yaml"), "utf8"),
        "checks.default.yaml",
      ),
      // The base commit's rules, not the worktree's: a child cannot loosen the rules it is judged
      // by, and a change it makes to the file is the protected-path blocker.
      ...parseChecks(projectChecks, `${CHECKS_PATH} at ${wt.baseSha}`),
    ];
    const baseline = readJson(at("protected-baseline.json"), z.record(z.string(), z.string()));
    if (!baseline) throw new Error("no protected baseline; prepare has not run");
    const timeoutMs = config.pipeline.gate_timeout_minutes * 60_000;
    // The checks above and the re-seal keep the base the run branched from; only what the run is
    // charged with moves to a base the branch has since merged.
    const from = diffBase(run, wt, head, timeoutMs);

    // A gate whose binary is absent is not run, and is a minor finding, as `verify` makes it a
    // warning: the verifier and the PR still see it, and it does not reject the iteration. A
    // plan that proves nothing that way is a blocker, as `verify`'s delivery gate refuses it.
    const planned = stageGates(wt.path, config);
    findings.push(...evidenceFindings(planned));
    const notRun: Finding[] = planned.flatMap((g) =>
      g.missing === undefined
        ? []
        : [
            {
              id: `G-${g.name}-not-run`,
              severity: "minor",
              category: "gate",
              claim: `${g.name} was not run: \`${g.missing}\` is not on PATH`,
              evidence: `the pre-flight probe for \`${g.command}\`, as verify runs it`,
              expected: `${g.missing} installed, or another command pinned in .marvin/config.json`,
            },
          ],
    );
    const report = runGateStage({
      worktree: wt.path,
      baseSha: from,
      gitDir: wt.gitDir,
      gates: planned.flatMap(({ name, command, missing }) =>
        missing === undefined ? [{ name, command }] : [],
      ),
      oracles,
      contractFiles: [...contractFiles],
      sealed: run.sealed as SealedFile[],
      checks,
      exemptPattern: config.pipeline.scope_exempt_pattern,
      protectedPatterns: protectedPatterns(),
      protectedBaseline: rebaseline(wt, baseline as ProtectedSnapshot, wt.baseSha, from),
      run: runner,
      timeoutMs,
    });
    // Finalize builds on exactly the commit the last passing gate judged.
    const passed = report.passed && findings.length === 0;
    writeAtomic(
      at("gated-head.json"),
      `${JSON.stringify({ head, iteration: run.iteration, passed })}\n`,
    );
    return {
      run,
      obs: { kind: "gate", report, findings: [...findings, ...reportFindings(report), ...notRun] },
    };
  };

  // -------------------------------------------------------------------------------- seal

  const specIdentity = (run: Run): { slug: string; tracker: string | null } => {
    const text = specOnDisk(run);
    const fm = text === null ? {} : parseFrontmatter(text.replace(/\r\n?/g, "\n")).frontmatter;
    const fromName = run.specPath ? basename(run.specPath, ".md").replace(/^\d+-/, "") : undefined;
    const slug = [fm.slug, fromName].find((s) => s !== undefined && PLAIN_TOKEN.test(s)) ?? "spec";
    const tracker = (fm.tracker ?? fm.tracker_id ?? "").trim() || null;
    return { slug, tracker };
  };

  /** A re-seal replaces the entries it names; every other seal stays (as `decide` merges them). */
  const mergeSealed = (old: readonly SealedFile[], fresh: readonly SealedFile[]): SealedFile[] => {
    const byPath = new Map(old.map((s) => [s.path, s]));
    for (const s of fresh) byPath.set(s.path, s);
    return [...byPath.values()];
  };

  /**
   * Commits the sealed tests and nothing else, with the subject `roles/executor.md` finds the
   * seal commit by, and checks that the commit holds the bytes that were sealed. An interrupted
   * earlier call that already committed is recognised by its parent and its subject, and is
   * accepted as the seal's own only if it, too, holds nothing else. The paths are the
   * test-author's, so git reads them literally: as pathspecs, `:!x` would add everything but `x`.
   */
  const commitSealed = (
    run: Run,
    wt: WorktreeRecord,
    sealed: SealedFile[],
    headBefore: string,
  ): string => {
    const g = isolatedGit(wt.path, wt.gitDir, { HUSKY: "0", GIT_LITERAL_PATHSPECS: "1" });
    const subject = `test(${specIdentity(run).slug}): sealed acceptance tests`;
    const paths = sealed.map((s) => s.path);
    const headNow = () => g.text("rev-parse", "--verify", "HEAD^{commit}").trim();
    const refuseStrays = (commit: string) => {
      const strays = g
        .text("diff-tree", "-r", "--no-commit-id", "--name-only", "--no-renames", "-z", commit)
        .split("\0")
        .filter((p) => p !== "" && !paths.includes(p));
      if (strays.length > 0) throw new Error(`the seal commit also holds ${strays.join(", ")}`);
    };
    let head = headNow();
    if (head !== headBefore) {
      const parent = g.text("rev-parse", "--verify", `${head}^`).trim();
      const message = g.text("log", "-1", "--format=%s", head).trim();
      if (parent !== headBefore || message !== subject) {
        throw new Error(`HEAD moved from ${headBefore} to ${head} while the tests were sealed`);
      }
      refuseStrays(head);
    } else {
      g.text("add", "--", ...paths);
      const staged = g
        .text("diff", "--cached", "--name-only", "-z", "--", ...paths)
        .split("\0")
        .filter(Boolean);
      // A re-seal of files already committed as they are has nothing to add.
      if (staged.length > 0) {
        g.text("commit", "-q", "-m", subject, "--only", "--", ...paths);
        head = headNow();
        refuseStrays(head);
      }
    }
    for (const s of sealed) {
      if (sha256Bytes(g.bytes("cat-file", "blob", `${head}:${s.path}`)) !== s.sha256) {
        throw new Error(`${s.path} as committed in ${head} is not the file that was sealed`);
      }
    }
    return head;
  };

  const sealWork = (run: Run, data: Record<string, unknown> | undefined, step: StepInfo) => {
    const config = configFor(run);
    const wt = worktreeRecord(run);
    const path = at(`seal-${step.ref}.json`);
    let marker = readJson(path, SealMarker);
    if (!marker) {
      const tests = data?.tests;
      if (!Array.isArray(tests)) throw new Error("seal work without the test-author's tests");
      const headBefore = isolatedGit(wt.path, wt.gitDir)
        .text("rev-parse", "--verify", "HEAD^{commit}")
        .trim();
      const template = config.gates?.test_one;
      if (!template) {
        throw new Error(
          `sealing needs gates.test_one in .marvin/config.json as committed at ${run.base}: the red run uses it`,
        );
      }
      // D-RESEAL: a re-seal comes after an executor that may have committed, and a correct
      // revision run against a correct implementation passes, which the red check refuses. It
      // red-runs on the commit the run branched from instead, as the run recorded it.
      const verdict = sealAuthoredTests({
        worktree: wt.path,
        tests: tests as AuthoredTest[],
        testPathPattern: config.pipeline.test_path_pattern,
        testOne: template,
        run: runner,
        timeoutMs: config.pipeline.gate_timeout_minutes * 60_000,
        ...(isReseal(run) ? { base: { sha: wt.baseSha, gitDir: wt.gitDir } } : {}),
      });
      if (!verdict.ok) {
        const obs: Observation = { kind: "seal", ok: false, reasons: verdict.reasons, sealed: [] };
        return { run, obs };
      }
      marker = { phase: "sealed", headBefore, sealed: verdict.sealed };
      writeAtomic(path, `${JSON.stringify(marker)}\n`);
    }
    if (marker.phase === "sealed") {
      const commit = commitSealed(run, wt, marker.sealed, marker.headBefore);
      marker = { ...marker, phase: "committed", commit };
      writeAtomic(path, `${JSON.stringify(marker)}\n`);
    }
    writeSealManifest(runDir, mergeSealed(run.sealed as SealedFile[], marker.sealed));
    const obs: Observation = { kind: "seal", ok: true, reasons: [], sealed: marker.sealed };
    return { run, obs };
  };

  // ---------------------------------------------------------------------------------- ci

  const ghEnv = (config: Config): NodeJS.ProcessEnv => {
    const command = config.pipeline.github.token_command;
    return command
      ? { ...process.env, GH_TOKEN: execSync(command, { encoding: "utf8" }).trim() }
      : { ...process.env };
  };

  const fakeCi = (): CiState | null => {
    const value = process.env.MARVIN_PIPELINE_FAKE_CI;
    if (!value) return null;
    if (!CI_STATES.includes(value as CiState)) {
      throw new Error(`MARVIN_PIPELINE_FAKE_CI must be one of ${CI_STATES.join(", ")}: ${value}`);
    }
    return value as CiState;
  };

  /**
   * One look at CI. Every look after the first in a wait sleeps `ci_poll_seconds` first; the
   * first comes at once, because the decision that started the wait already waited for nothing.
   * A look that cannot reach GitHub reads as pending and says why, to the orchestrator once per
   * wait and to the log on every look: the wait's own deadline then turns a lasting failure into
   * a `no_ci` judgment instead of an engine that stops, and the orchestrator is not woken once
   * per `ci_poll_seconds` meanwhile.
   *
   * CI judges the commit the run expects only once GitHub's PR head is that commit: the
   * worktree's HEAD, which is the gated head while CI waits and the pushed finalize commit after
   * finalize. The first look after the finalize push comes at once by design, and a PR head
   * GitHub has not yet moved would otherwise read as the gated commit's finished green runs, and
   * mark ready a commit CI never ran on (D7). Until the heads agree an open PR reads as pending,
   * so the wait's deadline still escalates to `no_ci`.
   */
  const ciWork = async (run: Run): Promise<{ run: Run; obs: Observation }> => {
    const fake = fakeCi();
    if (fake) {
      return { run, obs: { kind: "ci", state: fake, failing: fake === "red" ? ["fake-ci"] : [] } };
    }
    const config = configFor(run);
    const poll = { stage: run.stage, ciSince: run.ciSince };
    const last = readJson(at("ci-poll.json"), CiPoll);
    if (last?.stage === poll.stage && last.ciSince === poll.ciSince) {
      await delay(config.pipeline.ci_poll_seconds * 1000, undefined, { signal: deps.signal });
    }
    writeAtomic(at("ci-poll.json"), `${JSON.stringify(poll)}\n`);
    if (!run.prUrl) throw new Error("waiting for CI with no pull request");
    const wt = worktreeRecord(run);
    const expected = isolatedGit(wt.path, wt.gitDir)
      .text("rev-parse", "--verify", "HEAD^{commit}")
      .trim();
    const pending: Observation = { kind: "ci", state: "pending", failing: [] };
    try {
      const { pr, runs } = fetchCi({
        worktree: wt.path,
        prUrl: run.prUrl,
        tokenCommand: config.pipeline.github.token_command,
      });
      if (pr.state === "OPEN" && pr.headRefOid !== expected) return { run, obs: pending };
      const since = run.ciSince === null ? Date.now() : Date.parse(run.ciSince);
      const { state, failing } = classifyCi({
        pr,
        runs,
        minutesSincePush: Math.max(0, (Date.now() - since) / 60_000),
        noCiAfterMinutes: config.pipeline.no_ci_minutes,
      });
      return { run, obs: { kind: "ci", state, failing } };
    } catch (error) {
      const text = `CI state unavailable, read as pending: ${errorText(error).split("\n")[0]}`;
      const wait = `ci-unavailable:${run.stage}:${String(run.ciSince)}`;
      if (readEventsTolerant(runDir).some((e) => e.data?.ref === wait)) note(text);
      else note(text, { notify: true, ref: wait });
      return { run, obs: pending };
    }
  };

  // ---------------------------------------------------------------------- finalize, ready

  /**
   * The run's last write, which `finalizeRun` makes. A run that ships builds on the commit the
   * last passing gate approved, recorded by the gate work; a run without a PR, and a halted one
   * with or without a PR (D16, D-HALTPR), keeps its retro in the run dir and touches no git, so
   * it needs none. A replay is safe: `finalizeRun` recognises its own commit and pushes it again.
   */
  const finalizeWork = (run: Run, data: Record<string, unknown> | undefined) => {
    const config = configFor(run);
    const wt = worktreeRecord(run);
    const gated = readJson(at("gated-head.json"), GatedHead);
    const ships = run.prUrl !== null && run.haltReason === null;
    if (ships && (!gated?.passed || !FULL_SHA.test(gated.head))) {
      throw new Error("finalize needs the commit a passing gate approved, and none is recorded");
    }
    finalizeRun({
      run,
      runDir,
      worktree: wt.path,
      gitDir: wt.gitDir,
      expectedHead: ships && gated ? gated.head : "",
      retro: data?.retro ?? null,
      events: readEventsTolerant(runDir),
      exposedLessons: readJson(at("lessons-exposed.json"), z.array(z.string())) ?? [],
      formatCommand: config.pipeline.format_command,
      runCommand: runner,
    });
    return { run, obs: { kind: "finalized" } satisfies Observation };
  };

  const markReady = (run: Run, step: StepInfo) => {
    if (fakeCi()) {
      noteOnce(step.ref, "fake CI: the pull request was not marked ready");
      return { run };
    }
    if (!run.prUrl) throw new Error("mark_ready with no pull request");
    const config = configFor(run);
    const wt = worktreeRecord(run);
    const env = ghEnv(config);
    const gh = (...args: string[]) =>
      execFileSync("gh", args, {
        cwd: wt.path,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    // A replay finds the PR already out of draft and leaves it.
    const view = z
      .object({ isDraft: z.boolean() })
      .parse(JSON.parse(gh("pr", "view", run.prUrl, "--json", "isDraft")));
    if (view.isDraft) gh("pr", "ready", run.prUrl);
    return { run };
  };

  /**
   * The run branch takes its name from the spec (`pipeline.branch_template`). A name already
   * taken, on origin or locally (a rerun of the same task), gets the run id appended rather
   * than stopping the run; a replay finds the branch already renamed and keeps it.
   */
  const renameBranch = (run: Run, step: StepInfo) => {
    const config = configFor(run);
    const wt = worktreeRecord(run);
    const { slug, tracker } = specIdentity(run);
    const target = branchName(config.pipeline.branch_template, {
      tracker: tracker ?? config.pipeline.tracker_default,
      slug,
    });
    const fallback = `${target}-${run.id}`;
    for (const name of [target, fallback]) {
      if (!isSafeBranchRef(name)) throw new Error(`the run branch name is not a safe ref: ${name}`);
    }
    const current = git(wt.path, "symbolic-ref", "--short", "HEAD");
    if (current === target || current === fallback) return { run: { ...run, branch: current } };
    if (current !== run.branch) {
      throw new Error(`the worktree is on ${current}, not the run branch ${String(run.branch)}`);
    }
    try {
      renameRunBranch(wt.path, target);
      return { run: { ...run, branch: target } };
    } catch (error) {
      if (!/already exists/.test(errorText(error))) throw error;
      renameRunBranch(wt.path, fallback);
      noteOnce(step.ref, `branch ${target} is taken; the run branch is ${fallback}`);
      return { run: { ...run, branch: fallback } };
    }
  };

  const work = async (
    run: Run,
    kind: WorkKind,
    data: Record<string, unknown> | undefined,
    step: StepInfo,
  ): Promise<{ run: Run; obs?: Observation }> => {
    switch (kind) {
      case "gate":
        return gateWork(run);
      case "seal":
        return sealWork(run, data, step);
      case "ci":
        return ciWork(run);
      case "finalize":
        return finalizeWork(run, data);
      case "mark_ready":
        return markReady(run, step);
      case "rename_branch":
        return renameBranch(run, step);
      case "snapshot": {
        if (run.worktree === null) throw new Error("snapshot with no worktree");
        writeAtomic(at("snapshot.txt"), snapshotTree(run.worktree));
        return { run };
      }
    }
  };

  const fixtures = process.env.MARVIN_PIPELINE_JUDGE === "fixtures";
  const deps: EngineDeps = {
    rubric,
    pollMs,
    judge: fixtures ? "fixtures" : "files",
    ...(fixtures && process.env.MARVIN_PIPELINE_FIXTURES
      ? { fixturesDir: process.env.MARVIN_PIPELINE_FIXTURES }
      : {}),
    ...(o.signal ? { signal: o.signal } : {}),
    prepare,
    spawnChild,
    waitChild,
    work,
  };
  return deps;
}
