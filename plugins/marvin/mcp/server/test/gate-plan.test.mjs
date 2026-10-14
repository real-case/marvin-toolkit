import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";

/**
 * One resolver for "which gates run here": `verify` and the pipeline's gate stage both overlay
 * `.marvin/config.json` `gates` on stack detection and append `gates.extra` (D-GATEPLAN). Before
 * it, the gate stage ran the config's gates alone, so a standard gate a project left undeclared
 * ran only in the executor's own self-check and never in the gate that judges it.
 *
 * `verify` is driven through its handler on the compiled `src/` (the `_tsload.mjs` pattern), the
 * way `spec-next-base.test.mjs` drives `spec`: the committed `dist/server.js` is rebuilt by the
 * integration step, so a stdio test here would exercise the bundle from before this change.
 */

const { resolveGatePlan, unambiguousStackId, GATE_NAMES, evidenceGap } =
  await importTs("src/lib/gate-plan.ts");
const { buildVerifyTool } = await importTs("src/tools/verify.ts");
const { loadEnv } = await importTs("src/lib/env.ts");
const { loadConfig } = await importTs("src/storage/config.ts");
const { stageGates, evidenceFindings, runConfig } = await importTs("src/pipeline/runtime.ts");
const { Config } = await importTs("src/storage/schema.ts");
const { repoWithOrigin, sh } = await import("./_pipeline-git.mjs");

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "gate-plan-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

const TS_CONFIG = {
  gates: {
    test: "node --test test/",
    extra: [{ name: "format", command: "npx prettier --check ." }],
  },
};

test("config gates replace detected ones by name, the rest stay detected, extras come last", () => {
  const dir = project({ "tsconfig.json": "{}\n" });
  const plan = resolveGatePlan({ projectRoot: dir, gates: TS_CONFIG.gates });
  assert.deepEqual(
    plan.gates.map((g) => [g.name, g.command]),
    [
      ["test", "node --test test/"],
      ["lint", "npx eslint ."],
      ["typecheck", "npx tsc --noEmit"],
      ["build", "npm run build"],
      ["format", "npx prettier --check ."],
    ],
  );
  assert.deepEqual(plan.stacks, ["TypeScript", ".marvin/config.json"]);
  assert.deepEqual(
    plan.extra.map((g) => g.name),
    ["format"],
  );
  assert.equal(plan.usesExtras, true);
});

test("explicit gates and `only` leave the extras out, as verify always did", () => {
  const dir = project({ "go.mod": "module x\n" });
  const explicit = resolveGatePlan({
    projectRoot: dir,
    gates: TS_CONFIG.gates,
    explicit: [{ name: "test", command: "true" }],
  });
  assert.deepEqual(explicit.stacks, ["explicit"]);
  assert.deepEqual(
    explicit.gates.map((g) => g.name),
    ["test"],
  );
  assert.equal(explicit.usesExtras, false);
  const only = resolveGatePlan({ projectRoot: dir, gates: TS_CONFIG.gates, only: ["build"] });
  assert.deepEqual(
    only.gates.map((g) => [g.name, g.command]),
    [["build", "go build ./..."]],
  );
  assert.deepEqual(
    only.detected.map((g) => [g.name, g.command]),
    [
      ["test", "node --test test/"],
      ["lint", "golangci-lint run"],
      ["build", "go build ./..."],
    ],
    "the plan before `only` keeps every gate, config over detection",
  );
  const none = resolveGatePlan({ projectRoot: dir, gates: undefined, only: [] });
  assert.deepEqual(none.gates, []);
  assert.equal(none.usesExtras, false);
});

test("a project with no stack and no declared command resolves to nothing", () => {
  const dir = project({ "README.md": "x\n" });
  const plan = resolveGatePlan({ projectRoot: dir, gates: undefined });
  assert.deepEqual([plan.gates, plan.stacks], [[], []]);
  assert.equal(unambiguousStackId(dir), undefined);
  assert.equal(unambiguousStackId(project({ "go.mod": "x" })), "go");
  assert.equal(unambiguousStackId(project({ "go.mod": "x", "Cargo.toml": "x" })), undefined);
  assert.deepEqual([...GATE_NAMES], ["test", "lint", "typecheck", "build"]);
});

/** The `- **name**: \`command\`` rows of verify's dry-run plan. */
function dryRunPlan(text) {
  return [...text.matchAll(/^- \*\*([^*]+)\*\*: `([^`]*)`$/gm)].map((m) => [m[1], m[2]]);
}

/**
 * A run worktree as `createRunWorktree` makes it: `files` committed and pushed as the base, then a
 * worktree of that commit. `mainConfig`, when given, is written to the main checkout afterwards and
 * left uncommitted, which is where the two configs used to part.
 */
function runWorktree(files, mainConfig) {
  const repo = repoWithOrigin();
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(repo, rel, ".."), { recursive: true });
    writeFileSync(join(repo, rel), body);
  }
  sh(repo, "add", "-f", "-A");
  sh(repo, "commit", "-m", "base files");
  sh(repo, "push", "origin", "HEAD:dev");
  if (mainConfig !== undefined) {
    mkdirSync(join(repo, ".marvin"), { recursive: true });
    writeFileSync(join(repo, ".marvin", "config.json"), JSON.stringify(mainConfig));
  }
  const path = join(mkdtempSync(join(tmpdir(), "gate-plan-wt-")), "wt");
  sh(repo, "worktree", "add", "--detach", path, "HEAD");
  return {
    repo,
    wt: {
      path,
      baseSha: sh(path, "rev-parse", "HEAD"),
      gitDir: sh(path, "rev-parse", "--absolute-git-dir"),
    },
  };
}

test("verify and the gate stage resolve the same plan from the config the run works under", async () => {
  // The executor's `verify` reads the worktree's `.marvin/config.json`: the plugin pins
  // `MARVIN_TASKS_CONFIG` under `CLAUDE_PROJECT_DIR`, which is the worktree. The stage's config
  // is loaded the way `createRuntime` loads it, from the run's base commit, never from a main
  // checkout whose working file may say something else.
  const cases = [
    [{ "tsconfig.json": "{}\n", ".marvin/config.json": JSON.stringify(TS_CONFIG) }],
    [
      {
        "package.json": JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } }),
        ".marvin/config.json": JSON.stringify({ gates: { build: "make all" } }),
      },
      { gates: { build: "exit 3", extra: [{ name: "format", command: "exit 4" }] } },
    ],
    [{ "pyproject.toml": "[x]\n" }],
    [
      {
        ".gitignore": ".marvin/*\n",
        "package.json": JSON.stringify({ scripts: { test: "true", lint: "true" } }),
      },
      { gates: { lint: "exit 3", extra: [{ name: "format", command: "exit 4" }] } },
    ],
  ];
  for (const [files, mainConfig] of cases) {
    const { wt } = runWorktree(files, mainConfig);
    const tool = buildVerifyTool(loadEnv({ CLAUDE_PROJECT_DIR: wt.path }));
    const result = await tool.handler(tool.inputSchema.parse({ dryRun: true }));
    const verifyPlan = dryRunPlan(result.content.map((c) => c.text).join("\n"));
    assert.ok(verifyPlan.length > 0, JSON.stringify(files));
    const scratch = mkdtempSync(join(tmpdir(), "gate-plan-run-"));
    const { config } = runConfig(wt, join(scratch, "base-config.json"), wt.path);
    const stage = stageGates(wt.path, config).map((g) => [g.name, g.command]);
    assert.deepEqual(stage, verifyPlan, JSON.stringify(files));
  }
});

test("a plan with no test evidence is refused by verify's delivery gate and by the gate stage alike", async () => {
  // PATH holds `sh` alone, so the detected `pytest`, `ruff` and `mypy` are absent whatever this
  // machine has. Verify's delivery gate refuses on its own verdict; the stage, which D20 makes
  // authoritative, must refuse the same plan, not pass it on the oracles alone.
  const bin = mkdtempSync(join(tmpdir(), "gate-plan-bin-"));
  symlinkSync("/bin/sh", join(bin, "sh"));
  const cases = [
    { files: { "pyproject.toml": "[x]\n" }, blocked: "G-no-test-evidence" },
    {
      files: { "pyproject.toml": "[x]\n", ".marvin/config.json": '{"gates":{"test":"true"}}' },
      blocked: null,
    },
    {
      files: { "Package.swift": "x\n", ".marvin/config.json": '{"gates":{"test":"true"}}' },
      blocked: null,
    },
    // No `test` gate is planned at all, and the one gate there is cannot run.
    {
      files: { "package.json": JSON.stringify({ scripts: { lint: "eslint ." } }) },
      blocked: "G-no-evidence",
    },
  ];
  const path = process.env.PATH;
  for (const { files, blocked } of cases) {
    const dir = project(files);
    const tool = buildVerifyTool(loadEnv({ CLAUDE_PROJECT_DIR: dir }));
    process.env.PATH = bin;
    let stage;
    let decision;
    try {
      await tool.handler(tool.inputSchema.parse({ mode: "standalone" }));
      const gate = await tool.handler(tool.inputSchema.parse({ action: "gate" }));
      decision = JSON.parse(
        /```json deliver-gate\n([\s\S]*?)\n```/.exec(gate.content[0].text)[1],
      ).decision;
      const { config } = loadConfig(join(dir, ".marvin", "config.json"), dir);
      stage = evidenceFindings(stageGates(dir, config));
    } finally {
      process.env.PATH = path;
    }
    assert.deepEqual(
      stage.map((f) => [f.id, f.severity]),
      blocked === null ? [] : [[blocked, "blocker"]],
      JSON.stringify(files),
    );
    assert.equal(decision, blocked === null ? "ALLOW" : "BLOCK", JSON.stringify(files));
  }
});

test("a project with no gate at all gives verify no verdict to deliver and the stage a blocker", () => {
  const dir = project({ "README.md": "x\n" });
  assert.deepEqual(stageGates(dir, Config.parse({})), []);
  assert.deepEqual(
    evidenceFindings([]).map((f) => [f.id, f.severity]),
    [["G-no-evidence", "blocker"]],
  );
  assert.equal(evidenceGap([]), null, "an empty plan is the stage's to judge: verify writes none");
  assert.equal(
    evidenceGap([
      { name: "test", ran: false },
      { name: "lint", ran: true },
    ]),
    "test",
  );
  assert.equal(evidenceGap([{ name: "build", ran: false }]), "all");
  assert.equal(evidenceGap([{ name: "build", ran: true }]), null);
});

test("a gate whose binary is absent is not-run in verify and in the gate stage alike", async () => {
  // A detected gate is exactly where the two could part: the config pins `test`, detection adds
  // `ruff check .` and `mypy .`, and neither tool is installed. PATH holds `sh` alone for the
  // duration, so the answer does not depend on what this machine happens to have.
  const dir = project({
    "pyproject.toml": "[x]\n",
    ".marvin/config.json": JSON.stringify({ gates: { test: "true" } }),
  });
  const bin = mkdtempSync(join(tmpdir(), "gate-plan-bin-"));
  symlinkSync("/bin/sh", join(bin, "sh"));
  const path = process.env.PATH;
  process.env.PATH = bin;
  try {
    const tool = buildVerifyTool(loadEnv({ CLAUDE_PROJECT_DIR: dir }));
    const result = await tool.handler(tool.inputSchema.parse({ mode: "standalone", write: false }));
    const text = result.content.map((c) => c.text).join("\n");
    const block = JSON.parse(/```json verify-result\n([\s\S]*?)\n```/.exec(text)[1]);
    assert.equal(block.verdict, "PASS WITH WARNINGS");
    const notRun = block.gates.filter((g) => g.status === "not-run").map((g) => g.name);
    assert.deepEqual(notRun, ["lint", "typecheck"]);

    const { config } = loadConfig(join(dir, ".marvin", "config.json"), dir);
    const stage = stageGates(dir, config);
    assert.deepEqual(
      stage.map((g) => [g.name, g.missing ?? null]),
      [
        ["test", null],
        ["lint", "ruff"],
        ["typecheck", "mypy"],
      ],
    );
    assert.deepEqual(
      stage.filter((g) => g.missing !== undefined).map((g) => g.name),
      notRun,
      "the stage leaves out exactly the gates verify records as not-run",
    );
  } finally {
    process.env.PATH = path;
  }
});
