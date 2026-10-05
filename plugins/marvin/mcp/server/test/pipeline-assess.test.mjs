import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { importTs } from "./_tsload.mjs";

const a = await importTs("src/pipeline/assess.ts");
const DEFAULT = readFileSync(
  fileURLToPath(new URL("../../../pipeline/rubric.default.yaml", import.meta.url)),
  "utf8",
);
const rubric = a.loadRubric(
  DEFAULT,
  "sensitive_paths: ['^src/app/\\(dashboard\\)/_payments/']\ncross_repo_markers: ['researchType']\n",
);
const spec = (risk, paths, extra = "") =>
  `---\nslug: x\ntype: feature\nrisk: ${risk}\n---\n# X\n${extra}\n\`\`\`yaml spec-contract\nfiles:\n${paths.map((p) => `  - path: ${p}\n    action: modify`).join("\n")}\ncriteria:\n  - id: AC1\n\`\`\`\n`;
const tierOf = (text) => a.tierFor(a.readSignals(text, rubric), rubric).tier;

test("tiers follow risk, size, sensitive paths and cross-repo markers", () => {
  assert.equal(tierOf(spec("low", ["src/a.ts", "src/b.ts", "src/c.ts"])), "light");
  assert.equal(tierOf(spec("medium", ["src/a.ts"])), "standard");
  assert.equal(tierOf(spec("high", ["src/a.ts"])), "heavy");
  assert.equal(
    tierOf(
      spec(
        "low",
        Array.from({ length: 16 }, (_, i) => `src/f${i}.ts`),
      ),
    ),
    "heavy",
  );
  const sensitive = a.tierFor(
    a.readSignals(spec("low", ["src/app/(dashboard)/_payments/x.ts"]), rubric),
    rubric,
  );
  assert.equal(sensitive.tier, "heavy");
  assert.match(sensitive.reasons.join(" "), /_payments/);
  assert.equal(tierOf(spec("low", ["src/a.ts"], "Sends researchType on the wire.")), "heavy");
});

test("the tier boundaries sit at 5 and 16 contract files", () => {
  const files = (n) => Array.from({ length: n }, (_, i) => `src/f${i}.ts`);
  assert.equal(tierOf(spec("low", files(5))), "light");
  assert.equal(tierOf(spec("low", files(6))), "standard");
  assert.equal(tierOf(spec("medium", files(15))), "standard");
  assert.equal(tierOf(spec("medium", files(16))), "heavy");
  assert.equal(tierOf(spec("medium", files(2))), "standard");
});

test("the executor ladder raises effort, then switches to opus, then halts", () => {
  const at = (rung) => a.assignmentFor("standard", "executor", rung, rubric);
  assert.deepEqual(at(0), { model: "sonnet", effort: "high" });
  assert.deepEqual(at(1), { model: "sonnet", effort: "xhigh" });
  assert.deepEqual(at(2), { model: "opus", effort: "xhigh" });
  assert.throws(() => at(3), /halt/);
  assert.throws(() => at(4), /halt/);
});

test("a ladder without a halt step still stops once its steps are spent", () => {
  const r = a.loadRubric(DEFAULT, "escalation: [effort+1]\n");
  assert.deepEqual(a.assignmentFor("standard", "executor", 1, r), {
    model: "sonnet",
    effort: "xhigh",
  });
  assert.throws(() => a.assignmentFor("standard", "executor", 2, r), /halt/);
});

test("only the executor climbs the ladder", () => {
  for (const role of ["planner", "test-author", "verifier", "retro"]) {
    assert.deepEqual(
      a.assignmentFor("standard", role, 2, rubric),
      a.assignmentFor("standard", role, 0, rubric),
    );
  }
});

test("effort never goes past max", () => {
  const r = a.loadRubric(DEFAULT, "assignments: { standard: { executor: sonnet/max } }\n");
  assert.deepEqual(a.assignmentFor("standard", "executor", 1, r), {
    model: "sonnet",
    effort: "max",
  });
});

test("the default rubric assigns every tier and role as designed", () => {
  const cell = (tier, role) => a.assignmentFor(tier, role, 0, rubric);
  assert.deepEqual(cell("light", "planner"), { model: "opus", effort: "medium" });
  assert.equal(cell("light", "test-author"), "skip");
  assert.deepEqual(cell("light", "executor"), { model: "sonnet", effort: "medium" });
  assert.deepEqual(cell("light", "verifier"), { model: "sonnet", effort: "high" });
  assert.deepEqual(cell("light", "retro"), { model: "sonnet", effort: "medium" });
  assert.deepEqual(cell("standard", "planner"), { model: "opus", effort: "high" });
  assert.deepEqual(cell("standard", "test-author"), { model: "opus", effort: "medium" });
  assert.deepEqual(cell("standard", "executor"), { model: "sonnet", effort: "high" });
  assert.deepEqual(cell("standard", "verifier"), { model: "opus", effort: "high" });
  assert.deepEqual(cell("standard", "retro"), { model: "opus", effort: "medium" });
  assert.deepEqual(cell("heavy", "planner"), { model: "opus", effort: "xhigh" });
  assert.deepEqual(cell("heavy", "test-author"), { model: "opus", effort: "high" });
  assert.deepEqual(cell("heavy", "executor"), { model: "opus", effort: "high" });
  assert.deepEqual(cell("heavy", "verifier"), { model: "opus", effort: "xhigh" });
  assert.deepEqual(cell("heavy", "retro"), { model: "opus", effort: "medium" });
});

test("the verifier is never weaker than the executor", () => {
  assert.deepEqual(
    a.enforceVerifierFloor({ model: "opus", effort: "high" }, { model: "sonnet", effort: "high" }),
    { model: "opus", effort: "high" },
  );
  assert.deepEqual(
    a.enforceVerifierFloor({ model: "sonnet", effort: "high" }, { model: "opus", effort: "xhigh" }),
    { model: "opus", effort: "xhigh" },
  );
});

test("the verifier floor ranks a full model id by its family", () => {
  assert.deepEqual(
    a.enforceVerifierFloor(
      { model: "claude-opus-5-5", effort: "high" },
      { model: "sonnet", effort: "high" },
    ),
    { model: "claude-opus-5-5", effort: "high" },
  );
  assert.deepEqual(
    a.enforceVerifierFloor(
      { model: "sonnet", effort: "high" },
      { model: "claude-opus-5-5", effort: "high" },
    ),
    { model: "claude-opus-5-5", effort: "high" },
  );
});

test("the verifier floor keeps the verifier's own model string when its family is not lower", () => {
  assert.deepEqual(
    a.enforceVerifierFloor(
      { model: "claude-opus-5-5", effort: "high" },
      { model: "opus", effort: "high" },
    ),
    { model: "opus", effort: "high" },
  );
});

test("the verifier floor also holds on effort", () => {
  assert.deepEqual(
    a.enforceVerifierFloor({ model: "opus", effort: "xhigh" }, { model: "opus", effort: "high" }),
    { model: "opus", effort: "xhigh" },
  );
  assert.deepEqual(
    a.enforceVerifierFloor({ model: "sonnet", effort: "max" }, { model: "opus", effort: "medium" }),
    { model: "opus", effort: "max" },
  );
  assert.deepEqual(
    a.enforceVerifierFloor({ model: "sonnet", effort: "low" }, { model: "opus", effort: "high" }),
    { model: "opus", effort: "high" },
  );
});

test("the verifier floor refuses a model outside the allowed families", () => {
  assert.throws(
    () =>
      a.enforceVerifierFloor({ model: "fable", effort: "high" }, { model: "opus", effort: "high" }),
    /Fable is not allowed/,
  );
  assert.throws(
    () =>
      a.enforceVerifierFloor({ model: "opus", effort: "high" }, { model: "gpt-x", effort: "high" }),
    /model not allowed/,
  );
});

test("light skips the test-author; caps come from the project rubric", () => {
  assert.equal(a.assignmentFor("light", "test-author", 0, rubric), "skip");
  assert.equal(a.loadRubric(DEFAULT, "caps: { planner_questions: 4 }\n").caps.planner_questions, 4);
  assert.equal(a.loadRubric(DEFAULT, null).caps.rejections, 3);
});

test("a project rubric overrides one key and leaves its siblings at the default", () => {
  const r = a.loadRubric(DEFAULT, "caps: { planner_questions: 4 }\n");
  assert.equal(r.caps.rejections, 3);
  assert.equal(r.caps.test_author_attempts, 2);
  assert.deepEqual(r.caps.spec_critic, { light: 1, default: 2 });
  assert.deepEqual(a.loadRubric(DEFAULT, "").caps, a.loadRubric(DEFAULT, null).caps);
});

test("a rubric naming Fable is rejected at load", () => {
  assert.throws(
    () => a.loadRubric(DEFAULT, "assignments: { heavy: { verifier: fable/high } }\n"),
    /Fable is not allowed/,
  );
  assert.throws(
    () => a.loadRubric(DEFAULT, "escalation: [effort+1, 'model:fable', halt]\n"),
    /Fable is not allowed/,
  );
  assert.throws(
    () => a.loadRubric(DEFAULT, "assignments: { heavy: { verifier: Fable/high } }\n"),
    /Fable is not allowed/,
  );
  assert.throws(
    () => a.loadRubric(DEFAULT, "assignments: { heavy: { verifier: claude-fable-5-1/high } }\n"),
    /Fable is not allowed/,
  );
});

test("a rubric naming an unknown model is rejected at load", () => {
  assert.throws(
    () => a.loadRubric(DEFAULT, "assignments: { heavy: { verifier: gpt-x/high } }\n"),
    /model not allowed: gpt-x/,
  );
  assert.throws(
    () => a.loadRubric(DEFAULT, "escalation: [effort+1, 'model:gpt-x', halt]\n"),
    /model not allowed: gpt-x/,
  );
  const ok = a.loadRubric(DEFAULT, "assignments: { heavy: { verifier: claude-opus-5-5/high } }\n");
  assert.deepEqual(a.assignmentFor("heavy", "verifier", 0, ok), {
    model: "claude-opus-5-5",
    effort: "high",
  });
});

test("assignmentFor refuses Fable even for a rubric that skipped the loader", () => {
  const r = structuredClone(rubric);
  r.assignments.standard.executor = "fable/high";
  assert.throws(() => a.assignmentFor("standard", "executor", 0, r), /Fable is not allowed/);
});

test("a pattern that is not a regular expression is rejected at load, naming the entry", () => {
  assert.throws(
    () => a.loadRubric(DEFAULT, "sensitive_paths: ['^ok/', '(unclosed']\n"),
    /sensitive_paths.*\(unclosed/,
  );
  assert.throws(
    () => a.loadRubric(DEFAULT, "cross_repo_markers: ['[']\n"),
    /cross_repo_markers.*\[/,
  );
});

test("a rubric with an unusable ladder or tier bounds is rejected at load", () => {
  assert.throws(() => a.loadRubric(DEFAULT, "escalation: []\n"), /escalation/);
  assert.throws(() => a.loadRubric(DEFAULT, "escalation: [halt, effort+1]\n"), /halt.*last/);
  assert.throws(
    () => a.loadRubric(DEFAULT, "escalation: [effort+1, halt, model:opus]\n"),
    /halt.*last/,
  );
  assert.throws(() => a.loadRubric(DEFAULT, "tiers: { light: { max_files: 16 } }\n"), /max_files/);
  assert.throws(() => a.loadRubric(DEFAULT, "tiers: { heavy: { min_files: 3 } }\n"), /max_files/);
  assert.equal(
    a.loadRubric(DEFAULT, "tiers: { light: { max_files: 15 } }\n").tiers.light.max_files,
    15,
  );
});

test("a ladder may omit the halt step", () => {
  const r = a.loadRubric(DEFAULT, "escalation: [effort+1, model:opus]\n");
  assert.deepEqual(r.escalation, ["effort+1", "model:opus"]);
});

test("fingerprints identify a finding by category, file and criterion", () => {
  assert.equal(
    a.fingerprint({ category: "criterion", file: "src/a.ts", criterion: "AC1" }),
    "criterion|src/a.ts|AC1",
  );
  assert.equal(a.fingerprint({ category: "gate" }), "gate||");
  assert.equal(a.fingerprint({ category: "scope", file: "src/b.ts" }), "scope|src/b.ts|");
});

const full = (front, files, criteria) =>
  `---\n${front}\n---\n\n# Title\n\n## Goal\nG.\n\n\`\`\`yaml spec-contract\nfiles:\n${files}\ncriteria:\n${criteria}\n\`\`\`\n`;

const FILES = [
  "  - id: F1",
  "    path: src/a.ts",
  "    action: edit",
  "    intent: change it",
  "  - id: F2",
  "    path: src/b.ts",
  "    action: new",
  "  - id: F3",
  "    path: test/b.test.ts",
  "    action: new",
].join("\n");
const CRITERIA = [
  "  - id: AC1",
  "    statement: Given x, when y, then z",
  "    implemented_by: [F1, F3]",
  "    oracle:",
  "      kind: test",
  "      ref: test/b.test.ts::it works",
  "  - id: AC2",
  "    statement: Given x, when y, then w",
  "    implemented_by: [F2]",
  "    oracle:",
  "      kind: prose-review",
].join("\n");

test("signals count files, new files and criteria from a template-shaped contract", () => {
  const s = a.readSignals(full("slug: x\ntype: feature\nrisk: medium", FILES, CRITERIA), rubric);
  assert.equal(s.risk, "medium");
  assert.equal(s.bugfix, false);
  assert.equal(s.files, 3);
  assert.equal(s.newFiles, 2);
  assert.equal(s.criteria, 2);
  assert.deepEqual(s.paths, ["src/a.ts", "src/b.ts", "test/b.test.ts"]);
  assert.deepEqual(s.sensitive, []);
  assert.deepEqual(s.crossRepo, []);
});

test("a bugfix spec takes its risk from severity", () => {
  const sig = (severity) =>
    a.readSignals(full(`slug: x\ntype: bugfix\nseverity: ${severity}`, FILES, CRITERIA), rubric);
  assert.equal(sig("critical").risk, "high");
  assert.equal(sig("critical").bugfix, true);
  assert.equal(sig("high").risk, "high");
  assert.equal(sig("medium").risk, "medium");
  assert.equal(sig("low").risk, "low");
  assert.equal(a.tierFor(sig("critical"), rubric).tier, "heavy");
  assert.equal(a.tierFor(sig("low"), rubric).tier, "light");
});

test("a spec with no risk, or an unknown one, is medium", () => {
  const sig = (front) => a.readSignals(full(front, FILES, CRITERIA), rubric);
  assert.equal(sig("slug: x\ntype: feature").risk, "medium");
  assert.equal(sig("slug: x\ntype: feature\nrisk: sideways").risk, "medium");
  assert.equal(a.tierFor(sig("slug: x\ntype: feature"), rubric).tier, "standard");
});

test("a spec written with CRLF line endings is read the same as one with LF", () => {
  const lf = spec("low", ["src/a.ts", "src/b.ts"], "Sends researchType on the wire.");
  const crlf = lf.replace(/\n/g, "\r\n");
  assert.deepEqual(a.readSignals(crlf, rubric), a.readSignals(lf, rubric));
  assert.equal(a.readSignals(crlf, rubric).files, 2);
  assert.equal(a.readSignals(crlf, rubric).risk, "low");
  assert.deepEqual(a.readSignals(crlf, rubric).crossRepo, ["researchType"]);
});

test("the contract block is found the way the gate finds it", () => {
  const text = `---\nslug: x\ntype: feature\nrisk: low\n---\n# X\n\n\`\`\`yaml spec-contract extra\nfiles:\n  - path: src/a.ts\n    action: edit\ncriteria:\n  - id: AC1\n\`\`\`\n`;
  assert.equal(a.readSignals(text, rubric).files, 1);
});

test("a spec with no contract block, or a contract that cannot be read, is refused", () => {
  assert.throws(
    () => a.readSignals("---\nslug: x\nrisk: low\n---\n# X\nno contract\n", rubric),
    /spec-contract/,
  );
  const wrap = (body) =>
    `---\nslug: x\nrisk: low\n---\n# X\n\`\`\`yaml spec-contract\n${body}\n\`\`\`\n`;
  assert.throws(() => a.readSignals(wrap("files: [unclosed"), rubric), /spec-contract/);
  assert.throws(() => a.readSignals(wrap("files: nope"), rubric), /spec-contract/);
  assert.throws(() => a.readSignals(wrap("- just\n- a list"), rubric), /spec-contract/);
});

test("every sensitive path is reported, and each marker once", () => {
  const r = a.loadRubric(
    DEFAULT,
    "sensitive_paths: ['^src/auth/', 'websocket']\ncross_repo_markers: ['orderIndex', 'datasourceIds']\n",
  );
  const text = spec(
    "low",
    ["src/auth/login.ts", "src/ws/websocket.ts", "src/plain.ts"],
    "orderIndex and orderIndex again.",
  );
  const s = a.readSignals(text, r);
  assert.deepEqual(s.sensitive, ["src/auth/login.ts", "src/ws/websocket.ts"]);
  assert.deepEqual(s.crossRepo, ["orderIndex"]);
  const t = a.tierFor(s, r);
  assert.equal(t.tier, "heavy");
  assert.match(t.reasons.join(" | "), /sensitive path src\/auth\/login\.ts/);
  assert.match(t.reasons.join(" | "), /cross-repo marker orderIndex/);
});

test("the default rubric ships no sensitive paths or markers", () => {
  const r = a.loadRubric(DEFAULT, null);
  assert.deepEqual(r.sensitive_paths, []);
  assert.deepEqual(r.cross_repo_markers, []);
  assert.equal(r.slicing.enabled, false);
});

const run = (tier, stageA) => ({ tier, stageA });

test("the test-author is skipped on the light tier only", () => {
  assert.equal(a.shouldAuthorTests(run("light", "heavy"), rubric), false);
  assert.equal(a.shouldAuthorTests(run(null, "light"), rubric), false);
  assert.equal(a.shouldAuthorTests(run("standard", "light"), rubric), true);
  assert.equal(a.shouldAuthorTests(run(null, "heavy"), rubric), true);
});

test("the spec critic gets one pass on the light tier and two elsewhere", () => {
  assert.equal(a.criticCap(run(null, "light"), rubric), 1);
  assert.equal(a.criticCap(run("light", "heavy"), rubric), 1);
  assert.equal(a.criticCap(run(null, "standard"), rubric), 2);
  assert.equal(a.criticCap(run("heavy", "light"), rubric), 2);
  const r = a.loadRubric(DEFAULT, "caps: { spec_critic: { light: 2, default: 3 } }\n");
  assert.equal(a.criticCap(run("light", "light"), r), 2);
  assert.equal(a.criticCap(run("heavy", "light"), r), 3);
});

test("the approval preview shows every role for the run's tier, falling back to stage A", () => {
  assert.deepEqual(a.previewAssignments(run("heavy", "light"), rubric), {
    planner: "opus/xhigh",
    "test-author": "opus/high",
    executor: "opus/high",
    verifier: "opus/xhigh",
    retro: "opus/medium",
  });
  assert.deepEqual(a.previewAssignments(run(null, "light"), rubric), {
    planner: "opus/medium",
    "test-author": "skip",
    executor: "sonnet/medium",
    verifier: "sonnet/high",
    retro: "sonnet/medium",
  });
});

// ── fix round 1 ──

test("only the test-author may be skipped", () => {
  for (const role of ["planner", "executor", "verifier", "retro"]) {
    for (const tier of ["light", "standard", "heavy"]) {
      assert.throws(
        () => a.loadRubric(DEFAULT, `assignments: { ${tier}: { ${role}: skip } }\n`),
        new RegExp(`assignments\\.${tier}\\.${role}`),
        `${tier}/${role}`,
      );
    }
  }
  const r = a.loadRubric(DEFAULT, "assignments: { heavy: { test-author: skip } }\n");
  assert.equal(a.assignmentFor("heavy", "test-author", 0, r), "skip");
});

test("a rubric that skipped the loader still cannot skip a role that must run", () => {
  const r = structuredClone(rubric);
  for (const role of ["planner", "executor", "verifier", "retro"]) {
    const broken = structuredClone(r);
    broken.assignments.standard[role] = "skip";
    assert.throws(() => a.assignmentFor("standard", role, 0, broken), /cannot be skipped/, role);
  }
});

test("a malformed assignment or ladder step says what is expected", () => {
  const bad = (text) => assert.throws(() => a.loadRubric(DEFAULT, text), Error);
  for (const text of [
    "assignments: { standard: { executor: sonnet-high } }\n",
    "assignments: { standard: { executor: sonnet/ultra } }\n",
  ]) {
    assert.throws(
      () => a.loadRubric(DEFAULT, text),
      /assignments\.standard\.executor: expected "<model>\/<effort>" \(effort: low\|medium\|high\|xhigh\|max\)/,
    );
  }
  assert.throws(
    () => a.loadRubric(DEFAULT, "assignments: { standard: { test-author: nope } }\n"),
    /assignments\.standard\.test-author: expected "<model>\/<effort>".* or "skip"/,
  );
  assert.throws(
    () => a.loadRubric(DEFAULT, "escalation: [effort+2]\n"),
    /escalation\.0: expected "effort\+1", "model:<model>" or "halt"/,
  );
  bad("escalation: [model:]\n");
});

test("a mistyped rubric key is refused at load, naming the key", () => {
  for (const [text, key] of [
    ["sensitive_path: ['^a/']\n", "sensitive_path"],
    ["tiers: { light: { max_file: 3 } }\n", "max_file"],
    ["tiers: { medium: { max_files: 3 } }\n", "medium"],
    ["caps: { rejection: 2 }\n", "rejection"],
    ["caps: { spec_critic: { light: 1, default: 2, extra: 3 } }\n", "extra"],
    ["assignments: { standard: { tester: opus/high } }\n", "tester"],
    ["assignments: { epic: { planner: opus/high } }\n", "epic"],
    ["slicing: { enable: true }\n", "enable"],
    ["versoin: 1\n", "versoin"],
  ]) {
    assert.throws(() => a.loadRubric(DEFAULT, text), new RegExp(`Unrecognized key.*${key}`), key);
  }
});

test("the slicing thresholds are at least one", () => {
  assert.throws(() => a.loadRubric(DEFAULT, "slicing: { min_criteria: 0 }\n"), /min_criteria/);
  assert.throws(() => a.loadRubric(DEFAULT, "slicing: { min_files: -3 }\n"), /min_files/);
  assert.equal(a.loadRubric(DEFAULT, "slicing: { min_files: 1 }\n").slicing.min_files, 1);
});

test("a contract with no files or no criteria is refused", () => {
  const wrap = (body) =>
    `---\nslug: x\nrisk: low\n---\n# X\n\`\`\`yaml spec-contract\n${body}\n\`\`\`\n`;
  assert.throws(() => a.readSignals(wrap("{}"), rubric), /spec-contract/);
  assert.throws(
    () => a.readSignals(wrap("files: []\ncriteria:\n  - id: AC1"), rubric),
    /spec-contract/,
  );
  assert.throws(
    () => a.readSignals(wrap("files:\n  - path: src/a.ts\ncriteria: []"), rubric),
    /spec-contract/,
  );
});

test("a risk the rubric cannot read is reported as a fallback, not as a real medium", () => {
  const reasons = (front) =>
    a.tierFor(a.readSignals(full(front, FILES, CRITERIA), rubric), rubric).reasons;
  const typo = reasons("slug: x\ntype: feature\nrisk: hgih");
  assert.ok(typo.includes('risk "hgih" not recognised, treated as medium'), typo.join(" | "));
  assert.ok(!typo.includes("risk medium"));
  const missing = reasons("slug: x\ntype: feature");
  assert.ok(missing.includes("risk not set, treated as medium"), missing.join(" | "));
  const real = reasons("slug: x\ntype: feature\nrisk: medium");
  assert.ok(real.includes("risk medium"));
  assert.ok(!real.some((r) => /not recognised|not set/.test(r)));
  const many = Array.from({ length: 16 }, (_, i) => `  - path: src/f${i}.ts`).join("\n");
  const heavy = a.tierFor(
    a.readSignals(full("slug: x\ntype: feature\nrisk: hgih", many, CRITERIA), rubric),
    rubric,
  );
  assert.equal(heavy.tier, "heavy");
  assert.ok(heavy.reasons.includes('risk "hgih" not recognised, treated as medium'));
});

test("the end of the ladder is a HaltError, and a refused model is not", () => {
  assert.equal(typeof a.HaltError, "function");
  assert.ok(new a.HaltError("x") instanceof Error);
  assert.throws(() => a.assignmentFor("standard", "executor", 3, rubric), a.HaltError);
  const spent = a.loadRubric(DEFAULT, "escalation: [effort+1]\n");
  assert.throws(() => a.assignmentFor("standard", "executor", 2, spent), a.HaltError);
  const refused = structuredClone(rubric);
  refused.assignments.standard.executor = "fable/high";
  assert.throws(
    () => a.assignmentFor("standard", "executor", 0, refused),
    (e) =>
      e instanceof Error && !(e instanceof a.HaltError) && /Fable is not allowed/.test(e.message),
  );
  const rung = structuredClone(rubric);
  assert.throws(
    () => a.assignmentFor("standard", "executor", -1, rung),
    (e) => e instanceof Error && !(e instanceof a.HaltError),
  );
});

test("the approval preview shows the verifier after the floor", () => {
  const r = a.loadRubric(
    DEFAULT,
    "assignments: { standard: { executor: opus/high, verifier: sonnet/high } }\n",
  );
  assert.equal(a.previewAssignments(run("standard", "light"), r).verifier, "opus/high");
  const effort = a.loadRubric(
    DEFAULT,
    "assignments: { standard: { executor: sonnet/max, verifier: sonnet/high } }\n",
  );
  assert.equal(a.previewAssignments(run("standard", "light"), effort).verifier, "sonnet/max");
  assert.equal(a.previewAssignments(run("standard", "light"), rubric).verifier, "opus/high");
});

test("a spec with no front matter is read as a medium feature", () => {
  const text =
    "# X\n\n```yaml spec-contract\nfiles:\n  - path: src/a.ts\ncriteria:\n  - id: AC1\n```\n";
  const s = a.readSignals(text, rubric);
  assert.equal(s.risk, "medium");
  assert.equal(s.bugfix, false);
  assert.equal(s.files, 1);
});

test("the Fable guard holds for every role of a rubric that skipped the loader", () => {
  for (const role of ["planner", "test-author", "verifier", "retro"]) {
    const r = structuredClone(rubric);
    r.assignments.standard[role] = "fable/high";
    assert.throws(() => a.assignmentFor("standard", role, 0, r), /Fable is not allowed/, role);
  }
});

test("a bare severity key marks a spec as a bugfix", () => {
  const bare = a.readSignals(full("slug: x\nseverity: high", FILES, CRITERIA), rubric);
  assert.equal(bare.bugfix, true);
  assert.equal(bare.risk, "high");
  const typed = a.readSignals(full("slug: x\ntype: bugfix\nrisk: low", FILES, CRITERIA), rubric);
  assert.equal(typed.bugfix, true);
  assert.equal(a.readSignals(full("slug: x\nrisk: low", FILES, CRITERIA), rubric).bugfix, false);
});
