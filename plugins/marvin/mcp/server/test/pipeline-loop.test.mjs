import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { importTs } from "./_tsload.mjs";

const loop = await importTs("src/pipeline/loop.ts");
const rs = await importTs("src/pipeline/run-store.ts");
const { decide } = await importTs("src/pipeline/engine.ts");
const { loadRubric } = await importTs("src/pipeline/assess.ts");
const rubric = loadRubric(
  readFileSync(
    fileURLToPath(new URL("../../../pipeline/rubric.default.yaml", import.meta.url)),
    "utf8",
  ),
  null,
);
const NOW = new Date("2026-10-04T10:00:00Z");
const PR = "https://github.com/tesari-ai/osint/pull/42";
const TSLOAD = pathToFileURL(fileURLToPath(new URL("./_tsload.mjs", import.meta.url))).href;

const baseRun = (patch = {}) => ({
  ...rs.initRun({
    id: "r1",
    repoRoot: "/repo",
    base: "dev",
    lang: "ru",
    orchestratorName: "Autopilot",
    task: "т",
    taskEnglish: "t",
    stageA: "standard",
    now: NOW,
  }),
  ...patch,
});
const newRun = (patch = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-run-"));
  rs.saveRun(dir, baseRun(patch));
  return dir;
};
const note = (text, notify = true) => ({
  ts: "t",
  kind: "note",
  actor: "engine",
  text,
  ...(notify ? { data: { notify: true } } : {}),
});
const requests = (dir) =>
  readdirSync(join(dir, "judgments"))
    .filter((f) => f.endsWith(".request.json"))
    .map((f) => f.replace(".request.json", ""))
    .sort();
const fixturesWith = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-fx-"));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(body));
  }
  return dir;
};
/** A pid that belonged to a process which has already exited. */
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

/** The source of an ES module that loads `loop` and then runs `body`. */
const withLoop = (body) =>
  `import { importTs } from ${JSON.stringify(TSLOAD)};\n` +
  `const loop = await importTs("src/pipeline/loop.ts");\n${body}`;

/** An engine that took the lock and died without releasing it, as a crash or kill -9 leaves it. */
function dieHoldingLock(dir) {
  const died = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      withLoop("loop.acquireLock(process.argv[1]); process.exit(0);"),
      dir,
    ],
    { encoding: "utf8" },
  );
  assert.equal(died.status, 0, died.stderr);
}

/** Polls with 1 ms pauses; a condition that never holds fails the test instead of hanging it. */
async function until(condition, what) {
  for (let i = 0; i < 20_000; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// ---------------------------------------------------------------- scripted runtime

const OUTPUT = {
  planner: {
    outcome: "spec_ready",
    structured: { status: "spec_ready", summary: "s", spec: { path: "specs/1-x.md" } },
  },
  "test-author": {
    outcome: "done",
    structured: {
      status: "done",
      summary: "s",
      tests: [{ path: "a.test.ts", criteria: ["AC1"] }],
    },
  },
  executor: {
    outcome: "done",
    structured: { status: "done", summary: "s", claims: ["src/a.ts adds x"], pr_url: PR },
  },
  verifier: {
    outcome: "done",
    structured: {
      status: "done",
      verdict: "PASS",
      summary: "s",
      criteria: [{ id: "AC1", result: "met", evidence: "t" }],
      findings: [],
    },
  },
  retro: {
    outcome: "done",
    structured: { status: "done", summary: "s", checks: [], proposals: [], lessons: [], prune: [] },
  },
};
const SIGNALS = {
  risk: "medium",
  bugfix: false,
  files: 6,
  newFiles: 1,
  criteria: 3,
  paths: ["src/a.ts"],
  sensitive: [],
  crossRepo: [],
  riskNote: null,
};
const REPORT = {
  passed: true,
  gates: [],
  undeclared: [],
  protected: [],
  protectedSources: {},
  protectedPatterns: [],
  checks: [],
  sealed: [],
  blockers: [],
};
const WORK_OBSERVATION = {
  gate: { kind: "gate", report: REPORT, findings: [] },
  seal: {
    kind: "seal",
    ok: true,
    reasons: [],
    sealed: [{ path: "a.test.ts", sha256: "h", criteria: ["AC1"] }],
  },
  ci: { kind: "ci", state: "green", failing: [] },
  finalize: { kind: "finalized" },
};

/**
 * Children and work that finish at once with the outputs above. `crash` makes the preparation
 * (`prepare: true`) or the named spawn, wait or work throw, which is what an engine killed at that
 * point leaves behind; `stillRunning` makes the first N waits for a role come back past their
 * deadline with the child still running; `afterWait` is told each role whose result a wait returns.
 */
function scripted({
  judge = "fixtures",
  fixturesDir,
  signal,
  crash = {},
  stillRunning = {},
  afterWait = () => {},
} = {}) {
  const log = { prepared: 0, spawns: [], stages: [], waits: [], works: [], steps: [] };
  const pending = { ...stillRunning };
  const deps = {
    rubric,
    pollMs: 1,
    judge,
    fixturesDir,
    signal,
    prepare: async (run) => {
      log.prepared += 1;
      if (crash.prepare) throw new Error("engine killed preparing the run");
      return { ...run, worktree: "/wt", branch: "autopilot/r1" };
    },
    spawnChild: (run, action, step) => {
      log.steps.push(step);
      if (crash.spawn === action.role) throw new Error(`engine killed spawning ${action.role}`);
      log.spawns.push(action.role);
      log.stages.push(run.stage);
      const child = {
        name: `r1-${action.role}-${action.iteration}-${log.spawns.length}`,
        role: action.role,
        iteration: action.iteration,
        sessionId: null,
        pid: null,
        assignment: action.assignment,
        startedAt: "t",
        endedAt: null,
        status: "running",
        costUsd: null,
        cacheReadTokens: null,
      };
      return { ...run, children: [...run.children, child] };
    },
    waitChild: async (run) => {
      const child = run.children.find((c) => c.status === "running");
      log.waits.push(child.role);
      if (crash.wait === child.role) {
        throw new Error(`engine killed while waiting for ${child.role}`);
      }
      const meta = { sessionId: "s", costUsd: 0.1, durationMs: 1, cacheReadTokens: 0 };
      if ((pending[child.role] ?? 0) > 0) {
        pending[child.role] -= 1;
        const result = { ...meta, outcome: "running", structured: null, detail: "" };
        return { run, obs: { kind: "child", role: child.role, result } };
      }
      const out = OUTPUT[child.role];
      const obs = {
        kind: "child",
        role: child.role,
        result: { ...meta, outcome: out.outcome, structured: out.structured, detail: "" },
      };
      if (child.role === "planner") obs.signals = SIGNALS;
      const children = run.children.map((c) =>
        c.name === child.name ? { ...c, status: out.outcome, endedAt: "t" } : c,
      );
      afterWait(child.role);
      return { run: { ...run, children }, obs };
    },
    work: async (run, work, _data, step) => {
      log.works.push(work);
      log.steps.push(step);
      if (crash.work === work) throw new Error(`engine killed during ${work}`);
      return { run, obs: WORK_OBSERVATION[work] };
    },
  };
  return { deps, log };
}

// ---------------------------------------------------------------- lock

test("one engine at a time: a live holder refuses a second engine, whoever asks", () => {
  const dir = newRun();
  assert.equal(loop.engineAlive(dir), false);
  const release = loop.acquireLock(dir);
  assert.equal(loop.engineAlive(dir), true);
  assert.throws(() => loop.acquireLock(dir), /engine already running \(pid \d+\)/);
  assert.throws(() => loop.acquireLock(dir, 999_999), /engine already running/);
  release();
  release();
  assert.equal(loop.engineAlive(dir), false);
  const again = loop.acquireLock(dir);
  assert.equal(loop.engineAlive(dir), true);
  again();
});

test("a lock left by an engine that died is taken over", () => {
  const dir = newRun();
  dieHoldingLock(dir);
  assert.equal(loop.engineAlive(dir), false);
  const release = loop.acquireLock(dir);
  assert.equal(loop.engineAlive(dir), true);
  assert.throws(() => loop.acquireLock(dir), /engine already running/);
  release();
});

test("a holder the OS refuses to signal is alive, not stale", () => {
  const dir = newRun();
  const release = loop.acquireLock(dir, 1);
  assert.equal(loop.engineAlive(dir), true);
  assert.throws(() => loop.acquireLock(dir), /engine already running \(pid 1\)/);
  release();
});

test("releasing a lock that was taken over leaves the new holder's lock in place", () => {
  const dir = newRun();
  const releaseGone = loop.acquireLock(dir, deadPid());
  assert.equal(loop.engineAlive(dir), false);
  const release = loop.acquireLock(dir);
  releaseGone();
  assert.equal(loop.engineAlive(dir), true);
  assert.throws(() => loop.acquireLock(dir), /engine already running/);
  release();
  assert.equal(loop.engineAlive(dir), false);
});

/**
 * Runs `during` once, inside the next liveness probe of `pid`. `acquireLock` probes the holder
 * after it has read the lock and before it acts on what it read, so `during` is another starter
 * that gets in between: the interleaving a race produces only sometimes, produced every time.
 */
function between(pid, during) {
  const kill = process.kill;
  let fired = false;
  process.kill = function (target, signal) {
    if (!fired && target === pid && signal === 0) {
      fired = true;
      during();
    }
    return kill.call(process, target, signal);
  };
  return () => {
    process.kill = kill;
  };
}

test("taking over a dead engine's lock is a compare-and-swap: a starter beaten to it withdraws", () => {
  const dir = newRun();
  const gone = deadPid();
  loop.acquireLock(dir, gone);
  let winner = null;
  const restore = between(gone, () => {
    winner = loop.acquireLock(dir);
  });
  try {
    // Removing the dead lock and creating it afresh would delete the winner's new lock here and
    // let this starter run beside it.
    assert.throws(() => loop.acquireLock(dir), /engine already running/);
  } finally {
    restore();
  }
  assert.equal(typeof winner, "function");
  assert.equal(loop.engineAlive(dir), true);
  winner();
  assert.equal(loop.engineAlive(dir), false);
});

test("a starter that recreates a lower generation from a stale look withdraws", () => {
  const dir = newRun();
  const first = deadPid();
  const second = deadPid();
  loop.acquireLock(dir, first);
  let holder = null;
  const restore = between(first, () => {
    // Two takeovers land while the starter below still looks at generation 1: one whose engine
    // died too, then a live one. Generation 2, the one the starter will create, is gone again.
    loop.acquireLock(dir, second);
    holder = loop.acquireLock(dir);
  });
  try {
    assert.throws(() => loop.acquireLock(dir), /engine already running/);
  } finally {
    restore();
  }
  assert.deepEqual(readdirSync(join(dir, "engine.lock")), ["000003.json"]);
  assert.equal(loop.engineAlive(dir), true);
  holder();
});

test("starters racing over a dead engine's lock: exactly one takes it", async () => {
  const dir = newRun();
  dieHoldingLock(dir);
  const racer = withLoop(`
process.stdout.write("ready\\n");
process.stdin.once("data", () => {
  let verdict;
  try {
    loop.acquireLock(process.argv[1]);
    verdict = "won";
  } catch (error) {
    verdict = "lost " + error.message;
  }
  process.stdout.write(verdict + "\\n");
  if (verdict !== "won") process.exit(0);
  process.stdin.on("end", () => process.exit(0));
});`);
  const racers = Array.from({ length: 8 }, () => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", racer, dir], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    child.stdin.on("error", () => {});
    const lines = [];
    let buffered = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffered += chunk;
      for (let i = buffered.indexOf("\n"); i >= 0; i = buffered.indexOf("\n")) {
        lines.push(buffered.slice(0, i));
        buffered = buffered.slice(i + 1);
      }
    });
    const exited = new Promise((resolve) => child.on("exit", resolve));
    return { child, lines, exited };
  });
  await until(() => racers.every((r) => r.lines.includes("ready")), "every racer to load");
  for (const r of racers) r.child.stdin.write("go\n");
  await until(() => racers.every((r) => r.lines.length >= 2), "every racer's verdict");
  const verdicts = racers.map((r) => r.lines[1]);
  for (const r of racers) r.child.stdin.end();
  await Promise.all(racers.map((r) => r.exited));
  assert.equal(verdicts.filter((v) => v === "won").length, 1, verdicts.join("\n"));
  for (const v of verdicts.filter((v) => v !== "won")) {
    assert.match(v, /^lost engine already running/);
  }
});

// ---------------------------------------------------------------- judgments

test("judgments validate their answers and cannot be answered twice", () => {
  const dir = newRun();
  const id = loop.requestJudgment(dir, "spec_approval", { tier: "light" });
  assert.equal(loop.pendingJudgment(dir).id, id);
  assert.throws(() => loop.answerJudgment(dir, id, { kind: "answers", text: "x", count: 1 }));
  loop.answerJudgment(dir, id, { kind: "approve" });
  assert.equal(loop.pendingJudgment(dir), null);
  assert.deepEqual(loop.readAnswer(dir, id), { kind: "approve" });
  assert.throws(() => loop.answerJudgment(dir, id, { kind: "approve" }), /already answered/);
});

test("judgment ids are sequential, re-issuing an id is a no-op, and ids are checked", () => {
  const dir = newRun();
  const first = loop.requestJudgment(dir, "planner_questions", { questions: [] });
  const second = loop.requestJudgment(dir, "halt", { reason: "r" });
  assert.deepEqual([first, second], ["001-planner_questions", "002-halt"]);
  const asked = readFileSync(join(dir, "judgments", `${second}.request.json`), "utf8");
  assert.equal(loop.requestJudgment(dir, "halt", { reason: "other" }, second), second);
  assert.equal(readFileSync(join(dir, "judgments", `${second}.request.json`), "utf8"), asked);
  assert.deepEqual(requests(dir), [first, second]);
  assert.throws(() => loop.requestJudgment(dir, "no_ci", {}, "003-halt"), /003-halt/);
  assert.equal(loop.pendingJudgment(dir).id, first);
  assert.throws(() => loop.answerJudgment(dir, "../../x", { kind: "retry" }), /not a judgment id/);
  assert.throws(() => loop.readAnswer(dir, "001-../x"), /not a judgment id/);
  assert.throws(
    () => loop.answerJudgment(dir, "009-halt", { kind: "retry" }),
    /no judgment 009-halt/,
  );
  // The next number follows the highest one, not the count: after a gap, counting would land on
  // a number already taken and hand back that judgment instead of a new one.
  loop.requestJudgment(dir, "halt", { reason: "r" }, "004-halt");
  assert.equal(loop.requestJudgment(dir, "halt", { reason: "r" }), "005-halt");
});

const go = (run, obs) => decide(run, obs, rubric, NOW);
const at = (stage, patch = {}) =>
  baseRun({ stage, branch: "b", specPath: "specs/1-x.md", tier: "standard", ...patch });
/** A light run whose executor crashed twice: a halt that can be retried or cancelled. */
const executorHalt = () => {
  const approved = go(at("awaiting_approval", { tier: "light" }), {
    kind: "answer",
    judgment: "spec_approval",
    answer: { kind: "approve" },
  }).run;
  const crashed = {
    kind: "child",
    role: "executor",
    result: {
      outcome: "crashed",
      sessionId: null,
      costUsd: null,
      durationMs: null,
      cacheReadTokens: null,
      structured: null,
      detail: "exit 1",
    },
  };
  return go(go(approved, crashed).run, crashed).run;
};
/** For each judgment kind, a run in the state that raises it. */
const WAITING = {
  planner_questions: () => at("awaiting_answer", { awaitingRole: "planner" }),
  executor_questions: () => at("awaiting_answer", { awaitingRole: "executor", iteration: 1 }),
  spec_approval: () => at("awaiting_approval"),
  halt: executorHalt,
  no_ci: () => at("ci_wait", { iteration: 1, ciSince: NOW.toISOString() }),
  unverified: () => at("verifying", { iteration: 1 }),
};
const SAMPLES = [
  { kind: "answers", text: "Q1: A", count: 1 },
  { kind: "approve" },
  { kind: "approve", tier: "heavy", reason: "touches billing" },
  { kind: "changes", text: "split AC2" },
  { kind: "revise_tests", text: "AC1 expects a 404" },
  { kind: "retry" },
  { kind: "wait" },
  { kind: "proceed" },
  { kind: "proceed", reason: "checked by hand" },
  { kind: "cancel", reason: "stop" },
];

test("each judgment kind accepts exactly the answers decide handles for it", () => {
  assert.deepEqual([...loop.JUDGMENT_KINDS].sort(), Object.keys(WAITING).sort());
  for (const kind of loop.JUDGMENT_KINDS) {
    for (const sample of SAMPLES) {
      const accepted = loop.AnswerSchemas[kind].safeParse(sample).success;
      let handled = true;
      try {
        go(WAITING[kind](), { kind: "answer", judgment: kind, answer: sample });
      } catch {
        handled = false;
      }
      assert.equal(accepted, handled, `${kind} answered with ${JSON.stringify(sample)}`);
    }
  }
  const proceed = (kind, reason) =>
    loop.AnswerSchemas[kind].safeParse({ kind: "proceed", reason }).success;
  assert.equal(proceed("unverified", "   "), false);
  assert.equal(proceed("no_ci", undefined), true);
});

test("answers are trimmed, closed to unknown keys, and count only the questions asked", () => {
  const ask = (kind, payload) => {
    const dir = newRun();
    return { dir, id: loop.requestJudgment(dir, kind, payload) };
  };
  const approval = ask("spec_approval", {});
  for (const bad of [
    { kind: "changes", text: "  " },
    { kind: "approve", teir: "light" },
    { kind: "approve", tier: "extreme" },
    { kind: "cancel" },
  ]) {
    assert.throws(() => loop.answerJudgment(approval.dir, approval.id, bad), /invalid answer/);
  }
  assert.equal(loop.readAnswer(approval.dir, approval.id), null);
  const q = { id: "Q1", text: "t", recommendation: "r", why_blocking: "w" };
  const planner = ask("planner_questions", { questions: [q, { ...q, id: "Q2" }] });
  for (const count of [0, 3]) {
    assert.throws(
      () => loop.answerJudgment(planner.dir, planner.id, { kind: "answers", text: "A", count }),
      /asked 2/,
    );
  }
  const stored = loop.answerJudgment(planner.dir, planner.id, {
    kind: "answers",
    text: "  Q1: A\nQ2: B  ",
    count: 2,
  });
  assert.deepEqual(stored, { kind: "answers", text: "Q1: A\nQ2: B", count: 2 });
  assert.deepEqual(loop.readAnswer(planner.dir, planner.id), stored);
  const dispute = ask("executor_questions", {
    questions: [],
    dispute: { path: "a.test.ts", reason: "r", evidence: "e" },
  });
  assert.throws(
    () => loop.answerJudgment(dispute.dir, dispute.id, { kind: "answers", text: "x", count: 1 }),
    /asked 0/,
  );
  loop.answerJudgment(dispute.dir, dispute.id, {
    kind: "answers",
    text: "the test stands",
    count: 0,
  });
});

test("with the rubric, an answer the run cannot take in its current state is refused unwritten", () => {
  const dir = newRun({ stage: "executing", tier: "standard", iteration: 1 });
  const id = loop.requestJudgment(dir, "halt", { reason: "r" });
  assert.throws(
    () => loop.answerJudgment(dir, id, { kind: "retry" }, { rubric }),
    /nothing to retry/,
  );
  assert.equal(loop.readAnswer(dir, id), null);
  loop.answerJudgment(dir, id, { kind: "cancel", reason: "stop" }, { rubric });
  assert.deepEqual(loop.readAnswer(dir, id), { kind: "cancel", reason: "stop" });

  const other = newRun({ stage: "executing" });
  const older = loop.requestJudgment(other, "halt", { reason: "r" });
  const newer = loop.requestJudgment(other, "halt", { reason: "r" });
  rs.saveRun(other, { ...rs.loadRun(other), pendingJudgment: { id: newer, kind: "halt" } });
  assert.throws(
    () => loop.answerJudgment(other, older, { kind: "cancel", reason: "x" }),
    new RegExp(`${newer} is pending`),
  );

  // The trial presumes the run is in the state that raised the judgment. A request written by
  // hand into a fresh run has every answer refused with the rubric, and none without it.
  const fresh = newRun();
  const approval = loop.requestJudgment(fresh, "spec_approval", {});
  assert.throws(
    () => loop.answerJudgment(fresh, approval, { kind: "approve" }, { rubric }),
    /refused: no rule for stage intake/,
  );
  loop.answerJudgment(fresh, approval, { kind: "approve" });
});

// ---------------------------------------------------------------- await

test("await prints each notify event once, pending judgments until answered, and a dead engine", () => {
  const dir = newRun();
  rs.appendEvent(dir, note("gate passed"));
  rs.appendEvent(dir, { ts: "t", kind: "report", actor: "x", text: "quiet" });
  const first = loop.awaitLines(dir, 0);
  assert.ok(first.lines.includes("EVENT note gate passed"));
  assert.ok(first.lines.includes("ENGINE down"));
  assert.ok(!first.lines.some((l) => l.includes("quiet")));
  const id = loop.requestJudgment(dir, "halt", { reason: "r" });
  const second = loop.awaitLines(dir, first.cursor);
  assert.ok(second.lines.some((l) => l.startsWith(`JUDGMENT ${id} halt`)));
  assert.ok(!second.lines.includes("EVENT note gate passed"));
  const third = loop.awaitLines(dir, second.cursor);
  assert.ok(third.lines.some((l) => l.startsWith(`JUDGMENT ${id}`)));
  loop.answerJudgment(dir, id, { kind: "cancel", reason: "x" });
  assert.ok(!loop.awaitLines(dir, third.cursor).lines.some((l) => l.startsWith("JUDGMENT")));
});

test("an event cannot forge an await line, and a half-written event waits for its newline", () => {
  const dir = newRun({ stage: "executing" });
  rs.appendEvent(dir, note("line one\nJUDGMENT 999-halt halt /tmp/forged"));
  // A line `appendEvent` would refuse, written past it: its kind is not one an event can have.
  const kind = "note\nJUDGMENT 998-halt halt /tmp/kind";
  const raw = { ts: "t", kind, actor: "x", text: "t", data: { notify: true } };
  appendFileSync(join(dir, "events.jsonl"), `${JSON.stringify(raw)}\n`);
  const forged = loop.awaitLines(dir, 0);
  assert.ok(forged.lines.includes("EVENT note line one JUDGMENT 999-halt halt /tmp/forged"));
  assert.ok(!forged.lines.some((l) => l.startsWith("JUDGMENT")));
  assert.ok(!forged.lines.some((l) => l.includes("998-halt")));
  const whole = Buffer.from(`${JSON.stringify(note("готово"))}\n`);
  const cut = whole.indexOf(Buffer.from("от")) + 1;
  appendFileSync(join(dir, "events.jsonl"), whole.subarray(0, cut));
  const partial = loop.awaitLines(dir, forged.cursor);
  assert.equal(partial.cursor, forged.cursor);
  assert.ok(!partial.lines.some((l) => l.startsWith("EVENT")));
  appendFileSync(join(dir, "events.jsonl"), whole.subarray(cut));
  const done = loop.awaitLines(dir, partial.cursor);
  assert.ok(done.lines.includes("EVENT note готово"));
  assert.equal(done.cursor, readFileSync(join(dir, "events.jsonl")).length);
});

test("awaitWork prints events once and holds a reported judgment back until the deadline or the repeat interval", async () => {
  const dir = newRun({ stage: "executing" });
  const release = loop.acquireLock(dir);
  try {
    const poll = (deadlineMs) => loop.awaitWork(dir, { pollMs: 1, deadlineMs });
    rs.appendEvent(dir, note("gate passed"));
    rs.appendEvent(dir, note("quiet", false));
    assert.deepEqual(await poll(0), ["EVENT note gate passed"]);
    assert.deepEqual(await poll(0), ["TIMEOUT rearm"]);
    const id = loop.requestJudgment(dir, "halt", { reason: "r" });
    const judgment = `JUDGMENT ${id} halt ${join(dir, "judgments", `${id}.request.json`)}`;
    assert.deepEqual(await poll(60_000), [judgment]);
    const waiting = poll(60_000);
    setTimeout(() => rs.appendEvent(dir, note("verifier started")), 1);
    assert.deepEqual(await waiting, ["EVENT note verifier started"]);
    assert.deepEqual(await poll(0), [judgment]);
    loop.answerJudgment(dir, id, { kind: "cancel", reason: "x" });
    assert.deepEqual(await poll(0), ["TIMEOUT rearm"]);
  } finally {
    release();
  }
});

test("awaitWork returns a terminal stage every time, holds a reported engine death back, and reports a new one at once", async () => {
  const ready = newRun({ stage: "ready" });
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await loop.awaitWork(ready, { pollMs: 1, deadlineMs: 60_000 }), [
      "STAGE ready",
    ]);
  }
  const dir = newRun({ stage: "executing" });
  const poll = () => loop.awaitWork(dir, { pollMs: 1, deadlineMs: 60_000 });
  assert.deepEqual(await poll(), ["ENGINE down"]);
  const waiting = poll();
  setTimeout(() => rs.appendEvent(dir, note("still here")), 1);
  assert.deepEqual(await waiting, ["EVENT note still here"]);
  dieHoldingLock(dir);
  assert.deepEqual(await poll(), ["ENGINE down"]);
});

/** A call to `awaitWork` with its result and how long it took to come back. */
async function timed(dir, o) {
  const started = Date.now();
  const lines = await loop.awaitWork(dir, { pollMs: 1, ...o });
  return { lines, ms: Date.now() - started };
}

test("a standing judgment reported to an earlier session is reported again after the repeat interval", async () => {
  const dir = newRun({ stage: "executing" });
  const release = loop.acquireLock(dir);
  try {
    const id = loop.requestJudgment(dir, "halt", { reason: "r" });
    const judgment = `JUDGMENT ${id} halt ${join(dir, "judgments", `${id}.request.json`)}`;
    assert.deepEqual((await timed(dir, { deadlineMs: 60_000 })).lines, [judgment]);
    // That session ended without answering; the one that resumes the run arms its own await.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const resumed = await timed(dir, { deadlineMs: 5_000, repeatMs: 20 });
    assert.deepEqual(resumed.lines, [judgment]);
    assert.ok(resumed.ms < 2_500, `reported after ${resumed.ms} ms, not at once`);
  } finally {
    release();
  }
});

test("an engine that fails to start is reported down again, not left silent until the deadline", async () => {
  const dir = newRun({ stage: "executing" });
  assert.deepEqual((await timed(dir, { deadlineMs: 60_000 })).lines, ["ENGINE down"]);
  // The orchestrator starts the engine again, and the start fails before it takes the lock, so
  // the lock looks exactly as it did when the engine was first reported down.
  const { deps } = scripted({ judge: "fixtures" });
  await assert.rejects(loop.runEngine(dir, deps), /fixtures directory/);
  const again = await timed(dir, { deadlineMs: 5_000, repeatMs: 20 });
  assert.deepEqual(again.lines, ["ENGINE down"]);
  assert.ok(again.ms < 2_500, `reported after ${again.ms} ms, not at once`);
});

test("an answer the engine refuses reopens its judgment, and await announces it again at once", async () => {
  const dir = newRun({
    stage: "executing",
    worktree: "/wt",
    branch: "b",
    tier: "standard",
    iteration: 1,
    specPath: "specs/1-x.md",
  });
  const id = loop.requestJudgment(dir, "halt", { reason: "r" });
  rs.saveRun(dir, { ...rs.loadRun(dir), pendingJudgment: { id, kind: "halt" } });
  const stop = new AbortController();
  const { deps } = scripted({ judge: "files", signal: stop.signal });
  const running = loop.runEngine(dir, deps);
  try {
    const judgment = `JUDGMENT ${id} halt ${join(dir, "judgments", `${id}.request.json`)}`;
    assert.deepEqual((await timed(dir, { deadlineMs: 60_000 })).lines, [judgment]);
    loop.answerJudgment(dir, id, { kind: "retry" });
    const refused = join(dir, "judgments", `${id}.refused-1.json`);
    await until(() => existsSync(refused) && loop.pendingJudgment(dir) !== null, "the refusal");
    const reopened = await timed(dir, { deadlineMs: 5_000 });
    assert.deepEqual(reopened.lines, [
      `EVENT note answer to ${id} refused: nothing to retry in stage executing`,
      judgment,
    ]);
  } finally {
    stop.abort();
    await assert.rejects(running, { name: "AbortError" });
  }
});

// ---------------------------------------------------------------- engine

test("the engine drives a standard run from intake to ready with scripted children and fixtures", async () => {
  const dir = newRun();
  const fixtures = fixturesWith({ "spec_approval.json": { kind: "approve" } });
  const { deps, log } = scripted({ fixturesDir: fixtures });
  const final = await loop.runEngine(dir, deps);
  assert.equal(final.stage, "ready");
  assert.deepEqual(log.stages, ["planning", "test_authoring", "executing", "verifying", "retro"]);
  assert.deepEqual(log.works, [
    "rename_branch",
    "seal",
    "gate",
    "snapshot",
    "ci",
    "finalize",
    "ci",
    "mark_ready",
  ]);
  assert.ok(log.steps.every((s) => typeof s.ref === "string" && s.replay === false));
  assert.equal(rs.loadRun(dir).stage, "ready");
  assert.equal(loop.engineAlive(dir), false);
  assert.deepEqual(requests(dir), ["001-spec_approval"]);
  // Every stage change is a milestone the orchestrator is shown, in the order it happened.
  const stages = rs.readEvents(dir).filter((e) => e.kind === "stage");
  assert.deepEqual(
    stages.map((e) => e.text),
    [
      "intake → planning",
      "planning → awaiting_approval",
      "awaiting_approval → test_authoring",
      "test_authoring → executing",
      "executing → gating",
      "gating → verifying",
      "verifying → ci_wait",
      "ci_wait → retro",
      "retro → finalizing",
      "finalizing → ready",
    ],
  );
  assert.ok(stages.every((e) => e.data?.notify === true));
  assert.deepEqual(loop.awaitLines(dir, 0).lines.slice(-3), [
    "EVENT stage finalizing → ready",
    "EVENT note PR ready to merge",
    "STAGE ready",
  ]);
});

test("a fixture named after the judgment id answers before the one named after its kind", async () => {
  const dir = newRun();
  const fixtures = fixturesWith({
    "001-spec_approval.json": { kind: "changes", text: "split AC2" },
    "spec_approval.json": { kind: "approve" },
  });
  const { deps, log } = scripted({ fixturesDir: fixtures });
  assert.equal((await loop.runEngine(dir, deps)).stage, "ready");
  assert.deepEqual(log.spawns, [
    "planner",
    "planner",
    "test-author",
    "executor",
    "verifier",
    "retro",
  ]);
  assert.deepEqual(requests(dir), ["001-spec_approval", "002-spec_approval"]);
  assert.equal(loop.readAnswer(dir, "001-spec_approval").kind, "changes");
  assert.equal(loop.readAnswer(dir, "002-spec_approval").kind, "approve");
});

test("a second engine is refused while one runs, and touches nothing", async () => {
  const dir = newRun();
  const stop = new AbortController();
  const first = scripted({ judge: "files", signal: stop.signal });
  const running = loop.runEngine(dir, first.deps);
  await until(() => rs.loadRun(dir).pendingJudgment !== null, "the approval judgment");
  const before = readFileSync(join(dir, "run.json"), "utf8");
  const second = scripted({ judge: "files" });
  await assert.rejects(loop.runEngine(dir, second.deps), /engine already running/);
  assert.deepEqual([second.log.prepared, second.log.spawns.length], [0, 0]);
  assert.equal(readFileSync(join(dir, "run.json"), "utf8"), before);
  assert.equal(loop.engineAlive(dir), true);
  stop.abort();
  await assert.rejects(running, { name: "AbortError" });
  assert.equal(loop.engineAlive(dir), false);
});

/** Starts an engine that waits on files and stops it once it rests on the approval judgment. */
async function stoppedAtApproval(dir) {
  const stop = new AbortController();
  const first = scripted({ judge: "files", signal: stop.signal });
  const running = loop.runEngine(dir, first.deps);
  await until(() => rs.loadRun(dir).pendingJudgment !== null, "the approval judgment");
  stop.abort();
  await assert.rejects(running, { name: "AbortError" });
  return first.log;
}

test("restart on an unanswered judgment waits on that judgment instead of asking again", async () => {
  const dir = newRun();
  const firstLog = await stoppedAtApproval(dir);
  assert.deepEqual(firstLog.spawns, ["planner"]);
  const resting = rs.loadRun(dir);
  assert.deepEqual(
    [resting.stage, resting.pendingJudgment],
    ["awaiting_approval", { id: "001-spec_approval", kind: "spec_approval" }],
  );
  assert.equal(existsSync(join(dir, "engine.journal.json")), false, "run.json alone is the state");
  const second = scripted({ judge: "files" });
  const resumed = loop.runEngine(dir, second.deps);
  loop.answerJudgment(dir, "001-spec_approval", { kind: "approve" }, { rubric });
  assert.equal((await resumed).stage, "ready");
  assert.deepEqual(second.log.spawns, ["test-author", "executor", "verifier", "retro"]);
  assert.equal(second.log.prepared, 0);
  assert.deepEqual(requests(dir), ["001-spec_approval"]);
});

test("restart on a judgment answered while the engine was down takes over the dead engine's lock", async () => {
  const dir = newRun();
  await stoppedAtApproval(dir);
  loop.answerJudgment(dir, "001-spec_approval", { kind: "approve" }, { rubric });
  dieHoldingLock(dir);
  assert.equal(loop.engineAlive(dir), false);
  assert.ok(loop.awaitLines(dir, 0).lines.includes("ENGINE down"));
  const second = scripted({ judge: "files" });
  assert.equal((await loop.runEngine(dir, second.deps)).stage, "ready");
  assert.deepEqual(second.log.spawns, ["test-author", "executor", "verifier", "retro"]);
  assert.deepEqual(requests(dir), ["001-spec_approval"]);
});

test("restart during interrupted work repeats that work and nothing before it", async () => {
  const dir = newRun();
  const fixturesDir = fixturesWith({ "spec_approval.json": { kind: "approve" } });
  const first = scripted({ fixturesDir, crash: { work: "gate" } });
  await assert.rejects(loop.runEngine(dir, first.deps), /engine killed during gate/);
  const run = rs.loadRun(dir);
  assert.deepEqual([run.stage, run.pendingWork], ["gating", { work: "gate" }]);
  const { lines } = loop.awaitLines(dir, 0);
  assert.ok(lines.includes("EVENT note engine stopped: engine killed during gate"));
  assert.ok(lines.includes("ENGINE down"));
  const second = scripted({ fixturesDir });
  assert.equal((await loop.runEngine(dir, second.deps)).stage, "ready");
  assert.equal(second.log.works[0], "gate");
  assert.deepEqual(second.log.steps[0], { ref: first.log.steps.at(-1).ref, replay: true });
  assert.ok(second.log.steps.slice(1).every((s) => s.replay === false));
  assert.deepEqual(second.log.spawns, ["verifier", "retro"]);
  const executors = [...first.log.spawns, ...second.log.spawns].filter((r) => r === "executor");
  assert.deepEqual(executors, ["executor"]);
});

test("restart during work keeps the rest of that decision: the spawn after a snapshot still happens", async () => {
  const dir = newRun();
  const fixturesDir = fixturesWith({ "spec_approval.json": { kind: "approve" } });
  const first = scripted({ fixturesDir, crash: { work: "snapshot" } });
  await assert.rejects(loop.runEngine(dir, first.deps), /engine killed during snapshot/);
  assert.equal(rs.loadRun(dir).stage, "verifying");
  assert.ok(!first.log.spawns.includes("verifier"));
  const second = scripted({ fixturesDir });
  assert.equal((await loop.runEngine(dir, second.deps)).stage, "ready");
  assert.deepEqual(second.log.works.slice(0, 1), ["snapshot"]);
  assert.deepEqual(second.log.spawns, ["verifier", "retro"]);
});

test("an engine that dies marking the PR ready is reported down, not ready, and a restart finishes it", async () => {
  const dir = newRun();
  const fixturesDir = fixturesWith({ "spec_approval.json": { kind: "approve" } });
  const first = scripted({ fixturesDir, crash: { work: "mark_ready" } });
  await assert.rejects(loop.runEngine(dir, first.deps), /engine killed during mark_ready/);
  // run.json already names the stage the decision leads to; the PR is still a draft.
  assert.equal(rs.loadRun(dir).stage, "ready");
  const down = loop.awaitLines(dir, 0).lines;
  assert.ok(down.includes("ENGINE down"), down.join("\n"));
  assert.ok(!down.includes("STAGE ready"), down.join("\n"));
  const woken = await loop.awaitWork(dir, { pollMs: 1, deadlineMs: 60_000 });
  assert.ok(woken.includes("ENGINE down") && !woken.includes("STAGE ready"), woken.join("\n"));
  const second = scripted({ fixturesDir });
  assert.equal((await loop.runEngine(dir, second.deps)).stage, "ready");
  assert.deepEqual(second.log.works, ["mark_ready"]);
  assert.deepEqual(second.log.steps[0], { ref: first.log.steps.at(-1).ref, replay: true });
  const after = loop.awaitLines(dir, 0).lines;
  assert.equal(after.at(-1), "STAGE ready");
  assert.ok(!after.includes("ENGINE down"));
});

test("while the engine is still marking the PR ready, await does not report the run ready", async () => {
  const dir = newRun();
  const fixturesDir = fixturesWith({ "spec_approval.json": { kind: "approve" } });
  const { deps } = scripted({ fixturesDir });
  let letGo;
  const held = new Promise((resolve) => {
    letGo = resolve;
  });
  const work = deps.work;
  deps.work = async (run, kind, data, step) => {
    if (kind === "mark_ready") await held;
    return work(run, kind, data, step);
  };
  const running = loop.runEngine(dir, deps);
  await until(() => rs.loadRun(dir).stage === "ready", "the ready stage");
  const during = loop.awaitLines(dir, 0).lines;
  assert.ok(!during.includes("STAGE ready"), during.join("\n"));
  assert.ok(!during.includes("ENGINE down"), during.join("\n"));
  letGo();
  assert.equal((await running).stage, "ready");
  assert.equal(loop.awaitLines(dir, 0).lines.at(-1), "STAGE ready");
});

/**
 * Runs an engine that is stopped from inside the work `when` picks, and returns once it is down.
 * That work completes and the engine stops before its next step, which is the state a kill between
 * two steps leaves: no work under way, and the rest of the decision unstarted in the journal.
 */
async function stoppedInsideWork(dir, fixturesDir, when) {
  const stop = new AbortController();
  const { deps, log } = scripted({ fixturesDir, signal: stop.signal });
  const work = deps.work;
  deps.work = async (run, kind, data, step) => {
    if (when(kind, run)) stop.abort();
    return work(run, kind, data, step);
  };
  await assert.rejects(loop.runEngine(dir, deps), { name: "AbortError" });
  return log;
}
/** The journal's position and its steps, each named by its event text or its work. */
function journalAt(dir) {
  const j = JSON.parse(readFileSync(join(dir, "engine.journal.json"), "utf8"));
  const name = (s) => (s.kind === "event" ? s.event.text : (s.action.work ?? s.action.kind));
  return { next: j.next, steps: j.steps.map(name) };
}

test("an engine that dies between deciding ready and marking the PR ready is down, and a restart marks it once", async () => {
  const dir = newRun();
  const fixturesDir = fixturesWith({ "spec_approval.json": { kind: "approve" } });
  // The CI wait after finalize is the one whose green result decides `ready`.
  const atReady = (kind, run) => kind === "ci" && run.stage === "finalizing";
  const first = await stoppedInsideWork(dir, fixturesDir, atReady);
  assert.ok(!first.works.includes("mark_ready"));
  // run.json names `ready` and no work: only the journal says the PR is still a draft.
  const run = rs.loadRun(dir);
  assert.deepEqual([run.stage, run.pendingWork], ["ready", null]);
  assert.deepEqual(journalAt(dir), {
    next: 0,
    steps: ["finalizing → ready", "mark_ready", "PR ready to merge"],
  });
  const down = loop.awaitLines(dir, 0).lines;
  assert.ok(down.includes("ENGINE down") && !down.includes("STAGE ready"), down.join("\n"));
  const woken = await loop.awaitWork(dir, { pollMs: 1, deadlineMs: 60_000 });
  assert.ok(woken.includes("ENGINE down") && !woken.includes("STAGE ready"), woken.join("\n"));
  const second = scripted({ fixturesDir });
  assert.equal((await loop.runEngine(dir, second.deps)).stage, "ready");
  assert.deepEqual(second.log.works, ["mark_ready"]);
  const after = loop.awaitLines(dir, 0).lines;
  assert.equal(after.at(-1), "STAGE ready");
  assert.ok(!after.includes("ENGINE down"));
  assert.equal(after.filter((l) => l === "EVENT stage finalizing → ready").length, 1);
});

test("an engine that dies between marking the PR ready and announcing it is down until a restart announces it once", async () => {
  const dir = newRun();
  const fixturesDir = fixturesWith({ "spec_approval.json": { kind: "approve" } });
  await stoppedInsideWork(dir, fixturesDir, (kind) => kind === "mark_ready");
  const run = rs.loadRun(dir);
  assert.deepEqual([run.stage, run.pendingWork], ["ready", null]);
  assert.equal(journalAt(dir).next, 2);
  const down = loop.awaitLines(dir, 0).lines;
  assert.ok(down.includes("ENGINE down") && !down.includes("STAGE ready"), down.join("\n"));
  assert.ok(!down.includes("EVENT note PR ready to merge"), down.join("\n"));
  const second = scripted({ fixturesDir });
  assert.equal((await loop.runEngine(dir, second.deps)).stage, "ready");
  assert.deepEqual(second.log.works, []);
  const after = loop.awaitLines(dir, 0).lines;
  assert.deepEqual(after.slice(-2), ["EVENT note PR ready to merge", "STAGE ready"]);
  assert.equal(after.filter((l) => l === "EVENT note PR ready to merge").length, 1);
});

/**
 * Runs an engine until it has written out its decision on the planner's result, and stops it
 * before the first step of that decision. The journal it leaves is the whole decision, unstarted.
 */
async function plannedAfterPlanner(dir) {
  const stop = new AbortController();
  const afterWait = (role) => role === "planner" && stop.abort();
  const { deps } = scripted({ judge: "files", signal: stop.signal, afterWait });
  await assert.rejects(loop.runEngine(dir, deps), { name: "AbortError" });
  return JSON.parse(readFileSync(join(dir, "engine.journal.json"), "utf8"));
}
const approving = () => fixturesWith({ "spec_approval.json": { kind: "approve" } });
const asEmitted = (step) => ({ ...step.event, data: { ...step.event.data, ref: step.ref } });

test("a restart inside an event step the dead engine had already written writes it once", async () => {
  const dir = newRun();
  const journal = await plannedAfterPlanner(dir);
  const [stage] = journal.steps;
  assert.deepEqual([stage.kind, stage.event.text], ["event", "planning → awaiting_approval"]);
  // The engine appended the event and died before recording that it had.
  rs.appendEvent(dir, asEmitted(stage));
  const second = scripted({ fixturesDir: approving() });
  assert.equal((await loop.runEngine(dir, second.deps)).stage, "ready");
  const events = rs.readEvents(dir);
  assert.equal(events.filter((e) => e.data?.ref === stage.ref).length, 1);
  assert.equal(events.filter((e) => e.text === "planning → awaiting_approval").length, 1);
});

test("a restart inside a judgment step issues that judgment once, unchanged, with one event", async () => {
  const dir = newRun();
  const journal = await plannedAfterPlanner(dir);
  const at = journal.steps.findIndex((s) => s.kind === "action" && s.action.kind === "judgment");
  const step = journal.steps[at];
  // The engine carried out every step before this one, wrote the request and its event, and died
  // before recording any of it.
  for (const done of journal.steps.slice(0, at)) rs.appendEvent(dir, asEmitted(done));
  const id = loop.requestJudgment(dir, "spec_approval", step.action.payload);
  assert.equal(id, "001-spec_approval");
  const question = { ts: "t", kind: "question", actor: "engine", text: `judgment ${id}` };
  rs.appendEvent(dir, { ...question, data: { notify: true, id, ref: step.ref } });
  const request = readFileSync(join(dir, "judgments", `${id}.request.json`), "utf8");
  writeFileSync(join(dir, "engine.journal.json"), JSON.stringify({ ...journal, next: at }));
  const second = scripted({ fixturesDir: approving() });
  assert.equal((await loop.runEngine(dir, second.deps)).stage, "ready");
  assert.deepEqual(requests(dir), [id]);
  assert.equal(readFileSync(join(dir, "judgments", `${id}.request.json`), "utf8"), request);
  assert.equal(rs.readEvents(dir).filter((e) => e.kind === "question").length, 1);
});

test("a run left with interrupted work and no journal repeats that work, and is not ready before it", async () => {
  const dir = newRun();
  const fixturesDir = approving();
  const first = scripted({ fixturesDir, crash: { work: "gate" } });
  await assert.rejects(loop.runEngine(dir, first.deps), /engine killed during gate/);
  // What an engine that kept no journal leaves behind: the work named in run.json alone.
  rmSync(join(dir, "engine.journal.json"));
  assert.deepEqual(rs.loadRun(dir).pendingWork, { work: "gate" });
  const second = scripted({ fixturesDir });
  assert.equal((await loop.runEngine(dir, second.deps)).stage, "ready");
  assert.equal(second.log.works[0], "gate");
  assert.equal(second.log.steps[0].replay, true);
  assert.deepEqual(second.log.spawns, ["verifier", "retro"]);

  const late = newRun();
  const dying = scripted({ fixturesDir, crash: { work: "mark_ready" } });
  await assert.rejects(loop.runEngine(late, dying.deps), /engine killed during mark_ready/);
  rmSync(join(late, "engine.journal.json"));
  const down = loop.awaitLines(late, 0).lines;
  assert.ok(down.includes("ENGINE down") && !down.includes("STAGE ready"), down.join("\n"));
  const finishing = scripted({ fixturesDir });
  assert.equal((await loop.runEngine(late, finishing.deps)).stage, "ready");
  assert.deepEqual(finishing.log.works, ["mark_ready"]);
  assert.equal(loop.awaitLines(late, 0).lines.at(-1), "STAGE ready");
});

test("a run is prepared again only when no engine recorded its preparation", async () => {
  const fixturesDir = approving();
  const prepared = newRun({ worktree: "/wt", branch: "autopilot/r1" });
  const keeps = scripted({ fixturesDir });
  assert.equal((await loop.runEngine(prepared, keeps.deps)).stage, "ready");
  assert.equal(keeps.log.prepared, 0);

  const dir = newRun();
  const first = scripted({ fixturesDir, crash: { prepare: true } });
  await assert.rejects(loop.runEngine(dir, first.deps), /killed preparing/);
  assert.deepEqual([rs.loadRun(dir).stage, rs.loadRun(dir).worktree], ["intake", null]);
  const second = scripted({ fixturesDir });
  assert.equal((await loop.runEngine(dir, second.deps)).stage, "ready");
  assert.equal(second.log.prepared, 1);
});

test("an engine started on a run that does not exist leaves nothing behind", async () => {
  const missing = join(mkdtempSync(join(tmpdir(), "pipe-none-")), "no-such-run");
  const { deps } = scripted({ judge: "files" });
  await assert.rejects(loop.runEngine(missing, deps), /no run/);
  assert.equal(existsSync(missing), false);
});

test("restart while a child runs waits on that child instead of spawning it again", async () => {
  const dir = newRun();
  const fixturesDir = fixturesWith({ "spec_approval.json": { kind: "approve" } });
  const first = scripted({ fixturesDir, crash: { wait: "executor" } });
  await assert.rejects(loop.runEngine(dir, first.deps), /killed while waiting for executor/);
  const run = rs.loadRun(dir);
  assert.equal(run.stage, "executing");
  assert.deepEqual(
    run.children.filter((c) => c.status === "running").map((c) => c.role),
    ["executor"],
  );
  assert.equal(existsSync(join(dir, "engine.journal.json")), false, "run.json alone is the state");
  const second = scripted({ fixturesDir });
  assert.equal((await loop.runEngine(dir, second.deps)).stage, "ready");
  assert.equal(second.log.waits[0], "executor");
  assert.deepEqual(second.log.spawns, ["verifier", "retro"]);
});

test("restart after an interrupted spawn performs that spawn again, flagged as a replay", async () => {
  const dir = newRun();
  const fixturesDir = fixturesWith({ "spec_approval.json": { kind: "approve" } });
  const first = scripted({ fixturesDir, crash: { spawn: "verifier" } });
  await assert.rejects(loop.runEngine(dir, first.deps), /engine killed spawning verifier/);
  const second = scripted({ fixturesDir });
  assert.equal((await loop.runEngine(dir, second.deps)).stage, "ready");
  assert.deepEqual(second.log.spawns, ["verifier", "retro"]);
  assert.deepEqual(second.log.steps[0], { ref: first.log.steps.at(-1).ref, replay: true });
});

test("a child wait that outlasts its deadline is waited on again, not decided", async () => {
  const dir = newRun();
  const fixturesDir = fixturesWith({ "spec_approval.json": { kind: "approve" } });
  const { deps, log } = scripted({ fixturesDir, stillRunning: { executor: 2 } });
  assert.equal((await loop.runEngine(dir, deps)).stage, "ready");
  assert.deepEqual(
    log.waits.filter((r) => r === "executor"),
    ["executor", "executor", "executor"],
  );
  assert.deepEqual(log.spawns, ["planner", "test-author", "executor", "verifier", "retro"]);
});

test("an answer decide refuses is set aside, reported, and the judgment is open again", async () => {
  const dir = newRun({
    stage: "executing",
    worktree: "/wt",
    branch: "b",
    tier: "standard",
    iteration: 1,
    specPath: "specs/1-x.md",
  });
  const id = loop.requestJudgment(dir, "halt", { reason: "r" });
  rs.saveRun(dir, { ...rs.loadRun(dir), pendingJudgment: { id, kind: "halt" } });
  loop.answerJudgment(dir, id, { kind: "retry" });
  const { deps } = scripted({ judge: "files" });
  const running = loop.runEngine(dir, deps);
  await until(() => loop.pendingJudgment(dir) !== null, "the refused answer to be set aside");
  const { lines } = loop.awaitLines(dir, 0);
  assert.ok(
    lines.includes(`EVENT note answer to ${id} refused: nothing to retry in stage executing`),
  );
  assert.ok(lines.some((l) => l.startsWith(`JUDGMENT ${id} halt`)));
  loop.answerJudgment(dir, id, { kind: "cancel", reason: "stop" }, { rubric });
  const final = await running;
  assert.deepEqual([final.stage, final.haltReason], ["done", "stop"]);
  assert.deepEqual(requests(dir), [id]);
  assert.deepEqual(loop.readAnswer(dir, id), { kind: "cancel", reason: "stop" });
});

test("the fixtures judge needs a fixtures directory", async () => {
  const dir = newRun();
  const { deps } = scripted({ judge: "fixtures" });
  await assert.rejects(loop.runEngine(dir, deps), /fixtures directory/);
  assert.equal(loop.engineAlive(dir), false);
});
