// Task 20, scenario 1 of the autopilot plan: the deterministic sandbox. The committed
// `marvin-pipe` bundle drives one standard-tier run over the 3-file Node project in
// `test/fixtures/autopilot-sandbox/project/`, from `init` to `ready`, with no model, no network
// and no GitHub:
//
// - every child is a fake (`MARVIN_PIPELINE_FAKE_<ROLE>` names its result fixture), and the
//   planner, the test-author and the executor do their file work through
//   `MARVIN_PIPELINE_FAKE_<ROLE>_SCRIPT`, so the spec commit, the seal, the gate and finalize run
//   for real;
// - CI is `MARVIN_PIPELINE_FAKE_CI=green`, which also leaves the PR alone at `mark_ready`;
// - the spec approval comes from `MARVIN_PIPELINE_JUDGE=fixtures`;
// - origin is a bare repository made in a temp dir, and `claude` and `gh` on PATH are stubs
//   that fail, so a fixture that went missing could never reach a real session or GitHub.
//
// The script: the verifier FAILs iteration 1 with one major finding, then PASSes iteration 2.
//
// The same sandbox answers spike S8 (docs/proposals/autopilot-spikes.md) at the process level:
// the engine `start` launches outlives the process group of the shell that ran `start`, and an
// engine killed mid-run is reported down by `await` and resumed by the recovery path without a
// child launched twice. A fake planner held mid-turn keeps the engine resting on a running child
// for as long as each test needs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "test", "fixtures", "autopilot-sandbox");
const cli = join(root, "plugins", "marvin", "mcp", "server", "dist", "marvin-pipe.js");
const SPEC_SUBJECT = "chore(clamp): approved spec";
const SEAL_SUBJECT = "test(clamp): sealed acceptance tests";
const ROLES = { planner: "PLANNER", "test-author": "TEST_AUTHOR", executor: "EXECUTOR" };
/** The children of the scripted run, in launch order: one rejection, so two executor rounds. */
const SCRIPTED_CHILDREN = [
  "planner",
  "test-author",
  "executor",
  "verifier",
  "executor",
  "verifier",
  "retro",
];

/** The environment every process of the run sees: hermetic, whatever the caller's shell holds. */
function sandboxEnv(home, stubBin) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    // A test runner's context would turn the gates' own `node --test` into a sub-reporter, and
    // a marvin or pipeline variable from the caller's session must not steer this run.
    if (k === "NODE_TEST_CONTEXT" || k.startsWith("MARVIN_") || k.startsWith("GIT_")) continue;
    env[k] = v;
  }
  return {
    ...env,
    PATH: `${stubBin}:${process.env.PATH}`,
    // No process of the run may read the caller's own ~/.gitconfig: the identity is the one
    // below, or none, exactly as on a CI runner with an empty home.
    HOME: home,
    XDG_CONFIG_HOME: join(home, "xdg"),
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    MARVIN_PIPELINE_HOME: join(home, "state"),
    MARVIN_PIPELINE_JUDGE: "fixtures",
    MARVIN_PIPELINE_FIXTURES: join(fixture, "judgments"),
    MARVIN_PIPELINE_FAKE_CI: "green",
    MARVIN_PIPELINE_FAKE_PLANNER: join(fixture, "roles", "planner.json"),
    MARVIN_PIPELINE_FAKE_TEST_AUTHOR: join(fixture, "roles", "test-author.json"),
    MARVIN_PIPELINE_FAKE_EXECUTOR: join(fixture, "roles", "executor.json"),
    MARVIN_PIPELINE_FAKE_VERIFIER: join(fixture, "roles", "verifier.json"),
    MARVIN_PIPELINE_FAKE_RETRO: join(fixture, "roles", "retro.json"),
    ...Object.fromEntries(
      Object.entries(ROLES).map(([role, v]) => [
        `MARVIN_PIPELINE_FAKE_${v}_SCRIPT`,
        join(fixture, "scripts", `${role}.mjs`),
      ]),
    ),
  };
}

/** The fixture project committed on `dev` of a bare origin, cloned as the main checkout. */
function sandboxRepo(home, env) {
  const git = (cwd, ...args) =>
    execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  writeFileSync(env.GIT_CONFIG_GLOBAL, "[user]\n\temail = sandbox@example.com\n\tname = Sandbox\n");
  // Read only by a git that lost GIT_CONFIG_GLOBAL on the way: it then refuses to guess an
  // identity from the host, as a CI runner's git does, instead of passing on a developer's Mac.
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tuseConfigOnly = true\n");
  const origin = join(home, "origin.git");
  git(home, "init", "-q", "--bare", "-b", "dev", origin);
  const repo = join(home, "autopilot-sandbox");
  git(home, "clone", "-q", origin, repo);
  cpSync(join(fixture, "project"), repo, { recursive: true });
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "chore: sandbox project");
  git(repo, "push", "-q", "origin", "HEAD:dev");
  return { repo, origin, git };
}

const events = (runDir) =>
  readFileSync(join(runDir, "events.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const trailOf = (runDir) =>
  existsSync(join(runDir, "events.jsonl"))
    ? events(runDir)
        .map((e) => `${e.kind}: ${e.text}`)
        .join("\n")
    : "";
const readRun = (runDir) => JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));

/**
 * One `marvin-pipe` command, as the orchestrator runs it; its stdout. Bounded, so an engine that
 * regressed to holding the launcher's stdio fails the test instead of blocking it for good:
 * a synchronous call waits for the pipe, and no test timeout can interrupt it.
 */
const pipe = (env, ...args) =>
  execFileSync(process.execPath, [cli, ...args], { env, encoding: "utf8", timeout: 60_000 });

/** One `marvin-pipe` command that must fail; its stderr. */
function pipeFails(env, ...args) {
  const r = spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8", timeout: 60_000 });
  assert.notEqual(r.status, 0, `expected marvin-pipe ${args[0]} to fail; stdout: ${r.stdout}`);
  return r.stderr;
}

/** The sandbox project on a bare origin and a run `init` made for it, with no engine yet. */
function initSandboxRun() {
  assert.ok(existsSync(cli), `no bundle at ${cli}: run npm run build`);
  const home = mkdtempSync(join(tmpdir(), "autopilot-sandbox-"));
  const stubBin = join(home, "bin");
  mkdirSync(stubBin);
  for (const name of ["claude", "gh"]) {
    writeFileSync(join(stubBin, name), `#!/bin/sh\necho '${name}: sandbox stub' >&2\nexit 97\n`, {
      mode: 0o755,
    });
  }
  const env = sandboxEnv(home, stubBin);
  const { repo, origin, git } = sandboxRepo(home, env);
  const task = join(home, "task.txt");
  writeFileSync(task, "Add clamp(x, lo, hi) to src/math.mjs.\n");
  const { runId, runDir } = JSON.parse(
    pipe(
      env,
      "init",
      "--repo",
      repo,
      "--base",
      "dev",
      "--lang",
      "en",
      "--orch",
      "Sandbox",
      "--stage-a",
      "standard",
      "--task-file",
      task,
      "--task-en-file",
      task,
    ),
  );
  return { home, env, repo, origin, git, runId, runDir };
}

test("a standard sandbox run with one verifier rejection reaches ready", async (t) => {
  const { env, repo, origin, git, runDir } = initSandboxRun();
  const base = git(repo, "rev-parse", "HEAD").trim();

  // The engine in the foreground, as `start` would run it detached.
  const started = Date.now();
  let out;
  try {
    out = await promisify(execFile)(process.execPath, [cli, "engine", "--run", runDir], {
      env,
      encoding: "utf8",
      timeout: 120_000,
    });
  } catch (error) {
    assert.fail(`the engine failed: ${error.stderr ?? error.message}\n${trailOf(runDir)}`);
  }
  t.diagnostic(`engine ran ${Date.now() - started} ms`);
  const done = JSON.parse(out.stdout);
  const run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
  const log = events(runDir);
  const trail = log.map((e) => `${e.kind}: ${e.text}`).join("\n");

  // It reaches ready.
  assert.equal(done.stage, "ready", trail);
  assert.equal(run.stage, "ready", trail);
  assert.equal(run.haltReason, null);
  assert.equal(run.tier, "standard");

  // Exactly two executors and two verifiers, each under a name of its own, and every child a fake.
  const named = (role) => run.children.filter((c) => c.role === role).map((c) => c.name);
  const executors = named("executor");
  const verifiers = named("verifier");
  assert.equal(executors.length, 2, trail);
  assert.equal(verifiers.length, 2, trail);
  const names = run.children.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, `child names repeat: ${names.join(", ")}`);
  assert.deepEqual(
    run.children.map((c) => c.role),
    SCRIPTED_CHILDREN,
  );
  for (const name of names) {
    const command = JSON.parse(readFileSync(join(runDir, `${name}.command.json`), "utf8"));
    assert.ok(command.fake, `${name} was not a fake`);
  }

  // The verifier's rejection moved the second executor to rung 1: effort+1 on the same model.
  assert.equal(run.rung, 1);
  assert.deepEqual(
    run.rejections.map((r) => [r.iteration, r.source]),
    [[1, "verifier"]],
  );
  const [first, second] = run.children.filter((c) => c.role === "executor");
  assert.deepEqual(first.assignment, { model: "sonnet", effort: "high" });
  assert.deepEqual(second.assignment, { model: "sonnet", effort: "xhigh" });
  assert.ok(
    log.some((e) => e.text.includes(`executor ${second.iteration} started on rung 1`)),
    trail,
  );

  // The engine's spec commit comes first on the branch, then the sealed-test commit, both before
  // the first executor's commit.
  const branch = run.branch;
  const subjects = git(run.worktree, "log", "--reverse", "--format=%s", `${base}..HEAD`)
    .trim()
    .split("\n");
  assert.deepEqual(subjects.slice(0, 2), [SPEC_SUBJECT, SEAL_SUBJECT], subjects.join("\n"));
  assert.deepEqual(subjects.slice(2, 4), [
    "feat(clamp): add clamp",
    "fix(clamp): reject an inverted range",
  ]);
  // The spec commit sits directly on the base and holds the approved spec and the metrics record
  // the planner's seal created, which no executor committed; the run records it.
  const specCommit = git(run.worktree, "log", "--format=%H", "--grep", SPEC_SUBJECT, "-F", "HEAD")
    .trim()
    .split("\n");
  assert.equal(specCommit.length, 1);
  assert.equal(run.specCommit, specCommit[0]);
  assert.equal(git(run.worktree, "rev-parse", `${specCommit[0]}^`).trim(), base);
  assert.deepEqual(
    git(run.worktree, "diff-tree", "-r", "--no-commit-id", "--name-only", specCommit[0])
      .trim()
      .split("\n"),
    [".marvin/metrics/001-clamp.md", ".marvin/task/001-clamp.md"],
  );
  const specMarker = JSON.parse(readFileSync(join(runDir, "spec-commit.json"), "utf8"));
  assert.deepEqual([specMarker.phase, specMarker.commit], ["committed", specCommit[0]]);
  const seal = git(run.worktree, "log", "--format=%H", "--grep", SEAL_SUBJECT, "-F", "HEAD")
    .trim()
    .split("\n");
  assert.equal(seal.length, 1);
  assert.deepEqual(
    git(run.worktree, "diff-tree", "-r", "--no-commit-id", "--name-only", seal[0]).trim(),
    "test/clamp.test.mjs",
  );
  // The seal commit sits directly on the spec commit and is the parent of the first executor's
  // commit, and the engine committed it before it launched that executor.
  const feat = git(
    run.worktree,
    "log",
    "--format=%H",
    "--grep",
    "feat(clamp)",
    "-F",
    "HEAD",
  ).trim();
  assert.equal(git(run.worktree, "rev-parse", `${seal[0]}^`).trim(), specCommit[0]);
  assert.equal(git(run.worktree, "rev-parse", `${feat}^`).trim(), seal[0]);
  const sealMarkers = readdirSync(runDir).filter((f) => /^seal-.*\.json$/.test(f));
  assert.equal(sealMarkers.length, 1);
  const marker = JSON.parse(readFileSync(join(runDir, sealMarkers[0]), "utf8"));
  assert.deepEqual([marker.phase, marker.commit], ["committed", seal[0]]);
  const at = (text) => log.findIndex((e) => e.text.startsWith(text));
  assert.ok(at("test_authoring → executing") < at(`${first.name} started`), trail);
  assert.deepEqual(
    run.sealed.map((s) => s.path),
    ["test/clamp.test.mjs"],
  );
  // Both gates ran the sealed test as AC1's oracle and found its hash intact.
  assert.deepEqual(
    run.gateReport.gates.map((g) => [g.name, g.result]),
    [
      ["oracle:AC1", "pass"],
      ["test", "pass"],
    ],
  );
  assert.deepEqual(run.gateReport.sealed, [{ path: "test/clamp.test.mjs", ok: true }]);

  // Neither verifier changed the tree: the snapshot before each equals the tree after it.
  for (const name of verifiers) {
    const result = JSON.parse(readFileSync(join(runDir, `${name}.result.json`), "utf8"));
    assert.equal(result.mutated, undefined, `${name} mutated the tree: ${result.mutated}`);
    assert.equal(result.leaked, undefined, `${name} wrote outside its worktree`);
  }
  const lastSnapshot = JSON.parse(readFileSync(join(runDir, "snapshot.txt"), "utf8"));
  assert.equal(
    lastSnapshot.head,
    git(run.worktree, "log", "-1", "--format=%H", "--grep", "fix(clamp)", "-F", "HEAD").trim(),
  );

  // Finalize shipped the spec on the run branch and pushed it to the sandbox origin.
  const pushed = git(origin, "rev-parse", `refs/heads/${branch}`).trim();
  assert.equal(pushed, git(run.worktree, "rev-parse", "HEAD").trim());
  assert.match(readFileSync(join(run.worktree, ".marvin/task/001-clamp.md"), "utf8"), /shipped/);
  assert.equal(git(repo, "status", "--porcelain").trim(), "", "the main checkout changed");

  // Each executor appended a terminal block after its commit, as the delivery gate does, and no
  // gate rejected an iteration for it: the engine carried both appends into its finalize commit.
  const RECORD = ".marvin/metrics/001-clamp.md";
  assert.ok(
    log.every((e) => !e.text.includes(`uncommitted work: ${RECORD}`)),
    trail,
  );
  assert.match(git(run.worktree, "log", "-1", "--format=%s").trim(), /^chore\(clamp\): ship spec/);
  assert.ok(
    git(run.worktree, "diff-tree", "-r", "--no-commit-id", "--name-only", "HEAD")
      .trim()
      .split("\n")
      .includes(RECORD),
  );
  const shippedRecord = git(run.worktree, "show", `HEAD:${RECORD}`);
  const heads = [...shippedRecord.matchAll(/^```json task-metrics\n(.*)$/gm)].map(
    (m) => JSON.parse(m[1]).head_sha,
  );
  const workCommits = git(run.worktree, "log", "--reverse", "--format=%H", "-2", "HEAD^")
    .trim()
    .split("\n");
  assert.deepEqual(heads, workCommits, "one block per executor, each naming its own commit");
  assert.equal(git(run.worktree, "status", "--porcelain", "--", RECORD).trim(), "");
  assert.ok(
    log.some(
      (e) =>
        e.data?.notify === true &&
        e.text === `the engine committed the metrics record ${RECORD} in the finalize commit`,
    ),
    trail,
  );
});

// ------------------------------------------------------------------- S8: engine survival

/**
 * Holds the fake planner mid-turn until `release()`: its script waits for a file before it does
 * the fixture planner's work, so the engine rests on a running child for as long as a test needs.
 * `launches()` counts the script's runs, which is how a planner launched a second time would show.
 * `env` is what the engine needs to run it.
 */
function holdPlanner(home) {
  const gate = join(home, "planner.release");
  const count = join(home, "planner.launches");
  const script = join(home, "held-planner.mjs");
  const planner = join(fixture, "scripts", "planner.mjs");
  writeFileSync(
    script,
    [
      'import { execFileSync } from "node:child_process";',
      'import { appendFileSync, existsSync } from "node:fs";',
      'import { setTimeout as delay } from "node:timers/promises";',
      `appendFileSync(${JSON.stringify(count)}, "launch\\n");`,
      `while (!existsSync(${JSON.stringify(gate)})) await delay(50);`,
      `const planner = ${JSON.stringify(planner)};`,
      'execFileSync(process.execPath, [planner, ...process.argv.slice(2)], { stdio: "inherit" });',
      "",
    ].join("\n"),
  );
  return {
    env: { MARVIN_PIPELINE_FAKE_PLANNER_SCRIPT: script },
    release: () => writeFileSync(gate, ""),
    launches: () =>
      existsSync(count) ? readFileSync(count, "utf8").split("\n").filter(Boolean).length : 0,
  };
}

/** Polls every 50 ms until `condition` holds; one that never does fails the test, not hangs it. */
async function until(condition, what, ms = 60_000) {
  for (const deadline = Date.now() + ms; !condition(); await delay(50)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
  }
}

/** Whether a process exists. An engine is never this process's child, so `kill 0` is the look. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

const pgid = (pid) =>
  Number(execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim());

/** Every process below `root` in the process tree, from one `ps` listing. */
function descendants(root) {
  const children = new Map();
  for (const line of execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" })
    .trim()
    .split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const found = [];
  for (const queue = [root]; queue.length > 0;) {
    for (const pid of children.get(queue.shift()) ?? []) {
      found.push(pid);
      queue.push(pid);
    }
  }
  return found;
}

/** The engine rests on its running planner: the run records the child, no decision is in flight. */
const restingOnPlanner = (runDir) =>
  readRun(runDir).children.some((c) => c.role === "planner" && c.status === "running") &&
  !existsSync(join(runDir, "engine.journal.json"));

/**
 * Waits for engine `pid`'s last words in engine.log, the stage it finished at or why it stopped,
 * or for the engine to be gone without them, and returns the log.
 */
async function engineFinished(runDir, pid) {
  const log = join(runDir, "engine.log");
  const said = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  await until(
    () => /"stage": "(ready|done)"|marvin-pipe engine: /.test(said()) || !alive(pid),
    "the engine to finish the run",
    120_000,
  );
  return said();
}

test("S8: the engine outlives the process group of the shell that started it, and holds the run against a second start", async (t) => {
  const s = initSandboxRun();
  const planner = holdPlanner(s.home);
  const env = { ...s.env, ...planner.env };
  // The orchestrator's Bash call, as SKILL.md makes it: a shell leading a process group of its
  // own runs `start`, and here it lingers, so that the group still has members when it is killed.
  const shell = spawn(
    "/bin/sh",
    ["-c", '"$0" "$1" start --run "$2"; sleep 600', process.execPath, cli, s.runDir],
    { env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const shellExit = new Promise((resolve) =>
    shell.once("exit", (_code, signal) => resolve(signal)),
  );
  let out = "";
  let err = "";
  shell.stdout.setEncoding("utf8").on("data", (chunk) => (out += chunk));
  shell.stderr.setEncoding("utf8").on("data", (chunk) => (err += chunk));
  let engine = 0;
  let shellKilled = false;
  let finished = false;
  t.after(() => {
    planner.release();
    const leftover = [shellKilled ? 0 : -shell.pid, finished ? 0 : engine];
    for (const target of leftover.filter(Boolean)) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        // already gone
      }
    }
  });

  await until(() => out.includes("}") || /marvin-pipe start: /.test(err), "start to answer");
  assert.match(out, /"pid"/, err);
  engine = JSON.parse(out).pid;
  // `start` returns once its engine holds the run, and lets go of it: the engine leads a session
  // of its own, outside the shell's process group and, once `start` exits, outside its tree.
  assert.equal(pgid(shell.pid), shell.pid);
  assert.equal(pgid(engine), engine, "the engine shares a process group with its launcher");
  await until(() => !descendants(shell.pid).includes(engine), "start to let go of the engine");
  await until(
    () => restingOnPlanner(s.runDir) && planner.launches() === 1,
    "the engine to rest on its running planner",
  );

  // The turn ends: the tool call's whole process group is killed, and the pipes the call's output
  // was read through close. An engine still writing to them would fail at its first line.
  process.kill(-shell.pid, "SIGKILL");
  shellKilled = true;
  assert.equal(await shellExit, "SIGKILL");
  shell.stdout.destroy();
  shell.stderr.destroy();
  // Long enough for a killed engine to be reaped, so that it reads as gone.
  await delay(300);
  assert.ok(alive(engine), "the engine died with the launching process group");

  // While it lives, the lock refuses a second start and a second engine; neither touches the run.
  const files = () =>
    ["run.json", "events.jsonl"].map((f) => readFileSync(join(s.runDir, f), "utf8"));
  const before = files();
  assert.match(pipeFails(env, "start", "--run", s.runDir), /an engine already holds/);
  assert.match(
    pipeFails(env, "engine", "--run", s.runDir),
    new RegExp(`engine already running \\(pid ${engine}\\)`),
  );
  assert.deepEqual(files(), before);
  assert.ok(alive(engine));
  assert.equal(JSON.parse(pipe(env, "status", "--run", s.runDir)).engineAlive, true);

  // Released, the planner finishes, and the same engine drives the run to ready.
  planner.release();
  const log = await engineFinished(s.runDir, engine);
  finished = true;
  const run = readRun(s.runDir);
  assert.equal(run.stage, "ready", trailOf(s.runDir));
  // Its last words reached engine.log, its only output: nothing tied it to the killed shell.
  assert.match(log, /"stage": "ready"/);
  assert.deepEqual(
    run.children.map((c) => c.role),
    SCRIPTED_CHILDREN,
  );
  assert.equal(planner.launches(), 1);
  assert.equal(JSON.parse(pipe(env, "status", "--run", s.runDir)).engineAlive, false);
});

test("S8: an engine killed mid-run is reported down, and the resume path finishes the same run with no child launched twice", async (t) => {
  const s = initSandboxRun();
  const planner = holdPlanner(s.home);
  const env = { ...s.env, ...planner.env };
  const engines = [];
  let finished = false;
  t.after(() => {
    planner.release();
    for (const pid of finished ? [] : engines) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  });
  const start = () => {
    const { pid } = JSON.parse(pipe(env, "start", "--run", s.runDir));
    engines.push(pid);
    return pid;
  };
  // kill -9 of the engine's whole process group: no handler of the engine's runs, so its lock is
  // left held and no "stopped" note is written, and a child that shared its group would go too.
  const kill = async (pid) => {
    process.kill(-pid, "SIGKILL");
    await until(() => !alive(pid), `engine ${pid} to be gone`);
  };
  const awaitLines = () =>
    pipe(env, "await", "--run", s.runDir, "--deadline-min", "0.1").trim().split("\n");

  const first = start();
  await until(
    () => restingOnPlanner(s.runDir) && planner.launches() === 1,
    "the engine to rest on its running planner",
  );
  const [launched] = readRun(s.runDir).children;
  await kill(first);

  // The armed `await` reports the engine down, with no reason, since nothing could write one.
  let lines = awaitLines();
  assert.ok(lines.includes("ENGINE down"), lines.join("\n"));
  assert.ok(
    !lines.some((l) => l.startsWith("EVENT note engine stopped") || l.startsWith("STAGE")),
    lines.join("\n"),
  );
  // The planner outlived it: a child leads a process group of its own, as the engine does.
  assert.ok(alive(launched.pid), "the planner died with the engine's process group");

  // A new session resumes the run (SKILL.md section 2): `list` shows it unfinished with no engine,
  // `attach` makes the session its orchestrator, and `start` brings an engine back.
  const listed = JSON.parse(pipe(env, "list", "--repo", s.repo)).find((r) => r.id === s.runId);
  assert.deepEqual([listed.stage, listed.engineAlive], ["planning", false]);
  pipe(env, "attach", "--run", s.runDir, "--orch", "Resumed");
  const second = start();
  assert.notEqual(second, first);

  // That engine dies too, still waiting on the same planner, which then finishes while no engine
  // runs. The next `await` reports the new death at once.
  await kill(second);
  planner.release();
  await until(() => existsSync(join(s.runDir, `${launched.name}.exit`)), "the planner to finish");
  lines = awaitLines();
  assert.ok(lines.includes("ENGINE down"), lines.join("\n"));

  // A third engine picks up the finished planner and drives the run to ready.
  const log = await engineFinished(s.runDir, start());
  finished = true;
  const run = readRun(s.runDir);
  assert.equal(run.stage, "ready", trailOf(s.runDir));
  assert.match(log, /"stage": "ready"/);
  // No child was launched twice across the two deaths: the planner ran once, under one launch.
  assert.deepEqual(
    run.children.map((c) => c.role),
    SCRIPTED_CHILDREN,
  );
  assert.equal(planner.launches(), 1);
  const plannerLaunches = events(s.runDir).filter(
    (e) => e.kind === "assignment" && e.text.startsWith(`${launched.name} started`),
  );
  assert.equal(plannerLaunches.length, 1);
  assert.equal(run.children[0].pid, launched.pid);
  // The planner reports to the session that started the run, every later child to the one that
  // resumed it.
  const orchestrator = (c) =>
    JSON.parse(readFileSync(join(s.runDir, `${c.name}.command.json`), "utf8")).env
      .MARVIN_PIPELINE_ORCH;
  assert.deepEqual(run.children.map(orchestrator), [
    "Sandbox",
    ...Array(SCRIPTED_CHILDREN.length - 1).fill("Resumed"),
  ]);
  lines = awaitLines();
  assert.ok(lines.includes("STAGE ready"), lines.join("\n"));
  assert.ok(!lines.includes("ENGINE down"), lines.join("\n"));
});
