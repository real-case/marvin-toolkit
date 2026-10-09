import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { importTs } from "./_tsload.mjs";

const { composePrompts, renderTemplate, RUNTIME_VARS } = await importTs("src/pipeline/prompt.ts");
const { decide } = await importTs("src/pipeline/engine.ts");
const { initRun, ROLES } = await importTs("src/pipeline/run-store.ts");
const { loadRubric } = await importTs("src/pipeline/assess.ts");

const pipelineDir = fileURLToPath(new URL("../../../pipeline/", import.meta.url));
const realRoles = join(pipelineDir, "roles");
const rubric = loadRubric(readFileSync(join(pipelineDir, "rubric.default.yaml"), "utf8"), null);
const NOW = new Date("2026-10-09T10:00:00Z");

const roles = mkdtempSync(join(tmpdir(), "roles-"));
writeFileSync(join(roles, "common.md"), "COMMON\n");
writeFileSync(join(roles, "executor.md"), "EXECUTOR\n");
writeFileSync(join(roles, "executor.context.md"), "spec {{spec}} findings {{findings}}\n");

test("the system prompt is identical for every run of a role", () => {
  const a = composePrompts(roles, "executor", { spec: "a", findings: "x" }, false);
  const b = composePrompts(roles, "executor", { spec: "b", findings: "y" }, false);
  assert.equal(a.system, b.system);
  assert.equal(a.system, "COMMON\n\nEXECUTOR\n");
  assert.notEqual(a.user, b.user);
  assert.equal(a.user, "spec a findings x\n");
});

test("a missing variable is an error; a resume sends the message alone", () => {
  assert.throws(
    () => composePrompts(roles, "executor", { spec: "a" }, false),
    /missing template var: findings/,
  );
  assert.equal(
    composePrompts(roles, "executor", { message: "ANSWERS:\nQ1: A" }, true).user,
    "ANSWERS:\nQ1: A",
  );
});

test("a variable the template does not use is an error, fresh or resumed", () => {
  assert.throws(
    () => composePrompts(roles, "executor", { spec: "a", findings: "x", lessons: "l" }, false),
    /unused template var: lessons/,
  );
  assert.throws(() => composePrompts(roles, "executor", {}, true), /missing template var: message/);
  assert.throws(
    () => composePrompts(roles, "executor", { message: "m", spec: "a" }, true),
    /unused template var: spec/,
  );
});

test("a value is inserted as it is: a placeholder inside it is never expanded", () => {
  assert.equal(renderTemplate("<{{a}}|{{b}}>", { a: "{{b}}", b: "$&" }), "<{{b}}|$&>");
});

/** One fresh spawn per role, as `decide` emits it, so the engine half is the engine's own. */
function engineContexts() {
  const at = (stage, patch = {}) => ({
    ...initRun({
      id: "r1",
      repoRoot: "/repo",
      base: "dev",
      lang: "en",
      orchestratorName: "Autopilot",
      task: "task",
      taskEnglish: "task",
      stageA: "standard",
      now: NOW,
    }),
    stage,
    branch: "feature/TBD--x",
    specPath: "specs/1-x.md",
    tier: "standard",
    ...patch,
  });
  const report = { passed: true, gates: [], undeclared: [], protected: [] };
  const full = {
    ...report,
    protectedSources: {},
    protectedPatterns: [],
    checks: [],
    sealed: [],
    blockers: [],
  };
  const sealed = { path: "src/a.test.ts", criteria: ["AC1"], sha256: "0".repeat(64) };
  const decisions = [
    decide(at("intake"), { kind: "start" }, rubric, NOW),
    decide(
      at("awaiting_approval"),
      { kind: "answer", judgment: "spec_approval", answer: { kind: "approve" } },
      rubric,
      NOW,
    ),
    decide(
      at("test_authoring"),
      { kind: "seal", ok: true, reasons: [], sealed: [sealed] },
      rubric,
      NOW,
    ),
    decide(
      at("gating", { iteration: 1, prUrl: "https://github.com/o/r/pull/1" }),
      { kind: "gate", report: full, findings: [] },
      rubric,
      NOW,
    ),
    decide(
      at("ci_wait", {
        iteration: 1,
        prUrl: "https://github.com/o/r/pull/1",
        ciSince: NOW.toISOString(),
      }),
      { kind: "ci", state: "green", failing: [] },
      rubric,
      NOW,
    ),
  ];
  const contexts = {};
  for (const d of decisions) {
    for (const a of d.actions) {
      if (a.kind === "spawn" && !a.resume) contexts[a.role] = a.context;
    }
  }
  return contexts;
}

test("every real context template renders with the engine's context and the runtime's list, nothing more", () => {
  const contexts = engineContexts();
  assert.deepEqual(Object.keys(contexts).sort(), [...ROLES].sort());
  for (const role of ROLES) {
    const engine = contexts[role];
    const runtime = Object.fromEntries(RUNTIME_VARS[role].map((name) => [name, `<${name}>`]));
    for (const name of RUNTIME_VARS[role]) {
      assert.ok(
        !Object.hasOwn(engine, name),
        `${role}: ${name} is both the engine's and the runtime's`,
      );
    }
    const { system, user } = composePrompts(realRoles, role, { ...engine, ...runtime }, false);
    assert.ok(!user.includes("{{"), `${role}: a placeholder survived`);
    for (const name of RUNTIME_VARS[role])
      assert.ok(user.includes(`<${name}>`), `${role}: ${name}`);
    // Each variable is load-bearing: leaving one out is refused, and so is an extra one.
    for (const name of Object.keys({ ...engine, ...runtime })) {
      const fewer = { ...engine, ...runtime };
      delete fewer[name];
      assert.throws(
        () => composePrompts(realRoles, role, fewer, false),
        new RegExp(`missing template var: ${name}$`),
        `${role} without ${name}`,
      );
    }
    assert.throws(
      () => composePrompts(realRoles, role, { ...engine, ...runtime, extra: "x" }, false),
      /unused template var: extra/,
    );
    // The system prompt is the two static files and nothing a run supplies.
    const again = composePrompts(realRoles, role, { ...engine, ...runtime, child: "other" }, false);
    assert.equal(again.system, system, role);
    assert.ok(system.startsWith(readFileSync(join(realRoles, "common.md"), "utf8")), role);
  }
});
