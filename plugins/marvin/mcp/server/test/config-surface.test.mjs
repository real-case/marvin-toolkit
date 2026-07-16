import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
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

/**
 * Drive the live server over stdio (same harness as input-contract): run the
 * given tools/call requests in order. Options:
 *   - elicitation: declare the client capability (default true).
 *   - accept: content used to answer every elicitation/create (cancel if null).
 * Resolves to { results, elicitations }.
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

// ── read side ────────────────────────────────────────────────────────────

test("config view without a file shows defaults and works on hosts without elicitation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-config-"));
  try {
    const { results, elicitations } = await drive(
      { CLAUDE_PROJECT_DIR: dir },
      [{ name: "task", arguments: { action: "config" } }],
      { elicitation: false },
    );

    assert.equal(elicitations, 0, "the view never opens a form");
    const [view] = results;
    assert.notEqual(view.isError, true);
    const text = textOf(view);
    assert.match(text, /# Board configuration/);
    assert.match(text, /not created yet — the first edit creates it/);
    assert.match(text, /\*\*base_branch:\*\* `dev` _\(default\)_/, "no repo, no file → default");
    assert.match(text, /\*\*tracker_url_template:\*\* _not set_/);
    assert.match(text, /\*\*branch_template:\*\* _not set — default scheme/);
    // the default vocabulary rendered as the statuses table
    for (const key of ["todo", "wip", "review", "done", "blocked"]) {
      assert.match(text, new RegExp(`\\| ${key} \\| ${key} \\| — \\|`));
    }
    assert.ok(!existsSync(join(dir, ".marvin", "config.json")), "viewing creates nothing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config view with an existing file marks base_branch as from config and lists tracker_status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-config-"));
  try {
    mkdirSync(join(dir, ".marvin"), { recursive: true });
    writeFileSync(
      join(dir, ".marvin", "config.json"),
      JSON.stringify({
        base_branch: "main",
        tracker_url_template: "https://acme.atlassian.net/browse/{tracker_id}",
        statuses: CUSTOM_STATUSES,
      }),
    );

    const { results } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "config" } },
    ]);

    const text = textOf(results[0]);
    assert.match(text, /\*\*base_branch:\*\* `main` _\(from config\)_/);
    assert.match(text, /`https:\/\/acme\.atlassian\.net\/browse\/\{tracker_id\}`/);
    assert.match(text, /\| in-progress \| wip \| In Progress \|/);
    assert.match(text, /\| qa \| review \| QA \|/);
    assert.match(text, /\| blocked \| blocked \| — \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── write side ───────────────────────────────────────────────────────────

test("config update via args round-trips statuses JSON and applies within the same session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-config-"));
  try {
    const { results, elicitations } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      {
        name: "task",
        arguments: {
          action: "config",
          base_branch: "main",
          tracker_url_template: "https://t/{tracker_id}",
          statuses: JSON.stringify(CUSTOM_STATUSES),
        },
      },
      { name: "task", arguments: { action: "config" } },
      { name: "task", arguments: { action: "create", type: "bug", title: "After the config" } },
    ]);

    assert.equal(elicitations, 0, "argument-complete update needs no form");
    const [update, view, create] = results;
    assert.notEqual(update.isError, true);
    assert.match(textOf(update), /Created `.*config\.json` — set/);

    // on disk: exactly what was sent, valid JSON
    const onDisk = JSON.parse(readFileSync(join(dir, ".marvin", "config.json"), "utf8"));
    assert.deepEqual(onDisk.statuses, CUSTOM_STATUSES);
    assert.equal(onDisk.base_branch, "main");

    // the same session sees the new configuration without a restart
    assert.match(textOf(view), /\*\*base_branch:\*\* `main` _\(from config\)_/);
    assert.match(textOf(view), /\| backlog \| todo \| — \|/);

    // and creation targets the new todo-role status
    assert.notEqual(create.isError, true);
    const taskFile = readFileSync(
      join(dir, ".marvin", "track", "001--after-the-config.md"),
      "utf8",
    );
    assert.match(taskFile, /status: backlog/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid statuses JSON is fail-closed with the exact issues; nothing is written", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-config-"));
  try {
    const missingWip = JSON.stringify([
      { key: "backlog", role: "todo" },
      { key: "done", role: "done" },
    ]);
    const badKey = JSON.stringify([
      { key: "Backlog!", role: "todo" },
      { key: "wip", role: "wip" },
      { key: "done", role: "done" },
    ]);
    const duplicate = JSON.stringify([
      { key: "todo", role: "todo" },
      { key: "todo", role: "wip" },
      { key: "done", role: "done" },
    ]);

    const { results } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "config", statuses: missingWip } },
      { name: "task", arguments: { action: "config", statuses: badKey } },
      { name: "task", arguments: { action: "config", statuses: duplicate } },
      { name: "task", arguments: { action: "config", statuses: "not json at all" } },
    ]);

    assert.equal(results[0].isError, true);
    assert.match(textOf(results[0]), /at least one status with role "wip" is required/);
    assert.equal(results[1].isError, true);
    assert.match(textOf(results[1]), /lowercase alphanumerics and hyphens/);
    assert.equal(results[2].isError, true);
    assert.match(textOf(results[2]), /duplicate status key "todo"/);
    assert.equal(results[3].isError, true);
    assert.match(textOf(results[3]), /not valid JSON/);
    for (const r of results) assert.match(textOf(r), /Invalid `statuses`/);

    assert.ok(!existsSync(join(dir, ".marvin", "config.json")), "fail-closed: nothing written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read-modify-write preserves keys owned by other tools (gates regression) — via MARVIN_TASKS_CONFIG", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-config-"));
  try {
    const configPath = join(dir, "custom-config.json");
    const seeded = {
      base_branch: "dev",
      gates: { test: "npm test", lint: "eslint ." },
      x_future_tool: { keep: ["me", 42] },
      statuses: CUSTOM_STATUSES,
    };
    writeFileSync(configPath, JSON.stringify(seeded, null, 2));

    const { results } = await drive({ CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_CONFIG: configPath }, [
      {
        name: "task",
        arguments: { action: "config", tracker_url_template: "https://t/{tracker_id}" },
      },
    ]);

    assert.notEqual(results[0].isError, true);
    assert.match(textOf(results[0]), /Updated `.*custom-config\.json`/);

    const onDisk = JSON.parse(readFileSync(configPath, "utf8"));
    assert.deepEqual(onDisk.gates, seeded.gates, "verify tool's gates survive untouched");
    assert.deepEqual(onDisk.x_future_tool, seeded.x_future_tool, "unknown keys survive");
    assert.deepEqual(onDisk.statuses, CUSTOM_STATUSES, "unpatched managed keys survive");
    assert.equal(onDisk.tracker_url_template, "https://t/{tracker_id}");
    assert.equal(onDisk.base_branch, "dev");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a broken existing config.json is never clobbered by an update", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-config-"));
  try {
    mkdirSync(join(dir, ".marvin"), { recursive: true });
    const configPath = join(dir, ".marvin", "config.json");
    writeFileSync(configPath, "{ this is not json");

    const { results } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "config", base_branch: "main" } },
    ]);

    assert.equal(results[0].isError, true);
    assert.match(textOf(results[0]), /not valid JSON/);
    assert.match(textOf(results[0]), /nothing was written/);
    assert.equal(readFileSync(configPath, "utf8"), "{ this is not json", "file untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("empty string clears a setting; invalid base_branch is rejected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-config-"));
  try {
    mkdirSync(join(dir, ".marvin"), { recursive: true });
    const configPath = join(dir, ".marvin", "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({ base_branch: "main", tracker_url_template: "https://t/{tracker_id}" }),
    );

    const { results } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "config", tracker_url_template: "" } },
      { name: "task", arguments: { action: "config", base_branch: "not a branch" } },
    ]);

    assert.notEqual(results[0].isError, true);
    const onDisk = JSON.parse(readFileSync(configPath, "utf8"));
    assert.ok(!("tracker_url_template" in onDisk), "cleared key removed from the file");
    assert.match(textOf(results[0]), /\*\*tracker_url_template:\*\* _not set_/);

    assert.equal(results[1].isError, true);
    assert.match(textOf(results[1]), /not a valid git branch name/);
    assert.equal(JSON.parse(readFileSync(configPath, "utf8")).base_branch, "main", "unchanged");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("switching statuses on a live board warns about tasks stranded outside the new set", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-config-"));
  const tasksDir = join(dir, ".marvin", "track");
  try {
    seedTask(tasksDir, { id: "001", status: "todo" }); // "todo" is not in CUSTOM_STATUSES

    const { results } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "config", statuses: JSON.stringify(CUSTOM_STATUSES) } },
    ]);

    assert.notEqual(results[0].isError, true);
    const text = textOf(results[0]);
    assert.match(text, /1 existing task file\(s\) use statuses outside the new set/);
    assert.match(text, /001--seeded-task\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── elicitation fallback (WP3 pattern) ───────────────────────────────────

test("edit=true elicits the scalar fields and applies the answers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-config-"));
  try {
    const { results, elicitations } = await drive(
      { CLAUDE_PROJECT_DIR: dir },
      [{ name: "task", arguments: { action: "config", edit: true } }],
      { accept: { base_branch: "release", tracker_url_template: "https://t/{tracker_id}" } },
    );

    assert.equal(elicitations, 1, "one form for the scalar settings");
    assert.notEqual(results[0].isError, true);
    const onDisk = JSON.parse(readFileSync(join(dir, ".marvin", "config.json"), "utf8"));
    assert.equal(onDisk.base_branch, "release");
    assert.equal(onDisk.tracker_url_template, "https://t/{tracker_id}");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("host without elicitation: edit=true answers with the exact arguments to pass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-config-"));
  try {
    const { results, elicitations } = await drive(
      { CLAUDE_PROJECT_DIR: dir },
      [{ name: "task", arguments: { action: "config", edit: true } }],
      { elicitation: false },
    );

    assert.equal(elicitations, 0);
    assert.equal(results[0].isError, true);
    const text = textOf(results[0]);
    assert.match(text, /does not support interactive forms/);
    for (const arg of ["base_branch", "tracker_url_template", "branch_template", "statuses"]) {
      assert.match(text, new RegExp(`\`${arg}\``), `names ${arg} as a retry argument`);
    }
    assert.ok(!existsSync(join(dir, ".marvin", "config.json")), "nothing written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── branch_template consumption ──────────────────────────────────────────

test("branch_template drives new-task branches; {tracker} collapses when absent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-config-"));
  const tasksDir = join(dir, ".marvin", "track");
  try {
    mkdirSync(join(dir, ".marvin"), { recursive: true });
    writeFileSync(
      join(dir, ".marvin", "config.json"),
      JSON.stringify({ branch_template: "{type}/{seq}-{tracker}--{slug}" }),
    );

    const { results } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      {
        name: "task",
        arguments: { action: "create", type: "bug", title: "Login timeout", tracker_id: "OSI-9" },
      },
      { name: "task", arguments: { action: "create", type: "feature", title: "Dark mode" } },
    ]);

    assert.notEqual(results[0].isError, true);
    const withTracker = readFileSync(join(tasksDir, "001-OSI-9--login-timeout.md"), "utf8");
    assert.match(withTracker, /branch: bug\/001-OSI-9--login-timeout/);

    // no tracker: the {tracker} placeholder and its leading "-" collapse
    const withoutTracker = readFileSync(join(tasksDir, "002--dark-mode.md"), "utf8");
    assert.match(withoutTracker, /branch: feature\/002--dark-mode/);
    assert.doesNotMatch(textOf(results[1]), /invalid git branch name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a bad branch_template falls back to the default scheme and warns instead of failing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-config-"));
  const tasksDir = join(dir, ".marvin", "track");
  try {
    mkdirSync(join(dir, ".marvin"), { recursive: true });
    writeFileSync(
      join(dir, ".marvin", "config.json"),
      JSON.stringify({ branch_template: "{nope}/{seq}" }),
    );

    const { results } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      { name: "task", arguments: { action: "create", type: "bug", title: "Broken template" } },
    ]);

    assert.notEqual(results[0].isError, true, "the create itself succeeds");
    const text = textOf(results[0]);
    assert.match(text, /Created task \*\*001\*\*/);
    assert.match(text, /renders an invalid git branch name/);
    const onDisk = readFileSync(join(tasksDir, "001--broken-template.md"), "utf8");
    assert.match(onDisk, /branch: fix\/001--broken-template/, "ADR-0019 default applied");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("setting branch_template previews the rendered branch; a bad one warns at set time", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-config-"));
  try {
    const { results } = await drive({ CLAUDE_PROJECT_DIR: dir }, [
      {
        name: "task",
        arguments: { action: "config", branch_template: "{type_prefix}/{seq}-{tracker}--{slug}" },
      },
      { name: "task", arguments: { action: "config", branch_template: "bad//{seq}" } },
    ]);

    assert.notEqual(results[0].isError, true);
    assert.match(textOf(results[0]), /branch preview: `fix\/007-ABC-123--sample-task`/);
    assert.match(textOf(results[0]), /`fix\/007--sample-task` \(without\)/);

    // a template rendering an unsafe ref still saves (create falls back), but says so up front
    assert.notEqual(results[1].isError, true);
    assert.match(textOf(results[1]), /renders an invalid git branch name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
