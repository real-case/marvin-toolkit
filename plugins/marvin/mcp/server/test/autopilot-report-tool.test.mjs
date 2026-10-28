import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callTool, withSession } from "./_driver.mjs";
import { importTs } from "./_tsload.mjs";

/**
 * The `autopilot-report` tool (ADR-0051): one status report, written by `marvin-pipe await
 * --report-min`, read back as a card. The handler cases drive the compiled `src/`; the stdio case
 * drives the committed `dist/server.js`, where the widget binding and strict input live.
 */

const { buildAutopilotReportTool, renderReport } = await importTs("src/tools/autopilot-report.ts");
const rs = await importTs("src/pipeline/run-store.ts");
const sr = await importTs("src/pipeline/status-report.ts");

const NOW = new Date("2026-10-25T14:52:00Z");
const textOf = (r) => r.content.map((c) => c.text).join("\n");

const withHome = (fn) => async () => {
  const home = mkdtempSync(join(tmpdir(), "autopilot-report-"));
  try {
    await fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};

/** A run under `root` with one report: executing, two events, a pending question. */
function seed(root, patch = {}) {
  const runDir = join(root, "repo", "r-1025");
  mkdirSync(runDir, { recursive: true });
  const run = {
    ...rs.initRun({
      id: "r-1025",
      repoRoot: "/repo",
      base: "dev",
      lang: "ru",
      orchestratorName: "Autopilot",
      task: "Отчёт автопилота",
      taskEnglish: "Autopilot report",
      stageA: "standard",
      now: new Date("2026-10-25T14:14:00Z"),
    }),
    stage: "executing",
    iteration: 2,
    rung: 1,
    pendingJudgment: { id: "004-executor_questions", kind: "executor_questions" },
    ...patch,
  };
  rs.saveRun(runDir, run);
  const note = (text) => ({ ts: NOW.toISOString(), kind: "note", actor: "engine", text });
  const report = sr.buildReport({
    run,
    history: [],
    events: [note("executor 2 closed AC-3"), note("gate passed")],
    previous: null,
    n: 1,
    since: new Date(NOW.getTime() - 300_000),
    now: NOW,
    intervalMs: 300_000,
    orchestrator: "[waiting] Отчёт автопилота",
    session: {
      name: "r-1025-executor-2",
      role: "executor",
      model: "claude-opus-5-5",
      effort: "medium",
      contextTokens: 84_000,
      contextWindow: 200_000,
    },
  });
  sr.writeReport(runDir, report);
  return { runDir, report };
}

const call = (input, env) => buildAutopilotReportTool(env).handler(input, {});

test(
  "the report is read back with the orchestrator's translation in place of the engine's English",
  withHome(async (home) => {
    const env = { MARVIN_PIPELINE_HOME: home };
    const { runDir } = seed(home);
    const r = await call(
      {
        runDir,
        n: 1,
        translations: {
          events: ["Исполнитель №2 закрыл AC-3", "Проверки пройдены"],
          callout: "Исполнитель спрашивает, где хранить отчёты.",
        },
      },
      env,
    );
    assert.notEqual(r.isError, true, textOf(r));
    const { report } = r.structuredContent;
    assert.deepEqual(
      report.events.map((e) => e.text),
      ["Исполнитель №2 закрыл AC-3", "Проверки пройдены"],
    );
    assert.equal(report.callout.text, "Исполнитель спрашивает, где хранить отчёты.");
    const text = textOf(r);
    assert.match(text, /^## #1 · Ждёт ответа · r-1025\n\*\*Отчёт автопилота\*\*\n/);
    assert.match(text, /\n\nOpus 5\.5 medium effort · Контекст 42% · 84k \/ 200k$/);
    assert.deepEqual(r.structuredContent.earlier, []);
    // The card names the session, never the task (the whole prompt the run started from).
    assert.doesNotMatch(text, /\[waiting\]/);
    assert.match(text, /✓ План → ✓ Тесты → \*\*◐ Исполнение\*\* → ○ Проверки/);
    assert.match(text, /> \*\*Нужен ответ:\*\* Исполнитель спрашивает/);
    // Without n, the newest report is read.
    assert.equal((await call({ runDir }, env)).structuredContent.report.n, 1);
  }),
);

test(
  "a translation of the wrong length, a missing report and a run outside the state root are refused",
  withHome(async (home) => {
    const env = { MARVIN_PIPELINE_HOME: join(home, "state") };
    const { runDir } = seed(join(home, "state"));
    const short = await call({ runDir, translations: { events: ["one"] } }, env);
    assert.equal(short.isError, true);
    assert.match(textOf(short), /1 texts; report 1 has 2 events/);
    const missing = await call({ runDir, n: 7 }, env);
    assert.equal(missing.isError, true);
    assert.match(textOf(missing), /no report 7/);
    const { runDir: outside } = seed(join(home, "other"));
    const refused = await call({ runDir: outside }, env);
    assert.equal(refused.isError, true);
    assert.match(textOf(refused), /state root/);
  }),
);

test(
  "a report that links outside its run directory is not read",
  withHome(async (home) => {
    const env = { MARVIN_PIPELINE_HOME: join(home, "state") };
    const { runDir } = seed(join(home, "state"));
    const secret = join(home, "secret.json");
    writeFileSync(secret, "{}");
    symlinkSync(secret, sr.reportPath(runDir, 2));
    const r = await call({ runDir, n: 2 }, env);
    assert.equal(r.isError, true);
    assert.match(textOf(r), /outside/);
  }),
);

test("a quiet interval says who is working, and the footer names the session", () => {
  const base = {
    version: 1,
    runId: "r",
    n: 3,
    at: NOW.toISOString(),
    since: NOW.toISOString(),
    nextBy: NOW.toISOString(),
    final: false,
    lang: "en",
    task: "t",
    sessionName: null,
    state: "running",
    stage: "executing",
    rail: [],
    startedAt: NOW.toISOString(),
    elapsedMs: 72 * 60_000,
    costUsd: 4.12,
    costComplete: true,
    costDeltaUsd: 0.38,
    iteration: 2,
    rung: 1,
    rejections: { total: 1, last: { source: "gate", blocking: 2 } },
    active: [{ name: "r-executor-2", role: "executor", runningMs: 20 * 60_000 }],
    judgment: null,
    callout: null,
    events: [],
    omittedEvents: 0,
    prUrl: null,
    session: null,
  };
  const quiet = renderReport(base);
  assert.match(quiet, /_No new events\._/);
  assert.match(quiet, /Working: executor \(`r-executor-2`\), 20 min/);
  assert.match(quiet, /1 h 12 min/);
  assert.match(quiet, /\$4\.12 · \+\$0\.38 this interval/);
  assert.match(quiet, /1 · gates: 2 blocking/);
  assert.doesNotMatch(quiet, /Executor ·/, "no session, no footer");
  const working = renderReport({
    ...base,
    sessionName: "Report card",
    session: {
      name: "r-executor-2",
      role: "test-author",
      model: "opus",
      effort: "high",
      contextTokens: 286_552,
      contextWindow: null,
    },
  });
  assert.match(working, /^## #3 · Running · r\n\*\*Report card\*\*\n/);
  assert.match(working, /\n\nopus high effort · Context 287k$/);
});

test(
  "earlier reports unfold in the words they were shown in, English where none was given",
  withHome(async (home) => {
    const env = { MARVIN_PIPELINE_HOME: home };
    const { runDir, report } = seed(home);
    const second = (n) => ({
      ...report,
      n,
      events: [{ at: NOW.toISOString(), kind: "note", text: `event of report ${n}` }],
      omittedEvents: 1,
      callout: null,
    });
    sr.writeReport(runDir, second(2));
    sr.writeReport(runDir, second(3));
    // Report 1 is shown translated; report 2 never is.
    const first = await call(
      { runDir, n: 1, translations: { events: ["Первое", "Второе"], callout: "Вопрос" } },
      env,
    );
    assert.notEqual(first.isError, true, textOf(first));
    assert.ok(existsSync(join(runDir, "status-reports", "1.text.json")));
    assert.equal(existsSync(join(runDir, "status-reports", "2.text.json")), false);

    const r = await call({ runDir, n: 3 }, env);
    assert.deepEqual(
      r.structuredContent.earlier.map((e) => e.text),
      ["Первое", "Второе", "event of report 2"],
    );
    assert.equal(r.structuredContent.earlierOmitted, 1);
    // A kept file that no longer matches its report falls back to the English.
    writeFileSync(join(runDir, "status-reports", "1.text.json"), '{"events":["one"]}');
    const stale = await call({ runDir, n: 2 }, env);
    assert.deepEqual(
      stale.structuredContent.earlier.map((e) => e.text),
      ["executor 2 closed AC-3", "gate passed"],
    );
  }),
);

test("a final report renders the summary sections and no footer", () => {
  const rail = [
    "planning",
    "test_authoring",
    "executing",
    "gating",
    "verifying",
    "ci_wait",
    "retro",
  ];
  const summary = {
    stages: rail.map((key, i) => ({ key, ms: i === 1 ? null : (i + 1) * 60_000 })),
    activeMs: 58 * 60_000,
    roles: 5,
    tokens: {
      total: 11_300_000,
      cacheRead: 9_800_000,
      cacheWrite: 1_100_000,
      input: 210_000,
      output: 190_000,
      byRole: [
        {
          role: "executor",
          sessions: 2,
          model: "claude-opus-5-5",
          total: 6_400_000,
          peakContext: 176_000,
          contextWindow: 200_000,
        },
      ],
    },
    pr: {
      number: 266,
      files: 9,
      additions: 412,
      deletions: 38,
      checksPassed: 5,
      checksTotal: 5,
      base: "dev",
    },
    criteria: [
      { id: "AC1", text: "written every five minutes", proof: "red_green" },
      { id: "AC2", text: "the card unfolds", proof: null },
    ],
    questions: { byOrchestrator: 2, byUser: 0 },
    retro: { checks: 1, lessons: 1 },
    assumptions: ["the interval comes from --report-min"],
  };
  const report = {
    version: 1,
    runId: "r-1025",
    n: 15,
    at: "2026-10-25T15:26:00Z",
    since: "2026-10-25T15:21:00Z",
    nextBy: null,
    final: true,
    lang: "en",
    task: "t",
    sessionName: "Report card",
    state: "ready",
    stage: "ready",
    rail: rail.map((key) => ({ key, state: "done" })),
    startedAt: "2026-10-25T14:14:00Z",
    elapsedMs: 72 * 60_000,
    costUsd: 7.48,
    costComplete: true,
    costDeltaUsd: 0.62,
    iteration: 2,
    rung: 1,
    rejections: { total: 1, last: { source: "gate", blocking: 2 } },
    active: [],
    judgment: null,
    callout: null,
    events: [{ at: "2026-10-25T15:26:00Z", kind: "note", text: "PR ready to merge." }],
    omittedEvents: 0,
    prUrl: "https://github.com/o/r/pull/266",
    session: {
      name: "r-retro",
      role: "retro",
      model: "claude-sonnet-5-5",
      effort: "low",
      contextTokens: 1,
      contextWindow: 2,
    },
    summary,
  };
  const text = renderReport(report);
  assert.match(
    text,
    /^## Autopilot · final report · PR ready to merge\n\*\*Report card\*\*\n`r-1025` · /,
  );
  assert.match(text, /✓ Plan \(1 min\) → ✓ Tests → ✓ Execution \(3 min\)/);
  assert.match(text, /\| Elapsed \| Cost \| Iterations \| Rejections \|/);
  assert.match(
    text,
    /1 h 12 min · active 58 min \| \$7\.48 · 5 roles \| 2 · rung 1 \| 1 · gates: 2 blocking/,
  );
  assert.match(
    text,
    /\*\*Tokens · 11\.3M\*\*\nCache read 9\.8M · Cache write 1\.1M · Input 210k · Output 190k/,
  );
  assert.match(text, /\| Executor × 2 \| Opus 5\.5 \| 6\.4M \| 88% · 176k \/ 200k \|/);
  assert.match(
    text,
    /> \*\*PR #266 ready to merge\*\* · \[Open PR\]\(https:\/\/github\.com\/o\/r\/pull\/266\)/,
  );
  assert.match(text, /> 9 files · \+412 −38 · CI: 5 of 5 · into dev/);
  assert.match(
    text,
    /\*\*Acceptance criteria · 2 of 2\*\*\n- ✓ `AC1` written every five minutes · `red→green`\n- ✓ `AC2` the card unfolds\n/,
  );
  assert.match(
    text,
    /\*\*Questions:\*\* 2 questions: the orchestrator answered 2, you answered 0\./,
  );
  assert.match(text, /\*\*Retro:\*\* \+1 check in checks\.yaml, \+1 lesson in \.marvin\/memory\./);
  assert.match(
    text,
    /> \*\*Assumption · check at review:\*\* the interval comes from --report-min/,
  );
  assert.match(text, /- `\d\d:\d\d` PR ready to merge\.$/);
  assert.doesNotMatch(text, /effort/, "no session footer");
  // A final report without the summary, written before the field existed, reads as before.
  assert.match(renderReport({ ...report, summary: null }), /^## #15 · PR ready to merge · r-1025/);
});

test("the bundle binds the autopilot-status widget and rejects an undeclared argument", async () => {
  const listed = await withSession({}, (s) => s.request("tools/list", {}));
  const tool = listed.tools.find((t) => t.name === "autopilot-report");
  assert.ok(tool, "autopilot-report is registered");
  assert.equal(tool._meta?.ui?.resourceUri, "ui://marvin/autopilot-status.html");
  const r = await callTool("autopilot-report", { runDir: "/tmp/x", rundir: "/tmp/x" });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /rundir/);
});
