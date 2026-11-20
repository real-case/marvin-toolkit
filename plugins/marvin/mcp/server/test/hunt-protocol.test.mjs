import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";
import {
  NO_ELICIT,
  claim,
  elicitingServer,
  huntEnv,
  huntRepo,
  textOf,
  writeRepoFile,
} from "./_hunt-fixture.mjs";

/**
 * The guarantees ADR-0053/0054 make about who may change a finding and how the ledger survives
 * a merge: rulings that arrive after a person closed a finding, the set-status transition table,
 * human attestation, two branches' ledgers merged by git, and a `since` scope with a deletion.
 */

const L = await importTs("src/lib/hunt-ledger.ts");
const S = await importTs("src/lib/hunt-scope.ts");
const { buildHuntTool } = await importTs("src/tools/hunt.ts");
const { FindingClaim } = await import("@marvin-toolkit/mcp-shared/contracts");

const ctx = { runId: "20261119-120000-code", headSha: "abc", now: "2026-11-19T12:00:00.000Z" };
const at = ctx.now;
const verdict = (stage, ruling, extra = {}) => ({
  stage,
  ruling,
  by: stage === "human" ? "maintainer" : stage === "prove" ? "hunt-code" : `marvin-hunt-${stage}`,
  reasoning: "r",
  at,
  ...extra,
});

/** Record one claim and apply rulings in order through planVerdict, refusing on a refusal. */
function ruled(rulings, over = {}) {
  const rec = L.planRecord(L.foldLedger([]), [FindingClaim.parse(claim(over))], ctx);
  let lines = rec.lines;
  const id = rec.results[0].id;
  const plans = [];
  for (const v of rulings) {
    const f = L.foldLedger(lines).findings.get(id);
    const plan = L.planVerdict(f, v, at);
    plans.push(plan);
    if (plan.ok) lines = [...lines, ...plan.lines];
  }
  return { id, lines, plans, finding: L.foldLedger(lines).findings.get(id) };
}

// ── rulings after a human closure ────────────────────────────────────────

test("an agent's ruling after a person's wont-fix is recorded and changes nothing", () => {
  const { finding, plans } = ruled([
    verdict("human", "wont-fix"),
    verdict("referee", "dismissed"),
    verdict("referee", "upheld"),
  ]);
  assert.equal(finding.status, "wont-fix");
  assert.equal(finding.verdicts.length, 3, "every ruling is kept as evidence");
  assert.match(plans[1].note, /person already ruled/);
});

test("a green test after a person's confirm does not reject the finding", () => {
  const { finding } = ruled([
    verdict("human", "confirm"),
    verdict("referee", "upheld"),
    verdict("prove", "green"),
  ]);
  assert.equal(finding.status, "confirmed");
});

test("a confirmed finding is not reopened by a later referee dismissal", () => {
  const { finding } = ruled([
    verdict("referee", "upheld"),
    verdict("prove", "red", { failure_kind: "real-defect", test_path: "t.test.ts" }),
    verdict("referee", "dismissed", { by: "marvin-hunt-referee-2" }),
  ]);
  assert.equal(finding.status, "confirmed");
});

test("a person can still overrule an agent's rejection", () => {
  const { finding } = ruled([verdict("referee", "dismissed"), verdict("human", "confirm")]);
  assert.equal(finding.status, "confirmed");
});

test("prove is refused before a referee upheld the claim", () => {
  const { plans } = ruled([
    verdict("prove", "red", { failure_kind: "real-defect", test_path: "t.test.ts" }),
  ]);
  assert.equal(plans[0].ok, false);
  assert.match(plans[0].reason, /referee/);
});

test("a producer cannot claim confidence confirmed", () => {
  assert.equal(FindingClaim.safeParse(claim({ confidence: "confirmed" })).success, false);
});

// ── suppression ──────────────────────────────────────────────────────────

test("only a person's closure suppresses a sighting; an agent's rejection is seen again", () => {
  const byAgent = ruled([verdict("referee", "dismissed")]);
  const seen = L.planRecord(L.foldLedger(byAgent.lines), [FindingClaim.parse(claim())], ctx);
  assert.equal(seen.results[0].outcome, "duplicate");
  assert.match(seen.results[0].note, /reopen/);
  assert.equal(seen.lines[0].type, "seen");

  const byHuman = ruled([verdict("human", "reject")]);
  const again = L.planRecord(L.foldLedger(byHuman.lines), [FindingClaim.parse(claim())], ctx);
  assert.equal(again.results[0].outcome, "suppressed");
  assert.equal(again.lines.length, 0);
});

// ── set-status transitions ───────────────────────────────────────────────

test("set-status follows the transition table", () => {
  const f = (status) => ({ id: "BH-00000001", status });
  const cases = [
    ["rejected", "deferred", false],
    ["rejected", "fixed", false],
    ["wont-fix", "suspected", false],
    ["wont-fix", "ticketed", false],
    ["fixed", "deferred", false],
    ["confirmed", "suspected", false],
    ["candidate", "ticketed", false],
    ["confirmed", "ticketed", true],
    ["regressed", "ticketed", true],
    ["candidate", "suspected", true],
    ["flaky", "suspected", true],
    ["confirmed", "deferred", true],
    ["confirmed", "fixed", true],
    ["candidate", "fixed", true],
    ["deferred", "fixed", true],
  ];
  for (const [from, to, ok] of cases) {
    assert.equal(L.planSetStatus(f(from), to).ok, ok, `${from} → ${to}`);
  }
});

test(
  "the tool refuses set-status on a finding a person rejected",
  withRepo(async (_repo, tool) => {
    const runId = (await tool.handler({ action: "preflight" })).structuredContent.run_id;
    const rec = await tool.handler({ action: "record", run_id: runId, findings: [claim()] });
    const id = rec.structuredContent.results[0].id;
    await tool.handler({ action: "verdict", id, verdict: verdict("human", "reject") });
    const r = await tool.handler({ action: "set-status", id, status: "deferred", reason: "x" });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /rejected/);
  }),
);

// ── human attestation ────────────────────────────────────────────────────

function withRepo(fn, server = NO_ELICIT) {
  return async () => {
    const repo = huntRepo();
    try {
      await fn(repo, buildHuntTool(server, huntEnv(repo.root)), huntEnv(repo.root));
    } finally {
      rmSync(repo.root, { recursive: true, force: true });
    }
  };
}

async function oneFinding(tool) {
  const runId = (await tool.handler({ action: "preflight" })).structuredContent.run_id;
  const rec = await tool.handler({ action: "record", run_id: runId, findings: [claim()] });
  return rec.structuredContent.results[0].id;
}

test(
  "a human ruling the person confirms through the client is attested",
  withRepo(
    async (_repo, tool) => {
      const id = await oneFinding(tool);
      const r = await tool.handler({ action: "verdict", id, verdict: verdict("human", "confirm") });
      assert.notEqual(r.isError, true, textOf(r));
      assert.equal(r.structuredContent.attested, true);
    },
    elicitingServer({ confirm: true }),
  ),
);

test(
  "a human ruling the person declines is refused and nothing is written",
  withRepo(async (_repo, tool, env) => {
    const id = await oneFinding(tool);
    const before = readFileSync(join(env.huntDir, "findings.jsonl"), "utf8");
    const r = await tool.handler({ action: "verdict", id, verdict: verdict("human", "reject") });
    assert.equal(r.isError, true);
    assert.equal(readFileSync(join(env.huntDir, "findings.jsonl"), "utf8"), before);
  }, elicitingServer(null)),
);

test(
  "without elicitation a human ruling is recorded unattested and counted",
  withRepo(async (_repo, tool) => {
    const id = await oneFinding(tool);
    const r = await tool.handler({
      action: "verdict",
      id,
      verdict: { ...verdict("human", "confirm"), attested: true },
    });
    assert.equal(r.structuredContent.attested, false, "a caller cannot claim attestation");
    assert.match(textOf(r), /unattested/);
    const st = await tool.handler({ action: "status" });
    assert.equal(st.structuredContent.unattested_human, 1);
    const tri = await tool.handler({ action: "triage" });
    assert.deepEqual(tri.structuredContent.unattested_human, [id]);
  }),
);

// ── two branches, one ledger ─────────────────────────────────────────────

test(
  "ledgers from two branches merge without a conflict and fold to both findings",
  withRepo(async ({ sh }, tool, env) => {
    await tool.handler({ action: "init", config: {} });
    sh("add", "-A");
    sh("commit", "-q", "-m", "hunt init");
    assert.match(readFileSync(join(env.huntDir, ".gitattributes"), "utf8"), /merge=union/);

    const recordOn = async (branch, claims) => {
      sh("checkout", "-q", "-B", branch, "main");
      const runId = (await tool.handler({ action: "preflight" })).structuredContent.run_id;
      const rec = await tool.handler({ action: "record", run_id: runId, findings: claims });
      sh("add", ".marvin/hunt/findings.jsonl");
      sh("commit", "-q", "-m", `hunt on ${branch}`);
      return rec.structuredContent.results.map((x) => x.id);
    };
    const shared = claim({ title: "both branches saw this" });
    const [a, sharedA] = await recordOn("a", [claim(), shared]);
    await new Promise((res) => setTimeout(res, 1100));
    const [b, sharedB] = await recordOn("b", [
      claim({
        title: "format pads negatives",
        location: { files: [{ path: "src/util/format.ts" }] },
      }),
      shared,
    ]);
    assert.notEqual(a, b, "different findings get different ids on different branches");
    assert.equal(sharedA, sharedB, "the same finding gets the same id on both");

    sh("checkout", "-q", "a");
    sh("merge", "-q", "--no-edit", "b");
    const text = readFileSync(join(env.huntDir, "findings.jsonl"), "utf8");
    assert.doesNotMatch(text, /^<<<<<<<|^>>>>>>>/m, "union merge leaves no markers");

    const st = await tool.handler({ action: "status" });
    assert.equal(st.structuredContent.open, 3, "a, b and the shared one, folded once");
    assert.equal(st.structuredContent.id_conflicts, 0);
  }),
);

test("the fold never lets a second finding overwrite an id it does not own", () => {
  const rec = L.planRecord(L.foldLedger([]), [FindingClaim.parse(claim())], ctx);
  const line = rec.lines[0];
  const impostor = {
    ...line,
    finding: { ...line.finding, title: "other", fingerprint: "f".repeat(16) },
  };
  const state = L.foldLedger([line, impostor]);
  assert.equal(state.findings.get(line.finding.id).title, line.finding.title);
  assert.deepEqual(state.conflicts, [
    { id: line.finding.id, kept: line.finding.fingerprint, dropped: "f".repeat(16) },
  ]);
});

test(
  "conflict markers in a ledger merged without union are reported, not misread",
  withRepo(async (_repo, tool, env) => {
    const id = await oneFinding(tool);
    const path = join(env.huntDir, "findings.jsonl");
    writeFileSync(path, `<<<<<<< HEAD\n${readFileSync(path, "utf8")}=======\n>>>>>>> b\n`);
    const st = await tool.handler({ action: "status" });
    assert.notEqual(st.isError, true, textOf(st));
    assert.match(textOf(st), /conflict markers at ledger line\(s\) 1, \d+, \d+/);
    assert.equal(st.structuredContent.open, 1, `${id} still folds`);
  }),
);

// ── scope and hotspots ───────────────────────────────────────────────────

test(
  "a since scope that contains a deletion drops it and still hashes the rest",
  withRepo(async ({ root, sh }, tool, env) => {
    sh("tag", "base");
    writeRepoFile(root, "src/util/format.ts", "export const pad = (n: number) => `${n}`;\n");
    sh("rm", "-q", "src/auth/session.ts");
    sh("commit", "-q", "-am", "drop session, change format");
    const pre = await tool.handler({ action: "preflight", since: "base" });
    assert.notEqual(pre.isError, true, textOf(pre));
    const runId = pre.structuredContent.run_id;
    assert.deepEqual(pre.structuredContent.run.scope.files, ["src/util/format.ts"]);
    const hs = await tool.handler({ action: "hotspots", run_id: runId });
    assert.equal(hs.structuredContent.hotspots.length, 1);
    await tool.handler({ action: "checkpoint", run_id: runId, step: "hunt", batch: 1 });
    await tool.handler({ action: "finalize", run_id: runId });
    const cov = JSON.parse(readFileSync(join(env.huntDir, "coverage.json"), "utf8"));
    assert.match(cov.files[0].blob, /^[0-9a-f]{40}$/);

    const blobs = S.hashExisting(["src/util/format.ts", "src/auth/session.ts"], root);
    assert.match(blobs.get("src/util/format.ts"), /^[0-9a-f]{40}$/);
    assert.equal(blobs.get("src/auth/session.ts"), null, "one missing file nulls only itself");
  }),
);

test("risk terms match whole identifier segments, not substrings", () => {
  const terms = ["auth", "token", "payment", "rls"];
  assert.deepEqual(S.matchRiskTerms("const author = urls.join()", terms), []);
  assert.deepEqual(S.matchRiskTerms("getAuthToken(payments)", terms), ["auth", "payment", "token"]);
  assert.deepEqual(S.matchRiskTerms("src/rls_policy.sql", terms), ["rls"]);
  assert.ok(!S.RISK_TERMS.includes("stripe"), "vendor names are configured, not built in");
});

test(
  "the hotspot clock is the HEAD commit's time, so one commit gives one order",
  withRepo(async ({ root, sh }) => {
    const ct = Number(sh("show", "-s", "--format=%ct", "HEAD").trim());
    assert.equal(S.headTimeMs(root), ct * 1000);
    assert.equal(S.windowStart(Date.parse("2026-11-19T00:00:00Z"), 12), "2025-11-19T00:00:00.000Z");
  }),
);
