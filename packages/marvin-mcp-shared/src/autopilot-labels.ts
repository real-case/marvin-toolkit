import type { AutopilotRailKey, AutopilotState } from "./contracts/autopilot.js";

/**
 * Labels and formatters for an autopilot status report (ADR-0051), shared by the
 * `autopilot-report` tool's Markdown and the autopilot-status widget so the two surfaces word one
 * report alike. Kept out of `contracts/` because the widget imports it at runtime, and the widget
 * bundle takes only types from the contracts.
 */

export interface AutopilotLabels {
  rail: Record<AutopilotRailKey, string>;
  state: Record<AutopilotState, string>;
  elapsed: string;
  cost: string;
  iteration: string;
  rejections: string;
  since: (time: string) => string;
  costDelta: (usd: string) => string;
  costPartial: string;
  rung: (n: number) => string;
  noRejections: string;
  lastRejection: (source: string, blocking: number) => string;
  sources: Record<"gate" | "verifier" | "ci", string>;
  calloutTitle: Record<"question" | "halt", string>;
  eventsTitle: string;
  noEvents: string;
  working: string;
  report: (n: number) => string;
  nextBy: (time: string) => string;
  final: string;
  /** A duration, rounded to whole minutes: "38 min", "1 h 12 min". */
  duration: (ms: number) => string;
}

function duration(ms: number, h: string, min: string): string {
  const total = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(total / 60);
  return hours === 0 ? `${total} ${min}` : `${hours} ${h} ${total % 60} ${min}`;
}

const RU: AutopilotLabels = {
  rail: {
    planning: "План",
    test_authoring: "Тесты",
    executing: "Исполнение",
    gating: "Проверки",
    verifying: "Верификатор",
    ci_wait: "CI",
    retro: "Ретро",
  },
  state: {
    running: "Идёт",
    waiting: "Ждёт ответа",
    ready: "PR готов к слиянию",
    halted: "Остановлен",
  },
  elapsed: "Время",
  cost: "Стоимость",
  iteration: "Итерация",
  rejections: "Отказы",
  since: (t) => `с ${t}`,
  costDelta: (usd) => `+${usd} за интервал`,
  costPartial: "часть сумм неизвестна",
  rung: (n) => `ступень ${n}`,
  noRejections: "не было",
  lastRejection: (source, blocking) => `${source}: ${blocking} блок.`,
  sources: { gate: "проверки", verifier: "верификатор", ci: "CI" },
  calloutTitle: { question: "Нужен ответ", halt: "Причина остановки" },
  eventsTitle: "С прошлого отчёта",
  noEvents: "Новых событий нет.",
  working: "Работают",
  report: (n) => `отчёт № ${n}`,
  nextBy: (t) => `следующий ≤ ${t}`,
  final: "Финальный отчёт",
  duration: (ms) => duration(ms, "ч", "мин"),
};

const EN: AutopilotLabels = {
  rail: {
    planning: "Plan",
    test_authoring: "Tests",
    executing: "Execution",
    gating: "Gates",
    verifying: "Verifier",
    ci_wait: "CI",
    retro: "Retro",
  },
  state: {
    running: "Running",
    waiting: "Awaiting an answer",
    ready: "PR ready to merge",
    halted: "Halted",
  },
  elapsed: "Elapsed",
  cost: "Cost",
  iteration: "Iteration",
  rejections: "Rejections",
  since: (t) => `since ${t}`,
  costDelta: (usd) => `+${usd} this interval`,
  costPartial: "some costs unknown",
  rung: (n) => `rung ${n}`,
  noRejections: "none",
  lastRejection: (source, blocking) => `${source}: ${blocking} blocking`,
  sources: { gate: "gates", verifier: "verifier", ci: "CI" },
  calloutTitle: { question: "An answer is needed", halt: "Why it stopped" },
  eventsTitle: "Since the last report",
  noEvents: "No new events.",
  working: "Working",
  report: (n) => `report #${n}`,
  nextBy: (t) => `next by ${t}`,
  final: "Final report",
  duration: (ms) => duration(ms, "h", "min"),
};

/** Russian for a `ru*` language tag, English for every other. */
export function autopilotLabels(lang: string): AutopilotLabels {
  return lang.toLowerCase().startsWith("ru") ? RU : EN;
}

/** Dollars to the cent: "$4.12". */
export const autopilotUsd = (n: number) => `$${n.toFixed(2)}`;

/** An ISO time as HH:MM on the reader's clock. */
export function autopilotTime(iso: string): string {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}
