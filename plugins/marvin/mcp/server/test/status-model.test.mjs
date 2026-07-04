import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { withSession } from "./_driver.mjs";

/** The D2 example vocabulary from the kanban-rework plan (ADR-0026). */
const CUSTOM_STATUSES = [
  { key: "backlog", role: "todo" },
  { key: "in-progress", role: "wip", tracker_status: "In Progress" },
  { key: "code-review", role: "review", tracker_status: "In Review" },
  { key: "qa", role: "review", tracker_status: "QA" },
  { key: "done", role: "done", tracker_status: "Done" },
  { key: "blocked", role: "blocked" },
];

function seedTask(tasksDir, { id = "001", status = "todo", branch = `${id}--seeded-task` } = {}) {
  mkdirSync(tasksDir, { recursive: true });
  const md = [
    "---",
    `id: "${id}"`,
    "type: bug",
    `status: ${status}`,
    `title: Seeded task ${id}`,
    `branch: ${branch}`,
    'created: "2026-06-20T10:00:00.000Z"',
    'updated: "2026-06-20T10:00:00.000Z"',
    "---",
    "",
    "Body.",
    "",
  ].join("\n");
  writeFileSync(join(tasksDir, `${branch}.md`), md);
  return branch;
}

/**
 * Drive the live server over stdio: run the given tools/call requests in
 * order, answering every elicitation/create with `acceptContent` (or
 * cancelling when none is provided). Returns the tools/call results.
 */
function callSequence(env, calls, acceptContent = null) {
  return withSession(
    {
      env,
      capabilities: { elicitation: {} },
      onServerRequest: () =>
        acceptContent ? { action: "accept", content: acceptContent } : { action: "cancel" },
    },
    async (s) => {
      const results = [];
      for (const params of calls) {
        results.push(await s.request("tools/call", params));
      }
      return results;
    },
  );
}

/** A project dir with a .marvin/config.json carrying the custom status set. */
function customProject() {
  const dir = mkdtempSync(join(tmpdir(), "marvin-status-"));
  mkdirSync(join(dir, ".marvin"), { recursive: true });
  writeFileSync(join(dir, ".marvin", "config.json"), JSON.stringify({ statuses: CUSTOM_STATUSES }));
  return dir;
}

test("configured statuses flow through list: {key, role} cards, open counts, role roll-up", async () => {
  const dir = customProject();
  const tasksDir = join(dir, ".marvin", "kanban");
  try {
    seedTask(tasksDir, { id: "001", status: "qa" });
    seedTask(tasksDir, { id: "002", status: "backlog" });

    const [list] = await callSequence({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "list" } },
    ]);

    const sc = list.structuredContent;
    assert.equal(sc.tasks.length, 2);
    const qa = sc.tasks.find((t) => t.id === "001");
    assert.deepEqual(qa.status, { key: "qa", role: "review" });

    // open per-key record: every configured key present, even at 0
    assert.deepEqual(sc.counts, {
      backlog: 1,
      "in-progress": 0,
      "code-review": 0,
      qa: 1,
      done: 0,
      blocked: 0,
    });
    assert.deepEqual(sc.role_counts, { todo: 1, wip: 0, review: 1, done: 0, blocked: 0 });

    // the text table groups by key, role priority first (review before todo)
    const text = list.content.map((c) => c.text).join("\n");
    assert.match(text, /### qa \(1\)[\s\S]*### backlog \(1\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a status key outside the configured set goes to the malformed channel", async () => {
  const dir = customProject();
  const tasksDir = join(dir, ".marvin", "kanban");
  try {
    seedTask(tasksDir, { id: "001", status: "qa" });
    seedTask(tasksDir, { id: "002", status: "weird" });

    const [list] = await callSequence({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "list" } },
    ]);

    assert.equal(list.structuredContent.tasks.length, 1, "unknown-status task excluded");
    const text = list.content.map((c) => c.text).join("\n");
    assert.match(text, /⚠ 1 malformed file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("review targets the first review-role status and detects the branch-linked task", async () => {
  const dir = customProject();
  const tasksDir = join(dir, ".marvin", "kanban");
  try {
    const branch = seedTask(tasksDir, { id: "001", status: "in-progress" });
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["checkout", "-q", "-b", branch], { cwd: dir });

    const [review] = await callSequence({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "review" } },
    ]);

    // no elicitation needed (branch-linked); target = first review-role status
    const text = review.content.map((c) => c.text).join("\n");
    assert.match(text, /Moved \*\*001\*\* to \*\*code-review\*\*/);
    const onDisk = readFileSync(join(tasksDir, `${branch}.md`), "utf8");
    assert.match(onDisk, /status: code-review/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("move reaches any configured status — blocked becomes reachable (finding 5)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-status-"));
  const tasksDir = join(dir, ".marvin", "kanban");
  try {
    seedTask(tasksDir, { id: "001", status: "todo" });

    const [move] = await callSequence(
      { CLAUDE_PROJECT_DIR: dir },
      [{ name: "task", arguments: { action: "move", taskId: "001" } }],
      { status: "blocked" }, // answers the target-status elicitation
    );

    const text = move.content.map((c) => c.text).join("\n");
    assert.match(text, /Moved \*\*001\*\*/);
    assert.match(text, /`todo` → `blocked`/);
    const onDisk = readFileSync(join(tasksDir, "001--seeded-task.md"), "utf8");
    assert.match(onDisk, /status: blocked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("empty candidate sets get an honest answer, not 'Cancelled' (finding 8)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-status-"));
  const tasksDir = join(dir, ".marvin", "kanban");
  try {
    seedTask(tasksDir, { id: "001", status: "done" }); // nothing in wip/review-able state

    const [review] = await callSequence({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "review" } },
    ]);

    const text = review.content.map((c) => c.text).join("\n");
    assert.match(text, /No tasks in a wip-role status/);
    assert.doesNotMatch(text, /Cancelled/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("start with a preselected id respects the todo-role filter (finding 14)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-status-"));
  const tasksDir = join(dir, ".marvin", "kanban");
  try {
    seedTask(tasksDir, { id: "001", status: "done" });

    const [start] = await callSequence({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "start", taskId: "001" } },
    ]);

    assert.equal(start.isError, true);
    const text = start.content.map((c) => c.text).join("\n");
    assert.match(text, /todo-role status/);

    const onDisk = readFileSync(join(tasksDir, "001--seeded-task.md"), "utf8");
    assert.match(onDisk, /status: done/, "status unchanged");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("base_branch auto-detects from origin/HEAD when no config file exists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-status-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], {
      cwd: dir,
    });

    const [help] = await callSequence({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "help", arguments: {} },
    ]);

    assert.equal(help.structuredContent.config.base_branch, "main");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an invalid statuses config warns and falls back to the default set", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-status-"));
  const tasksDir = join(dir, ".marvin", "kanban");
  try {
    mkdirSync(join(dir, ".marvin"), { recursive: true });
    // no todo-role status — violates the role invariant
    writeFileSync(
      join(dir, ".marvin", "config.json"),
      JSON.stringify({
        statuses: [
          { key: "wip", role: "wip" },
          { key: "done", role: "done" },
        ],
      }),
    );
    seedTask(tasksDir, { id: "001", status: "todo" });

    const [list] = await callSequence({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "list" } },
    ]);

    // default vocabulary applies, so the seeded "todo" task parses fine
    assert.deepEqual(list.structuredContent.tasks[0].status, { key: "todo", role: "todo" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
