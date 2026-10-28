import type { AutopilotRailKey, AutopilotState, AutopilotSummary } from "./contracts/autopilot.js";

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
  /** The working session's model and effort: "Opus 5.5 medium effort". */
  modelEffort: (model: string, effort: string) => string;
  context: string;
  /** A duration, rounded to whole minutes: "38 min", "1 h 12 min". */
  duration: (ms: number) => string;
  /** The final report's own labels: the card a run shows once it is over. */
  final: AutopilotFinalLabels;
}

export interface AutopilotFinalLabels {
  title: string;
  iterations: string;
  /** The elapsed figure's subline: the time in which a child ran. */
  active: (duration: string) => string;
  /** The cost figure's subline: how many roles ran. */
  roles: (n: number) => string;
  tokensTitle: (total: string) => string;
  tokenKinds: Record<"cacheRead" | "cacheWrite" | "input" | "output", string>;
  byRoleShow: string;
  byRoleHide: string;
  columns: Record<"role" | "model" | "tokens" | "peak", string>;
  roleNames: Record<string, string>;
  prReady: (n: number | null) => string;
  prFiles: (n: number) => string;
  ci: (passed: number, total: number) => string;
  intoBase: (base: string) => string;
  openPr: string;
  criteriaTitle: (proven: number, total: number) => string;
  proofShow: string;
  proofHide: string;
  proof: Record<"red_green" | "green", string>;
  questionsTitle: string;
  questions: (byOrchestrator: number, byUser: number) => string;
  retroTitle: string;
  retro: (checks: number, lessons: number) => string;
  assumptionTitle: string;
}

/** The Russian plural form for `n`: one, few (2–4), many. */
function ruPlural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (ones === 1) return one;
  return ones >= 2 && ones <= 4 ? few : many;
}

const enPlural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const RU_FINAL: AutopilotFinalLabels = {
  title: "Автопилот · итоговый отчёт",
  iterations: "Итерации",
  active: (d) => `активно ${d}`,
  roles: (n) => `${n} ${ruPlural(n, "роль", "роли", "ролей")}`,
  tokensTitle: (total) => `Токены · ${total}`,
  tokenKinds: {
    cacheRead: "Чтение кэша",
    cacheWrite: "Запись кэша",
    input: "Вход",
    output: "Выход",
  },
  byRoleShow: "По ролям",
  byRoleHide: "Скрыть по ролям",
  columns: { role: "Роль", model: "Модель", tokens: "Токены", peak: "Пик контекста" },
  roleNames: {
    planner: "Планировщик",
    "test-author": "Автор тестов",
    executor: "Исполнитель",
    verifier: "Верификатор",
    retro: "Ретро",
  },
  prReady: (n) => (n === null ? "PR готов к слиянию" : `PR #${n} готов к слиянию`),
  prFiles: (n) => `${n} ${ruPlural(n, "файл", "файла", "файлов")}`,
  ci: (passed, total) => `CI: ${passed} из ${total}`,
  intoBase: (base) => `в ${base}`,
  openPr: "Открыть PR",
  criteriaTitle: (proven, total) => `Критерии приёмки · ${proven} из ${total}`,
  proofShow: "Показать доказательства",
  proofHide: "Скрыть доказательства",
  proof: { red_green: "red→green", green: "green" },
  questionsTitle: "Вопросы",
  questions: (o, u) =>
    o + u === 0
      ? "Вопросов не было."
      : `${o + u} ${ruPlural(o + u, "вопрос", "вопроса", "вопросов")}: оркестратор ответил на ${o}, вы на ${u}.`,
  retroTitle: "Ретро",
  retro: (c, l) =>
    c + l === 0
      ? "Ничего не добавлено."
      : `+${c} ${ruPlural(c, "проверка", "проверки", "проверок")} в checks.yaml, +${l} ${ruPlural(l, "урок", "урока", "уроков")} в .marvin/memory.`,
  assumptionTitle: "Допущение · проверьте при ревью",
};

const EN_FINAL: AutopilotFinalLabels = {
  title: "Autopilot · final report",
  iterations: "Iterations",
  active: (d) => `active ${d}`,
  roles: (n) => `${n} ${enPlural(n, "role", "roles")}`,
  tokensTitle: (total) => `Tokens · ${total}`,
  tokenKinds: {
    cacheRead: "Cache read",
    cacheWrite: "Cache write",
    input: "Input",
    output: "Output",
  },
  byRoleShow: "By role",
  byRoleHide: "Hide roles",
  columns: { role: "Role", model: "Model", tokens: "Tokens", peak: "Peak context" },
  roleNames: {
    planner: "Planner",
    "test-author": "Test author",
    executor: "Executor",
    verifier: "Verifier",
    retro: "Retro",
  },
  prReady: (n) => (n === null ? "PR ready to merge" : `PR #${n} ready to merge`),
  prFiles: (n) => `${n} ${enPlural(n, "file", "files")}`,
  ci: (passed, total) => `CI: ${passed} of ${total}`,
  intoBase: (base) => `into ${base}`,
  openPr: "Open PR",
  criteriaTitle: (proven, total) => `Acceptance criteria · ${proven} of ${total}`,
  proofShow: "Show evidence",
  proofHide: "Hide evidence",
  proof: { red_green: "red→green", green: "green" },
  questionsTitle: "Questions",
  questions: (o, u) =>
    o + u === 0
      ? "No questions."
      : `${o + u} ${enPlural(o + u, "question", "questions")}: the orchestrator answered ${o}, you answered ${u}.`,
  retroTitle: "Retro",
  retro: (c, l) =>
    c + l === 0
      ? "Nothing added."
      : `+${c} ${enPlural(c, "check", "checks")} in checks.yaml, +${l} ${enPlural(l, "lesson", "lessons")} in .marvin/memory.`,
  assumptionTitle: "Assumption · check at review",
};

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
  historyTitle: "С начала работы",
  historyShow: (n) => `Вся история · ${n}`,
  historyHide: "Только с прошлого отчёта",
  historyDivider: "с прошлого отчёта",
  copyImage: "Скопировать как изображение",
  copied: "Скопировано",
  saved: "Сохранено файлом",
  copyFailed: "Не удалось скопировать",
  modelEffort: (model, effort) => `${model} ${effort} effort`,
  context: "Контекст",
  duration: (ms) => duration(ms, "ч", "мин"),
  final: RU_FINAL,
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
  historyTitle: "Since the start",
  historyShow: (n) => `Full history · ${n}`,
  historyHide: "Since the last report only",
  historyDivider: "since the last report",
  copyImage: "Copy as image",
  copied: "Copied",
  saved: "Saved as a file",
  copyFailed: "Could not copy",
  modelEffort: (model, effort) => `${model} ${effort} effort`,
  context: "Context",
  duration: (ms) => duration(ms, "h", "min"),
  final: EN_FINAL,
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

/** A large token count to one decimal: 11300000 → "11.3M", 210000 → "210k". */
export function autopilotTokenTotal(n: number): string {
  if (n < 1_000_000) return autopilotTokens(n);
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
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

/** A role as the final card names it, with the number of its sessions when more than one ran. */
export function autopilotRoleName(f: AutopilotFinalLabels, role: string, sessions: number): string {
  const name = f.roleNames[role] ?? role;
  return sessions > 1 ? `${name} × ${sessions}` : name;
}

type Criterion = NonNullable<AutopilotSummary["criteria"]>[number];

/** A criterion counts as met on a ready run, which the verifier accepted, or with a proof. */
export const autopilotCriterionMet = (state: AutopilotState, c: Criterion) =>
  state === "ready" || c.proof !== null;
