import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";

/**
 * F6b: "red for the right reason". Class names and marks are the factory's
 * (platform-agent-factory 7bdf2dee826b, `lib/oracle-run.ts`). Output samples are the
 * runners' own summary shapes; the factory reads reports, marvin reads this text.
 */
const { classifyOracleRun, isRedForRightReason } = await importTs("src/lib/oracle-classify.ts");
const { recordOracleRun, readOracleRuns, redGreenProof, redRejection } =
  await importTs("src/storage/oracles.ts");

const run = (code, output, over = {}) => classifyOracleRun({ code, signal: null, output, ...over });

const PYTEST_FAILED = `============ test session starts ============
collected 1 item
t.py F
FAILED t.py::test_x - assert 1 == 2
============ 1 failed in 0.03s ============`;
const PYTEST_COLLECT = `============ test session starts ============
collected 0 items / 1 error
ERROR collecting t.py
E   ModuleNotFoundError: No module named 'nope'
!!!!!! Interrupted: 1 error during collection !!!!!!
============ 1 error in 0.02s ============`;
const PYTEST_SETUP = `============ test session starts ============
collected 1 item
ERROR t.py::test_x - fixture 'db' not found
============ 1 error in 0.02s ============`;
const PYTEST_NONE = `============ test session starts ============
collected 0 items
============ no tests ran in 0.01s ============`;
const PYTEST_SKIP = `============ test session starts ============
collected 1 item
============ 1 skipped in 0.01s ============`;
const PYTEST_PASS = `============ test session starts ============
collected 1 item
============ 1 passed in 0.01s ============`;
const VITEST_FAILED = ` RUN  v2.0.0 /x
 FAIL  t.test.ts > adds
AssertionError: expected 1 to be 2
 Test Files  1 failed (1)
      Tests  1 failed (1)`;
const VITEST_LOAD = ` RUN  v2.0.0 /x
 FAIL  t.test.ts [ t.test.ts ]
Error: Failed to load url ./nope (resolved id: ./nope)
 Test Files  1 failed (1)
      Tests  no tests`;
const VITEST_NOFILES = ` RUN  v2.0.0 /x
No test files found, exiting with code 1`;
const VITEST_SKIP = ` Test Files  1 passed (1)
      Tests  1 skipped (1)`;
const VITEST_PASS = ` Test Files  1 passed (1)
      Tests  1 passed (1)`;

test("pytest: ran and failed is the only red", () => {
  const c = run(1, PYTEST_FAILED);
  assert.equal(c.outcome, "failed");
  assert.equal(c.runner, "pytest");
  assert.ok(isRedForRightReason(c));
});

for (const [name, out] of [
  ["a collection error", PYTEST_COLLECT],
  ["a setup error", PYTEST_SETUP],
  ["no tests ran", PYTEST_NONE],
  ["only skipped tests", PYTEST_SKIP],
]) {
  test(`pytest: ${name} did not run and is NOT a red`, () => {
    const c = run(name === "no tests ran" ? 5 : 1, out);
    assert.equal(c.outcome, "did_not_run");
    assert.equal(c.runner, "pytest");
    assert.equal(isRedForRightReason(c), false);
  });
}

test("pytest: a pass classifies passed", () => {
  assert.equal(run(0, PYTEST_PASS).outcome, "passed");
});

test("vitest: ran and failed is a red", () => {
  const c = run(1, VITEST_FAILED);
  assert.equal(c.outcome, "failed");
  assert.equal(c.runner, "vitest");
  assert.ok(isRedForRightReason(c));
});

for (const [name, out] of [
  ["a suite that failed to load (no test results)", VITEST_LOAD],
  ["no test files found", VITEST_NOFILES],
  ["a skipped-only run", VITEST_SKIP],
]) {
  test(`vitest: ${name} did not run and is NOT a red`, () => {
    const c = run(1, out);
    assert.equal(c.outcome, "did_not_run");
    assert.equal(c.runner, "vitest");
    assert.equal(isRedForRightReason(c), false);
  });
}

test("vitest: a pass classifies passed", () => {
  assert.equal(run(0, VITEST_PASS).outcome, "passed");
});

test("plain exit codes: non-zero with no detectable runner is unknown, never failed", () => {
  for (const out of ["", "boom\n", "exit\n"]) {
    const c = run(1, out);
    assert.equal(c.outcome, "unknown");
    assert.equal(c.runner, null);
    assert.equal(isRedForRightReason(c), false);
  }
  assert.equal(run(127, "sh: nope: command not found").outcome, "unknown");
  assert.equal(run(0, "ok").outcome, "passed");
});

test("runners the factory does not cover (jest, go) are unknown, never failed", () => {
  const jest = "Tests:       1 failed, 1 total\nTest Suites: 1 failed, 1 total";
  const go = "--- FAIL: TestX (0.00s)\nFAIL\texample.com/x\t0.003s";
  for (const out of [jest, go]) assert.equal(run(1, out).outcome, "unknown");
});

// `node --test` output as Node 24 (spec reporter) and Node 22 (TAP, no TTY) print it, trimmed.
const nodeSummary = (mark, fail, pass = 0, skipped = 0) =>
  [
    `${mark} tests 1`,
    `${mark} pass ${pass}`,
    `${mark} fail ${fail}`,
    `${mark} cancelled 0`,
    `${mark} skipped ${skipped}`,
  ].join("\n");
const NODE_BODY_SPEC = `✖ x (0.25ms)\n${nodeSummary("ℹ", 1)}\n\n✖ failing tests:\n\ntest at body.test.mjs:2:1\n✖ x (0.25ms)\n  TypeError: m.clamp is not a function`;
const NODE_BODY_TAP = `TAP version 13\nnot ok 1 - x\n  ---\n  failureType: 'testCodeFailure'\n  error: 'm.clamp is not a function'\n  code: 'ERR_TEST_FAILURE'\n  name: 'TypeError'\n  ...\n1..1\n${nodeSummary("#", 1)}`;
const NODE_IMPORT_SPEC = `Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'nope.mjs'\n✖ imp.test.mjs (27ms)\n${nodeSummary("ℹ", 1)}\n\n✖ failing tests:\n\ntest at imp.test.mjs:1:1\n✖ imp.test.mjs (27ms)\n  'test failed'`;
const NODE_IMPORT_TAP = `TAP version 13\n# Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'nope.mjs'\nnot ok 1 - imp.test.mjs\n  ---\n  failureType: 'testCodeFailure'\n  exitCode: 1\n  signal: ~\n  error: 'test failed'\n  code: 'ERR_TEST_FAILURE'\n  ...\n1..1\n${nodeSummary("#", 1)}`;

test("node --test: a failure inside a test body is a red, in the spec and the TAP reporter", () => {
  for (const out of [NODE_BODY_SPEC, NODE_BODY_TAP]) {
    const c = run(1, out);
    assert.equal(c.outcome, "failed");
    assert.equal(c.runner, "node");
    assert.ok(isRedForRightReason(c));
  }
});

test("node --test: a file that did not load or threw at top level did not run", () => {
  for (const out of [NODE_IMPORT_SPEC, NODE_IMPORT_TAP]) {
    const c = run(1, out);
    assert.equal(c.outcome, "did_not_run", out);
    assert.equal(isRedForRightReason(c), false);
  }
});

test("node --test: a pass is passed, and skipped-only did not run", () => {
  assert.equal(run(0, nodeSummary("ℹ", 0, 1)).outcome, "passed");
  assert.equal(run(0, nodeSummary("#", 0, 0, 1)).outcome, "did_not_run");
});

test("a crash, a kill or a launch failure did not run", () => {
  assert.equal(
    classifyOracleRun({ code: null, signal: "SIGTERM", output: "" }).outcome,
    "did_not_run",
  );
  assert.equal(
    classifyOracleRun({ code: null, signal: null, output: "", launchError: true }).outcome,
    "did_not_run",
  );
});

test("the factory's marks: missing name and file are informational, a snapshot is refused", () => {
  const name = run(1, VITEST_FAILED + "\nTypeError: x is not a function");
  assert.deepEqual(name.marks, ["missing_name"]);
  assert.ok(isRedForRightReason(name));
  const file = run(1, PYTEST_FAILED + "\nFileNotFoundError: x");
  assert.deepEqual(file.marks, ["missing_file"]);
  assert.ok(isRedForRightReason(file));
  const snap = run(1, VITEST_FAILED + "\nSnapshot `adds 1` mismatched");
  assert.deepEqual(snap.marks, ["snapshot"]);
  assert.equal(isRedForRightReason(snap), false);
});

// ── the journal: what the delivery proof reads ───────────────────────────────

const SHA = "aaaaaaaaaaaaaaaa";
const entry = (over = {}) => ({
  slug: "demo",
  contract_sha: SHA,
  criterion: "AC1",
  expect: "fail",
  status: "fail",
  command: "pytest",
  source: "config.test_one",
  code: 1,
  signal: null,
  test_file: "t.py",
  test_sha: "1111111111111111",
  head_sha: "abc",
  ran_at: "2026-11-26T10:00:00.000Z",
  ...over,
});
const green = () => entry({ expect: "pass", status: "pass", code: 0, outcome: "passed" });

function proofOf(red) {
  const dir = mkdtempSync(join(tmpdir(), "marvin-classify-"));
  try {
    recordOracleRun(dir, red);
    recordOracleRun(dir, green());
    const runs = readOracleRuns(dir, "demo");
    return { proof: redGreenProof(runs, SHA, "AC1"), why: redRejection(runs, SHA, "AC1") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a red→green pair is proven only when the red ran and failed", () => {
  assert.equal(proofOf(entry({ outcome: "failed", marks: [] })).proof, "proven");
});

for (const outcome of ["did_not_run", "unknown"]) {
  test(`a ${outcome} red is rejected as proof, with the reason named`, () => {
    const { proof, why } = proofOf(entry({ outcome, outcome_detail: "pytest: collection error" }));
    assert.equal(proof, "missing");
    assert.match(why, new RegExp(outcome));
  });
}

test("a snapshot-marked red is rejected as proof", () => {
  assert.equal(proofOf(entry({ outcome: "failed", marks: ["snapshot"] })).proof, "missing");
});

test("a record without the field still parses and is unclassified, not ran-and-failed", () => {
  const { proof, why } = proofOf(entry());
  assert.equal(proof, "missing");
  assert.match(why, /no classification/);
});
