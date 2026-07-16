import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir, platform } from "node:os";
import { withSession } from "./_driver.mjs";

// End-to-end coverage for the usage-log middleware (ADR-0030 / WP7). Every case
// drives the built stdio server against a throwaway project dir — never the
// repo's own `.marvin/` — and inspects `.marvin/usage/events.jsonl`. The four
// guarantees each get a test: self-ignoring dir, rotation, kill-switch,
// fail-open.

/** Env that pins every `.marvin/*` path under `dir` (test isolation). */
function envFor(dir, extra = {}) {
  return {
    CLAUDE_PROJECT_DIR: dir,
    MARVIN_TASKS_DIR: join(dir, ".marvin", "track"),
    MARVIN_TASKS_CONFIG: join(dir, ".marvin", "config.json"),
    MARVIN_MEMORY_DIR: join(dir, ".marvin", "memory"),
    MARVIN_HANDOFF_DIR: join(dir, ".marvin", "handoff"),
    MARVIN_USAGE_DIR: join(dir, ".marvin", "usage"),
    ...extra,
  };
}

/**
 * Run one JSON-RPC session against a fresh server process. `calls` is the list
 * of `{ method, params }` requests to issue after `initialize`, in order;
 * resolves with the array of their results. Each request is sent only after the
 * previous reply arrives, so the server's per-request work (incl. the usage
 * write) is ordered and complete before the process is killed.
 */
function session(dir, calls, extraEnv = {}) {
  return withSession({ env: envFor(dir, extraEnv) }, async (s) => {
    const results = [];
    for (const call of calls) {
      results.push(await s.request(call.method, call.params).catch((error) => ({ error })));
    }
    return results;
  });
}

const eventsPath = (dir) => join(dir, ".marvin", "usage", "events.jsonl");

/** Parse `events.jsonl` into an array of objects (well-formed lines only). */
function readEvents(dir) {
  const path = eventsPath(dir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

test("a tool call and a prompt get each append exactly one event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-usage-"));
  try {
    await session(dir, [
      { method: "tools/call", params: { name: "help", arguments: {} } },
      { method: "prompts/get", params: { name: "commit", arguments: {} } },
    ]);
    const events = readEvents(dir);
    assert.equal(events.length, 2, "two events written");

    const tool = events.find((e) => e.kind === "tool");
    const prompt = events.find((e) => e.kind === "prompt");
    assert.deepEqual({ kind: tool.kind, name: tool.name }, { kind: "tool", name: "help" });
    assert.deepEqual(
      { kind: prompt.kind, name: prompt.name },
      {
        kind: "prompt",
        name: "commit",
      },
    );

    // event shape is minimal: ts + kind + name only, no arguments/payload/PII
    for (const e of events) {
      assert.deepEqual(Object.keys(e).sort(), ["kind", "name", "ts"]);
      // ts is an ISO string the dashboard reader can compare lexicographically
      assert.equal(typeof e.ts, "string");
      assert.ok(!Number.isNaN(Date.parse(e.ts)), `ts is a valid timestamp: ${e.ts}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guarantee 1 — the usage dir self-ignores: .gitignore is `*`", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-usage-"));
  try {
    await session(dir, [{ method: "tools/call", params: { name: "help", arguments: {} } }]);
    const gitignore = join(dir, ".marvin", "usage", ".gitignore");
    assert.ok(existsSync(gitignore), ".gitignore created on first write");
    assert.equal(readFileSync(gitignore, "utf8").trim(), "*");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guarantee 1 — a host-customised .gitignore is left untouched (idempotent)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-usage-"));
  try {
    // pre-seed the dir with a custom .gitignore; the logger must not overwrite it
    mkdirSync(join(dir, ".marvin", "usage"), { recursive: true });
    const gitignore = join(dir, ".marvin", "usage", ".gitignore");
    writeFileSync(gitignore, "# custom\nevents.jsonl*\n");
    await session(dir, [{ method: "tools/call", params: { name: "help", arguments: {} } }]);
    assert.equal(readFileSync(gitignore, "utf8"), "# custom\nevents.jsonl*\n");
    // and the event still landed
    assert.equal(readEvents(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guarantee 3 — the kill-switch (usage.enabled:false) suppresses all writes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-usage-"));
  try {
    mkdirSync(join(dir, ".marvin"), { recursive: true });
    // a foreign key alongside the switch — it must survive (config is read-only here)
    const configPath = join(dir, ".marvin", "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ base_branch: "main", usage: { enabled: false }, custom_foreign: 42 }),
    );
    await session(dir, [
      { method: "tools/call", params: { name: "help", arguments: {} } },
      { method: "prompts/get", params: { name: "commit", arguments: {} } },
    ]);
    // nothing written — not even the directory
    assert.ok(!existsSync(join(dir, ".marvin", "usage")), "usage dir not created when disabled");
    assert.ok(!existsSync(eventsPath(dir)), "no events file when disabled");
    // the logger never touches config.json
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {
      base_branch: "main",
      usage: { enabled: false },
      custom_foreign: 42,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guarantee 3 — usage.enabled:true logs (opt-out default confirmed by contrast)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-usage-"));
  try {
    mkdirSync(join(dir, ".marvin"), { recursive: true });
    writeFileSync(
      join(dir, ".marvin", "config.json"),
      JSON.stringify({ usage: { enabled: true } }),
    );
    await session(dir, [{ method: "tools/call", params: { name: "help", arguments: {} } }]);
    assert.equal(readEvents(dir).length, 1, "explicit enable logs");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guarantee 2 — the log rotates past the cap, keeping one generation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-usage-"));
  try {
    // Pre-fill events.jsonl just over the 1 MiB cap so the next append rotates.
    const usageDir = join(dir, ".marvin", "usage");
    mkdirSync(usageDir, { recursive: true });
    const path = join(usageDir, "events.jsonl");
    const filler =
      JSON.stringify({ ts: "2026-07-01T00:00:00.000Z", kind: "tool", name: "seed" }) + "\n";
    // ~1 MiB + a bit: repeat the filler line until we exceed the cap
    const times = Math.ceil((1024 * 1024 + 1) / filler.length);
    writeFileSync(path, filler.repeat(times));
    const beforeSize = statSync(path).size;
    assert.ok(beforeSize >= 1024 * 1024, "seed file is over the cap");

    // one more call triggers rotation, then writes a single fresh event
    await session(dir, [{ method: "tools/call", params: { name: "help", arguments: {} } }]);

    const rotated = join(usageDir, "events.jsonl.1");
    assert.ok(existsSync(rotated), "previous generation rotated to events.jsonl.1");
    assert.equal(statSync(rotated).size, beforeSize, "rotated file is the old content, intact");

    const fresh = readEvents(dir);
    assert.equal(fresh.length, 1, "fresh log holds only the post-rotation event");
    assert.deepEqual({ kind: fresh[0].kind, name: fresh[0].name }, { kind: "tool", name: "help" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Fail-open: an unwritable usage dir must not fail the tool call. chmod 0 is a
// no-op for root and unreliable on Windows, so skip there — the guarantee still
// holds, it just can't be provoked this way.
const canDenyWrites =
  platform() !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0;

test(
  "guarantee 4 — a logger failure (unwritable dir) does not fail the tool call",
  { skip: canDenyWrites ? false : "cannot simulate an unwritable dir here" },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "marvin-usage-"));
    try {
      // make .marvin/usage exist but read-only so appendFileSync throws EACCES
      const usageDir = join(dir, ".marvin", "usage");
      mkdirSync(usageDir, { recursive: true });
      chmodSync(usageDir, 0o500); // r-x, no write

      const [result] = await session(dir, [
        { method: "tools/call", params: { name: "help", arguments: {} } },
      ]);

      // the tool call still succeeded — a real result, no error surfaced
      assert.ok(result && Array.isArray(result.content), "tool returned a normal result");
      assert.ok(!result.isError, "tool call did not error despite the logging failure");
      const text = result.content.map((c) => c.text).join("\n");
      assert.ok(text.length > 0, "tool produced its normal output");

      // and no events file was created (the write failed, swallowed)
      chmodSync(usageDir, 0o700); // restore so cleanup/read can proceed
      assert.ok(
        !existsSync(eventsPath(dir)),
        "no events file — the write failed and was swallowed",
      );
    } finally {
      // ensure the dir is writable before rm
      try {
        chmodSync(join(dir, ".marvin", "usage"), 0o700);
      } catch {
        // best effort
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("the dashboard renders the log the middleware produced (producer↔reader)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-usage-"));
  try {
    // generate real events via the middleware, then read them back via dashboard
    const results = await session(dir, [
      { method: "tools/call", params: { name: "help", arguments: {} } },
      { method: "prompts/get", params: { name: "commit", arguments: {} } },
      { method: "prompts/get", params: { name: "commit", arguments: {} } },
      { method: "tools/call", params: { name: "dashboard", arguments: {} } },
    ]);
    const dashboard = results[3];
    const text = dashboard.content.map((c) => c.text).join("\n");

    assert.ok(text.includes("## Usage"), "usage section rendered");
    // 4 events by the time dashboard runs: help, commit, commit, dashboard(itself)
    assert.match(text, /- 4 event\(s\)/);
    assert.match(text, /`commit` \(prompt\) ×2/);

    const sc = dashboard.structuredContent;
    assert.ok(sc.usage, "usage present in structuredContent");
    assert.equal(sc.usage.events, 4);
    const commit = sc.usage.top.find((t) => t.name === "commit");
    assert.deepEqual(commit, { kind: "prompt", name: "commit", count: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
