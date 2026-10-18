import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { importTs } from "./_tsload.mjs";
import { repoWithOrigin, sh } from "./_pipeline-git.mjs";

/**
 * `createRuntime` against real git and fake children: every child is `node -e` printing the
 * result event its `MARVIN_PIPELINE_FAKE_<ROLE>` fixture names, so no `claude` is launched. What
 * the real child would have been launched with is in `<key>.command.json`, which is what the
 * launch tests read.
 */

const { createRuntime, childKey, fakeScriptVariable, fakeVariable } =
  await importTs("src/pipeline/runtime.ts");
const rs = await importTs("src/pipeline/run-store.ts");
const { loadRubric } = await importTs("src/pipeline/assess.ts");
const { decide } = await importTs("src/pipeline/engine.ts");
const { runEngine } = await importTs("src/pipeline/loop.ts");
const { Config } = await importTs("src/storage/schema.ts");
const { contractHash } = await importTs("src/storage/spec.ts");
const { launchDetached } = await importTs("src/pipeline/launch.ts");
const { buildVerifyTool } = await importTs("src/tools/verify.ts");
const { loadEnv } = await importTs("src/lib/env.ts");

const pluginRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pipelineDir = join(pluginRoot, "pipeline");
const rubric = loadRubric(readFileSync(join(pipelineDir, "rubric.default.yaml"), "utf8"), null);
const PR = "https://github.com/o/r/pull/1";
const ROLES = ["planner", "test-author", "executor", "verifier", "retro"];

for (const name of [
  ...ROLES.map(fakeVariable),
  ...ROLES.map(fakeScriptVariable),
  "MARVIN_PIPELINE_FAKE_CI",
  "MARVIN_PIPELINE_PLUGIN_DIR",
  "MARVIN_PIPELINE_SANDBOX",
  "MARVIN_PIPELINE_MODEL_OVERRIDE",
]) {
  delete process.env[name];
}
// Every spawn here runs a fake. Should one ever miss its fixture, the `claude` it would launch is
// this stub, which exits at once, never a real session; `gh` is one too, so that no test reaches
// GitHub and a CI look fails fast.
const stubBin = mkdtempSync(join(tmpdir(), "pipe-bin-"));
writeFileSync(join(stubBin, "claude"), "#!/bin/sh\nexit 97\n", { mode: 0o755 });
writeFileSync(join(stubBin, "gh"), "#!/bin/sh\necho 'gh: a test stub' >&2\nexit 1\n", {
  mode: 0o755,
});
process.env.PATH = `${stubBin}:${process.env.PATH}`;

function write(root, rel, body) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
}

/** A spec whose contract names `files` and one criterion proved by `run`, sealed unless `tamper`. */
function specText({
  slug = "tag-filter",
  risk = "low",
  files = ["src/a.mjs"],
  tracker,
  tamper,
} = {}) {
  const block = [
    "files:",
    ...files.map((p, i) => `  - { id: F${i + 1}, path: ${p}, action: new, satisfies: [AC1] }`),
    "criteria:",
    "  - id: AC1",
    "    statement: the module exists",
    "    implemented_by: [F1]",
    '    oracle: { kind: command, run: "true" }',
  ].join("\n");
  const front = [
    "---",
    `slug: ${slug}`,
    "type: feature",
    "status: ready",
    `risk: ${risk}`,
    ...(tracker ? [`tracker: ${tracker}`] : []),
    `contract_sha: ${contractHash(block)}`,
    "---",
  ].join("\n");
  const shipped = tamper ? block.replace("the module exists", "anything") : block;
  return `${front}\n# ${slug}\n\n\`\`\`yaml spec-contract\n${shipped}\n\`\`\`\n`;
}

/**
 * A repository with `files` on origin/dev, a state home of its own (`MARVIN_PIPELINE_HOME`, read
 * when `prepare` runs), a saved run at intake and its runtime.
 */
function setup({
  files = {},
  config = {},
  stageA = "light",
  options = {},
  loadConfig = false,
} = {}) {
  const repo = repoWithOrigin();
  if (Object.keys(files).length > 0) {
    for (const [rel, body] of Object.entries(files)) write(repo, rel, body);
    sh(repo, "add", "-f", "-A");
    sh(repo, "commit", "-m", "base files");
    sh(repo, "push", "origin", "HEAD:dev");
  }
  const home = mkdtempSync(join(tmpdir(), "pipe-home-"));
  process.env.MARVIN_PIPELINE_HOME = home;
  const runDir = join(home, basename(repo), "r1");
  const run = rs.initRun({
    id: "r1",
    repoRoot: repo,
    base: "dev",
    lang: "ru",
    orchestratorName: "Autopilot",
    task: "добавить фильтр",
    taskEnglish: "Add a tag filter",
    stageA,
    now: new Date(),
  });
  rs.saveRun(runDir, run);
  const deps = createRuntime({
    runDir,
    pluginRoot,
    rubric,
    ...(loadConfig ? {} : { config: Config.parse(config) }),
    pollMs: 20,
    ...options,
  });
  return { repo, home, runDir, run, deps };
}

async function prepared(o) {
  const s = setup(o);
  s.run = await s.deps.prepare(s.run);
  s.wt = s.run.worktree;
  return s;
}

/** Sets the fake fixture of `role` for the duration of `fn`. */
async function withFake(dir, role, output, fn) {
  const file = join(dir, `fake-${role}-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(output));
  process.env[fakeVariable(role)] = file;
  try {
    return await fn();
  } finally {
    delete process.env[fakeVariable(role)];
  }
}

const spawnAction = (role, iteration, context, resume = false, assignment) => ({
  kind: "spawn",
  role,
  assignment: assignment ?? { model: "sonnet", effort: "medium" },
  iteration,
  context,
  resume,
});
const step = (ref, replay = false) => ({ ref, replay });
const EXECUTOR_CONTEXT = {
  run: "r1",
  tier: "light",
  iteration: "1",
  branch: "autopilot/r1",
  spec: ".marvin/task/001-tag-filter.md",
  base: "dev",
  sealed: "(none)",
  findings: "(none)",
};
const DONE = { status: "done", summary: "ok", claims: ["src/a.mjs adds x"], pr_url: PR };
const command = (runDir, key) =>
  JSON.parse(readFileSync(join(runDir, `${key}.command.json`), "utf8"));
const after = (argv, flag) => argv[argv.indexOf(flag) + 1];
const events = (runDir) =>
  readFileSync(join(runDir, "events.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

async function waitFor(deps, run) {
  const out = await deps.waitChild(run);
  assert.notEqual(out.obs.result.outcome, "running", "the fake child did not finish in time");
  return out;
}

/**
 * Puts a `gh` ahead of the module's failing stub for the duration of `fn`. It answers
 * `pr view` with `view` and `api` with `runs`, both of which `fn` may change through the
 * `answer` it is given, and logs every call, one line of arguments each, to the returned `calls`.
 */
async function withGh(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pipe-gh-"));
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  writeFileSync(
    join(dir, "gh"),
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> '${log}'`,
      'case "$1 $2" in',
      `  "pr view") cat '${join(dir, "view.json")}' ;;`,
      '  "pr ready") exit 0 ;;',
      `  "api "*) cat '${join(dir, "runs.json")}' ;;`,
      '  *) echo "unexpected gh $*" >&2; exit 1 ;;',
      "esac",
    ].join("\n"),
    { mode: 0o755 },
  );
  const answer = ({ view, runs = [] }) => {
    writeFileSync(join(dir, "view.json"), JSON.stringify(view));
    writeFileSync(join(dir, "runs.json"), JSON.stringify(runs));
  };
  const calls = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const path = process.env.PATH;
  process.env.PATH = `${dir}:${path}`;
  try {
    return await fn({ answer, calls });
  } finally {
    process.env.PATH = path;
  }
}

/** A seal-step marker as `sealWork` writes it once the red runs passed, before the commit. */
function sealedMarker(runDir, ref, wt, headBefore, paths) {
  const sealed = paths.map((path) => ({
    path,
    sha256: createHash("sha256")
      .update(readFileSync(join(wt, path)))
      .digest("hex"),
    criteria: ["AC1"],
  }));
  writeFileSync(
    join(runDir, `seal-${ref}.json`),
    JSON.stringify({ phase: "sealed", headBefore, sealed }),
  );
}

const FAILING_TEST =
  'import test from "node:test";\nimport assert from "node:assert";\ntest("x", () => assert.equal(1, 2));\n';

/** Runs `fn` outside node:test's own context, so that a seal's red run is an ordinary `node --test`. */
async function outsideTestContext(fn) {
  const context = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    return await fn();
  } finally {
    if (context !== undefined) process.env.NODE_TEST_CONTEXT = context;
  }
}

// ---------------------------------------------------------------------------------- prepare

test("prepare makes the run worktree outside the repository and is safe to repeat", async () => {
  const count = join(mkdtempSync(join(tmpdir(), "pipe-count-")), "bootstrap.log");
  const config = { pipeline: { bootstrap: `echo "$HUSKY" >> "${count}"` } };
  const s = setup({ config });
  const first = await s.deps.prepare(s.run);
  const expected = join(s.home, "worktrees", basename(s.repo), "r1");
  assert.equal(first.worktree, expected);
  assert.equal(first.branch, "autopilot/r1");
  assert.equal(sh(expected, "rev-parse", "HEAD"), sh(s.repo, "rev-parse", "origin/dev"));
  assert.equal(readFileSync(count, "utf8"), "0\n", "the bootstrap ran once, with HUSKY=0");
  assert.deepEqual(JSON.parse(readFileSync(join(s.runDir, "sealed.json"), "utf8")), []);
  assert.equal(
    JSON.parse(readFileSync(join(s.runDir, "test-paths.json"), "utf8")).pattern,
    Config.parse({}).pipeline.test_path_pattern,
  );
  const baseline = readFileSync(join(s.runDir, "protected-baseline.json"), "utf8");

  // A restarted engine prepares the same run again: same worktree, no second bootstrap.
  const again = await createRuntime({
    runDir: s.runDir,
    pluginRoot,
    rubric,
    config: Config.parse(config),
  }).prepare(s.run);
  assert.deepEqual([again.worktree, again.branch], [first.worktree, first.branch]);
  assert.equal(readFileSync(count, "utf8"), "0\n");
  assert.equal(readFileSync(join(s.runDir, "protected-baseline.json"), "utf8"), baseline);

  // One that died after creating the worktree and before recording it adopts the worktree.
  const record = JSON.parse(readFileSync(join(s.runDir, "worktree.json"), "utf8"));
  rmSync(join(s.runDir, "worktree.json"));
  const adopted = await createRuntime({
    runDir: s.runDir,
    pluginRoot,
    rubric,
    config: Config.parse(config),
  }).prepare(s.run);
  assert.equal(adopted.worktree, first.worktree);
  assert.deepEqual(
    JSON.parse(readFileSync(join(s.runDir, "worktree.json"), "utf8")).baseSha,
    record.baseSha,
  );
});

test("prepare refuses to adopt anything at the run's path that is not the run's worktree", async () => {
  const s = setup();
  mkdirSync(join(s.home, "worktrees", basename(s.repo), "r1"), { recursive: true });
  await assert.rejects(s.deps.prepare(s.run), /refusing to adopt/);
});

test("a repository whose pipeline config is unusable does not prepare", async () => {
  const s = setup({
    loadConfig: true,
    files: { ".marvin/config.json": JSON.stringify({ pipeline: { stall_minutes: "soon" } }) },
  });
  await assert.rejects(s.deps.prepare(s.run), /does not run on this configuration/);
});

test("the run works under the config its base commit holds, which is the one its children read", async () => {
  // The main checkout's working file says otherwise, uncommitted. The executor's own `verify`
  // reads the worktree's copy (the plugin pins MARVIN_TASKS_CONFIG under CLAUDE_PROJECT_DIR), so
  // a stage that read the main checkout would reject what the executor's self-check passes.
  const spec = ".marvin/task/001-tag-filter.md";
  const committed = { gates: { test: "true", lint: "true" } };
  const s = await prepared({
    loadConfig: true,
    files: { ".marvin/config.json": JSON.stringify(committed) },
  });
  assert.ok(
    !existsSync(join(s.runDir, "events.jsonl")) ||
      !events(s.runDir).some((e) => e.data?.ref === "config:main-checkout"),
    "the two agree, so nothing is said",
  );
  write(
    s.repo,
    ".marvin/config.json",
    JSON.stringify({
      gates: { test: "true", lint: "exit 3", extra: [{ name: "format", command: "exit 4" }] },
    }),
  );
  const again = createRuntime({ runDir: s.runDir, pluginRoot, rubric, pollMs: 20 });
  await again.prepare(s.run);
  const told = events(s.runDir).filter((e) => e.data?.ref === "config:main-checkout");
  assert.equal(told.length, 1);
  assert.match(told[0].text, /the run uses the one committed at dev/);

  write(s.wt, spec, specText());
  write(s.wt, "src/a.mjs", "export const a = 1;\n");
  sh(s.wt, "add", "-f", "-A");
  sh(s.wt, "commit", "-m", "work");
  const run = { ...s.run, stage: "gating", iteration: 1, specPath: spec, prUrl: PR };
  const { obs } = await again.work(run, "gate", undefined, step("gate-cfg"));
  assert.deepEqual(
    obs.report.gates.map((g) => [g.name, g.result]),
    [
      ["oracle:AC1", "pass"],
      ["test", "pass"],
      ["lint", "pass"],
    ],
  );
  const tool = buildVerifyTool(loadEnv({ CLAUDE_PROJECT_DIR: s.wt }));
  const plan = await tool.handler(tool.inputSchema.parse({ dryRun: true }));
  assert.deepEqual(
    [...plan.content[0].text.matchAll(/^- \*\*([^*]+)\*\*: `([^`]*)`$/gm)].map((m) => m[1]),
    ["test", "lint"],
    "the executor's own verify plans the same gates",
  );
});

test("a writing child gets the configured GitHub token as GH_TOKEN; the launch record redacts it", async () => {
  const s = await prepared({
    config: { pipeline: { github: { token_command: "echo gho_configured" } } },
  });
  const fixture = join(s.runDir, "fake.json");
  writeFileSync(fixture, JSON.stringify({ status: "failed", summary: "fake" }));
  for (const role of ROLES) process.env[fakeVariable(role)] = fixture;
  try {
    let run = s.run;
    for (const action of engineContexts(s.run)) {
      run = s.deps.spawnChild(run, action, step(`gh-${action.role}`));
      const { env } = command(s.runDir, `r1-${action.role}-${action.iteration}`);
      if (action.role === "verifier" || action.role === "retro") {
        assert.equal(env.GH_TOKEN, undefined, `${action.role} is read-only and gets no token`);
      } else {
        assert.equal(env.GH_TOKEN, "<redacted>", `${action.role}'s record names the token only`);
      }
    }
  } finally {
    for (const role of ROLES) delete process.env[fakeVariable(role)];
  }
  // A token command that fails leaves gh's own authentication in force, and says so once.
  const broken = await prepared({
    config: { pipeline: { github: { token_command: "exit 3" } } },
  });
  process.env[fakeVariable("planner")] = fixture;
  try {
    const [plan] = engineContexts(broken.run);
    broken.deps.spawnChild(broken.run, plan, step("gh-broken"));
    assert.equal(command(broken.runDir, "r1-planner-0").env.GH_TOKEN, undefined);
    assert.ok(events(broken.runDir).some((e) => /github\.token_command failed/.test(e.text)));
  } finally {
    delete process.env[fakeVariable("planner")];
  }
});

test("a gates.test_one the seal stage would refuse stops prepare, before any child", async () => {
  const s = setup({ config: { gates: { test_one: "node --test {file} {name}" } } });
  await assert.rejects(
    s.deps.prepare(s.run),
    /gates\.test_one in \.marvin\/config\.json at dev cannot run a whole test file.*\{name\}/,
  );
  // A filter the seal stage drops, and a quoted {file}, are fine; an absent template is told.
  const ok = setup({ config: { gates: { test_one: 'npx vitest run "{file}" -t "{name}"' } } });
  await ok.deps.prepare(ok.run);
  const none = setup({ config: {} });
  await none.deps.prepare(none.run);
  assert.ok(
    events(none.runDir).some((e) =>
      /no gates\.test_one in \.marvin\/config\.json at dev/.test(e.text),
    ),
  );
});

test("a pipeline config the main checkout holds and the base commit lacks stops prepare", async () => {
  // The marvin-toolkit layout: `.marvin/*` is ignored, so the file never reaches a worktree and
  // no child would ever see the gates it pins.
  const s = setup({ loadConfig: true, files: { ".gitignore": ".marvin/*\n" } });
  write(s.repo, ".marvin/config.json", JSON.stringify({ gates: { test: "true" } }));
  await assert.rejects(
    s.deps.prepare(s.run),
    /\.marvin\/config\.json is not committed at dev .*sets `gates`.*commit it/,
  );
  // A config that carries nothing a run reads is no reason to stop.
  const t = setup({ loadConfig: true, files: { ".gitignore": ".marvin/*\n" } });
  write(t.repo, ".marvin/config.json", JSON.stringify({ base_branch: "dev" }));
  await t.deps.prepare(t.run);
});

// ----------------------------------------------------------------------------- spawn, wait

test("a fake executor is launched with a static system prompt and its result is read back", async () => {
  const s = await prepared({ loadConfig: true });
  const run = { ...s.run, stage: "executing", iteration: 1 };
  await withFake(s.runDir, "executor", DONE, async () => {
    const spawned = s.deps.spawnChild(run, spawnAction("executor", 1, EXECUTOR_CONTEXT), step("a"));
    assert.equal(spawned.children[0].status, "running");
    assert.ok(spawned.children[0].pid > 0);
    const system = readFileSync(join(s.runDir, "executor.system.md"), "utf8");
    assert.equal(
      system,
      `${readFileSync(join(pipelineDir, "roles", "common.md"), "utf8")}\n${readFileSync(join(pipelineDir, "roles", "executor.md"), "utf8")}`,
    );
    const prompt = readFileSync(join(s.runDir, "r1-executor-1.prompt.md"), "utf8");
    assert.match(prompt, /Orchestrator: Autopilot · your name: r1-executor-1/);
    // A command wrapper's `skills/<name>/SKILL.md` is relative to the plugin, which a child in a
    // foreign worktree cannot resolve on its own (the live sandbox planner never found task-start).
    assert.ok(
      prompt.includes(`Marvin plugin: ${resolve(pluginRoot)} · `) &&
        prompt.includes(`means \`${resolve(pluginRoot)}/skills/<name>/…\``),
      prompt,
    );
    assert.match(
      prompt,
      /Lessons:\n\(none\)/,
      "a repository with no .marvin/memory has no lessons",
    );

    const { run: done, obs } = await waitFor(s.deps, spawned);
    assert.equal(obs.result.outcome, "done");
    assert.deepEqual(obs.result.structured.claims, ["src/a.mjs adds x"]);
    assert.equal(obs.leaked, undefined);
    assert.equal(done.children[0].status, "done");
    assert.equal(done.children[0].sessionId, "fake-r1-executor-1");
    assert.ok(existsSync(join(s.runDir, "r1-executor-1.result.json")));
    assert.ok(
      events(s.runDir).some(
        (e) =>
          e.kind === "report" && /^CHILD r1-executor-1 outcome=done/.test(e.text) && e.data.notify,
      ),
    );

    // The next iteration sends the same system prompt, byte for byte (D13).
    const next = { ...done, iteration: 2 };
    s.deps.spawnChild(
      next,
      spawnAction("executor", 2, { ...EXECUTOR_CONTEXT, iteration: "2" }),
      step("b"),
    );
    assert.equal(readFileSync(join(s.runDir, "executor.system.md"), "utf8"), system);
    assert.ok(existsSync(join(s.runDir, "r1-executor-2.prompt.md")));
  });
});

/** One fresh spawn context per role, as `decide` emits them. */
function engineContexts(run) {
  const at = (stage, patch = {}) => ({
    ...run,
    stage,
    specPath: ".marvin/task/001-tag-filter.md",
    tier: "standard",
    ...patch,
  });
  const now = new Date();
  const full = {
    passed: true,
    gates: [],
    undeclared: [],
    protected: [],
    protectedSources: {},
    protectedPatterns: [],
    checks: [],
    sealed: [],
    blockers: [],
  };
  const sealed = { path: "test/a.test.mjs", criteria: ["AC1"], sha256: "0".repeat(64) };
  const decisions = [
    decide({ ...run, stage: "intake", worktree: null }, { kind: "start" }, rubric, now),
    // An approval starts its first child once the spec is committed.
    decide(
      at("awaiting_approval"),
      { kind: "spec_commit", ok: true, commit: "c".repeat(40), reason: null },
      rubric,
      now,
    ),
    decide(
      at("test_authoring"),
      { kind: "seal", ok: true, reasons: [], sealed: [sealed] },
      rubric,
      now,
    ),
    decide(
      at("gating", { iteration: 1, prUrl: PR }),
      { kind: "gate", report: full, findings: [] },
      rubric,
      now,
    ),
    decide(
      at("ci_wait", { iteration: 1, prUrl: PR, ciSince: now.toISOString() }),
      { kind: "ci", state: "green", failing: [] },
      rubric,
      now,
    ),
  ];
  return decisions.flatMap((d) => d.actions.filter((a) => a.kind === "spawn" && !a.resume));
}

test("every role launches with its name, env, settings, schema and allowlist, and renders its real template", async () => {
  const s = await prepared({ config: { gates: { test_one: "node --test {file}" } } });
  const fixture = join(s.runDir, "fake.json");
  writeFileSync(fixture, JSON.stringify({ status: "failed", summary: "fake" }));
  for (const role of ROLES) process.env[fakeVariable(role)] = fixture;
  let run = s.run;
  const names = {};
  try {
    for (const action of engineContexts(s.run)) {
      const { role } = action;
      run = s.deps.spawnChild(run, action, step(`launch-${role}`));
      const name = `r1-${role}-${action.iteration}`;
      names[role] = name;
      const { argv, env, cwd, fake } = command(s.runDir, name);
      assert.equal(fake, fixture);
      assert.equal(argv[0], "claude");
      assert.equal(after(argv, "-n"), name);
      assert.equal(after(argv, "--permission-prompts"), "none");
      assert.equal(after(argv, "--model"), action.assignment.model);
      assert.equal(after(argv, "--effort"), action.assignment.effort);
      assert.equal(after(argv, "--settings"), join(s.runDir, `${role}.settings.json`));
      assert.ok(existsSync(join(s.runDir, `${role}.settings.json`)));
      assert.equal(after(argv, "--append-system-prompt-file"), join(s.runDir, `${role}.system.md`));
      assert.equal(
        after(argv, "--json-schema"),
        readFileSync(join(pipelineDir, "schemas", `${role}.schema.json`), "utf8").trim(),
      );
      assert.equal(after(argv, "--plugin-dir"), resolve(pluginRoot));
      assert.equal(cwd, s.wt);
      assert.deepEqual(
        [
          env.MARVIN_PIPELINE,
          env.MARVIN_PIPELINE_RUN,
          env.MARVIN_PIPELINE_ROLE,
          env.MARVIN_PIPELINE_CHILD,
        ],
        ["1", s.runDir, role, name],
      );
      assert.deepEqual(
        [env.MARVIN_PIPELINE_ORCH, env.MARVIN_PIPELINE_BASE, env.HUSKY],
        ["Autopilot", "dev", "0"],
      );
      assert.deepEqual(
        [
          env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS,
          env.BASH_DEFAULT_TIMEOUT_MS,
          env.BASH_MAX_TIMEOUT_MS,
        ],
        ["1", "600000", "1800000"],
      );
      const tools = argv.slice(argv.indexOf("--allowedTools") + 1);
      if (role === "verifier" || role === "retro") {
        assert.equal(after(argv, "--permission-mode"), "dontAsk");
        assert.ok(!tools.includes("mcp__plugin_marvin_marvin"), role);
        assert.equal(
          tools.includes("Bash(node --test:*)"),
          role === "verifier",
          `${role}: the test probe`,
        );
      } else {
        assert.equal(after(argv, "--permission-mode"), "acceptEdits");
        assert.ok(
          tools.includes("mcp__plugin_marvin_marvin") && tools.includes("Bash(git:*)"),
          role,
        );
      }
      assert.equal(env.MARVIN_PIPELINE_TEST_PATTERN !== undefined, role === "test-author", role);
      assert.equal(env.CI === "true", role === "verifier", role);
      const prompt = readFileSync(join(s.runDir, `${name}.prompt.md`), "utf8");
      assert.ok(!prompt.includes("{{"), `${role}: a placeholder survived`);
      assert.match(prompt, new RegExp(`your name: ${name}`));
    }
    assert.deepEqual(Object.keys(names).sort(), [...ROLES].sort());
    const retro = readFileSync(join(s.runDir, `${names.retro}.prompt.md`), "utf8");
    assert.match(retro, /"iterations": 0/, "the retro gets the run aggregate");

    process.env.MARVIN_PIPELINE_PLUGIN_DIR = "/elsewhere/plugins/marvin";
    s.deps.spawnChild(run, spawnAction("executor", 1, EXECUTOR_CONTEXT), step("plugin-dir"));
    assert.equal(
      after(command(s.runDir, "r1-executor-1.2").argv, "--plugin-dir"),
      "/elsewhere/plugins/marvin",
    );
  } finally {
    delete process.env.MARVIN_PIPELINE_PLUGIN_DIR;
    for (const role of ROLES) delete process.env[fakeVariable(role)];
  }
});

test("the verifier's probe is the whole-file prefix of a test_one that quotes {file} and filters by {name}", async () => {
  const s = await prepared({
    config: { gates: { test_one: 'npx vitest run "{file}" -t "{name}"' } },
  });
  const fixture = join(s.runDir, "fake.json");
  writeFileSync(fixture, JSON.stringify({ status: "failed", summary: "fake" }));
  const verifier = engineContexts(s.run).find((a) => a.role === "verifier");
  process.env[fakeVariable("verifier")] = fixture;
  try {
    s.deps.spawnChild(s.run, verifier, step("launch-verifier"));
    const { argv } = command(s.runDir, `r1-verifier-${verifier.iteration}`);
    const tools = argv.slice(argv.indexOf("--allowedTools") + 1);
    assert.ok(tools.includes("Bash(npx vitest run:*)"), tools.join(" "));
    assert.ok(!tools.some((tool) => tool.includes('"')), "no opening quote is left on the prefix");
  } finally {
    delete process.env[fakeVariable("verifier")];
  }
});

test("a resume continues the role's last session with the message alone; spec_ready carries the spec's signals", async () => {
  const spec = ".marvin/task/001-tag-filter.md";
  const s = await prepared({ files: { [spec]: specText() } });
  const asked = {
    status: "needs_input",
    summary: "one point",
    questions: [{ id: "Q1", text: "?", recommendation: "yes", why_blocking: "b" }],
  };
  const ready = { status: "spec_ready", summary: "sealed", spec: { path: spec } };
  let run = { ...s.run, stage: "planning" };
  await withFake(s.runDir, "planner", [asked, ready], async () => {
    const first = await waitFor(
      s.deps,
      s.deps.spawnChild(run, spawnAction("planner", 0, { task: "t", critic_cap: "1" }), step("p1")),
    );
    assert.equal(first.obs.result.outcome, "needs_input");
    const resumed = s.deps.spawnChild(
      first.run,
      spawnAction("planner", 0, { message: "ANSWERS:\nQ1: yes" }, true),
      step("p2"),
    );
    const key = childKey(first.run.children, "r1-planner-0");
    assert.equal(key, "r1-planner-0.2");
    assert.equal(after(command(s.runDir, key).argv, "--resume"), "fake-r1-planner-0");
    assert.equal(readFileSync(join(s.runDir, `${key}.prompt.md`), "utf8"), "ANSWERS:\nQ1: yes");
    const second = await waitFor(s.deps, resumed);
    assert.equal(second.obs.result.outcome, "spec_ready");
    assert.deepEqual(
      [second.obs.signals.risk, second.obs.signals.files, second.obs.signals.paths],
      ["low", 1, ["src/a.mjs"]],
    );
    // A sealed spec is taken as it is: the gate is not re-run, so this minimal spec still passes.
    assert.equal(second.obs.dorFailures, undefined);
    run = second.run;
  });
  // A spec the engine cannot read makes the turn a crash, which costs a retry, not the engine.
  await withFake(
    s.runDir,
    "planner",
    { ...ready, spec: { path: ".marvin/task/404-missing.md" } },
    async () => {
      const { obs } = await waitFor(
        s.deps,
        s.deps.spawnChild(
          run,
          spawnAction("planner", 0, { task: "t", critic_cap: "1" }),
          step("p3"),
        ),
      );
      assert.equal(obs.result.outcome, "crashed");
      assert.match(obs.result.detail, /cannot read/);
    },
  );
});

/** A feature spec the Definition-of-Ready gate passes in a worktree that holds CLAUDE.md. */
const READY_SPEC = (frontmatterExtra = "") => `---
slug: sample-ready
type: feature
status: ready
created: 2026-10-11
tracker: none
supersedes: none
stack: javascript
risk: low
breaking: false
spike_required: false
test_command: "node --test"
${frontmatterExtra}---

# Sample ready

## Goal
Add a sample doc.

## Spec Contract

\`\`\`yaml spec-contract
files:
  - id: F1
    path: CLAUDE.md
    action: edit
    intent: link the sample
    satisfies: [AC2, AC3]
  - id: F2
    path: docs/sample-new.md
    action: new
    intent: the sample doc
    satisfies: [AC1]
  - id: F3
    path: test/sample.test.mjs
    action: new
    intent: tests for the criteria
    satisfies: [AC1, AC2]
build_order: [F2, F1, F3]
contract:
  kind: none
criteria:
  - id: AC1
    statement: Given the repo, then the sample doc exists
    implemented_by: [F2, F3]
    oracle:
      kind: test
      ref: test/sample.test.mjs::exists
    failure: file missing
  - id: AC2
    statement: Given CLAUDE.md, then it links the sample
    implemented_by: [F1, F3]
    oracle:
      kind: command
      ref: grep -q sample CLAUDE.md
    failure: no link
  - id: AC3
    statement: Given the change, when reviewed, then it reads cleanly
    implemented_by: [F1]
    oracle:
      kind: prose-review
    failure: unclear
\`\`\`

## Chosen Approach
Write the doc and link it.

## Non-goals
- No runtime change.

## Open Questions
none
`;

test("spec_ready on an unsealed spec: the engine stamps the seal once the Definition of Ready passes", async () => {
  const spec = ".marvin/task/001-sample-ready.md";
  // A planner that never ran the seal, one that hashed the block itself (full sha256), and one
  // that stopped before "Write & seal" with the spec still a draft.
  for (const extra of ["", "contract_sha: 4bf8bfcac18850a88e885c5fa83e16f8\n", "draft"]) {
    const draft = extra === "draft";
    const source = draft
      ? READY_SPEC().replace("status: ready", "status: draft")
      : READY_SPEC(extra);
    const s = await prepared({ files: { [spec]: source, "CLAUDE.md": "# Repo\n" } });
    const ready = { status: "spec_ready", summary: "s", spec: { path: spec } };
    const run = { ...s.run, stage: "planning" };
    await withFake(s.runDir, "planner", [ready], async () => {
      const { obs } = await waitFor(
        s.deps,
        s.deps.spawnChild(
          run,
          spawnAction("planner", 0, { task: "t", critic_cap: "1" }),
          step("p1"),
        ),
      );
      assert.equal(obs.result.outcome, "spec_ready");
      assert.equal(obs.dorFailures, undefined);
      assert.equal(obs.signals.risk, "low");
      const text = readFileSync(join(s.wt, spec), "utf8");
      const block = text.match(/```yaml spec-contract\n([\s\S]*?)\n```/)[1];
      assert.deepEqual(text.match(/^contract_sha: .*$/gm), [
        `contract_sha: ${contractHash(block)}`,
      ]);
      assert.deepEqual(text.match(/^status: .*$/gm), ["status: ready"]);
      assert.equal(obs.engineSealed, true);
      assert.ok(existsSync(join(s.wt, ".marvin/metrics/001-sample-ready.md")));
      assert.match(
        events(s.runDir)
          .map((e) => e.text)
          .join("\n"),
        draft
          ? /the engine stamped contract_sha after its Definition of Ready passed and set status: ready in \.marvin\/task\/001-sample-ready\.md/
          : /the engine stamped contract_sha after its Definition of Ready passed in \.marvin\/task\/001-sample-ready\.md/,
      );
    });
  }
});

test("spec_ready on an unsealed spec that fails the Definition of Ready writes nothing and carries the failures", async () => {
  const spec = ".marvin/task/001-tag-filter.md";
  const original = specText({ tamper: true });
  const s = await prepared({ files: { [spec]: original } });
  const ready = { status: "spec_ready", summary: "sealed", spec: { path: spec } };
  const run = { ...s.run, stage: "planning" };
  await withFake(s.runDir, "planner", [ready], async () => {
    const { obs } = await waitFor(
      s.deps,
      s.deps.spawnChild(run, spawnAction("planner", 0, { task: "t", critic_cap: "1" }), step("p1")),
    );
    assert.equal(obs.result.outcome, "spec_ready");
    assert.equal(obs.signals, undefined);
    assert.ok(obs.dorFailures.length > 0);
    assert.equal(readFileSync(join(s.wt, spec), "utf8"), original);
    assert.ok(!existsSync(join(s.wt, ".marvin/metrics")));
  });
});

test("a replayed spawn adopts the child already launched instead of starting another", async () => {
  const s = await prepared();
  const run = { ...s.run, stage: "executing", iteration: 1 };
  await withFake(s.runDir, "executor", DONE, async () => {
    const action = spawnAction("executor", 1, EXECUTOR_CONTEXT);
    const launched = s.deps.spawnChild(run, action, step("same"));
    const replayed = s.deps.spawnChild(run, action, step("same", true));
    assert.equal(replayed.children.length, 1);
    assert.equal(replayed.children[0].pid, launched.children[0].pid);
    assert.equal(events(s.runDir).filter((e) => e.data?.ref === "same").length, 1, "launched once");

    // A fresh launch under a key whose files exist would truncate a child's log and could be
    // judged by its stale exit file. Checked once the child has written them.
    await waitFor(s.deps, replayed);
    assert.throws(
      () => s.deps.spawnChild(run, action, step("other")),
      /refusing to launch over them/,
    );

    // An engine that died after the marker and before the launch left no child: a replay starts it.
    const marker = {
      ref: "lost",
      key: "r1-executor-1",
      name: "r1-executor-1",
      startedAt: new Date().toISOString(),
      pid: null,
    };
    const s2 = await prepared();
    mkdirSync(join(s2.runDir, "spawns"), { recursive: true });
    writeFileSync(join(s2.runDir, "spawns", "lost.json"), JSON.stringify(marker));
    const relaunched = s2.deps.spawnChild({ ...s2.run, iteration: 1 }, action, step("lost", true));
    assert.ok(relaunched.children[0].pid > 0);
    const { obs } = await waitFor(s2.deps, relaunched);
    assert.equal(obs.result.outcome, "done");
  });
});

test("a fake's script runs in the worktree before its result, numbered by spawn; alone it does nothing", async () => {
  const s = await prepared();
  const run = { ...s.run, stage: "executing", iteration: 1 };
  const script = join(s.runDir, "fake-script.mjs");
  writeFileSync(
    script,
    'import { writeFileSync } from "node:fs";\nwriteFileSync(`spawn-${process.argv[2]}.txt`, process.cwd());\n',
  );
  process.env[fakeScriptVariable("executor")] = script;
  try {
    // Without its fake, the script variable changes nothing: the child is the real command
    // (here the failing `claude` stub), and the script never runs.
    const real = await waitFor(
      s.deps,
      s.deps.spawnChild(run, spawnAction("executor", 1, EXECUTOR_CONTEXT), step("real")),
    );
    assert.equal(command(s.runDir, "r1-executor-1").fake, null);
    assert.equal(command(s.runDir, "r1-executor-1").fakeScript, undefined);
    assert.notEqual(real.obs.result.outcome, "done");
    assert.equal(existsSync(join(s.wt, "spawn-1.txt")), false);

    await withFake(s.runDir, "executor", DONE, async () => {
      const action = spawnAction("executor", 2, EXECUTOR_CONTEXT);
      const done = await waitFor(s.deps, s.deps.spawnChild(real.run, action, step("fake")));
      assert.equal(done.obs.result.outcome, "done");
      assert.equal(command(s.runDir, "r1-executor-2").fakeScript, script);
      // The second executor spawn of the run, run with the worktree as its cwd.
      assert.equal(readFileSync(join(s.wt, "spawn-2.txt"), "utf8"), realpathSync(s.wt));
    });

    // A script that fails leaves no result, which reads as a crash.
    writeFileSync(script, "process.exit(3);\n");
    await withFake(s.runDir, "executor", DONE, async () => {
      const action = spawnAction("executor", 3, EXECUTOR_CONTEXT);
      const after = await waitFor(s.deps, s.deps.spawnChild(run, action, step("broken")));
      assert.equal(after.obs.result.outcome, "crashed");
    });
  } finally {
    delete process.env[fakeScriptVariable("executor")];
  }
});

/** Sets the sandbox switches for the duration of `fn`; `undefined` leaves a variable unset. */
async function withSandbox(vars, fn) {
  const names = [
    "MARVIN_PIPELINE_SANDBOX",
    "MARVIN_PIPELINE_MODEL_OVERRIDE",
    "MARVIN_PIPELINE_FAKE_CI",
  ];
  for (const name of names) {
    if (vars[name] === undefined) delete process.env[name];
    else process.env[name] = vars[name];
  }
  try {
    return await fn();
  } finally {
    for (const name of names) delete process.env[name];
  }
}

test("in the sandbox a real child runs on the override's model and finds the gh shim first", async () => {
  const s = await prepared();
  const sandbox = {
    MARVIN_PIPELINE_SANDBOX: "1",
    MARVIN_PIPELINE_MODEL_OVERRIDE: "haiku",
    MARVIN_PIPELINE_FAKE_CI: "green",
  };
  await withSandbox(sandbox, async () => {
    const deps = createRuntime({ runDir: s.runDir, pluginRoot, rubric, pollMs: 20 });
    const run = { ...s.run, stage: "executing", iteration: 1 };
    const planned = { model: "opus", effort: "high" };
    // A real child: the `claude` on PATH is this file's failing stub, so nothing is launched.
    const spawned = deps.spawnChild(
      run,
      spawnAction("executor", 1, EXECUTOR_CONTEXT, false, planned),
      step("sbx"),
    );
    const cmd = command(s.runDir, "r1-executor-1");
    assert.equal(after(cmd.argv, "--model"), "haiku");
    assert.equal(after(cmd.argv, "--effort"), "high", "the rubric's effort stays");
    assert.deepEqual(spawned.children[0].assignment, { model: "haiku", effort: "high" });
    assert.deepEqual(cmd.sandbox, { modelOverride: "haiku", planned });
    const bin = join(s.runDir, "sandbox-bin");
    assert.equal(cmd.env.PATH.split(":")[0], bin);
    assert.ok(existsSync(join(bin, "gh")));
    assert.ok(
      events(s.runDir).some((e) => e.text === "r1-executor-1 started on haiku/high"),
      "the event names the model the child runs on",
    );
    await waitFor(deps, spawned);
  });
});

test("outside the sandbox a model override is refused, and no shim is written", async () => {
  const s = await prepared();
  await withSandbox({ MARVIN_PIPELINE_MODEL_OVERRIDE: "haiku" }, () => {
    assert.throws(
      () => createRuntime({ runDir: s.runDir, pluginRoot, rubric }),
      /MODEL_OVERRIDE is honoured only with MARVIN_PIPELINE_SANDBOX=1/,
    );
  });
  await withSandbox(
    { MARVIN_PIPELINE_SANDBOX: "1", MARVIN_PIPELINE_MODEL_OVERRIDE: "fable" },
    () => {
      assert.throws(
        () => createRuntime({ runDir: s.runDir, pluginRoot, rubric }),
        /Fable is not allowed/,
      );
    },
  );
  await withSandbox({ MARVIN_PIPELINE_SANDBOX: "1" }, () => {
    assert.throws(
      () => createRuntime({ runDir: s.runDir, pluginRoot, rubric }),
      /needs MARVIN_PIPELINE_FAKE_CI/,
    );
  });
  // The plain runtime: the rubric's model, the role's own environment, no shim on disk.
  const run = { ...s.run, stage: "executing", iteration: 1 };
  const spawned = s.deps.spawnChild(
    run,
    spawnAction("executor", 1, EXECUTOR_CONTEXT),
    step("plain"),
  );
  const cmd = command(s.runDir, "r1-executor-1");
  assert.equal(after(cmd.argv, "--model"), "sonnet");
  assert.equal(cmd.env.PATH, undefined);
  assert.equal(cmd.sandbox, undefined);
  assert.equal(existsSync(join(s.runDir, "sandbox-bin")), false);
  await waitFor(s.deps, spawned);
});

test("a crash retry of the same iteration writes files of its own", async () => {
  const s = await prepared();
  const run = { ...s.run, stage: "executing", iteration: 1 };
  await withFake(s.runDir, "executor", [{ status: "lost" }, DONE], async () => {
    const action = spawnAction("executor", 1, EXECUTOR_CONTEXT);
    const crashed = await waitFor(s.deps, s.deps.spawnChild(run, action, step("try1")));
    assert.equal(crashed.obs.result.outcome, "crashed");
    const retried = await waitFor(s.deps, s.deps.spawnChild(crashed.run, action, step("try2")));
    assert.equal(retried.obs.result.outcome, "done");
    const files = readdirSync(s.runDir).filter((f) => f.startsWith("r1-executor-1"));
    for (const ext of [".log.jsonl", ".exit", ".result.json", ".prompt.md", ".command.json"]) {
      assert.ok(
        files.includes(`r1-executor-1${ext}`) && files.includes(`r1-executor-1.2${ext}`),
        ext,
      );
    }
    const firstResult = JSON.parse(
      readFileSync(join(s.runDir, "r1-executor-1.result.json"), "utf8"),
    );
    assert.equal(
      firstResult.result.outcome,
      "crashed",
      "the retry left the first attempt's files alone",
    );
  });
});

test("waitChild reports a child still running when its own deadline passes", async () => {
  const s = await prepared({ options: { childDeadlineMs: 50 } });
  const child = {
    name: "r1-executor-1",
    role: "executor",
    iteration: 1,
    sessionId: null,
    pid: null,
    assignment: { model: "sonnet", effort: "medium" },
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: "running",
    costUsd: null,
    cacheReadTokens: null,
  };
  const run = { ...s.run, stage: "executing", iteration: 1, children: [child] };
  const { run: same, obs } = await s.deps.waitChild(run);
  assert.equal(obs.result.outcome, "running");
  assert.deepEqual(same, run);
});

test("a quiet running child gets one engine status note per interval, naming its call", async () => {
  const s = await prepared({ options: { childDeadlineMs: 400, pollMs: 20, statusAfterMs: 150 } });
  const child = {
    name: "r1-executor-1",
    role: "executor",
    iteration: 1,
    sessionId: null,
    pid: null,
    assignment: { model: "sonnet", effort: "medium" },
    startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    endedAt: null,
    status: "running",
    costUsd: null,
    cacheReadTokens: null,
  };
  writeFileSync(
    join(s.runDir, "r1-executor-1.log.jsonl"),
    `${JSON.stringify({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "tool_use", id: "t1", name: "Bash", input: { description: "Run the gates" } },
        ],
      },
    })}\n`,
  );
  const run = { ...s.run, stage: "executing", iteration: 1, children: [child] };
  const statusNotes = () => events(s.runDir).filter((e) => e.data?.status === true);

  await s.deps.waitChild(run);
  const notes = statusNotes();
  // 400 ms of waiting at a 150 ms interval: the first look is due at once, then one per interval.
  assert.ok(notes.length >= 2 && notes.length <= 3, `got ${notes.length} status notes`);
  const [first] = notes;
  assert.equal(first.kind, "note");
  assert.equal(first.actor, "engine");
  assert.equal(first.data.notify, true);
  assert.equal(first.data.key, "r1-executor-1");
  assert.equal(first.data.tool, "Bash");
  assert.match(
    first.text,
    /^r1-executor-1 still running after 10 min, no report for 10 min; in Bash \(Run the gates\)/,
  );

  // A report the child sent just now resets the clock, and so does a restarted engine's reading of
  // the notes already written: neither waits below the interval gets a new note.
  const before = statusNotes().length;
  const quiet = await prepared({
    options: { childDeadlineMs: 100, pollMs: 20, statusAfterMs: 150 },
  });
  appendFileSync(
    join(quiet.runDir, "events.jsonl"),
    `${JSON.stringify({ ts: new Date().toISOString(), kind: "report", actor: "r1-executor-1", text: "[r1-executor-1] done: x" })}\n`,
  );
  await quiet.deps.waitChild({ ...quiet.run, stage: "executing", iteration: 1, children: [child] });
  assert.equal(events(quiet.runDir).filter((e) => e.data?.status === true).length, 0);
  // A new wait (a restarted engine reads the same events) keeps the interval from the last note.
  const lastBefore = Date.parse(statusNotes().at(-1).ts);
  await s.deps.waitChild({ ...run });
  const firstAfter = statusNotes()[before];
  assert.ok(firstAfter, "a later wait still writes a note once the interval has passed");
  assert.ok(Date.parse(firstAfter.ts) - lastBefore >= 140, "no note before the interval");
});

test("a write into the main checkout during a child is reported as leaked, and decide halts on it", async () => {
  const s = await prepared();
  const run = { ...s.run, stage: "executing", iteration: 1 };
  await withFake(s.runDir, "executor", DONE, async () => {
    const spawned = s.deps.spawnChild(
      run,
      spawnAction("executor", 1, EXECUTOR_CONTEXT),
      step("leak"),
    );
    writeFileSync(join(s.repo, "leak.txt"), "x");
    const { run: seen, obs } = await waitFor(s.deps, spawned);
    assert.deepEqual(obs.leaked, ["?? leak.txt"]);
    const d = decide(seen, obs, rubric, new Date());
    assert.deepEqual(
      d.actions.map((a) => a.judgment),
      ["halt"],
    );
    assert.match(d.actions[0].payload.reason, /wrote outside its worktree/);
  });
});

test("the verifier's tree is compared with the snapshot taken before it", async () => {
  const s = await prepared();
  const run = { ...s.run, stage: "verifying", iteration: 1 };
  await s.deps.work(run, "snapshot", undefined, step("snap"));
  const verdict = {
    status: "done",
    verdict: "PASS",
    summary: "s",
    criteria: [{ id: "AC1", result: "met", evidence: "e" }],
    findings: [],
  };
  await withFake(s.runDir, "verifier", verdict, async () => {
    const ctx = engineContexts(s.run).find((a) => a.role === "verifier").context;
    const spawned = s.deps.spawnChild(run, spawnAction("verifier", 1, ctx), step("v"));
    writeFileSync(join(s.wt, "scratch.txt"), "x");
    const { obs } = await waitFor(s.deps, spawned);
    assert.deepEqual(obs.mutated, ["?? scratch.txt"]);
  });
});

test("lessons are ranked by the contract's paths and recorded as exposed", async () => {
  const spec = ".marvin/task/001-tag-filter.md";
  const lesson =
    "---\nid: toast\ntitle: Toast assertions are vacuous\ntags: role:executor\n---\n\nsrc/app/toast.mjs needs a positive control.\n";
  const other = "---\nid: payments\ntitle: Payments round half even\n---\n\nOnly payments.\n";
  const s = await prepared({
    loadConfig: true,
    files: {
      [spec]: specText({ files: ["src/app/toast.mjs"] }),
      ".marvin/memory/toast.md": lesson,
      ".marvin/memory/payments.md": other,
    },
  });
  const run = { ...s.run, stage: "executing", iteration: 1, specPath: spec };
  await withFake(s.runDir, "executor", DONE, () =>
    s.deps.spawnChild(run, spawnAction("executor", 1, EXECUTOR_CONTEXT), step("lessons")),
  );
  const prompt = readFileSync(join(s.runDir, "r1-executor-1.prompt.md"), "utf8");
  assert.match(prompt, /Lessons:\n- Toast assertions are vacuous — \.marvin\/memory\/toast\.md$/m);
  assert.doesNotMatch(prompt, /Payments/);
  assert.deepEqual(JSON.parse(readFileSync(join(s.runDir, "lessons-exposed.json"), "utf8")), [
    "toast",
  ]);
});

// ----------------------------------------------------------------------------------- work

const SPEC = ".marvin/task/001-tag-filter.md";
const RECORD = ".marvin/metrics/001-tag-filter.md";
const RECORD_TEXT = "# Metrics — tag-filter\n\nAppend-only.\n";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const approvedRun = (s) => ({ ...s.run, stage: "awaiting_approval", specPath: SPEC });

test("commit_spec commits the approved spec, ignored or not, and its metrics record, and nothing else", async () => {
  // The host ignores .marvin/ but for the series, as ADR-0043 asks: the commit is built from
  // plumbing, so no ignore rule, hook or `git add -f` keeps the spec out.
  const s = await prepared({ files: { ".gitignore": ".marvin/*\n!.marvin/metrics/\n" } });
  const base = sh(s.wt, "rev-parse", "HEAD");
  write(s.wt, SPEC, specText());
  write(s.wt, RECORD, RECORD_TEXT);
  write(s.wt, ".marvin/task/runs/tag-filter.progress.md", "journal\n");
  write(s.wt, "src/stray.mjs", "export const s = 1;\n");
  const run = approvedRun(s);
  const { obs } = await s.deps.work(run, "commit_spec", undefined, step("spec"));
  const head = sh(s.wt, "rev-parse", "HEAD");
  assert.deepEqual(obs, { kind: "spec_commit", ok: true, commit: head, reason: null });
  assert.equal(sh(s.wt, "rev-parse", "HEAD^"), base);
  assert.equal(sh(s.wt, "branch", "--show-current"), "autopilot/r1");
  assert.equal(sh(s.wt, "log", "-1", "--format=%s"), "chore(tag-filter): approved spec");
  assert.deepEqual(sh(s.wt, "show", "--name-only", "--format=", "HEAD").split("\n"), [
    RECORD,
    SPEC,
  ]);
  for (const path of [SPEC, RECORD]) {
    assert.equal(sh(s.wt, "show", `HEAD:${path}`), readFileSync(join(s.wt, path), "utf8").trim());
  }
  // The worktree's index took the commit, so the two read clean and the strays stay untouched.
  assert.equal(sh(s.wt, "status", "--porcelain", "--untracked-files=all"), "?? src/stray.mjs");
  const marker = JSON.parse(readFileSync(join(s.runDir, "spec-commit.json"), "utf8"));
  assert.deepEqual([marker.phase, marker.headBefore, marker.commit], ["committed", base, head]);
  // decide records the commit, and the first child starts only now.
  const next = decide(run, obs, rubric, new Date());
  assert.equal(next.run.specCommit, head);
  assert.equal(next.run.stage, "executing");

  // A replay after the marker said so commits nothing more.
  const replay = await s.deps.work(run, "commit_spec", undefined, step("spec", true));
  assert.deepEqual(replay.obs, obs);
  assert.equal(sh(s.wt, "rev-parse", "HEAD"), head);

  // A record filed under the bare slug, as one written against a draft is, is the one committed.
  const t = await prepared();
  write(t.wt, SPEC, specText());
  write(t.wt, ".marvin/metrics/tag-filter.md", RECORD_TEXT);
  await t.deps.work(approvedRun(t), "commit_spec", undefined, step("slug"));
  assert.deepEqual(sh(t.wt, "show", "--name-only", "--format=", "HEAD").split("\n"), [
    ".marvin/metrics/tag-filter.md",
    SPEC,
  ]);

  // A host that ignores .marvin/ whole never commits its series (ADR-0043), and the engine does
  // not force the record in: the host chose not to version it, and an ignored record never shows
  // in the gate's status, so nothing has to carry it. The spec still goes in.
  const i = await prepared({ files: { ".gitignore": ".marvin/\n" } });
  write(i.wt, SPEC, specText());
  write(i.wt, RECORD, RECORD_TEXT);
  await i.deps.work(approvedRun(i), "commit_spec", undefined, step("ignored"));
  assert.equal(sh(i.wt, "show", "--name-only", "--format=", "HEAD"), SPEC);
  write(i.wt, RECORD, `${RECORD_TEXT}\nappended\n`);
  assert.equal(sh(i.wt, "status", "--porcelain", "--untracked-files=all"), "");
  // A record the branch already tracks shows its changes whatever the ignore rules say, so it
  // is committed with the spec.
  const k = await prepared({ files: { ".gitignore": ".marvin/\n", [RECORD]: RECORD_TEXT } });
  write(k.wt, SPEC, specText());
  write(k.wt, RECORD, `${RECORD_TEXT}\nappended\n`);
  await k.deps.work(approvedRun(k), "commit_spec", undefined, step("tracked"));
  assert.deepEqual(sh(k.wt, "show", "--name-only", "--format=", "HEAD").split("\n"), [
    RECORD,
    SPEC,
  ]);

  // With no record, the commit holds the spec alone; a spec the base already holds as approved
  // needs no commit at all, and the commit that holds it is the answer.
  const u = await prepared();
  write(u.wt, SPEC, specText());
  await u.deps.work(approvedRun(u), "commit_spec", undefined, step("alone"));
  assert.equal(sh(u.wt, "show", "--name-only", "--format=", "HEAD"), SPEC);
  const v = await prepared({ files: { [SPEC]: specText() } });
  const held = sh(v.wt, "rev-parse", "HEAD");
  const reused = await v.deps.work(approvedRun(v), "commit_spec", undefined, step("held"));
  assert.equal(reused.obs.commit, held);
  assert.equal(sh(v.wt, "rev-parse", "HEAD"), held);
});

test("commit_spec refuses a spec whose contract no longer hashes to its seal, and commits nothing", async () => {
  const s = await prepared();
  const base = sh(s.wt, "rev-parse", "HEAD");
  write(s.wt, SPEC, specText({ tamper: true }));
  write(s.wt, RECORD, RECORD_TEXT);
  const run = approvedRun(s);
  const { obs } = await s.deps.work(run, "commit_spec", undefined, step("tampered"));
  assert.equal(obs.ok, false);
  assert.equal(obs.commit, null);
  assert.match(
    obs.reason,
    /^\.marvin\/task\/001-tag-filter\.md no longer matches its seal: contract_sha [0-9a-f]+, but the block hashes to [0-9a-f]+$/,
  );
  assert.equal(sh(s.wt, "rev-parse", "HEAD"), base);
  assert.equal(existsSync(join(s.runDir, "spec-commit.json")), false, "a refusal marks nothing");
  const halted = decide(run, obs, rubric, new Date());
  assert.equal(halted.actions[0].judgment, "halt");
  assert.deepEqual(halted.actions[0].payload, {
    reason: "the approved spec was not committed",
    detail: obs.reason,
  });

  // An unsealed spec, a missing one and a record that is a link are refused the same way.
  write(s.wt, SPEC, specText().replace(/contract_sha: .*\n/, ""));
  const unsealed = await s.deps.work(run, "commit_spec", undefined, step("unsealed"));
  assert.match(
    unsealed.obs.reason,
    /no longer matches its seal: its front matter has no contract_sha/,
  );
  rmSync(join(s.wt, SPEC));
  const missing = await s.deps.work(run, "commit_spec", undefined, step("missing"));
  assert.match(missing.obs.reason, /001-tag-filter\.md is not in the run worktree/);
  write(s.wt, SPEC, specText());
  rmSync(join(s.wt, RECORD));
  symlinkSync(join(s.repo, "package-lock.json"), join(s.wt, RECORD));
  const linked = await s.deps.work(run, "commit_spec", undefined, step("linked"));
  assert.match(linked.obs.reason, /metrics record .* cannot be committed: .*symbolic link/);
  assert.equal(sh(s.wt, "rev-parse", "HEAD"), base);
});

test("a commit_spec replay adopts the commit an engine made before it died, and repairs the index", async () => {
  const s = await prepared();
  const run = approvedRun(s);
  const subject = "chore(tag-filter): approved spec";
  write(s.wt, SPEC, specText());
  write(s.wt, RECORD, RECORD_TEXT);
  const headBefore = sh(s.wt, "rev-parse", "HEAD");
  const files = [SPEC, RECORD].map((path) => ({
    path,
    sha256: sha256(readFileSync(join(s.wt, path))),
  }));
  // The engine died after `update-ref` and before its marker said `committed`, so the marker is
  // still `verified` and the worktree's index never took the committed entries.
  writeFileSync(
    join(s.runDir, "spec-commit.json"),
    JSON.stringify({ phase: "verified", headBefore, files }),
  );
  sh(s.wt, "add", "-f", SPEC, RECORD);
  sh(s.wt, "commit", "-q", "-m", subject);
  sh(s.wt, "rm", "-q", "--cached", SPEC, RECORD);
  const commit = sh(s.wt, "rev-parse", "HEAD");
  const { obs } = await s.deps.work(run, "commit_spec", undefined, step("adopt", true));
  assert.deepEqual([obs.ok, obs.commit], [true, commit]);
  assert.equal(sh(s.wt, "rev-parse", "HEAD"), commit, "nothing was committed a second time");
  assert.equal(sh(s.wt, "status", "--porcelain", "--untracked-files=all"), "");
  const marker = JSON.parse(readFileSync(join(s.runDir, "spec-commit.json"), "utf8"));
  assert.deepEqual([marker.phase, marker.commit], ["committed", commit]);

  // A commit under that subject that holds another file is not the engine's own.
  const t = await prepared();
  write(t.wt, SPEC, specText());
  write(t.wt, "src/stray.mjs", "export const s = 1;\n");
  const before = sh(t.wt, "rev-parse", "HEAD");
  writeFileSync(
    join(t.runDir, "spec-commit.json"),
    JSON.stringify({
      phase: "verified",
      headBefore: before,
      files: [{ path: SPEC, sha256: sha256(readFileSync(join(t.wt, SPEC))) }],
    }),
  );
  sh(t.wt, "add", "-f", SPEC, "src/stray.mjs");
  sh(t.wt, "commit", "-q", "-m", subject);
  await assert.rejects(
    t.deps.work(approvedRun(t), "commit_spec", undefined, step("stray", true)),
    /the spec commit also holds src\/stray\.mjs/,
  );
  // Nor is any other commit on top of the base.
  const u = await prepared();
  write(u.wt, SPEC, specText());
  writeFileSync(
    join(u.runDir, "spec-commit.json"),
    JSON.stringify({
      phase: "verified",
      headBefore: sh(u.wt, "rev-parse", "HEAD"),
      files: [{ path: SPEC, sha256: sha256(readFileSync(join(u.wt, SPEC))) }],
    }),
  );
  write(u.wt, "src/a.mjs", "export const a = 1;\n");
  sh(u.wt, "add", "src/a.mjs");
  sh(u.wt, "commit", "-q", "-m", "feat: a");
  await assert.rejects(
    u.deps.work(approvedRun(u), "commit_spec", undefined, step("moved", true)),
    /HEAD moved from [0-9a-f]{40} to [0-9a-f]{40} while the spec was committed/,
  );

  // A `verified` marker whose head never moved stands for no commit: the files are judged again
  // as they are now, so an edit made while the engine was down is refused or committed, never
  // a reason to stop the engine on every restart.
  const w = await prepared();
  writeFileSync(
    join(w.runDir, "spec-commit.json"),
    JSON.stringify({
      phase: "verified",
      headBefore: sh(w.wt, "rev-parse", "HEAD"),
      files: [{ path: SPEC, sha256: "0".repeat(64) }],
    }),
  );
  write(w.wt, SPEC, specText({ tamper: true }));
  const rejudged = await w.deps.work(approvedRun(w), "commit_spec", undefined, step("w", true));
  assert.match(rejudged.obs.reason, /no longer matches its seal/);
  write(w.wt, SPEC, specText());
  const again = await w.deps.work(approvedRun(w), "commit_spec", undefined, step("w", true));
  assert.equal(again.obs.commit, sh(w.wt, "rev-parse", "HEAD"));
  assert.equal(sh(w.wt, "show", `HEAD:${SPEC}`), specText().trim());
});

test("the gate's spec findings name the engine's spec commit, and the restore they advise clears them", async () => {
  const s = await prepared({ config: { gates: { test: "true" } } });
  write(s.wt, SPEC, specText());
  const committed = await s.deps.work(approvedRun(s), "commit_spec", undefined, step("spec"));
  const sha = committed.obs.commit;
  write(s.wt, "src/a.mjs", "export const a = 1;\n");
  sh(s.wt, "add", "src/a.mjs");
  sh(s.wt, "commit", "-q", "-m", "work");
  const run = {
    ...s.run,
    stage: "gating",
    iteration: 1,
    specPath: SPEC,
    specCommit: sha,
    prUrl: PR,
  };
  const restore = `git checkout ${sha} -- ${SPEC}`;
  const gate = async (ref) => {
    const { obs } = await s.deps.work(run, "gate", undefined, step(ref));
    return { obs, spec: obs.findings.filter((f) => f.id.startsWith("SPEC-")) };
  };
  assert.deepEqual((await gate("clean")).spec, []);

  // An executor that loosened the contract is told to check it out of that commit.
  write(s.wt, SPEC, specText({ tamper: true }));
  sh(s.wt, "commit", "-q", "-am", "loosen the contract");
  const tampered = await gate("tampered");
  assert.deepEqual(
    tampered.spec.map((f) => [f.id, f.expected]),
    [["SPEC-tampered", `the contract as sealed: ${restore}, then commit it`]],
  );
  assert.equal(decide(run, tampered.obs, rubric, new Date()).run.stage, "executing");
  sh(s.wt, ...restore.split(" ").slice(1));
  sh(s.wt, "commit", "-q", "-m", "restore the sealed spec");
  assert.deepEqual((await gate("restored")).spec, []);

  // So is one that reverted the commit, which leaves no spec at HEAD nor on disk: the gate judges
  // the committed one, and the removal stays the executor's to undo rather than a halt.
  sh(s.wt, "revert", "--no-edit", sha);
  assert.equal(existsSync(join(s.wt, SPEC)), false);
  const reverted = await gate("reverted");
  assert.deepEqual(
    reverted.spec.map((f) => [f.id, f.expected]),
    [
      [
        "SPEC-uncommitted",
        `the spec as the pipeline committed it: ${restore}, then commit it; finalize ships the committed spec`,
      ],
    ],
  );
  assert.ok(reverted.obs.report.gates.some((g) => g.name === "oracle:AC1"));
  assert.equal(decide(run, reverted.obs, rubric, new Date()).run.stage, "executing");
  sh(s.wt, ...restore.split(" ").slice(1));
  sh(s.wt, "commit", "-q", "-m", "restore the spec");
  assert.deepEqual((await gate("back")).spec, []);
});

test("seal commits only the sealed tests, under the subject executor.md looks for; a replay commits nothing more", async () => {
  const s = await prepared({ config: { gates: { test_one: "node --test {file}" } } });
  write(s.wt, ".marvin/task/001-tag-filter.md", specText());
  write(
    s.wt,
    "test/a.test.mjs",
    'import test from "node:test";\nimport assert from "node:assert";\ntest("a", () => assert.equal(1, 2));\n',
  );
  const run = { ...s.run, stage: "test_authoring", specPath: ".marvin/task/001-tag-filter.md" };
  const data = { tests: [{ path: "test/a.test.mjs", criteria: ["AC1"] }] };
  const context = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    const { obs } = await s.deps.work(run, "seal", data, step("seal-1"));
    assert.equal(obs.ok, true, JSON.stringify(obs.reasons));
    assert.deepEqual(
      obs.sealed.map((t) => t.path),
      ["test/a.test.mjs"],
    );
    assert.equal(sh(s.wt, "log", "-1", "--format=%s"), "test(tag-filter): sealed acceptance tests");
    assert.equal(sh(s.wt, "show", "--name-only", "--format=", "HEAD"), "test/a.test.mjs");
    assert.deepEqual(JSON.parse(readFileSync(join(s.runDir, "sealed.json"), "utf8")), [
      "test/a.test.mjs",
    ]);
    const head = sh(s.wt, "rev-parse", "HEAD");

    const replay = await s.deps.work(run, "seal", data, step("seal-1", true));
    assert.deepEqual(replay.obs, obs);
    assert.equal(sh(s.wt, "rev-parse", "HEAD"), head, "the replay recognised the commit");

    // A re-seal that names another file keeps the earlier seal in the guard's manifest.
    write(
      s.wt,
      "test/b.test.mjs",
      'import test from "node:test";\nimport assert from "node:assert";\ntest("b", () => assert.ok(false));\n',
    );
    const resealed = await s.deps.work(
      { ...run, sealed: obs.sealed },
      "seal",
      { tests: [{ path: "test/b.test.mjs", criteria: ["AC1"] }] },
      step("seal-2"),
    );
    assert.equal(resealed.obs.ok, true, JSON.stringify(resealed.obs.reasons));
    assert.deepEqual(JSON.parse(readFileSync(join(s.runDir, "sealed.json"), "utf8")), [
      "test/a.test.mjs",
      "test/b.test.mjs",
    ]);
  } finally {
    if (context !== undefined) process.env.NODE_TEST_CONTEXT = context;
  }
});

test("the gate runs verify's plan, the spec's oracles and the scope, the spec declared beside the contract", async () => {
  const spec = "specs/1-tag-filter.md";
  const s = await prepared({
    config: { gates: { test: "true" } },
    files: { "package.json": JSON.stringify({ scripts: { lint: "node -e 0" } }) },
  });
  write(s.wt, spec, specText());
  write(s.wt, "src/a.mjs", "export const a = 1;\n");
  sh(s.wt, "add", "-A");
  sh(s.wt, "commit", "-m", "work");
  const run = { ...s.run, stage: "gating", iteration: 1, specPath: spec, prUrl: PR };
  const { obs } = await s.deps.work(run, "gate", undefined, step("gate-1"));
  assert.equal(obs.report.passed, true, JSON.stringify(obs.report, null, 2));
  assert.deepEqual(obs.findings, []);
  assert.deepEqual(
    obs.report.gates.map((g) => [g.name, g.result]),
    [
      ["oracle:AC1", "pass"],
      ["test", "pass"],
      ["lint", "pass"],
    ],
  );
  assert.deepEqual(
    obs.report.undeclared,
    [],
    "the spec outside .marvin/task is declared by the runtime",
  );
  const gated = JSON.parse(readFileSync(join(s.runDir, "gated-head.json"), "utf8"));
  assert.deepEqual([gated.head, gated.passed], [sh(s.wt, "rev-parse", "HEAD"), true]);
  assert.equal(decide(run, obs, rubric, new Date()).run.stage, "verifying");

  // A contract edited after sealing is a blocker the executor gets back.
  write(s.wt, spec, specText({ tamper: true }));
  sh(s.wt, "commit", "-am", "loosen the contract");
  const tampered = await s.deps.work(run, "gate", undefined, step("gate-2"));
  assert.ok(
    tampered.obs.findings.some((f) => f.id === "SPEC-tampered" && f.severity === "blocker"),
  );
  assert.equal(JSON.parse(readFileSync(join(s.runDir, "gated-head.json"), "utf8")).passed, false);
  assert.equal(decide(run, tampered.obs, rubric, new Date()).run.stage, "executing");
});

test("the gate tolerates the run's own uncommitted journals and receipts, keyed on its spec", async () => {
  const spec = "specs/1-tag-filter.md";
  const s = await prepared({ config: { gates: { test: "true" } } });
  write(s.wt, spec, specText());
  write(s.wt, "src/a.mjs", "export const a = 1;\n");
  sh(s.wt, "add", "-A");
  sh(s.wt, "commit", "-m", "work");
  write(s.wt, "specs/runs/tag-filter.progress.md", "journal\n");
  write(s.wt, "specs/runs/tag-filter.evidence.md", "evidence\n");
  write(s.wt, ".marvin/critique/001-tag-filter.md", "receipt\n");
  const run = { ...s.run, stage: "gating", iteration: 1, specPath: spec, prUrl: PR };
  const { obs } = await s.deps.work(run, "gate", undefined, step("gate-own"));
  assert.equal(obs.report.passed, true, JSON.stringify(obs.report.blockers, null, 2));
  // The positive control: a stray file beside them is still uncommitted work.
  write(s.wt, "notes.txt", "scratch\n");
  const stray = await s.deps.work(run, "gate", undefined, step("gate-stray"));
  assert.deepEqual(
    stray.obs.report.blockers.map((b) => b.claim),
    ["uncommitted work: notes.txt"],
  );
});

test("a spec the executor left uncommitted is a gate blocker, since finalize ships the committed one", async () => {
  const spec = ".marvin/task/001-tag-filter.md";
  const s = await prepared({ config: { gates: { test: "true" } } });
  write(s.wt, spec, specText());
  write(s.wt, "src/a.mjs", "export const a = 1;\n");
  sh(s.wt, "add", "src/a.mjs");
  sh(s.wt, "commit", "-m", "work");
  const run = { ...s.run, stage: "gating", iteration: 1, specPath: spec, prUrl: PR };
  const { obs } = await s.deps.work(run, "gate", undefined, step("gate"));
  const ids = obs.findings.map((f) => f.id);
  assert.ok(ids.includes("SPEC-uncommitted"), ids.join(", "));
  assert.ok(
    obs.report.gates.some((g) => g.name === "oracle:AC1"),
    "the oracles still ran from the worktree's copy",
  );
});

test("the gate carries the run's metrics record: a tool-shaped append passes, a rewrite is uncommitted work", async () => {
  // The record found from the spec the gate judged, by the rule the spec commit used. The real
  // delivery gate appends the terminal block after the executor's last commit; the engine's gate
  // must not send the executor back to commit it.
  const s = await prepared({ config: { gates: { test: "true" } } });
  write(s.wt, SPEC, specText());
  write(s.wt, RECORD, RECORD_TEXT);
  write(s.wt, "src/a.mjs", "export const a = 1;\n");
  sh(s.wt, "add", "-f", "-A");
  sh(s.wt, "commit", "-m", "work");
  const block = {
    slug: "tag-filter",
    rolled_up_at: "2026-10-12T10:00:00.000Z",
    base_branch: "dev",
    sources: { spec: "present" },
    time: {},
    quality: {},
    rework: {},
    notes: [],
  };
  appendFileSync(
    join(s.wt, RECORD),
    `\`\`\`json task-metrics\n${JSON.stringify(block)}\n\`\`\`\n\n`,
  );
  const run = { ...s.run, stage: "gating", iteration: 1, specPath: SPEC, prUrl: PR };
  const carried = await s.deps.work(run, "gate", undefined, step("gate-rec"));
  assert.equal(carried.obs.report.passed, true, JSON.stringify(carried.obs.report.blockers));
  assert.deepEqual(carried.obs.findings, []);

  appendFileSync(join(s.wt, RECORD), "and a note by hand\n");
  const rewritten = await s.deps.work(run, "gate", undefined, step("gate-rec-2"));
  assert.ok(
    rewritten.obs.findings.some((f) => f.claim === `uncommitted work: ${RECORD}`),
    JSON.stringify(rewritten.obs.findings),
  );
});

test("rename_branch names the branch from the spec, tolerates a replay, and steps around a taken name", async () => {
  const spec = ".marvin/task/001-tag-filter.md";
  const s = await prepared({
    config: { pipeline: { branch_template: "feature/{tracker}--{slug}" } },
  });
  write(s.wt, spec, specText({ tracker: "OSI-12" }));
  const run = { ...s.run, stage: "test_authoring", specPath: spec };
  const renamed = await s.deps.work(run, "rename_branch", undefined, step("rename"));
  assert.equal(renamed.run.branch, "feature/OSI-12--tag-filter");
  assert.equal(sh(s.wt, "branch", "--show-current"), "feature/OSI-12--tag-filter");
  const replay = await s.deps.work(run, "rename_branch", undefined, step("rename", true));
  assert.equal(replay.run.branch, "feature/OSI-12--tag-filter");

  const t = await prepared({ config: {} });
  write(t.wt, spec, specText());
  sh(t.repo, "push", "origin", "HEAD:refs/heads/feature/TBD--tag-filter");
  const taken = await t.deps.work(
    { ...t.run, specPath: spec },
    "rename_branch",
    undefined,
    step("taken"),
  );
  assert.equal(taken.run.branch, "feature/TBD--tag-filter-r1");
  assert.ok(events(t.runDir).some((e) => /is taken/.test(e.text) && e.data.notify));

  // `tracker: none` is task-start's "no tracker", so the default stands in, as in pr-create.
  const u = await prepared({ config: { pipeline: { tracker_default: "SANDBOX" } } });
  write(u.wt, spec, specText({ tracker: "none" }));
  const none = await u.deps.work(
    { ...u.run, specPath: spec },
    "rename_branch",
    undefined,
    step("none"),
  );
  assert.equal(none.run.branch, "feature/SANDBOX--tag-filter");
});

test("ci reads MARVIN_PIPELINE_FAKE_CI, and mark_ready leaves a fake PR alone", async () => {
  const s = await prepared();
  const run = {
    ...s.run,
    stage: "ci_wait",
    iteration: 1,
    prUrl: PR,
    ciSince: new Date().toISOString(),
  };
  process.env.MARVIN_PIPELINE_FAKE_CI = "conflict";
  try {
    assert.deepEqual((await s.deps.work(run, "ci", undefined, step("ci"))).obs, {
      kind: "ci",
      state: "conflict",
      failing: [],
    });
    process.env.MARVIN_PIPELINE_FAKE_CI = "red";
    assert.deepEqual((await s.deps.work(run, "ci", undefined, step("ci2"))).obs.failing, [
      "fake-ci",
    ]);
    await s.deps.work(run, "mark_ready", undefined, step("ready"));
    process.env.MARVIN_PIPELINE_FAKE_CI = "purple";
    await assert.rejects(s.deps.work(run, "ci", undefined, step("ci3")), /FAKE_CI must be one of/);
  } finally {
    delete process.env.MARVIN_PIPELINE_FAKE_CI;
  }
});

test("a CI look sleeps between the looks of one wait, never before its first; GitHub out of reach reads as pending", async () => {
  // The signal is aborted from the start: a look that sleeps rejects at once instead of waiting
  // `ci_poll_seconds`, which is how the test sees whether it slept.
  const controller = new AbortController();
  controller.abort();
  const s = await prepared({
    config: { pipeline: { ci_poll_seconds: 600 } },
    options: { signal: controller.signal },
  });
  const run = {
    ...s.run,
    stage: "ci_wait",
    iteration: 1,
    prUrl: PR,
    ciSince: "2026-10-09T10:00:00.000Z",
  };
  const first = await s.deps.work(run, "ci", undefined, step("look-1"));
  assert.deepEqual(first.obs, { kind: "ci", state: "pending", failing: [] });
  assert.ok(events(s.runDir).some((e) => /^CI state unavailable/.test(e.text) && e.data.notify));
  await assert.rejects(s.deps.work(run, "ci", undefined, step("look-2")), { name: "AbortError" });
  // A wait whose clock restarted (an answer, a new stage) looks at once again.
  const restarted = { ...run, ciSince: "2026-10-09T11:00:00.000Z" };
  assert.equal(
    (await s.deps.work(restarted, "ci", undefined, step("look-3"))).obs.state,
    "pending",
  );
  const finalizing = { ...restarted, stage: "finalizing" };
  assert.equal(
    (await s.deps.work(finalizing, "ci", undefined, step("look-4"))).obs.state,
    "pending",
  );
});

test("a run halted after its PR opened finalizes like one without: nothing leaves the run dir", async () => {
  const spec = ".marvin/task/001-tag-filter.md";
  const s = await prepared({ files: { [spec]: specText() } });
  const head = sh(s.wt, "rev-parse", "HEAD");
  const run = {
    ...s.run,
    stage: "finalizing",
    iteration: 1,
    specPath: spec,
    prUrl: PR,
    haltReason: "rejected 3 times",
  };
  const retro = { status: "done", summary: "s", checks: [], proposals: [], lessons: [], prune: [] };
  const { obs } = await s.deps.work(run, "finalize", { retro }, step("fin"));
  assert.deepEqual(obs, { kind: "finalized" });
  assert.equal(sh(s.wt, "rev-parse", "HEAD"), head, "nothing was committed");
  assert.match(readFileSync(join(s.wt, spec), "utf8"), /status: ready/, "the spec is not shipped");
  assert.ok(existsSync(join(s.runDir, "retro-output.json")));
  const replay = await s.deps.work(run, "finalize", { retro }, step("fin", true));
  assert.deepEqual(replay.obs, obs);
  assert.equal(sh(s.wt, "rev-parse", "HEAD"), head);
  // The engine closes the run, and its closing notify names the PR left as a draft.
  const closed = decide(run, obs, rubric, new Date());
  assert.equal(closed.run.stage, "done");
  assert.ok(closed.actions.some((a) => a.kind === "notify" && a.text.includes(PR)));

  await assert.rejects(
    s.deps.work({ ...run, haltReason: null }, "finalize", { retro }, step("fin-2")),
    /a passing gate/,
  );
});

test("finalize merges a base that moved before it writes, and says so", async () => {
  const spec = ".marvin/task/001-tag-filter.md";
  const s = await prepared({ files: { [spec]: specText() } });
  const origin = sh(s.repo, "remote", "get-url", "origin");
  // A parallel run lands its calibration record on dev while this one is in its retro.
  const clone = mkdtempSync(join(tmpdir(), "pipe-dev-"));
  sh(clone, "clone", "-q", "--branch", "dev", origin, ".");
  write(clone, ".marvin/pipeline/calibration/r0.json", `${JSON.stringify({ runId: "r0" })}\n`);
  sh(clone, "add", "-f", "-A");
  sh(clone, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "parallel run");
  sh(clone, "push", "-q", "origin", "HEAD:refs/heads/dev");
  const devTip = sh(clone, "rev-parse", "HEAD");
  const gated = sh(s.wt, "rev-parse", "HEAD");
  writeFileSync(
    join(s.runDir, "gated-head.json"),
    `${JSON.stringify({ head: gated, iteration: 1, passed: true })}\n`,
  );
  const run = { ...s.run, stage: "finalizing", iteration: 1, specPath: spec, prUrl: PR };
  const retro = { status: "done", summary: "s", checks: [], proposals: [], lessons: [], prune: [] };
  const { obs } = await s.deps.work(run, "finalize", { retro }, step("fin"));
  assert.deepEqual(obs, { kind: "finalized" });
  const merge = sh(s.wt, "rev-parse", "HEAD^");
  assert.deepEqual(sh(s.wt, "rev-list", "--parents", "-n", "1", merge).split(" ").slice(1), [
    gated,
    devTip,
  ]);
  // The base's record came in with the merge; the run's own is a second file beside it.
  const records = readdirSync(join(s.wt, ".marvin/pipeline/calibration"))
    .sort()
    .map(
      (name) =>
        JSON.parse(readFileSync(join(s.wt, ".marvin/pipeline/calibration", name), "utf8")).runId,
    );
  assert.deepEqual(records, ["r0", "r1"]);
  assert.ok(
    events(s.runDir).some((e) => /^merged dev \([0-9a-f]{8}\) into the run branch/.test(e.text)),
  );
});

test("a relative run dir is made absolute before any child is told where its files are", async () => {
  const s = await prepared();
  // The children run in the worktree, so a relative path would resolve there, not here; the
  // wait would then never see a log and never call the child stalled.
  const deps = createRuntime({
    runDir: relative(process.cwd(), s.runDir),
    pluginRoot,
    rubric,
    config: Config.parse({}),
    pollMs: 20,
    childDeadlineMs: 10_000,
  });
  const run = { ...s.run, stage: "executing", iteration: 1 };
  await withFake(s.runDir, "executor", DONE, async () => {
    const spawned = deps.spawnChild(run, spawnAction("executor", 1, EXECUTOR_CONTEXT), step("rel"));
    const { argv, env } = command(s.runDir, "r1-executor-1");
    assert.equal(env.MARVIN_PIPELINE_RUN, s.runDir);
    assert.equal(after(argv, "--settings"), join(s.runDir, "executor.settings.json"));
    const { obs } = await waitFor(deps, spawned);
    assert.equal(obs.result.outcome, "done");
    assert.ok(existsSync(join(s.runDir, "r1-executor-1.log.jsonl")));
  });
});

test("an entry of the lessons store that is not a readable file is skipped and noted, never fatal", async () => {
  const spec = ".marvin/task/001-tag-filter.md";
  const lesson =
    "---\nid: toast\ntitle: Toast assertions are vacuous\ntags: role:executor\n---\n\nsrc/app/toast.mjs needs a positive control.\n";
  const s = await prepared({
    files: {
      [spec]: specText({ files: ["src/app/toast.mjs"] }),
      ".marvin/memory/toast.md": lesson,
    },
  });
  // A directory with a lesson's name: git does not list an empty one, so no gate reports it.
  mkdirSync(join(s.wt, ".marvin", "memory", "broken.md"));
  const run = { ...s.run, stage: "executing", iteration: 1, specPath: spec };
  await withFake(s.runDir, "executor", DONE, () =>
    s.deps.spawnChild(run, spawnAction("executor", 1, EXECUTOR_CONTEXT), step("lessons")),
  );
  const prompt = readFileSync(join(s.runDir, "r1-executor-1.prompt.md"), "utf8");
  assert.match(
    prompt,
    /Toast assertions are vacuous/,
    "the readable lessons still reach the prompt",
  );
  assert.ok(events(s.runDir).some((e) => /broken\.md/.test(e.text) && e.data.notify));
});

test("a re-seal after the executor committed red-runs the revised tests on the base tree", async () => {
  const s = await prepared({ config: { gates: { test_one: "node --test {file}" } } });
  write(s.wt, "src/a.mjs", "export const a = () => 1;\n");
  sh(s.wt, "add", "src/a.mjs");
  sh(s.wt, "commit", "-m", "feat: a");
  // A correct revision: it passes on the implemented tree and fails on the base one.
  write(
    s.wt,
    "test/a.test.mjs",
    'import test from "node:test";\nimport assert from "node:assert";\nimport { a } from "../src/a.mjs";\ntest("a", () => assert.equal(a(), 1));\n',
  );
  const data = { tests: [{ path: "test/a.test.mjs", criteria: ["AC1"] }] };
  const run = { ...s.run, stage: "test_authoring" };
  await outsideTestContext(async () => {
    // The first seal (iteration 0) red-runs in the worktree, where this test already passes.
    const first = await s.deps.work({ ...run, iteration: 0 }, "seal", data, step("seal-first"));
    assert.equal(first.obs.ok, false);
    assert.match(first.obs.reasons.join("\n"), /passes before implementation/);

    const { obs } = await s.deps.work({ ...run, iteration: 1 }, "seal", data, step("reseal"));
    assert.equal(obs.ok, true, JSON.stringify(obs.reasons));
    assert.equal(sh(s.wt, "show", "--name-only", "--format=", "HEAD"), "test/a.test.mjs");
  });
  const worktrees = sh(s.repo, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((l) => l.startsWith("worktree "));
  assert.equal(worktrees.length, 2, "the temporary base worktree was removed");
});

test("seal hands its paths to git literally, so a magic pathspec commits only that file", async () => {
  const s = await prepared({ config: { gates: { test_one: "node --test {file}" } } });
  const magic = ":!test/b.test.mjs";
  write(s.wt, magic, FAILING_TEST);
  write(s.wt, "src/stray.mjs", "export const s = 1;\n");
  const run = { ...s.run, stage: "test_authoring" };
  await outsideTestContext(async () => {
    const { obs } = await s.deps.work(
      run,
      "seal",
      { tests: [{ path: magic, criteria: ["AC1"] }] },
      step("magic"),
    );
    assert.equal(obs.ok, true, JSON.stringify(obs.reasons));
  });
  assert.equal(sh(s.wt, "show", "--name-only", "--format=", "HEAD"), magic);
  assert.match(sh(s.wt, "status", "--porcelain"), /\?\? src\//, "the stray file stays uncommitted");
});

test("a seal replay adopts a commit made before its marker said so, and checks it holds nothing else", async () => {
  const s = await prepared({ config: { gates: { test_one: "node --test {file}" } } });
  const run = { ...s.run, stage: "test_authoring" };
  const subject = "test(spec): sealed acceptance tests";
  write(s.wt, "test/a.test.mjs", FAILING_TEST);
  const headBefore = sh(s.wt, "rev-parse", "HEAD");
  // The engine died after the commit and before it moved its marker to `committed`.
  sealedMarker(s.runDir, "adopt", s.wt, headBefore, ["test/a.test.mjs"]);
  sh(s.wt, "add", "test/a.test.mjs");
  sh(s.wt, "commit", "-m", subject);
  const commit = sh(s.wt, "rev-parse", "HEAD");
  const { obs } = await s.deps.work(run, "seal", undefined, step("adopt", true));
  assert.equal(obs.ok, true);
  assert.equal(sh(s.wt, "rev-parse", "HEAD"), commit, "nothing was committed a second time");
  const marker = JSON.parse(readFileSync(join(s.runDir, "seal-adopt.json"), "utf8"));
  assert.deepEqual([marker.phase, marker.commit], ["committed", commit]);

  // A commit under the seal's subject that holds another file is not the seal's own.
  const t = await prepared({ config: { gates: { test_one: "node --test {file}" } } });
  write(t.wt, "test/a.test.mjs", FAILING_TEST);
  write(t.wt, "src/stray.mjs", "export const s = 1;\n");
  const before = sh(t.wt, "rev-parse", "HEAD");
  sealedMarker(t.runDir, "stray", t.wt, before, ["test/a.test.mjs"]);
  sh(t.wt, "add", "test/a.test.mjs", "src/stray.mjs");
  sh(t.wt, "commit", "-m", subject);
  await assert.rejects(
    t.deps.work({ ...t.run, stage: "test_authoring" }, "seal", undefined, step("stray", true)),
    /the seal commit also holds src\/stray\.mjs/,
  );
});

test("a gate whose binary is absent is not run and is reported minor, as verify reports it", async () => {
  const spec = ".marvin/task/001-tag-filter.md";
  const s = await prepared({
    config: { gates: { test: "true", lint: "marvin-no-such-linter --check" } },
  });
  write(s.wt, spec, specText());
  write(s.wt, "src/a.mjs", "export const a = 1;\n");
  sh(s.wt, "add", "-f", "-A");
  sh(s.wt, "commit", "-m", "work");
  const run = { ...s.run, stage: "gating", iteration: 1, specPath: spec, prUrl: PR };
  const { obs } = await s.deps.work(run, "gate", undefined, step("gate-nr"));
  assert.equal(obs.report.passed, true, JSON.stringify(obs.report, null, 2));
  assert.deepEqual(
    obs.report.gates.map((g) => [g.name, g.result]),
    [
      ["oracle:AC1", "pass"],
      ["test", "pass"],
    ],
  );
  assert.deepEqual(
    obs.findings.map((f) => [f.id, f.severity]),
    [["G-lint-not-run", "minor"]],
  );
  assert.equal(JSON.parse(readFileSync(join(s.runDir, "gated-head.json"), "utf8")).passed, true);
  const d = decide(run, obs, rubric, new Date());
  assert.equal(d.run.stage, "verifying");
  assert.ok(d.run.minorFindings.some((f) => f.id === "G-lint-not-run"));
});

test("a plan in which no test gate can run is a blocker, as verify's delivery gate refuses it", async () => {
  const spec = ".marvin/task/001-tag-filter.md";
  const s = await prepared({ config: { gates: { test: "marvin-no-such-runner --run" } } });
  write(s.wt, spec, specText());
  write(s.wt, "src/a.mjs", "export const a = 1;\n");
  sh(s.wt, "add", "-f", "-A");
  sh(s.wt, "commit", "-m", "work");
  const run = { ...s.run, stage: "gating", iteration: 1, specPath: spec, prUrl: PR };
  const { obs } = await s.deps.work(run, "gate", undefined, step("gate-ne"));
  assert.deepEqual(
    obs.report.gates.map((g) => [g.name, g.result]),
    [["oracle:AC1", "pass"]],
  );
  assert.deepEqual(
    obs.findings.map((f) => [f.id, f.severity]),
    [
      ["G-no-test-evidence", "blocker"],
      ["G-test-not-run", "minor"],
    ],
  );
  assert.equal(JSON.parse(readFileSync(join(s.runDir, "gated-head.json"), "utf8")).passed, false);
  assert.equal(decide(run, obs, rubric, new Date()).run.stage, "executing");
});

test("after the base is merged into the branch, the gate counts only the run's own changes", async () => {
  const spec = "specs/1-tag-filter.md";
  const s = await prepared({
    config: { gates: { test: "true" } },
    files: { ".husky/pre-commit": "npx lint-staged\n" },
  });
  write(s.wt, spec, specText());
  write(s.wt, "src/a.mjs", "export const a = 1;\n");
  sh(s.wt, "add", "-A");
  sh(s.wt, "commit", "-m", "work");
  const run = { ...s.run, stage: "gating", iteration: 1, specPath: spec, prUrl: PR };
  const first = await s.deps.work(run, "gate", undefined, step("gate-1"));
  assert.equal(first.obs.report.passed, true, JSON.stringify(first.obs.findings));

  // Others land work on the base meanwhile: a plain file, a protected one and a submodule. CI
  // reports a conflict and the executor merges the base, as the CI-conflict finding tells it to.
  write(s.repo, "other.txt", "landed on dev\n");
  write(s.repo, ".husky/pre-commit", "npx lint-staged --quiet\n");
  sh(s.repo, "add", "-A");
  sh(s.repo, "update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},vendor/sub`);
  sh(s.repo, "commit", "-m", "unrelated work on dev");
  sh(s.repo, "push", "origin", "HEAD:dev");
  sh(s.wt, "fetch", "origin", "dev");
  sh(s.wt, "merge", "--no-edit", "origin/dev");
  const second = await s.deps.work({ ...run, iteration: 2 }, "gate", undefined, step("gate-2"));
  assert.deepEqual(second.obs.findings, []);
  assert.equal(second.obs.report.passed, true);
  assert.equal(
    decide({ ...run, iteration: 2 }, second.obs, rubric, new Date()).run.stage,
    "verifying",
  );

  // A merge of anything origin's base does not hold still counts against the run, whatever the
  // shared repository's refs and config, which a child can write, claim the base to be.
  sh(s.repo, "checkout", "-q", "-b", "side");
  write(s.repo, "stray.txt", "never pushed\n");
  sh(s.repo, "add", "stray.txt");
  sh(s.repo, "commit", "-m", "a side branch");
  sh(s.wt, "merge", "--no-edit", "side");
  const forged = join(mkdtempSync(join(tmpdir(), "pipe-forged-")), "forged.git");
  sh(s.wt, "init", "-q", "--bare", forged);
  sh(s.wt, "push", "-q", forged, "HEAD:refs/heads/dev");
  sh(s.wt, "config", "remote.origin.url", forged);
  sh(s.wt, "update-ref", "refs/remotes/origin/dev", "HEAD");
  const third = await s.deps.work({ ...run, iteration: 3 }, "gate", undefined, step("gate-3"));
  assert.deepEqual(third.obs.report.undeclared, ["stray.txt"]);
  assert.equal(third.obs.report.passed, false);

  // An origin out of reach leaves the base the run branched from in force, and says so.
  renameSync(join(dirname(s.repo), "origin.git"), join(dirname(s.repo), "origin.gone"));
  const fourth = await s.deps.work({ ...run, iteration: 4 }, "gate", undefined, step("gate-4"));
  assert.ok(fourth.obs.report.undeclared.includes("other.txt"), fourth.obs.report.undeclared);
  assert.ok(
    events(s.runDir).some((e) => e.data?.notify && /base's tip could not be fetched/.test(e.text)),
  );
});

test("a CI look reads green only for the commit the run expects GitHub to have", async () => {
  const s = await prepared();
  const head = sh(s.wt, "rev-parse", "HEAD");
  const older = "1".repeat(40);
  const run = {
    ...s.run,
    stage: "finalizing",
    iteration: 1,
    prUrl: PR,
    finalized: true,
    ciSince: "2026-10-09T10:00:00.000Z",
  };
  const pr = (sha) => ({
    state: "OPEN",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    headRefOid: sha,
    headRefName: "b",
  });
  const green = (sha) => [
    { head_sha: sha, status: "completed", conclusion: "success", name: "ci" },
  ];
  await withGh(async ({ answer }) => {
    // GitHub has not seen the finalize push: the PR head is the commit before, all green.
    answer({ view: pr(older), runs: green(older) });
    const stale = await s.deps.work(run, "ci", undefined, step("stale"));
    assert.deepEqual(stale.obs, { kind: "ci", state: "pending", failing: [] });
    assert.equal(decide(run, stale.obs, rubric, new Date()).run.stage, "finalizing");

    answer({ view: pr(head), runs: green(head) });
    const fresh = await s.deps.work(
      { ...run, ciSince: "2026-10-09T10:05:00.000Z" },
      "ci",
      undefined,
      step("fresh"),
    );
    assert.deepEqual(fresh.obs, { kind: "ci", state: "green", failing: [] });

    // A closed PR is closed whatever its head.
    answer({ view: { ...pr(older), state: "CLOSED" }, runs: [] });
    const closed = await s.deps.work(
      { ...run, ciSince: "2026-10-09T10:10:00.000Z" },
      "ci",
      undefined,
      step("closed"),
    );
    assert.equal(closed.obs.state, "closed");
  });
});

test("GitHub out of reach is told to the orchestrator once per wait, not once per look", async () => {
  const s = await prepared({ config: { pipeline: { ci_poll_seconds: 1 } } });
  const run = {
    ...s.run,
    stage: "ci_wait",
    iteration: 1,
    prUrl: PR,
    ciSince: "2026-10-09T10:00:00.000Z",
  };
  const told = () =>
    events(s.runDir).filter((e) => /^CI state unavailable/.test(e.text) && e.data.notify).length;
  for (const ref of ["look-1", "look-2"]) {
    assert.equal((await s.deps.work(run, "ci", undefined, step(ref))).obs.state, "pending");
  }
  assert.equal(told(), 1);
  assert.equal(
    events(s.runDir).filter((e) => /^CI state unavailable/.test(e.text)).length,
    2,
    "every failed look is still logged",
  );
  const next = { ...run, ciSince: "2026-10-09T11:00:00.000Z" };
  await s.deps.work(next, "ci", undefined, step("look-3"));
  assert.equal(told(), 2, "a new wait is told again");
});

test("mark_ready takes a draft PR out of draft once, and leaves a ready one alone", async () => {
  const s = await prepared();
  const run = { ...s.run, stage: "ready", iteration: 1, prUrl: PR };
  await withGh(async ({ answer, calls }) => {
    answer({ view: { isDraft: true } });
    await s.deps.work(run, "mark_ready", undefined, step("ready-1"));
    assert.deepEqual(
      calls().filter((c) => c.startsWith("pr ready")),
      [`pr ready ${PR}`],
    );
    // The replay finds the PR out of draft.
    answer({ view: { isDraft: false } });
    await s.deps.work(run, "mark_ready", undefined, step("ready-1", true));
    assert.equal(calls().filter((c) => c.startsWith("pr ready")).length, 1);
  });
});

test("a stalled child's process group is signalled only while the run's wrapper still leads it", async () => {
  const childRow = {
    name: "r1-executor-1",
    role: "executor",
    iteration: 1,
    sessionId: null,
    assignment: { model: "sonnet", effort: "medium" },
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: "running",
    costUsd: null,
    cacheReadTokens: null,
  };
  const staleLog = (runDir) => {
    const old = new Date(Date.now() - 5 * 60_000);
    utimesSync(join(runDir, "r1-executor-1.log.jsonl"), old, old);
  };
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  // The recorded pid now leads someone else's group, as after a reboot.
  const s = await prepared({ config: { pipeline: { stall_minutes: 1 } } });
  const stranger = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  stranger.unref();
  try {
    write(s.runDir, "r1-executor-1.log.jsonl", "");
    staleLog(s.runDir);
    const run = {
      ...s.run,
      stage: "executing",
      iteration: 1,
      children: [{ ...childRow, pid: stranger.pid }],
    };
    const { obs } = await s.deps.waitChild(run);
    assert.equal(obs.result.outcome, "stalled");
    // Long enough for a signalled `sleep` to be reaped, so that it reads as gone.
    await delay(300);
    assert.equal(stranger.signalCode, null, "the stranger's group was not signalled");
    assert.ok(alive(stranger.pid));
    assert.ok(events(s.runDir).some((e) => /was not signalled/.test(e.text) && e.data.notify));
  } finally {
    try {
      process.kill(-stranger.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }

  // The run's own wrapper, still waiting on its child, is recognised and stopped.
  const t = await prepared({ config: { pipeline: { stall_minutes: 1 } } });
  const { pid } = launchDetached(
    { argv: [process.execPath, "-e", "setTimeout(() => {}, 30000)"], cwd: t.wt, env: {} },
    t.runDir,
    "r1-executor-1",
  );
  try {
    await delay(200);
    staleLog(t.runDir);
    const run = { ...t.run, stage: "executing", iteration: 1, children: [{ ...childRow, pid }] };
    const { obs } = await t.deps.waitChild(run);
    assert.equal(obs.result.outcome, "stalled");
    for (let i = 0; i < 50 && alive(pid); i += 1) await delay(100);
    assert.equal(alive(pid), false, "the wrapper's group was stopped");
  } finally {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
});

test("the judge comes from MARVIN_PIPELINE_JUDGE and MARVIN_PIPELINE_FIXTURES", () => {
  const runDir = mkdtempSync(join(tmpdir(), "pipe-run-"));
  assert.equal(createRuntime({ runDir, pluginRoot, rubric }).judge, "files");
  process.env.MARVIN_PIPELINE_JUDGE = "fixtures";
  process.env.MARVIN_PIPELINE_FIXTURES = "/fixtures";
  try {
    const deps = createRuntime({ runDir, pluginRoot, rubric });
    assert.deepEqual([deps.judge, deps.fixturesDir], ["fixtures", "/fixtures"]);
  } finally {
    delete process.env.MARVIN_PIPELINE_JUDGE;
    delete process.env.MARVIN_PIPELINE_FIXTURES;
  }
});

// ------------------------------------------------------------------------------ end to end

test("the engine drives a light run to ready on this runtime, with fake children and fake CI", async () => {
  const spec = ".marvin/task/001-tag-filter.md";
  const fixtures = mkdtempSync(join(tmpdir(), "pipe-judge-"));
  writeFileSync(join(fixtures, "spec_approval.json"), JSON.stringify({ kind: "approve" }));
  process.env.MARVIN_PIPELINE_JUDGE = "fixtures";
  process.env.MARVIN_PIPELINE_FIXTURES = fixtures;
  let s;
  try {
    s = setup({ files: { [spec]: specText() }, config: { gates: { test: "true" } } });
  } finally {
    delete process.env.MARVIN_PIPELINE_JUDGE;
    delete process.env.MARVIN_PIPELINE_FIXTURES;
  }
  const outputs = {
    planner: { status: "spec_ready", summary: "reused", spec: { path: spec } },
    executor: DONE,
    verifier: {
      status: "done",
      verdict: "PASS",
      summary: "s",
      criteria: [{ id: "AC1", result: "met", evidence: "e" }],
      findings: [],
    },
    retro: {
      status: "done",
      summary: "nothing to learn",
      checks: [],
      proposals: [],
      lessons: [],
      prune: [],
    },
  };
  for (const [role, output] of Object.entries(outputs)) {
    const file = join(fixtures, `${role}.out.json`);
    writeFileSync(file, JSON.stringify(output));
    process.env[fakeVariable(role)] = file;
  }
  process.env.MARVIN_PIPELINE_FAKE_CI = "green";
  try {
    const final = await runEngine(s.runDir, s.deps);
    assert.equal(
      final.stage,
      "ready",
      JSON.stringify(
        events(s.runDir).map((e) => e.text),
        null,
        2,
      ),
    );
    assert.equal(final.branch, "feature/TBD--tag-filter");
    // The base already held the spec as approved, so the commit that holds it is the spec commit.
    assert.equal(final.specCommit, sh(s.repo, "rev-parse", "HEAD"));
    assert.deepEqual(
      final.children.map((c) => [c.role, c.status]),
      [
        ["planner", "spec_ready"],
        ["executor", "done"],
        ["verifier", "done"],
        ["retro", "done"],
      ],
    );
    // Finalize shipped the spec on the run branch and pushed it.
    const pushed = sh(s.repo, "ls-remote", "origin", "refs/heads/feature/TBD--tag-filter").split(
      "\t",
    )[0];
    assert.equal(pushed, sh(final.worktree, "rev-parse", "HEAD"));
    assert.match(readFileSync(join(final.worktree, spec), "utf8"), /status: shipped/);
  } finally {
    for (const role of Object.keys(outputs)) delete process.env[fakeVariable(role)];
    delete process.env.MARVIN_PIPELINE_FAKE_CI;
  }
});

/** The repository's shared hooks directory, which no `git status` of either checkout lists. */
const hooksOf = (repo) => join(realpathSync(join(repo, ".git")), "hooks");

test("a hook planted in the shared git dir during a child is a leak, and decide halts on it", async () => {
  const s = await prepared();
  const run = { ...s.run, stage: "executing", iteration: 1 };
  await withFake(s.runDir, "executor", DONE, async () => {
    const spawned = s.deps.spawnChild(
      run,
      spawnAction("executor", 1, EXECUTOR_CONTEXT),
      step("hook"),
    );
    writeFileSync(join(hooksOf(s.repo), "pre-commit"), "#!/bin/sh\n");
    const { run: seen, obs } = await waitFor(s.deps, spawned);
    assert.deepEqual(obs.leaked, [`git common dir added: ${join(hooksOf(s.repo), "pre-commit")}`]);
    const d = decide(seen, obs, rubric, new Date());
    assert.deepEqual(
      d.actions.map((a) => a.judgment),
      ["halt"],
    );
  });
});

const PLANT = (name) =>
  `printf x > "$(git rev-parse --path-format=absolute --git-common-dir)/hooks/${name}"`;

test("a gate command that plants a hook in the shared git dir halts the run, charged to the executor", async () => {
  const s = await prepared({ config: { gates: { test: PLANT("post-checkout") } } });
  write(s.wt, "src/a.mjs", "export const a = 1;\n");
  sh(s.wt, "add", "src/a.mjs");
  sh(s.wt, "commit", "-q", "-m", "work");
  const run = { ...s.run, stage: "gating", iteration: 1, prUrl: PR };
  const { obs } = await s.deps.work(run, "gate", undefined, step("gate"));
  assert.deepEqual(obs.leaked, [`git common dir added: ${join(hooksOf(s.repo), "post-checkout")}`]);
  const d = decide(run, obs, rubric, new Date());
  assert.deepEqual(
    d.actions.map((a) => a.judgment),
    ["halt"],
  );
  assert.equal(d.run.haltRole, "executor");
  assert.match(d.actions[0].payload.reason, /gate stage changed the repository's shared git dir/);

  // The next gate compares against its own before-snapshot, so a clean gate passes again.
  const again = await s.deps.work(run, "gate", undefined, step("gate-2"));
  assert.equal(again.obs.leaked, undefined);
});

test("a red run that plants a hook in the shared git dir halts the run, charged to the test-author", async () => {
  const s = await prepared({
    config: { gates: { test_one: "node --test {file}" } },
  });
  write(s.wt, ".marvin/task/001-tag-filter.md", specText());
  write(
    s.wt,
    "test/a.test.mjs",
    [
      'import test from "node:test";',
      'import assert from "node:assert";',
      'import { execFileSync } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      'const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();',
      'writeFileSync(`${common}/hooks/pre-rebase`, "x");',
      'test("a", () => assert.equal(1, 2));',
      "",
    ].join("\n"),
  );
  const run = { ...s.run, stage: "test_authoring", specPath: ".marvin/task/001-tag-filter.md" };
  const data = { tests: [{ path: "test/a.test.mjs", criteria: ["AC1"] }] };
  const context = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    const { obs } = await s.deps.work(run, "seal", data, step("seal-1"));
    assert.deepEqual(obs.leaked, [`git common dir added: ${join(hooksOf(s.repo), "pre-rebase")}`]);
    const d = decide(run, obs, rubric, new Date());
    assert.equal(d.actions[0].judgment, "halt");
    assert.equal(d.run.haltRole, "test-author");
  } finally {
    if (context !== undefined) process.env.NODE_TEST_CONTEXT = context;
  }
});

test("a bootstrap that plants a hook in the shared git dir fails prepare", async () => {
  const s = setup({ config: { pipeline: { bootstrap: PLANT("pre-push") } } });
  await assert.rejects(s.deps.prepare(s.run), /changed the repository's shared git dir/);
  assert.ok(existsSync(join(hooksOf(s.repo), "pre-push")));
  // A restarted engine runs the bootstrap again, and still judges it against the first snapshot.
  await assert.rejects(s.deps.prepare(s.run), /changed the repository's shared git dir/);
});

test("prepare refuses a relative MARVIN_PIPELINE_HOME rather than make worktrees under the cwd", async () => {
  const s = setup();
  process.env.MARVIN_PIPELINE_HOME = "relative-home";
  try {
    await assert.rejects(s.deps.prepare(s.run), /not an absolute path/);
  } finally {
    process.env.MARVIN_PIPELINE_HOME = s.home;
  }
});
