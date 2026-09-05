import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";

/**
 * Unit tests for the metrics record codec in `src/storage/metrics.ts`
 * (ADR-0043): the append that never reads the file back, the one-time header,
 * the reads that drop an unparseable block rather than the file, the LAST
 * terminal block winning, and `findRecord` resolving a slug by suffix.
 *
 * The second half is the parity fence. The server imports the contracts package
 * type-only, so `storage/metrics.ts` carries a runtime MIRROR of the
 * `MetricEvent` vocabulary in `contracts/metrics.ts`. Both are compiled here
 * through the same loader and asserted to agree — on every enum and on the
 * verdict of every fixture — so the mirror cannot drift silently.
 */

const storage = await importTs("src/storage/metrics.ts");
const contract = await importTs("../../../../packages/marvin-mcp-shared/src/contracts/metrics.ts");

const {
  METRIC_EVENT_TAG,
  TASK_METRICS_TAG,
  MetricEventSchema,
  appendMetricEvent,
  appendTaskMetrics,
  findRecord,
  listRecords,
  metricsRecordPath,
  readMetricEvents,
  readRecord,
  readTaskMetrics,
  recordBasenameForSpec,
  slugOfRecord,
} = storage;

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "marvin-metrics-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const event = (over = {}) => ({
  slug: "demo",
  source: "task-implement",
  step: "6F",
  kind: "spec-gap",
  contract_sha: null,
  at: "2026-09-03T10:00:00.000Z",
  detail: "the spec did not say where the fixture lives",
  ...over,
});

/** A terminal block with every section present and every metric null. */
const terminal = (over = {}) => ({
  slug: "demo",
  contract_sha: null,
  type: null,
  risk: null,
  breaking: null,
  spike_required: null,
  created: null,
  rolled_up_at: "2026-09-03T12:00:00.000Z",
  head_sha: null,
  base_branch: "dev",
  sources: {
    spec: "absent",
    progress: "absent",
    oracles: "absent",
    verify_journal: "absent",
    verify_result: "absent",
    critique: "absent",
    events: "absent",
    git: "absent",
  },
  time: {
    intake_ms: null,
    implement_ms: null,
    first_green_ms: null,
    active_ms: null,
    gate_efficiency: null,
    oracle_ms: [],
    gate_ms: [],
    critic_ms: { total: null, dispatches: [] },
  },
  quality: {
    scope_drift: null,
    oracle_strength: null,
    red_green: null,
    not_run: null,
    freshness_waivers: null,
    critics: { spec: null, diff: null },
    spec_gaps: null,
    open_items: null,
    dor_first_call: null,
    oracle_resolution: null,
  },
  rework: {
    seals: null,
    reseals: null,
    critic_passes: { spec: null, diff: null },
    fix_rounds: null,
    runs_before_green: null,
  },
  notes: [],
  ...over,
});

test("a record is named after the spec's file, found by slug suffix, and absent reads as empty", () => {
  withTmp((dir) => {
    // Both shapes of absence: no directory at all, and a directory without this slug.
    assert.deepEqual(readMetricEvents(join(dir, "nope"), "demo"), []);
    assert.equal(readTaskMetrics(join(dir, "nope"), "demo"), null);
    assert.equal(findRecord(join(dir, "nope"), "demo"), null);
    assert.deepEqual(listRecords(join(dir, "nope")), []);

    // The spec's basename, number included, is the record's basename.
    assert.equal(recordBasenameForSpec("/p/.marvin/task/023-demo.md"), "023-demo");
    assert.equal(recordBasenameForSpec("/p/specs/demo.md"), "demo");
    assert.equal(slugOfRecord("023-demo.md"), "demo");
    assert.equal(slugOfRecord("demo.md"), "demo");

    const numbered = metricsRecordPath(dir, "023-demo");
    assert.equal(numbered, join(dir, "023-demo.md"));
    appendMetricEvent(numbered, event());
    assert.equal(findRecord(dir, "demo"), numbered, "resolved by suffix, without the number");
    assert.equal(findRecord(dir, "dem"), null, "a prefix of the slug is not the slug");
    assert.equal(findRecord(dir, "other"), null);

    // An exact `<slug>.md` outranks a numbered one, as `resolveSpecBySlug` does.
    appendMetricEvent(metricsRecordPath(dir, "demo"), event({ step: "legacy" }));
    assert.equal(findRecord(dir, "demo"), join(dir, "demo.md"));
  });
});

test("events and terminal blocks round-trip, the header is written once, and the LAST terminal block wins", () => {
  withTmp((dir) => {
    const path = metricsRecordPath(dir, "023-demo");
    const first = event({
      kind: "gate-call",
      gate: "dor",
      call: 1,
      verdict: "FAIL",
      detail: undefined,
    });
    delete first.detail;
    const second = event({ at: "2026-09-03T10:05:00.000Z" });
    appendMetricEvent(path, first);
    appendMetricEvent(path, second);
    assert.deepEqual(readMetricEvents(dir, "demo"), [first, second], "field for field, in order");

    const raw = readFileSync(path, "utf8");
    assert.equal(raw.match(/^# Metrics — demo/gm).length, 1, "one header");
    assert.equal(raw.match(new RegExp("```json " + METRIC_EVENT_TAG, "g")).length, 2);

    // No terminal block yet: an events-only record is "recorded, not rolled up".
    assert.equal(readTaskMetrics(dir, "demo"), null);

    const t1 = terminal({ rolled_up_at: "2026-09-03T12:00:00.000Z" });
    const t2 = terminal({
      rolled_up_at: "2026-09-03T13:00:00.000Z",
      notes: ["second delivery of the same spec"],
    });
    appendTaskMetrics(path, t1);
    appendTaskMetrics(path, t2);
    assert.deepEqual(readTaskMetrics(dir, "demo"), t2, "the last terminal block is authoritative");
    const record = readRecord(path);
    assert.equal(record.terminal.length, 2, "…and the file keeps both — append-only");
    assert.equal(record.events.length, 2, "events are untouched by a roll-up");
    assert.equal(
      readFileSync(path, "utf8").match(/^# Metrics — demo/gm).length,
      1,
      "still one header",
    );
    assert.equal(
      readFileSync(path, "utf8").match(new RegExp("```json " + TASK_METRICS_TAG, "g")).length,
      2,
    );

    const listed = listRecords(dir);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].slug, "demo");
    assert.equal(listed[0].filename, "023-demo.md");
    assert.equal(listed[0].terminal.length, 2);
  });
});

test("a corrupt block, an event missing its kind's fields, and a terminal block without its sections are dropped; the neighbours survive", () => {
  withTmp((dir) => {
    const path = metricsRecordPath(dir, "023-demo");
    const good = event();
    appendMetricEvent(path, good);
    // a torn append
    writeFileSync(path, "```json " + METRIC_EVENT_TAG + '\n{"slug": "demo", tru\n```\n\n', {
      flag: "a",
    });
    // well-formed JSON, half-written event: a spec-gap with no detail
    writeFileSync(
      path,
      "```json " +
        METRIC_EVENT_TAG +
        "\n" +
        JSON.stringify({ ...good, detail: undefined }) +
        "\n```\n\n",
      { flag: "a" },
    );
    // a terminal block that lost its quality section
    const { quality: _q, ...broken } = terminal();
    writeFileSync(
      path,
      "```json " + TASK_METRICS_TAG + "\n" + JSON.stringify(broken) + "\n```\n\n",
      { flag: "a" },
    );
    const later = event({ at: "2026-09-03T10:09:00.000Z" });
    appendMetricEvent(path, later);
    appendTaskMetrics(path, terminal());

    assert.deepEqual(readMetricEvents(dir, "demo"), [good, later]);
    assert.deepEqual(readTaskMetrics(dir, "demo"), terminal());
    assert.equal(existsSync(path), true, "the file is never the casualty");
  });
});

// ── parity with the contract ─────────────────────────────────────────────────

test("the storage mirror agrees with contracts/metrics.ts on every vocabulary and on every fixture's verdict", () => {
  assert.deepEqual([...storage.METRIC_EVENT_KINDS], contract.MetricEventKind.options);
  assert.deepEqual([...storage.METRIC_EVENT_SOURCES], contract.MetricEventSource.options);
  assert.deepEqual([...storage.FIX_LOOPS], contract.FixLoop.options);
  assert.deepEqual([...storage.OPEN_ITEM_CLASSIFICATIONS], contract.OpenItemClassification.options);
  assert.deepEqual([...storage.METRIC_GATES], contract.MetricGate.options);
  assert.deepEqual([...storage.DOR_VERDICTS], contract.DorVerdict.options);
  assert.deepEqual(
    Object.fromEntries(Object.entries(storage.REQUIRED_EVENT_FIELDS).map(([k, v]) => [k, [...v]])),
    Object.fromEntries(Object.entries(contract.REQUIRED_EVENT_FIELDS).map(([k, v]) => [k, [...v]])),
  );

  const fixtures = [
    event(),
    event({ kind: "fix-round", loop: "critic", round: 2 }),
    event({ kind: "fix-round", round: 2 }), // missing loop
    event({ kind: "open-item", classification: "blocked" }),
    event({ kind: "open-item", detail: "x" }), // missing classification
    event({ kind: "critic-dispatch", critic: "marvin-tm-spec-critic", pass: 1 }),
    event({ kind: "critic-dispatch", critic: "marvin-tm-spec-critic" }), // missing pass
    event({
      kind: "critic-verdict",
      critic: "marvin-tm-spec-critic",
      pass: 1,
      verdict: "BLOCK",
      blockers: 2,
      warnings: 0,
    }),
    event({
      kind: "critic-verdict",
      critic: "marvin-tm-spec-critic",
      pass: 1,
      verdict: "NEEDS_CONTEXT",
      blockers: 0,
      warnings: 0,
    }), // not terminal
    event({ kind: "gate-call", gate: "dor", call: 1, verdict: "PASS WITH WARNINGS" }),
    event({ kind: "gate-call", gate: "dor", call: 1, verdict: "UNABLE" }), // not the gate's vocabulary
    event({ slug: "Not Kebab" }),
    event({ source: "nobody" }),
    event({ at: "yesterday" }),
  ];
  for (const f of fixtures) {
    assert.equal(
      MetricEventSchema.safeParse(f).success,
      contract.MetricEvent.safeParse(f).success,
      `mirror and contract disagree on ${JSON.stringify(f)}`,
    );
  }
  // …and the contract accepts every terminal block the storage reader accepts here.
  assert.equal(contract.TaskMetrics.safeParse(terminal()).success, true);
});
