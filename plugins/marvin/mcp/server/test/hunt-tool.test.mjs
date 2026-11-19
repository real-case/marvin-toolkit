import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";
import { claim, huntEnv, huntRepo, textOf } from "./_hunt-fixture.mjs";

/**
 * The `hunt` tool (ADR-0053/0054) driven through its handler against a real git repository:
 * one run from init to finalize, the verification protocol's refusals, and the state-version
 * refusal. The pure halves have their own files (hunt-ledger, hunt-scope).
 */

const { buildHuntTool, HUNT_ACTIONS } = await importTs("src/tools/hunt.ts");

const withRepo = (fn) => async () => {
  const repo = huntRepo();
  try {
    await fn(repo, buildHuntTool(huntEnv(repo.root)), huntEnv(repo.root));
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
};

const ledgerLines = (env) =>
  readFileSync(join(env.huntDir, "findings.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

test("the tool is named hunt and its input is strict", () => {
  const tool = buildHuntTool({
    projectDir: "/nope",
    configPath: "/nope/c.json",
    huntDir: "/nope/h",
  });
  assert.equal(tool.name, "hunt");
  assert.equal(tool.meta, undefined, "text-only: no widget bound");
  assert.ok(HUNT_ACTIONS.includes("record") && HUNT_ACTIONS.includes("verdict"));
  const bad = tool.inputSchema.safeParse({ action: "status", snapshot: true });
  assert.equal(bad.success, false, "an unknown key is refused, not ignored");
});

test(
  "init writes the hunt key, keeps foreign keys and creates the state directory",
  withRepo(async ({ root }, tool, env) => {
    mkdirSync(join(root, ".marvin"), { recursive: true });
    writeFileSync(env.configPath, JSON.stringify({ base_branch: "dev", statuses: [] }));
    const r = await tool.handler({ action: "init", config: { budgets: { max_rounds: 2 } } });
    assert.notEqual(r.isError, true, textOf(r));
    const cfg = JSON.parse(readFileSync(env.configPath, "utf8"));
    assert.equal(cfg.base_branch, "dev");
    assert.deepEqual(cfg.statuses, []);
    assert.equal(cfg.hunt.budgets.max_rounds, 2);
    assert.equal(cfg.hunt.budgets.max_minutes, 30, "defaults fill the rest");
    assert.equal(cfg.hunt.authority.mode, "detect-only");
    assert.match(readFileSync(join(env.huntDir, ".gitignore"), "utf8"), /^runs\/$/m);

    const invalid = await tool.handler({ action: "init", config: { budgets: { max_rounds: 0 } } });
    assert.equal(invalid.isError, true);
    assert.equal(
      JSON.parse(readFileSync(env.configPath, "utf8")).hunt.budgets.max_rounds,
      2,
      "nothing written",
    );
  }),
);

test(
  "a run: preflight, hotspots, record, verdicts, finalize, report",
  withRepo(async (_repo, tool, env) => {
    const pre = await tool.handler({ action: "preflight", check: "code" });
    assert.notEqual(pre.isError, true, textOf(pre));
    const runId = pre.structuredContent.run_id;
    assert.match(runId, /^\d{8}-\d{6}-code$/);
    assert.deepEqual(
      pre.structuredContent.run.scope.files,
      ["src/auth/session.ts", "src/util/format.ts"],
      "tests and docs are excluded",
    );

    const hs = await tool.handler({ action: "hotspots", run_id: runId });
    assert.notEqual(hs.isError, true, textOf(hs));
    const ranked = hs.structuredContent.hotspots;
    assert.equal(
      ranked[0].path,
      "src/auth/session.ts",
      "churn, a fix commit and a risk term rank it first",
    );
    assert.equal(ranked.find((h) => h.path === "src/util/format.ts").signals.has_test, true);

    const rec = await tool.handler({ action: "record", run_id: runId, findings: [claim()] });
    assert.notEqual(rec.isError, true, textOf(rec));
    const [first] = rec.structuredContent.results;
    assert.equal(first.outcome, "new");
    assert.match(first.id, /^BH-\d{4}-0001$/);

    const again = await tool.handler({
      action: "record",
      run_id: runId,
      findings: [claim({ summary: "reworded" })],
    });
    assert.equal(
      again.structuredContent.results[0].outcome,
      "duplicate",
      "same fingerprint, not a new finding",
    );

    const self = await tool.handler({
      action: "verdict",
      id: first.id,
      verdict: {
        stage: "skeptic",
        ruling: "dismissed",
        by: "marvin-hunt-hunter",
        reasoning: "mine",
      },
    });
    assert.equal(self.isError, true, "VER-01: the producer cannot rule");

    const ref = await tool.handler({
      action: "verdict",
      id: first.id,
      verdict: {
        stage: "referee",
        ruling: "upheld",
        by: "marvin-hunt-referee",
        reasoning: "path is feasible",
      },
    });
    assert.equal(ref.structuredContent.status, "candidate", "a bug waits for a reproducing test");

    const red = await tool.handler({
      action: "verdict",
      id: first.id,
      run_id: runId,
      verdict: {
        stage: "prove",
        ruling: "red",
        by: "hunt-code",
        reasoning: "fails on '   '",
        failure_kind: "real-defect",
      },
    });
    assert.equal(red.structuredContent.status, "confirmed");

    await tool.handler({ action: "checkpoint", run_id: runId, step: "hunt", batch: 1 });
    const fin = await tool.handler({ action: "finalize", run_id: runId });
    assert.notEqual(fin.isError, true, textOf(fin));
    const report = readFileSync(join(env.huntDir, "reports", "latest.md"), "utf8");
    assert.match(report, new RegExp(first.id));
    assert.ok(existsSync(join(env.huntDir, "reports", `${runId}.md`)));
    const coverage = JSON.parse(readFileSync(join(env.huntDir, "coverage.json"), "utf8"));
    assert.deepEqual(
      coverage.files.map((f) => f.path),
      ranked
        .filter((h) => h.batch === 1)
        .map((h) => h.path)
        .sort(),
    );

    const closed = await tool.handler({ action: "record", run_id: runId, findings: [claim()] });
    assert.equal(closed.isError, true, "a finished run takes no more claims");

    const st = await tool.handler({ action: "status" });
    assert.equal(st.structuredContent.open, 1);
    assert.equal(st.structuredContent.by_status.confirmed, 1);

    const kinds = ledgerLines(env).map((l) => l.type);
    assert.deepEqual(
      kinds,
      ["finding", "seen", "verdict", "verdict", "status"],
      "append-only events",
    );
  }),
);

test(
  "the protocol refuses a red without a reproduction and a rule-class confirmation without evidence",
  withRepo(async (_repo, tool) => {
    const runId = (await tool.handler({ action: "preflight" })).structuredContent.run_id;
    const rec = await tool.handler({
      action: "record",
      run_id: runId,
      findings: [
        claim({ reproduction: { steps: ["read it"] } }),
        claim({
          class: "a11y",
          category: "UX-A11Y",
          title: "icon button has no name",
          check: "ux",
        }),
      ],
    });
    const [bug, a11y] = rec.structuredContent.results.map((x) => x.id);
    const red = await tool.handler({
      action: "verdict",
      id: bug,
      verdict: {
        stage: "prove",
        ruling: "red",
        by: "hunt-code",
        reasoning: "x",
        failure_kind: "real-defect",
      },
    });
    assert.equal(red.isError, true);
    assert.match(textOf(red), /VER-03/);

    // The ruling may carry the test it ran; the fold writes it onto the finding.
    const withTest = await tool.handler({
      action: "verdict",
      id: bug,
      verdict: {
        stage: "prove",
        ruling: "red",
        by: "hunt-code",
        reasoning: "x",
        failure_kind: "test-drift",
        test_path: "src/auth/session.bh.test.ts",
      },
    });
    assert.equal(withTest.structuredContent.status, "candidate", "test-drift does not confirm");

    const drift = await tool.handler({
      action: "verdict",
      id: bug,
      verdict: { stage: "prove", ruling: "green", by: "hunt-code", reasoning: "passes" },
    });
    assert.equal(
      drift.structuredContent.status,
      "rejected",
      "a passing reproduction invalidates the hypothesis",
    );

    const up = await tool.handler({
      action: "verdict",
      id: a11y,
      verdict: { stage: "referee", ruling: "upheld", by: "marvin-hunt-referee", reasoning: "x" },
    });
    assert.equal(up.isError, true);
    assert.match(textOf(up), /VER-07/);

    const fixed = await tool.handler({
      action: "set-status",
      id: a11y,
      status: "fixed",
      reason: "done",
    });
    assert.equal(fixed.isError, true, "a candidate cannot be marked fixed");
    const conf = await tool.handler({
      action: "set-status",
      id: a11y,
      status: "confirmed",
      reason: "x",
    });
    assert.equal(conf.isError, true, "confirmed comes only from a verdict");
  }),
);

test(
  "a human-closed finding is suppressed and a fixed one regresses when seen again",
  withRepo(async (_repo, tool) => {
    const r1 = (await tool.handler({ action: "preflight" })).structuredContent.run_id;
    const rec = await tool.handler({
      action: "record",
      run_id: r1,
      findings: [
        claim(),
        claim({
          title: "format pads negatives wrongly",
          location: { files: [{ path: "src/util/format.ts" }] },
        }),
      ],
    });
    const [a, b] = rec.structuredContent.results.map((x) => x.id);
    await tool.handler({
      action: "verdict",
      id: a,
      verdict: { stage: "human", ruling: "wont-fix", by: "maintainer", reasoning: "legacy" },
    });
    await tool.handler({
      action: "verdict",
      id: b,
      verdict: { stage: "human", ruling: "confirm", by: "maintainer", reasoning: "yes" },
    });
    await tool.handler({ action: "set-status", id: b, status: "fixed", reason: "patched" });
    await tool.handler({ action: "finalize", run_id: r1 });

    await new Promise((res) => setTimeout(res, 1100));
    const r2 = (await tool.handler({ action: "preflight" })).structuredContent.run_id;
    const again = await tool.handler({
      action: "record",
      run_id: r2,
      findings: [
        claim(),
        claim({
          title: "format pads negatives wrongly",
          location: { files: [{ path: "src/util/format.ts" }] },
        }),
      ],
    });
    assert.deepEqual(
      again.structuredContent.results.map((x) => x.outcome),
      ["suppressed", "regressed"],
    );
    const tri = await tool.handler({ action: "triage" });
    assert.deepEqual(tri.structuredContent.open, [b]);
  }),
);

test(
  "flows: a map with a dangling reference is refused; pinned entries survive regeneration",
  withRepo(async (_repo, tool, env) => {
    const node = (id, pinned = false) => ({
      id,
      route: `/${id}`,
      provenance: "code",
      confidence: "high",
      pinned,
    });
    const bad = await tool.handler({
      action: "flows",
      flows: {
        version: 1,
        nodes: [node("home")],
        transitions: [
          {
            id: "t1",
            from: "home",
            to: "nowhere",
            action: "click",
            provenance: "code",
            confidence: "high",
          },
        ],
        journeys: [],
        anomalies: [],
      },
    });
    assert.equal(bad.isError, true, textOf(bad));
    assert.match(textOf(bad), /"nowhere" is not a node/);
    assert.equal(existsSync(join(env.huntDir, "flows.json")), false);

    const first = await tool.handler({
      action: "flows",
      flows: {
        version: 1,
        nodes: [node("home"), node("admin", true)],
        transitions: [],
        journeys: [],
        anomalies: [],
      },
    });
    assert.notEqual(first.isError, true, textOf(first));
    const second = await tool.handler({
      action: "flows",
      flows: {
        version: 1,
        nodes: [node("home"), node("login")],
        transitions: [],
        journeys: [],
        anomalies: [],
      },
    });
    assert.notEqual(second.isError, true, textOf(second));
    const map = JSON.parse(readFileSync(join(env.huntDir, "flows.json"), "utf8"));
    assert.deepEqual(
      map.nodes.map((n) => n.id),
      ["admin", "home", "login"],
      "the pinned admin node is kept",
    );
    assert.deepEqual(second.structuredContent.diff.nodes, { added: ["login"], removed: [] });
  }),
);

test(
  "a ledger written by a newer marvin is refused, not misread",
  withRepo(async (_repo, tool, env) => {
    mkdirSync(env.huntDir, { recursive: true });
    writeFileSync(
      join(env.huntDir, "findings.jsonl"),
      `${JSON.stringify({ v: 2, type: "finding" })}\n`,
    );
    const r = await tool.handler({ action: "status" });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /newer marvin/);
  }),
);

test("preflight outside a git repository fails with a reason", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "marvin-hunt-nogit-"));
  try {
    const r = await buildHuntTool(huntEnv(dir)).handler({ action: "preflight" });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /git repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
