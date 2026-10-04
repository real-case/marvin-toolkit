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
  return { ...meta, structured, outcome: status as Outcome, detail: "" };
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
