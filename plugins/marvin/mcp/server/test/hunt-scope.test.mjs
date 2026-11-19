import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { importTs } from "./_tsload.mjs";
import { huntRepo } from "./_hunt-fixture.mjs";

/** Scope resolution and the deterministic hotspot order (ADR-0053, CODE-P01…P07). */

const S = await importTs("src/lib/hunt-scope.ts");
const { HuntConfig } = await import("@marvin-toolkit/mcp-shared/contracts");

test("globs: ** spans directories, * stays in a segment, a bare path is a prefix", () => {
  assert.equal(S.matchesAny("src/a/b/c.ts", ["src/**/*.ts"]), true);
  assert.equal(S.matchesAny("src/c.ts", ["src/**/*.ts"]), true);
  assert.equal(S.matchesAny("src/a/c.ts", ["src/*.ts"]), false);
  assert.equal(S.matchesAny("src/billing/x.ts", ["src/billing"]), true);
  assert.equal(S.matchesAny("src/billingx/x.ts", ["src/billing"]), false);
});

test("the default scope keeps source and drops tests, build output and .marvin", () => {
  const files = [
    "src/a.ts",
    "src/a.test.ts",
    "dist/a.js",
    "README.md",
    ".marvin/x.ts",
    "lib/__tests__/b.ts",
    "app/page.tsx",
    "src/x.d.ts",
  ];
  assert.deepEqual(S.filterScope(files, [], []), ["app/page.tsx", "src/a.ts"]);
  assert.deepEqual(S.filterScope(files, ["src"], []), ["src/a.ts"]);
  assert.deepEqual(S.filterScope(files, [], ["app/**"]), ["src/a.ts"]);
});

const base = {
  path: "a.ts",
  churn: 0,
  authors: 0,
  fixCommits: 0,
  lines: 0,
  daysSinceChange: null,
  riskTerms: [],
  audit: "never",
  hasTest: true,
};

test("each signal raises the score, a fresh audit lowers it, and no signal dominates", () => {
  const s0 = S.scoreSignals(base).score;
  assert.ok(S.scoreSignals({ ...base, churn: 10 }).score > s0);
  assert.ok(S.scoreSignals({ ...base, fixCommits: 2 }).score > s0);
  assert.ok(S.scoreSignals({ ...base, riskTerms: ["auth"] }).score > s0);
  assert.ok(S.scoreSignals({ ...base, hasTest: false }).score > s0);
  assert.ok(S.scoreSignals({ ...base, audit: "fresh" }).score < s0);
  assert.equal(
    S.scoreSignals({ ...base, fixCommits: 50 }).score,
    S.scoreSignals({ ...base, fixCommits: 5 }).score,
    "fix commits are capped",
  );
  assert.ok(S.scoreSignals({ ...base, fixCommits: 2 }).why.length <= 4);
});

test("ranking is deterministic: ties break by path, batches cut by size", () => {
  const sig = ["c.ts", "a.ts", "b.ts"].map((path) => ({ ...base, path }));
  const r = S.rankHotspots(sig, 10, 2);
  assert.deepEqual(
    r.map((h) => [h.path, h.rank, h.batch]),
    [
      ["a.ts", 1, 1],
      ["b.ts", 2, 1],
      ["c.ts", 3, 2],
    ],
  );
  assert.equal(S.rankHotspots(sig, 2, 2).length, 2, "max_hotspots caps the list");
});

test("a coverage entry is fresh, stale after ninety days, or changed when the blob moved", () => {
  const now = Date.parse("2026-11-19T00:00:00Z");
  const entry = {
    path: "a.ts",
    last_audited_at: "2026-11-01T00:00:00Z",
    last_run: "r",
    blob: "b1",
    audits: 1,
    findings: 0,
  };
  assert.equal(S.auditState(undefined, "b1", now), "never");
  assert.equal(S.auditState(entry, "b1", now), "fresh");
  assert.equal(S.auditState(entry, "b2", now), "changed");
  assert.equal(
    S.auditState({ ...entry, last_audited_at: "2026-06-01T00:00:00Z" }, "b1", now),
    "stale",
  );
});

test("resolveScope reads git: the whole repo, a path, or the uncommitted diff", () => {
  const { root } = huntRepo();
  try {
    const config = HuntConfig.parse({});
    assert.equal(S.resolveScope(root, {}, config).files.length, 2);
    assert.deepEqual(S.resolveScope(root, { paths: ["src/util"] }, config).files, [
      "src/util/format.ts",
    ]);
    const diff = S.resolveScope(root, { diff: true }, config);
    assert.equal(diff.kind, "diff");
    assert.deepEqual(diff.files, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
