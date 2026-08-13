#!/usr/bin/env node
/**
 * usage-surface — the declared command surface against the names this project has
 * actually invoked, so dead surface becomes visible instead of assumed.
 *
 *   npm run usage:surface
 *   MARVIN_USAGE_DIR=/path/to/.marvin/usage npm run usage:surface
 *
 * Read-only, and a REPORT rather than a gate: it exits 0 unconditionally, including
 * when no log exists at all.
 *
 * WHAT IT READS. The local usage log (ADR-0030): `events.jsonl` AND its one rotated
 * generation `events.jsonl.1`, both inside the directory `src/lib/env.ts` resolves as
 * `MARVIN_USAGE_DIR ?? <CLAUDE_PROJECT_DIR ?? cwd>/.marvin/usage`. Reading only the
 * current file would make "never invoked" wrong the moment a project crosses the size
 * cap, because rotation moves the older half out of view. Lines are parsed with the
 * same defensive contract the dashboard's reader uses — blank lines skipped, one
 * `JSON.parse` per line inside try/continue, `ts` and `name` required as non-empty
 * strings, `kind` exactly `prompt` or `tool` — so a torn write or a foreign line costs
 * one event, never the run.
 *
 * WHICH LOG. This repository has TWO. The project log under `<repo>/.marvin/usage/` is
 * the one read by default; a second exists at
 * `plugins/marvin/mcp/server/.marvin/usage/`, written by test runs whose cwd is the
 * server package. The report names both, and never says "the log" unqualified.
 *
 * WHY THE REGISTRY IS READ FROM SOURCE. The declared names come from the prompt
 * registry (`loadRegistry`, shared with the site's catalog generator) and from the
 * `defineTool` declarations under `src/tools/`. Driving `dist/server.js` over stdio
 * would be the obvious alternative and is exactly wrong: every `prompts/get` the driver
 * issues is itself a logged event, so the measurement would write its own answer into
 * the log it is measuring. `scripts/smoke-commands.mjs` did that 53 prompts at a time
 * until it was given a scrubbed environment; see the note there.
 *
 * TWO AXES, REPORTED SEPARATELY. Four names — `help`, `lessons`, `dashboard`,
 * `reports` — exist in both namespaces, so merging them would credit a prompt
 * invocation to a tool that has never run.
 *
 * AGES, HONESTLY. A never-invoked name has no age; only invoked ones get a last-seen.
 * The report therefore leads with the observation window, so an empty or short log
 * cannot be read as "nothing is used". Distinct calendar days per name is the second
 * metric: it is what makes a single 53-name burst visibly one day rather than 53 uses.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { groupOf, loadRegistry } from "../packages/site/scripts/gen-catalog.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_ROOT = join(repoRoot, "plugins", "marvin", "mcp", "server");
const TOOLS_DIR = join(SERVER_ROOT, "src", "tools");

/** The second log on disk in this repository — named in the report, never merged in. */
const SERVER_PACKAGE_USAGE_DIR = join(SERVER_ROOT, ".marvin", "usage");

/** Both generations the writer keeps (`lib/usage.ts`), current first. */
export const LOG_FILES = ["events.jsonl", "events.jsonl.1"];

const MS_PER_DAY = 86_400_000;

// ── reading ─────────────────────────────────────────────────────────────────

/** The usage directory, resolved exactly as `src/lib/env.ts` resolves it. */
export function resolveUsageDir(env = process.env, cwd = process.cwd()) {
  return env.MARVIN_USAGE_DIR ?? join(env.CLAUDE_PROJECT_DIR ?? cwd, ".marvin", "usage");
}

/**
 * Parse one log generation into events. Defensive by contract: anything that is not a
 * well-formed `{ts, kind, name}` record is skipped silently.
 */
export function parseEvents(raw) {
  const events = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const { ts, kind, name } = parsed;
    if (typeof ts !== "string" || ts === "" || typeof name !== "string" || name === "") continue;
    if (kind !== "prompt" && kind !== "tool") continue;
    events.push({ ts, kind, name });
  }
  return events;
}

/**
 * Every event in `usageDir`, across both generations. An absent or unreadable file is
 * not an error — it is the normal state of `events.jsonl.1` on a project that has never
 * rotated. `present` reports which files actually contributed.
 */
export function readEvents(usageDir) {
  const present = [];
  const events = [];
  for (const file of LOG_FILES) {
    let raw;
    try {
      raw = readFileSync(join(usageDir, file), "utf8");
    } catch {
      continue;
    }
    present.push(file);
    events.push(...parseEvents(raw));
  }
  return { present, events };
}

/**
 * The declared tool names, read from the `defineTool` declarations themselves — the
 * same "a tool file is one that calls `defineTool(`" rule the catalog generator counts
 * with. The name is taken after that call site, because several tool modules declare an
 * unrelated `name` field above it.
 */
export function loadToolNames(dir = TOOLS_DIR) {
  const names = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = readFileSync(join(dir, file), "utf8");
    const at = source.indexOf("defineTool(");
    if (at === -1) continue;
    const match = /name:\s*"([^"]+)"/.exec(source.slice(at));
    if (match) names.push(match[1]);
  }
  return names.sort();
}

// ── measuring ───────────────────────────────────────────────────────────────

/** Whole days between two ISO timestamps, or null when either is not a real date. */
function daysBetween(from, to) {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / MS_PER_DAY);
}

/**
 * The observation period: what the log can speak about at all. Reported before any
 * per-name figure, because "never invoked" means "not invoked in this window on this
 * machine" and nothing stronger.
 */
export function observationWindow(events, now = new Date()) {
  if (events.length === 0) return null;
  let from = events[0].ts;
  let to = events[0].ts;
  const perDay = new Map();
  for (const e of events) {
    // ISO timestamps compare correctly as strings.
    if (e.ts < from) from = e.ts;
    if (e.ts > to) to = e.ts;
    const day = e.ts.slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  let busiest = null;
  for (const [day, count] of perDay) {
    if (
      busiest === null ||
      count > busiest.count ||
      (count === busiest.count && day < busiest.day)
    ) {
      busiest = { day, count };
    }
  }
  const span = daysBetween(from, to);
  return {
    from,
    to,
    events: events.length,
    activeDays: perDay.size,
    spanDays: span === null ? null : span + 1,
    ageDays: daysBetween(to, now.toISOString()),
    busiest,
  };
}

/** Per-name figures for one invoked name. */
function entryOf(record, now) {
  return {
    name: record.name,
    calls: record.calls,
    days: record.days.size,
    last: record.last,
    ageDays: daysBetween(record.last, now.toISOString()),
  };
}

/**
 * One axis of the comparison: declared names for `kind` against the names the log
 * carries for that same kind. `unknown` holds logged names the registry no longer
 * declares — renamed or removed commands, which is a different signal from dead surface
 * and is kept apart from it.
 */
export function axisSurface(declared, events, kind, now = new Date()) {
  const seen = new Map();
  for (const e of events) {
    if (e.kind !== kind) continue;
    let record = seen.get(e.name);
    if (!record) {
      record = { name: e.name, calls: 0, days: new Set(), last: e.ts };
      seen.set(e.name, record);
    }
    record.calls += 1;
    record.days.add(e.ts.slice(0, 10));
    if (e.ts > record.last) record.last = e.ts;
  }
  const declaredSet = new Set(declared);
  const invoked = declared
    .filter((name) => seen.has(name))
    .map((name) => entryOf(seen.get(name), now))
    // Least recently seen first: the end of the list nearest to being dead.
    .sort((a, b) => (a.last < b.last ? -1 : a.last > b.last ? 1 : a.name.localeCompare(b.name)));
  const never = declared.filter((name) => !seen.has(name));
  const unknown = [...seen.values()]
    .filter((record) => !declaredSet.has(record.name))
    .map((record) => entryOf(record, now))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
  return { kind, declared: declared.length, invoked, never, unknown };
}

// ── rendering ───────────────────────────────────────────────────────────────

const LABEL_WIDTH = 12;

function label(text) {
  return text.padEnd(LABEL_WIDTH);
}

/** Join `items` with ", " into lines of at most `width` characters. */
export function wrap(items, width) {
  const lines = [];
  let current = "";
  for (const item of items) {
    const candidate = current === "" ? item : `${current}, ${item}`;
    if (current !== "" && candidate.length > width) {
      lines.push(`${current},`);
      current = item;
    } else {
      current = candidate;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

/** `2026-08-13 (3d ago)`, degrading to `(age unknown)` when the timestamp is not a date. */
function stamp(ts, ageDays) {
  const day = ts.slice(0, 10);
  if (ageDays === null) return `${day} (age unknown)`;
  return `${day} (${ageDays}d ago)`;
}

function renderWindow(window, lines) {
  if (window === null) {
    lines.push(`${label("Window")}none — no event has been recorded here.`);
    lines.push(
      `${label("")}Every name below is therefore unobserved, which is NOT the same as unused.`,
    );
    return;
  }
  const span = window.spanDays === null ? "?" : window.spanDays;
  lines.push(
    `${label("Window")}${window.from.slice(0, 10)} → ${stamp(window.to, window.ageDays)} · ` +
      `${span} calendar days, ${window.activeDays} with activity · ${window.events} events`,
  );
  if (window.busiest) {
    const share = Math.round((window.busiest.count / window.events) * 100);
    lines.push(
      `${label("")}Busiest day ${window.busiest.day}: ${window.busiest.count} events (${share}%).`,
    );
  }
}

function renderAxis(axis, title, groupFor, lines) {
  lines.push("");
  lines.push(
    `${title} — ${axis.declared} declared · ${axis.invoked.length} invoked · ` +
      `${axis.never.length} never invoked`,
  );
  if (axis.never.length === 0) {
    lines.push("  Never invoked: none — every declared name appears in the log named above.");
  } else {
    lines.push(
      "  Never invoked (a never-invoked name has no age — only the window above applies):",
    );
    for (const name of axis.never) {
      const group = groupFor ? ` (${groupFor(name)})` : "";
      lines.push(`    ${name}${group}`);
    }
  }
  if (axis.invoked.length > 0) {
    const nameWidth = Math.max(...axis.invoked.map((e) => e.name.length));
    const stamps = axis.invoked.map((e) => stamp(e.last, e.ageDays));
    const stampWidth = Math.max(...stamps.map((s) => s.length));
    const callWidth = Math.max(...axis.invoked.map((e) => String(e.calls).length));
    lines.push("  Invoked, least recently first:");
    axis.invoked.forEach((e, i) => {
      lines.push(
        `    ${e.name.padEnd(nameWidth)}  last ${stamps[i].padEnd(stampWidth)} · ` +
          `${String(e.calls).padStart(callWidth)} call${e.calls === 1 ? " " : "s"} · ` +
          `${e.days} day${e.days === 1 ? "" : "s"}`,
      );
    });
  }
  if (axis.unknown.length > 0) {
    lines.push(`  In the log but not declared — renamed or removed (${axis.unknown.length}):`);
    for (const line of wrap(
      axis.unknown.map((e) => `${e.name} (${e.calls})`),
      86,
    )) {
      lines.push(`    ${line}`);
    }
  }
}

/** The whole report as text. Pure: every input is passed in. */
export function renderReport({ usageDir, present, secondLog, window, prompts, tools }) {
  const lines = [];
  lines.push("usage-surface — declared command surface vs the names this project has invoked");
  lines.push("");
  const files = present.length > 0 ? present.join(", ") : "NEITHER FILE PRESENT";
  lines.push(`${label("Log read")}${usageDir}  [${files}]`);
  if (secondLog.exists) {
    lines.push(`${label("Not read")}${secondLog.path}`);
    lines.push(
      `${label("")}A second log, written by test runs whose cwd is the server package. ` +
        `Point MARVIN_USAGE_DIR at it to read that one instead.`,
    );
  }
  renderWindow(window, lines);
  renderAxis(prompts, "PROMPTS", groupOf, lines);
  renderAxis(tools, "TOOLS", null, lines);
  lines.push("");
  lines.push(
    "Read this as observation, not as usage: it covers only what this machine recorded in the",
  );
  lines.push("window above, and only for the log named at the top.");
  return lines.join("\n");
}

// ── entry point ─────────────────────────────────────────────────────────────

export async function buildReport(env = process.env, cwd = process.cwd(), now = new Date()) {
  // Absolute from here on: the header must name a path the reader can act on, and the
  // second-log comparison below is a path equality that a relative override would defeat.
  const usageDir = resolve(cwd, resolveUsageDir(env, cwd));
  const { present, events } = readEvents(usageDir);
  const { PROMPTS } = await loadRegistry();
  const declaredPrompts = PROMPTS.map((p) => p.name);
  const declaredTools = loadToolNames();
  return renderReport({
    usageDir,
    present,
    secondLog: {
      path: SERVER_PACKAGE_USAGE_DIR,
      // Named only when it is genuinely there, so the note is never a hypothetical.
      exists: existsSync(SERVER_PACKAGE_USAGE_DIR) && usageDir !== SERVER_PACKAGE_USAGE_DIR,
    },
    window: observationWindow(events, now),
    prompts: axisSurface(declaredPrompts, events, "prompt", now),
    tools: axisSurface(declaredTools, events, "tool", now),
  });
}

// Run directly → print the report. Imported (by the test) → export only.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(await buildReport());
  } catch (err) {
    // A report, not a gate: a failure to build it is stated and costs nothing downstream.
    console.error(`usage-surface: could not build the report — ${err.message}`);
  }
  process.exit(0);
}
