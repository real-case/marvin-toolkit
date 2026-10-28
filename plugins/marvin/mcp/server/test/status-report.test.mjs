import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";

const loop = await importTs("src/pipeline/loop.ts");
const rs = await importTs("src/pipeline/run-store.ts");
const sr = await importTs("src/pipeline/status-report.ts");

const NOW = new Date("2026-10-25T14:52:00Z");
const START = new Date("2026-10-25T14:14:00Z");

const baseRun = (patch = {}) => ({
  ...rs.initRun({
    id: "r-1025",
    repoRoot: "/repo",
    base: "dev",
    lang: "ru",
    orchestratorName: "Autopilot",
    task: "Отчёт автопилота не реже раза в 5 минут",
    taskEnglish: "report every five minutes",
    stageA: "standard",
    now: START,
  }),
  ...patch,
});
const child = (patch) => ({
  name: "r-1025-executor-1",
  role: "executor",
  iteration: 1,
  sessionId: null,
  pid: null,
  assignment: { model: "m", effort: "high" },
  startedAt: START.toISOString(),
  endedAt: null,
  status: "done",
  costUsd: null,
  cacheReadTokens: null,
  ...patch,
});
const move = (from, to) => ({
  ts: START.toISOString(),
  kind: "stage",
  actor: "engine",
  text: `${from} → ${to}`,
  data: { notify: true },
});
const note = (text, ts = NOW.toISOString()) => ({
  ts,
  kind: "note",
  actor: "engine",
  text,
  data: { notify: true },
});
const build = (run, o = {}) =>
  sr.buildReport({
    run,
    history: [],
    events: [],
    previous: null,
    n: 1,
    since: new Date(NOW.getTime() - 300_000),
    now: NOW,
    intervalMs: 300_000,
    orchestrator: "Autopilot",
    session: null,
    ...o,
  });
const states = (report) => report.rail.map((s) => `${s.key}:${s.state}`);

test("a running run marks the stages before its own done and its own current", () => {
  const r = build(baseRun({ stage: "executing", iteration: 2, rung: 1 }));
  assert.equal(r.state, "running");
  assert.equal(r.final, false);
  assert.deepEqual(states(r), [
    "planning:done",
    "test_authoring:done",
    "executing:current",
    "gating:pending",
    "verifying:pending",
    "ci_wait:pending",
    "retro:pending",
  ]);
  assert.equal(r.elapsedMs, 38 * 60_000);
  assert.equal(r.nextBy, "2026-10-25T14:57:00.000Z");
  assert.equal(r.task, "Отчёт автопилота не реже раза в 5 минут");
  assert.equal(r.lang, "ru");
});

test("a resumed session is charged once, an unknown cost is not zero, and the delta is against the previous report", () => {
  const run = baseRun({
    stage: "executing",
    children: [
      child({ name: "p", role: "planner", sessionId: "s1", costUsd: 0.5 }),
      child({ name: "p2", role: "planner", sessionId: "s1", costUsd: 0.92 }),
      child({ name: "e1", sessionId: "s2", costUsd: 1.84 }),
      child({ name: "e2", sessionId: "s3", costUsd: null, status: "running" }),
    ],
  });
  const first = build(run);
  assert.equal(first.costUsd, 2.76);
  assert.equal(first.costComplete, false);
  assert.equal(first.costDeltaUsd, null);
  const second = build(run, { previous: { ...first, costUsd: 2.38 }, n: 2 });
  assert.equal(second.costDeltaUsd, 0.38);
  assert.deepEqual(
    second.active.map((a) => a.name),
    ["e2"],
  );
});

test("a run waiting on a judgment sits on the stage that raised it", () => {
  const run = baseRun({
    stage: "awaiting_answer",
    pendingJudgment: { id: "003-executor_questions", kind: "executor_questions" },
  });
  const history = [
    move("planning", "test_authoring"),
    move("test_authoring", "executing"),
    move("executing", "awaiting_answer"),
  ];
  const r = build(run, { history });
  assert.equal(r.state, "waiting");
  assert.equal(r.rail[2].state, "waiting");
  assert.deepEqual(r.callout, { kind: "question", text: "executor_questions" });
  assert.equal(r.judgment, "executor_questions");
  // Without the stage history, the judgment's kind says where the run is.
  assert.equal(build(run).rail[2].state, "waiting");
});

test("a halted run is failed on the stage it halted from, and its retro counts once it ran", () => {
  const history = [move("executing", "gating"), move("gating", "halted"), move("halted", "retro")];
  const run = baseRun({ stage: "retro", haltReason: "rejection cap reached" });
  const r = build(run, { history });
  assert.equal(r.state, "halted");
  assert.equal(r.final, false, "the retro still runs");
  assert.equal(r.rail[3].key, "gating");
  assert.equal(r.rail[3].state, "failed");
  assert.equal(r.rail[6].state, "done");
  assert.deepEqual(r.callout, { kind: "halt", text: "rejection cap reached" });
  const closed = build({ ...run, stage: "done" }, { history });
  assert.equal(closed.final, true);
  assert.equal(closed.nextBy, null);
});

test("a ready run has every stage done and no next report", () => {
  const r = build(baseRun({ stage: "ready", prUrl: "https://github.com/o/r/pull/266" }));
  assert.equal(r.state, "ready");
  assert.ok(r.rail.every((s) => s.state === "done"));
  assert.equal(r.final, true);
  assert.equal(r.nextBy, null);
  assert.equal(r.prUrl, "https://github.com/o/r/pull/266");
});

test("a report keeps the newest eight events and counts the rest", () => {
  const events = Array.from({ length: 11 }, (_, i) => note(`event ${i}`));
  const r = build(baseRun({ stage: "executing" }), { events });
  assert.equal(r.events.length, 8);
  assert.equal(r.events[0].text, "event 3");
  assert.equal(r.omittedEvents, 3);
});

// ------------------------------------------------------------- await --report-min

const newRun = (patch = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-report-"));
  rs.saveRun(dir, baseRun(patch));
  return dir;
};
const reportOf = (line) => JSON.parse(readFileSync(line.split(" ").slice(2).join(" "), "utf8"));

test("with a report interval, events wait for the interval and arrive in one report", async () => {
  const dir = newRun({ stage: "executing" });
  const release = loop.acquireLock(dir);
  try {
    const poll = (reportMs) => loop.awaitWork(dir, { pollMs: 1, deadlineMs: 60_000, reportMs });
    // The first interval starts when await is armed: a quiet one still ends in a report.
    const quiet = await poll(20);
    assert.equal(quiet.length, 1);
    assert.match(quiet[0], /^REPORT 1 /);
    assert.equal(reportOf(quiet[0]).events.length, 0);

    rs.appendEvent(dir, note("gate passed"));
    rs.appendEvent(dir, note("verifier started"));
    const started = Date.now();
    const lines = await poll(150);
    assert.ok(Date.now() - started >= 100, "the events waited for the interval");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^REPORT 2 /);
    const report = reportOf(lines[0]);
    assert.deepEqual(
      report.events.map((e) => e.text),
      ["gate passed", "verifier started"],
    );
    assert.ok(existsSync(sr.reportPath(dir, 2)));
    // Each event is reported once.
    assert.equal(reportOf((await poll(20))[0]).events.length, 0);
  } finally {
    release();
  }
});

test("a new judgment returns at once with a report, and its repeat returns alone", async () => {
  const dir = newRun({ stage: "executing" });
  const release = loop.acquireLock(dir);
  try {
    const poll = (o) =>
      loop.awaitWork(dir, { pollMs: 1, deadlineMs: 60_000, reportMs: 60_000, ...o });
    rs.appendEvent(dir, note("executor asked"));
    const id = loop.requestJudgment(dir, "halt", { reason: "r" });
    const judgment = `JUDGMENT ${id} halt ${join(dir, "judgments", `${id}.request.json`)}`;
    const started = Date.now();
    const first = await poll();
    assert.ok(Date.now() - started < 2_000, "a new judgment does not wait for the interval");
    assert.match(first[0], /^REPORT 1 /);
    assert.equal(first[1], judgment);
    assert.deepEqual(
      reportOf(first[0]).events.map((e) => e.text),
      ["executor asked"],
    );

    // The repeat carries no card, and an event that arrived meanwhile stays for the next one.
    rs.appendEvent(dir, note("later"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(await poll({ repeatMs: 20 }), [judgment]);
    assert.equal(sr.lastReportNumber(dir), 1);
    const next = await poll({ reportMs: 20, repeatMs: 60_000 });
    assert.match(next[0], /^REPORT 2 /);
    assert.deepEqual(
      reportOf(next[0]).events.map((e) => e.text),
      ["later"],
    );
  } finally {
    release();
  }
});

test("a terminal stage writes one final report, then returns its line alone", async () => {
  const dir = newRun({ stage: "ready", prUrl: "https://github.com/o/r/pull/1" });
  const poll = () => loop.awaitWork(dir, { pollMs: 1, deadlineMs: 60_000, reportMs: 60_000 });
  const first = await poll();
  assert.match(first[0], /^REPORT 1 /);
  assert.equal(first[1], "STAGE ready");
  assert.equal(reportOf(first[0]).final, true);
  assert.deepEqual(await poll(), ["STAGE ready"]);
});

test("the session name drops the title's status prefix, and nothing left is null", () => {
  assert.equal(sr.sessionName("[in progress] Отчёт автопилота"), "Отчёт автопилота");
  assert.equal(sr.sessionName("autopilot-1"), "autopilot-1");
  assert.equal(sr.sessionName("[waiting]  "), null);
  assert.equal(build(baseRun(), { orchestrator: "[ci] Card" }).sessionName, "Card");
});

const line = (o) => JSON.stringify(o);
const turn = (tokens, o = {}) =>
  line({
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      model: "claude-opus-5-5",
      usage: { input_tokens: 2, cache_read_input_tokens: tokens, cache_creation_input_tokens: 10 },
    },
    ...o,
  });

test("the footer's session is the running child, its context from its newest top-level turn", () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-session-"));
  const run = baseRun({
    children: [
      child({ name: "r-1025-planner-0", role: "planner", status: "done" }),
      child({
        name: "r-1025-executor-1",
        status: "running",
        assignment: { model: "opus", effort: "medium" },
      }),
    ],
  });
  writeFileSync(
    join(dir, "r-1025-planner-0.log.jsonl"),
    [
      line({ type: "system", subtype: "init", model: "claude-opus-5-5" }),
      turn(1000),
      line({ type: "result", modelUsage: { "claude-opus-5-5": { contextWindow: 1_000_000 } } }),
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "r-1025-executor-1.log.jsonl"),
    [
      turn(200_000),
      // A subagent's turn fills the subagent's context, not the child's.
      turn(900_000, { parent_tool_use_id: "toolu_1" }),
      "{not json",
    ].join("\n"),
  );
  assert.deepEqual(sr.sessionOf(dir, run), {
    name: "r-1025-executor-1",
    role: "executor",
    model: "claude-opus-5-5",
    effort: "medium",
    contextTokens: 200_012,
    contextWindow: 1_000_000,
  });
});

test("with no child running, the newest child is shown; an unreadable log leaves its figures null", () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-session-"));
  assert.equal(sr.sessionOf(dir, baseRun()), null);
  const run = baseRun({
    children: [
      child({
        name: "r-1025-verifier-1",
        role: "verifier",
        assignment: { model: "sonnet", effort: "low" },
      }),
    ],
  });
  assert.deepEqual(sr.sessionOf(dir, run), {
    name: "r-1025-verifier-1",
    role: "verifier",
    model: "sonnet",
    effort: "low",
    contextTokens: null,
    contextWindow: null,
  });
});

test("await writes the session name from orchestrator.txt and the session from the logs", async () => {
  const dir = newRun({
    stage: "executing",
    children: [child({ name: "r-1025-executor-1", status: "running" })],
  });
  writeFileSync(join(dir, "orchestrator.txt"), "[in progress] Карточка\n");
  writeFileSync(join(dir, "r-1025-executor-1.log.jsonl"), turn(5000));
  const release = loop.acquireLock(dir);
  try {
    const lines = await loop.awaitWork(dir, { pollMs: 1, deadlineMs: 60_000, reportMs: 1 });
    const report = reportOf(lines[0]);
    assert.equal(report.sessionName, "Карточка");
    assert.equal(report.session.contextTokens, 5012);
    assert.equal(report.session.model, "claude-opus-5-5");
  } finally {
    release();
  }
});

test("a report written before the session fields existed still reads, with both null", () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-report-"));
  const { sessionName: _n, session: _s, ...old } = build(baseRun());
  sr.writeReport(dir, { ...old, n: 1 });
  const back = sr.readReport(dir, 1);
  assert.equal(back.sessionName, null);
  assert.equal(back.session, null);
});

const at = (min) => new Date(START.getTime() + min * 60_000).toISOString();
const moveAt = (from, to, min) => ({ ...move(from, to), ts: at(min) });

test("a final report sums the run up: stage times, active time, roles, questions, assumptions", () => {
  const run = baseRun({
    stage: "ready",
    prUrl: "https://github.com/o/r/pull/266",
    assumptions: ["the interval comes from\n--report-min", "  "],
    children: [
      child({ name: "p", role: "planner", startedAt: at(0), endedAt: at(5) }),
      child({ name: "e1", role: "executor", startedAt: at(10), endedAt: at(20) }),
      child({ name: "v", role: "verifier", startedAt: at(15), endedAt: at(25) }),
    ],
  });
  const history = [
    moveAt("intake", "planning", 1),
    moveAt("planning", "awaiting_answer", 4),
    moveAt("awaiting_answer", "planning", 6),
    moveAt("planning", "executing", 8),
    moveAt("executing", "gating", 20),
    moveAt("gating", "verifying", 22),
    moveAt("verifying", "ci_wait", 30),
    moveAt("ci_wait", "retro", 34),
    moveAt("retro", "finalizing", 36),
    moveAt("finalizing", "ready", 37),
    { ...note("answered"), kind: "answer", data: { answeredBy: "orchestrator" } },
    { ...note("answered"), kind: "answer", data: { answeredBy: "user" } },
    { ...note("answered"), kind: "answer", data: { answeredBy: "orchestrator" } },
  ];
  const facts = {
    tokens: null,
    pr: null,
    criteria: [{ id: "AC1", text: "x", proof: "green" }],
    retro: { checks: 1, lessons: 0 },
  };
  const r = build(run, { history, facts, now: new Date(at(37)) });
  const s = r.summary;
  assert.deepEqual(
    s.stages.map((x) => [x.key, x.ms === null ? null : x.ms / 60_000]),
    [
      // Intake counts toward planning; the wait for an answer counts toward nothing.
      ["planning", 1 + 3 + 2],
      ["test_authoring", null],
      ["executing", 12],
      ["gating", 2],
      ["verifying", 8],
      ["ci_wait", 4],
      ["retro", 3],
    ],
  );
  assert.equal(s.activeMs, 20 * 60_000, "0–5 and 10–25, overlaps counted once");
  assert.equal(s.roles, 3);
  assert.deepEqual(s.questions, { byOrchestrator: 2, byUser: 1 });
  assert.deepEqual(s.assumptions, ["the interval comes from --report-min"]);
  assert.deepEqual(s.criteria, facts.criteria);
  assert.deepEqual(s.retro, facts.retro);
  assert.equal(build(baseRun({ stage: "executing" }), { facts }).summary, null);
  assert.equal(build(baseRun({ stage: "ready" })).summary.tokens, null, "no facts, no tokens");
});

const result = (modelUsage) => line({ type: "result", modelUsage });

test("final facts: tokens by kind and role from the whole logs, a resumed session once", () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-final-"));
  const run = baseRun({
    stage: "ready",
    children: [
      child({ name: "r-1025-planner-0", role: "planner", sessionId: "s-p" }),
      child({ name: "r-1025-executor-1", sessionId: "s-e" }),
      child({ name: "r-1025-executor-1", sessionId: "s-e" }),
      child({ name: "r-1025-executor-2", sessionId: "s-e2" }),
      child({ name: "r-1025-retro-0", role: "retro", sessionId: "s-r" }),
    ],
  });
  const usage = (n) => ({
    inputTokens: n,
    outputTokens: 2 * n,
    cacheReadInputTokens: 10 * n,
    cacheCreationInputTokens: 3 * n,
    contextWindow: 200_000,
  });
  writeFileSync(
    join(dir, "r-1025-planner-0.log.jsonl"),
    [turn(40_000), turn(20_000), result({ "claude-opus-5-5": usage(100) })].join("\n"),
  );
  // The first row of a resumed session is superseded by its last, whose result is cumulative.
  writeFileSync(
    join(dir, "r-1025-executor-1.log.jsonl"),
    [turn(170_000), result({ "claude-opus-5-5": usage(999) })].join("\n"),
  );
  const keys = run.children.map((_, i) =>
    rs.childKey(run.children.slice(0, i), run.children[i].name),
  );
  writeFileSync(
    join(dir, `${keys[2]}.log.jsonl`),
    [turn(30_000), result({ "claude-opus-5-5": usage(200), "claude-haiku-5-5": usage(10) })].join(
      "\n",
    ),
  );
  writeFileSync(join(dir, `${keys[3]}.log.jsonl`), [turn(50_000)].join("\n"));
  writeFileSync(join(dir, "retro-applied.json"), '{"checks":1,"lessons":2}\n');
  const facts = sr.finalFacts(dir, run, () => {
    throw new Error("gh is not installed");
  });
  const t = facts.tokens;
  assert.equal(t.input, 100 + 210);
  assert.equal(t.output, 2 * 310);
  assert.equal(t.cacheRead, 10 * 310);
  assert.equal(t.cacheWrite, 3 * 310);
  assert.equal(t.total, 16 * 310);
  assert.deepEqual(
    t.byRole.map((r) => [r.role, r.sessions, r.model, r.total, r.peakContext, r.contextWindow]),
    [
      ["planner", 1, "claude-opus-5-5", 1600, 40_012, 200_000],
      ["executor", 2, "claude-opus-5-5", 3360, 170_012, 200_000],
      ["retro", 1, "m", null, null, null],
    ],
  );
  assert.deepEqual(facts.retro, { checks: 1, lessons: 2 });
  assert.equal(facts.pr, null, "no PR");
  assert.equal(facts.criteria, null, "no spec");
});

test("final facts: the PR from gh, and its figures null when gh cannot say", () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-final-"));
  const run = baseRun({ stage: "ready", prUrl: "https://github.com/o/r/pull/266" });
  const calls = [];
  const facts = sr.finalFacts(dir, run, (args, cwd) => {
    calls.push([args.slice(0, 3), cwd]);
    return JSON.stringify({
      changedFiles: 9,
      additions: 412,
      deletions: 38,
      baseRefName: "dev",
      statusCheckRollup: [
        { conclusion: "SUCCESS" },
        { conclusion: "SKIPPED" },
        { state: "SUCCESS" },
        { conclusion: "FAILURE" },
      ],
    });
  });
  assert.deepEqual(calls, [[["pr", "view", run.prUrl], "/repo"]]);
  assert.deepEqual(facts.pr, {
    number: 266,
    files: 9,
    additions: 412,
    deletions: 38,
    checksPassed: 3,
    checksTotal: 4,
    base: "dev",
  });
  assert.equal(facts.retro, null, "no record of the retro");
  const blind = sr.finalFacts(dir, run, () => "not json");
  assert.deepEqual(blind.pr, {
    number: 266,
    files: null,
    additions: null,
    deletions: null,
    checksPassed: null,
    checksTotal: null,
    base: "dev",
  });
});

test("final facts: criteria from the shipped spec, proven by the seal or the oracle journal", async () => {
  const wt = mkdtempSync(join(tmpdir(), "pipe-final-wt-"));
  const spec = await importTs("src/storage/spec.ts");
  const oracles = await importTs("src/storage/oracles.ts");
  const block = [
    "files:",
    "  - { id: F1, path: a.ts, action: edit }",
    "criteria:",
    "  - id: AC1",
    "    statement: the report is written every five minutes",
    "    implemented_by: [F1]",
    "    oracle: { kind: test, ref: test/a.test.mjs }",
    "  - id: AC2",
    "    statement: a question ends the wait",
    "    implemented_by: [F1]",
    "    oracle: { kind: test, ref: test/a.test.mjs }",
    "  - id: AC3",
    "    statement: the card unfolds",
    "    implemented_by: [F1]",
    "    oracle: { kind: test, ref: test/a.test.mjs }",
  ].join("\n");
  const sha = spec.contractHash(block);
  mkdirSync(join(wt, ".marvin", "task"), { recursive: true });
  writeFileSync(
    join(wt, ".marvin", "task", "007-report.md"),
    `---\nslug: report\ncontract_sha: ${sha}\n---\n\n# Report\n\n\`\`\`yaml spec-contract\n${block}\n\`\`\`\n`,
  );
  const entry = (criterion, expect, status) => ({
    slug: "report",
    contract_sha: sha,
    criterion,
    expect,
    status,
    command: "node --test",
    source: null,
    code: status === "pass" ? 0 : 1,
    signal: null,
    test_file: "test/a.test.mjs",
    test_sha: "abc",
    head_sha: null,
    ran_at: NOW.toISOString(),
  });
  const runs = join(wt, ".marvin", "task", "runs");
  oracles.recordOracleRun(runs, entry("AC2", "fail", "fail"));
  oracles.recordOracleRun(runs, entry("AC2", "pass", "pass"));
  oracles.recordOracleRun(runs, entry("AC3", "pass", "pass"));
  const run = baseRun({
    stage: "ready",
    worktree: wt,
    specPath: ".marvin/task/007-report.md",
    sealed: [{ path: "test/a.test.mjs", sha256: "x", criteria: ["AC1"] }],
  });
  const facts = sr.finalFacts(mkdtempSync(join(tmpdir(), "pipe-final-")), run, () => "{}");
  assert.deepEqual(facts.criteria, [
    { id: "AC1", text: "the report is written every five minutes", proof: "red_green" },
    { id: "AC2", text: "a question ends the wait", proof: "red_green" },
    { id: "AC3", text: "the card unfolds", proof: "green" },
  ]);
});
