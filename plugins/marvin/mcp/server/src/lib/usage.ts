/**
 * Local usage log (ADR-0030). A `runPackServer` middleware hook (see
 * `src/server.ts`) calls `logUsageEvent` once per prompt-get and per tool-call.
 * Each call appends one JSON object per line to `.marvin/usage/events.jsonl`:
 *
 *     {"ts":"2026-07-03T10:00:00.000Z","kind":"tool","name":"dashboard"}
 *
 * The event is deliberately minimal — timestamp, kind, and the registered
 * command name only, never arguments or payloads — so nothing user-identifying
 * is ever recorded. The log answers one question locally: which of marvin's
 * commands does *this* project actually use. It is read only by the local
 * `dashboard` tool and never transmitted anywhere.
 *
 * Four guarantees, all owned here:
 *
 * 1. **Self-ignoring dir.** On first write the directory gets a `.gitignore`
 *    whose sole content is `*`, so neither the log nor the dir ever reaches git
 *    — per-machine telemetry stays per-machine regardless of whether the host
 *    commits the rest of `.marvin/`.
 * 2. **Size cap + rotation.** When `events.jsonl` would exceed `MAX_LOG_BYTES`
 *    it is rotated to `events.jsonl.1` (one generation kept) and a fresh file
 *    starts. The log never grows unbounded.
 * 3. **Kill-switch.** `usage: { enabled: false }` in `.marvin/config.json`
 *    (read through the shared fail-closed config path) suppresses every write.
 *    An absent config, or an absent `usage` block, means enabled — telemetry is
 *    opt-OUT.
 * 4. **Fail-open.** Any failure — unwritable dir, full disk, malformed config,
 *    a bad path — is swallowed. Logging is best-effort and must never break or
 *    delay the prompt-get or tool-call it observes.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { InvocationEvent } from "@marvin-toolkit/mcp-shared";
import type { ServerEnv } from "./env.js";
import { loadConfig } from "../storage/config.js";

/** Log file name inside the usage dir. */
export const EVENTS_FILE = "events.jsonl";
/** Rotated-generation file name (one generation kept). */
export const ROTATED_FILE = "events.jsonl.1";

/**
 * Rotation threshold in bytes (~1 MiB). At the JSONL line width used here
 * (~70 bytes/event) this holds on the order of 15k events before rotating —
 * far more than any single project's dashboard window needs, and the file stays
 * small enough to read and parse in one shot.
 */
export const MAX_LOG_BYTES = 1024 * 1024;

/**
 * Append one usage event for `env`. Never throws: every step is guarded so a
 * logging failure cannot surface into the request path (guarantee 4). Returns
 * nothing — the caller is fire-and-forget.
 */
export function logUsageEvent(env: ServerEnv, event: InvocationEvent): void {
  try {
    if (!usageEnabled(env)) return;
    ensureUsageDir(env.usageDir);
    const path = join(env.usageDir, EVENTS_FILE);
    rotateIfNeeded(env.usageDir, path);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      kind: event.kind,
      name: event.name,
    });
    appendFileSync(path, line + "\n");
  } catch {
    // best-effort: telemetry must never break the request being observed
  }
}

/**
 * Read the kill-switch through the shared fail-closed config path. Absent
 * config, absent `usage` block, or an unparseable config all resolve to enabled
 * (the `UsageConfig.enabled` default is `true`); only an explicit
 * `usage: { enabled: false }` turns logging off.
 */
function usageEnabled(env: ServerEnv): boolean {
  const { config } = loadConfig(env.configPath);
  return config.usage?.enabled ?? true;
}

/**
 * Create the usage dir if missing and drop a self-ignoring `.gitignore` (`*`)
 * inside it (guarantee 1). Idempotent: the `.gitignore` is written only when
 * absent, so a host that has customised it is left alone.
 */
function ensureUsageDir(usageDir: string): void {
  mkdirSync(usageDir, { recursive: true });
  const gitignore = join(usageDir, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, "*\n");
}

/**
 * Rotate when the current log has reached the cap (guarantee 2). Renaming over
 * any existing `events.jsonl.1` keeps exactly one prior generation; the next
 * append then starts a fresh `events.jsonl`.
 */
function rotateIfNeeded(usageDir: string, path: string): void {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return; // no file yet (or unstattable) — nothing to rotate
  }
  if (size < MAX_LOG_BYTES) return;
  renameSync(path, join(usageDir, ROTATED_FILE));
}
