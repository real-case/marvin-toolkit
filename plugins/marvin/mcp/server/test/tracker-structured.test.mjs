import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { withSession } from "./_driver.mjs";

/** Create a task (optionally with a tracker id) via the task tool; return its id. */
async function createTask(s, { type, title, tracker_id }) {
  const args = { action: "create", type, title };
  if (tracker_id) args.tracker_id = tracker_id;
  const res = await s.request("tools/call", { name: "task", arguments: args });
  const text = res.content.map((c) => c.text).join("\n");
  return text.match(/\*\*(\d{3})\*\*/)?.[1];
}

test("tracker tool emits a TrackerListPayload of only tracker-bearing tasks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-tracker-"));
  try {
    await withSession({ env: { CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_DIR: dir } }, async (s) => {
      const tracked = await createTask(s, {
        type: "bug",
        title: "Fix login timeout",
        tracker_id: "OSI-101",
      });
      const untracked = await createTask(s, { type: "chore", title: "Tidy build scripts" });
      assert.equal(tracked, "001", "first task created as 001");
      assert.equal(untracked, "002", "second task created as 002");

      const res = await s.request("tools/call", { name: "tracker", arguments: {} });

      // text fallback present (terminal path), listing only the tracked task
      const text = res.content.map((c) => c.text).join("\n");
      assert.match(text, /Tracked tasks \(1\)/);
      assert.match(text, /OSI-101/);
      assert.doesNotMatch(text, /Tidy build scripts/, "the untracked task is absent from the text");

      // widget surface: the typed TrackerListPayload — only the tracker-bearing task
      const sc = res.structuredContent;
      assert.ok(sc, "structuredContent present on the tracker result");
      assert.equal(sc.tasks.length, 1, "only the tracker-bearing task is included");
      assert.equal(sc.tasks[0].id, "001");
      assert.equal(sc.tasks[0].tracker_id, "OSI-101");
      assert.equal(
        sc.tasks[0].tracker_url,
        null,
        "no template configured → derived tracker_url is null",
      );
      // the thin payload carries NO board counts (unlike TaskListPayload)
      assert.equal(sc.counts, undefined, "no per-key counts on a tracker payload");
      assert.equal(sc.role_counts, undefined, "no role roll-up on a tracker payload");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tracker tool returns an empty payload when no task carries a tracker id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-tracker-"));
  try {
    await withSession({ env: { CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_DIR: dir } }, async (s) => {
      await createTask(s, { type: "chore", title: "No tracker here" });

      const res = await s.request("tools/call", { name: "tracker", arguments: {} });
      const text = res.content.map((c) => c.text).join("\n");
      assert.match(text, /Tracked tasks \(0\)/);
      assert.match(text, /No tasks carry a tracker id/);

      const sc = res.structuredContent;
      assert.ok(sc, "structuredContent present even when empty");
      assert.deepEqual(sc.tasks, [], "empty tasks array — the board has no tracker ids");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
