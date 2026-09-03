import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { callTool, getPrompt, listTools } from "./_driver.mjs";
import { importTs } from "./_tsload.mjs";

/**
 * The series aggregation (ADR-0043 §5, WP5). The first half is pure, through
 * `_tsload.mjs`: the stat excludes absent fields from its denominator, the
 * escaped-defect join credits the right earlier spec, the filters narrow, and
 * the dashboard summary picks the newest record. The second half drives
 * `metrics action: "series"` over stdio against a fixture directory whose
 * records were produced by the shipped roll-up itself, and proves the door:
 * the `task-metrics` prompt, the tool's `series` description, and Q11 null
 * without `gh`.
 */

const { aggregateSeries, escapedDefects, filterRecords, stat, summarizeSeries } = await importTs(
  "src/lib/metrics-series.ts",
);
const { rollUpMetrics } = await importTs("src/lib/metrics-rollup.ts");
const { appendMetricEvent, appendTaskMetrics, metricsRecordPath } =
  await importTs("src/storage/metrics.ts");

const T = (hhmmss, day = "03") => `2026-09-${day}T${hhmmss}.000Z`;
const SEAL = "bbbbbbbbbbbbbbbb";

/** A rolled-up block from the SHIPPED roll-up, so the fixture can never drift from the contract. */
function block(slug, { type = "feature", day = "03", criteria = 2, gaps = 1, active = true } = {}) {
  return rollUpMetrics({
    slug,
    base_branch: "dev",
    now: T("12:00:00", day),
    spec: {
      path: `.marvin/task/001-${slug}.md`,
      frontmatter: { type, risk: "low", created: `2026-09-${day}`, contract_sha: SEAL },
      contract: {
        files: [{ id: "F1", path: `src/${slug}.ts`, action: "edit" }],
        criteria: Array.from({ length: criteria }, (_, i) => ({
          id: `AC${i + 1}`,
          statement: "s",
          implemented_by: ["F1"],
          oracle: { kind: i === 0 ? "test" : "prose-review", ref: "t::a" },
        })),
      },
      stamped_sha: SEAL,
      actual_sha: SEAL,
    },
    progress: active
      ? [
          {
            slug,
            source: "task-start",
            step: "1.5",
            kind: "step",
            detail: "d",
            at: T("10:00:00", day),
          },
          {
            slug,
            source: "task-start",
            step: "9F",
            kind: "step",
            detail: "d",
            at: T("10:10:00", day),
          },
          {
            slug,
            source: "task-implement",
            step: "2.5",
            kind: "step",
            detail: "d",
            at: T("11:00:00", day),
          },
          {
            slug,
            source: "task-implement",
            step: "5F",
            kind: "criterion",
            criterion: "AC1",
            detail: "d",
            at: T("11:02:00", day),
          },
        ]
      : null,
    oracles: null,
    verify_journal: active
      ? [
          {
            slug,
            kind: "run",
            at: T("11:05:00", day),
            verdict: "PASS",
            mode: "feature",
            execution: "parallel",
            only: null,
            gates: [{ name: "test", status: "pass", durationMs: 10 }],
            wallClockMs: 10,
            sumOfGatesMs: 10,
            head_sha: null,
          },
        ]
      : null,
    verify_result: null,
    critique: null,
    events: Array.from({ length: gaps }, (_, i) => ({
      slug,
      source: "task-implement",
      step: "5F",
      kind: "spec-gap",
      detail: `gap ${i}`,
      at: T("11:01:00", day),
    })),
    git: null,
  });
}

test("stat: count, mean, median and max over the PRESENT values only; empty is all-null", () => {
  assert.deepEqual(stat([]), { count: 0, mean: null, median: null, max: null });
  assert.deepEqual(stat([null, null]), { count: 0, mean: null, median: null, max: null });
  assert.deepEqual(stat([4, null, 2]), { count: 2, mean: 3, median: 3, max: 4 });
  assert.deepEqual(stat([5, 1, 3]), { count: 3, mean: 3, median: 3, max: 5 });
  assert.deepEqual(stat([1, 2, 3, 10]), { count: 4, mean: 4, median: 2.5, max: 10 });
});

test("escaped defects: each shipped bugfix credits the EARLIER shipped specs whose files intersect its own", () => {
  const shipped = [
    {
      slug: "alpha",
      number: 1,
      type: "feature",
      created: "2026-09-01",
      files: ["src/a.ts", "src/shared.ts"],
    },
    { slug: "beta", number: 2, type: "feature", created: "2026-09-02", files: ["src/b.ts"] },
    {
      slug: "fix-shared",
      number: 3,
      type: "bugfix",
      created: "2026-09-03",
      files: ["src/shared.ts", "test/shared.test.ts"],
    },
    { slug: "fix-b", number: 4, type: "bugfix", created: "2026-09-04", files: ["src/b.ts"] },
    // a LATER feature touching src/a.ts is not credited by an earlier bugfix
    { slug: "gamma", number: 5, type: "feature", created: "2026-09-05", files: ["src/a.ts"] },
    // a bugfix touching only its own new files credits nobody
    { slug: "fix-lonely", number: 6, type: "bugfix", created: "2026-09-06", files: ["src/new.ts"] },
  ];
  assert.deepEqual(escapedDefects(shipped), {
    by_spec: { alpha: 1, beta: 1 },
    pairs: [
      { bugfix: "fix-shared", credited: ["alpha"] },
      { bugfix: "fix-b", credited: ["beta"] },
    ],
  });
  // unnumbered legacy specs sort last, by created date
  const legacy = [
    { slug: "old", number: null, type: "feature", created: "2026-01-01", files: ["x.ts"] },
    { slug: "older-fix", number: null, type: "bugfix", created: "2026-02-01", files: ["x.ts"] },
    { slug: "numbered", number: 1, type: "feature", created: "2026-03-01", files: ["x.ts"] },
  ];
  assert.deepEqual(escapedDefects(legacy).pairs, [
    { bugfix: "older-fix", credited: ["numbered", "old"] },
  ]);
});

test("aggregateSeries: coverage, per-metric stats over present values, Q12 credit, and the filters", () => {
  const records = [
    {
      slug: "alpha",
      filename: "001-alpha.md",
      events: 1,
      block: block("alpha", { day: "01", gaps: 1 }),
      review_fix_commits: 2,
    },
    {
      slug: "fix-alpha",
      filename: "002-fix-alpha.md",
      events: 3,
      block: block("fix-alpha", { type: "bugfix", day: "03", gaps: 3 }),
      review_fix_commits: null,
    },
    { slug: "gamma", filename: "003-gamma.md", events: 2, block: null, review_fix_commits: null },
  ];
  const shipped = [
    { slug: "alpha", number: 1, type: "feature", created: "2026-09-01", files: ["src/alpha.ts"] },
    {
      slug: "fix-alpha",
      number: 2,
      type: "bugfix",
      created: "2026-09-03",
      files: ["src/alpha.ts"],
    },
    { slug: "delta", number: 4, type: "feature", created: "2026-09-04", files: ["src/delta.ts"] }, // shipped, no record
  ];
  const s = aggregateSeries({
    dir: ".marvin/metrics",
    now: T("13:00:00"),
    records,
    shipped,
    filters: {},
  });

  assert.deepEqual(s.coverage, {
    records: 3,
    rolled_up: 2,
    events_only: 1,
    shipped_specs: 3,
    shipped_with_record: 2,
  });
  assert.deepEqual(
    s.time.active_ms,
    { count: 2, mean: 900000, median: 900000, max: 900000 },
    "10m + 2m + 3m, both records",
  );
  assert.deepEqual(s.quality.spec_gaps, { count: 2, mean: 2, median: 2, max: 3 });
  assert.deepEqual(s.quality.oracle_strength_share, { count: 2, mean: 0.5, median: 0.5, max: 0.5 });
  assert.equal(s.quality.freshness_waivers.count, 2, "present on both (0 each)");
  assert.deepEqual(
    s.quality.review_fix_commits,
    { count: 1, mean: 2, median: 2, max: 2 },
    "Q11 over the record where gh answered",
  );
  assert.deepEqual(
    s.quality.escaped_defects,
    { count: 2, mean: 0.5, median: 0.5, max: 1 },
    "Q12: alpha is credited once, fix-alpha zero — both shipped",
  );
  assert.deepEqual(s.escaped_defects, {
    by_spec: { alpha: 1 },
    pairs: [{ bugfix: "fix-alpha", credited: ["alpha"] }],
  });
  assert.equal(s.time.gate_efficiency.count, 0, "absent everywhere: n = 0, never a zero");
  assert.equal(s.record, null);
  assert.deepEqual(
    s.records.map((r) => [r.slug, r.type, r.rolled_up_at?.slice(0, 10) ?? null, r.events]),
    [
      ["alpha", "feature", "2026-09-01", 1],
      ["fix-alpha", "bugfix", "2026-09-03", 3],
      ["gamma", null, null, 2],
    ],
  );

  // type narrows to rolled-up records of that type; the events-only record drops out
  const bug = aggregateSeries({
    dir: ".marvin/metrics",
    now: T("13:00:00"),
    records,
    shipped,
    filters: { type: "bugfix" },
  });
  assert.deepEqual(bug.coverage, {
    records: 1,
    rolled_up: 1,
    events_only: 0,
    shipped_specs: 3,
    shipped_with_record: 1,
  });
  assert.equal(bug.quality.spec_gaps.max, 3);
  // since keeps records rolled up on or after the date
  const since = aggregateSeries({
    dir: ".marvin/metrics",
    now: T("13:00:00"),
    records,
    shipped,
    filters: { since: "2026-09-02" },
  });
  assert.deepEqual(
    since.records.map((r) => r.slug),
    ["fix-alpha"],
  );
  // slug renders one record in full
  const one = aggregateSeries({
    dir: ".marvin/metrics",
    now: T("13:00:00"),
    records,
    shipped,
    filters: { slug: "alpha" },
  });
  assert.equal(one.record.slug, "alpha");
  assert.equal(one.coverage.records, 1);
  assert.deepEqual(filterRecords(records, { slug: "nope" }), []);
  // no corpus at all: coverage says so and Q12 is null
  const noCorpus = aggregateSeries({
    dir: ".marvin/metrics",
    now: T("13:00:00"),
    records,
    shipped: null,
    filters: {},
  });
  assert.equal(noCorpus.coverage.shipped_specs, null);
  assert.equal(noCorpus.escaped_defects, null);
  assert.equal(noCorpus.quality.escaped_defects.count, 0);
});

test("summarizeSeries: counts, the newest roll-up, two medians; a fresh project is all zero and null", () => {
  assert.deepEqual(summarizeSeries([]), {
    records: 0,
    rolled_up: 0,
    newest: null,
    median_active_ms: null,
    median_spec_gaps: null,
  });
  const s = summarizeSeries([
    {
      slug: "alpha",
      filename: "001-alpha.md",
      events: 1,
      block: block("alpha", { day: "01" }),
      review_fix_commits: null,
    },
    {
      slug: "beta",
      filename: "002-beta.md",
      events: 1,
      block: block("beta", { day: "03", gaps: 3 }),
      review_fix_commits: null,
    },
    { slug: "gamma", filename: "003-gamma.md", events: 2, block: null, review_fix_commits: null },
  ]);
  assert.deepEqual(s, {
    records: 3,
    rolled_up: 2,
    newest: { slug: "beta", rolled_up_at: T("12:00:00", "03") },
    median_active_ms: 900000,
    median_spec_gaps: 2,
  });
});

// ── over stdio ───────────────────────────────────────────────────────────────

const textOf = (r) => r.content.map((c) => c.text).join("\n");
const blockOf = (text, tag) => {
  const m = text.match(new RegExp("```json " + tag + "\\n([\\s\\S]*?)\\n```"));
  assert.ok(m, `no ${tag} block in:\n${text}`);
  return JSON.parse(m[1]);
};

const spec = (slug, type, files) =>
  [
    "---",
    `slug: ${slug}`,
    `type: ${type}`,
    "status: shipped",
    "created: 2026-09-03",
    "---",
    "",
    `# ${slug}`,
    "",
    "```yaml spec-contract",
    "files:",
    ...files.flatMap((p, i) => [`  - id: F${i + 1}`, `    path: ${p}`, "    action: edit"]),
    "criteria:",
    "  - id: AC1",
    "    statement: s",
    "    implemented_by: [F1]",
    '    oracle: { kind: command, ref: "true" }',
    "```",
    "",
  ].join("\n");

/** A project with two shipped specs, two rolled-up records and one events-only record. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "marvin-metrics-series-"));
  const task = join(dir, ".marvin", "task");
  mkdirSync(task, { recursive: true });
  writeFileSync(join(task, "001-alpha.md"), spec("alpha", "feature", ["src/alpha.ts"]));
  writeFileSync(join(task, "002-fix-alpha.md"), spec("fix-alpha", "bugfix", ["src/alpha.ts"]));
  const metrics = join(dir, ".marvin", "metrics");
  appendTaskMetrics(metricsRecordPath(metrics, "001-alpha"), block("alpha", { day: "01" }));
  appendTaskMetrics(
    metricsRecordPath(metrics, "002-fix-alpha"),
    block("fix-alpha", { type: "bugfix", day: "03", gaps: 3 }),
  );
  appendMetricEvent(metricsRecordPath(metrics, "003-gamma"), {
    slug: "gamma",
    source: "task-start",
    step: "7F",
    kind: "gate-call",
    gate: "dor",
    call: 1,
    verdict: "PASS",
    contract_sha: null,
    at: T("10:00:00"),
  });
  return dir;
}

test("series over stdio: the aggregate, the coverage line, the filters, one record in full, and Q11 null without gh", async () => {
  const dir = fixture();
  try {
    const all = await callTool("metrics", { action: "series", projectRoot: dir });
    assert.notEqual(all.isError, true, textOf(all));
    const text = textOf(all);
    const s = blockOf(text, "metrics-series");
    assert.deepEqual(s.coverage, {
      records: 3,
      rolled_up: 2,
      events_only: 1,
      shipped_specs: 2,
      shipped_with_record: 2,
    });
    assert.equal(s.dir, ".marvin/metrics");
    assert.match(
      text,
      /\*\*Coverage:\*\* 3 record\(s\) · 2 rolled up · 1 recorded but not rolled up · the series covers 2 of 2 shipped spec\(s\)/,
    );
    assert.match(text, /## Time[\s\S]*\| T4 \| active pipeline time \| 2 \| 15m \| 15m \| 15m \|/);
    assert.match(text, /## Quality[\s\S]*\| Q7 \| spec gaps \| 2 \| 2 \| 2 \| 3 \|/);
    assert.match(
      text,
      /## Rework[\s\S]*\| R4 \| verification runs before the first green \| 2 \| 0 \| 0 \| 0 \|/,
    );
    assert.match(text, /## Escaped defects \(Q12\)\n- bugfix `fix-alpha` → credited to `alpha`/);
    assert.match(text, /## Records \(3\)/);
    assert.equal(s.quality.review_fix_commits.count, 0, "Q11: no `## Delivery` URL on either spec");
    assert.deepEqual(all.structuredContent.coverage, s.coverage);

    const bug = await callTool("metrics", { action: "series", type: "bugfix", projectRoot: dir });
    assert.equal(blockOf(textOf(bug), "metrics-series").coverage.records, 1);
    assert.match(textOf(bug), /\*\*Filters:\*\* type bugfix/);

    const since = await callTool("metrics", {
      action: "series",
      since: "2026-09-02",
      projectRoot: dir,
    });
    assert.deepEqual(
      blockOf(textOf(since), "metrics-series").records.map((r) => r.slug),
      ["fix-alpha"],
    );
    const badSince = await callTool("metrics", {
      action: "series",
      since: "yesterday",
      projectRoot: dir,
    });
    assert.equal(badSince.isError, true);
    assert.match(textOf(badSince), /YYYY-MM-DD/);

    const one = await callTool("metrics", { action: "series", slug: "alpha", projectRoot: dir });
    const oneText = textOf(one);
    assert.match(oneText, /^# Task metrics — alpha/);
    assert.match(
      oneText,
      /\*\*Record:\*\* `\.marvin\/metrics\/001-alpha\.md` · terminal blocks: 1/,
    );
    assert.match(oneText, /- T4 active pipeline time: 15m/);
    assert.equal(blockOf(oneText, "metrics-series").record.slug, "alpha");

    const eventsOnly = await callTool("metrics", {
      action: "series",
      slug: "gamma",
      projectRoot: dir,
    });
    assert.match(
      textOf(eventsOnly),
      /1 live event\(s\) and no terminal block — recorded, not yet rolled up/,
    );
    const none = await callTool("metrics", { action: "series", slug: "nope", projectRoot: dir });
    assert.match(textOf(none), /No metrics record for `nope`/);

    // Q11 is null without `gh`: a PATH that holds node and git but no gh cannot
    // change the answer for a corpus that carries no PR URL, and must not error.
    const noGh = await callTool(
      "metrics",
      { action: "series", projectRoot: dir },
      { env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin` } },
    );
    assert.notEqual(noGh.isError, true, textOf(noGh));
    assert.equal(blockOf(textOf(noGh), "metrics-series").quality.review_fix_commits.count, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("series on a fresh project is the zero state, and a filter that matches nothing says so", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-metrics-series-empty-"));
  try {
    const r = await callTool("metrics", { action: "series", projectRoot: dir });
    assert.notEqual(r.isError, true);
    assert.match(textOf(r), /_No metrics records yet/);
    const s = blockOf(textOf(r), "metrics-series");
    assert.deepEqual(s.coverage, {
      records: 0,
      rolled_up: 0,
      events_only: 0,
      shipped_specs: null,
      shipped_with_record: null,
    });
    assert.equal(s.escaped_defects, null);
    const filtered = await callTool("metrics", {
      action: "series",
      type: "bugfix",
      projectRoot: dir,
    });
    assert.match(textOf(filtered), /_No rolled-up record matches the filters\._/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the door: /marvin:task-metrics is an inline prompt that calls the series action, and the tool describes it", async () => {
  const prompt = await getPrompt("task-metrics");
  const body = prompt.messages.map((m) => m.content.text).join("\n");
  assert.match(body, /`metrics` MCP tool/);
  assert.match(body, /action: "series"/);
  assert.match(body, /coverage line/);
  const tools = await listTools();
  const metrics = tools.tools.find((t) => t.name === "metrics");
  assert.match(metrics.description, /action: "series"/);
  assert.match(metrics.description, /\/marvin:task-metrics/);
  assert.deepEqual(metrics.inputSchema.properties.action.enum, ["record", "rollup", "series"]);
});
