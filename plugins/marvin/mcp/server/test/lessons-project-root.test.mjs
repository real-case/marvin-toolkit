import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";

/**
 * `lessons` accepts an optional `projectRoot`, as `spec`, `verify`, `metrics`
 * and `summary` do.
 *
 * The server resolves `.marvin/memory` once, at startup, from the directory it
 * was spawned in. A session working in a git worktree talks to a server spawned
 * for another checkout, so without `projectRoot` every lesson it captures lands
 * in — and every search reads — the wrong tree's store. The resolution order is
 * the shared one (`projectScopedDir`): the startup directory while the root is
 * the server's own, which keeps `MARVIN_MEMORY_DIR` authoritative there, and
 * `<projectRoot>/.marvin/memory` for any other root.
 *
 * Driven through the tool's `handler` on the compiled `src/`: the committed
 * `dist/server.js` is rebuilt by the integration step.
 */

const { buildLessonsTool } = await importTs("src/tools/lessons.ts");
const { loadEnv } = await importTs("src/lib/env.ts");

/** A host that declares no elicitation capability — prune then needs `confirm: true`. */
const NO_ELICIT = { server: { getClientCapabilities: () => ({}) } };

async function call(tool, args) {
  const result = await tool.handler(args);
  return {
    text: result.content.map((c) => c.text).join("\n"),
    isError: !!result.isError,
    structured: result.structuredContent,
  };
}

const lessonFiles = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md") : [];

const LESSON = {
  action: "add",
  type: "gotcha",
  title: "Vitest needs --run in CI",
  body: "Without --run vitest stays in watch mode and the CI job hangs.",
  tags: "ci, vitest",
};

const withRoots = (fn) => async () => {
  const root = mkdtempSync(join(tmpdir(), "marvin-lessons-root-"));
  const home = join(root, "home"); // the project the server was spawned for
  const target = join(root, "target"); // the worktree the session works in
  mkdirSync(home, { recursive: true });
  mkdirSync(target, { recursive: true });
  try {
    await fn({ root, home, target });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test(
  "add and search resolve the store under projectRoot",
  withRoots(async ({ home, target }) => {
    const tool = buildLessonsTool(NO_ELICIT, loadEnv({ CLAUDE_PROJECT_DIR: home }));

    const added = await call(tool, { ...LESSON, projectRoot: target });
    assert.equal(added.isError, false, added.text);
    assert.equal(lessonFiles(join(target, ".marvin", "memory")).length, 1);
    assert.ok(existsSync(join(target, ".marvin", "memory", "MEMORY.md")), "indexed in the target");
    assert.equal(existsSync(join(home, ".marvin")), false, "the server's own tree is untouched");

    const found = await call(tool, { action: "search", query: "vitest", projectRoot: target });
    assert.match(found.text, /Vitest needs --run in CI/);

    const notHere = await call(tool, { action: "search", query: "vitest" });
    assert.match(notHere.text, /No matching lessons/, "no projectRoot: the server's own store");
  }),
);

test(
  "the near-duplicate guard consults the store it would write to",
  withRoots(async ({ home, target }) => {
    const tool = buildLessonsTool(NO_ELICIT, loadEnv({ CLAUDE_PROJECT_DIR: home }));
    await call(tool, { ...LESSON, projectRoot: target });

    const again = await call(tool, { ...LESSON, projectRoot: target });
    assert.equal(again.isError, true);
    assert.match(again.text, /Near-duplicate/);

    const elsewhere = await call(tool, LESSON);
    assert.equal(elsewhere.isError, false, "the server's own store holds no such title");
    assert.equal(lessonFiles(join(home, ".marvin", "memory")).length, 1);
  }),
);

test(
  "stats and prune resolve the store under projectRoot",
  withRoots(async ({ home, target }) => {
    const tool = buildLessonsTool(NO_ELICIT, loadEnv({ CLAUDE_PROJECT_DIR: home }));
    await call(tool, { ...LESSON, projectRoot: target });
    // A stale lesson, planted: `created` is the only thing prune judges by age.
    const memory = join(target, ".marvin", "memory");
    writeFileSync(
      join(memory, "old-rule.md"),
      "---\nid: old-rule\ntype: pitfall\ntitle: An old rule\ncreated: 2020-01-01\nsource: manual\n---\n\nOld.\n",
    );

    const stats = await call(tool, { action: "stats", projectRoot: target });
    assert.equal(stats.structured.total, 2);
    const homeStats = await call(tool, { action: "stats" });
    assert.equal(homeStats.structured.total, 0);

    const candidates = await call(tool, { action: "prune", projectRoot: target });
    assert.match(candidates.text, /old-rule/, "the target's stale lesson is a candidate");
    const homeCandidates = await call(tool, { action: "prune" });
    assert.match(homeCandidates.text, /nothing to prune/);

    const missing = await call(tool, { action: "prune", slug: "old-rule", confirm: true });
    assert.equal(missing.isError, true, "the server's own store has no such lesson");
    assert.ok(existsSync(join(memory, "old-rule.md")));

    const deleted = await call(tool, {
      action: "prune",
      slug: "old-rule",
      confirm: true,
      projectRoot: target,
    });
    assert.equal(deleted.isError, false, deleted.text);
    assert.equal(existsSync(join(memory, "old-rule.md")), false);
    assert.equal(lessonFiles(memory).length, 1, "only the named lesson was removed");
  }),
);

test(
  "a projectRoot equal to the server's own root keeps the configured memory dir",
  withRoots(async ({ root, home }) => {
    const custom = join(root, "custom-memory");
    const tool = buildLessonsTool(
      NO_ELICIT,
      loadEnv({ CLAUDE_PROJECT_DIR: home, MARVIN_MEMORY_DIR: custom }),
    );

    const added = await call(tool, { ...LESSON, projectRoot: home });
    assert.equal(added.isError, false, added.text);
    assert.equal(lessonFiles(custom).length, 1, "MARVIN_MEMORY_DIR stays authoritative");
    assert.equal(existsSync(join(home, ".marvin")), false);
  }),
);

test("the input schema keeps projectRoot rather than stripping it", () => {
  const tool = buildLessonsTool(NO_ELICIT, loadEnv({ CLAUDE_PROJECT_DIR: tmpdir() }));
  for (const action of ["add", "search", "stats", "prune"]) {
    const parsed = tool.inputSchema.safeParse({ action, projectRoot: "/some/worktree" });
    assert.equal(parsed.success, true, `${action}: ${parsed.error?.message}`);
    assert.equal(parsed.data.projectRoot, "/some/worktree", `${action}: projectRoot was dropped`);
  }
  assert.match(tool.inputSchema.shape.projectRoot.description, /CLAUDE_PROJECT_DIR/);
});

test(
  "summary joins the lessons of the root it summarises, as the lessons tool reads them",
  withRoots(async ({ home, target }) => {
    const { buildSummaryTool } = await importTs("src/tools/summary.ts");
    const lesson = (title) =>
      `---\nid: x\ntype: gotcha\ntitle: ${title}\ncreated: 2026-01-01\nsource: manual\n---\n\nAbout demo.\n`;
    for (const [root, title] of [
      [home, "Demo lesson of the server's own tree"],
      [target, "Demo lesson of the summarised tree"],
    ]) {
      mkdirSync(join(root, ".marvin", "memory"), { recursive: true });
      writeFileSync(join(root, ".marvin", "memory", "demo-lesson.md"), lesson(title));
    }
    mkdirSync(join(target, ".marvin", "task"), { recursive: true });
    writeFileSync(
      join(target, ".marvin", "task", "001-demo.md"),
      "---\nslug: demo\ntype: feature\nstatus: ready\n---\n\n# Demo\n",
    );

    const tool = buildSummaryTool(loadEnv({ CLAUDE_PROJECT_DIR: home }));
    const result = await tool.handler({ projectRoot: target, slug: "demo" });
    assert.equal(result.isError ?? false, false, JSON.stringify(result.content));
    assert.deepEqual(
      result.structuredContent.lessons.map((l) => l.title),
      ["Demo lesson of the summarised tree"],
    );
  }),
);
