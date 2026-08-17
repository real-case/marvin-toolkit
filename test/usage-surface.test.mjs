// Tests for the usage-surface report and for the smoke test's telemetry isolation.
//
// The defect that motivates both: `scripts/smoke-commands.mjs` spawned the server from the
// repo root with an inherited environment, so every run wrote the whole prompt registry into
// the very log this script measures — 53 events, in registry order, inside one second. The
// prompt axis was structurally saturated and the report was a mirror of its own measurement.
//
// Each fixture below is built so a plausible WRONG implementation gives a different answer:
// the rotation case puts a name ONLY in `events.jsonl.1`, the axis case gives one name to
// both namespaces, and the day case spreads two calls across two days while another name
// takes two calls in one second.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  axisSurface,
  buildReport,
  loadToolNames,
  observationWindow,
  parseEvents,
  readEvents,
  renderReport,
  resolveUsageDir,
  wrap,
} from "../scripts/usage-surface.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date("2026-08-13T12:00:00.000Z");

function line(ts, kind, name) {
  return JSON.stringify({ ts, kind, name });
}

/** A throwaway usage directory holding the given file contents. */
function makeUsageDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "marvin-usage-surface-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

// ── the defensive parse contract (shared with the dashboard's reader) ────────

test("parseEvents keeps well-formed records and skips everything else", () => {
  const raw = [
    "",
    "   ",
    "not json at all",
    "[1,2,3]",
    "null",
    JSON.stringify({ kind: "prompt", name: "commit" }), // no ts
    JSON.stringify({ ts: "", kind: "prompt", name: "commit" }), // empty ts
    JSON.stringify({ ts: "2026-08-01T00:00:00.000Z", kind: "prompt" }), // no name
    JSON.stringify({ ts: "2026-08-01T00:00:00.000Z", kind: "prompt", name: "" }), // empty name
    JSON.stringify({ ts: "2026-08-01T00:00:00.000Z", kind: "resource", name: "help" }), // bad kind
    JSON.stringify({ ts: "2026-08-01T00:00:00.000Z", kind: "prompt", name: "commit", extra: 1 }),
    line("2026-08-02T00:00:00.000Z", "tool", "verify"),
    '{"ts":"2026-08-03T00:00:00.00', // torn write, no newline
  ].join("\n");

  assert.deepEqual(parseEvents(raw), [
    { ts: "2026-08-01T00:00:00.000Z", kind: "prompt", name: "commit" },
    { ts: "2026-08-02T00:00:00.000Z", kind: "tool", name: "verify" },
  ]);
});

// ── rotation: the older generation is half the history ──────────────────────

test("readEvents reads both generations and reports which were present", () => {
  const dir = makeUsageDir({
    "events.jsonl": line("2026-08-10T00:00:00.000Z", "prompt", "commit") + "\n",
    "events.jsonl.1": line("2026-07-01T00:00:00.000Z", "prompt", "sec-scan") + "\n",
  });
  try {
    const { present, events } = readEvents(dir);
    assert.deepEqual(present, ["events.jsonl", "events.jsonl.1"]);
    assert.deepEqual(
      events.map((e) => e.name),
      ["commit", "sec-scan"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readEvents treats an absent generation as normal, not as an error", () => {
  const dir = makeUsageDir({
    "events.jsonl": line("2026-08-10T00:00:00.000Z", "prompt", "commit") + "\n",
  });
  try {
    const { present, events } = readEvents(dir);
    assert.deepEqual(present, ["events.jsonl"]);
    assert.equal(events.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readEvents on a directory with no log at all yields nothing", () => {
  const dir = makeUsageDir({});
  try {
    assert.deepEqual(readEvents(dir), { present: [], events: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── directory resolution, matching src/lib/env.ts ────────────────────────────

test("resolveUsageDir honours MARVIN_USAGE_DIR, then CLAUDE_PROJECT_DIR, then cwd", () => {
  assert.equal(resolveUsageDir({ MARVIN_USAGE_DIR: "/explicit" }, "/cwd"), "/explicit");
  assert.equal(
    resolveUsageDir({ CLAUDE_PROJECT_DIR: "/project" }, "/cwd"),
    join("/project", ".marvin", "usage"),
  );
  assert.equal(resolveUsageDir({}, "/cwd"), join("/cwd", ".marvin", "usage"));
  // MARVIN_USAGE_DIR outranks the project dir, exactly as the server resolves it.
  assert.equal(
    resolveUsageDir({ MARVIN_USAGE_DIR: "/explicit", CLAUDE_PROJECT_DIR: "/project" }, "/cwd"),
    "/explicit",
  );
});

// ── the two axes stay apart ─────────────────────────────────────────────────

test("a name in both namespaces is credited only to the axis that logged it", () => {
  const events = parseEvents(
    [
      line("2026-08-01T00:00:00.000Z", "prompt", "help"),
      line("2026-08-01T00:00:01.000Z", "prompt", "help"),
    ].join("\n"),
  );
  const prompts = axisSurface(["help", "commit"], events, "prompt", NOW);
  const tools = axisSurface(["help", "verify"], events, "tool", NOW);

  assert.deepEqual(
    prompts.invoked.map((e) => e.name),
    ["help"],
  );
  assert.deepEqual(prompts.never, ["commit"]);
  // The prompt invocations must NOT make the `help` TOOL look used.
  assert.deepEqual(tools.invoked, []);
  assert.deepEqual(tools.never, ["help", "verify"]);
});

test("axisSurface counts calls, distinct days and last-seen, least recent first", () => {
  const events = parseEvents(
    [
      line("2026-08-01T00:00:00.000Z", "tool", "spread"),
      line("2026-08-02T00:00:00.000Z", "tool", "spread"),
      line("2026-08-10T00:00:00.000Z", "tool", "burst"),
      line("2026-08-10T00:00:01.000Z", "tool", "burst"),
    ].join("\n"),
  );
  const axis = axisSurface(["burst", "spread", "silent"], events, "tool", NOW);

  assert.deepEqual(
    axis.invoked.map((e) => [e.name, e.calls, e.days, e.ageDays]),
    [
      // Least recently seen first, so the row nearest to dead is at the top.
      ["spread", 2, 2, 11],
      // Two calls one second apart are one day, which is what makes a sweep visible.
      ["burst", 2, 1, 3],
    ],
  );
  assert.deepEqual(axis.never, ["silent"]);
  assert.equal(axis.declared, 3);
});

test("logged names the registry no longer declares are reported apart from dead surface", () => {
  const events = parseEvents(
    [
      line("2026-08-01T00:00:00.000Z", "prompt", "kanban-list"),
      line("2026-08-02T00:00:00.000Z", "prompt", "kanban-list"),
      line("2026-08-02T00:00:00.000Z", "prompt", "track-list"),
    ].join("\n"),
  );
  const axis = axisSurface(["track-list", "track-move"], events, "prompt", NOW);

  assert.deepEqual(axis.never, ["track-move"]);
  assert.deepEqual(
    axis.unknown.map((e) => [e.name, e.calls]),
    [["kanban-list", 2]],
  );
});

test("a timestamp that is a string but not a date costs the age, not the run", () => {
  const events = parseEvents(line("yesterday", "tool", "verify"));
  const axis = axisSurface(["verify"], events, "tool", NOW);
  assert.equal(axis.invoked[0].calls, 1);
  assert.equal(axis.invoked[0].ageDays, null);
});

// ── the observation window ──────────────────────────────────────────────────

test("observationWindow reports the period, activity days and the busiest day", () => {
  const events = parseEvents(
    [
      line("2026-08-01T00:00:00.000Z", "prompt", "a"),
      line("2026-08-03T00:00:00.000Z", "prompt", "b"),
      line("2026-08-03T00:00:01.000Z", "prompt", "c"),
      line("2026-08-03T00:00:02.000Z", "prompt", "d"),
    ].join("\n"),
  );
  const window = observationWindow(events, NOW);

  assert.equal(window.from, "2026-08-01T00:00:00.000Z");
  assert.equal(window.to, "2026-08-03T00:00:02.000Z");
  assert.equal(window.events, 4);
  assert.equal(window.activeDays, 2);
  assert.equal(window.spanDays, 3);
  assert.equal(window.ageDays, 10);
  assert.deepEqual(window.busiest, { day: "2026-08-03", count: 3 });
});

test("an empty log has no window at all", () => {
  assert.equal(observationWindow([], NOW), null);
});

// ── the report itself ───────────────────────────────────────────────────────

test("an empty log reads as unobserved, never as unused", () => {
  const text = renderReport({
    usageDir: "/tmp/none/.marvin/usage",
    present: [],
    secondLog: { path: "/repo/plugins/marvin/mcp/server/.marvin/usage", exists: false },
    window: observationWindow([], NOW),
    prompts: axisSurface(["commit"], [], "prompt", NOW),
    tools: axisSurface(["verify"], [], "tool", NOW),
  });

  assert.match(text, /NEITHER FILE PRESENT/);
  assert.match(text, /no event has been recorded here/);
  assert.match(text, /NOT the same as unused/);
});

test("the report names the log it read and the second log it did not", () => {
  const text = renderReport({
    usageDir: "/repo/.marvin/usage",
    present: ["events.jsonl"],
    secondLog: { path: "/repo/plugins/marvin/mcp/server/.marvin/usage", exists: true },
    window: observationWindow(parseEvents(line("2026-08-01T00:00:00.000Z", "tool", "verify")), NOW),
    prompts: axisSurface(["commit"], [], "prompt", NOW),
    tools: axisSurface(["verify"], [], "tool", NOW),
  });

  assert.match(text, /Log read\s+\/repo\/\.marvin\/usage/);
  assert.match(text, /Not read\s+\/repo\/plugins\/marvin\/mcp\/server\/\.marvin\/usage/);
  assert.match(text, /cwd is the server package/);
});

test("wrap breaks a long list without dropping or duplicating an item", () => {
  const items = ["alpha (1)", "beta (2)", "gamma (3)", "delta (4)"];
  const lines = wrap(items, 24);
  assert.ok(lines.every((l) => l.length <= 24 || !l.includes(", ")));
  assert.deepEqual(lines.join(" ").split(", "), items);
});

// ── the declared surface comes from source, never from a live server ─────────

test("loadToolNames finds every declared tool, taking the name after defineTool", () => {
  const names = loadToolNames();
  // `verify.ts` declares an unrelated `name` field well above its defineTool call — a reader
  // that took the first match in the file would report a gate name here instead.
  for (const expected of ["task", "task-detail", "tracker", "verify", "spec", "report"]) {
    assert.ok(names.includes(expected), `missing tool: ${expected}`);
  }
  assert.equal(new Set(names).size, names.length, "tool names must be unique");
});

test("the script never drives the built server, which would log its own measurement", () => {
  // Spawning `dist/server.js` to enumerate prompts writes one event per resolution into the log
  // being measured. Importing no process API at all is the property that forecloses it; the
  // bundle path appears in this file only inside the docblock that explains why.
  const source = readFileSync(join(repoRoot, "scripts", "usage-surface.mjs"), "utf8");
  assert.ok(!/from "node:child_process"/.test(source), "usage-surface must spawn nothing");
  assert.ok(!/\bspawn\w*\(/.test(source), "usage-surface must spawn nothing");
});

test("buildReport runs end to end against a fixture log and stays a report", async () => {
  const dir = makeUsageDir({
    "events.jsonl": line("2026-08-10T00:00:00.000Z", "tool", "verify") + "\n",
    "events.jsonl.1": line("2026-07-01T00:00:00.000Z", "prompt", "commit") + "\n",
  });
  try {
    const text = await buildReport({ MARVIN_USAGE_DIR: dir }, repoRoot, NOW);
    assert.match(text, /PROMPTS — \d+ declared/);
    assert.match(text, /TOOLS — \d+ declared/);
    assert.match(text, /Window\s+2026-07-01/);
    // Both generations reached the axes.
    assert.match(text, /commit\s+last 2026-07-01/);
    assert.match(text, /verify\s+last 2026-08-10/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the isolation this measurement depends on ───────────────────────────────

test("the smoke test spawns the server with a scrubbed env and a throwaway usage dir", () => {
  // A text assertion on purpose: proving it behaviourally means building `dist/` and driving a
  // full smoke run, and the property that matters is a two-line wiring decision. Removing
  // either line makes every future smoke run write 53 prompt events into the measured log.
  const source = readFileSync(join(repoRoot, "scripts", "smoke-commands.mjs"), "utf8");
  assert.match(source, /import \{ hermeticEnv \}/, "smoke must reuse the hermetic env rule");
  assert.match(
    source,
    /env: hermeticEnv\(process\.env, \{ MARVIN_USAGE_DIR: usageDir \}\)/,
    "the spawned server must write its usage events to the throwaway directory",
  );
  assert.match(source, /mkdtempSync/, "the throwaway directory must be a temp directory");
  assert.match(source, /rmSync/, "the throwaway directory must be removed");
});
