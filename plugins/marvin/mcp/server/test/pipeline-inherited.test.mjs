import { test } from "node:test";
import assert from "node:assert/strict";
import { g, gateStage, runWorktree } from "./_gate-fixture.mjs";
import { importTs } from "./_tsload.mjs";

const inh = await importTs("src/pipeline/inherited.ts");

// The suite runs under `node --test`, whose context variable would make a child runner report to
// this process instead of printing.
const NODE = "env -u NODE_TEST_CONTEXT node --test";
const TEST_ONE = `${NODE} {file}`;
const SUITE = { name: "test", command: `${NODE} test/*.test.mjs` };
const TEST_PATHS = "(^|/)(__tests__/|[^/]+\\.(test|spec)\\.[cm]?[jt]sx?$)";

const RED_ON_BASE = `import { test } from "node:test";
import assert from "node:assert/strict";
test("base is already red", () => assert.equal(1, 2));
`;
const USES_MODULE = `import { test } from "node:test";
import assert from "node:assert/strict";
import { value } from "../src/m.mjs";
test("module value is one", () => assert.equal(value, 1));
`;

/** A base whose `test/a.test.mjs` already fails and whose `test/b.test.mjs` passes. */
const redBase = () =>
  runWorktree({
    "test/a.test.mjs": RED_ON_BASE,
    "test/b.test.mjs": USES_MODULE,
    "src/m.mjs": "export const value = 1;\n",
  });

const memoryCache = () => {
  const map = new Map();
  return {
    map,
    get: (base, command) => map.get(`${base}\0${command}`),
    set: (base, command, run) => map.set(`${base}\0${command}`, run),
  };
};

/** A `baseCheck` as the runtime builds it, with a counting runner and a cache of its own. */
const baseCheckFor = (w, over = {}) => {
  const calls = [];
  const cache = over.cache ?? memoryCache();
  const run = (command, cwd, timeoutMs, signal) => {
    calls.push({ command, cwd });
    return g.shellRunnerAsync(command, cwd, timeoutMs, signal);
  };
  const baseCheck = ({ output, baseSha, changed }) =>
    inh.checkInherited({
      worktree: w.path,
      gitDir: w.gitDir,
      baseSha,
      changed,
      testOne: TEST_ONE,
      testPathPattern: TEST_PATHS,
      output,
      run,
      timeoutMs: 60_000,
      cache,
      ...over,
    });
  return { baseCheck, calls, cache };
};

test("failure lines drop durations, ordinals, positions and the worktree path", () => {
  const out = [
    "✔ fine (0.2ms)",
    "✖ broken two (0.270959ms)",
    "ℹ fail 1",
    "✖ failing tests:",
    "test at test/a.test.mjs:2:27",
    "✖ broken two (1.5ms)",
    "not ok 3 - /w/tree/test/a.test.mjs",
    "\u001b[31m FAIL \u001b[39m src/x.test.ts > suite > case 2",
  ].join("\n");
  assert.deepEqual(inh.failureLines(out, "/w/tree"), [
    "FAIL src/x.test.ts > suite > case 2",
    "not ok - <root>/test/a.test.mjs",
    "✖ broken two",
  ]);
});

test("failing files come from failure lines and node's test-at lines, tracked tests only", () => {
  const out = [
    "test at test/a.test.mjs:2:27",
    "✖ broken (1ms)",
    " FAIL  src/x.test.ts > suite",
    "not ok 1 - /w/tree/test/c.test.mjs",
    "✔ test/passing.test.mjs",
    "✖ src/not-a-test.mjs",
    "✖ /elsewhere/test/z.test.mjs",
  ].join("\n");
  const tracked = (p) => p !== "test/c.test.mjs";
  assert.deepEqual(inh.failingFiles(out, "/w/tree", TEST_PATHS, tracked), [
    "src/x.test.ts",
    "test/a.test.mjs",
  ]);
});

test("TAP output names a failing file only through the location line of a not-ok block", () => {
  const out = [
    "TAP version 13",
    "# Subtest: fine",
    "ok 1 - fine",
    "  ---",
    "  duration_ms: 0.26",
    "  location: '/w/tree/test/passing.test.mjs:1:1'",
    "  ...",
    "# Subtest: broken two",
    "not ok 2 - broken two",
    "  ---",
    "  duration_ms: 0.28",
    "  location: '/w/tree/test/a.test.mjs:2:27'",
    "  error: '1 == 2'",
    "  ...",
    "# fail 1",
  ].join("\n");
  assert.deepEqual(
    inh.failingFiles(out, "/w/tree", TEST_PATHS, () => true),
    ["test/a.test.mjs"],
  );
  assert.deepEqual(inh.failureLines(out, "/w/tree"), ["not ok - broken two"]);
});

test("a gate failing only on a test the base already fails passes, with a recorded finding", async () => {
  const w = redBase();
  w.write("src/other.mjs", "export const other = 2;\n");
  w.commit();
  const { baseCheck } = baseCheckFor(w);
  const report = await gateStage(w, {
    gates: [SUITE],
    contractFiles: ["src/other.mjs"],
    baseCheck,
  });
  const gate = report.gates.find((x) => x.name === "test");
  assert.equal(gate.result, "inherited");
  assert.deepEqual(gate.inherited.files, ["test/a.test.mjs"]);
  assert.equal(gate.inherited.base, w.baseSha);
  assert.equal(report.passed, true);
  const finding = g.reportFindings(report).find((f) => f.id === "G-test-inherited");
  assert.equal(finding.severity, "minor");
  assert.match(finding.claim, /test\/a\.test\.mjs/);
  assert.match(finding.evidence, /base is already red/);
  assert.equal(g.reportFindings(report).filter((f) => f.severity !== "minor").length, 0);
});

test("the TAP reporter classifies the same inherited failure", async () => {
  const w = redBase();
  w.write("src/other.mjs", "export const other = 2;\n");
  w.commit();
  const tap = `${NODE} --test-reporter=tap`;
  const { baseCheck } = baseCheckFor(w, { testOne: `${tap} {file}` });
  const report = await gateStage(w, {
    gates: [{ name: "test", command: `${tap} test/*.test.mjs` }],
    contractFiles: ["src/other.mjs"],
    baseCheck,
  });
  assert.equal(report.gates[0].result, "inherited", report.gates[0].baseCheck);
  assert.deepEqual(report.gates[0].inherited.files, ["test/a.test.mjs"]);
});

test("a failure the run caused still fails the gate, beside an inherited one", async () => {
  const w = redBase();
  w.write("src/m.mjs", "export const value = 2;\n");
  w.commit();
  const { baseCheck } = baseCheckFor(w);
  const report = await gateStage(w, { gates: [SUITE], contractFiles: ["src/m.mjs"], baseCheck });
  const gate = report.gates.find((x) => x.name === "test");
  assert.equal(gate.result, "fail");
  assert.match(gate.baseCheck, /^not inherited: test\/b\.test\.mjs passes on the base/);
  assert.equal(report.passed, false);
  const blocker = g.reportFindings(report).find((f) => f.id === "G-test");
  assert.equal(blocker.severity, "blocker");
  assert.match(blocker.evidence, /base check: not inherited/);
});

test("a failing test the run changed is never inherited", async () => {
  const w = redBase();
  w.write("test/a.test.mjs", `${RED_ON_BASE}// touched\n`);
  w.commit();
  const { baseCheck, calls } = baseCheckFor(w);
  const report = await gateStage(w, {
    gates: [SUITE],
    contractFiles: ["test/a.test.mjs"],
    baseCheck,
  });
  const gate = report.gates.find((x) => x.name === "test");
  assert.equal(gate.result, "fail");
  assert.match(gate.baseCheck, /the run changed the failing test test\/a\.test\.mjs/);
  assert.equal(calls.length, 0);
});

test("a base check that cannot run fails closed", async () => {
  const w = redBase();
  w.write("src/other.mjs", "export const other = 2;\n");
  w.commit();
  for (const [over, why] of [
    [{ testOne: undefined }, /unavailable: no gates\.test_one/],
    [
      { testOne: "node {file} `x`" },
      /unavailable: the base check failed: gates\.test_one must not/,
    ],
    [
      { run: () => Promise.reject(new Error("runner exploded")) },
      /unavailable: the base check failed: runner exploded/,
    ],
  ]) {
    const { baseCheck } = baseCheckFor(w, over);
    const report = await gateStage(w, {
      gates: [SUITE],
      contractFiles: ["src/other.mjs"],
      baseCheck,
    });
    const gate = report.gates.find((x) => x.name === "test");
    assert.equal(gate.result, "fail");
    assert.match(gate.baseCheck, why);
    assert.equal(report.passed, false);
  }
  // A baseCheck that throws outright is the same as one that answers unavailable.
  const report = await gateStage(w, {
    gates: [SUITE],
    contractFiles: ["src/other.mjs"],
    baseCheck: () => Promise.reject(new Error("no base tree")),
  });
  assert.equal(report.gates[0].result, "fail");
  assert.match(report.gates[0].baseCheck, /unavailable: the base check failed: no base tree/);
});

test("a gate whose output names no failed test is not inherited", async () => {
  const w = redBase();
  w.write("src/other.mjs", "export const other = 2;\n");
  w.commit();
  const { baseCheck, calls } = baseCheckFor(w);
  const report = await gateStage(w, {
    gates: [{ name: "lint", command: "echo 'something broke' >&2; exit 1" }],
    contractFiles: ["src/other.mjs"],
    baseCheck,
  });
  assert.equal(report.gates[0].result, "fail");
  assert.match(report.gates[0].baseCheck, /unavailable: the output names no failed test/);
  assert.equal(calls.length, 0);
});

test("the base side is cached by base SHA: a second check runs only on HEAD", async () => {
  const w = redBase();
  w.write("src/other.mjs", "export const other = 2;\n");
  w.commit();
  const cache = memoryCache();
  const first = baseCheckFor(w, { cache });
  const r1 = await gateStage(w, {
    gates: [SUITE],
    contractFiles: ["src/other.mjs"],
    baseCheck: first.baseCheck,
  });
  assert.equal(r1.gates[0].result, "inherited");
  const baseRuns = (calls) => calls.filter((c) => c.cwd !== w.path);
  assert.equal(baseRuns(first.calls).length, 1);
  assert.equal(cache.map.size, 1);
  assert.ok([...cache.map.keys()][0].startsWith(`${w.baseSha}\0`));

  const second = baseCheckFor(w, { cache });
  const r2 = await gateStage(w, {
    gates: [SUITE],
    contractFiles: ["src/other.mjs"],
    baseCheck: second.baseCheck,
  });
  assert.equal(r2.gates[0].result, "inherited");
  assert.equal(baseRuns(second.calls).length, 0);
  assert.equal(second.calls.length, 1);

  // Another base is another key: nothing is reused for it.
  const other = "0".repeat(40);
  assert.equal(cache.get(other, TEST_ONE.replace("{file}", "'test/a.test.mjs'")), undefined);
  assert.equal(inh.cacheKey(w.baseSha, "x") === inh.cacheKey(other, "x"), false);
});

test("an oracle and a prepare step are never offered to the base check", async () => {
  const w = redBase();
  w.write("src/other.mjs", "export const other = 2;\n");
  w.commit();
  const asked = [];
  const report = await gateStage(w, {
    prepare: [{ name: "build", command: "true" }],
    gates: [],
    oracles: [{ criterion: "AC-1", command: `${NODE} test/a.test.mjs`, reason: null }],
    contractFiles: ["src/other.mjs"],
    baseCheck: async (failed) => {
      asked.push(failed.name);
      return { kind: "inherited", base: w.baseSha, files: [], lines: [] };
    },
  });
  assert.deepEqual(asked, []);
  assert.equal(report.gates.find((x) => x.name === "oracle:AC-1").result, "fail");
  assert.equal(report.passed, false);
});
