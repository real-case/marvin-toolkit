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
  /** The events block unfolded to the whole run. */
  historyTitle: string;
  /** The toggle that unfolds it, with the number of earlier events. */
  historyShow: (n: number) => string;
  historyHide: string;
  /** The rule between the earlier events and this report's. */
  historyDivider: string;
  copyImage: string;
  copied: string;
  /** The clipboard was refused and the image was saved as a file instead. */
  saved: string;
  copyFailed: string;
  /** A child's role, keyed as the engine names it (`test-author`). */
  roles: Record<string, string>;
  effort: string;
  context: string;
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
  historyTitle: "С начала работы",
  historyShow: (n) => `Вся история · ${n}`,
  historyHide: "Только с прошлого отчёта",
  historyDivider: "с прошлого отчёта",
  copyImage: "Скопировать как изображение",
  copied: "Скопировано",
  saved: "Сохранено файлом",
  copyFailed: "Не удалось скопировать",
  roles: {
    planner: "Планировщик",
    "test-author": "Автор тестов",
    executor: "Исполнитель",
    verifier: "Верификатор",
    retro: "Ретро",
  },
  effort: "Effort",
  context: "Контекст",
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
  historyTitle: "Since the start",
  historyShow: (n) => `Full history · ${n}`,
  historyHide: "Since the last report only",
  historyDivider: "since the last report",
  copyImage: "Copy as image",
  copied: "Copied",
  saved: "Saved as a file",
  copyFailed: "Could not copy",
  roles: {
    planner: "Planner",
    "test-author": "Test author",
    executor: "Executor",
    verifier: "Verifier",
    retro: "Retro",
  },
  effort: "Effort",
  context: "Context",
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

/** A model id as people say it: `claude-opus-5-5` → "Opus 5.5"; anything else as given. */
export function autopilotModel(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id);
  if (!m?.[1] || !m[2]) return id;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  return `${family} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

/** A token count to the thousand: 286552 → "287k", 1000000 → "1M". */
export function autopilotTokens(n: number): string {
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}M`;
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/**
 * How full the session's context window is: "42% · 84k / 200k", or "287k" when the window is
 * unknown. `percent` is null in the second case.
 */
export function autopilotContext(
  tokens: number,
  window: number | null,
): { percent: number | null; text: string } {
  if (window === null) return { percent: null, text: autopilotTokens(tokens) };
  const percent = Math.min(100, Math.round((tokens / window) * 100));
  return {
    percent,
    text: `${percent}% · ${autopilotTokens(tokens)} / ${autopilotTokens(window)}`,
  };
}
