import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";

/**
 * Unit tests for the PURE half of spec resumability: the progress journal codec
 * and the resume reducer in `src/storage/progress.ts`.
 *
 * Compiled in-process through `_tsload.mjs` (the `oracles.test.mjs` shape), so
 * none of this depends on the committed bundle. The tool surface — the
 * `progress` and `resume` actions — is driven over stdio in `spec.test.mjs`,
 * because that is where a child process exists at all.
 */

const { PROGRESS_TAG, progressJournalPath, recordProgress, readProgress, resumeState } =
  await importTs("src/storage/progress.ts");

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "marvin-progress-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** An entry with every required field, overridable per case. */
const entry = (over = {}) => ({
  slug: "demo",
  source: "task-start",
  step: "1.5",
  kind: "step",
  detail: "allocated the draft",
  at: "2026-08-13T10:00:00.000Z",
  ...over,
});

test("a missing runs directory reads as an empty journal and a recorded entry round-trips", () => {
  withTmp((dir) => {
    // Both shapes of absence, because they take different branches and only one
    // of them is the obvious one. The read is the resume fork's very first call
    // on every spec authored before this journal existed — an error here would
    // put the loud "verify from scratch" answer behind a crash.
    const missingDir = join(dir, "nope", "runs");
    assert.equal(existsSync(missingDir), false);
    assert.deepEqual(readProgress(missingDir, "demo"), []);

    const runs = join(dir, "runs");
    recordProgress(runs, entry({ slug: "other" })); // the directory now exists…
    assert.deepEqual(readProgress(runs, "demo"), [], "…but this slug's file does not");

    const full = entry({
      criterion: "AC4",
      path: ".marvin/task/030-demo.md",
      contract_sha: "1b0d247e9e203673",
      kind: "criterion",
      step: "5F",
      source: "task-implement",
    });
    recordProgress(runs, full);
    assert.deepEqual(readProgress(runs, "demo"), [full], "field for field");

    // The path is a SIBLING under runs/, never at the spec directory's top level.
    assert.equal(progressJournalPath(runs, "demo"), join(runs, "demo.progress.md"));
    const raw = readFileSync(join(runs, "demo.progress.md"), "utf8");
    assert.match(raw, new RegExp("```json " + PROGRESS_TAG), "one tagged block per entry");
    assert.match(raw, /^# Progress — demo/, "the one-time header");
  });
});

test("a corrupt block is dropped and the entries around it survive", () => {
  withTmp((dir) => {
    const runs = join(dir, "runs");
    const first = entry({ step: "1.5", detail: "first" });
    const second = entry({ step: "4F", detail: "second" });

    recordProgress(runs, first);
    // A torn append — the interrupted write this journal exists to survive.
    const path = progressJournalPath(runs, "demo");
    writeFileSync(path, "```json " + PROGRESS_TAG + '\n{"slug": "demo", tru\n```\n\n', {
      flag: "a",
    });
    recordProgress(runs, second);

    // BOTH survivors, not merely "it did not throw": a reader that returns
    // nothing at all also never throws.
    assert.deepEqual(readProgress(runs, "demo"), [first, second]);
  });
});

test("an archived boundary hides earlier entries without deleting them", () => {
  withTmp((dir) => {
    const runs = join(dir, "runs");
    const written = [
      entry({ step: "1.5", path: ".marvin/task/030-demo.md" }),
      entry({ kind: "criterion", criterion: "AC1", step: "5F", source: "task-implement" }),
      entry({ kind: "criterion", criterion: "AC1", step: "5F", source: "task-implement" }),
      entry({ kind: "archived", step: "2.5", detail: "user chose start clean" }),
      entry({ kind: "criterion", criterion: "AC2", step: "5F", source: "task-implement" }),
      entry({ kind: "criterion", criterion: "AC3", step: "5F", source: "task-implement" }),
      entry({ kind: "step", step: "6F", contract_sha: "aaaaaaaaaaaaaaaa" }),
    ];
    for (const e of written) recordProgress(runs, e);

    const state = resumeState(readProgress(runs, "demo"));
    assert.equal(state.archived, 1, "the crossing is reported");
    assert.equal(state.entries.length, 3, "only what follows the last boundary");
    assert.deepEqual(state.criteria_done, ["AC2", "AC3"], "the discarded run's AC1 is not carried");
    assert.equal(state.last.step, "6F");
    assert.equal(state.contract_sha, "aaaaaaaaaaaaaaaa");
    assert.equal(state.path, null, "the pre-boundary draft path is not carried either");

    // Nothing was deleted — "what was abandoned here" stays answerable.
    assert.equal(readProgress(runs, "demo").length, written.length);

    // De-duplication is by id, not by adjacency: a criterion re-recorded after
    // the boundary appears exactly once.
    recordProgress(runs, entry({ kind: "criterion", criterion: "AC2", source: "task-implement" }));
    assert.deepEqual(resumeState(readProgress(runs, "demo")).criteria_done, ["AC2", "AC3"]);

    // No boundary at all is the ordinary case: everything is live.
    assert.deepEqual(resumeState([]), {
      entries: [],
      archived: 0,
      last: null,
      criteria_done: [],
      path: null,
      contract_sha: null,
    });
  });
});
