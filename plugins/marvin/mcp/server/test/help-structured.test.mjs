import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { callTool } from "./_driver.mjs";

/** Call the `help` tool once against the given project dir and return its result. */
function callHelp(dir, args = {}) {
  return callTool("help", args, {
    env: { CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_DIR: join(dir, ".marvin", "kanban") },
  });
}

test("help emits a DashboardState structuredContent (paths, config, artifacts, command groups)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-help-"));
  try {
    // config + a representative artifact in each .marvin subdir
    mkdirSync(join(dir, ".marvin", "task"), { recursive: true });
    mkdirSync(join(dir, ".marvin", "handoff"), { recursive: true });
    mkdirSync(join(dir, ".marvin", "security"), { recursive: true });
    mkdirSync(join(dir, ".marvin", "memory"), { recursive: true });
    writeFileSync(
      join(dir, ".marvin", "config.json"),
      JSON.stringify({ base_branch: "main", tracker_url_template: "https://t/{tracker_id}" }),
    );
    writeFileSync(join(dir, ".marvin", "task", "001-thing.md"), "# spec");
    writeFileSync(join(dir, ".marvin", "task", "verification.md"), "# verify"); // excluded
    writeFileSync(join(dir, ".marvin", "handoff", "001-h.md"), "# handoff");
    writeFileSync(join(dir, ".marvin", "security", "scan.md"), "# audit");
    writeFileSync(join(dir, ".marvin", "memory", "MEMORY.md"), "# index"); // excluded
    writeFileSync(join(dir, ".marvin", "memory", "a-lesson.md"), "# lesson");

    const result = await callHelp(dir);
    const sc = result.structuredContent;
    assert.ok(sc, "structuredContent present");

    // text surface still rendered
    assert.match(result.content.map((c) => c.text).join("\n"), /marvin · kanban tracker/);

    assert.equal(typeof sc.version, "string");
    assert.equal(sc.paths.project, dir);
    assert.equal(sc.config.base_branch, "main");
    assert.equal(sc.config.tracker_url_template, "https://t/{tracker_id}");
    assert.equal(sc.git.branch, null); // temp dir is not a git repo
    assert.equal(typeof sc.git.has_git, "boolean");

    // ADR-0026: the configured status set rides along, and counts come as an
    // open per-key record plus the per-role roll-up (default set here).
    assert.deepEqual(
      sc.config.statuses.map((s) => s.key),
      ["todo", "wip", "review", "done", "blocked"],
    );
    assert.equal(sc.kanban_counts.todo, 0);
    assert.equal(sc.kanban_role_counts.wip, 0);

    // artifact counts honour the index/verification exclusions
    assert.deepEqual(sc.artifacts, { specs: 1, handoffs: 1, audits: 1, lessons: 1 });

    // command groups derived from the registry
    const groups = Object.fromEntries(sc.command_groups.map((g) => [g.group, g.count]));
    for (const g of ["core", "pr", "task", "sec", "kanban"]) {
      assert.ok(groups[g] > 0, `group ${g} present with a positive count`);
    }
    const total = sc.command_groups.reduce((n, g) => n + g.count, 0);
    assert.ok(total >= 30, `command total looks like the full registry (got ${total})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("help renders a registry-derived command index in text (no hand-list drift)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-help-"));
  try {
    const text = (await callHelp(dir)).content.map((c) => c.text).join("\n");
    assert.match(text, /## Commands \(\d+\)/);
    // every group header is present...
    for (const g of ["core", "pr", "task", "sec", "kanban"]) {
      assert.match(text, new RegExp(`### ${g} \\(\\d+\\)`), `group ${g} header`);
    }
    // ...including commands the old hand-maintained list never covered.
    for (const cmd of [
      "/marvin:sec-scan",
      "/marvin:pr-create",
      "/marvin:task-start",
      "/marvin:help",
    ]) {
      assert.ok(text.includes(cmd), `index lists ${cmd}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("help `section` narrows the index to one group", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-help-"));
  try {
    const text = (await callHelp(dir, { section: "sec" })).content.map((c) => c.text).join("\n");
    assert.match(text, /## Commands · `sec` group/);
    assert.ok(text.includes("/marvin:sec-scan"), "sec group listed");
    assert.ok(!text.includes("/marvin:kanban-bug"), "other groups excluded");
    assert.ok(!/### kanban/.test(text), "no other group headers");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("help unknown `section` falls back to the full index with a hint", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-help-"));
  try {
    const text = (await callHelp(dir, { section: "zzz" })).content.map((c) => c.text).join("\n");
    assert.match(text, /Unknown section `zzz`/);
    assert.match(text, /### kanban \(\d+\)/, "still lists all groups");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
