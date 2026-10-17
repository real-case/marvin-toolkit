import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./_tsload.mjs";

const { classifyCi } = await importTs("src/pipeline/ci.ts");
const pr = (o = {}) => ({
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  headRefOid: "abc",
  ...o,
});
const run = (o = {}) => ({
  head_sha: "abc",
  status: "completed",
  conclusion: "success",
  name: "tests",
  ...o,
});
const c = (p, runs, minutes = 1) =>
  classifyCi({ pr: p, runs, minutesSincePush: minutes, noCiAfterMinutes: 10 });

test("a conflicting PR is a conflict, never pending", () => {
  assert.equal(
    c(pr({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }), []).state,
    "conflict",
  );
});

test("runs for other commits do not count", () => {
  assert.equal(c(pr(), [run({ head_sha: "old" })]).state, "pending");
  assert.equal(c(pr(), [run({ head_sha: "old" })], 15).state, "no_ci");
});

test("in-progress, red, green and closed", () => {
  assert.equal(c(pr(), [run({ status: "in_progress", conclusion: null })]).state, "pending");
  const red = c(pr(), [run(), run({ name: "lint", conclusion: "failure" })]);
  assert.deepEqual([red.state, red.failing], ["red", ["lint"]]);
  assert.equal(c(pr(), [run(), run({ name: "e2e", conclusion: "skipped" })]).state, "green");
  assert.equal(c(pr({ state: "MERGED" }), []).state, "closed");
});
