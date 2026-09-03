import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./_tsload.mjs";

/**
 * The metrics roll-up is a pure function (`src/lib/metrics-rollup.ts`,
 * ADR-0043): every input is handed in, nothing is read, and the terminal block
 * comes out. These tests pin the derivation table of the plan — one rule per
 * metric — against one fixture in which every source is present, then remove
 * each source in turn and assert that exactly its rows go null and its
 * `sources` entry flips. The anomaly notes (a negative interval, an unpaired
 * dispatch, a stamp that disagrees with its block) are asserted as text, since
 * the note is the only place the anomaly is allowed to show.
 */

const { rollUpMetrics } = await importTs("src/lib/metrics-rollup.ts");

const T = (hhmmss) => `2026-09-03T${hhmmss}.000Z`;
const SEAL1 = "aaaaaaaaaaaaaaaa";
const SEAL2 = "bbbbbbbbbbbbbbbb";

const progressEntry = (over) => ({
  slug: "demo",
  source: "task-start",
  step: "x",
  kind: "step",
  detail: "…",
  criterion: null,
  path: null,
  contract_sha: null,
  ...over,
});

const oracleRun = (over) => ({
  slug: "demo",
  contract_sha: SEAL2,
  criterion: "AC1",
  expect: "pass",
  status: "pass",
  command: "node --test",
  source: "oracle.run",
  code: 0,
  signal: null,
  test_file: "test/a.test.mjs",
  test_sha: "t1",
  head_sha: null,
  durationMs: 1800,
  ran_at: T("11:02:00"),
  ...over,
});

const run = (over) => ({
  slug: "demo",
  kind: "run",
  at: T("11:03:00"),
  verdict: "PASS",
  mode: "feature",
  execution: "parallel",
  only: null,
  gates: [{ name: "test", status: "pass", durationMs: 1000 }],
  wallClockMs: 1000,
  sumOfGatesMs: 1000,
  head_sha: null,
  ...over,
});

const gate = (over) => ({
  slug: "demo",
  kind: "gate",
  at: T("11:08:00"),
  decision: "ALLOW",
  verdict: "PASS",
  staleness: "fresh",
  allowStale: false,
  red_green: "unknown",
  artifact: ".marvin/task/runs/demo.md",
  ...over,
});

const ev = (over) => ({
  slug: "demo",
  source: "task-implement",
  step: "6F",
  contract_sha: SEAL2,
  at: T("11:00:00"),
  ...over,
});

const receipt = (critic, compliance, quality) => ({
  critic,
  subject: "demo",
  judged_at: T("10:21:00"),
  compliance,
  quality,
});

/** Every source present. The numbers below are what the assertions expect. */
function fullInputs() {
  return {
    slug: "demo",
    base_branch: "dev",
    now: T("12:00:00"),
    spec: {
      path: ".marvin/task/001-demo.md",
      frontmatter: {
        type: "feature",
        risk: "medium",
        breaking: "false",
        spike_required: "false",
        created: "2026-09-03",
        contract_sha: SEAL2,
      },
      contract: {
        files: [
          { id: "F1", path: "src/a.ts", action: "edit" },
          { id: "F2", path: "test/a.test.mjs", action: "new" },
          { id: "F3", path: "src/b.ts", action: "edit" },
        ],
        criteria: [
          {
            id: "AC1",
            statement: "a",
            implemented_by: ["F1"],
            oracle: { kind: "test", ref: "test/a.test.mjs::a" },
          },
          {
            id: "AC2",
            statement: "b",
            implemented_by: ["F3"],
            oracle: { kind: "command", ref: "npm run lint" },
          },
          { id: "AC3", statement: "c", implemented_by: ["F1"], oracle: { kind: "prose-review" } },
        ],
      },
      stamped_sha: SEAL2,
      actual_sha: SEAL2,
    },
    progress: [
      progressEntry({ step: "1.5", at: T("10:00:00"), path: ".marvin/task/001-demo.md" }),
      progressEntry({ step: "4F", kind: "decision", at: T("10:05:00") }),
      progressEntry({ step: "9F", at: T("10:12:03"), contract_sha: SEAL1 }),
      progressEntry({
        source: "task-implement",
        step: "2.5",
        at: T("11:00:00"),
        contract_sha: SEAL2,
      }),
      progressEntry({
        source: "task-implement",
        step: "5F",
        kind: "criterion",
        criterion: "AC1",
        at: T("11:00:30"),
      }),
      progressEntry({
        source: "task-implement",
        step: "5F",
        kind: "criterion",
        criterion: "AC2",
        at: T("11:01:54"),
      }),
    ],
    oracles: [
      oracleRun({ contract_sha: SEAL1, durationMs: 5000, ran_at: T("10:30:00") }), // superseded seal — excluded
      oracleRun({ criterion: "AC1", durationMs: 1800 }),
      oracleRun({
        criterion: "AC2",
        source: "config.test_one",
        durationMs: 900,
        ran_at: T("11:02:10"),
      }),
      oracleRun({
        criterion: "AC3",
        status: "not-run",
        command: null,
        source: null,
        reason: "prose-review-oracle",
        code: null,
        test_file: null,
        test_sha: null,
        durationMs: undefined,
        ran_at: T("11:02:20"),
      }),
    ],
    verify_journal: [
      run({ at: T("11:03:00"), verdict: "FAIL" }),
      run({ at: T("11:04:00"), only: ["test"] }), // a green TARGETED retry is not the first green full run
      run({ at: T("11:07:37") }), // the first green full run
      gate({ at: T("11:08:00"), decision: "BLOCK", staleness: "stale" }),
      gate({ at: T("11:09:00"), decision: "ALLOW", staleness: "stale", allowStale: true }),
    ],
    verify_result: {
      verdict: "PASS",
      gates: [
        { name: "test", status: "pass", durationMs: 52000 },
        { name: "lint", status: "not-run", durationMs: 0 },
        { name: "build", status: "pass", durationMs: 30000 },
      ],
      wallClockMs: 60000,
      sumOfGatesMs: 82000,
    },
    critique: {
      spec: receipt(
        "marvin-tm-spec-critic",
        { verdict: "PASS", blockers: 0, warnings: 1 },
        { verdict: "PASS WITH WARNINGS", blockers: 0, warnings: 3 },
      ),
      diff: null,
    },
    events: [
      ev({
        source: "task-start",
        step: "7F",
        kind: "gate-call",
        gate: "dor",
        call: 1,
        verdict: "FAIL",
        at: T("10:10:00"),
      }),
      ev({
        source: "task-start",
        step: "7F",
        kind: "gate-call",
        gate: "dor",
        call: 2,
        verdict: "PASS",
        at: T("10:11:00"),
      }),
      ev({
        source: "task-start",
        step: "8F",
        kind: "critic-dispatch",
        critic: "marvin-tm-spec-critic",
        pass: 1,
        at: T("10:11:10"),
      }),
      ev({
        source: "task-start",
        step: "8F",
        kind: "critic-verdict",
        critic: "marvin-tm-spec-critic",
        pass: 1,
        verdict: "BLOCK",
        blockers: 2,
        warnings: 1,
        at: T("10:16:10"),
      }),
      ev({
        source: "task-start",
        step: "8F",
        kind: "critic-dispatch",
        critic: "marvin-tm-spec-critic",
        pass: 2,
        at: T("10:17:00"),
      }),
      ev({
        source: "task-start",
        step: "8F",
        kind: "critic-verdict",
        critic: "marvin-tm-spec-critic",
        pass: 2,
        verdict: "PASS WITH WARNINGS",
        blockers: 0,
        warnings: 2,
        at: T("10:21:00"),
      }),
      ev({ step: "5F", kind: "spec-gap", detail: "where the fixture lives", at: T("11:00:45") }),
      ev({
        step: "fix-cycle",
        kind: "fix-round",
        loop: "verify-gate",
        round: 1,
        at: T("11:03:30"),
      }),
      ev({
        step: "fix-cycle",
        kind: "open-item",
        classification: "deferred",
        detail: "widget",
        at: T("11:05:00"),
      }),
      ev({ kind: "critic-dispatch", critic: "marvin-tm-diff-critic", pass: 1, at: T("11:08:00") }), // no verdict — excluded
    ],
    git: {
      head_sha: "abcdef0123456789abcdef0123456789abcdef01",
      changed_files: [
        "src/a.ts",
        "test/a.test.mjs",
        "README.md",
        ".marvin/metrics/001-demo.md", // marvin's own artifact — excluded
        ".marvin/task/001-demo.md", // the spec file — excluded
      ],
    },
  };
}

test("with every source present, every metric of the derivation table is derived", () => {
  const b = rollUpMetrics(fullInputs());

  assert.deepEqual(Object.values(b.sources), Array(8).fill("present"));
  assert.equal(b.slug, "demo");
  assert.equal(b.contract_sha, SEAL2);
  assert.equal(b.type, "feature");
  assert.equal(b.risk, "medium");
  assert.equal(b.breaking, false);
  assert.equal(b.spike_required, false);
  assert.equal(b.created, "2026-09-03");
  assert.equal(b.rolled_up_at, T("12:00:00"));
  assert.equal(b.head_sha, "abcdef0123456789abcdef0123456789abcdef01");
  assert.equal(b.base_branch, "dev");

  // time
  assert.equal(b.time.intake_ms, 723000, "T1: 10:00:00 → 10:12:03");
  assert.equal(b.time.implement_ms, 114000, "T2: 11:00:00 → 11:01:54");
  assert.equal(
    b.time.first_green_ms,
    343000,
    "T3: last criterion 11:01:54 → first green FULL run 11:07:37",
  );
  assert.equal(b.time.active_ms, 723000 + 114000 + 343000, "T4 = T1 + T2 + T3");
  assert.equal(b.time.gate_efficiency, 0.732, "T5: 60000 / 82000");
  assert.deepEqual(b.time.oracle_ms, [
    { criterion: "AC1", ms: 1800 },
    { criterion: "AC2", ms: 900 },
  ]);
  assert.deepEqual(b.time.gate_ms, [
    { gate: "test", ms: 52000 },
    { gate: "lint", ms: 0 },
    { gate: "build", ms: 30000 },
  ]);
  assert.deepEqual(b.time.critic_ms, {
    total: 300000 + 240000,
    dispatches: [
      { critic: "marvin-tm-spec-critic", pass: 1, ms: 300000 },
      { critic: "marvin-tm-spec-critic", pass: 2, ms: 240000 },
    ],
  });

  // quality
  assert.deepEqual(b.quality.scope_drift, { declared: 3, changed: 3, undeclared: ["README.md"] });
  assert.deepEqual(b.quality.oracle_strength, { criteria: 3, executable: 2, share: 0.667 });
  assert.equal(b.quality.red_green, null, "Q3 is a bugfix metric; a feature reports null");
  assert.deepEqual(b.quality.not_run, { gates: 3, not_run: 1, share: 0.333 });
  assert.equal(b.quality.freshness_waivers, 1, "one ALLOW over stale evidence via allowStale");
  assert.deepEqual(b.quality.critics, {
    spec: {
      compliance: { verdict: "PASS", blockers: 0, warnings: 1 },
      quality: { verdict: "PASS WITH WARNINGS", blockers: 0, warnings: 3 },
    },
    diff: null,
  });
  assert.equal(b.quality.spec_gaps, 1);
  assert.deepEqual(b.quality.open_items, { deferred: 1, blocked: 0 });
  assert.equal(b.quality.dor_first_call, false, "the first DoR call FAILed");
  assert.deepEqual(b.quality.oracle_resolution, {
    by_source: { "oracle.run": 1, "config.test_one": 1 },
    unresolved: 1,
  });

  // rework
  assert.equal(
    b.rework.seals,
    2,
    "SEAL1 at 9F and SEAL2 at 2.5 — distinct across the whole journal",
  );
  assert.equal(b.rework.reseals, 1);
  assert.deepEqual(b.rework.critic_passes, { spec: 2, diff: null });
  assert.deepEqual(b.rework.fix_rounds, { verify_gate: 1, critic: 0, red_green: 0 });
  assert.equal(
    b.rework.runs_before_green,
    2,
    "the FAIL and the targeted retry precede the first green full run",
  );

  // the one anomaly in the fixture: the diff critic was dispatched and never answered
  assert.deepEqual(b.notes, ["T8: 1 critic dispatch(es) without a recorded verdict — excluded"]);
});

/** For each source, the rows that go null when exactly that source is absent. */
const ABSENT_ROWS = {
  spec: (b) => {
    assert.equal(b.contract_sha, null);
    assert.equal(b.type, null);
    assert.equal(b.quality.scope_drift, null);
    assert.equal(b.quality.oracle_strength, null);
    assert.deepEqual(b.time.oracle_ms, [], "no seal to join the oracle journal on");
    assert.equal(b.quality.oracle_resolution, null);
  },
  progress: (b) => {
    assert.equal(b.time.intake_ms, null);
    assert.equal(b.time.implement_ms, null);
    assert.equal(b.time.first_green_ms, null, "T3 has no criterion to anchor on");
    assert.equal(b.time.active_ms, null);
    assert.equal(b.rework.seals, null);
    assert.equal(b.rework.reseals, null);
  },
  oracles: (b) => {
    assert.deepEqual(b.time.oracle_ms, []);
    assert.equal(b.quality.oracle_resolution, null);
  },
  verify_journal: (b) => {
    assert.equal(b.time.first_green_ms, null);
    assert.equal(b.time.active_ms, null);
    assert.equal(b.quality.freshness_waivers, null);
    assert.equal(b.rework.runs_before_green, null);
  },
  verify_result: (b) => {
    assert.equal(b.time.gate_efficiency, null);
    assert.deepEqual(b.time.gate_ms, []);
    assert.equal(b.quality.not_run, null);
  },
  critique: (b) => {
    assert.deepEqual(b.quality.critics, { spec: null, diff: null });
  },
  events: (b) => {
    assert.deepEqual(b.time.critic_ms, { total: null, dispatches: [] });
    assert.equal(
      b.quality.spec_gaps,
      null,
      "null, not zero: nothing recorded is not nothing to record",
    );
    assert.equal(b.quality.open_items, null);
    assert.equal(b.quality.dor_first_call, null);
    assert.deepEqual(b.rework.critic_passes, { spec: null, diff: null });
    assert.equal(b.rework.fix_rounds, null);
  },
  git: (b) => {
    assert.equal(b.head_sha, null);
    assert.equal(b.quality.scope_drift, null);
  },
};

for (const source of Object.keys(ABSENT_ROWS)) {
  test(`with ${source} absent, exactly its rows are null and sources.${source} flips`, () => {
    const full = rollUpMetrics(fullInputs());
    const b = rollUpMetrics({ ...fullInputs(), [source]: null });
    assert.equal(b.sources[source], "absent");
    for (const [k, v] of Object.entries(b.sources)) {
      if (k !== source) assert.equal(v, "present", `${k} stays present`);
    }
    ABSENT_ROWS[source](b);
    // Rows the source does not feed are untouched — the fixture's T5 and Q2/Q4
    // come from other files, so they survive every absence but their own.
    if (source !== "verify_result") assert.equal(b.time.gate_efficiency, full.time.gate_efficiency);
    if (source !== "spec")
      assert.deepEqual(b.quality.oracle_strength, full.quality.oracle_strength);
  });
}

test("T4 is null when any addend is null — a partial sum would read as a smaller task", () => {
  const noStart = fullInputs();
  noStart.progress = noStart.progress.filter((e) => e.step !== "1.5");
  const b = rollUpMetrics(noStart);
  assert.equal(b.time.intake_ms, null);
  assert.equal(b.time.implement_ms, 114000, "T2 is still measurable");
  assert.equal(b.time.first_green_ms, 343000, "so is T3");
  assert.equal(b.time.active_ms, null);
  assert.ok(
    b.notes.some((n) => /T1: the progress journal has no task-start step 1.5 entry/.test(n)),
  );
});

test("a negative T3 becomes null with a note, and R4 still counts", () => {
  const early = fullInputs();
  // the green full run precedes the last recorded criterion
  early.verify_journal = [run({ at: T("11:01:00") })];
  const b = rollUpMetrics(early);
  assert.equal(b.time.first_green_ms, null);
  assert.equal(b.time.active_ms, null);
  assert.equal(b.rework.runs_before_green, 0);
  assert.ok(
    b.notes.some((n) => /^T3: negative interval/.test(n)),
    JSON.stringify(b.notes),
  );
});

test("no green full run at all: T3 and R4 are null with one note, and a targeted green retry does not count", () => {
  const never = fullInputs();
  never.verify_journal = [run({ verdict: "FAIL" }), run({ only: ["test"], at: T("11:05:00") })];
  const b = rollUpMetrics(never);
  assert.equal(b.time.first_green_ms, null);
  assert.equal(b.rework.runs_before_green, null);
  assert.deepEqual(
    b.notes.filter((n) => n.startsWith("T3")),
    ["T3/R4: no green full verification run recorded"],
  );
});

test("T8 pairs by (critic, pass), measures a NEEDS_CONTEXT re-dispatch from the pass's first dispatch, and excludes strays with a note", () => {
  const i = fullInputs();
  i.events = [
    ev({ kind: "critic-dispatch", critic: "marvin-tm-diff-critic", pass: 1, at: T("11:08:00") }),
    // the NEEDS_CONTEXT re-dispatch reuses the pass number…
    ev({ kind: "critic-dispatch", critic: "marvin-tm-diff-critic", pass: 1, at: T("11:10:00") }),
    // …and the verdict closes the whole pass: 11:08 → 11:15 = 7 minutes, not 5
    ev({
      kind: "critic-verdict",
      critic: "marvin-tm-diff-critic",
      pass: 1,
      verdict: "PASS",
      blockers: 0,
      warnings: 0,
      at: T("11:15:00"),
    }),
    // a verdict with no dispatch at all
    ev({
      kind: "critic-verdict",
      critic: "marvin-tm-spec-critic",
      pass: 3,
      verdict: "PASS",
      blockers: 0,
      warnings: 0,
      at: T("11:16:00"),
    }),
    // a dispatch that was never answered
    ev({ kind: "critic-dispatch", critic: "marvin-tm-diff-critic", pass: 2, at: T("11:17:00") }),
  ];
  const b = rollUpMetrics(i);
  assert.deepEqual(b.time.critic_ms, {
    total: 420000,
    dispatches: [{ critic: "marvin-tm-diff-critic", pass: 1, ms: 420000 }],
  });
  assert.deepEqual(
    b.rework.critic_passes,
    { spec: 3, diff: 1 },
    "R2 reads the verdicts, paired or not",
  );
  assert.deepEqual(
    b.notes.filter((n) => n.startsWith("T8")),
    [
      "T8: 1 critic dispatch(es) without a recorded verdict — excluded",
      "T8: 1 critic verdict(s) without a recorded dispatch — excluded",
    ],
  );
});

test("R1 counts distinct seals across the WHOLE journal; one seal is zero reseals; none is zero seals", () => {
  const one = fullInputs();
  one.progress = one.progress.map((e) => ({ ...e, contract_sha: e.contract_sha ? SEAL2 : null }));
  assert.deepEqual((({ seals, reseals }) => ({ seals, reseals }))(rollUpMetrics(one).rework), {
    seals: 1,
    reseals: 0,
  });
  const none = fullInputs();
  none.progress = none.progress.map((e) => ({ ...e, contract_sha: null }));
  assert.deepEqual((({ seals, reseals }) => ({ seals, reseals }))(rollUpMetrics(none).rework), {
    seals: 0,
    reseals: 0,
  });
  // the fixture itself: SEAL1 recorded at 9F, SEAL2 at 2.5 — the reseal is visible only over the whole file
  assert.equal(rollUpMetrics(fullInputs()).rework.seals, 2);
});

test("Q1 lists the undeclared paths, excluding marvin's own artifacts and the spec file, and is null without a resolvable base", () => {
  const b = rollUpMetrics(fullInputs());
  assert.deepEqual(b.quality.scope_drift.undeclared, ["README.md"]);

  const noBase = fullInputs();
  noBase.git = { head_sha: "abc", changed_files: null };
  const nb = rollUpMetrics(noBase);
  assert.equal(nb.quality.scope_drift, null);
  assert.equal(nb.head_sha, "abc", "the head is still known");
  assert.equal(nb.sources.git, "present");
});

test("a stamp that disagrees with its block joins the oracle journal against nothing, and says so", () => {
  const tampered = fullInputs();
  tampered.spec.actual_sha = "cccccccccccccccc";
  const b = rollUpMetrics(tampered);
  assert.equal(b.contract_sha, SEAL2, "the stamped seal is reported as identity…");
  assert.deepEqual(b.time.oracle_ms, [], "…but nothing is joined on it");
  assert.equal(b.quality.oracle_resolution, null);
  assert.ok(
    b.notes.some((n) => /edited since it was sealed/.test(n)),
    JSON.stringify(b.notes),
  );
  // the contract itself still counts: oracle strength is a property of the block on disk
  assert.deepEqual(b.quality.oracle_strength, { criteria: 3, executable: 2, share: 0.667 });
});

test("Q3 red-green completeness is derived for a bugfix from a red then green pair at the current seal", () => {
  const bug = fullInputs();
  bug.spec.frontmatter.type = "bugfix";
  bug.spec.contract.criteria = [
    {
      id: "AC1",
      statement: "regression",
      implemented_by: ["F2"],
      oracle: { kind: "test", ref: "test/a.test.mjs::a" },
      regression: true,
    },
    {
      id: "AC2",
      statement: "b",
      implemented_by: ["F3"],
      oracle: { kind: "command", ref: "npm run lint" },
    },
  ];
  bug.oracles = [
    oracleRun({
      criterion: "AC1",
      expect: "fail",
      status: "fail",
      code: 1,
      test_sha: "t1",
      ran_at: T("11:00:10"),
    }),
    oracleRun({
      criterion: "AC1",
      expect: "pass",
      status: "pass",
      code: 0,
      test_sha: "t1",
      ran_at: T("11:01:00"),
    }),
    oracleRun({
      criterion: "AC2",
      expect: "pass",
      status: "pass",
      code: 0,
      test_sha: "t2",
      ran_at: T("11:01:30"),
    }),
  ];
  const b = rollUpMetrics(bug);
  assert.equal(b.type, "bugfix");
  assert.deepEqual(b.quality.red_green, { criteria: 2, proven: 1, share: 0.5 });

  // the same pair under a superseded seal proves nothing about the contract in force
  bug.oracles = bug.oracles.map((r) => ({ ...r, contract_sha: SEAL1 }));
  assert.deepEqual(rollUpMetrics(bug).quality.red_green, { criteria: 2, proven: 0, share: 0 });
});
