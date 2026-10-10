import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importTs } from "./_tsload.mjs";

/**
 * The replay benchmark (`src/pipeline/bench.ts`, plan Task 21): the suite and its generated replay
 * repository, the hidden-test runner, the simulated user, the metrics, and the L3 gate on synthetic
 * results. Nothing here launches `claude` or reaches a network; the end-to-end run of `bench` over
 * the committed bundle is `test/autopilot-bench.test.mjs` at the repository root.
 */

// No git call below may read the developer's own configuration: a temp home whose global config
// refuses to guess an identity, as a CI runner's would. The bench's commits carry their own.
const home = mkdtempSync(join(tmpdir(), "bench-home-"));
writeFileSync(join(home, "gitconfig"), "[user]\n\tuseConfigOnly = true\n");
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = join(home, "xdg");
process.env.GIT_CONFIG_GLOBAL = join(home, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";
for (const k of Object.keys(process.env)) {
  if (k.startsWith("MARVIN_PIPELINE_")) delete process.env[k];
}

const bench = await importTs("src/pipeline/bench.ts");
const { benchSettings } = await importTs("src/pipeline/sandbox.ts");
const { readSignals, tierFor, loadRubric } = await importTs("src/pipeline/assess.ts");

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const suiteFile = join(root, "evals", "autopilot", "suites", "sandbox.yaml");
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// ------------------------------------------------------------------------------------ bench mode

test("bench mode rides on sandbox mode with green fake CI, and a roles dir needs bench mode", () => {
  const sandbox = { MARVIN_PIPELINE_SANDBOX: "1", MARVIN_PIPELINE_FAKE_CI: "green" };
  assert.deepEqual(benchSettings({}), { enabled: false, rolesDir: null });
  assert.deepEqual(benchSettings({ ...sandbox, MARVIN_PIPELINE_BENCH: "1" }), {
    enabled: true,
    rolesDir: null,
  });
  assert.throws(
    () => benchSettings({ MARVIN_PIPELINE_BENCH: "1" }),
    /honoured only with MARVIN_PIPELINE_SANDBOX=1/,
  );
  assert.throws(
    () =>
      benchSettings({
        MARVIN_PIPELINE_SANDBOX: "1",
        MARVIN_PIPELINE_FAKE_CI: "red",
        MARVIN_PIPELINE_BENCH: "1",
      }),
    /needs MARVIN_PIPELINE_FAKE_CI=green/,
  );
  assert.throws(() => benchSettings({ MARVIN_PIPELINE_BENCH: "yes" }), /must be 1 or 0/);

  const roles = mkdtempSync(join(tmpdir(), "bench-roles-"));
  writeFileSync(join(roles, "common.md"), "COMMON\n");
  // Outside bench mode a roles directory is refused, even in the sandbox.
  assert.throws(
    () => benchSettings({ ...sandbox, MARVIN_PIPELINE_ROLES_DIR: roles }),
    /honoured only with MARVIN_PIPELINE_BENCH=1/,
  );
  assert.throws(
    () => benchSettings({ MARVIN_PIPELINE_ROLES_DIR: roles }),
    /honoured only with MARVIN_PIPELINE_BENCH=1/,
  );
  const on = { ...sandbox, MARVIN_PIPELINE_BENCH: "1" };
  assert.equal(benchSettings({ ...on, MARVIN_PIPELINE_ROLES_DIR: roles }).rolesDir, roles);
  assert.throws(
    () => benchSettings({ ...on, MARVIN_PIPELINE_ROLES_DIR: join(roles, "nope") }),
    /holding common\.md/,
  );
});

test("the bench environment turns bench mode on and drops what would steer a run from outside", () => {
  const env = bench.benchEnv(
    {
      PATH: "/usr/bin",
      NODE_TEST_CONTEXT: "child",
      MARVIN_PIPELINE_JUDGE: "fixtures",
      MARVIN_PIPELINE_FIXTURES: "/x",
      MARVIN_TASKS_CONFIG: "/y",
      MARVIN_PIPELINE_ROLES_DIR: "/stale",
      GIT_DIR: "/elsewhere",
      GIT_CONFIG_GLOBAL: "/g",
      MARVIN_PIPELINE_MODEL_OVERRIDE: "haiku",
    },
    { stateHome: "/state", stubBin: "/stub" },
  );
  assert.equal(env.PATH, "/stub:/usr/bin");
  assert.equal(env.MARVIN_PIPELINE_HOME, "/state");
  assert.equal(env.MARVIN_PIPELINE_SANDBOX, "1");
  assert.equal(env.MARVIN_PIPELINE_BENCH, "1");
  assert.equal(env.MARVIN_PIPELINE_FAKE_CI, "green");
  assert.equal(env.MARVIN_PIPELINE_MODEL_OVERRIDE, "haiku");
  assert.equal(env.GIT_CONFIG_GLOBAL, "/g");
  for (const gone of [
    "NODE_TEST_CONTEXT",
    "MARVIN_PIPELINE_JUDGE",
    "MARVIN_PIPELINE_FIXTURES",
    "MARVIN_TASKS_CONFIG",
    "MARVIN_PIPELINE_ROLES_DIR",
    "GIT_DIR",
  ]) {
    assert.equal(env[gone], undefined, gone);
  }
});

// --------------------------------------------------------------------------- suite and replay repo

test("the shipped suite loads, and every reference spec assesses to its tier_expected", () => {
  const loaded = bench.loadSuite(suiteFile);
  assert.equal(loaded.suite.name, "sandbox");
  const tiers = loaded.suite.tasks.map((t) => t.tier_expected);
  assert.ok(loaded.suite.tasks.length >= 4);
  assert.ok(tiers.filter((t) => t === "light").length >= 2);
  assert.ok(tiers.filter((t) => t === "standard").length >= 2);
  const rubric = loadRubric(
    readFileSync(join(root, "plugins", "marvin", "pipeline", "rubric.default.yaml"), "utf8"),
    null,
  );
  for (const t of loaded.suite.tasks) {
    assert.ok(t.reference_spec, `${t.id} has no reference spec`);
    const spec = readFileSync(join(loaded.replayDir, t.reference_spec), "utf8");
    assert.equal(tierFor(readSignals(spec, rubric), rubric).tier, t.tier_expected, t.id);
  }
});

test("a suite with a duplicate id, an escaping hidden test or a missing overlay is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "bench-suite-"));
  mkdirSync(join(dir, "replay", "project"), { recursive: true });
  mkdirSync(join(dir, "replay", "tasks", "a", "reference"), { recursive: true });
  const task = (id, extra = {}) => ({
    id,
    base_sha: `bench/${id}/base`,
    reference: `bench/${id}/reference`,
    tier_expected: "light",
    hidden_tests: ["test/a.test.mjs"],
    task_text: "Do a.",
    ground_truth: "a is done.",
    ...extra,
  });
  const write = (tasks) => {
    const file = join(dir, "suite.yaml");
    writeFileSync(file, JSON.stringify({ version: 1, name: "s", replay: "replay", tasks }));
    return file;
  };
  assert.equal(bench.loadSuite(write([task("a")])).suite.tasks[0].stage_a, "standard");
  assert.throws(() => bench.loadSuite(write([task("a"), task("a")])), /duplicate task id a/);
  assert.throws(
    () => bench.loadSuite(write([task("a", { hidden_tests: ["../x.test.mjs"] })])),
    /relative POSIX path/,
  );
  assert.throws(() => bench.loadSuite(write([task("b")])), /no tasks\/b\/reference/);
  assert.throws(
    () => bench.selectTasks(bench.loadSuite(write([task("a")])).suite, ["zz"]),
    /no such task/,
  );
});

test("the replay repository is deterministic, and a run's origin holds the base history only", () => {
  const loaded = bench.loadSuite(suiteFile);
  const a = bench.buildReplayRepo(loaded, mkdtempSync(join(tmpdir(), "bench-replay-")));
  const b = bench.buildReplayRepo(loaded, mkdtempSync(join(tmpdir(), "bench-replay-")));
  assert.equal(git(a, "rev-parse", "HEAD"), git(b, "rev-parse", "HEAD"));
  // One root commit, then one reference commit per task, each tagged with its parent.
  assert.equal(git(a, "rev-list", "--count", "HEAD"), String(loaded.suite.tasks.length + 1));
  for (const t of loaded.suite.tasks) {
    const base = bench.resolveRevision(a, t.base_sha);
    const reference = bench.resolveRevision(a, t.reference);
    assert.equal(git(a, "rev-parse", `${reference}^`), base, t.id);
    for (const path of t.hidden_tests) {
      assert.throws(() => git(a, "cat-file", "-e", `${base}:${path}`), `${t.id} ${path} at base`);
    }
  }
  assert.equal(
    bench.testOneTemplate(a, bench.resolveRevision(a, "bench/csv-quotes/base")),
    "node --test {file}",
  );

  const csv = loaded.suite.tasks.find((t) => t.id === "csv-quotes");
  const base = bench.resolveRevision(a, csv.base_sha);
  const { origin, repo } = bench.prepareTaskRepo(
    a,
    base,
    mkdtempSync(join(tmpdir(), "bench-run-")),
  );
  assert.equal(git(origin, "rev-parse", "dev"), base);
  assert.equal(git(origin, "tag"), "");
  // Neither csv-quotes' own reference commit nor a later task's reached the origin. An earlier
  // task's reference is part of the base's history by construction, as in a real repository.
  const at = loaded.suite.tasks.indexOf(csv);
  loaded.suite.tasks.forEach((t, i) => {
    const reference = bench.resolveRevision(a, t.reference);
    if (i < at) assert.equal(git(origin, "cat-file", "-t", reference), "commit", t.id);
    else assert.throws(() => git(origin, "cat-file", "-e", reference), `${t.id} reference leaked`);
  });
  assert.equal(git(repo, "rev-parse", "HEAD"), base);
  assert.ok(existsSync(join(repo, ".marvin", "config.json")));
});

// ------------------------------------------------------------------------------------ hidden tests

test("hidden tests replace the pipeline's file of the same name and run through shell quoting", () => {
  const replay = mkdtempSync(join(tmpdir(), "bench-hidden-replay-"));
  git(replay, "init", "-q", "-b", "dev");
  const odd = "test/(group) it's/a b.test.mjs";
  mkdirSync(join(replay, "test", "(group) it's"), { recursive: true });
  writeFileSync(
    join(replay, odd),
    'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { v } from "../../v.mjs";\ntest("v", () => assert.equal(v, 2));\n',
  );
  writeFileSync(
    join(replay, "test", "fails.test.mjs"),
    'import { test } from "node:test";\ntest("no", () => { throw new Error("hidden failure"); });\n',
  );
  git(replay, "add", "-A");
  git(replay, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "ref");
  const reference = git(replay, "rev-parse", "HEAD");

  const worktree = mkdtempSync(join(tmpdir(), "bench-hidden-wt-"));
  writeFileSync(join(worktree, "package.json"), '{ "type": "module" }\n');
  writeFileSync(join(worktree, "v.mjs"), "export const v = 2;\n");
  mkdirSync(join(worktree, "test", "(group) it's"), { recursive: true });
  // The pipeline's own test under the hidden test's name, which must not be what runs.
  writeFileSync(join(worktree, odd), "throw new Error('the pipeline version ran');\n");

  const result = bench.runHiddenTests({
    worktree,
    replayRepo: replay,
    reference,
    paths: [odd, "test/fails.test.mjs"],
    testOne: "node --test {file}",
  });
  assert.equal(result.total, 2);
  assert.equal(result.passed, 1, JSON.stringify(result.files, null, 2));
  assert.equal(result.ratio, 0.5);
  assert.deepEqual(
    result.files.map((f) => [f.path, f.passed]),
    [
      [odd, true],
      ["test/fails.test.mjs", false],
    ],
  );
  assert.match(result.files[1].detail, /fail/i);

  const none = bench.runHiddenTests({
    worktree: null,
    replayRepo: replay,
    reference,
    paths: [odd],
    testOne: "node --test {file}",
  });
  assert.deepEqual([none.passed, none.total, none.ratio], [0, 1, 0]);
  assert.match(none.skipped, /no worktree/);
  // A template the seal stage refuses is refused here too: one reader, one rule.
  assert.throws(
    () =>
      bench.runHiddenTests({
        worktree,
        replayRepo: replay,
        reference,
        paths: [odd],
        testOne: "node --test '{file}'",
      }),
    /must not quote \{file\}/,
  );
});

// --------------------------------------------------------------------------------------- judge

const task = {
  id: "clamp",
  task_text: "Add clamp.",
  ground_truth: "clamp throws a RangeError when lo > hi.",
  hidden_tests: ["test/clamp.test.mjs"],
  tier_expected: "light",
  stage_a: "standard",
  base_sha: "x",
  reference: "y",
};

test("the simulated user approves, cancels a halt, and retries one unverified PASS", async () => {
  const seen = new Map();
  const ctx = { judge: bench.autoJudge, task, seen };
  assert.deepEqual((await bench.decideJudgment("spec_approval", {}, ctx)).answer, {
    kind: "approve",
  });
  assert.equal((await bench.decideJudgment("halt", { reason: "cap" }, ctx)).answer.kind, "cancel");
  assert.equal((await bench.decideJudgment("no_ci", {}, ctx)).answer.kind, "proceed");
  assert.deepEqual((await bench.decideJudgment("unverified", {}, ctx)).answer, { kind: "retry" });
  assert.equal((await bench.decideJudgment("unverified", {}, ctx)).answer.kind, "cancel");
  const q = await bench.decideJudgment(
    "planner_questions",
    { questions: [{ id: "Q1", text: "Bounds inclusive?", recommendation: "yes" }] },
    ctx,
  );
  assert.deepEqual(q.answer, { kind: "answers", text: "Q1: yes", count: 1 });
  assert.equal(q.answeredBy, "orchestrator");
});

test("the llm judge runs the override model with no tools, never Fable, and answers by id", async () => {
  assert.equal(bench.judgeModel({}), "opus");
  assert.equal(
    bench.judgeModel({
      MARVIN_PIPELINE_SANDBOX: "1",
      MARVIN_PIPELINE_FAKE_CI: "green",
      MARVIN_PIPELINE_MODEL_OVERRIDE: "haiku",
    }),
    "haiku",
  );
  assert.throws(
    () =>
      bench.judgeModel({
        MARVIN_PIPELINE_SANDBOX: "1",
        MARVIN_PIPELINE_FAKE_CI: "green",
        MARVIN_PIPELINE_MODEL_OVERRIDE: "fable",
      }),
    /Fable is not allowed/,
  );
  assert.throws(() => bench.llmJudge({ model: "claude-fable-1", workDir: home }), /Fable/);

  const calls = [];
  const runClaude = async (argv, cwd) => {
    calls.push({ argv, cwd });
    return `${JSON.stringify({
      type: "result",
      is_error: false,
      total_cost_usd: 0.0123,
      structured_output: { decision: "answers", answers: [{ id: "Q1", answer: "Inclusive." }] },
    })}\n`;
  };
  const judge = bench.llmJudge({ model: "haiku", workDir: join(home, "judge"), runClaude });
  const out = await bench.decideJudgment(
    "planner_questions",
    {
      questions: [
        { id: "Q1", text: "Bounds inclusive?", recommendation: "yes" },
        { id: "Q2", text: "Name?", recommendation: "clamp" },
      ],
    },
    { judge, task, seen: new Map() },
  );
  // A question the judge left out keeps the child's recommendation.
  assert.deepEqual(out.answer, { kind: "answers", text: "Q1: Inclusive.\nQ2: clamp", count: 2 });
  assert.equal(out.answeredBy, "user");
  assert.equal(out.costUsd, 0.0123);
  const { argv, cwd } = calls[0];
  assert.equal(cwd, join(home, "judge"));
  assert.equal(argv[argv.indexOf("--model") + 1], "haiku");
  assert.equal(argv[argv.indexOf("--effort") + 1], "medium");
  assert.ok(argv.includes("--strict-mcp-config"));
  assert.equal(argv[argv.indexOf("--permission-mode") + 1], "dontAsk");
  for (const tool of ["Bash", "Read", "Edit", "Write"]) assert.ok(argv.includes(tool), tool);
  const prompt = argv[argv.indexOf("-p") + 1];
  assert.match(prompt, /RangeError when lo > hi/);
  assert.doesNotMatch(prompt, /clamp\.test\.mjs/, "the hidden tests never reach the judge");
});

test("a failing judge falls back to recommendations; a usage limit stops the bench", async () => {
  const broken = bench.llmJudge({
    model: "haiku",
    workDir: join(home, "judge2"),
    runClaude: async () => '{"type":"result","is_error":true,"subtype":"error_during_execution"}\n',
  });
  const questions = { questions: [{ id: "Q1", text: "?", recommendation: "yes" }] };
  const out = await bench.decideJudgment("executor_questions", questions, {
    judge: broken,
    task,
    seen: new Map(),
  });
  assert.equal(out.answer.text, "Q1: yes");
  assert.match(out.fallback, /the judge failed/);

  const limited = bench.llmJudge({
    model: "haiku",
    workDir: join(home, "judge3"),
    runClaude: async () =>
      '{"type":"result","is_error":true,"result":"Claude AI usage limit reached|1760000000"}\n',
  });
  await assert.rejects(
    bench.decideJudgment("planner_questions", questions, {
      judge: limited,
      task,
      seen: new Map(),
    }),
    bench.UsageLimitError,
  );
});

// ------------------------------------------------------------------------------------- metrics

test("run metrics sum cost and cache reads per role and count rejections by source", () => {
  const child = (role, iteration, costUsd, cacheReadTokens, status = "done") => ({
    role,
    iteration,
    costUsd,
    cacheReadTokens,
    status,
  });
  const m = bench.runMetrics({
    stage: "ready",
    haltReason: null,
    tier: "standard",
    gateReport: { passed: true },
    rejections: [
      { iteration: 1, source: "verifier", fingerprints: [] },
      { iteration: 2, source: "gate", fingerprints: [] },
    ],
    children: [
      child("planner", 0, 0.5, 100),
      child("executor", 1, 0.2, 10),
      child("executor", 2, 0.3, 20),
      child("verifier", 1, null, null),
    ],
  });
  assert.equal(m.totalCostUsd, 1);
  assert.equal(m.cacheReadTokens, 130);
  assert.equal(m.iterations, 2);
  assert.deepEqual(m.rejections, { total: 2, gate: 1, verifier: 1, ci: 0 });
  assert.equal(m.perRole.executor.children, 2);
  assert.equal(m.perRole["test-author"].children, 0);
  assert.equal(m.gatesGreen, true);
  assert.equal(m.limited, false);
  assert.equal(
    bench.runMetrics({
      stage: "done",
      haltReason: "usage limit",
      tier: null,
      gateReport: null,
      rejections: [],
      children: [child("planner", 0, 0.1, 0, "limited")],
    }).limited,
    true,
  );
});

// --------------------------------------------------------------------------------------- L3 gate

/** A synthetic bench result: `spec` maps each task to its runs as `[passed, total, costUsd]`. */
function result(variant, spec, extra = {}) {
  const tasks = Object.entries(spec).map(([id, runs]) => ({
    id,
    tierExpected: "light",
    runs: runs.map(([passed, total, cost, outcome = "ready"], i) => ({
      task: id,
      repeat: i + 1,
      outcome,
      hidden: { passed, total, ratio: total === 0 ? 0 : passed / total, files: [] },
      totalCostUsd: cost,
      judgeCostUsd: 0,
      tierMatch: true,
      wallMs: 1000,
    })),
  }));
  return {
    version: 1,
    suite: "sandbox",
    variant,
    date: "2026-10-10",
    settings: { repeat: 2 },
    tasks,
    summary: bench.summarize(tasks),
    ...extra,
  };
}

const baseline = result("baseline", {
  a: [
    [2, 2, 1.0],
    [2, 2, 1.0],
  ],
  b: [
    [1, 2, 1.0],
    [2, 2, 1.0],
  ],
});

test("L3: an equal pass rate within 1.15 × the cost is accepted", () => {
  const v = bench.l3Gate(
    baseline,
    result("cand", {
      a: [
        [2, 2, 1.1],
        [2, 2, 1.1],
      ],
      b: [
        [2, 2, 1.1],
        [1, 2, 1.1],
      ],
    }),
  );
  assert.equal(v.decision, "accept", v.reasons.join("; "));
  assert.equal(v.checks.costWithinBound, true);
});

test("L3: a task that regresses in both repeats is rejected even when the pass rate rose", () => {
  // b has four hidden files, so its gain outweighs a's loss in the pooled rate (8/12 → 10/12).
  const base = result("baseline", {
    a: [
      [2, 2, 1.0],
      [2, 2, 1.0],
    ],
    b: [
      [2, 4, 1.0],
      [2, 4, 1.0],
    ],
  });
  const v = bench.l3Gate(
    base,
    result("cand", {
      a: [
        [1, 2, 1.0],
        [1, 2, 1.0],
      ],
      b: [
        [4, 4, 1.0],
        [4, 4, 1.0],
      ],
    }),
  );
  assert.equal(v.checks.passRateRose, true);
  assert.deepEqual(v.checks.regressedInEveryRepeat, ["a"]);
  assert.equal(v.decision, "reject");
  assert.match(v.reasons.join("; "), /regressed in every repeat: a/);
});

test("L3: a task that regresses in one repeat only is not a regression", () => {
  const v = bench.l3Gate(
    baseline,
    result("cand", {
      a: [
        [1, 2, 1.0],
        [2, 2, 1.0],
      ],
      b: [
        [2, 2, 1.0],
        [2, 2, 1.0],
      ],
    }),
  );
  assert.deepEqual(v.checks.regressedInEveryRepeat, []);
  assert.equal(v.decision, "accept", v.reasons.join("; "));
});

test("L3: a falling pass rate is rejected", () => {
  const v = bench.l3Gate(
    baseline,
    result("cand", {
      a: [
        [2, 2, 0.5],
        [1, 2, 0.5],
      ],
      b: [
        [1, 2, 0.5],
        [2, 2, 0.5],
      ],
    }),
  );
  assert.equal(v.checks.passRateHeld, false);
  assert.equal(v.decision, "reject");
});

test("L3: cost over 1.15 × is rejected at an equal pass rate and accepted when the rate rose", () => {
  const dearer = bench.l3Gate(
    baseline,
    result("cand", {
      a: [
        [2, 2, 1.2],
        [2, 2, 1.2],
      ],
      b: [
        [1, 2, 1.2],
        [2, 2, 1.2],
      ],
    }),
  );
  assert.equal(dearer.checks.costWithinBound, false);
  assert.equal(dearer.decision, "reject");
  assert.match(dearer.reasons.join("; "), /exceeds 1\.15 × baseline/);

  const better = bench.l3Gate(
    baseline,
    result("cand", {
      a: [
        [2, 2, 3.0],
        [2, 2, 3.0],
      ],
      b: [
        [2, 2, 3.0],
        [2, 2, 3.0],
      ],
    }),
  );
  assert.equal(better.checks.passRateRose, true);
  assert.equal(better.checks.costWithinBound, false);
  assert.equal(better.decision, "accept", better.reasons.join("; "));
});

test("L3: one repeat, a different task set or an incomplete run is inconclusive, never accepted", () => {
  const once = result("cand", { a: [[2, 2, 1.0]], b: [[2, 2, 1.0]] });
  const v1 = bench.l3Gate(baseline, once);
  assert.equal(v1.decision, "inconclusive");
  assert.match(v1.reasons.join("; "), /ran a 1× \(needs 2\)/);
  assert.equal(bench.l3Gate(baseline, once, { minRepeats: 1 }).decision, "accept");

  const other = result("cand", {
    a: [
      [2, 2, 1.0],
      [2, 2, 1.0],
    ],
  });
  assert.equal(bench.l3Gate(baseline, other).decision, "inconclusive");

  const limited = result("cand", {
    a: [
      [2, 2, 1.0],
      [0, 2, 0.1, "limited"],
    ],
    b: [
      [2, 2, 1.0],
      [2, 2, 1.0],
    ],
  });
  const v3 = bench.l3Gate(baseline, limited);
  assert.equal(v3.decision, "inconclusive");
  assert.match(v3.reasons.join("; "), /incomplete run\(s\) of a \(limited\)/);
});

test("the comparison markdown states the decision, both rates and both costs", () => {
  const cand = result("cand", {
    a: [
      [2, 2, 1.0],
      [2, 2, 1.0],
    ],
    b: [
      [2, 2, 1.0],
      [2, 2, 1.0],
    ],
  });
  const md = bench.renderComparisonMarkdown(baseline, cand, bench.l3Gate(baseline, cand));
  assert.match(md, /\*\*Decision: accept\.\*\*/);
  assert.match(md, /\| Hidden pass rate \| 87\.5% \| 100\.0% \|/);
  assert.match(md, /\| Notional cost \| \$4\.00 \| \$4\.00 \|/);
  assert.match(md, /\| b \| 1\/2, 2\/2 \| 2\/2, 2\/2 \|/);
});

test("the runtime takes its role prompts from a bench roles dir, and refuses one outside bench mode", async () => {
  const { createRuntime } = await importTs("src/pipeline/runtime.ts");
  const roles = mkdtempSync(join(tmpdir(), "bench-roles-rt-"));
  writeFileSync(join(roles, "common.md"), "COMMON\n");
  const options = {
    runDir: mkdtempSync(join(tmpdir(), "bench-rundir-")),
    pluginRoot: join(root, "plugins", "marvin"),
    rubric: loadRubric(
      readFileSync(join(root, "plugins", "marvin", "pipeline", "rubric.default.yaml"), "utf8"),
      null,
    ),
  };
  const saved = { ...process.env };
  try {
    process.env.MARVIN_PIPELINE_ROLES_DIR = roles;
    assert.throws(() => createRuntime(options), /honoured only with MARVIN_PIPELINE_BENCH=1/);
    Object.assign(process.env, {
      MARVIN_PIPELINE_SANDBOX: "1",
      MARVIN_PIPELINE_FAKE_CI: "green",
      MARVIN_PIPELINE_BENCH: "1",
    });
    assert.equal(typeof createRuntime(options).spawnChild, "function");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  }
});
