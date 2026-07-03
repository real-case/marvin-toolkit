#!/usr/bin/env node
// Self-test: exercises catalog + schema + mock decider + scoring end-to-end with
// no network, and asserts the trigger-rate math and TRIG verdicts land exactly
// where the 0.5 boundary says they should. This guards the harness, not any skill.
//
//   node evals/trigger/self-test.mjs

import assert from "node:assert/strict";
import { loadCatalog } from "./lib/catalog.mjs";
import { validateDataset } from "./lib/schema.mjs";
import { score } from "./lib/score.mjs";
import { makeDecider } from "./lib/deciders/index.mjs";

const RUNS = 3;
const mock = makeDecider("mock");

async function decideAll(dataset) {
  const results = [];
  for (const query of dataset.queries) {
    const decisions = [];
    for (let r = 0; r < RUNS; r++) {
      const d = await mock({
        catalog: [],
        catalogText: "",
        query,
        target: dataset.target,
        runIndex: r,
        runs: RUNS,
      });
      decisions.push(d.skill);
    }
    results.push({ query, decisions });
  }
  return score({ dataset, results });
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

// --- catalog ---
const catalog = loadCatalog();
check("catalog loads all 37 skills", () => assert.equal(catalog.length, 37));
check("catalog marks disable-model-invocation", () => {
  const acc = catalog.find((s) => s.name === "adr-accept");
  assert.ok(acc && acc.disableModelInvocation === true);
  const commit = catalog.find((s) => s.name === "commit");
  assert.ok(commit && commit.disableModelInvocation === false);
});

// --- schema ---
check("schema rejects a malformed dataset", () => {
  const bad = validateDataset({
    skill: "x",
    target: "x",
    queries: [{ id: "a", text: "", should_trigger: "yes", split: "nope", kind: "??" }],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length >= 3);
});

// --- scoring: an all-pass dataset should be "ready" ---
const allPass = {
  skill: "demo",
  target: "demo",
  queries: [
    { id: "p1", text: "q", should_trigger: true, split: "train", kind: "positive", mock_rate: 1 },
    {
      id: "p2",
      text: "q",
      should_trigger: true,
      split: "validation",
      kind: "positive",
      mock_rate: 1,
    },
    { id: "n1", text: "q", should_trigger: false, split: "train", kind: "negative", mock_rate: 0 },
    {
      id: "n2",
      text: "q",
      should_trigger: false,
      split: "validation",
      kind: "negative",
      mock_rate: 0,
    },
    {
      id: "cw",
      text: "q",
      should_trigger: true,
      split: "train",
      kind: "competition",
      winner: "demo",
      mock_rate: 0.67,
    },
    {
      id: "cl",
      text: "q",
      should_trigger: false,
      split: "validation",
      kind: "competition",
      winner: "other",
      mock_rate: 0.34,
    },
  ],
};

const rA = await decideAll(allPass);
check("all-pass: trigger rates land on the right side of 0.5", () => {
  const rate = (id) => rA.perQuery.find((q) => q.id === id).trigger_rate;
  assert.equal(rate("p1"), 1);
  assert.equal(rate("n1"), 0);
  assert.equal(rate("cw"), 0.667);
  assert.equal(rate("cl"), 0.333);
});
check("all-pass: every query passes", () => assert.ok(rA.perQuery.every((q) => q.pass)));
check("all-pass: TRIG-01 blocker passes", () => assert.equal(rA.items["TRIG-01"].verdict, "pass"));
check("all-pass: TRIG-03 and TRIG-04 pass", () => {
  assert.equal(rA.items["TRIG-03"].verdict, "pass");
  assert.equal(rA.items["TRIG-04"].verdict, "pass");
});
check("all-pass: overall verdict is ready", () => assert.equal(rA.verdict, "ready"));

// --- scoring: a failing positive trips the blocker → not-ready ---
const blockerFail = {
  skill: "demo",
  target: "demo",
  queries: [
    { id: "p1", text: "q", should_trigger: true, split: "train", kind: "positive", mock_rate: 1 },
    {
      id: "p2",
      text: "q",
      should_trigger: true,
      split: "train",
      kind: "positive",
      mock_rate: 0.34,
    }, // 0.333 < 0.5 → fail
    {
      id: "n1",
      text: "q",
      should_trigger: false,
      split: "validation",
      kind: "negative",
      mock_rate: 0,
    },
  ],
};
const rB = await decideAll(blockerFail);
check("blocker-fail: TRIG-01 fails (a positive stayed under 0.5)", () => {
  assert.equal(rB.items["TRIG-01"].verdict, "fail");
  assert.equal(rB.items["TRIG-01"].passed, 1);
  assert.equal(rB.items["TRIG-01"].total, 2);
});
check("blocker-fail: overall verdict is not-ready", () => assert.equal(rB.verdict, "not-ready"));

// --- scoring: a leaky negative fails TRIG-02 (major) ---
const negLeak = {
  skill: "demo",
  target: "demo",
  queries: [
    { id: "p1", text: "q", should_trigger: true, split: "train", kind: "positive", mock_rate: 1 },
    {
      id: "n1",
      text: "q",
      should_trigger: false,
      split: "train",
      kind: "negative",
      mock_rate: 0.67,
    }, // 0.667 > 0.5 → leak
  ],
};
const rC = await decideAll(negLeak);
check("neg-leak: TRIG-02 fails", () => assert.equal(rC.items["TRIG-02"].verdict, "fail"));
check("neg-leak: blocker still passes but overall not-ready", () => {
  assert.equal(rC.items["TRIG-01"].verdict, "pass");
  assert.equal(rC.verdict, "not-ready");
});

console.log("");
if (failures) {
  console.error(`self-test FAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("self-test OK");
