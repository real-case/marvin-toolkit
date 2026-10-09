import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";

const wait = await importTs("src/pipeline/wait.ts");
const launch = await importTs("src/pipeline/launch.ts");

/**
 * How long a test waits for a node child, first to start and then to be classified. Each bound is
 * a ceiling, never a pause: the poll returns the moment the state it waits for is reached. It is
 * this wide because starting node is not cheap where these tests run: on a loaded machine one exec
 * can take seconds before the first line of its script runs, so a ten-second ceiling around a
 * child's whole life was a flake, not a check.
 */
const DEADLINE_MS = 60_000;

/**
 * The stall bound these waits pass, three ceilings wide so that it lies past the two a test can
 * spend. Its clock is the log file's mtime, which the wrapper's redirection creates when it forks
 * the child and which a child that prints nothing never touches again, so it runs over the child's
 * whole life from launch rather than over either phase. Equal to one ceiling, it capped both
 * phases together at that ceiling: a child slow to start was reported stalled before its second
 * ceiling had begun.
 */
const STALL_MS = 3 * DEADLINE_MS;

/**
 * Wait until a child has written `path`, which it does only after installing its SIGTERM handler.
 * The S6 tests used to signal after a fixed 300 ms, and a TERM that lands while node is still
 * starting meets the default disposition instead of the handler under test: the child dies with
 * 143 and the handler never runs. Nothing synchronises the wrapper's own trap with this file. The
 * trap is two builtins after the wrapper forks the child, while the child must exec node and run
 * its script before it writes the file, so in practice the wrapper is already trapping by then:
 * a margin of a node start, hundreds of milliseconds here, over two builtins, not a guarantee.
 */
async function untilReady(path) {
  const started = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - started >= DEADLINE_MS) {
      assert.fail(`the child did not signal readiness at ${path} within ${DEADLINE_MS} ms`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** A child script that installs `onTerm` as its SIGTERM handler, then says so through `ready`. */
const readyChild = (onTerm, ready) =>
  `process.on('SIGTERM', ${onTerm}); require('fs').writeFileSync(${JSON.stringify(ready)}, ''); setTimeout(() => {}, 60000)`;

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

test("a child's own failed status carries its stated reason, the one line a halt can show", () => {
  const c = (structured) =>
    wait.classify({ exitCode: 0, result: ok(structured), idleMs: 0, stallMs: 900_000 });
  const stated = c({ status: "failed", summary: "s", failure: "  no spec tool\n" });
  assert.deepEqual([stated.outcome, stated.detail], ["failed", "no spec tool"]);
  assert.equal(c({ status: "failed", summary: "s", failure: "x".repeat(500) }).detail.length, 200);
  // A reason that is not a string, or none at all, is no reason.
  assert.equal(c({ status: "failed", summary: "s", failure: 7 }).detail, "");
  assert.equal(c({ status: "failed", summary: "s" }).detail, "");
  // Only a failure says why; every other status keeps its empty detail.
  assert.equal(c({ status: "done", summary: "s", failure: "ignored" }).detail, "");
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
    stallMs: STALL_MS,
    deadlineMs: DEADLINE_MS,
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
  const ready = join(dir, "r1-executor-2.ready");
  const termed = join(dir, "r1-executor-2.termed");
  const onTerm = `() => { require('fs').writeFileSync(${JSON.stringify(termed)}, ''); process.exit(143); }`;
  const { pid } = launch.launchDetached(
    { argv: [process.execPath, "-e", readyChild(onTerm, ready)], env: {}, cwd: dir },
    dir,
    "r1-executor-2",
  );
  await untilReady(ready);
  process.kill(pid, "SIGTERM");
  const r = await wait.waitForChild({
    runDir: dir,
    name: "r1-executor-2",
    pollMs: 50,
    stallMs: STALL_MS,
    deadlineMs: DEADLINE_MS,
  });
  // The exit code cannot show that the TERM was forwarded: the wrapper's own wait returns 143 when
  // the TERM interrupts it, so a trap that forwards nothing records 143 as well. The marker, which
  // only the handler writes, is the evidence. The handler exits 143 for the converse reason: the
  // wrapper may record its interrupted wait's code or the child's, this test reads the same code
  // either way, and which of them it records is the re-wait test's subject. The wrapper writes the
  // exit file only after the child has ended, so the marker is on disk once the outcome is read.
  assert.ok(
    existsSync(termed),
    "the child's SIGTERM handler never ran: the TERM was not forwarded",
  );
  assert.equal(r.outcome, "crashed");
  assert.match(r.detail, /^exit 143,/);
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
    stallMs: STALL_MS,
    deadlineMs: DEADLINE_MS,
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
  const ready = join(dir, "r1-executor-3.ready");
  const { pid } = launch.launchDetached(
    {
      argv: [
        process.execPath,
        "-e",
        readyChild("() => setTimeout(() => process.exit(7), 1500)", ready),
      ],
      env: {},
      cwd: dir,
    },
    dir,
    "r1-executor-3",
  );
  await untilReady(ready);
  process.kill(pid, "SIGTERM");
  // The child outlives the TERM by 1.5 s, so no exit code can be on disk yet. The one that lands
  // later is written after the TERM interrupted the wrapper's first wait, so it is the re-wait's.
  const exitPathExists = existsSync(join(dir, "r1-executor-3.exit"));
  assert.equal(exitPathExists, false, "exit file should not exist yet (child still running)");
  const r = await wait.waitForChild({
    runDir: dir,
    name: "r1-executor-3",
    pollMs: 50,
    stallMs: STALL_MS,
    deadlineMs: DEADLINE_MS,
  });
  assert.equal(r.outcome, "crashed");
  assert.match(r.detail, /exit 7/);
});
