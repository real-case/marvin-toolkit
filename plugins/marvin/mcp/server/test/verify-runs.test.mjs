import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";

/**
 * Unit tests for the verification-run journal codec in
 * `src/storage/verify-runs.ts` (ADR-0043, WP4 of the task-metrics proposal).
 *
 * Compiled in-process through `_tsload.mjs` (the `progress.test.mjs` shape), so
 * none of this depends on the committed bundle. The writers — the `run` append
 * after a per-spec verification and the `gate` append on every delivery-gate
 * decision — are driven over stdio in `verify.test.mjs`, where a child process
 * exists at all.
 */

const { VERIFY_RUN_TAG, verifyJournalPath, recordVerifyRun, readVerifyRuns, isGreenFullRun } =
  await importTs("src/storage/verify-runs.ts");

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "marvin-verify-runs-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A `run` entry with every required field, overridable per case. */
const run = (over = {}) => ({
  slug: "demo",
  kind: "run",
  at: "2026-09-03T10:00:00.000Z",
  verdict: "PASS",
  mode: "feature",
  execution: "parallel",
  only: null,
  gates: [
    { name: "test", status: "pass", durationMs: 1200 },
    { name: "lint", status: "not-run", durationMs: 0 },
  ],
  wallClockMs: 1300,
  sumOfGatesMs: 1200,
  head_sha: "44707ed44707ed44707ed44707ed44707ed44707",
  ...over,
});

/** A `gate` entry with every required field, overridable per case. */
const gate = (over = {}) => ({
  slug: "demo",
  kind: "gate",
  at: "2026-09-03T10:05:00.000Z",
  decision: "ALLOW",
  verdict: "PASS",
  staleness: "stale",
  allowStale: true,
  red_green: "unknown",
  artifact: ".marvin/task/runs/demo.md",
  ...over,
});

test("a missing runs directory reads as an empty journal and both entry kinds round-trip", () => {
  withTmp((dir) => {
    // Both shapes of absence take different branches: every spec verified before
    // this journal existed has no file, and a missing directory must not crash
    // the roll-up's very first read either.
    const missingDir = join(dir, "nope", "runs");
    assert.equal(existsSync(missingDir), false);
    assert.deepEqual(readVerifyRuns(missingDir, "demo"), []);

    const runs = join(dir, "runs");
    recordVerifyRun(runs, run({ slug: "other" })); // the directory now exists…
    assert.deepEqual(readVerifyRuns(runs, "demo"), [], "…but this slug's file does not");

    const first = run({ only: ["test"], verdict: "FAIL" });
    const second = gate({
      decision: "BLOCK",
      verdict: null,
      staleness: "unknown",
      allowStale: false,
    });
    recordVerifyRun(runs, first);
    recordVerifyRun(runs, second);
    assert.deepEqual(readVerifyRuns(runs, "demo"), [first, second], "field for field, in order");

    // The path is a SIBLING under runs/, never at the spec directory's top level.
    assert.equal(verifyJournalPath(runs, "demo"), join(runs, "demo.verify.md"));
    const raw = readFileSync(join(runs, "demo.verify.md"), "utf8");
    assert.match(raw, new RegExp("```json " + VERIFY_RUN_TAG), "one tagged block per entry");
    assert.match(raw, /^# Verification runs — demo/, "the one-time header");
    assert.equal(
      raw.match(/^# Verification runs/gm).length,
      1,
      "the header is written exactly once",
    );
  });
});

test("a corrupt block is dropped, an entry of an unknown kind is dropped, and the neighbours survive", () => {
  withTmp((dir) => {
    const runs = join(dir, "runs");
    const first = run({ verdict: "FAIL" });
    const second = run({ at: "2026-09-03T10:10:00.000Z" });

    recordVerifyRun(runs, first);
    const path = verifyJournalPath(runs, "demo");
    // A torn append — the interrupted write an append-only journal exists to survive.
    writeFileSync(path, "```json " + VERIFY_RUN_TAG + '\n{"slug": "demo", tru\n```\n\n', {
      flag: "a",
    });
    // A well-formed block of a kind this schema does not know: dropped, not fatal.
    writeFileSync(
      path,
      "```json " + VERIFY_RUN_TAG + '\n{"slug":"demo","kind":"oracle","at":"x"}\n```\n\n',
      { flag: "a" },
    );
    recordVerifyRun(runs, second);

    // BOTH survivors, not merely "it did not throw": a reader that returns
    // nothing at all also never throws.
    assert.deepEqual(readVerifyRuns(runs, "demo"), [first, second]);
  });
});

test("a green full run is a full PASS or PASS WITH WARNINGS; a targeted retry, a FAIL and a gate are not", () => {
  assert.equal(isGreenFullRun(run()), true);
  assert.equal(isGreenFullRun(run({ verdict: "PASS WITH WARNINGS" })), true);
  // `only` is recorded so that a targeted retry never counts as the first green
  // full run — the distinction R4 is defined on.
  assert.equal(isGreenFullRun(run({ only: ["test"] })), false);
  assert.equal(isGreenFullRun(run({ verdict: "FAIL" })), false);
  assert.equal(isGreenFullRun(gate()), false);
});
