import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/**
 * What a running child is doing, read from its `stream-json` log, so the engine can tell the
 * orchestrator something during a long tool call.
 *
 * The heartbeat hook (`pipeline/hooks/heartbeat.mjs`) reminds a child to report, but it runs on
 * `PostToolUse`, after a tool call ends. A child inside one long call, such as a 20-minute gate run
 * through the `verify` tool, gets no reminder and sends no report, and the orchestrator hears
 * nothing for that long: in scenario 4 the executor's gaps between reports were 9 to 26 minutes.
 * The engine is the one process that is never blocked by the child, so it fills those gaps.
 */

/** A top-level tool call the child started and has not had a result for. */
export interface ToolCall {
  tool: string;
  /** A one-line hint of what it runs: a Bash description or command, a subagent's description, a path. */
  detail: string | null;
}

/** How much of the end of the log is read: enough for any recent call, cheap to read every look. */
const TAIL_BYTES = 512 * 1024;

const oneLine = (text: string, max = 100) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function detailOf(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  for (const key of ["description", "command", "file_path", "path", "pattern", "url", "prompt"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return oneLine(value);
  }
  return null;
}

/**
 * The newest top-level tool call in `log` that has no result yet, or null. A subagent's own calls
 * (a non-null `parent_tool_use_id`) are skipped: the subagent's `Task` call is the one in flight.
 * A line that does not parse, the last one when the child is mid-write among them, is skipped.
 */
export function pendingToolCall(log: string): ToolCall | null {
  const pending = new Map<string, ToolCall>();
  for (const line of log.split("\n")) {
    if (line.trim() === "") continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.parent_tool_use_id != null) continue;
    const content = (entry.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as Record<string, unknown>[]) {
      if (entry.type === "assistant" && part.type === "tool_use" && typeof part.id === "string") {
        pending.set(part.id, { tool: String(part.name ?? "tool"), detail: detailOf(part.input) });
      } else if (
        entry.type === "user" &&
        part.type === "tool_result" &&
        typeof part.tool_use_id === "string"
      ) {
        pending.delete(part.tool_use_id);
      }
    }
  }
  return [...pending.values()].at(-1) ?? null;
}

/** What a child's log says about its context: the model, the tokens in its newest turn, the window. */
export interface ContextUse {
  model: string | null;
  tokens: number | null;
  window: number | null;
}

const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/**
 * The context the child's newest top-level assistant turn carried (its input, cache reads and
 * cache writes together), the model it ran on, and the context window its `result` line reports
 * for that model. A subagent's turns are skipped, as in {@link pendingToolCall}: they fill the
 * subagent's context, not the child's. A field no line in `log` gives is null.
 */
export function contextUse(log: string): ContextUse {
  const use: ContextUse = { model: null, tokens: null, window: null };
  for (const line of log.split("\n")) {
    if (line.trim() === "") continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type === "system" && entry.subtype === "init" && typeof entry.model === "string") {
      use.model = entry.model;
    } else if (entry.type === "assistant" && entry.parent_tool_use_id == null) {
      const message = entry.message as
        { model?: unknown; usage?: Record<string, unknown> } | undefined;
      if (typeof message?.model === "string") use.model = message.model;
      const u = message?.usage;
      if (u) {
        use.tokens =
          count(u.input_tokens) +
          count(u.cache_read_input_tokens) +
          count(u.cache_creation_input_tokens);
      }
    } else if (
      entry.type === "result" &&
      typeof entry.modelUsage === "object" &&
      entry.modelUsage
    ) {
      const usage = entry.modelUsage as Record<string, { contextWindow?: unknown }>;
      const own = use.model === null ? undefined : usage[use.model];
      const window = (own ?? Object.values(usage)[0])?.contextWindow;
      if (typeof window === "number" && window > 0) use.window = window;
    }
  }
  return use;
}

/**
 * The end of the child's log and when it was last written, or null when it cannot be read. Only
 * the tail is read: a call older than it is not found, which is the price of reading it often.
 */
export function readLogTail(path: string): { text: string; mtimeMs: number } | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return null;
  }
  try {
    const { size, mtimeMs } = fstatSync(fd);
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    let text = buffer.toString("utf8");
    // A tail that starts mid-line drops that partial first line.
    if (length < size) text = text.slice(text.indexOf("\n") + 1);
    return { text, mtimeMs };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/**
 * The status line the engine writes for a child that has been quiet for `quietMs`: how long it
 * has run, how long since anyone heard from it, and the call it is in, with how long its log has
 * been still. English, one line, like every event text.
 */
export function statusLine(
  child: string,
  runningMs: number,
  quietMs: number,
  call: ToolCall | null,
  logIdleMs: number | null,
): string {
  const minutes = (ms: number) => Math.max(0, Math.round(ms / 60_000));
  const head = `${child} still running after ${minutes(runningMs)} min, no report for ${minutes(quietMs)} min`;
  if (call === null) {
    return logIdleMs === null
      ? `${head}; no tool call in flight`
      : `${head}; no tool call in flight, log idle ${minutes(logIdleMs)} min`;
  }
  const what = call.detail ? `${call.tool} (${call.detail})` : call.tool;
  return logIdleMs === null
    ? `${head}; in ${what}`
    : `${head}; in ${what} for at least ${minutes(logIdleMs)} min`;
}
