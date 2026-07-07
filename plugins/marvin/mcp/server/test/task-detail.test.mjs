import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { withSession, callTool } from "./_driver.mjs";

const TITLE = "Fix login timeout on slow networks";
const FENCE = "```";
// A markdown description with a heading, a list, and a fenced code block — so the
// stored body (the description wrapped in newlines) is a non-trivial body_markdown.
const DESCRIPTION = [
  "## Summary",
  "",
  "- throttle to 2G",
  "",
  FENCE,
  "await refresh();",
  FENCE,
].join("\n");

/** Create a bug task with a known markdown description, then call task-detail on it. */
function createThenDetail(dir) {
  return withSession({ env: { CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_DIR: dir } }, async (s) => {
    const created = await s.request("tools/call", {
      name: "task",
      arguments: { action: "create", type: "bug", title: TITLE, description: DESCRIPTION },
    });
    const createdText = created.content.map((c) => c.text).join("\n");
    const id = createdText.match(/\*\*(\d{3})\*\*/)?.[1];
    const detail = await s.request("tools/call", {
      name: "task-detail",
      arguments: { taskId: id },
    });
    return { id, detail };
  });
}

test("task-detail emits a TaskDetail structuredContent alongside the text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-td-"));
  try {
    const { id, detail } = await createThenDetail(dir);
    assert.equal(id, "001", "task was created with id 001");

    // text fallback present (terminal path unchanged)
    const text = detail.content.map((c) => c.text).join("\n");
    assert.match(text, /Fix login timeout on slow networks/);

    // widget surface: the typed TaskDetail payload
    const sc = detail.structuredContent;
    assert.ok(sc, "structuredContent present on the detail result");
    assert.equal(sc.id, "001");
    assert.equal(sc.type, "bug");
    assert.deepEqual(sc.status, { key: "todo", role: "todo" }, "status is {key, role}");
    assert.equal(sc.title, TITLE);
    assert.equal(typeof sc.branch, "string");
    assert.equal(sc.tracker_url, null, "no tracker template configured");
    assert.equal(sc.pr, null, "no PR linked");
    assert.ok(sc.created && sc.updated, "timestamps present");

    // body_markdown is the task file's body — the created description wrapped in
    // newlines (storage/tasks.ts), so it CONTAINS the description, not equals it.
    assert.equal(typeof sc.body_markdown, "string");
    assert.ok(sc.body_markdown.includes("## Summary"), "body_markdown contains the description");
    assert.ok(sc.body_markdown.includes("await refresh();"), "fenced code preserved in the body");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("task-detail returns an instructive isError for an unknown id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-td-"));
  try {
    const res = await callTool(
      "task-detail",
      { taskId: "999" },
      { env: { CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_DIR: dir } },
    );
    assert.equal(res.isError, true, "unknown id is an application-level error");
    const text = res.content.map((c) => c.text).join("\n");
    assert.match(text, /999/);
    assert.match(text, /not found/i);
    assert.equal(res.structuredContent, undefined, "no payload on an error");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
