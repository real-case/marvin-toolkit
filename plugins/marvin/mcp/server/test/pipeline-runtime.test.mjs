import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
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
    decide(
      at("awaiting_approval"),
      { kind: "answer", judgment: "spec_approval", answer: { kind: "approve" } },
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
