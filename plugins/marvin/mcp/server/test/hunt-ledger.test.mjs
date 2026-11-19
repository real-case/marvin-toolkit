import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./_tsload.mjs";
import { claim } from "./_hunt-fixture.mjs";

/** The pure ledger half of the hunt tool (ADR-0054): identity, the fold, ranking, triage. */

const L = await importTs("src/lib/hunt-ledger.ts");
const { FindingClaim } = await import("@marvin-toolkit/mcp-shared/contracts");

const parsed = (over) => FindingClaim.parse(claim(over));
const ctx = { runId: "20261119-120000-code", headSha: "abc", now: "2026-11-19T12:00:00.000Z" };

test("the fingerprint ignores line numbers and wording of the summary, not the title or file", () => {
  const a = L.fingerprintClaim(parsed());
  assert.equal(
    a,
    L.fingerprintClaim(
      parsed({ location: { files: [{ path: "src/auth/session.ts", line: 40 }] } }),
    ),
  );
  assert.equal(a, L.fingerprintClaim(parsed({ summary: "different words" })));
  assert.notEqual(a, L.fingerprintClaim(parsed({ title: "another defect" })));
  assert.notEqual(
    a,
    L.fingerprintClaim(parsed({ location: { files: [{ path: "src/other.ts" }] } })),
  );
  assert.notEqual(a, L.fingerprintClaim(parsed({ class: "risk" })));
  assert.match(a, /^[0-9a-f]{16}$/);
});

test("an id is derived from the fingerprint and grows only on a collision", () => {
  const fp = "3f9a01c2deadbeef";
  assert.equal(L.idForFingerprint(fp), "BH-3f9a01c2");
  assert.equal(L.idForFingerprint(fp, new Map([["BH-3f9a01c2", fp]])), "BH-3f9a01c2");
  assert.equal(
    L.idForFingerprint(fp, new Map([["BH-3f9a01c2", "3f9a01c2ffffffff"]])),
    "BH-3f9a01c2de",
  );
});

test("one call that names the same defect twice records it once", () => {
  const state = L.foldLedger([]);
  const plan = L.planRecord(state, [parsed(), parsed({ summary: "again" })], ctx);
  assert.deepEqual(
    plan.results.map((r) => r.outcome),
    ["new", "duplicate"],
  );
  assert.equal(plan.lines.filter((l) => l.type === "finding").length, 1);
});

test("a low-confidence claim is logged and never reaches triage", () => {
  const plan = L.planRecord(L.foldLedger([]), [parsed({ confidence: "low" })], ctx);
  assert.match(plan.results[0].note, /never reported/);
  const state = L.foldLedger(plan.lines);
  const g = L.triageGroups([...state.findings.values()], null, () => false);
  assert.equal(g.open.length, 0);
});

test("the fold applies events in order: verdicts, statuses, links and sightings", () => {
  const rec = L.planRecord(L.foldLedger([]), [parsed()], ctx);
  const id = rec.results[0].id;
  const lines = [
    ...rec.lines,
    {
      v: 1,
      type: "seen",
      at: "2026-11-20T00:00:00.000Z",
      id,
      run_id: "20261120-000000-code",
      head_sha: "def",
    },
    {
      v: 1,
      type: "status",
      at: "2026-11-20T00:00:01.000Z",
      id,
      status: "deferred",
      reason: "later",
    },
    { v: 1, type: "link", at: "2026-11-20T00:00:02.000Z", id, links: { task: "T-12" } },
  ];
  const f = L.foldLedger(lines).findings.get(id);
  assert.equal(f.status, "deferred");
  assert.equal(f.last_seen_run, "20261120-000000-code");
  assert.equal(f.head_sha, "def");
  assert.equal(f.links.task, "T-12");
  assert.equal(f.first_seen_run, ctx.runId);
});

test("ranking: severity, then confidence, then blast radius, then id", () => {
  const make = (over, n) => ({
    ...parsed(over),
    id: `BH-0000000${n}`,
    fingerprint: "0".repeat(16),
    status: "confirmed",
    verdicts: [],
    first_seen_run: "r",
    last_seen_run: "r",
    head_sha: null,
    created_at: "x",
    updated_at: "x",
  });
  const ranked = L.rankFindings(
    [
      make({ severity: "medium" }, 1),
      make({ severity: "high", confidence: "medium" }, 2),
      make({ severity: "high" }, 3),
      make({ severity: "high", occurrences: [{ path: "a.ts" }, { path: "b.ts" }] }, 4),
    ],
    null,
  );
  assert.deepEqual(
    ranked.map((f) => f.id),
    ["BH-00000004", "BH-00000003", "BH-00000002", "BH-00000001"],
  );
  assert.equal(L.atOrAbove("critical", "high"), true);
  assert.equal(L.atOrAbove("medium", "high"), false);
});

test("the report puts confirmed findings in the main section and candidates under suspected", () => {
  const rec = L.planRecord(
    L.foldLedger([]),
    [parsed(), parsed({ title: "second", category: "CODE-D09" })],
    ctx,
  );
  const [a] = rec.results.map((r) => r.id);
  const confirm = L.planVerdict(
    L.foldLedger(rec.lines).findings.get(a),
    { stage: "human", ruling: "confirm", by: "maintainer", reasoning: "yes", at: ctx.now },
    ctx.now,
  );
  assert.equal(confirm.ok, true);
  const findings = [...L.foldLedger([...rec.lines, ...confirm.lines]).findings.values()];
  const md = L.renderReport({ title: "t", generatedAt: ctx.now, findings, flows: null });
  const [main, rest] = md.split("## Suspected");
  assert.match(main, new RegExp(a));
  assert.doesNotMatch(main, /\| second \|/);
  assert.match(rest, /second/);
});

test("a skeptic ruling changes nothing and a ruling outside its stage is refused", () => {
  const rec = L.planRecord(L.foldLedger([]), [parsed()], ctx);
  const f = L.foldLedger(rec.lines).findings.get(rec.results[0].id);
  const sk = L.planVerdict(
    f,
    {
      stage: "skeptic",
      ruling: "dismissed",
      by: "marvin-hunt-skeptic",
      reasoning: "guarded",
      at: ctx.now,
    },
    ctx.now,
  );
  assert.equal(sk.ok, true);
  assert.equal(sk.status, "candidate");
  const wrong = L.planVerdict(
    f,
    { stage: "referee", ruling: "red", by: "marvin-hunt-referee", reasoning: "x", at: ctx.now },
    ctx.now,
  );
  assert.equal(wrong.ok, false);
  const upheld = {
    ...f,
    verdicts: [
      {
        stage: "referee",
        ruling: "upheld",
        by: "marvin-hunt-referee",
        reasoning: "ok",
        at: ctx.now,
      },
    ],
  };
  const drift = L.planVerdict(
    upheld,
    {
      stage: "prove",
      ruling: "red",
      by: "hunt-code",
      reasoning: "x",
      failure_kind: "test-drift",
      test_path: "t.test.ts",
      at: ctx.now,
    },
    ctx.now,
  );
  assert.equal(drift.ok, true);
  assert.equal(drift.status, "candidate", "only a real-defect failure confirms (VER-05)");
});
