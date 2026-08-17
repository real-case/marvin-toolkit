// Structural assertion over the trigger-eval CI step.
//
// Parsed, never grepped. Six of the workflow's steps carry `if: matrix.node` and
// one carries `continue-on-error: true`, so no text match can tell a gating step
// from a skipped or tolerated one — a criterion of the form "the workflow mentions
// the eval script" passes while the step runs on one leg or is allowed to fail.
//
// The six synthetic documents below are what make this discriminating: each one is
// the shipped workflow with exactly one thing wrong, and each must be rejected. The
// real file is then asserted to be accepted, so neither an over-strict nor an
// under-strict checker survives.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = join(repoRoot, ".github", "workflows", "validate-plugins.yml");

const EVAL_STEP = "Trigger-eval harness (self-test + mock sweep)";
const LINT_STEP_PREFIX = "Lint manifests";
const SKILLS_STEP_PREFIX = "Lint skills";
const REQUIRED_SCRIPTS = ["eval:self-test", "eval:trigger"];
/** A test affordance that can make lint-manifests pass regardless of the real tree. */
const BYPASS_VAR = "MARVIN_LINT_ROOT";

/**
 * Problems with a parsed workflow document. Empty array = accepted.
 * @param {any} doc
 * @returns {string[]}
 */
function checkEvalStep(doc) {
  const problems = [];
  const jobs = doc?.jobs ?? {};
  const job = jobs.validate;
  if (!job) return ["no `validate` job"];

  const steps = job.steps ?? [];
  const lintIndex = steps.findIndex((s) => String(s?.name ?? "").startsWith(LINT_STEP_PREFIX));
  const evalIndex = steps.findIndex((s) => s?.name === EVAL_STEP);

  if (lintIndex === -1) problems.push(`no step named ${LINT_STEP_PREFIX}…`);
  if (evalIndex === -1) {
    problems.push(`no step named "${EVAL_STEP}"`);
  } else {
    const step = steps[evalIndex];
    if (evalIndex !== lintIndex + 1) {
      problems.push(`the eval step is at ${evalIndex}, not immediately after ${lintIndex}`);
    }
    // `if` would gate it to one matrix leg; `continue-on-error` would let it fail
    // the harness and still report the job green.
    if ("if" in step) problems.push("the eval step carries an `if` key");
    if ("continue-on-error" in step) problems.push("the eval step carries `continue-on-error`");
    const run = String(step.run ?? "");
    for (const script of REQUIRED_SCRIPTS) {
      if (!run.includes(script)) problems.push(`the eval step does not run ${script}`);
    }
  }

  // GitHub Actions honours `env` at workflow, job and step level, and any of the
  // three reaches the linter. A step-level scan alone would miss two of them.
  const envBlocks = [doc?.env, job.env, ...steps.map((s) => s?.env)];
  if (envBlocks.some((env) => env && BYPASS_VAR in env)) {
    problems.push(`${BYPASS_VAR} is set in an env block`);
  }

  return problems;
}

const shipped = () => parse(readFileSync(WORKFLOW, "utf8"));

/** The shipped document with one mutation applied. */
function mutated(fn) {
  const doc = shipped();
  fn(doc, doc.jobs.validate.steps);
  return doc;
}

const evalStepOf = (steps) => steps.find((s) => s?.name === EVAL_STEP);
const skillsStepOf = (steps) =>
  steps.find((s) => String(s?.name ?? "").startsWith(SKILLS_STEP_PREFIX));

/**
 * Problems with the authored-surface lint step. A SECOND function over the same
 * parsed document rather than a widening of `checkEvalStep`, so neither claim can
 * be relaxed to accommodate the other.
 *
 * `checkEvalStep` cannot see this step at all: it locates exactly two steps, the
 * first whose name starts with `Lint manifests` and the eval step by full name. So
 * a workflow that puts the lint-skills step last, gates it behind an `if`, tolerates
 * it with `continue-on-error`, or omits it entirely passes that function unchanged —
 * green over a gate that never runs.
 *
 * @param {any} doc
 * @returns {string[]}
 */
function checkSkillsLintStep(doc) {
  const problems = [];
  const job = doc?.jobs?.validate;
  if (!job) return ["no `validate` job"];

  const steps = job.steps ?? [];
  const lintIndex = steps.findIndex((s) => String(s?.name ?? "").startsWith(LINT_STEP_PREFIX));
  const skillsIndex = steps.findIndex((s) => String(s?.name ?? "").startsWith(SKILLS_STEP_PREFIX));

  if (lintIndex === -1) problems.push(`no step named ${LINT_STEP_PREFIX}…`);
  if (skillsIndex === -1) return [...problems, `no step named ${SKILLS_STEP_PREFIX}…`];

  const step = steps[skillsIndex];
  // Immediately BEFORE the manifest lint. Between it and the eval harness is the
  // obvious position and it breaks the adjacency `checkEvalStep` protects.
  if (skillsIndex !== lintIndex - 1) {
    problems.push(`the lint-skills step is at ${skillsIndex}, not immediately before ${lintIndex}`);
  }
  if ("if" in step) problems.push("the lint-skills step carries an `if` key");
  if ("continue-on-error" in step) {
    problems.push("the lint-skills step carries `continue-on-error`");
  }
  if (!String(step.run ?? "").includes("lint:skills")) {
    problems.push("the lint-skills step does not run lint:skills");
  }

  return problems;
}

test("the eval step must be unconditional, intolerant of failure, immediately after Lint manifests, and run both scripts", () => {
  // Each mutation is the shipped workflow with exactly one thing wrong.
  const rejected = {
    "carries if": mutated((_doc, steps) => {
      evalStepOf(steps).if = "matrix.node == '20'";
    }),
    "carries continue-on-error": mutated((_doc, steps) => {
      evalStepOf(steps)["continue-on-error"] = true;
    }),
    "not immediately after Lint manifests": mutated((_doc, steps) => {
      const [step] = steps.splice(steps.indexOf(evalStepOf(steps)), 1);
      steps.push(step);
    }),
    "omits eval:self-test": mutated((_doc, steps) => {
      evalStepOf(steps).run = "npm run eval:trigger\n";
    }),
    "omits eval:trigger": mutated((_doc, steps) => {
      evalStepOf(steps).run = "npm run eval:self-test\n";
    }),
    "sets the bypass variable": mutated((_doc, steps) => {
      evalStepOf(steps).env = { [BYPASS_VAR]: "/tmp/compliant" };
    }),
  };

  for (const [label, doc] of Object.entries(rejected)) {
    assert.ok(checkEvalStep(doc).length > 0, `a workflow that ${label} must be rejected`);
  }

  // And the shipped file is accepted — without this, a checker that rejects
  // everything would pass all six cases above.
  assert.deepEqual(checkEvalStep(shipped()), []);
});

test("the lint-skills step is unconditional, intolerant of failure, and immediately before Lint manifests", () => {
  const rejected = {
    "carries if": mutated((_doc, steps) => {
      skillsStepOf(steps).if = "matrix.node == '20'";
    }),
    "carries continue-on-error": mutated((_doc, steps) => {
      skillsStepOf(steps)["continue-on-error"] = true;
    }),
    "sits after Lint manifests instead of before it": mutated((_doc, steps) => {
      const [step] = steps.splice(steps.indexOf(skillsStepOf(steps)), 1);
      steps.splice(
        steps.findIndex((s) => String(s?.name ?? "").startsWith(LINT_STEP_PREFIX)) + 1,
        0,
        step,
      );
    }),
    "sits last": mutated((_doc, steps) => {
      const [step] = steps.splice(steps.indexOf(skillsStepOf(steps)), 1);
      steps.push(step);
    }),
    "omits the step entirely": mutated((_doc, steps) => {
      steps.splice(steps.indexOf(skillsStepOf(steps)), 1);
    }),
    "does not run the linter": mutated((_doc, steps) => {
      skillsStepOf(steps).run = "echo skipped\n";
    }),
  };

  for (const [label, doc] of Object.entries(rejected)) {
    assert.ok(checkSkillsLintStep(doc).length > 0, `a workflow that ${label} must be rejected`);
  }

  // And the shipped file is accepted — without this, a checker that rejects
  // everything would pass all six cases above.
  assert.deepEqual(checkSkillsLintStep(shipped()), []);

  // The two claims are independent: inserting BEFORE the manifest lint shifts both
  // indices together, so the eval adjacency this suite already protects still holds
  // on the same parsed document.
  assert.deepEqual(checkEvalStep(shipped()), []);
});

test("the bypass variable is rejected at job and workflow level too, not only per step", () => {
  // GitHub honours all three scopes; a step-only scan is a silent hole.
  const atJob = mutated((doc) => {
    doc.jobs.validate.env = { [BYPASS_VAR]: "/tmp/compliant" };
  });
  const atWorkflow = mutated((doc) => {
    doc.env = { [BYPASS_VAR]: "/tmp/compliant" };
  });

  assert.ok(checkEvalStep(atJob).some((p) => p.includes(BYPASS_VAR)));
  assert.ok(checkEvalStep(atWorkflow).some((p) => p.includes(BYPASS_VAR)));
});

test("the premise holds: conditional and tolerated steps exist, so a text match cannot discriminate", () => {
  // If this ever fails, the structural checker above is no longer earning its cost
  // and a grep would do. Measured today: 6 and 1.
  const steps = shipped().jobs.validate.steps;
  const conditional = steps.filter((s) => "if" in s).length;
  const tolerated = steps.filter((s) => "continue-on-error" in s).length;

  assert.ok(conditional >= 2, `expected several conditional steps, found ${conditional}`);
  assert.ok(tolerated >= 1, `expected at least one tolerated step, found ${tolerated}`);
  assert.ok(!("if" in evalStepOf(steps)), "the eval step itself is not among them");
});
