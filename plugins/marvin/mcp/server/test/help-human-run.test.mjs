import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { importTs } from "./_tsload.mjs";

/**
 * The human-run (👤) flag comes from skill frontmatter and nowhere else.
 *
 * Both tests drive a SYNTHETIC pack root, which is the whole point: against the
 * real `plugins/marvin/skills/` tree a correct reader and a hard-coded name list
 * are indistinguishable, because such a list would be right today. Only a tree
 * the implementation cannot have memorised separates them.
 *
 * The tool half deliberately flags `track-new` / `track-show`: those are in the
 * prompt registry but have no `SKILL.md` of their own, and the reference renders
 * registry names — so flagging invented names would mark nothing and the
 * assertion could never fail. Marking a `track-*` command is something no
 * plausible hard-coded set produces.
 */
const helpData = await importTs("src/lib/help-data.ts");
const helpTool = await importTs("src/tools/help.ts");

/** Write `<packRoot>/skills/<name>/SKILL.md` with the given frontmatter lines. */
function writeSkill(packRoot, name, frontmatterLines) {
  const dir = join(packRoot, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: synthetic skill for tests\n${frontmatterLines.join("\n")}\n---\n\n# ${name}\n`,
  );
}

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "marvin-human-run-"));
  try {
    // `await` matters: without it the finally-block deletes the tree at the
    // callback's first suspension point, and an async body would assert against
    // a directory that no longer exists — a failure that reads like a product bug.
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("humanRunSkills reads the flag from a synthetic skills tree and fails open", async () => {
  await withTempDir((packRoot) => {
    writeSkill(packRoot, "synthetic-flagged", ["disable-model-invocation: true"]);
    writeSkill(packRoot, "synthetic-quoted", ['disable-model-invocation: "true"']);
    writeSkill(packRoot, "synthetic-plain", []);
    writeSkill(packRoot, "synthetic-false", ["disable-model-invocation: false"]);
    // Carries `true` under a DIFFERENT key: kills a reader that greps the
    // frontmatter for the substring instead of reading the one field.
    writeSkill(packRoot, "synthetic-other-true", ["spike_required: true"]);
    // A skill directory with no SKILL.md at all — exercises the inner catch.
    mkdirSync(join(packRoot, "skills", "synthetic-no-file"), { recursive: true });

    const flagged = helpData.humanRunSkills(packRoot);

    // Bare and quoted both count: the ADR-0005 codec parses under the YAML
    // failsafe schema, so every scalar arrives as a string.
    assert.deepEqual(
      [...flagged].sort(),
      ["synthetic-flagged", "synthetic-quoted"],
      "exactly the two flagged skills, read from the given directory",
    );
  });

  // Fails open rather than throwing — /marvin:help must still answer.
  await withTempDir((root) => {
    const missing = join(root, "does-not-exist");
    assert.deepEqual(
      [...helpData.humanRunSkills(missing)],
      [],
      "absent directory yields empty set",
    );

    // A pack root that is a FILE, not a directory: readdir raises ENOTDIR rather
    // than ENOENT, which is the branch that reports the failure instead of
    // swallowing it silently. Without this case the condition is never true, so
    // inverting it would ship unnoticed and spam stderr on every /marvin:help
    // in a project that simply has no skills directory.
    const notADir = join(root, "regular-file");
    writeFileSync(notADir, "not a directory\n");
    assert.deepEqual(
      [...helpData.humanRunSkills(notADir)],
      [],
      "an unreadable skills path still yields an empty set",
    );
  });
});

test("the help tool marks exactly the human-run set of the packRoot it is given", async () => {
  await withTempDir(async (root) => {
    const packRoot = join(root, "pack");
    // Registry-present, skill-absent commands: no hard-coded set marks these.
    writeSkill(packRoot, "track-new", ["disable-model-invocation: true"]);
    writeSkill(packRoot, "track-show", ["disable-model-invocation: true"]);
    // Present but unflagged — proves the reader reads rather than globs.
    writeSkill(packRoot, "commit", []);

    const projectDir = join(root, "project");
    mkdirSync(projectDir, { recursive: true });
    const env = {
      projectDir,
      tasksDir: join(projectDir, ".marvin", "track"),
      configPath: join(projectDir, ".marvin", "config.json"),
      memoryDir: join(projectDir, ".marvin", "memory"),
      handoffDir: join(projectDir, ".marvin", "handoff"),
      securityDir: join(projectDir, ".marvin", "security"),
      usageDir: join(projectDir, ".marvin", "usage"),
    };

    const tool = helpTool.buildHelpTool(env, "0.0.0-test", packRoot);
    const result = await tool.handler({});

    const marked = result.structuredContent.commands
      .filter((c) => c.human)
      .map((c) => c.name)
      .sort();
    assert.deepEqual(marked, ["track-new", "track-show"], "structuredContent door");

    // The markdown door must agree — it is a separate read site.
    const text = result.content.map((c) => c.text ?? "").join("\n");
    const markedInText = [...text.matchAll(/`\/?(?:marvin:)?([a-z-]+)`\s*👤/g)]
      .map((m) => m[1])
      .sort();
    assert.deepEqual(markedInText, ["track-new", "track-show"], "markdown door");
  });
});
