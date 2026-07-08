import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { withSession } from "./_driver.mjs";

const TITLE = "Wire structuredContent through task list";
const TRACKER = "OSI-42";

/**
 * Drive the live server: create one bug task (with a tracker id), then call the
 * `task` `list` action and return the raw `tools/call` result so the test can
 * assert the ADR-0024 `structuredContent` (TaskListPayload) the widget consumes —
 * not just the rendered text. A `.marvin/config.json` with a tracker template is
 * written first so `tracker_url` derivation is exercised end-to-end.
 */
function createThenListStructured(dir) {
  return withSession(
    {
      env: { CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_DIR: dir },
      capabilities: { elicitation: {} },
      onServerRequest: () => ({ action: "accept", content: { title: TITLE, tracker_id: TRACKER } }),
    },
    async (s) => {
      await s.request("tools/call", {
        name: "task",
        arguments: { action: "create", type: "bug" },
      });
      return s.request("tools/call", { name: "task", arguments: { action: "list" } });
    },
  );
}

test("task list emits a TaskListPayload structuredContent alongside the text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-sc-"));
  try {
    mkdirSync(join(dir, ".marvin"), { recursive: true });
    writeFileSync(
      join(dir, ".marvin", "config.json"),
      JSON.stringify({ tracker_url_template: "https://tracker.example/browse/{tracker_id}" }),
    );

    const result = await createThenListStructured(dir);

    // text surface still present (terminal fallback unchanged)
    const text = result.content.map((c) => c.text).join("\n");
    assert.match(text, /# Tasks \(1\)/);

    // widget surface: the typed payload
    const sc = result.structuredContent;
    assert.ok(sc, "structuredContent present on the list result");
    assert.equal(sc.tasks.length, 1);
    // ADR-0026: counts is an open per-key record (every configured key present,
    // default set here) plus the closed per-role roll-up.
    assert.equal(sc.counts.todo, 1);
    assert.equal(sc.counts.wip, 0, "unused configured keys present at 0");
    assert.equal(sc.role_counts.todo, 1);
    assert.equal(sc.role_counts.wip, 0);

    const card = sc.tasks[0];
    assert.equal(card.id, "001");
    assert.equal(card.type, "bug");
    assert.deepEqual(card.status, { key: "todo", role: "todo" }, "status is {key, role}");
    assert.equal(card.title, TITLE);
    assert.equal(card.tracker_id, TRACKER);
    assert.equal(card.tracker_url, "https://tracker.example/browse/OSI-42");
    assert.equal(card.pr, null, "pr is null until PR-URL capture lands");
    assert.equal(typeof card.branch, "string");
    assert.ok(card.created && card.updated, "timestamps present");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
