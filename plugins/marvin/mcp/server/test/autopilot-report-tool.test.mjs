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
    assert.match(text, /^## Ждёт ответа · r-1025 · отчёт № 1\n\*\*Отчёт автопилота\*\*\n/);
    assert.match(text, /Исполнитель · Opus 5\.5 · Effort medium · Контекст 42% · 84k \/ 200k$/);
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
  assert.match(working, /^## Running · r · report #3\n\*\*Report card\*\*\n/);
  assert.match(working, /\n\nTest author · opus · Effort high · Context 287k$/);
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

test("the bundle binds the autopilot-status widget and rejects an undeclared argument", async () => {
  const listed = await withSession({}, (s) => s.request("tools/list", {}));
  const tool = listed.tools.find((t) => t.name === "autopilot-report");
  assert.ok(tool, "autopilot-report is registered");
  assert.equal(tool._meta?.ui?.resourceUri, "ui://marvin/autopilot-status.html");
  const r = await callTool("autopilot-report", { runDir: "/tmp/x", rundir: "/tmp/x" });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /rundir/);
});
