import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./_tsload.mjs";

/**
 * Unit tests for the shared `verify-result` codec (`src/lib/reports.ts`) — the
 * one writer and the classification the three readers now share. Exercised
 * directly (compiled via `_tsload.mjs`), independent of the committed bundle;
 * the delivery gate's use of it is covered end-to-end in `verify.test.mjs`.
 *
 * The three readers disagreed on purpose before they were unified, and the
 * disagreement is load-bearing: `report` requires a declared `gates` array,
 * `summary` tolerates a verdict-only block, and the delivery gate reads neither
 * — only the verdict. The per-caller cases at the bottom pin that split.
 */
const lib = await importTs("src/lib/reports.ts");
const { formatVerifyBlock, parseVerifyBlock, parseVerificationChecks, VERIFY_BLOCK_TAG } = lib;

/** A verification.md the way verify writes one: prose, then the block. */
const wrap = (json) =>
  `# Verification Report\n\n**Verdict:** ?\n\n\`\`\`json ${VERIFY_BLOCK_TAG}\n${json}\n\`\`\`\n`;

const FULL = {
  verdict: "PASS WITH WARNINGS",
  gates: [
    { name: "test", status: "pass", code: 0, durationMs: 12 },
    { name: "lint", status: "fail", code: 1, durationMs: 3 },
  ],
  detectedStacks: ["node"],
  warnings: ["config gate override"],
  wallClockMs: 15,
  sumOfGatesMs: 15,
  artifactPath: "/tmp/x/.marvin/task/verification.md",
};

// ── kind: none ───────────────────────────────────────────────────────────────

test("none: an artifact with no block at all", () => {
  assert.deepEqual(parseVerifyBlock("# Verification\n\nProse only.\n"), { kind: "none" });
  assert.deepEqual(parseVerifyBlock(""), { kind: "none" });
});

test("none: a fenced block under a different tag is not this one", () => {
  const other = '# V\n\n```json deliver-gate\n{"decision":"ALLOW"}\n```\n';
  assert.equal(parseVerifyBlock(other).kind, "none");
});

// ── kind: invalid ────────────────────────────────────────────────────────────

test("invalid: a block that is not valid JSON, with the reason the gate prints", () => {
  const parse = parseVerifyBlock(wrap("{not json"));
  assert.equal(parse.kind, "invalid");
  assert.equal(parse.reason, "verify-result block is not valid JSON");
});

test("invalid: JSON that is not an object", () => {
  for (const json of ["123", "null", '"PASS"', "[]"]) {
    const parse = parseVerifyBlock(wrap(json));
    assert.equal(parse.kind, "invalid", `${json} must not parse as a result`);
    assert.match(parse.reason, /verify-result block is malformed/);
  }
});

test("invalid: nothing below the top level can make a block unreadable", () => {
  // The delivery gate reads only the verdict and has always ALLOWed a PASS
  // whose `gates` were nonsense. A field is degraded, never fatal.
  const parse = parseVerifyBlock(wrap('{"verdict":"PASS","gates":"test"}'));
  assert.equal(parse.kind, "ok");
  assert.equal(parse.result.verdict, "PASS");
  assert.deepEqual(parse.result.gates, []);
  assert.equal(parse.gatesDeclared, false, "a non-array is not a declaration");
});

test("invalid: a non-string verdict degrades to absent", () => {
  const parse = parseVerifyBlock(wrap('{"verdict":42,"gates":[]}'));
  assert.equal(parse.kind, "ok");
  assert.equal(parse.result.verdict, undefined, "the gate reports an unrecognised verdict");
});

// ── kind: ok ─────────────────────────────────────────────────────────────────

test("ok: what formatVerifyBlock writes is what parseVerifyBlock reads back", () => {
  const parse = parseVerifyBlock(`# Verification Report\n\n${formatVerifyBlock(FULL)}`);
  assert.equal(parse.kind, "ok");
  assert.equal(parse.gatesDeclared, true);
  assert.deepEqual(parse.result, FULL);
});

test("ok: a verdict-only block keeps the verdict and declares no gates", () => {
  const parse = parseVerifyBlock(wrap('{"verdict":"PASS"}'));
  assert.equal(parse.kind, "ok");
  assert.equal(parse.result.verdict, "PASS");
  assert.deepEqual(parse.result.gates, [], "the schema default, not a declaration");
  assert.equal(parse.gatesDeclared, false);
});

test("ok: a declared empty gates array is a declaration", () => {
  const parse = parseVerifyBlock(wrap('{"verdict":"PASS","gates":[]}'));
  assert.equal(parse.kind, "ok");
  assert.equal(parse.gatesDeclared, true);
});

test("ok: a block with gates but no verdict stays usable", () => {
  // The `report` scan reads gates and ignores the verdict; requiring one here
  // would drop artifacts it renders today.
  const parse = parseVerifyBlock(wrap('{"gates":[{"name":"test","status":"pass","code":0}]}'));
  assert.equal(parse.kind, "ok");
  assert.equal(parse.result.verdict, undefined);
  assert.equal(parse.result.gates.length, 1);
});

test("ok: an unnamed gate entry is dropped, the named ones survive", () => {
  const parse = parseVerifyBlock(
    wrap(
      JSON.stringify({
        verdict: "FAIL",
        gates: [{ name: "test", status: "pass" }, { status: "fail" }, null, "lint", 7],
      }),
    ),
  );
  assert.equal(parse.kind, "ok");
  assert.deepEqual(parse.result.gates, [{ name: "test", status: "pass" }]);
});

test("ok: a malformed gate field degrades that field, it does not drop the gate", () => {
  const parse = parseVerifyBlock(
    wrap(JSON.stringify({ verdict: "FAIL", gates: [{ name: "lint", status: "fail", code: "x" }] })),
  );
  assert.equal(parse.kind, "ok");
  assert.deepEqual(parse.result.gates, [{ name: "lint", status: "fail", code: null }]);
});

test("ok: garbage in a non-load-bearing field never costs a readable verdict", () => {
  const parse = parseVerifyBlock(
    wrap(
      JSON.stringify({
        verdict: "PASS",
        gates: [],
        detectedStacks: "node",
        warnings: 3,
        wallClockMs: "fast",
        artifactPath: 7,
      }),
    ),
  );
  assert.equal(parse.kind, "ok");
  assert.equal(parse.result.verdict, "PASS");
  assert.equal(parse.result.detectedStacks, undefined);
  assert.equal(parse.result.warnings, undefined);
  assert.equal(parse.result.wallClockMs, undefined);
  assert.equal(parse.result.artifactPath, null);
});

test("ok: fields the writer does not know are dropped, not rejected", () => {
  // Forward compatibility: an older server must still read a newer artifact.
  const parse = parseVerifyBlock(wrap('{"verdict":"PASS","gates":[],"oracles":{"AC1":"green"}}'));
  assert.equal(parse.kind, "ok");
  assert.equal(parse.result.oracles, undefined);
});

// ── provenance and not-run (ADR-0035) ────────────────────────────────────────

const PROVENANCE = {
  head_sha: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
  branch: "feat/x",
  dirty: true,
  worktree_digest: "0123456789abcdef",
  generated_at: "2026-08-13T10:00:00.000Z",
};

test("provenance is optional on read and not-run maps to pending", () => {
  // (1) Every artifact written before ADR-0035 carries neither field. Requiring
  // provenance would invalidate every verification.md already on disk, so the
  // delivery gate would start blocking on artifacts that were valid a minute
  // earlier.
  const legacy = parseVerifyBlock(
    wrap(
      JSON.stringify({
        verdict: "PASS",
        gates: [{ name: "test", status: "pass", code: 0, durationMs: 4 }],
        detectedStacks: ["node"],
        warnings: [],
      }),
    ),
  );
  assert.equal(legacy.kind, "ok");
  assert.equal(legacy.result.provenance, undefined);
  assert.equal(legacy.result.verdict, "PASS");
  assert.deepEqual(legacy.result.detectedStacks, ["node"]);
  assert.equal(legacy.result.gates.length, 1);

  // (2) A malformed provenance degrades alone — the module's own rule. A
  // freshness field must never cost a reader the verdict it came for.
  const corrupt = parseVerifyBlock(
    wrap('{"verdict":"PASS","gates":[],"warnings":["w"],"provenance":{"dirty":"very"}}'),
  );
  assert.equal(corrupt.kind, "ok");
  assert.equal(corrupt.result.provenance, undefined);
  assert.equal(corrupt.result.verdict, "PASS");
  assert.deepEqual(corrupt.result.warnings, ["w"]);

  // (3) It round-trips through the writer, and is written LAST so every older
  // artifact's prefix stays byte-identical and a verification.md diff stays
  // readable.
  const block = formatVerifyBlock({
    verdict: "PASS",
    gates: [],
    artifactPath: "/tmp/x/.marvin/task/verification.md",
    provenance: PROVENANCE,
  });
  assert.ok(
    block.indexOf('"provenance"') > block.indexOf('"artifactPath"'),
    "provenance is appended after every field the writer already emitted",
  );
  const round = parseVerifyBlock(`# V\n\n${block}`);
  assert.equal(round.kind, "ok");
  assert.deepEqual(round.result.provenance, PROVENANCE);

  // (4) An all-null provenance is legitimate, not corrupt: collection fails
  // open, which is exactly why every git-derived field is nullable.
  const failedOpen = {
    ...PROVENANCE,
    head_sha: null,
    branch: null,
    dirty: null,
    worktree_digest: null,
  };
  const open = parseVerifyBlock(
    `# V\n\n${formatVerifyBlock({ verdict: "PASS", gates: [], provenance: failedOpen })}`,
  );
  assert.deepEqual(open.result.provenance, failedOpen);

  // (5) `not-run` is not a failure: the check vocabulary's "no result" member is
  // `pending`, the same landing as `skip`.
  const checks = parseVerificationChecks(
    wrap(
      JSON.stringify({
        verdict: "PASS WITH WARNINGS",
        gates: [
          { name: "test", status: "pass", code: 0 },
          { name: "lint", status: "not-run", code: null },
        ],
      }),
    ),
  );
  assert.deepEqual(checks, [
    { name: "test", status: "pass" },
    { name: "lint", status: "pending" },
  ]);
});

// ── the writer ───────────────────────────────────────────────────────────────

test("formatVerifyBlock: the fence carries the tag and the verdict leads", () => {
  const block = formatVerifyBlock({ verdict: "PASS", gates: [] });
  assert.equal(block.split("\n")[0], "```json verify-result");
  assert.equal(block.split("\n").at(-1), "```");
  assert.match(block, /^\{"verdict":"PASS"/m);
});

test("formatVerifyBlock: absent optional fields are omitted, an explicit null is kept", () => {
  const block = formatVerifyBlock({ verdict: "PASS", gates: [], artifactPath: null });
  assert.doesNotMatch(block, /wallClockMs/);
  assert.match(block, /"artifactPath":null/);
});

// ── per-caller differences (the reason the return type is a union) ───────────

test("report: a verdict-only block is not a check list", () => {
  assert.equal(parseVerificationChecks(wrap('{"verdict":"PASS"}')), null);
  assert.equal(parseVerificationChecks(wrap('{"verdict":"PASS","gates":"nope"}')), null);
  assert.equal(parseVerificationChecks("prose only"), null);
  assert.deepEqual(parseVerificationChecks(wrap('{"verdict":"PASS","gates":[]}')), []);
});

test("report: gate status maps to the check vocabulary, notes included", () => {
  const checks = parseVerificationChecks(
    wrap(
      JSON.stringify({
        verdict: "FAIL",
        gates: [
          { name: "test", status: "pass", code: 0 },
          { name: "lint", status: "fail", code: 1 },
          { name: "typecheck", status: "error", code: null },
          { name: "build", status: "skip", code: null },
        ],
      }),
    ),
  );
  assert.deepEqual(checks, [
    { name: "test", status: "pass" },
    { name: "lint", status: "fail", note: "exit 1" },
    { name: "typecheck", status: "fail", note: "errored" },
    // `skip` is honoured by this reader but never written by verify — recorded,
    // not resolved, here (WP1.5b owns the phantom status).
    { name: "build", status: "pending" },
  ]);
});
