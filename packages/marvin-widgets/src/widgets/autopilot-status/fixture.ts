import type {
  AutopilotReportPayload,
  AutopilotRailStep,
} from "@marvin-toolkit/mcp-shared/contracts";

/**
 * Fixtures for the autopilot-status widget (ADR-0051): one report per card state, as the
 * `autopilot-report` tool hands them to the widget — the engine's numbers with the event texts
 * already translated by the orchestrator. Times are fixed so the visual baselines stay stable;
 * the widget formats them on the reader's clock, so the stories pin no timezone of their own.
 */

const RAIL = [
  "planning",
  "test_authoring",
  "executing",
  "gating",
  "verifying",
  "ci_wait",
  "retro",
] as const;

function rail(current: number, mark: AutopilotRailStep["state"], retroDone = false) {
  return RAIL.map((key, i): AutopilotRailStep => {
    if (i < current) return { key, state: "done" };
    if (i === current) return { key, state: mark };
    if (key === "retro" && retroDone) return { key, state: "done" };
    return { key, state: "pending" };
  });
}

const RUN_DIR = "/Users/dev/.local/state/marvin-pipeline/marvin-toolkit/r-1025-1412-ab3c";

const base = {
  version: 1 as const,
  runId: "r-1025-1412-ab3c",
  lang: "ru",
  task: "Отчёт автопилота не реже раза в 5 минут",
  startedAt: "2026-10-25T14:14:00.000Z",
  prUrl: null,
  omittedEvents: 0,
  active: [],
  judgment: null,
  callout: null,
};

export const runningFixture: AutopilotReportPayload = {
  runDir: RUN_DIR,
  report: {
    ...base,
    n: 8,
    at: "2026-10-25T14:52:00.000Z",
    since: "2026-10-25T14:47:00.000Z",
    nextBy: "2026-10-25T14:57:00.000Z",
    final: false,
    state: "running",
    stage: "executing",
    rail: rail(2, "current"),
    elapsedMs: 38 * 60_000,
    costUsd: 4.12,
    costComplete: true,
    costDeltaUsd: 0.38,
    iteration: 2,
    rung: 1,
    rejections: { total: 1, last: { source: "gate", blocking: 2 } },
    active: [{ name: "r-1025-1412-ab3c-executor-2", role: "executor", runningMs: 20 * 60_000 }],
    events: [
      {
        at: "2026-10-25T14:48:00.000Z",
        kind: "report",
        text: "Исполнитель №2: критерий AC-3 закрыт, тест зелёный.",
      },
      {
        at: "2026-10-25T14:50:00.000Z",
        kind: "note",
        text: "Исполнитель №2: 2 коммита, 6 файлов в пределах контракта.",
      },
      {
        at: "2026-10-25T14:52:00.000Z",
        kind: "note",
        text: "Исполнитель №2 продолжает: AC-4.",
      },
    ],
  },
};

export const waitingFixture: AutopilotReportPayload = {
  runDir: RUN_DIR,
  report: {
    ...base,
    n: 2,
    at: "2026-10-25T14:23:00.000Z",
    since: "2026-10-25T14:19:00.000Z",
    nextBy: "2026-10-25T14:28:00.000Z",
    final: false,
    state: "waiting",
    stage: "awaiting_answer",
    rail: rail(0, "waiting"),
    elapsedMs: 9 * 60_000,
    costUsd: 0.92,
    costComplete: true,
    costDeltaUsd: 0.11,
    iteration: 0,
    rung: 0,
    rejections: { total: 0, last: null },
    judgment: "planner_questions",
    callout: {
      kind: "question",
      text: "Хранить отчёты в чате или в отдельной панели? Без ответа исполнение не начнётся.",
    },
    events: [
      {
        at: "2026-10-25T14:20:00.000Z",
        kind: "stage",
        text: "Стадия: планирование → ждёт ответа.",
      },
      {
        at: "2026-10-25T14:21:00.000Z",
        kind: "question",
        text: "Планировщик задал 2 вопроса.",
      },
    ],
  },
};

export const readyFixture: AutopilotReportPayload = {
  runDir: RUN_DIR,
  report: {
    ...base,
    n: 15,
    at: "2026-10-25T15:26:00.000Z",
    since: "2026-10-25T15:21:00.000Z",
    nextBy: null,
    final: true,
    state: "ready",
    stage: "ready",
    rail: rail(7, "done", true),
    elapsedMs: 72 * 60_000,
    costUsd: 7.48,
    costComplete: true,
    costDeltaUsd: 0.62,
    iteration: 2,
    rung: 1,
    rejections: { total: 1, last: { source: "gate", blocking: 2 } },
    prUrl: "https://github.com/real-case/marvin-toolkit/pull/266",
    events: [
      {
        at: "2026-10-25T15:22:00.000Z",
        kind: "note",
        text: "Ретро: добавлена 1 проверка, 1 урок.",
      },
      { at: "2026-10-25T15:26:00.000Z", kind: "note", text: "PR готов к слиянию." },
    ],
  },
};

export const haltedFixture: AutopilotReportPayload = {
  runDir: RUN_DIR,
  report: {
    ...base,
    n: 11,
    at: "2026-10-25T15:08:00.000Z",
    since: "2026-10-25T15:03:00.000Z",
    nextBy: null,
    final: true,
    state: "halted",
    stage: "done",
    rail: rail(3, "failed", true),
    elapsedMs: 54 * 60_000,
    costUsd: 5.6,
    costComplete: false,
    costDeltaUsd: null,
    iteration: 3,
    rung: 2,
    rejections: { total: 3, last: { source: "gate", blocking: 2 } },
    callout: {
      kind: "halt",
      text: "Лимит отказов: проверка scope трижды нашла файл вне контракта (docs/adr/0051).",
    },
    events: [
      {
        at: "2026-10-25T15:05:00.000Z",
        kind: "note",
        text: "Достигнут лимит отказов (3 из 3).",
      },
    ],
    omittedEvents: 2,
  },
};

/** A quiet interval in English: no events, one child still working. */
export const quietFixture: AutopilotReportPayload = {
  runDir: RUN_DIR,
  report: {
    ...runningFixture.report,
    lang: "en",
    task: "Report the autopilot at least every five minutes",
    n: 9,
    at: "2026-10-25T14:57:00.000Z",
    since: "2026-10-25T14:52:00.000Z",
    nextBy: "2026-10-25T15:02:00.000Z",
    costUsd: 4.33,
    costDeltaUsd: 0.21,
    elapsedMs: 43 * 60_000,
    active: [{ name: "r-1025-1412-ab3c-executor-2", role: "executor", runningMs: 25 * 60_000 }],
    events: [],
  },
};
