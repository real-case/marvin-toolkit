import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_PATH, callTool, withSession } from "./_driver.mjs";
import { importTs } from "./_tsload.mjs";

/**
 * The `pipeline` MCP tool (autopilot plan, Task 13 Step 7). Two read-only actions:
 *
 * - `paths` is how a skill finds the pipeline's shipped assets and the `marvin-pipe` CLI. Every
 *   path comes from where the server itself is installed, never from the caller's cwd, so the
 *   test asserts that each shipped path exists and is the one the plugin actually ships. The CLI
 *   bundle is a second tsup entry, so the CLI path is checked against the build configuration:
 *   once tsup builds `marvin-pipe`, the path must exist and nothing may be missing, and until it
 *   does, the configuration must build the server alone (`assertCliMatchesBundle`).
 * - `status` reads one run back through run-store's `loadRun`. It names a file the caller chose,
 *   so it refuses any run directory that does not resolve inside the state root, by path or by
 *   symlink, and it never writes: the engine is the only writer of `run.json`.
 *
 * The handler cases drive the compiled `src/` directly; the stdio cases drive the committed
 * `dist/server.js`, which is where registration, the tool count and strict input live.
 */

const { buildPipelineTool } = await importTs("src/tools/pipeline.ts");
const rs = await importTs("src/pipeline/run-store.ts");

/** The plugin root the server derives from its own location: `mcp/server/dist/` → three up. */
const PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const textOf = (r) => r.content.map((c) => c.text).join("\n");
const SHIPPED = ["roles", "schemas", "hooks", "rubricDefault", "checksDefault"];

/**
 * The CLI path `paths` returns is a filename pipeline.ts writes down, and the bundle that has to
 * exist under it is whatever tsup.config.ts names its second entry. Comparing the reported path
 * with an `existsSync` of itself proves nothing, so the build configuration is the cross-check.
 * When it builds `marvin-pipe`, the bundle must be on disk and `missing` empty. When it does not,
 * it must build the server alone: a CLI entry under any other name fails here, rather than
 * leaving `paths` pointing every skill at a file the build never writes.
 */
const TSUP_CONFIG = readFileSync(new URL("../tsup.config.ts", import.meta.url), "utf8");
function assertCliMatchesBundle(p) {
  if (/["']marvin-pipe["']\s*:/.test(TSUP_CONFIG)) {
    assert.ok(existsSync(p.cli), `tsup builds marvin-pipe, so ${p.cli} must exist (npm run build)`);
    assert.deepEqual(p.missing, [], "every shipped path exists, the CLI included");
  } else {
    assert.match(
      TSUP_CONFIG,
      /entry:\s*\[\s*["']src\/server\.ts["']\s*\]/,
      "tsup builds an entry beside the server that is not named marvin-pipe, the CLI name pipeline.ts reports",
    );
    assert.deepEqual(p.missing, ["cli"], "only the not-yet-built CLI is missing");
  }
}

async function call(tool, args) {
  const result = await tool.handler(args);
  return { text: textOf(result), isError: !!result.isError, structured: result.structuredContent };
}

const withHome = (fn) => async () => {
  const home = mkdtempSync(join(tmpdir(), "pipe-tool-home-"));
  try {
    await fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};

/** A run that is mid-flight: a PR open, a question pending, two children behind it. */
function seedRun(home, id = "r20261009-1200-00ab") {
  const runDir = join(home, "osint-chat-client", id);
  const base = rs.initRun({
    id,
    repoRoot: "/x/osint-chat-client",
    base: "dev",
    lang: "ru",
    orchestratorName: "Autopilot",
    task: "Добавить фильтр по тегам",
    taskEnglish: "Add a tag filter",
    stageA: "standard",
    now: new Date("2026-10-09T12:00:00Z"),
  });
  const child = (over) => ({
    sessionId: "s",
    pid: 4242,
    startedAt: "2026-10-09T12:01:00Z",
    endedAt: "2026-10-09T12:20:00Z",
    cacheReadTokens: 1000,
    ...over,
  });
  rs.saveRun(runDir, {
    ...base,
    stage: "awaiting_answer",
    tier: "standard",
    iteration: 2,
    rung: 1,
    prUrl: "https://github.com/acme/osint/pull/7",
    branch: `autopilot/${id}`,
    worktree: join(home, "worktrees", "osint-chat-client", id),
    specPath: "/x/osint-chat-client/.marvin/task/012-tag-filter.md",
    awaitingRole: "executor",
    pendingJudgment: { id: "004-executor_questions", kind: "executor_questions" },
    rejections: [{ iteration: 1, source: "verifier", fingerprints: ["coverage|src/a.ts|AC2"] }],
    children: [
      child({
        name: `${id}-executor-1`,
        role: "executor",
        iteration: 1,
        assignment: { model: "sonnet", effort: "high" },
        status: "done",
        costUsd: 0.5,
      }),
      child({
        name: `${id}-executor-2`,
        role: "executor",
        iteration: 2,
        assignment: { model: "sonnet", effort: "xhigh" },
        status: "needs_input",
        costUsd: 0.25,
        endedAt: null,
      }),
    ],
  });
  return { id, runDir };
}

// ── paths ────────────────────────────────────────────────────────────────────

test(
  "paths resolves every shipped asset from the plugin root, and each one exists",
  withHome(async (home) => {
    const tool = buildPipelineTool(PLUGIN_ROOT, { MARVIN_PIPELINE_HOME: home });
    const r = await call(tool, { action: "paths" });
    assert.equal(r.isError, false, r.text);
    const p = r.structured;
    assert.deepEqual(
      Object.keys(p).sort(),
      [...SHIPPED, "cli", "stateRoot", "missing"].sort(),
      "the plan's seven paths plus the list of shipped ones that are absent",
    );
    for (const key of [...SHIPPED, "cli", "stateRoot"]) {
      assert.ok(isAbsolute(p[key]), `${key} is absolute: ${p[key]}`);
      assert.match(r.text, new RegExp(p[key].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), key);
    }
    for (const key of SHIPPED) {
      assert.ok(existsSync(p[key]), `${key} exists: ${p[key]}`);
      assert.ok(!relative(PLUGIN_ROOT, p[key]).startsWith(".."), `${key} lies in the plugin`);
    }
    assert.equal(p.stateRoot, home, "MARVIN_PIPELINE_HOME names the state root");
    assert.equal(p.cli, join(PLUGIN_ROOT, "mcp", "server", "dist", "marvin-pipe.js"));
    assertCliMatchesBundle(p);

    // The directories are the pipeline's own, not look-alikes: the child guards live in
    // pipeline/hooks, while the plugin's top-level hooks/ holds the session guards.
    assert.ok(existsSync(join(p.roles, "common.md")));
    assert.ok(existsSync(join(p.schemas, "executor.schema.json")));
    assert.ok(existsSync(join(p.hooks, "child-git-guard.mjs")));
    assert.ok(!existsSync(join(p.hooks, "bypass-guard.mjs")));
    assert.match(p.rubricDefault, /rubric\.default\.yaml$/);
    assert.match(p.checksDefault, /checks\.default\.yaml$/);
  }),
);

test("paths names an asset the plugin does not ship as missing, without failing", async () => {
  const fakeRoot = mkdtempSync(join(tmpdir(), "pipe-tool-pack-"));
  try {
    mkdirSync(join(fakeRoot, "pipeline", "roles"), { recursive: true });
    const tool = buildPipelineTool(fakeRoot, { MARVIN_PIPELINE_HOME: fakeRoot });
    const r = await call(tool, { action: "paths" });
    assert.equal(r.isError, false);
    assert.deepEqual(r.structured.missing, [
      "cli",
      "schemas",
      "hooks",
      "rubricDefault",
      "checksDefault",
    ]);
    assert.match(r.text, /missing/i);
  } finally {
    rmSync(fakeRoot, { recursive: true, force: true });
  }
});

test("paths without MARVIN_PIPELINE_HOME falls back to the per-user state directory", async () => {
  const tool = buildPipelineTool(PLUGIN_ROOT, {});
  const r = await call(tool, { action: "paths" });
  assert.equal(r.structured.stateRoot, rs.stateRoot({}));
  assert.match(r.structured.stateRoot, /marvin-pipeline$/);
});

test("an empty or relative MARVIN_PIPELINE_HOME is refused by both actions, never read from the cwd", async () => {
  // run-store keeps the variable as written, and a relative root would resolve against the
  // server's cwd: in a session that is the user's project, so status would read any run.json
  // there. Both actions refuse instead, and name the variable to fix.
  for (const value of ["", "rel/home"]) {
    const tool = buildPipelineTool(PLUGIN_ROOT, { MARVIN_PIPELINE_HOME: value });
    const shown = JSON.stringify(value).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    for (const args of [
      { action: "paths" },
      { action: "status", runDir: join(process.cwd(), "repo", "r1") },
    ]) {
      const r = await call(tool, args);
      const label = `${JSON.stringify(value)} ${args.action}`;
      assert.equal(r.isError, true, label);
      assert.match(
        r.text,
        new RegExp(`MARVIN_PIPELINE_HOME is set to ${shown}, which is not an absolute path`),
        label,
      );
      assert.equal(r.structured, undefined, `${label}: no paths and no run are returned`);
    }
  }
});

test("paths refuses a runDir, which only status reads", async () => {
  const tool = buildPipelineTool(PLUGIN_ROOT, { MARVIN_PIPELINE_HOME: tmpdir() });
  const r = await call(tool, { action: "paths", runDir: "/somewhere" });
  assert.equal(r.isError, true);
  assert.match(r.text, /runDir/);
});

// ── status ───────────────────────────────────────────────────────────────────

test(
  "status reads a run back: stage, tier, iteration, PR, the pending judgment and its children",
  withHome(async (home) => {
    const { id, runDir } = seedRun(home);
    const tool = buildPipelineTool(PLUGIN_ROOT, { MARVIN_PIPELINE_HOME: home });
    const r = await call(tool, { action: "status", runDir });
    assert.equal(r.isError, false, r.text);
    const s = r.structured;
    assert.equal(s.runDir, runDir);
    assert.equal(s.id, id);
    assert.equal(s.stage, "awaiting_answer");
    assert.equal(s.haltReason, null);
    assert.equal(s.tier, "standard");
    assert.equal(s.stageA, "standard");
    assert.equal(s.iteration, 2);
    assert.equal(s.rung, 1);
    assert.equal(s.prUrl, "https://github.com/acme/osint/pull/7");
    assert.deepEqual(s.pendingJudgment, {
      id: "004-executor_questions",
      kind: "executor_questions",
    });
    assert.equal(s.rejections, 1);
    assert.equal(s.children.total, 2);
    assert.equal(s.children.running, 0);
    assert.deepEqual(s.children.byStatus, { done: 1, needs_input: 1 });
    assert.equal(s.children.costUsd, 0.75);
    assert.deepEqual(
      s.children.rows.map((c) => [c.name, c.role, c.iteration, c.status, c.model, c.effort]),
      [
        [`${id}-executor-1`, "executor", 1, "done", "sonnet", "high"],
        [`${id}-executor-2`, "executor", 2, "needs_input", "sonnet", "xhigh"],
      ],
    );

    assert.match(r.text, new RegExp(id));
    assert.match(r.text, /awaiting_answer/);
    assert.match(r.text, /004-executor_questions/);
    assert.match(r.text, /pull\/7/);
    assert.match(r.text, /sonnet\/xhigh/);
  }),
);

test(
  "status reports a halt and a run with no children, no PR and no judgment",
  withHome(async (home) => {
    const runDir = join(home, "repo", "r1");
    const run = rs.initRun({
      id: "r1",
      repoRoot: "/x/repo",
      base: "dev",
      lang: "en",
      orchestratorName: "A",
      task: "t",
      taskEnglish: "t",
      stageA: "light",
      now: new Date("2026-10-09T12:00:00Z"),
    });
    rs.saveRun(runDir, rs.transition(run, "halted", new Date(), "user cancelled"));
    const tool = buildPipelineTool(PLUGIN_ROOT, { MARVIN_PIPELINE_HOME: home });
    const r = await call(tool, { action: "status", runDir });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.structured.stage, "halted");
    assert.equal(r.structured.haltReason, "user cancelled");
    assert.equal(r.structured.tier, null);
    assert.equal(r.structured.prUrl, null);
    assert.equal(r.structured.pendingJudgment, null);
    assert.deepEqual(r.structured.children, {
      total: 0,
      running: 0,
      byStatus: {},
      costUsd: null,
      rows: [],
    });
    assert.match(r.text, /user cancelled/);
  }),
);

test(
  "status refuses a run directory outside the state root, however it is spelled",
  withHome(async (home) => {
    const root = join(home, "state");
    mkdirSync(root);
    // A well-formed run that lives outside the state root: a refusal here is about WHERE the
    // file is, not about whether it parses.
    const { runDir: outside } = seedRun(join(home, "elsewhere"));
    mkdirSync(join(root, "repo"));
    // A run directory inside the root that is a link out of it, and a real run directory inside
    // the root whose run.json is a link out of it: both resolve to the outside file.
    symlinkSync(outside, join(root, "repo", "linked"));
    mkdirSync(join(root, "repo", "file-linked"));
    symlinkSync(join(outside, "run.json"), join(root, "repo", "file-linked", "run.json"));
    const tool = buildPipelineTool(PLUGIN_ROOT, { MARVIN_PIPELINE_HOME: root });

    // An alias outside the root that leads to another outside directory is still outside.
    symlinkSync(join(home, "elsewhere"), join(home, "alias-out"));

    for (const runDir of [
      outside,
      `${root}/../elsewhere/osint-chat-client/r20261009-1200-00ab`,
      join(home, "alias-out", "osint-chat-client", "r20261009-1200-00ab"),
      // Absent and outside: the same refusal as a present one, so the answer never says
      // whether a path outside the root exists.
      join(home, "elsewhere", "nope"),
      join(root, "repo", "linked"),
      join(root, "repo", "file-linked"),
      root,
    ]) {
      const r = await call(tool, { action: "status", runDir });
      assert.equal(r.isError, true, `${runDir} must be refused`);
      assert.match(r.text, /state root/, runDir);
      assert.equal(r.structured, undefined, "no run is read back");
    }
  }),
);

test(
  "status reads a run inside the root whichever spelling of the root it is given",
  withHome(async (home) => {
    // The root and the run directory can name the same place through different spellings: a
    // MARVIN_PIPELINE_HOME behind a symlink with a run dir printed in resolved form, or a
    // resolved MARVIN_PIPELINE_HOME with a run dir spelled through an alias (macOS's tmpdir()
    // is /var/folders, which is /private/var/folders). Both are runs inside the root.
    const real = join(realpathSync(home), "real");
    mkdirSync(real);
    const link = join(home, "link");
    symlinkSync(real, link);
    const { id } = seedRun(real);
    const rel = join("osint-chat-client", id);

    for (const [stateHome, runDir, label] of [
      [link, join(link, rel), "linked root, linked spelling"],
      [link, join(real, rel), "linked root, resolved spelling"],
      [real, join(real, rel), "resolved root, resolved spelling"],
      [real, join(link, rel), "resolved root, linked spelling"],
    ]) {
      const tool = buildPipelineTool(PLUGIN_ROOT, { MARVIN_PIPELINE_HOME: stateHome });
      const r = await call(tool, { action: "status", runDir });
      assert.equal(r.isError, false, `${label}: ${r.text}`);
      assert.equal(r.structured.id, id, label);
    }

    // An alias that resolves inside the root is held to the same checks as any other path
    // there: a run directory that is not a run is reported as such, not read.
    mkdirSync(join(real, "repo", "empty"), { recursive: true });
    const tool = buildPipelineTool(PLUGIN_ROOT, { MARVIN_PIPELINE_HOME: real });
    const r = await call(tool, { action: "status", runDir: join(link, "repo", "empty") });
    assert.equal(r.isError, true);
    assert.match(r.text, /no run\.json/);
  }),
);

test(
  "status reads a run whose repository name merely starts with two dots",
  withHome(async (home) => {
    // `..dotted` is a name inside the root, not a step out of it; a prefix test on ".." would
    // refuse it.
    const { id, runDir } = seedRun(join(home, "..dotted-parent"));
    const tool = buildPipelineTool(PLUGIN_ROOT, { MARVIN_PIPELINE_HOME: home });
    const r = await call(tool, { action: "status", runDir });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.structured.id, id);
  }),
);

test(
  "status refuses a relative, absent, missing or malformed run, and never writes",
  withHome(async (home) => {
    const tool = buildPipelineTool(PLUGIN_ROOT, { MARVIN_PIPELINE_HOME: home });
    const empty = join(home, "repo", "empty");
    mkdirSync(empty, { recursive: true });
    const broken = join(home, "repo", "broken");
    mkdirSync(broken);
    writeFileSync(join(broken, "run.json"), JSON.stringify({ version: 2, id: "x" }));
    const garbled = join(home, "repo", "garbled");
    mkdirSync(garbled);
    writeFileSync(join(garbled, "run.json"), "{ not json");

    const cases = [
      [{ action: "status" }, /runDir/],
      [{ action: "status", runDir: "repo/empty" }, /absolute/],
      [{ action: "status", runDir: join(home, "repo", "nope") }, /no run directory/],
      [{ action: "status", runDir: empty }, /no run\.json/],
      [{ action: "status", runDir: broken }, /not a valid run/],
      [{ action: "status", runDir: garbled }, /not a valid run/],
    ];
    for (const [args, pattern] of cases) {
      const r = await call(tool, args);
      assert.equal(r.isError, true, JSON.stringify(args));
      assert.match(r.text, pattern, JSON.stringify(args));
    }
    assert.deepEqual(readdirSync(empty), [], "status wrote nothing");
    assert.deepEqual(readdirSync(broken), ["run.json"], "status wrote nothing");
  }),
);

test("a missing state root is refused as such, not as a path outside it", async () => {
  const gone = join(tmpdir(), `pipe-tool-gone-${process.pid}-${Date.now()}`);
  const tool = buildPipelineTool(PLUGIN_ROOT, { MARVIN_PIPELINE_HOME: gone });
  const r = await call(tool, { action: "status", runDir: join(gone, "repo", "r1") });
  assert.equal(r.isError, true);
  assert.match(r.text, /state root .* does not exist/);
});

// ── over stdio: registration, the committed bundle's paths, strict input ─────

/** Every tool the server registers, in registration order. Adding a tool changes this list. */
const TOOLS = [
  "task",
  "task-detail",
  "tracker",
  "help",
  "dashboard",
  "verify",
  "spec",
  "metrics",
  "lessons",
  "handoff",
  "summary",
  "adr",
  "audit",
  "report",
  "pipeline",
];

test("the server registers fifteen tools, pipeline last, text-only", async () => {
  const listed = await withSession({}, (s) => s.request("tools/list", {}));
  assert.deepEqual(
    listed.tools.map((t) => t.name),
    TOOLS,
  );
  const tool = listed.tools.find((t) => t.name === "pipeline");
  assert.equal(tool._meta?.ui, undefined, "text-only: no widget bound");
  assert.match(tool.description, /marvin-pipe/);
  assert.deepEqual(tool.inputSchema.properties.action.enum, ["paths", "status"]);
});

test(
  "the bundle's paths resolve from where the server is installed and exist",
  withHome(async (home) => {
    const r = await callTool(
      "pipeline",
      { action: "paths" },
      { env: { MARVIN_PIPELINE_HOME: home } },
    );
    assert.notEqual(r.isError, true, textOf(r));
    const p = r.structuredContent;
    const dist = dirname(SERVER_PATH);
    assert.equal(p.cli, join(dist, "marvin-pipe.js"), "the CLI sits beside the server bundle");
    for (const key of SHIPPED) assert.ok(existsSync(p[key]), `${key} exists: ${p[key]}`);
    assert.ok(existsSync(p.stateRoot));
    assertCliMatchesBundle(p);
  }),
);

test(
  "the bundle reads a fixture run back and refuses one outside the state root",
  withHome(async (home) => {
    const { id, runDir } = seedRun(join(home, "state"));
    const { runDir: outside } = seedRun(join(home, "other"));
    const env = { MARVIN_PIPELINE_HOME: join(home, "state") };
    const ok = await callTool("pipeline", { action: "status", runDir }, { env });
    assert.notEqual(ok.isError, true, textOf(ok));
    assert.equal(ok.structuredContent.id, id);
    assert.equal(ok.structuredContent.stage, "awaiting_answer");
    assert.equal(ok.structuredContent.children.total, 2);

    const refused = await callTool("pipeline", { action: "status", runDir: outside }, { env });
    assert.equal(refused.isError, true);
    assert.match(textOf(refused), /state root/);
  }),
);

test("pipeline rejects an undeclared argument instead of stripping it", async () => {
  const r = await callTool("pipeline", { action: "status", rundir: "/tmp/x" });
  assert.equal(r.isError, true, "an undeclared key is not silently stripped");
  assert.match(textOf(r), /rundir/, "the error names the argument");
});
