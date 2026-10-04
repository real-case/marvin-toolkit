import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";

const wait = await importTs("src/pipeline/wait.ts");
const launch = await importTs("src/pipeline/launch.ts");
const ok = (structured, extra = {}) => ({
  type: "result",
  session_id: "s1",
  is_error: false,
  total_cost_usd: 0.42,
  duration_ms: 61_000,
  usage: { cache_read_input_tokens: 1200 },
  structured_output: structured,
  ...extra,
});

test("the last result event wins over earlier stream lines", () => {
  const log = [
    '{"type":"system"}',
    JSON.stringify(ok({ status: "done" })),
    '{"type":"assistant"',
  ].join("\n");
  assert.equal(wait.lastResultEvent(log).session_id, "s1");
});

test("classification covers every terminal state", () => {
  const c = (exitCode, result, idleMs = 0) =>
    wait.classify({ exitCode, result, idleMs, stallMs: 900_000 }).outcome;
  assert.equal(c(null, null), "running");
  assert.equal(c(null, null, 900_000), "stalled");
  assert.equal(c(3, null), "crashed");
  assert.equal(
    c(1, { type: "result", is_error: true, api_error_status: 429, result: "Usage limit reached" }),
    "limited",
  );
  assert.equal(
    c(1, { type: "result", is_error: true, subtype: "error_during_execution" }),
    "failed",
  );
  assert.equal(c(0, ok(undefined)), "crashed");
  assert.equal(c(0, ok({ status: "needs_input", questions: [] })), "needs_input");
  assert.equal(c(0, ok({ status: "spec_ready" })), "spec_ready");
  assert.equal(c(0, ok({ status: "done" })), "done");
});

test("cache reads are reported for the D13 measurement", () => {
  assert.equal(
    wait.classify({ exitCode: 0, result: ok({ status: "done" }), idleMs: 0, stallMs: 1 })
      .cacheReadTokens,
    1200,
  );
});

test("a detached child's result is picked up after it exits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-"));
  const line = JSON.stringify(ok({ status: "done", summary: "ok" }));
  launch.launchDetached(
    { argv: [process.execPath, "-e", `console.log(${JSON.stringify(line)})`], env: {}, cwd: dir },
    dir,
    "r1-executor-1",
  );
  const r = await wait.waitForChild({
    runDir: dir,
    name: "r1-executor-1",
    pollMs: 50,
    stallMs: 60_000,
    deadlineMs: 10_000,
  });
  assert.equal(r.outcome, "done");
  assert.match(
    wait.summaryLine("r1-executor-1", r),
    /^CHILD r1-executor-1 outcome=done cost=\$0\.42 dur=1m session=s1/,
  );
});

test("a result line counts as finished even if the exit file never appears (S6)", () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-"));
  writeFileSync(
    join(dir, "r1-executor-1.log.jsonl"),
    `${JSON.stringify(ok({ status: "done" }))}\n`,
  );
  assert.equal(
    wait.classify({ ...wait.readChildState(dir, "r1-executor-1", Date.now()), stallMs: 900_000 })
      .outcome,
    "done",
  );
});

test("TERM on the wrapper reaches the child and the exit code is still written (S6)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-"));
  const { pid } = launch.launchDetached(
    {
      argv: [
        process.execPath,
        "-e",
        "process.on('SIGTERM', () => process.exit(143)); setTimeout(() => {}, 60000)",
      ],
      env: {},
      cwd: dir,
    },
    dir,
    "r1-executor-2",
  );
  await new Promise((r) => setTimeout(r, 300));
  process.kill(pid, "SIGTERM");
  const r = await wait.waitForChild({
    runDir: dir,
    name: "r1-executor-2",
    pollMs: 50,
    stallMs: 60_000,
    deadlineMs: 10_000,
  });
  assert.equal(r.outcome, "crashed");
  assert.match(r.detail, /exit 143/);
});

test("a child that dies without a result is reported as crashed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-"));
  launch.launchDetached(
    { argv: [process.execPath, "-e", "process.exit(3)"], env: {}, cwd: dir },
    dir,
    "r1-verifier-1",
  );
  const r = await wait.waitForChild({
    runDir: dir,
    name: "r1-verifier-1",
    pollMs: 50,
    stallMs: 60_000,
    deadlineMs: 10_000,
  });
  assert.equal(r.outcome, "crashed");
  assert.match(r.detail, /exit 3/);
});

test("spawn failure with nonexistent cwd throws cleanly and does not crash the process", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-"));
  const badCwd = join(dir, "nonexistent", "path");
  let thrown = false;
  try {
    launch.launchDetached(
      { argv: [process.execPath, "-e", "console.log('hi')"], env: {}, cwd: badCwd },
      dir,
      "r1-bad-1",
    );
  } catch (e) {
    thrown = true;
    assert.match(String(e), /failed to launch r1-bad-1/);
  }
  assert.ok(thrown, "should have thrown");
  // Verify process survives and can continue (no uncaught exception)
  await new Promise((r) => setImmediate(r));
});

test("wrapper re-wait ensures the correct exit code is captured (S6)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pipe-"));
  const { pid } = launch.launchDetached(
    {
      argv: [
        process.execPath,
        "-e",
        "process.on('SIGTERM', () => setTimeout(() => process.exit(7), 1500)); setTimeout(() => {}, 60000)",
      ],
      env: {},
      cwd: dir,
    },
    dir,
    "r1-executor-3",
  );
  await new Promise((r) => setTimeout(r, 300));
  process.kill(pid, "SIGTERM");
  // Exit file should not exist yet (child still running, delayed exit)
  const exitPathExists = existsSync(join(dir, "r1-executor-3.exit"));
  assert.equal(exitPathExists, false, "exit file should not exist at 300ms (child still running)");
  const r = await wait.waitForChild({
    runDir: dir,
    name: "r1-executor-3",
    pollMs: 50,
    stallMs: 60_000,
    deadlineMs: 10_000,
  });
  assert.equal(r.outcome, "crashed");
  assert.match(r.detail, /exit 7/);
});
