import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { importTs } from "./_tsload.mjs";

const engine = await importTs("src/pipeline/engine.ts");
const { decide } = engine;
const { initRun } = await importTs("src/pipeline/run-store.ts");
const gateModule = await importTs("src/pipeline/gate.ts");
const { loadRubric } = await importTs("src/pipeline/assess.ts");
const DEFAULT = readFileSync(
  fileURLToPath(new URL("../../../pipeline/rubric.default.yaml", import.meta.url)),
  "utf8",
);
const rubric = loadRubric(DEFAULT, null);
const NOW = new Date("2026-10-04T10:00:00Z");
const PR = "https://github.com/tesari-ai/osint/pull/42";

const at = (stage, patch = {}) => ({
  ...initRun({
    id: "r1",
    repoRoot: "/repo",
    base: "dev",
    lang: "ru",
    orchestratorName: "Autopilot",
    task: "задача",
    taskEnglish: "task",
    stageA: "standard",
    now: NOW,
  }),
  stage,
  branch: "feature/OSI-TBD--x",
  specPath: "specs/1-x.md",
  tier: "standard",
  ...patch,
});
const child = (role, structured, outcome = "done") => ({
  kind: "child",
  role,
  result: {
    outcome,
    sessionId: "s",
    costUsd: 0.1,
    durationMs: 1,
    cacheReadTokens: 0,
    structured,
    detail: "",
  },
});
const answer = (judgment, a) => ({ kind: "answer", judgment, answer: a });
const finding = (o = {}) => ({
  id: "F1",
  severity: "major",
  category: "criterion",
  file: "src/a.ts",
  criterion: "AC1",
  claim: "c",
  evidence: "e",
  expected: "x",
  ...o,
});
const verdict = (v, findings = [], criteria = [{ id: "AC1", result: "met", evidence: "t" }]) => ({
  status: "done",
  verdict: v,
  summary: "s",
  criteria,
  findings,
});
const report = (passed) => ({
  passed,
  gates: [],
  undeclared: [],
  protected: [],
  protectedSources: {},
  protectedPatterns: [],
  checks: [],
  sealed: [],
  blockers: [],
});
const light = {
  risk: "low",
  bugfix: false,
  files: 3,
  newFiles: 1,
  criteria: 2,
  paths: ["src/a.ts"],
  sensitive: [],
  crossRepo: [],
  riskNote: null,
};
const executorDone = (extra = {}) => ({
  status: "done",
  summary: "s",
  claims: ["x"],
  pr_url: PR,
  ...extra,
});
const question = { id: "Q1", text: "t", recommendation: "use A", why_blocking: "w" };
const sealedTest = (path = "src/a.test.ts", criteria = ["AC1"]) => ({
  path,
  sha256: "h",
  criteria,
});
const spawnOf = (d) => d.actions.find((a) => a.kind === "spawn");
const works = (d) => d.actions.filter((a) => a.kind === "work").map((a) => a.work);
const judgmentOf = (d) => d.actions.find((a) => a.kind === "judgment")?.judgment;
const payloadOf = (d) => d.actions.find((a) => a.kind === "judgment")?.payload;
const go = (run, obs, r = rubric) => decide(run, obs, r, NOW);
const approve = (run, r = rubric) => go(run, answer("spec_approval", { kind: "approve" }), r);
const deepFreeze = (o) => {
  if (o !== null && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

test("start spawns the planner at the stage-A assignment", () => {
  const d = go(at("intake", { tier: null }), { kind: "start" });
  assert.equal(d.run.stage, "planning");
  assert.deepEqual(spawnOf(d).assignment, { model: "opus", effort: "high" });
});

test("planner questions become a judgment; past the cap the recommendations are accepted", () => {
  const q = [question];
  const d = go(
    at("planning"),
    child("planner", { status: "needs_input", summary: "s", questions: q }, "needs_input"),
  );
  assert.equal(d.run.stage, "awaiting_answer");
  assert.equal(judgmentOf(d), "planner_questions");
  const capped = go(
    at("planning", { questionsAnswered: 8 }),
    child("planner", { status: "needs_input", summary: "s", questions: q }, "needs_input"),
  );
  assert.equal(judgmentOf(capped), undefined);
  assert.equal(spawnOf(capped).resume, true);
  assert.match(spawnOf(capped).context.message, /Q1: use A/);
});

test("spec ready computes the tier and asks for approval", () => {
  const d = go(at("planning", { tier: null }), {
    ...child(
      "planner",
      { status: "spec_ready", summary: "s", spec: { path: "specs/1-x.md" } },
      "spec_ready",
    ),
    signals: light,
  });
  assert.equal(d.run.stage, "awaiting_approval");
  assert.equal(d.run.tier, "light");
  assert.equal(judgmentOf(d), "spec_approval");
});

test("approval routes standard work through the test-author and light work straight to the executor", () => {
  const std = approve(at("awaiting_approval"));
  assert.equal(std.run.stage, "test_authoring");
  assert.deepEqual(works(std), ["rename_branch"]);
  assert.deepEqual(spawnOf(std).assignment, { model: "opus", effort: "medium" });
  const lt = approve(at("awaiting_approval", { tier: "light" }));
  assert.equal(lt.run.stage, "executing");
  assert.deepEqual([spawnOf(lt).role, spawnOf(lt).iteration], ["executor", 1]);
});

test("sealing: success starts the executor, repeated rejection halts", () => {
  const ok = go(at("test_authoring"), {
    kind: "seal",
    ok: true,
    reasons: [],
    sealed: [{ path: "a.test.ts", sha256: "h", criteria: ["AC1"] }],
  });
  assert.equal(ok.run.stage, "executing");
  assert.equal(ok.run.sealed.length, 1);
  const halt = go(at("test_authoring", { testAuthorAttempts: 1 }), {
    kind: "seal",
    ok: false,
    reasons: ["passes before implementation"],
    sealed: [],
  });
  assert.equal(judgmentOf(halt), "halt");
});

test("an executor done that names no pull request is a fault while the run has none", () => {
  // The CI stage reads the run's PR and has no other way to find one, so a `done` that leaves
  // the run without a PR would reach fetchCi with nothing to poll. It costs a retry like any
  // other invalid output, then halts.
  retryThenHalt(
    executingRun(),
    child("executor", executorDone({ pr_url: undefined })),
    "executor",
    /done without a pull request/,
  );
  // A later iteration may push to the PR an earlier one opened and name it again or not.
  const later = go(
    at("executing", { iteration: 2, prUrl: PR }),
    child("executor", executorDone({ pr_url: undefined })),
  );
  assert.equal(later.run.stage, "gating");
  assert.equal(later.run.prUrl, PR);
});

test("an executor's context names its run and its tier", () => {
  const ctx = spawnOf(approve(at("awaiting_approval", { tier: "light" }))).context;
  assert.equal(ctx.run, "r1");
  assert.equal(ctx.tier, "light");
});

test("executor done goes to the gate; a failed gate escalates the next executor", () => {
  const d = go(at("executing", { iteration: 1 }), child("executor", executorDone()));
  assert.equal(d.run.stage, "gating");
  assert.deepEqual(works(d), ["gate"]);
  assert.equal(d.run.prUrl, PR);
  assert.deepEqual(d.run.claims, ["x"]);
  const rej = go(at("gating", { iteration: 1 }), {
    kind: "gate",
    report: report(false),
    findings: [finding({ severity: "blocker", category: "gate" })],
  });
  assert.equal(rej.run.stage, "executing");
  assert.deepEqual([spawnOf(rej).iteration, spawnOf(rej).assignment.effort], [2, "xhigh"]);
});

test("a passed gate snapshots the tree and spawns a verifier no weaker than the executor", () => {
  const d = go(at("gating", { tier: "light", rung: 2, iteration: 3 }), {
    kind: "gate",
    report: report(true),
    findings: [],
  });
  assert.equal(d.run.stage, "verifying");
  assert.deepEqual(works(d), ["snapshot"]);
  assert.deepEqual(spawnOf(d).assignment, { model: "opus", effort: "high" });
});

test("any child that touched the main checkout halts the run, whatever its result (S10)", () => {
  const d = go(at("executing", { iteration: 1 }), {
    ...child("executor", { status: "done", summary: "s", claims: [] }),
    leaked: ["?? spike.txt"],
  });
  assert.equal(judgmentOf(d), "halt");
  assert.equal(d.run.stage, "executing");
});

test("verifier PASS goes to CI; a tree mutation halts", () => {
  const pass = go(at("verifying", { iteration: 1 }), child("verifier", verdict("PASS")));
  assert.equal(pass.run.stage, "ci_wait");
  assert.deepEqual(works(pass), ["ci"]);
  const mutated = go(at("verifying"), {
    ...child("verifier", verdict("PASS")),
    mutated: ["?? x.txt"],
  });
  assert.equal(judgmentOf(mutated), "halt");
});

test("an unmet criterion fails even under a PASS verdict; FAIL without substance re-verifies once", () => {
  const unmet = go(
    at("verifying", { iteration: 1 }),
    child("verifier", verdict("PASS", [], [{ id: "AC1", result: "unmet", evidence: "e" }])),
  );
  assert.equal(unmet.run.stage, "executing");
  const hollow = go(
    at("verifying", { iteration: 1 }),
    child("verifier", verdict("FAIL", [finding({ severity: "minor" })])),
  );
  assert.equal(spawnOf(hollow).role, "verifier");
  assert.equal(hollow.run.minorFindings.length, 1);
});

test("a repeated fingerprint skips the remaining effort steps", () => {
  const r2 = loadRubric(
    DEFAULT,
    "escalation: [effort+1, effort+1, 'model:opus', halt]\ncaps: { rejections: 5 }\n",
  );
  const prev = [{ iteration: 1, source: "verifier", fingerprints: ["criterion|src/a.ts|AC1"] }];
  const d = go(
    at("verifying", { rung: 1, iteration: 2, rejections: prev }),
    child("verifier", verdict("FAIL", [finding()])),
    r2,
  );
  assert.equal(d.run.rung, 3);
  assert.equal(spawnOf(d).assignment.model, "opus");
});

test("the third rejection halts", () => {
  const prev = [
    { iteration: 1, source: "gate", fingerprints: ["gate||"] },
    { iteration: 2, source: "verifier", fingerprints: ["x||"] },
  ];
  const d = go(
    at("verifying", { rung: 2, iteration: 3, rejections: prev }),
    child("verifier", verdict("FAIL", [finding({ file: "src/b.ts" })])),
  );
  assert.equal(judgmentOf(d), "halt");
});

test("a sealed-test fault reopens test authoring instead of punishing the executor", () => {
  const d = go(
    at("verifying", { sealed: [sealedTest()] }),
    child(
      "verifier",
      verdict("FAIL", [finding({ category: "test-quality", file: "src/a.test.ts" })]),
    ),
  );
  assert.equal(d.run.stage, "test_authoring");
  assert.equal(d.run.rung, 0);
  assert.equal(d.run.testAuthorAttempts, 1);
  assert.equal(spawnOf(d).role, "test-author");
  assert.match(spawnOf(d).context.feedback, /test-quality/);
});

test("CI: conflict sends the executor to merge the base; green starts the retro", () => {
  const conflict = go(at("ci_wait", { iteration: 1 }), {
    kind: "ci",
    state: "conflict",
    failing: [],
  });
  assert.equal(conflict.run.stage, "executing");
  assert.match(spawnOf(conflict).context.findings, /merge origin\/dev/);
  const green = go(at("ci_wait"), { kind: "ci", state: "green", failing: [] });
  assert.deepEqual([green.run.stage, spawnOf(green).role], ["retro", "retro"]);
  assert.equal(judgmentOf(go(at("ci_wait"), { kind: "ci", state: "no_ci", failing: [] })), "no_ci");
});

test("finalize waits for CI again, then marks the PR ready", () => {
  const f = go(at("finalizing"), { kind: "finalized" });
  assert.deepEqual(works(f), ["ci"]);
  const ready = go({ ...f.run }, { kind: "ci", state: "green", failing: [] });
  assert.equal(ready.run.stage, "ready");
  assert.deepEqual(works(ready), ["mark_ready"]);
});

test("a crash is retried once, then halts; a usage limit halts at once", () => {
  const started = approve(at("awaiting_approval", { tier: "light" }));
  assert.equal(started.run.lastSpawn.executor.role, "executor");
  const first = go(started.run, child("executor", null, "crashed"));
  assert.equal(spawnOf(first).role, "executor");
  assert.deepEqual(first.run.retries, { executor: 1 });
  assert.equal(judgmentOf(go(first.run, child("executor", null, "crashed"))), "halt");
  assert.equal(judgmentOf(go(at("executing"), child("executor", null, "limited"))), "halt");
  const handMade = go(
    at("executing", {
      lastSpawn: {
        executor: {
          kind: "spawn",
          role: "executor",
          assignment: { model: "sonnet", effort: "high" },
          iteration: 1,
          context: {},
          resume: false,
        },
      },
    }),
    child("executor", null, "failed"),
  );
  assert.equal(spawnOf(handMade).role, "executor");
});

test("cancel at approval halts and still runs the retro", () => {
  const d = go(
    at("awaiting_approval"),
    answer("spec_approval", { kind: "cancel", reason: "not now" }),
  );
  assert.deepEqual([d.run.stage, d.run.haltReason, spawnOf(d).role], ["retro", "not now", "retro"]);
});

const planningRun = () => go(at("intake", { tier: null }), { kind: "start" }).run;
const executingRun = () => approve(at("awaiting_approval", { tier: "light" })).run;
const verifyingRun = () =>
  go(at("gating", { iteration: 1 }), { kind: "gate", report: report(true), findings: [] }).run;

const retryThenHalt = (run, obs, role, pattern) => {
  const first = go(run, obs);
  assert.equal(spawnOf(first)?.role, role);
  assert.equal(judgmentOf(first), undefined);
  assert.equal(first.run.retries[role], 1);
  const second = go(first.run, obs);
  assert.equal(judgmentOf(second), "halt");
  assert.match(payloadOf(second).reason, pattern);
  assert.equal(second.run.haltRole, role);
};

test("a planner spec path that escapes the repo is a malformed result: retried once, then halted", () => {
  const bad = {
    ...child(
      "planner",
      { status: "spec_ready", summary: "s", spec: { path: "../x.md" } },
      "spec_ready",
    ),
    signals: light,
  };
  retryThenHalt(planningRun(), bad, "planner", /planner.*spec\.path/);
});

test("an executor PR URL on another host is a malformed result: retried once, then halted", () => {
  const bad = child("executor", executorDone({ pr_url: "https://example.com/o/r/pull/1" }));
  retryThenHalt(executingRun(), bad, "executor", /executor.*pr_url/);
});

test("a verifier result without criteria is a malformed result: retried once, then halted", () => {
  const { criteria: _dropped, ...noCriteria } = verdict("PASS");
  retryThenHalt(verifyingRun(), child("verifier", noCriteria), "verifier", /verifier.*criteria/);
});

test("a result whose status disagrees with its outcome, or that lacks what its status needs, is malformed", () => {
  const mismatched = child(
    "executor",
    executorDone({ status: "needs_input", questions: [question] }),
  );
  retryThenHalt(executingRun(), mismatched, "executor", /executor.*status/);
  const noQuestions = child(
    "planner",
    { status: "needs_input", summary: "s", questions: [] },
    "needs_input",
  );
  retryThenHalt(planningRun(), noQuestions, "planner", /planner.*questions/);
  const noSpec = child("planner", { status: "spec_ready", summary: "s" }, "spec_ready");
  retryThenHalt(planningRun(), { ...noSpec, signals: light }, "planner", /planner.*spec/);
  const badVerdict = child("verifier", { ...verdict("PASS"), verdict: "MAYBE" });
  retryThenHalt(verifyingRun(), badVerdict, "verifier", /verifier.*verdict/);
  const badSeverity = child("verifier", verdict("FAIL", [finding({ severity: "fatal" })]));
  retryThenHalt(verifyingRun(), badSeverity, "verifier", /verifier.*severity/);
  const noCriteria = child("verifier", verdict("PASS", [], []));
  retryThenHalt(verifyingRun(), noCriteria, "verifier", /verifier.*criteria/);
  const silent = child("executor", { status: "needs_input", summary: "s" }, "needs_input");
  retryThenHalt(executingRun(), silent, "executor", /executor.*questions/);
});

test("a malformed test-author result is retried once, then halted", () => {
  const run = approve(at("awaiting_approval")).run;
  const bad = child("test-author", {
    status: "done",
    summary: "s",
    tests: [{ path: "a.test.ts" }],
  });
  retryThenHalt(run, bad, "test-author", /test-author.*tests/);
});

test("a well-formed result keeps the child-authored detail the orchestrator needs to see", () => {
  const spec = { path: "specs/1-x.md", slug: "x", overrides: ["kept"] };
  const asked = go(at("planning", { tier: null }), {
    ...child("planner", { status: "spec_ready", summary: "s", spec }, "spec_ready"),
    signals: light,
  });
  assert.deepEqual(payloadOf(asked).spec, spec);
  const withOptions = { ...question, options: ["A", "B"] };
  const ask = go(
    at("planning"),
    child(
      "planner",
      { status: "needs_input", summary: "s", questions: [withOptions] },
      "needs_input",
    ),
  );
  assert.deepEqual(payloadOf(ask).questions, [withOptions]);
  const dispute = { path: "src/a.test.ts", reason: "r", evidence: "e" };
  const disputed = go(
    at("executing", { iteration: 1 }),
    child("executor", { status: "needs_input", summary: "s", dispute }, "needs_input"),
  );
  assert.equal(judgmentOf(disputed), "executor_questions");
  assert.deepEqual(payloadOf(disputed).dispute, dispute);
});

test("a mutated tree or a leak halts at once even when the child's output is malformed", () => {
  const { criteria: _dropped, ...noCriteria } = verdict("PASS");
  const mutated = go(verifyingRun(), { ...child("verifier", noCriteria), mutated: ["?? x.txt"] });
  assert.equal(judgmentOf(mutated), "halt");
  assert.deepEqual(payloadOf(mutated).detail, ["?? x.txt"]);
  const leaked = go(executingRun(), {
    ...child("executor", null, "crashed"),
    leaked: ["?? spike.txt"],
  });
  assert.equal(judgmentOf(leaked), "halt");
});

test("a stalled child halts at once", () => {
  assert.equal(judgmentOf(go(executingRun(), child("executor", null, "stalled"))), "halt");
});

test("a retro that fails twice, or hits a usage limit, still finalizes without a retro", () => {
  const retro = go(at("ci_wait"), { kind: "ci", state: "green", failing: [] }).run;
  const first = go(retro, child("retro", null, "crashed"));
  assert.equal(spawnOf(first).role, "retro");
  const second = go(first.run, child("retro", null, "crashed"));
  assert.equal(second.run.stage, "finalizing");
  assert.deepEqual(second.actions, [{ kind: "work", work: "finalize", data: { retro: null } }]);
  const limited = go(retro, child("retro", null, "limited"));
  assert.equal(limited.run.stage, "finalizing");
  const out = { status: "done", summary: "s", checks: [], proposals: [], lessons: [], prune: [] };
  const done = go(retro, child("retro", out));
  assert.deepEqual(done.actions, [{ kind: "work", work: "finalize", data: { retro: out } }]);
});

test("a retro whose output finalize would refuse costs a retry, then finalizes without one", () => {
  // Validated where it arrives, like every other role's output, rather than thrown at finalize.
  const retro = go(at("ci_wait"), { kind: "ci", state: "green", failing: [] }).run;
  const bad = child("retro", { status: "done", summary: "s", lessons: [] });
  const first = go(retro, bad);
  assert.equal(spawnOf(first).role, "retro");
  assert.equal(first.run.retries.retro, 1);
  const second = go(first.run, bad);
  assert.equal(second.run.stage, "finalizing");
  assert.deepEqual(second.actions, [{ kind: "work", work: "finalize", data: { retro: null } }]);
});

test("every spawn action decide emits is recorded as the run's last spawn for its role", () => {
  const decisions = [
    go(at("intake", { tier: null }), { kind: "start" }),
    approve(at("awaiting_approval")),
    approve(at("awaiting_approval", { tier: "light" })),
    go(at("gating", { iteration: 1 }), { kind: "gate", report: report(true), findings: [] }),
    go(at("ci_wait"), { kind: "ci", state: "green", failing: [] }),
    go(at("ci_wait", { iteration: 1 }), { kind: "ci", state: "conflict", failing: [] }),
    go(
      at("planning", { questionsAnswered: 8 }),
      child(
        "planner",
        { status: "needs_input", summary: "s", questions: [question] },
        "needs_input",
      ),
    ),
  ];
  for (const d of decisions) {
    const spawns = d.actions.filter((a) => a.kind === "spawn");
    assert.ok(spawns.length > 0);
    for (const s of spawns) assert.deepEqual(d.run.lastSpawn[s.role], s);
  }
  const first = go(executingRun(), child("executor", null, "crashed"));
  assert.deepEqual(first.run.lastSpawn.executor, spawnOf(first));
});

test("a recorded spawn is a copy: changing the action afterwards leaves the record alone", () => {
  const d = go(at("intake", { tier: null }), { kind: "start" });
  spawnOf(d).context.task = "tampered";
  assert.equal(d.run.lastSpawn.planner.context.task, "task");
});

test("retrying a resumed spawn resumes it again, with the context it was recorded with", () => {
  const capped = go(
    at("planning", { questionsAnswered: 8 }),
    child("planner", { status: "needs_input", summary: "s", questions: [question] }, "needs_input"),
  );
  const retried = go(capped.run, child("planner", null, "crashed"));
  assert.deepEqual(spawnOf(retried), spawnOf(capped));
  assert.equal(spawnOf(retried).resume, true);
});

test("seal failures, verifier test faults and revise_tests share one attempt cap", () => {
  const fault = child(
    "verifier",
    verdict("FAIL", [finding({ category: "test-quality", file: "src/a.test.ts" })]),
  );
  const sealed = [sealedTest()];
  const below = go(at("verifying", { sealed, testAuthorAttempts: 0 }), fault);
  assert.equal(below.run.stage, "test_authoring");
  const atCap = go(at("verifying", { sealed, testAuthorAttempts: 1 }), fault);
  assert.equal(judgmentOf(atCap), "halt");
  assert.equal(atCap.run.haltRole, "test-author");
  assert.equal(atCap.run.testAuthorAttempts, 2);
  assert.equal(atCap.run.stage, "verifying");

  const revise = answer("executor_questions", {
    kind: "revise_tests",
    text: "the AC1 test is wrong",
  });
  const open = at("awaiting_answer", { awaitingRole: "executor", iteration: 1 });
  const revised = go(open, revise);
  assert.deepEqual([revised.run.stage, revised.run.testAuthorAttempts], ["test_authoring", 1]);
  assert.equal(revised.run.awaitingRole, null);
  assert.match(spawnOf(revised).context.feedback, /AC1 test is wrong/);
  const refused = go({ ...open, testAuthorAttempts: 1 }, revise);
  assert.equal(judgmentOf(refused), "halt");
  assert.equal(refused.run.haltRole, "test-author");

  const sealFail = { kind: "seal", ok: false, reasons: ["r"], sealed: [] };
  assert.equal(judgmentOf(go(at("test_authoring", { testAuthorAttempts: 1 }), sealFail)), "halt");
  const retry = go(at("test_authoring", { testAuthorAttempts: 0 }), sealFail);
  assert.deepEqual([retry.run.stage, retry.run.testAuthorAttempts], ["test_authoring", 1]);
  assert.match(spawnOf(retry).context.feedback, /r/);
});

test("a verifier that keeps faulting a re-authored test halts at the cap instead of looping", () => {
  const fault = child(
    "verifier",
    verdict("FAIL", [finding({ category: "test-quality", file: "src/a.test.ts" })]),
  );
  const authored = child("test-author", {
    status: "done",
    tests: [{ path: "src/a.test.ts", criteria: ["AC1"] }],
  });
  const sealOk = { kind: "seal", ok: true, reasons: [], sealed: [sealedTest()] };
  const gatePass = { kind: "gate", report: report(true), findings: [] };
  const reopened = go(at("verifying", { sealed: [sealedTest()], iteration: 1 }), fault);
  assert.equal(spawnOf(reopened).role, "test-author");
  const sealing = go(reopened.run, authored);
  assert.deepEqual(works(sealing), ["seal"]);
  const executing = go(sealing.run, sealOk);
  assert.deepEqual([executing.run.stage, spawnOf(executing).iteration], ["executing", 2]);
  const gating = go(executing.run, child("executor", executorDone()));
  const verifying = go(gating.run, gatePass);
  assert.equal(verifying.run.stage, "verifying");
  const second = go(verifying.run, fault);
  assert.equal(judgmentOf(second), "halt");
  assert.equal(second.run.testAuthorAttempts, 2);
});

test("a re-seal replaces the entries it names and keeps every other seal", () => {
  const a = sealedTest("src/a.test.ts", ["AC1"]);
  const b = sealedTest("src/b.test.ts", ["AC2"]);
  const c = sealedTest("src/c.test.ts", ["AC3"]);
  const fresh = { ...b, sha256: "new" };
  const d = go(at("test_authoring", { sealed: [a, b], iteration: 2 }), {
    kind: "seal",
    ok: true,
    reasons: [],
    sealed: [fresh, c],
  });
  assert.deepEqual(d.run.sealed, [a, fresh, c]);
  assert.equal(d.run.iteration, 3);
  assert.match(
    spawnOf(d).context.sealed,
    /src\/a\.test\.ts[\s\S]*src\/b\.test\.ts[\s\S]*src\/c\.test\.ts/,
  );
});

test("the test-author's tests go to the seal work, and nothing else is read from its output", () => {
  const d = go(
    at("test_authoring"),
    child("test-author", {
      status: "done",
      summary: "s",
      tests: [{ path: "a.test.ts", criteria: ["AC1"], note: "ignored" }],
      extra: "ignored",
    }),
  );
  assert.deepEqual(d.actions, [
    { kind: "work", work: "seal", data: { tests: [{ path: "a.test.ts", criteria: ["AC1"] }] } },
  ]);
});

test("unknown stage and observation pairs throw instead of being ignored", () => {
  assert.throws(() => go(at("executing"), { kind: "ci", state: "green", failing: [] }), /no rule/);
  assert.throws(() => go(at("gating"), { kind: "start" }), /no rule/);
  assert.throws(() => go(at("done"), { kind: "finalized" }), /no rule/);
  assert.throws(() => go(at("planning"), child("executor", executorDone())), /no rule/);
});

test("a child that is still running is not an observation", () => {
  assert.throws(() => go(at("executing"), child("executor", null, "running")), /still running/);
});

test("an answer must belong to the judgment the run is waiting on", () => {
  const wrong = answer("planner_questions", { kind: "approve" });
  assert.throws(() => go(at("awaiting_approval"), wrong), /no rule/);
  const answers = answer("planner_questions", { kind: "answers", text: "t", count: 1 });
  assert.throws(() => go(at("awaiting_answer", { awaitingRole: "executor" }), answers), /no rule/);
  const revise = answer("planner_questions", { kind: "revise_tests", text: "t" });
  assert.throws(() => go(at("awaiting_answer", { awaitingRole: "planner" }), revise), /no rule/);
  assert.throws(() => go(at("executing"), answer("halt", { kind: "wait" })), /halt/);
});

test("answers resume the asking child; changes send the spec back to the planner", () => {
  const planner = go(
    at("awaiting_answer", { awaitingRole: "planner", questionsAnswered: 1 }),
    answer("planner_questions", { kind: "answers", text: "Q1: A", count: 2 }),
  );
  assert.deepEqual([planner.run.stage, planner.run.questionsAnswered], ["planning", 3]);
  assert.equal(planner.run.awaitingRole, null);
  assert.equal(spawnOf(planner).resume, true);
  assert.match(spawnOf(planner).context.message, /ANSWERS:\nQ1: A/);
  const executor = go(
    at("awaiting_answer", { awaitingRole: "executor", iteration: 2 }),
    answer("executor_questions", { kind: "answers", text: "Q1: B", count: 1 }),
  );
  assert.deepEqual(
    [executor.run.stage, spawnOf(executor).role, spawnOf(executor).iteration],
    ["executing", "executor", 2],
  );
  const changes = go(
    at("awaiting_approval"),
    answer("spec_approval", { kind: "changes", text: "split it" }),
  );
  assert.equal(changes.run.stage, "planning");
  assert.match(spawnOf(changes).context.message, /CHANGES REQUESTED:\nsplit it/);
});

test("an approval can override the tier, and the override is recorded", () => {
  const d = go(
    at("awaiting_approval"),
    answer("spec_approval", { kind: "approve", tier: "light" }),
  );
  assert.equal(d.run.tier, "light");
  assert.equal(d.run.stage, "executing");
  assert.match(d.run.tierReasons.join(" "), /override: orchestrator/);
  const why = go(
    at("awaiting_approval", { tier: "light" }),
    answer("spec_approval", { kind: "approve", tier: "standard", reason: "touches billing" }),
  );
  assert.equal(why.run.stage, "test_authoring");
  assert.match(why.run.tierReasons.join(" "), /override: touches billing/);
});

test("assumptions accumulate without repeating themselves across revisions", () => {
  const spec = (assumptions) =>
    child(
      "planner",
      { status: "spec_ready", summary: "s", spec: { path: "specs/1-x.md" }, assumptions },
      "spec_ready",
    );
  const first = go(at("planning", { tier: null }), { ...spec(["a", "b"]), signals: light });
  assert.deepEqual(first.run.assumptions, ["a", "b"]);
  const second = go({ ...first.run, stage: "planning" }, { ...spec(["b", "c"]), signals: light });
  assert.deepEqual(second.run.assumptions, ["a", "b", "c"]);
});

test("spec ready without signals is a runtime fault, not a guess", () => {
  const ready = child(
    "planner",
    { status: "spec_ready", summary: "s", spec: { path: "specs/1-x.md" } },
    "spec_ready",
  );
  assert.throws(() => go(at("planning"), ready), /signals/);
});

test("executor questions and disputes are put to the orchestrator", () => {
  const d = go(
    at("executing", { iteration: 1 }),
    child(
      "executor",
      { status: "needs_input", summary: "s", questions: [question] },
      "needs_input",
    ),
  );
  assert.deepEqual([d.run.stage, d.run.awaitingRole], ["awaiting_answer", "executor"]);
  assert.equal(judgmentOf(d), "executor_questions");
});

test("verifier findings: unverifiable criteria are kept as minor notes; unmet ones reach the executor", () => {
  const unverifiable = go(
    at("verifying", { iteration: 1 }),
    child(
      "verifier",
      verdict(
        "PASS",
        [],
        [
          { id: "AC1", result: "met", evidence: "t" },
          { id: "AC2", result: "unverifiable", evidence: "no env" },
        ],
      ),
    ),
  );
  assert.equal(unverifiable.run.stage, "ci_wait");
  assert.equal(unverifiable.run.minorFindings.length, 1);
  assert.match(unverifiable.run.minorFindings[0].claim, /AC2/);
  const unmet = go(
    at("verifying", { iteration: 1 }),
    child("verifier", verdict("PASS", [], [{ id: "AC1", result: "unmet", evidence: "e" }])),
  );
  assert.match(spawnOf(unmet).context.findings, /criterion AC1 unmet/);
  assert.equal(unmet.run.previousFindings.length, 1);
});

test("a verifier FAIL with a blocker rejects it; a blocker mixed with a sealed-test fault is not blamed on the tests", () => {
  const mixed = go(
    at("verifying", { sealed: [sealedTest()], iteration: 1 }),
    child(
      "verifier",
      verdict("FAIL", [
        finding({ category: "test-quality", file: "src/a.test.ts" }),
        finding({ id: "F2", file: "src/b.ts" }),
      ]),
    ),
  );
  assert.equal(mixed.run.stage, "executing");
  assert.equal(spawnOf(mixed).role, "executor");
});

test("CI: red names the failing jobs, pending polls again, closed halts", () => {
  const red = go(at("ci_wait", { iteration: 1 }), {
    kind: "ci",
    state: "red",
    failing: ["build", "lint"],
  });
  assert.equal(red.run.stage, "executing");
  assert.match(spawnOf(red).context.findings, /CI job build failed/);
  assert.match(spawnOf(red).context.findings, /CI job lint failed/);
  assert.deepEqual(
    red.run.rejections.map((r) => r.source),
    ["ci"],
  );
  const pending = go(at("ci_wait"), { kind: "ci", state: "pending", failing: [] });
  assert.deepEqual(works(pending), ["ci"]);
  const closed = go(at("ci_wait"), { kind: "ci", state: "closed", failing: [] });
  assert.equal(judgmentOf(closed), "halt");
  assert.equal(closed.run.haltRole, null);
});

test("no_ci answers: wait polls again, proceed starts the retro, cancel halts", () => {
  const ask = at("ci_wait");
  assert.deepEqual(works(go(ask, answer("no_ci", { kind: "wait" }))), ["ci"]);
  assert.equal(go(ask, answer("no_ci", { kind: "proceed" })).run.stage, "retro");
  const cancelled = go(ask, answer("no_ci", { kind: "cancel", reason: "no CI here" }));
  assert.deepEqual([cancelled.run.stage, cancelled.run.haltReason], ["retro", "no CI here"]);
  assert.throws(() => go(ask, answer("no_ci", { kind: "retry" })), /no_ci/);
});

test("finalize closes a halted run without waiting for CI", () => {
  const halted = at("finalizing", { haltReason: "user cancelled" });
  const d = go(halted, { kind: "finalized" });
  assert.equal(d.run.stage, "done");
  assert.deepEqual(works(d), []);
});

test("CI that is not green after finalize halts; a retry polls it again", () => {
  const finalized = at("finalizing", { finalized: true });
  const red = go(finalized, { kind: "ci", state: "red", failing: ["build"] });
  assert.equal(judgmentOf(red), "halt");
  const retried = go(red.run, answer("halt", { kind: "retry" }));
  assert.deepEqual(works(retried), ["ci"]);
  assert.deepEqual(works(go(finalized, { kind: "ci", state: "pending", failing: [] })), ["ci"]);
});

test("cancelling a halt after finalize closes the run; the retro is not run twice", () => {
  const red = go(at("finalizing", { finalized: true }), {
    kind: "ci",
    state: "red",
    failing: ["b"],
  });
  const d = go(red.run, answer("halt", { kind: "cancel", reason: "stop" }));
  assert.deepEqual([d.run.stage, d.run.haltReason], ["done", "stop"]);
  assert.equal(spawnOf(d), undefined);
});

test("cancelling a halt during the retro skips the retro instead of starting another", () => {
  const stalled = go(
    go(at("ci_wait"), { kind: "ci", state: "green", failing: [] }).run,
    child("retro", null, "stalled"),
  );
  assert.equal(judgmentOf(stalled), "halt");
  const d = go(stalled.run, answer("halt", { kind: "cancel", reason: "stop" }));
  assert.deepEqual([d.run.stage, d.run.haltReason], ["finalizing", "stop"]);
  assert.deepEqual(d.actions, [{ kind: "work", work: "finalize", data: { retro: null } }]);
  assert.equal(go(d.run, { kind: "finalized" }).run.stage, "done");
});

test("a retry after a crash halt runs the same spawn again with a fresh retry budget", () => {
  const first = go(executingRun(), child("executor", null, "crashed"));
  const halted = go(first.run, child("executor", null, "crashed"));
  assert.equal(halted.run.haltReason, null);
  const retried = go(halted.run, answer("halt", { kind: "retry" }));
  assert.deepEqual(spawnOf(retried), spawnOf(first));
  assert.deepEqual(
    [retried.run.retries, retried.run.haltRole, retried.run.stage],
    [{}, null, "executing"],
  );
});

test("a retry after a rejection halt re-enters executing with the findings that were rejected", () => {
  const prev = [
    { iteration: 1, source: "gate", fingerprints: ["gate||"] },
    { iteration: 2, source: "verifier", fingerprints: ["x||"] },
  ];
  const halted = go(
    at("verifying", { rung: 2, iteration: 3, rejections: prev }),
    child("verifier", verdict("FAIL", [finding({ file: "src/b.ts", claim: "b is broken" })])),
  );
  assert.equal(halted.run.haltRole, "executor");
  assert.equal(halted.run.stage, "verifying");
  const retried = go(halted.run, answer("halt", { kind: "retry" }));
  assert.equal(retried.run.stage, "executing");
  assert.equal(retried.run.haltRole, null);
  assert.deepEqual([spawnOf(retried).role, spawnOf(retried).iteration], ["executor", 4]);
  assert.match(spawnOf(retried).context.findings, /b is broken/);
  assert.deepEqual(spawnOf(retried).assignment, { model: "opus", effort: "xhigh" });
  assert.equal(retried.run.rung, 2);
  const again = go(retried.run, child("executor", executorDone()));
  assert.equal(again.run.stage, "gating");
});

test("a retry after the escalation ladder ran out does not ask the ladder for a rung it refuses", () => {
  const halted = go(
    at("ci_wait", {
      rung: 3,
      iteration: 4,
      rejections: [{ iteration: 3, source: "ci", fingerprints: ["x||"] }],
    }),
    { kind: "ci", state: "red", failing: ["build"] },
  );
  assert.equal(judgmentOf(halted), "halt");
  const retried = go(halted.run, answer("halt", { kind: "retry" }));
  assert.equal(retried.run.stage, "executing");
  assert.equal(retried.run.rung, 2);
  assert.equal(spawnOf(retried).role, "executor");
});

test("a retry after a test-author cap halt reopens test authoring with the feedback that caused it", () => {
  const fault = child(
    "verifier",
    verdict("FAIL", [
      finding({ category: "test-quality", file: "src/a.test.ts", claim: "asserts nothing" }),
    ]),
  );
  const halted = go(at("verifying", { sealed: [sealedTest()], testAuthorAttempts: 1 }), fault);
  const retried = go(halted.run, answer("halt", { kind: "retry" }));
  assert.equal(retried.run.stage, "test_authoring");
  assert.equal(spawnOf(retried).role, "test-author");
  assert.match(spawnOf(retried).context.feedback, /asserts nothing/);
  const sealHalt = go(at("test_authoring", { testAuthorAttempts: 1 }), {
    kind: "seal",
    ok: false,
    reasons: ["passes before implementation"],
    sealed: [],
  });
  const sealRetry = go(sealHalt.run, answer("halt", { kind: "retry" }));
  assert.equal(sealRetry.run.stage, "test_authoring");
  assert.match(spawnOf(sealRetry).context.feedback, /passes before implementation/);
  const revised = go(
    at("awaiting_answer", { awaitingRole: "executor", testAuthorAttempts: 1 }),
    answer("executor_questions", { kind: "revise_tests", text: "fix AC1" }),
  );
  const revisedRetry = go(revised.run, answer("halt", { kind: "retry" }));
  assert.deepEqual(
    [revisedRetry.run.stage, revisedRetry.run.awaitingRole],
    ["test_authoring", null],
  );
  assert.match(spawnOf(revisedRetry).context.feedback, /fix AC1/);
});

test("a retry with nothing to retry is a runtime fault", () => {
  assert.throws(() => go(at("executing"), answer("halt", { kind: "retry" })), /nothing to retry/);
  assert.throws(
    () => go(at("executing", { haltRole: "executor" }), answer("halt", { kind: "retry" })),
    /no previous spawn/,
  );
});

test("cancelling a halt runs the retro and records the reason", () => {
  const halted = go(executingRun(), child("executor", null, "limited"));
  const d = go(halted.run, answer("halt", { kind: "cancel", reason: "stop here" }));
  assert.deepEqual(
    [d.run.stage, d.run.haltReason, spawnOf(d).role],
    ["retro", "stop here", "retro"],
  );
});

test("running off the end of the escalation ladder asks the halt judgment instead of crashing", () => {
  const broken = {
    ...rubric,
    escalation: ["halt", "effort+1"],
    caps: { ...rubric.caps, rejections: 9 },
  };
  const d = go(
    at("verifying", { rung: 1, iteration: 2 }),
    child("verifier", verdict("FAIL", [finding()])),
    broken,
  );
  assert.equal(judgmentOf(d), "halt");
  assert.match(payloadOf(d).reason, /ladder is exhausted/);
  assert.equal(d.run.haltRole, "executor");
});

test("a refused model is a fault that throws, not a halt the orchestrator could retry", () => {
  const refused = {
    ...rubric,
    assignments: {
      ...rubric.assignments,
      light: { ...rubric.assignments.light, executor: "fable/high" },
    },
  };
  assert.throws(() => approve(at("awaiting_approval", { tier: "light" }), refused), /fable|model/i);
});

test("decide never mutates the run or the observation it is given", () => {
  const sealed = [sealedTest()];
  const frozen = (run, obs, r = rubric) => decide(deepFreeze(run), deepFreeze(obs), r, NOW);
  frozen(at("intake", { tier: null }), { kind: "start" });
  frozen(at("awaiting_approval"), answer("spec_approval", { kind: "approve" }));
  frozen(at("test_authoring", { sealed }), {
    kind: "seal",
    ok: true,
    reasons: [],
    sealed: [sealedTest("src/b.test.ts")],
  });
  frozen(
    at("verifying", { sealed, iteration: 1 }),
    child(
      "verifier",
      verdict("FAIL", [finding({ category: "test-quality", file: "src/a.test.ts" })]),
    ),
  );
  frozen(at("verifying", { iteration: 1 }), child("verifier", verdict("FAIL", [finding()])));
  frozen(executingRun(), child("executor", null, "crashed"));
  frozen(at("gating", { iteration: 1 }), { kind: "gate", report: report(true), findings: [] });
  frozen(at("ci_wait", { iteration: 1 }), { kind: "ci", state: "conflict", failing: [] });
});

test("the output schemas are exported for the prompt schemas to agree with", () => {
  for (const name of [
    "PlannerOutput",
    "TestAuthorOutput",
    "ExecutorOutput",
    "VerifierOutput",
    "RetroOutput",
  ]) {
    assert.equal(typeof engine[name]?.safeParse, "function", name);
  }
  assert.deepEqual(Object.keys(engine.ChildOutputSchemas).sort(), [
    "executor",
    "planner",
    "retro",
    "test-author",
    "verifier",
  ]);
  assert.ok(
    engine.PlannerOutput.safeParse({
      status: "spec_ready",
      summary: "s",
      spec: { path: "specs/a.md" },
    }).success,
  );
  assert.ok(
    !engine.PlannerOutput.safeParse({
      status: "spec_ready",
      summary: "s",
      spec: { path: "/etc/a.md" },
    }).success,
  );
  assert.ok(
    !engine.PlannerOutput.safeParse({
      status: "spec_ready",
      summary: "s",
      spec: { path: "specs/a.txt" },
    }).success,
  );
  assert.ok(engine.ExecutorOutput.safeParse({ status: "done", pr_url: PR }).success);
  assert.ok(!engine.ExecutorOutput.safeParse({ status: "done", pr_url: `${PR}/files` }).success);
  assert.ok(
    !engine.ExecutorOutput.safeParse({ status: "done", pr_url: "http://github.com/o/r/pull/1" })
      .success,
  );
});

test("findingsText lists each finding with its location and evidence", () => {
  assert.equal(engine.findingsText([]), "(none)");
  const text = engine.findingsText([finding({ line: 7 })]);
  assert.match(text, /\[F1\] major\/criterion src\/a\.ts:7: c — expected: x/);
  assert.match(text, /evidence: e/);
});

const gateObs = (passed, findings) => ({ kind: "gate", report: report(passed), findings });

test("a passed gate report that still carries a blocking finding is a rejection with that finding", () => {
  for (const severity of ["major", "blocker"]) {
    const blocking = finding({ id: "G1", severity, category: "scope", claim: "undeclared file" });
    const d = go(at("gating", { iteration: 1 }), gateObs(true, [blocking]));
    assert.equal(d.run.stage, "executing", severity);
    assert.deepEqual([spawnOf(d).role, spawnOf(d).iteration], ["executor", 2]);
    assert.match(spawnOf(d).context.findings, /undeclared file/);
    assert.deepEqual(d.run.previousFindings, [blocking]);
    assert.deepEqual(d.run.rejections, [
      { iteration: 1, source: "gate", fingerprints: ["scope|src/a.ts|AC1"] },
    ]);
    assert.deepEqual(d.run.minorFindings, []);
    assert.deepEqual(works(d), []);
  }
});

test("a passed gate report with a blocking and a minor finding rejects on the blocking one only", () => {
  const blocking = finding({ id: "G1", claim: "undeclared file" });
  const minor = finding({ id: "G2", severity: "minor", claim: "flaky lint" });
  const d = go(at("gating", { iteration: 1 }), gateObs(true, [minor, blocking]));
  assert.equal(d.run.stage, "executing");
  assert.deepEqual(d.run.previousFindings, [blocking]);
  assert.doesNotMatch(spawnOf(d).context.findings, /flaky lint/);
});

test("a passed gate report with only minor findings goes to the verifier and keeps them as notes", () => {
  const minor = finding({ id: "G2", severity: "minor", claim: "flaky lint" });
  const d = go(at("gating", { iteration: 1 }), gateObs(true, [minor]));
  assert.equal(d.run.stage, "verifying");
  assert.deepEqual(d.run.minorFindings, [minor]);
});

test("a failed gate report without a blocking finding is a rejection with one synthesized blocker", () => {
  const minor = finding({ id: "G2", severity: "minor", claim: "flaky lint" });
  for (const findings of [[], [minor]]) {
    const d = go(at("gating", { iteration: 1 }), gateObs(false, findings));
    assert.equal(d.run.stage, "executing");
    assert.equal(spawnOf(d).role, "executor");
    assert.equal(d.run.previousFindings.length, 1);
    assert.deepEqual(
      [d.run.previousFindings[0].severity, d.run.previousFindings[0].category],
      ["blocker", "gate"],
    );
    assert.equal(d.run.previousFindings[0].claim, "gate failed without a blocking finding");
    assert.match(spawnOf(d).context.findings, /gate failed without a blocking finding/);
    assert.deepEqual(d.run.rejections[0].fingerprints, ["gate||unspecified-gate"]);
  }
});

test("only a report that is exactly passed:true can pass the gate", () => {
  for (const passed of [undefined, null, "true", 1]) {
    const d = go(at("gating", { iteration: 1 }), gateObs(passed, []));
    assert.equal(d.run.stage, "executing", String(passed));
    assert.equal(d.run.previousFindings[0].claim, "gate failed without a blocking finding");
  }
});

test("a verifier PASS verdict with a blocking finding is a rejection, whatever the verdict says", () => {
  for (const severity of ["major", "blocker"]) {
    const blocking = finding({ severity, claim: "regression in b", file: "src/b.ts" });
    const d = go(at("verifying", { iteration: 1 }), child("verifier", verdict("PASS", [blocking])));
    assert.equal(d.run.stage, "executing", severity);
    assert.match(spawnOf(d).context.findings, /regression in b/);
  }
  const unmet = go(
    at("verifying", { iteration: 1 }),
    child("verifier", verdict("PASS", [], [{ id: "AC1", result: "unmet", evidence: "e" }])),
  );
  assert.equal(unmet.run.stage, "executing");
  assert.match(unmet.run.previousFindings[0].claim, /criterion AC1 unmet/);
});

test("a CI state and the jobs it names must agree: red without a job is still a rejection, green with failing jobs is not green", () => {
  const unnamed = go(at("ci_wait", { iteration: 1 }), { kind: "ci", state: "red", failing: [] });
  assert.equal(unnamed.run.stage, "executing");
  assert.equal(unnamed.run.previousFindings.length, 1);
  assert.equal(unnamed.run.previousFindings[0].claim, "CI failed without a named failing job");
  const disagreeing = go(at("ci_wait", { iteration: 1 }), {
    kind: "ci",
    state: "green",
    failing: ["build"],
  });
  assert.equal(disagreeing.run.stage, "executing");
  assert.match(spawnOf(disagreeing).context.findings, /CI job build failed/);
  const finalized = at("finalizing", { finalized: true });
  const stopped = go(finalized, { kind: "ci", state: "green", failing: ["build"] });
  assert.equal(judgmentOf(stopped), "halt");
  assert.equal(stopped.run.stage, "finalizing");
});

test("a seal result and its reasons must agree: success with reasons or with nothing sealed is a failure", () => {
  const withReasons = go(at("test_authoring"), {
    kind: "seal",
    ok: true,
    reasons: ["passes before implementation"],
    sealed: [sealedTest()],
  });
  assert.equal(withReasons.run.stage, "test_authoring");
  assert.deepEqual(withReasons.run.sealed, []);
  assert.match(spawnOf(withReasons).context.feedback, /passes before implementation/);
  const nothing = go(at("test_authoring"), { kind: "seal", ok: true, reasons: [], sealed: [] });
  assert.equal(nothing.run.stage, "test_authoring");
  assert.match(spawnOf(nothing).context.feedback, /sealed no tests/);
  const unexplained = go(at("test_authoring"), {
    kind: "seal",
    ok: false,
    reasons: [],
    sealed: [],
  });
  assert.equal(spawnOf(unexplained).context.feedback, "seal failed without a reason");
});

const askQuestion = (questions = [question]) =>
  child("planner", { status: "needs_input", summary: "s", questions }, "needs_input");
const answerPlanner = (count = 1) =>
  answer("planner_questions", { kind: "answers", text: "Q1: A", count });

test("fix 1: past the question cap the planner is accepted once, then halted; it cannot loop", () => {
  let run = planningRun();
  for (let round = 0; round < 8; round += 1) {
    const asked = go(run, askQuestion());
    assert.equal(judgmentOf(asked), "planner_questions", `round ${round}`);
    run = go(asked.run, answerPlanner()).run;
  }
  assert.equal(run.questionsAnswered, 8);
  const accepted = go(run, askQuestion([{ ...question, id: "Q9" }]));
  assert.equal(judgmentOf(accepted), undefined);
  assert.deepEqual([spawnOf(accepted).role, spawnOf(accepted).resume], ["planner", true]);
  assert.equal(accepted.run.questionsAnswered, 9);
  const again = go(accepted.run, askQuestion([{ ...question, id: "Q10" }]));
  assert.equal(judgmentOf(again), "halt");
  assert.equal(again.run.haltRole, "planner");
  assert.equal(again.run.stage, "planning");
  assert.match(payloadOf(again).reason, /planner kept asking past the question cap/);
  assert.equal(spawnOf(again), undefined);
  assert.equal(again.run.assumptions.length, 1);
});

test("fix 1: a round that jumps over the cap counts every accepted question, so the next ask halts", () => {
  const four = ["Q1", "Q2", "Q3", "Q4"].map((id) => ({ ...question, id }));
  const accepted = go({ ...planningRun(), questionsAnswered: 6 }, askQuestion(four));
  assert.equal(accepted.run.questionsAnswered, 10);
  assert.equal(judgmentOf(go(accepted.run, askQuestion())), "halt");
});

test("fix 1: an orchestrator that retries the planner halt gets the same resumed spawn, and is asked again only by a halt", () => {
  const accepted = go({ ...planningRun(), questionsAnswered: 8 }, askQuestion());
  const halted = go(accepted.run, askQuestion());
  const retried = go(halted.run, answer("halt", { kind: "retry" }));
  assert.deepEqual(spawnOf(retried), spawnOf(accepted));
  assert.equal(judgmentOf(go(retried.run, askQuestion())), "halt");
});

test("fix 4: a crashed, malformed or limited result in a stage that does not own its role throws", () => {
  const foreign = [
    [at("ci_wait", { iteration: 1 }), "executor"],
    [at("gating", { iteration: 1 }), "verifier"],
    [at("executing", { iteration: 1 }), "planner"],
    [at("verifying", { iteration: 1 }), "retro"],
  ];
  for (const [run, role] of foreign) {
    for (const outcome of ["crashed", "failed", "limited", "stalled"]) {
      assert.throws(
        () => go(run, child(role, null, outcome)),
        new RegExp(`no rule for stage ${run.stage} and ${role} result`),
        `${role} ${outcome} in ${run.stage}`,
      );
    }
    assert.throws(
      () => go(run, child(role, { status: "done", nonsense: true })),
      new RegExp(`no rule for stage ${run.stage} and ${role} result`),
    );
  }
  assert.throws(
    () => go(at("ci_wait"), child("executor", { status: "done", pr_url: "https://example.com/x" })),
    /no rule for stage ci_wait and executor result/,
  );
});

test("fix 4: a foreign-stage fault leaves no retry or halt behind; the control in its own stage still retries", () => {
  const run = at("ci_wait", { iteration: 1 });
  assert.throws(() => go(run, child("executor", null, "crashed")), /no rule/);
  assert.deepEqual(run.retries, {});
  const own = go(executingRun(), child("executor", null, "crashed"));
  assert.equal(spawnOf(own).role, "executor");
});

test("fix 4: a leak or a tree mutation still halts in any stage", () => {
  const leaked = go(at("ci_wait", { iteration: 1 }), {
    ...child("executor", null, "crashed"),
    leaked: ["?? spike.txt"],
  });
  assert.equal(judgmentOf(leaked), "halt");
  assert.equal(leaked.run.haltRole, "executor");
  const mutated = go(at("gating", { iteration: 1 }), {
    ...child("verifier", verdict("PASS")),
    mutated: ["?? x.txt"],
  });
  assert.equal(judgmentOf(mutated), "halt");
});

test("fix 4: a halt cancel at ready or done throws; at finalizing it still closes the run", () => {
  const cancel = answer("halt", { kind: "cancel", reason: "stop" });
  for (const stage of ["ready", "done", "halted"]) {
    assert.throws(() => go(at(stage), cancel), new RegExp(`no rule for stage ${stage}`), stage);
  }
  const closed = go(at("finalizing", { finalized: true }), cancel);
  assert.deepEqual([closed.run.stage, closed.run.haltReason], ["done", "stop"]);
});

test("fix 10: a halt retry resets the budget of the halted role only", () => {
  const spent = { ...executingRun(), retries: { verifier: 1, planner: 1 } };
  const first = go(spent, child("executor", null, "crashed"));
  const halted = go(first.run, child("executor", null, "crashed"));
  assert.deepEqual(halted.run.retries, { verifier: 1, planner: 1, executor: 1 });
  const retried = go(halted.run, answer("halt", { kind: "retry" }));
  assert.deepEqual(retried.run.retries, { verifier: 1, planner: 1 });
  const ci = go(at("finalizing", { finalized: true, retries: { executor: 1 } }), {
    kind: "ci",
    state: "red",
    failing: ["b"],
  });
  const polled = go(ci.run, answer("halt", { kind: "retry" }));
  assert.deepEqual(polled.run.retries, { executor: 1 });
});

const MINUTE = 60_000;
const goAt = (run, obs, when, r = rubric) => decide(run, obs, r, when);
const pendingCi = { kind: "ci", state: "pending", failing: [] };
const ciRun = () => go(verifyingRun(), child("verifier", verdict("PASS"))).run;

test("fix 2: the CI wait starts its clock when it is entered and stops it when it is left", () => {
  const entered = go(verifyingRun(), child("verifier", verdict("PASS")));
  assert.equal(entered.run.stage, "ci_wait");
  assert.equal(entered.run.ciSince, NOW.toISOString());
  assert.deepEqual(works(entered), ["ci"]);
  assert.equal(go(entered.run, { kind: "ci", state: "green", failing: [] }).run.ciSince, null);
  assert.equal(go(entered.run, { kind: "ci", state: "red", failing: ["b"] }).run.ciSince, null);
  assert.equal(go(entered.run, { kind: "ci", state: "conflict", failing: [] }).run.ciSince, null);
  const cancelled = go(entered.run, answer("no_ci", { kind: "cancel", reason: "stop" }));
  assert.equal(cancelled.run.ciSince, null);
});

test("fix 2: 5000 pending polls inside the deadline raise nothing; the first one past it asks no_ci", () => {
  let run = ciRun();
  const since = run.ciSince;
  for (let i = 0; i < 5000; i += 1) {
    const d = goAt(run, pendingCi, new Date(NOW.getTime() + i * 700));
    assert.deepEqual(works(d), ["ci"], `poll ${i}`);
    assert.equal(judgmentOf(d), undefined, `poll ${i}`);
    run = d.run;
  }
  assert.equal(run.ciSince, since);
  assert.equal(run.stage, "ci_wait");
  const edge = goAt(run, pendingCi, new Date(NOW.getTime() + 60 * MINUTE));
  assert.equal(judgmentOf(edge), undefined);
  const late = goAt(run, pendingCi, new Date(NOW.getTime() + 61 * MINUTE));
  assert.equal(judgmentOf(late), "no_ci");
  assert.equal(payloadOf(late).reason, "CI still pending after 61 min");
  assert.deepEqual(works(late), []);
  assert.equal(late.run.stage, "ci_wait");
});

test("fix 2: the wait answer restarts the clock, proceed starts the retro, cancel halts", () => {
  const run = ciRun();
  const later = new Date(NOW.getTime() + 61 * MINUTE);
  const asked = goAt(run, pendingCi, later);
  const waited = goAt(asked.run, answer("no_ci", { kind: "wait" }), later);
  assert.equal(waited.run.ciSince, later.toISOString());
  assert.deepEqual(works(waited), ["ci"]);
  const soon = new Date(later.getTime() + 5 * MINUTE);
  assert.equal(judgmentOf(goAt(waited.run, pendingCi, soon)), undefined);
  const again = new Date(later.getTime() + 61 * MINUTE);
  assert.equal(judgmentOf(goAt(waited.run, pendingCi, again)), "no_ci");
  assert.equal(go(asked.run, answer("no_ci", { kind: "proceed" })).run.stage, "retro");
  assert.equal(go(asked.run, answer("no_ci", { kind: "cancel", reason: "x" })).run.stage, "retro");
});

test("fix 2: the deadline is the rubric's, and a run with no recorded start begins its clock on the first poll", () => {
  const short = loadRubric(DEFAULT, "caps: { ci_wait_minutes: 10 }\n");
  const run = ciRun();
  assert.equal(
    judgmentOf(goAt(run, pendingCi, new Date(NOW.getTime() + 9 * MINUTE), short)),
    undefined,
  );
  assert.equal(
    judgmentOf(goAt(run, pendingCi, new Date(NOW.getTime() + 11 * MINUTE), short)),
    "no_ci",
  );
  const unstarted = go(at("ci_wait"), pendingCi);
  assert.equal(unstarted.run.ciSince, NOW.toISOString());
  assert.deepEqual(works(unstarted), ["ci"]);
  const garbled = go(at("ci_wait", { ciSince: "not a date" }), pendingCi);
  assert.equal(garbled.run.ciSince, NOW.toISOString());
  const future = goAt(
    at("ci_wait", { ciSince: new Date(NOW.getTime() + 5 * MINUTE).toISOString() }),
    pendingCi,
    NOW,
  );
  assert.equal(judgmentOf(future), undefined);
});

test("fix 2: the wait after finalize has the same deadline, and its answers close or release the run", () => {
  const started = go(at("finalizing"), { kind: "finalized" });
  assert.equal(started.run.ciSince, NOW.toISOString());
  const inside = goAt(started.run, pendingCi, new Date(NOW.getTime() + 59 * MINUTE));
  assert.deepEqual(works(inside), ["ci"]);
  const late = new Date(NOW.getTime() + 61 * MINUTE);
  const asked = goAt(started.run, pendingCi, late);
  assert.equal(judgmentOf(asked), "no_ci");
  assert.match(payloadOf(asked).reason, /CI still pending after 61 min/);
  const waited = goAt(asked.run, answer("no_ci", { kind: "wait" }), late);
  assert.deepEqual([works(waited), waited.run.ciSince], [["ci"], late.toISOString()]);
  const proceeded = go(asked.run, answer("no_ci", { kind: "proceed" }));
  assert.deepEqual(
    [proceeded.run.stage, works(proceeded), proceeded.run.ciSince],
    ["done", [], null],
  );
  const cancelled = go(asked.run, answer("no_ci", { kind: "cancel", reason: "stop" }));
  assert.deepEqual(
    [cancelled.run.stage, cancelled.run.haltReason, cancelled.run.ciSince],
    ["done", "stop", null],
  );
  const ready = go(started.run, { kind: "ci", state: "green", failing: [] });
  assert.equal(ready.run.ciSince, null);
});

test("fix 2: a halt retry in a CI wait starts the clock again", () => {
  const closed = go(ciRun(), { kind: "ci", state: "closed", failing: [] });
  const later = new Date(NOW.getTime() + 90 * MINUTE);
  const retried = goAt(closed.run, answer("halt", { kind: "retry" }), later);
  assert.deepEqual([works(retried), retried.run.ciSince], [["ci"], later.toISOString()]);
});

const sealedAc = [
  sealedTest("src/a.test.ts", ["AC1", "AC2"]),
  sealedTest("src/b.test.ts", ["AC3"]),
];
const unverifiedRun = (extra = {}) => at("verifying", { iteration: 1, sealed: sealedAc, ...extra });
const hollowAll = verdict(
  "PASS",
  [],
  [
    { id: "AC1", result: "unverifiable", evidence: "no env" },
    { id: "AC2", result: "unverifiable", evidence: "no env" },
    { id: "AC3", result: "unverifiable", evidence: "no env" },
  ],
);
const coversAll = verdict(
  "PASS",
  [],
  [
    { id: "AC1", result: "met", evidence: "t" },
    { id: "AC2", result: "unverifiable", evidence: "no env" },
    { id: "AC3", result: "met", evidence: "t" },
  ],
);
const unverified = (a) => answer("unverified", a);

test("fix 3 (P4): a PASS whose every criterion is unverifiable does not reach CI; the orchestrator is asked", () => {
  const d = go(unverifiedRun(), child("verifier", hollowAll));
  assert.equal(judgmentOf(d), "unverified");
  assert.equal(d.run.stage, "verifying");
  assert.deepEqual(works(d), []);
  assert.deepEqual(payloadOf(d), { criteria: hollowAll.criteria, missing: [] });
  assert.equal(d.run.minorFindings.length, 3);
  const noSealed = go(
    at("verifying", { iteration: 1 }),
    child("verifier", verdict("PASS", [], [{ id: "AC1", result: "unverifiable", evidence: "x" }])),
  );
  assert.equal(judgmentOf(noSealed), "unverified");
});

test("fix 3 (P4b): a PASS that omits a sealed criterion does not reach CI, even if it names a met one", () => {
  const unknownOnly = verdict("PASS", [], [{ id: "ZZ9", result: "met", evidence: "t" }]);
  const d = go(unverifiedRun(), child("verifier", unknownOnly));
  assert.equal(judgmentOf(d), "unverified");
  assert.deepEqual(payloadOf(d).missing, ["AC1", "AC2", "AC3"]);
  const partial = verdict("PASS", [], [{ id: "AC1", result: "met", evidence: "t" }]);
  const p = go(unverifiedRun(), child("verifier", partial));
  assert.equal(judgmentOf(p), "unverified");
  assert.deepEqual(payloadOf(p).missing, ["AC2", "AC3"]);
});

test("fix 3: the controls still pass - a met criterion that covers every sealed id goes to CI", () => {
  const d = go(unverifiedRun(), child("verifier", coversAll));
  assert.equal(d.run.stage, "ci_wait");
  assert.deepEqual(works(d), ["ci"]);
  const plain = go(at("verifying", { iteration: 1 }), child("verifier", verdict("PASS")));
  assert.equal(plain.run.stage, "ci_wait");
});

test("fix 3: a blocking finding still rejects a hollow PASS", () => {
  const d = go(
    unverifiedRun(),
    child("verifier", { ...hollowAll, findings: [finding({ claim: "regression in b" })] }),
  );
  assert.equal(d.run.stage, "executing");
  assert.equal(judgmentOf(d), undefined);
});

test("fix 3: proceed needs a reason, records it as an assumption, and goes to CI", () => {
  const asked = go(unverifiedRun(), child("verifier", hollowAll));
  for (const proceed of [
    { kind: "proceed" },
    { kind: "proceed", reason: "" },
    { kind: "proceed", reason: "   " },
  ]) {
    assert.throws(() => go(asked.run, unverified(proceed)), /reason/);
  }
  const d = go(asked.run, unverified({ kind: "proceed", reason: "no CI env for AC2" }));
  assert.equal(d.run.stage, "ci_wait");
  assert.deepEqual(works(d), ["ci"]);
  assert.equal(d.run.ciSince, NOW.toISOString());
  assert.deepEqual(d.run.assumptions, [
    "verification accepted without evidence: no CI env for AC2",
  ]);
});

test("fix 3: retry re-runs the verifier once; a second hollow PASS halts; cancel runs the retro", () => {
  const first = go(unverifiedRun(), child("verifier", hollowAll));
  const retried = go(first.run, unverified({ kind: "retry" }));
  assert.equal(retried.run.stage, "verifying");
  assert.deepEqual(works(retried), ["snapshot"]);
  assert.equal(spawnOf(retried).role, "verifier");
  assert.deepEqual(retried.run.lastSpawn.verifier, spawnOf(retried));
  const second = go(retried.run, child("verifier", hollowAll));
  assert.equal(judgmentOf(second), "halt");
  assert.equal(second.run.haltRole, "verifier");
  assert.equal(spawnOf(second), undefined);
  const recovered = go(retried.run, child("verifier", coversAll));
  assert.equal(recovered.run.stage, "ci_wait");
  const cancelled = go(first.run, unverified({ kind: "cancel", reason: "stop" }));
  assert.deepEqual([cancelled.run.stage, spawnOf(cancelled).role], ["retro", "retro"]);
});

test("fix 3: the unverified answers belong to the verifying stage and to retry, proceed or cancel only", () => {
  assert.throws(() => go(at("ci_wait"), unverified({ kind: "retry" })), /no rule/);
  assert.throws(() => go(unverifiedRun(), unverified({ kind: "wait" })), /no rule/);
  assert.throws(() => go(unverifiedRun(), unverified({ kind: "approve" })), /no rule/);
  assert.throws(() => go(unverifiedRun(), answer("no_ci", { kind: "proceed" })), /no rule/);
});

test("fix 3: a hollow PASS found by a real sequence from the gate to the judgment", () => {
  const gated = go(at("gating", { iteration: 1, sealed: sealedAc }), {
    kind: "gate",
    report: report(true),
    findings: [],
  });
  const asked = go(gated.run, child("verifier", hollowAll));
  assert.equal(judgmentOf(asked), "unverified");
  const accepted = go(asked.run, unverified({ kind: "proceed", reason: "env missing" }));
  assert.equal(accepted.run.stage, "ci_wait");
});

const scopeBlocker = { category: "scope", claim: "wrote outside", evidence: "e", expected: "x" };

test("fix 5 (P6): the gate rule derives findings from the report itself, so empty findings cannot hide a failure", () => {
  const lying = {
    ...report(true),
    protected: [".husky/pre-commit"],
    protectedPatterns: ["^\\.husky/"],
    undeclared: ["x.ts"],
    blockers: [scopeBlocker],
  };
  const d = go(at("gating", { iteration: 1 }), { kind: "gate", report: lying, findings: [] });
  assert.equal(d.run.stage, "executing");
  assert.deepEqual(works(d), []);
  const ids = d.run.previousFindings.map((f) => f.id).sort();
  assert.deepEqual(ids, ["B-1", "P-1", "S-1"]);
  assert.match(spawnOf(d).context.findings, /\.husky\/pre-commit is a protected path/);
});

test("fix 5: a finding the runtime already supplied is not counted twice, and derived minors are kept as notes", () => {
  const withProtected = { ...report(false), protected: ["a.ts"], protectedPatterns: ["a"] };
  const { reportFindings } = gateModule;
  const supplied = reportFindings(withProtected);
  const d = go(at("gating", { iteration: 1 }), {
    kind: "gate",
    report: withProtected,
    findings: supplied,
  });
  assert.equal(d.run.previousFindings.length, supplied.length);
  const flaky = { ...report(true), gates: [{ name: "lint", result: "flaky", ms: 1, tail: "t" }] };
  const passed = go(at("gating", { iteration: 1 }), { kind: "gate", report: flaky, findings: [] });
  assert.equal(passed.run.stage, "verifying");
  assert.deepEqual(
    passed.run.minorFindings.map((f) => f.id),
    ["G-lint-flaky"],
  );
});

test("fix 6: a planner spec_ready that also carries questions is malformed", () => {
  const both = child(
    "planner",
    {
      status: "spec_ready",
      summary: "s",
      spec: { path: "specs/1-x.md" },
      questions: [question],
    },
    "spec_ready",
  );
  retryThenHalt(planningRun(), { ...both, signals: light }, "planner", /planner.*questions/);
});

test("fix 6: an executor done that also carries questions or a dispute is malformed", () => {
  const withQuestions = child("executor", executorDone({ questions: [question] }));
  retryThenHalt(executingRun(), withQuestions, "executor", /executor.*questions/);
  const dispute = { path: "src/a.test.ts", reason: "r", evidence: "e" };
  const withDispute = child("executor", executorDone({ dispute }));
  retryThenHalt(executingRun(), withDispute, "executor", /executor.*dispute/);
});

const askExecutor = (extra = {}) =>
  child(
    "executor",
    { status: "needs_input", summary: "s", questions: [question], ...extra },
    "needs_input",
  );
const answerExecutor = () =>
  answer("executor_questions", { kind: "answers", text: "Q1: A", count: 1 });

test("fix 7: the executor may ask three times; the fourth round halts instead of asking again", () => {
  let run = executingRun();
  for (let round = 1; round <= 3; round += 1) {
    const asked = go(run, askExecutor());
    assert.equal(judgmentOf(asked), "executor_questions", `round ${round}`);
    assert.equal(asked.run.executorQuestionRounds, round);
    run = go(asked.run, answerExecutor()).run;
    assert.equal(run.stage, "executing");
    assert.equal(run.executorQuestionRounds, round);
  }
  const fourth = go(run, askExecutor());
  assert.equal(judgmentOf(fourth), "halt");
  assert.equal(fourth.run.haltRole, "executor");
  assert.equal(fourth.run.stage, "executing");
  assert.equal(fourth.run.executorQuestionRounds, 3);
  assert.match(payloadOf(fourth).reason, /executor asked more than 3 times/);
  assert.equal(spawnOf(fourth), undefined);
});

test("fix 7: a dispute is a round too, and the cap is the rubric's", () => {
  const dispute = { path: "src/a.test.ts", reason: "r", evidence: "e" };
  const disputed = child(
    "executor",
    { status: "needs_input", summary: "s", dispute },
    "needs_input",
  );
  const first = go(executingRun(), disputed);
  assert.equal(first.run.executorQuestionRounds, 1);
  assert.equal(judgmentOf(first), "executor_questions");
  const none = loadRubric(DEFAULT, "caps: { executor_questions: 0 }\n");
  assert.equal(judgmentOf(go(executingRun(), disputed, none)), "halt");
  const two = loadRubric(DEFAULT, "caps: { executor_questions: 2 }\n");
  const second = go(go(first.run, answerExecutor(), two).run, disputed, two);
  assert.equal(judgmentOf(second), "executor_questions");
  const third = go(go(second.run, answerExecutor(), two).run, disputed, two);
  assert.equal(judgmentOf(third), "halt");
});

test("fix 7: a halt retry after the cap re-spawns the executor and the rounds are not reset", () => {
  const run = { ...executingRun(), executorQuestionRounds: 3 };
  const halted = go(run, askExecutor());
  const retried = go(halted.run, answer("halt", { kind: "retry" }));
  assert.equal(spawnOf(retried).role, "executor");
  assert.equal(retried.run.executorQuestionRounds, 3);
  assert.equal(judgmentOf(go(retried.run, askExecutor())), "halt");
});

const authored = child("test-author", {
  status: "done",
  tests: [{ path: "src/a.test.ts", criteria: ["AC1"] }],
});
const sealOk = { kind: "seal", ok: true, reasons: [], sealed: [sealedTest()] };
const testFault = child(
  "verifier",
  verdict("FAIL", [
    finding({
      id: "T1",
      category: "test-quality",
      file: "src/a.test.ts",
      claim: "asserts nothing",
    }),
  ]),
);
const lintFailure = finding({
  id: "G-lint",
  severity: "blocker",
  category: "gate",
  file: undefined,
  criterion: undefined,
  claim: "lint fails",
});

test("fix 8 (P13): after a re-seal the executor gets the test fault, not the finding of an older rejection", () => {
  let d = go(at("gating", { iteration: 1, sealed: [sealedTest()] }), {
    kind: "gate",
    report: report(false),
    findings: [lintFailure],
  });
  assert.match(spawnOf(d).context.findings, /lint fails/);
  d = go(d.run, child("executor", executorDone()));
  d = go(d.run, { kind: "gate", report: report(true), findings: [] });
  assert.equal(d.run.stage, "verifying");
  d = go(d.run, testFault);
  assert.equal(d.run.stage, "test_authoring");
  d = go(d.run, authored);
  d = go(d.run, sealOk);
  assert.deepEqual(
    [d.run.stage, spawnOf(d).role, spawnOf(d).iteration],
    ["executing", "executor", 3],
  );
  assert.match(spawnOf(d).context.findings, /asserts nothing/);
  assert.doesNotMatch(spawnOf(d).context.findings, /lint fails/);
});

test("fix 8: a failed seal in between keeps the test fault that reopened authoring", () => {
  const roomy = loadRubric(DEFAULT, "caps: { test_author_attempts: 3 }\n");
  let d = go(at("verifying", { iteration: 2, sealed: [sealedTest()] }), testFault, roomy);
  d = go(d.run, authored, roomy);
  const failed = { kind: "seal", ok: false, reasons: ["passes before implementation"], sealed: [] };
  d = go(d.run, failed, roomy);
  assert.equal(spawnOf(d).role, "test-author");
  d = go(d.run, authored, roomy);
  d = go(d.run, sealOk, roomy);
  assert.match(spawnOf(d).context.findings, /asserts nothing/);
});

test("fix 8: the first seal hands the executor no findings, and revise_tests hands it the request", () => {
  let d = go(at("test_authoring"), sealOk);
  assert.equal(spawnOf(d).context.findings, "(none)");
  const asked = go(at("executing", { iteration: 1 }), {
    ...child(
      "executor",
      { status: "needs_input", summary: "s", questions: [question] },
      "needs_input",
    ),
  });
  d = go(
    asked.run,
    answer("executor_questions", { kind: "revise_tests", text: "AC1 expects a 404" }),
  );
  assert.equal(d.run.stage, "test_authoring");
  d = go(d.run, authored);
  d = go(d.run, sealOk);
  assert.match(spawnOf(d).context.findings, /AC1 expects a 404/);
});

const stepRubric = loadRubric(
  DEFAULT,
  "escalation: [effort+1, effort+1, 'model:opus', halt]\ncaps: { rejections: 5 }\n",
);
const ciRed = (...failing) => ({ kind: "ci", state: "red", failing });

test("fix 9 (P9): two different failing CI jobs are not a repeated finding; the same job twice is", () => {
  const first = go(at("ci_wait", { iteration: 1 }), ciRed("build"), stepRubric);
  assert.equal(first.run.rung, 1);
  const back = { ...first.run, stage: "ci_wait" };
  const other = go(back, ciRed("lint"), stepRubric);
  assert.equal(other.run.rung, 2);
  assert.notDeepEqual(other.run.rejections[0].fingerprints, other.run.rejections[1].fingerprints);
  const same = go(back, ciRed("build"), stepRubric);
  assert.equal(same.run.rung, 3);
  assert.match(spawnOf(other).context.findings, /CI job lint failed/);
});

test("fix 9: an unspecified gate failure followed by a CI conflict is not a repeated finding", () => {
  const first = go(
    at("gating", { iteration: 1 }),
    { kind: "gate", report: report(false), findings: [] },
    stepRubric,
  );
  assert.deepEqual(first.run.rejections[0].fingerprints, ["gate||unspecified-gate"]);
  const conflict = go(
    { ...first.run, stage: "ci_wait" },
    { kind: "ci", state: "conflict", failing: [] },
    stepRubric,
  );
  assert.equal(conflict.run.rung, 2);
  const unnamed = go({ ...first.run, stage: "ci_wait" }, ciRed(), stepRubric);
  assert.deepEqual(unnamed.run.rejections[1].fingerprints, ["gate||unspecified-ci"]);
  assert.equal(unnamed.run.rung, 2);
});

test("ruling: after finalize a no_ci proceed never marks the PR ready; it closes the run and leaves the draft", () => {
  const finalized = at("finalizing", { finalized: true });
  const asked = goAt(
    { ...finalized, ciSince: NOW.toISOString() },
    pendingCi,
    new Date(NOW.getTime() + 61 * MINUTE),
  );
  assert.equal(judgmentOf(asked), "no_ci");
  const proceeded = go(asked.run, answer("no_ci", { kind: "proceed" }));
  assert.deepEqual(
    [proceeded.run.stage, proceeded.run.haltReason, proceeded.run.ciSince],
    ["done", null, null],
  );
  assert.deepEqual(proceeded.actions, [
    { kind: "notify", text: "CI did not complete after finalize; PR left as draft" },
  ]);
  assert.ok(!proceeded.actions.some((a) => a.kind === "work"));
  const stateless = go(finalized, answer("no_ci", { kind: "proceed" }));
  assert.deepEqual([stateless.run.stage, works(stateless)], ["done", []]);
});

test("ruling: only a green CI result after finalize reaches ready; wait and cancel are as before", () => {
  const finalized = at("finalizing", { finalized: true, ciSince: NOW.toISOString() });
  const ready = go(finalized, { kind: "ci", state: "green", failing: [] });
  assert.deepEqual([ready.run.stage, works(ready)], ["ready", ["mark_ready"]]);
  const waited = go(finalized, answer("no_ci", { kind: "wait" }));
  assert.deepEqual(
    [waited.run.stage, works(waited), waited.run.ciSince],
    ["finalizing", ["ci"], NOW.toISOString()],
  );
  const cancelled = go(finalized, answer("no_ci", { kind: "cancel", reason: "stop" }));
  assert.deepEqual([cancelled.run.stage, cancelled.run.haltReason], ["done", "stop"]);
  for (const stage of ["ci_wait"]) {
    const before = go(at(stage), answer("no_ci", { kind: "proceed" }));
    assert.deepEqual(
      [before.run.stage, spawnOf(before)?.role, works(before)],
      ["retro", "retro", []],
    );
  }
});
