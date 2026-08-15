import { test } from "node:test";
import assert from "node:assert/strict";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { callTool } from "./_driver.mjs";

/** Call the `help` tool once against the given project dir and return its result. */
function callHelp(dir, args = {}) {
  return callTool("help", args, {
    env: { CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_DIR: join(dir, ".marvin", "track") },
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
    for (const g of ["core", "adr", "pr", "task", "sec", "refactor", "track"]) {
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
    for (const name of ["commit", "sec-scan", "pr-create", "task-start", "track-new"]) {
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

    // richer per-command fields for the widget's "Read more" detail view (ADR-0024):
    // `description` is always a string; `example` is optional (string when present)
    assert.ok(
      sc.commands.every((c) => typeof c.description === "string"),
      "every command carries a string description",
    );
    assert.ok(
      sc.commands.every((c) => c.example === undefined || typeof c.example === "string"),
      "example, when present, is a string",
    );
    // the optional path is exercised both ways: some commands have one, some omit it
    assert.ok(
      sc.commands.some((c) => typeof c.example === "string"),
      "at least one command carries an example",
    );
    assert.ok(
      sc.commands.some((c) => c.example === undefined),
      "at least one command omits the example",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("help emits a non-empty curated description for every command (drift guard)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-help-"));
  try {
    const sc = (await callHelp(dir)).structuredContent;
    assert.ok(sc.commands.length >= 30, `full registry listed (got ${sc.commands.length})`);
    // `description` falls back to "" for a missing COMMAND_DETAILS entry (not to the
    // blurb), so a non-empty assertion is a real drift guard — a new command shipped
    // without a curated detail fails here, exactly like the blurb guard above.
    const missing = sc.commands.filter((c) => !c.description || c.description.length === 0);
    assert.deepEqual(
      missing.map((c) => c.name),
      [],
      "every command has a curated (non-empty) description",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("help emits at least three prose invocation phrases for every command (drift guard)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-help-"));
  try {
    const sc = (await callHelp(dir)).structuredContent;
    assert.ok(sc.commands.length >= 30, `full registry listed (got ${sc.commands.length})`);
    // Every command carries the "two ways to call" prose examples (ADR-0024): an
    // array of ≥3 non-empty strings sourced from the shared COMMAND_PROMPTS. A new
    // command shipped without an entry lands `[]` and fails here — a real drift
    // guard, exactly like the blurb/description guards.
    const short = sc.commands.filter(
      (c) => !Array.isArray(c.phrases) || c.phrases.filter((p) => p && p.length > 0).length < 3,
    );
    assert.deepEqual(
      short.map((c) => c.name),
      [],
      "every command has at least three non-empty prose phrases",
    );
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
    for (const g of ["core", "pr", "task", "sec", "track"]) {
      assert.ok(text.includes(`\`${g}\` — `), `group ${g} in the TOC`);
    }
    // ...and the reference is grouped under per-group headings
    for (const g of ["core", "sec", "track"]) {
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
    assert.ok(!text.includes("/marvin:track-new"), "other groups excluded");
    assert.ok(!/### track/.test(text), "no other reference group headings");
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
    assert.match(text, /### track/, "still shows the full reference");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The shipped surface must agree with skill frontmatter, on both doors.
 *
 * The expected set is read from `plugins/marvin/skills/` here, in the test, and
 * never imported from the implementation — a guard that reuses the reader it is
 * checking compares a value with itself. Same reason `catalog.test.mjs` parses
 * `GROUP_PREFIXES` out of `state.ts` as text.
 */
test("both help doors mark exactly the frontmatter human-run set", async () => {
  // `dirname(fileURLToPath(...))` rather than `import.meta.dirname`, matching the
  // seven sibling files here: the latter needs Node >= 20.11 while the repo floor
  // is >=20, so a contributor on 20.0-20.10 would get join(undefined, ...).
  const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "skills");
  const expected = readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => {
      // Line-oriented, unlike the shipped codec's offset slicing — the point of a
      // guard is to fail when the implementation's own extraction is wrong. A
      // directory with no readable SKILL.md carries no flag rather than throwing.
      let lines;
      try {
        lines = readFileSync(join(skillsDir, e.name, "SKILL.md"), "utf8").split(/\r?\n/);
      } catch {
        return false;
      }
      if (lines[0]?.trim() !== "---") return false;
      const close = lines.indexOf("---", 1);
      if (close === -1) return false;
      return lines
        .slice(1, close)
        .some((l) => /^disable-model-invocation:\s*["']?true["']?\s*$/.test(l));
    })
    .map((e) => e.name)
    .sort();

  // A guard that could pass on an empty repo proves nothing.
  assert.ok(expected.length > 0, "the repo has at least one human-run skill");

  const dir = mkdtempSync(join(tmpdir(), "marvin-help-"));
  try {
    const res = await callHelp(dir);

    const structured = res.structuredContent.commands
      .filter((c) => c.human)
      .map((c) => c.name)
      .sort();
    assert.deepEqual(structured, expected, "structuredContent door");

    const text = res.content.map((c) => c.text).join("\n");
    const markdown = [...text.matchAll(/`\/?(?:marvin:)?([a-z-]+)`\s*👤/g)].map((m) => m[1]).sort();
    assert.deepEqual([...new Set(markdown)], expected, "markdown door");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * `/marvin:help` and `/marvin:dashboard` count specs in the same directory.
 *
 * Both render an artifact inventory for one project, so a reader who runs both
 * sees two numbers and has no way to adjudicate between them. The dashboard has
 * resolved the count through the `spec.dir` config tier since ADR-0037; help
 * kept the detection default, which reads whichever conventional directory
 * happens to exist.
 *
 * The fixture makes the two answers differ: a legacy `.marvin/task/` holding one
 * spec (what detection finds first) and the configured `product/specs/` holding
 * two (the real corpus). One number is right and a config-blind reader prints
 * the other.
 */
test("help and dashboard report the same spec count under a configured spec.dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-help-specdir-"));
  const spec = (slug) => `---\nslug: ${slug}\ntype: feature\nstatus: ready\n---\n\n# ${slug}\n`;
  try {
    mkdirSync(join(dir, ".marvin", "task"), { recursive: true });
    mkdirSync(join(dir, "product", "specs"), { recursive: true });
    writeFileSync(join(dir, ".marvin", "task", "001-legacy.md"), spec("legacy"));
    writeFileSync(join(dir, "product", "specs", "001-alpha.md"), spec("alpha"));
    writeFileSync(join(dir, "product", "specs", "002-beta.md"), spec("beta"));
    writeFileSync(
      join(dir, ".marvin", "config.json"),
      JSON.stringify({ base_branch: "main", spec: { dir: "product/specs" } }),
    );

    const help = await callHelp(dir);
    const dashboard = await callTool("dashboard", {}, { env: { CLAUDE_PROJECT_DIR: dir } });

    assert.equal(
      help.structuredContent.artifacts.specs,
      dashboard.structuredContent.artifacts.specs,
      "the two toolbox reports name one directory or contradict each other",
    );
    assert.equal(
      help.structuredContent.artifacts.specs,
      2,
      "and the directory they name is the configured one, not the detected one",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
