import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { withSession } from "./_driver.mjs";

/**
 * Drive the live server over stdio (WP3 input contract): run the given
 * tools/call requests in order. Options:
 *   - elicitation: declare the client capability (default true). With false
 *     the server sees a host that cannot ask — the graceful-degradation path.
 *   - accept: content used to answer every elicitation/create (cancel if null).
 * Resolves to { results, elicitations } so tests can assert a flow ran with
 * NO elicitation round-trip, not just that it succeeded.
 */
async function drive(env, calls, { elicitation = true, accept = null } = {}) {
  let elicitations = 0;
  const results = await withSession(
    {
      env,
      capabilities: elicitation ? { elicitation: {} } : {},
      onServerRequest: () => {
        elicitations += 1;
        return accept ? { action: "accept", content: accept } : { action: "cancel" };
      },
    },
    async (s) => {
      const out = [];
      for (const params of calls) {
        out.push(await s.request("tools/call", params));
      }
      return out;
    },
  );
  return { results, elicitations };
}

const textOf = (result) => result.content.map((c) => c.text).join("\n");

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
  writeFileSync(join(tasksDir, `${id}--seeded-task.md`), md);
}

test("create with all fields as arguments runs with no elicitation round-trip", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-input-"));
  const tasksDir = join(dir, ".marvin", "track");
  try {
    const { results, elicitations } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      {
        name: "task",
        arguments: {
          action: "create",
          type: "bug",
          title: "Login timeout on slow networks",
          tracker_id: "OSI-123",
          description: "Repro: throttle to 3G, login, wait 30s.",
        },
      },
    ]);

    assert.equal(elicitations, 0, "no form was shown");
    const [create] = results;
    assert.notEqual(create.isError, true);
    assert.match(textOf(create), /Created task \*\*001\*\*/);

    const file = readFileSync(
      join(tasksDir, "001-OSI-123--login-timeout-on-slow-networks.md"),
      "utf8",
    );
    assert.match(file, /title: Login timeout on slow networks/);
    assert.match(file, /tracker_id: OSI-123/);
    // ADR-0019-aligned branch: <type-prefix>/<seq>[-<tracker>]--<slug>, bug → fix
    assert.match(file, /branch: fix\/001-OSI-123--login-timeout-on-slow-networks/);
    assert.match(file, /Repro: throttle to 3G/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("create with type+title only skips the form; optionals stay optional", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-input-"));
  const tasksDir = join(dir, ".marvin", "track");
  try {
    const { results, elicitations } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "create", type: "feature", title: "Dark mode" } },
    ]);

    assert.equal(elicitations, 0);
    assert.match(textOf(results[0]), /Created task \*\*001\*\*/);
    const file = readFileSync(join(tasksDir, "001--dark-mode.md"), "utf8");
    assert.match(file, /branch: feat\/001--dark-mode/, "feature → feat/ prefix");
    assert.doesNotMatch(file, /tracker_id:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("create validates argument values: bad tracker_id is an instructive isError", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-input-"));
  try {
    const { results, elicitations } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      {
        name: "task",
        arguments: { action: "create", type: "bug", title: "Valid title", tracker_id: "not-an-id" },
      },
    ]);

    assert.equal(elicitations, 0);
    assert.equal(results[0].isError, true);
    assert.match(textOf(results[0]), /tracker_id.*SHORT-123/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("move with a valid status argument skips the picker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-input-"));
  const tasksDir = join(dir, ".marvin", "track");
  try {
    seedTask(tasksDir, { id: "001", status: "todo" });

    const { results, elicitations } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "move", taskId: "001", status: "blocked" } },
    ]);

    assert.equal(elicitations, 0, "taskId + status arguments leave nothing to ask");
    assert.match(textOf(results[0]), /`todo` → `blocked`/);
    const onDisk = readFileSync(join(tasksDir, "001--seeded-task.md"), "utf8");
    assert.match(onDisk, /status: blocked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("move with an unknown status key lists the configured keys", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-input-"));
  const tasksDir = join(dir, ".marvin", "track");
  try {
    seedTask(tasksDir, { id: "001", status: "todo" });

    const { results } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "move", taskId: "001", status: "qa" } },
    ]);

    assert.equal(results[0].isError, true);
    assert.match(textOf(results[0]), /Unknown status key `qa`/);
    assert.match(textOf(results[0]), /todo, wip, review, done, blocked/);
    const onDisk = readFileSync(join(tasksDir, "001--seeded-task.md"), "utf8");
    assert.match(onDisk, /status: todo/, "status unchanged");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("host without elicitation: create missing title gets an instructive error, not a wire error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-input-"));
  const tasksDir = join(dir, ".marvin", "track");
  try {
    const { results, elicitations } = await drive(
      { CLAUDE_PROJECT_DIR: dir },
      [{ name: "task", arguments: { action: "create", type: "bug" } }],
      { elicitation: false },
    );

    assert.equal(elicitations, 0);
    assert.equal(results[0].isError, true);
    const text = textOf(results[0]);
    assert.match(text, /does not support interactive forms/);
    assert.match(text, /`title`/, "names exactly the argument to pass on retry");
    assert.doesNotMatch(text, /`type`/, "type was already supplied — not re-requested");
    assert.throws(() => readdirSync(tasksDir), /ENOENT/, "nothing was created");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("host without elicitation: argument-complete calls still work end to end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-input-"));
  const tasksDir = join(dir, ".marvin", "track");
  try {
    const { results, elicitations } = await drive(
      { CLAUDE_PROJECT_DIR: dir },
      [
        { name: "task", arguments: { action: "create", type: "chore", title: "Rotate the logs" } },
        { name: "task", arguments: { action: "move", taskId: "001", status: "wip" } },
        { name: "task", arguments: {} }, // menu needs a form → instructive error
      ],
      { elicitation: false },
    );

    assert.equal(elicitations, 0);
    assert.match(textOf(results[0]), /Created task \*\*001\*\*/);
    assert.match(textOf(results[1]), /`todo` → `wip`/);
    assert.equal(results[2].isError, true);
    assert.match(textOf(results[2]), /pass `action`/);
    const onDisk = readFileSync(join(tasksDir, "001--rotate-the-logs.md"), "utf8");
    assert.match(onDisk, /branch: chore\/001--rotate-the-logs/, "chore keeps its own prefix");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Unicode title round-trips; slug falls back to the task type", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-input-"));
  const tasksDir = join(dir, ".marvin", "track");
  try {
    const title = "Исправить таймаут логина";
    const { results } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "create", type: "bug", title } },
      { name: "task", arguments: { action: "list" } },
    ]);

    assert.match(textOf(results[0]), /Created task \*\*001\*\*/);
    // Fully non-Latin title → empty slug → type fallback; never an empty segment.
    const file = readFileSync(join(tasksDir, "001--bug.md"), "utf8");
    assert.match(file, /branch: fix\/001--bug/);

    // The stored file parses back as a valid task (schema + YAML round-trip).
    const [card] = results[1].structuredContent.tasks;
    assert.equal(card.title, title);
    assert.equal(card.branch, "fix/001--bug");
    assert.doesNotMatch(textOf(results[1]), /malformed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nextSeq counts malformed files too — no duplicate ids (regression)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-input-"));
  const tasksDir = join(dir, ".marvin", "track");
  try {
    seedTask(tasksDir, { id: "001", status: "todo" });
    // 002 has broken frontmatter (no title): invisible to readAllTasks, but its
    // id must still be reserved.
    writeFileSync(
      join(tasksDir, "002--broken.md"),
      ["---", 'id: "002"', "type: bug", "status: todo", "---", "", "Broken.", ""].join("\n"),
    );

    const { results } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "create", type: "bug", title: "After the broken one" } },
    ]);

    assert.match(textOf(results[0]), /Created task \*\*003\*\*/, "002 is taken, even malformed");
    const files = readdirSync(tasksDir).sort();
    assert.deepEqual(files, [
      "001--seeded-task.md",
      "002--broken.md",
      "003--after-the-broken-one.md",
    ]);
    assert.match(readFileSync(join(tasksDir, "002--broken.md"), "utf8"), /Broken\./, "untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
