import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type Outcome =
  "running" | "stalled" | "crashed" | "limited" | "failed" | "needs_input" | "spec_ready" | "done";

export interface WaitResult {
  outcome: Outcome;
  sessionId: string | null;
  costUsd: number | null;
  durationMs: number | null;
  cacheReadTokens: number | null;
  structured: Record<string, unknown> | null;
  detail: string;
}

const STRUCTURED = new Set(["needs_input", "spec_ready", "done", "failed"]);

/** The furthest reset a usage limit may name and still be waited out rather than halted on. */
export const LIMIT_MAX_WAIT_MS = 6 * 60 * 60_000;
/** Taken after a named reset, so the retry does not land on the limit's last second. */
const LIMIT_RESET_MARGIN_MS = 60_000;

/**
 * When the usage limit a `limited` result names lifts, or null when its text names no time the
 * engine can read. Two forms are read: the CLI's `…limit reached|<epoch seconds>`, and a clock
 * time after "resets" (`resets 7pm`, `resets at 3:30 pm`), taken in the engine's own time zone,
 * which is the CLI's, at its next occurrence after `now`. A time that is not in the future is
 * not a reset.
 */
export function limitResetAt(detail: string, now: Date): Date | null {
  const epoch = /\|(\d{10})\b/.exec(detail)?.[1];
  if (epoch !== undefined) {
    const at = Number(epoch) * 1000 + LIMIT_RESET_MARGIN_MS;
    return at > now.getTime() ? new Date(at) : null;
  }
  const clock = /\bresets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(detail);
  if (!clock) return null;
  const hour = Number(clock[1]);
  const minute = Number(clock[2] ?? "0");
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const at = new Date(now);
  at.setHours((hour % 12) + (clock[3]?.toLowerCase() === "pm" ? 12 : 0), minute, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return new Date(at.getTime() + LIMIT_RESET_MARGIN_MS);
}

export function lastResultEvent(log: string): Record<string, unknown> | null {
  const lines = log.trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line?.startsWith("{")) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === "result") return event;
    } catch {
      continue;
    }
  }
  return null;
}

export function classify(i: {
  exitCode: number | null;
  result: Record<string, unknown> | null;
  idleMs: number;
  stallMs: number;
}): WaitResult {
  const none = {
    sessionId: null,
    costUsd: null,
    durationMs: null,
    cacheReadTokens: null,
    structured: null,
  };
  if (i.exitCode === null) {
    return i.idleMs >= i.stallMs
      ? {
          ...none,
          outcome: "stalled",
          detail: `no output for ${Math.round(i.idleMs / 60_000)} min`,
        }
      : { ...none, outcome: "running", detail: "" };
  }
  const r = i.result;
  if (!r) return { ...none, outcome: "crashed", detail: `exit ${i.exitCode}, no result event` };
  const usage = (r.usage ?? {}) as Record<string, unknown>;
  const meta = {
    sessionId: typeof r.session_id === "string" ? r.session_id : null,
    costUsd: typeof r.total_cost_usd === "number" ? r.total_cost_usd : null,
    durationMs: typeof r.duration_ms === "number" ? r.duration_ms : null,
    cacheReadTokens:
      typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : null,
  };
  const text = String(r.result ?? "");
  if (r.api_error_status === 429 || (r.is_error === true && /usage limit|rate limit/i.test(text))) {
    return { ...meta, structured: null, outcome: "limited", detail: text.slice(0, 200) };
  }
  if (r.is_error === true)
    return { ...meta, structured: null, outcome: "failed", detail: String(r.subtype ?? "error") };
  const s = r.structured_output;
  if (!s || typeof s !== "object")
    return { ...meta, structured: null, outcome: "crashed", detail: "no structured_output" };
  const structured = s as Record<string, unknown>;
  const status = String(structured.status ?? "");
  if (!STRUCTURED.has(status))
    return { ...meta, structured, outcome: "crashed", detail: `unknown status "${status}"` };
  // A child that gives up says why in `failure`, and the halt raised from this result shows
  // `detail` to the orchestrator, so it is the child's reason rather than nothing.
  const failure =
    status === "failed" && typeof structured.failure === "string"
      ? structured.failure.trim().slice(0, 200)
      : "";
  return { ...meta, structured, outcome: status as Outcome, detail: failure };
}

export function readChildState(runDir: string, name: string, nowMs: number) {
  const exitPath = join(runDir, `${name}.exit`);
  const logPath = join(runDir, `${name}.log.jsonl`);
  const raw = existsSync(exitPath) ? readFileSync(exitPath, "utf8").trim() : "";
  const hasLog = existsSync(logPath);
  const result = hasLog ? lastResultEvent(readFileSync(logPath, "utf8")) : null;
  const exitCode = raw === "" ? (result ? 0 : null) : Number(raw);
  return { exitCode, result, idleMs: hasLog ? nowMs - statSync(logPath).mtimeMs : 0 };
}

export async function waitForChild(o: {
  runDir: string;
  name: string;
  pollMs: number;
  stallMs: number;
  deadlineMs: number;
}): Promise<WaitResult> {
  const started = Date.now();
  for (;;) {
    const r = classify({ ...readChildState(o.runDir, o.name, Date.now()), stallMs: o.stallMs });
    if (r.outcome !== "running" || Date.now() - started >= o.deadlineMs) return r;
    await new Promise((resolve) => setTimeout(resolve, o.pollMs));
  }
}

export function summaryLine(name: string, r: WaitResult): string {
  const cost = r.costUsd === null ? "?" : `$${r.costUsd.toFixed(2)}`;
  const dur = r.durationMs === null ? "?" : `${Math.round(r.durationMs / 60_000)}m`;
  const detail = r.detail ? ` detail=${JSON.stringify(r.detail)}` : "";
  return `CHILD ${name} outcome=${r.outcome} cost=${cost} dur=${dur} session=${r.sessionId ?? "-"}${detail}`;
}
