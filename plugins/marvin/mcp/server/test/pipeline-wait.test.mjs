import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
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
