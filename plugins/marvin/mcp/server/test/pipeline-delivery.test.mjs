// The engine's own delivery gate (ADR-0059): `runDeliveryGate` writes the engine's gate report
// as the spec's per-spec run, calls the `verify` tool's gate function with the autopilot's
// red→green rule, and appends the terminal metrics block once per delivery.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";

const { runDeliveryGate, rolledUpFor, verificationFromGate } = await importTs(
  "src/pipeline/delivery.ts",
);
const { recordOracleRun } = await importTs("src/storage/oracles.ts");
const { journalSealReds, journalGateGreens } = await importTs("src/pipeline/proof-journal.ts");
const { readOracleRuns } = await importTs("src/storage/oracles.ts");
const { findRecord, readRecord } = await importTs("src/storage/metrics.ts");
const { loadConfig } = await importTs("src/storage/config.ts");
const { performRollup } = await importTs("src/lib/metrics-record.ts");
const { loadEnv } = await importTs("src/lib/env.ts");
const { parseVerifyBlock } = await importTs("src/lib/reports.ts");

const SLUG = "demo-bug";
const BLOCK = [
  "files:",
  "  - id: F1",
  "    path: impl.txt",
  "    action: edit",
  "    satisfies: [AC1]",
  "criteria:",
  "  - id: AC1",
  "    statement: the bug does not recur",
  "    implemented_by: [F1]",
  "    regression: true",
  "    oracle:",
  "      kind: test",
  "      ref: regress.test.sh::the bug does not recur",
  "      run: sh regress.test.sh",
].join("\n");
const SEAL = createHash("sha256").update(BLOCK.trim()).digest("hex").slice(0, 16);

const REPORT = {
  passed: true,
  gates: [
    { name: "test", result: "pass", ms: 12, tail: "" },
    { name: "oracle:AC1", result: "pass", ms: 3, tail: "" },
  ],
  undeclared: [],
  protected: [],
  protectedSources: {},
  protectedPatterns: [],
  checks: [],
  sealed: [],
  blockers: [],
};

/** A worktree on `dev` holding a sealed bugfix spec and its code, committed. */
function worktree() {
  const dir = mkdtempSync(join(tmpdir(), "marvin-delivery-"));
  const g = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  g("init", "-q");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "Test");
  g("checkout", "-q", "-b", "dev");
  mkdirSync(join(dir, ".marvin", "task"), { recursive: true });
  writeFileSync(join(dir, ".marvin", "config.json"), JSON.stringify({ base_branch: "dev" }));
  writeFileSync(
    join(dir, ".marvin", "task", `001-${SLUG}.md`),
    [
      "---",
      `slug: ${SLUG}`,
      "type: bugfix",
      "status: in-progress",
      `contract_sha: ${SEAL}`,
      "---",
      "",
      `# ${SLUG}`,
      "",
      "```yaml spec-contract",
      BLOCK,
      "```",
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "regress.test.sh"), "grep -q fixed impl.txt\n");
  writeFileSync(join(dir, "impl.txt"), "fixed\n");
  g("add", "-A");
  g("commit", "-q", "-m", "the fix");
  const config = loadConfig(join(dir, ".marvin", "config.json")).config;
  return { dir, g, config, head: () => g("rev-parse", "HEAD") };
}

/** A red and then a green for AC1 at the sealed contract, as `verify action: "oracles"` records them. */
function provenPair(dir) {
  const runsDir = join(dir, ".marvin", "task", "runs");
  const base = {
    slug: SLUG,
    contract_sha: SEAL,
    criterion: "AC1",
    command: "sh regress.test.sh",
    source: "oracle.run",
    signal: null,
    test_file: "regress.test.sh",
    test_sha: "a".repeat(64),
    head_sha: null,
  };
  recordOracleRun(runsDir, {
    ...base,
    expect: "fail",
    status: "fail",
    code: 1,
    outcome: "failed",
    marks: [],
    runner: "pytest",
    ran_at: "2026-11-01T10:00:00.000Z",
  });
  recordOracleRun(runsDir, {
    ...base,
    expect: "pass",
    status: "pass",
    code: 0,
    ran_at: "2026-11-01T10:05:00.000Z",
  });
}

const terminalBlocks = (dir) => {
  const path = findRecord(join(dir, ".marvin", "metrics"), SLUG);
  return path ? readRecord(path).terminal : [];
};

const deliver = (w, executorSince = null) =>
  runDeliveryGate({
    worktree: w.dir,
    slug: SLUG,
    config: w.config,
    report: REPORT,
    head: w.head(),
    executorSince,
  });

test("ADR-0059: an ALLOW on a proven pair appends exactly one terminal block, and a replay none", () => {
  const w = worktree();
  try {
    provenPair(w.dir);
    const first = deliver(w);
    assert.equal(first.decision, "ALLOW", first.reason);
    assert.equal(first.alreadyRolledUp, false);
    assert.match(first.metricsNote ?? "", /\.marvin\/metrics\//);
    const blocks = terminalBlocks(w.dir);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].head_sha, w.head(), "the block names the delivered commit");

    // The engine's run is what the gate judged: its own verdict, fresh for this tree.
    const run = readFileSync(join(w.dir, ".marvin", "task", "runs", `${SLUG}.md`), "utf8");
    const parsed = parseVerifyBlock(run);
    assert.equal(parsed.kind, "ok");
    assert.equal(parsed.result.verdict, "PASS");
    assert.equal(parsed.result.provenance.head_sha, w.head());

    const replay = deliver(w);
    assert.equal(replay.decision, "ALLOW");
    assert.equal(replay.alreadyRolledUp, true);
    assert.equal(replay.metricsNote, null);
    assert.equal(terminalBlocks(w.dir).length, 1, "a replayed step appends nothing");
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("ADR-0059: no recorded red→green pair BLOCKs under the autopilot rule and writes no block", () => {
  const w = worktree();
  const saved = process.env.MARVIN_PIPELINE;
  delete process.env.MARVIN_PIPELINE; // the rule is the engine's argument, not its environment
  try {
    const blocked = deliver(w);
    assert.equal(blocked.decision, "BLOCK");
    assert.match(blocked.reason, /red→green/);
    assert.match(blocked.reason, /AC1/);
    assert.equal(terminalBlocks(w.dir).length, 0, "a refused delivery is not counted as delivered");
  } finally {
    if (saved !== undefined) process.env.MARVIN_PIPELINE = saved;
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("ADR-0059: the executor's own gate call before its last commit is this delivery's block", () => {
  const w = worktree();
  try {
    provenPair(w.dir);
    const since = new Date(Date.now() - 60_000).toISOString();
    // task-deliver calls the gate, then commits: the executor's block names the parent commit.
    performRollup({
      env: loadEnv({ CLAUDE_PROJECT_DIR: w.dir }),
      projectRoot: w.dir,
      config: w.config,
      slug: SLUG,
    });
    const executorHead = w.head();
    writeFileSync(join(w.dir, "impl.txt"), "fixed\nand tidied\n");
    w.g("commit", "-q", "-am", "the delivery commit");
    assert.notEqual(w.head(), executorHead);
    assert.equal(terminalBlocks(w.dir).length, 1);

    const result = deliver(w, since);
    assert.equal(result.decision, "ALLOW", result.reason);
    assert.equal(result.alreadyRolledUp, true);
    assert.equal(terminalBlocks(w.dir).length, 1, "not duplicated");

    // A block an EARLIER executor wrote is older than the current one's start: a fresh one goes in.
    const later = new Date(Date.now() + 60_000).toISOString();
    assert.equal(rolledUpFor(w.dir, SLUG, w.head(), later), false);
    const fresh = deliver(w, later);
    assert.equal(fresh.alreadyRolledUp, false);
    const blocks = terminalBlocks(w.dir);
    assert.equal(blocks.length, 2);
    assert.equal(blocks.at(-1).head_sha, w.head());
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("ADR-0059: the engine's run carries its gate stage's warnings, and a failed stage is a FAIL", () => {
  const warned = verificationFromGate(
    {
      ...REPORT,
      gates: [
        { name: "test", result: "inherited", ms: 1, tail: "" },
        { name: "lint", result: "flaky", ms: 1, tail: "" },
        { name: "build", result: "not-run", ms: 0, tail: "" },
      ],
    },
    null,
    "/w/.marvin/task/runs/x.md",
  );
  const parsed = parseVerifyBlock(warned).result;
  assert.equal(parsed.verdict, "PASS WITH WARNINGS");
  assert.deepEqual(
    parsed.gates.map((g) => [g.name, g.status]),
    [
      ["test", "inherited"],
      ["lint", "pass"],
      ["build", "not-run"],
    ],
  );
  assert.ok(parsed.warnings.some((x) => x.startsWith("gate not run: build")));
  const failed = verificationFromGate({ ...REPORT, passed: false }, null, "/w/x.md");
  assert.equal(parseVerifyBlock(failed).result.verdict, "FAIL");
});

// ---------------------------------------------------------- the engine's own proof (ADR-0059)

const NODE_RED = [
  "✖ AC1: the bug does not recur (0.3ms)",
  "ℹ tests 1",
  "ℹ pass 0",
  "ℹ fail 1",
  "ℹ cancelled 0",
  "",
  "✖ failing tests:",
  "  AssertionError [ERR_ASSERTION]: expected fixed",
].join("\n");
const NODE_DID_NOT_RUN = [
  "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'impl.mjs'",
  "✖ regress.test.sh (20ms)",
  "ℹ tests 1",
  "ℹ pass 0",
  "ℹ fail 1",
  "",
  "✖ failing tests:",
  "  'test failed'",
].join("\n");

/** The sealed file as the seal records it: the bytes of `regress.test.sh` at the gated commit. */
const sealedFile = (dir) => ({
  path: "regress.test.sh",
  criteria: ["AC1"],
  sha256: createHash("sha256")
    .update(readFileSync(join(dir, "regress.test.sh")))
    .digest("hex"),
});

const proofOf = (w) => ({ worktree: w.dir, slug: SLUG, contractSha: SEAL });

const engineProof = (w, output) => {
  const file = sealedFile(w.dir);
  journalSealReds(
    proofOf(w),
    [{ ...file, command: "sh regress.test.sh", code: 1, output, ms: 4 }],
    w.head(),
  );
  journalGateGreens(
    proofOf(w),
    { ...REPORT, sealed: [{ path: file.path, ok: true }] },
    [file],
    [{ criterion: "AC1", command: "sh regress.test.sh", reason: null }],
    w.head(),
  );
};

test("ADR-0059: the seal's red and the gate's green, both the engine's, prove the pair and ALLOW", () => {
  const w = worktree();
  try {
    engineProof(w, NODE_RED);
    const runs = readOracleRuns(join(w.dir, ".marvin", "task", "runs"), SLUG);
    assert.deepEqual(
      runs.map((r) => [r.source, r.expect, r.outcome, r.contract_sha]),
      [
        ["engine seal", "fail", "failed", SEAL],
        ["engine gate", "pass", "passed", SEAL],
      ],
    );
    assert.equal(runs[0].test_sha, runs[1].test_sha, "one sealed file, one hash");
    const allowed = deliver(w);
    assert.equal(allowed.decision, "ALLOW", allowed.reason);
    assert.equal(terminalBlocks(w.dir).length, 1);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test("ADR-0059: a seal run that did not run for the right reason is journalled as such and still BLOCKs", () => {
  for (const output of [NODE_DID_NOT_RUN, "exit 1 from a runner marvin cannot read"]) {
    const w = worktree();
    try {
      engineProof(w, output);
      const [red] = readOracleRuns(join(w.dir, ".marvin", "task", "runs"), SLUG);
      assert.notEqual(red.outcome, "failed", output);
      const blocked = deliver(w);
      assert.equal(blocked.decision, "BLOCK", output);
      assert.match(blocked.reason, /AC1/);
      assert.equal(terminalBlocks(w.dir).length, 0);
    } finally {
      rmSync(w.dir, { recursive: true, force: true });
    }
  }
});

test("ADR-0059: the gate journals no green for a stage that failed or a sealed file that moved", () => {
  const w = worktree();
  try {
    const file = sealedFile(w.dir);
    const oracles = [{ criterion: "AC1", command: "sh regress.test.sh", reason: null }];
    const at = (report) => journalGateGreens(proofOf(w), report, [file], oracles, w.head());
    assert.deepEqual(at({ ...REPORT, passed: false, sealed: [{ path: file.path, ok: true }] }), []);
    assert.deepEqual(at({ ...REPORT, sealed: [{ path: file.path, ok: false }] }), []);
    const failedOracle = {
      ...REPORT,
      gates: [{ name: "oracle:AC1", result: "fail", ms: 1, tail: "" }],
      sealed: [{ path: file.path, ok: true }],
    };
    assert.deepEqual(at(failedOracle), []);
    assert.equal(readOracleRuns(join(w.dir, ".marvin", "task", "runs"), SLUG).length, 0);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});
