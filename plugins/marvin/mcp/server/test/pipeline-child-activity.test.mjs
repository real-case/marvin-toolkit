import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";

/**
 * `child-activity.ts`: the call a running child is in, read from its `stream-json` log, and the
 * status line the engine writes when the child has been quiet. Its use in `waitChild` is in
 * pipeline-runtime.test.mjs.
 */

const a = await importTs("src/pipeline/child-activity.ts");

const use = (id, name, input, parent = null) =>
  JSON.stringify({
    type: "assistant",
    parent_tool_use_id: parent,
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
const result = (id, parent = null) =>
  JSON.stringify({
    type: "user",
    parent_tool_use_id: parent,
    message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] },
  });

test("the newest top-level call without a result is the one in flight", () => {
  const log = [
    use("t1", "Read", { file_path: "src/a.mjs" }),
    result("t1"),
    use("t2", "Bash", { command: "npm test", description: "Run the suite" }),
  ].join("\n");
  assert.deepEqual(a.pendingToolCall(log), { tool: "Bash", detail: "Run the suite" });
  assert.equal(a.pendingToolCall(`${log}\n${result("t2")}\n`), null);
  assert.equal(a.pendingToolCall(""), null);
});

test("a subagent's own calls are skipped; its Task call is the one in flight", () => {
  const log = [
    use("t1", "Task", { description: "Review the diff", prompt: "…" }),
    use("s1", "Grep", { pattern: "x" }, "t1"),
    result("s1", "t1"),
    use("s2", "Read", { file_path: "b" }, "t1"),
  ].join("\n");
  assert.deepEqual(a.pendingToolCall(log), { tool: "Task", detail: "Review the diff" });
});

test("a half-written last line and foreign lines are skipped; a long detail is cut to one line", () => {
  const long = `node --test ${"x".repeat(300)}\n  --flag`;
  const log = [
    JSON.stringify({ type: "system", subtype: "init" }),
    use("t1", "Bash", { command: long }),
    '{"type":"user","message":{"content":[{"type":"tool_res',
  ].join("\n");
  const call = a.pendingToolCall(log);
  assert.equal(call.tool, "Bash");
  assert.equal(call.detail.length, 100);
  assert.ok(!call.detail.includes("\n"));
  assert.ok(call.detail.endsWith("…"));
});

test("readLogTail reads the end of a long log from a line boundary, and null for no log", () => {
  const dir = mkdtempSync(join(tmpdir(), "child-activity-"));
  const path = join(dir, "c.log.jsonl");
  const filler = `${JSON.stringify({ type: "system", pad: "y".repeat(1000) })}\n`.repeat(700);
  writeFileSync(path, `${filler}${use("t9", "Bash", { command: "npm test" })}\n`);
  const tail = a.readLogTail(path);
  assert.ok(tail.text.length < 600 * 1024);
  assert.ok(tail.text.startsWith("{"), "the partial first line is dropped");
  assert.deepEqual(a.pendingToolCall(tail.text), { tool: "Bash", detail: "npm test" });
  assert.equal(typeof tail.mtimeMs, "number");
  assert.equal(a.readLogTail(join(dir, "none.log.jsonl")), null);
});

test("the status line names the child, its run time, its silence and its call", () => {
  const min = 60_000;
  assert.equal(
    a.statusLine("r1-executor-1", 26 * min, 7 * min, { tool: "Bash", detail: "npm test" }, 6 * min),
    "r1-executor-1 still running after 26 min, no report for 7 min; in Bash (npm test) for at least 6 min",
  );
  assert.equal(
    a.statusLine("r1-executor-1", 10 * min, 6 * min, null, 2 * min),
    "r1-executor-1 still running after 10 min, no report for 6 min; no tool call in flight, log idle 2 min",
  );
  assert.equal(
    a.statusLine("r1-planner-0", 6 * min, 6 * min, { tool: "Task", detail: null }, null),
    "r1-planner-0 still running after 6 min, no report for 6 min; in Task",
  );
});
