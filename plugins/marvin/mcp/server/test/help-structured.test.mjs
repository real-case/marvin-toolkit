import { test } from "node:test";
import assert from "node:assert/strict";
import { join, basename } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { callTool } from "./_driver.mjs";

/** Call the `help` tool once against the given project dir and return its result. */
function callHelp(dir, args = {}) {
  return callTool("help", args, {
    env: { CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_DIR: join(dir, ".marvin", "kanban") },
  });
}

test("help emits a HelpState structuredContent (summary, servers, groups, commands)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-help-"));
  try {
    // config + a representative artifact in each .marvin subdir
    mkdirSync(join(dir, ".marvin", "task"), { recursive: true });
    mkdirSync(join(dir, ".marvin", "handoff"), { recursive: true });
    mkdirSync(join(dir, ".marvin", "security"), { recursive: true });
    mkdirSync(join(dir, ".marvin", "memory"), { recursive: true });
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(
      join(dir, ".marvin", "config.json"),
      JSON.stringify({ base_branch: "main", tracker_url_template: "https://t/{tracker_id}" }),
    );
    // project-level MCP servers surface in the summary; a disabled one goes dim
    writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ marvin: {}, context7: {} }));
    writeFileSync(
      join(dir, ".claude", "settings.json"),
      JSON.stringify({ mcpServers: { fetch: {} }, disabledMcpjsonServers: ["fetch"] }),
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

    // text surface still rendered: the wordmark heading, the slogan, the
    // project summary, and the configured MCP servers (● lit / ○ dim)
    const text = result.content.map((c) => c.text).join("\n");
    assert.match(text, /^# >_ MARVIN$/m, "wordmark heading rendered");
    assert.match(text, /toolset for AI development without panic/);
    assert.match(text, /## Summary/);
    assert.match(text, /## MCP servers/);
    assert.ok(text.includes("● `marvin`"), "enabled server rendered lit");
    assert.ok(text.includes("○ `fetch`"), "disabled server rendered dim");

    // summary
    assert.equal(typeof sc.version, "string");
    assert.equal(sc.slogan, "Claude Code toolset for AI development without panic");
    assert.equal(sc.project, basename(dir)); // project name, not the full path
    assert.equal(sc.git.base_branch, "main");
    assert.equal(sc.git.branch, null); // temp dir is not a git repo
    assert.equal(typeof sc.git.has_git, "boolean");

    // ADR-0026: the configured status set with live counts, in board order
    assert.deepEqual(
      sc.statuses.map((s) => s.key),
      ["todo", "wip", "review", "done", "blocked"],
    );
    assert.equal(sc.statuses[0].role, "todo");
    assert.equal(sc.statuses[0].count, 0);

    // artifact counts honour the index/verification exclusions
    assert.deepEqual(sc.artifacts, { specs: 1, handoffs: 1, audits: 1, lessons: 1 });

    // MCP servers carry the enabled state (honest lit/dim signal)
    const servers = Object.fromEntries(sc.servers.map((s) => [s.name, s.enabled]));
    assert.equal(servers.marvin, true, "configured server enabled");
    assert.equal(servers.fetch, false, "disabledMcpjsonServers server disabled");

    // command groups TOC — each group with an authored blurb, registry-ordered
    const groupKeys = sc.groups.map((g) => g.group);
    for (const g of ["core", "adr", "pr", "task", "sec", "refactor", "kanban"]) {
      assert.ok(groupKeys.includes(g), `group ${g} present in the TOC`);
    }
    assert.ok(
      sc.groups.every((g) => g.blurb.length > 0),
      "every group has an authored blurb",
    );

    // full command reference — registry-derived names, curated blurbs (drift guard:
    // an empty blurb means a registry command has no COMMAND_BLURBS entry)
    assert.ok(sc.commands.length >= 30, `full registry listed (got ${sc.commands.length})`);
    assert.ok(
      sc.commands.every((c) => c.blurb.length > 0),
      "every command has a curated blurb (no drift)",
    );
    for (const name of ["commit", "sec-scan", "pr-create", "task-start", "kanban-bug"]) {
      assert.ok(
        sc.commands.some((c) => c.name === name),
        `reference lists ${name}`,
      );
    }
    // human-run lifecycle commands are flagged
    const accept = sc.commands.find((c) => c.name === "adr-accept");
    assert.equal(accept.human, true, "adr-accept marked human-run");
    const commit = sc.commands.find((c) => c.name === "commit");
    assert.equal(commit.human, false, "ordinary command not human-run");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("help renders a registry-derived command index in text (no hand-list drift)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-help-"));
  try {
    const text = (await callHelp(dir)).content.map((c) => c.text).join("\n");
    // a command-groups table of contents, then the full per-command reference
    assert.match(text, /## Command groups/);
    assert.match(text, /## Commands/);
    // the groups TOC lists each group with its blurb...
    for (const g of ["core", "pr", "task", "sec", "kanban"]) {
      assert.ok(text.includes(`\`${g}\` — `), `group ${g} in the TOC`);
    }
    // ...and the reference is grouped under per-group headings
    for (const g of ["core", "sec", "kanban"]) {
      assert.ok(text.includes(`### ${g}`), `group ${g} reference heading`);
    }
    // counts are deliberately absent from the reference
    assert.ok(!/### sec \(\d+\)/.test(text), "no per-group counts");
    // every command is listed (including ones the old hand-list never covered)
    for (const cmd of ["sec-scan", "pr-create", "task-start", "task-summary"]) {
      assert.ok(text.includes(cmd), `reference lists ${cmd}`);
    }
    // human-run commands are flagged
    assert.ok(text.includes("`adr-accept` 👤"), "human-run commands flagged");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("help `section` narrows the index to one group", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-help-"));
  try {
    const text = (await callHelp(dir, { section: "sec" })).content.map((c) => c.text).join("\n");
    assert.match(text, /## Commands · sec/);
    assert.ok(text.includes("/marvin:sec-scan"), "sec group listed");
    assert.ok(!text.includes("/marvin:kanban-bug"), "other groups excluded");
    assert.ok(!/### kanban/.test(text), "no other reference group headings");
    assert.ok(!/## Command groups/.test(text), "no groups TOC in the focused view");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("help unknown `section` falls back to the full index with a hint", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-help-"));
  try {
    const text = (await callHelp(dir, { section: "zzz" })).content.map((c) => c.text).join("\n");
    assert.match(text, /Unknown group `zzz`/);
    assert.match(text, /### kanban/, "still shows the full reference");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
