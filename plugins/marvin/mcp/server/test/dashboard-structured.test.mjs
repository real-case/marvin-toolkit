import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { DashboardState } from "@marvin-toolkit/mcp-shared/contracts";
import { callTool } from "./_driver.mjs";

/** Call the `dashboard` tool once against the given project dir. */
function callDashboard(dir, args = {}) {
  return callTool("dashboard", args, {
    env: {
      CLAUDE_PROJECT_DIR: dir,
      MARVIN_TASKS_DIR: join(dir, ".marvin", "track"),
      MARVIN_TASKS_CONFIG: join(dir, ".marvin", "config.json"),
      MARVIN_MEMORY_DIR: join(dir, ".marvin", "memory"),
      MARVIN_HANDOFF_DIR: join(dir, ".marvin", "handoff"),
      // WP7: the usage-log middleware self-logs this very `dashboard` call.
      // Point the WRITER at a scratch dir so it never mutates the fixture the
      // READER asserts (`.marvin/usage/events.jsonl` under the project dir) —
      // these cases test the dashboard's parse of a fixed log, not the writer.
      MARVIN_USAGE_DIR: join(dir, ".marvin", "usage-writer-scratch"),
    },
  });
}

const textOf = (result) => result.content.map((c) => c.text).join("\n");

const DAY_MS = 24 * 60 * 60 * 1000;
/** ISO timestamp `days` before the wall clock (v2 ages are computed live). */
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS).toISOString();

/** Pin a file's mtime — "newest report in the area" and its age are mtime-driven. */
function pinAge(path, days) {
  const when = new Date(Date.now() - days * DAY_MS);
  utimesSync(path, when, when);
}

/**
 * The `audit-report` Tier-2 block (ADR-0024 #7) for the newest security report:
 * four findings across three severities, so `audits.security` proves bucketing.
 * The findings are deliberately NOT listed in severity order — a `medium` comes
 * first — so the rendered line pins the severity-ranked bucketing rather than
 * passing on document order.
 */
const AUDIT_BLOCK = JSON.stringify({
  kind: "threat-model",
  scanned_at: "2026-07-01T10:00:00Z",
  summary: { critical: 1, high: 1, medium: 2 },
  findings: [
    { id: "TM-3", severity: "medium", title: "No rate limit on login", category: "STRIDE-D" },
    {
      id: "TM-1",
      severity: "critical",
      title: "Unauthenticated admin route",
      category: "STRIDE-E",
    },
    { id: "TM-2", severity: "high", title: "Token in query string", category: "STRIDE-I" },
    { id: "TM-4", severity: "medium", title: "Verbose error bodies", category: "STRIDE-I" },
  ],
});

/** An ADR-0029 findings register for the newest refactor report. */
const REGISTER = [
  "# Refactoring smells — api",
  "",
  "## Findings register",
  "",
  "| ID | Title | Severity | Effort | Evidence | Direction |",
  "|----|-------|----------|--------|----------|-----------|",
  "| F1 | God module in the api layer | high | medium | `src/api.ts:1` | Split the module |",
  "| F2 | Duplicated request mapping | medium | small | `src/map.ts:20` | Extract a helper |",
  "| F3 | Dead feature flag | low | trivial | `src/flags.ts:8` | Delete the branch |",
  "",
].join("\n");

/** A fully populated `.marvin/` tree + ADR corpus + usage log. */
function populate(dir) {
  for (const sub of ["task", "track", "security", "refactor", "handoff", "memory", "usage"]) {
    mkdirSync(join(dir, ".marvin", sub), { recursive: true });
  }
  mkdirSync(join(dir, "docs", "adr"), { recursive: true });

  // task pipeline: one spec + a fresh verification.md (excluded from the spec count)
  writeFileSync(join(dir, ".marvin", "task", "001-thing.md"), "# spec");
  writeFileSync(join(dir, ".marvin", "task", "verification.md"), "# verification");

  // board: one wip task (default status vocabulary)
  writeFileSync(
    join(dir, ".marvin", "track", "001--demo.md"),
    [
      "---",
      "id: '001'",
      "type: feature",
      "status: wip",
      "title: Demo task",
      "branch: feat/001--demo",
      "created: 2026-07-01T00:00:00.000Z",
      "updated: 2026-07-01T00:00:00.000Z",
      "---",
      "Body.",
      "",
    ].join("\n"),
  );

  // MCP servers: the only file this fixture ADDS, and deliberately not a `.md`
  // — every artifact assertion below counts markdown files, so the counts hold.
  writeFileSync(
    join(dir, ".mcp.json"),
    JSON.stringify({ marvin: { command: "node" }, context7: { command: "npx" } }),
  );

  // security: two reports; refactor: one of each kind; handoff: one doc.
  // The v2 digests read the newest report per area, so EVERY mtime here is
  // pinned rather than left to write order. `001-scan.md` stays prose-only AND
  // newest, so picking `002-threat-model.md` proves "skip the unparseable, take
  // the newest that parses"; pinning it at 0 days is also what keeps the v1
  // `newest_age_days: 0` assertion true, so the invariant is explicit.
  writeFileSync(join(dir, ".marvin", "security", "001-scan.md"), "# scan");
  pinAge(join(dir, ".marvin", "security", "001-scan.md"), 0);
  writeFileSync(
    join(dir, ".marvin", "security", "002-threat-model.md"),
    `# tm\n\nProse.\n\n\`\`\`json audit-report\n${AUDIT_BLOCK}\n\`\`\`\n`,
  );
  pinAge(join(dir, ".marvin", "security", "002-threat-model.md"), 2);
  writeFileSync(join(dir, ".marvin", "refactor", "001-audit-core.md"), "# audit");
  pinAge(join(dir, ".marvin", "refactor", "001-audit-core.md"), 5);
  // the findings table goes in the NEWEST register, so the digest proves
  // severity bucketing rather than passing on a zero-finding register
  writeFileSync(join(dir, ".marvin", "refactor", "002-smells-api.md"), REGISTER);
  pinAge(join(dir, ".marvin", "refactor", "002-smells-api.md"), 1);
  writeFileSync(join(dir, ".marvin", "refactor", "003-plan-core.md"), "# plan");
  writeFileSync(
    join(dir, ".marvin", "handoff", "001-h.md"),
    [
      "---",
      "id: '001'",
      "slug: demo-handoff",
      "objective: Finish the dashboard rework",
      "branch: feat/dashboard",
      `created: ${daysAgo(3)}`,
      "---",
      "# handoff",
      "",
    ].join("\n"),
  );

  // lessons: index (excluded) + two typed lessons
  writeFileSync(join(dir, ".marvin", "memory", "MEMORY.md"), "# index");
  writeFileSync(
    join(dir, ".marvin", "memory", "a-gotcha.md"),
    "---\nid: a-gotcha\ntype: gotcha\ntitle: A gotcha\ncreated: 2026-07-01\ntags: infra, ci\n---\nBody.\n",
  );
  writeFileSync(
    join(dir, ".marvin", "memory", "a-pitfall.md"),
    "---\nid: a-pitfall\ntype: pitfall\ntitle: A pitfall\ncreated: 2026-07-02\n---\nBody.\n",
  );

  // ADR corpus: one accepted (table style), one proposed (heading style),
  // one unparseable file for the malformed channel
  writeFileSync(
    join(dir, "docs", "adr", "0001-first.md"),
    [
      "# ADR 0001 — First decision",
      "",
      "| Field | Value |",
      "| ----- | ----- |",
      "| Status | **Accepted** |",
      "| Date | 2026-07-01 |",
      "",
      "## Context",
      "x",
      "## Decision",
      "y",
      "## Consequences",
      "z",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "docs", "adr", "0002-second.md"),
    ["# Second decision", "", "## Status", "", "Proposed", "", "## Context", "x", ""].join("\n"),
  );
  writeFileSync(join(dir, "docs", "adr", "0003-broken.md"), "# Broken record, no status\n");

  // usage log (WP7's format): three valid events among malformed lines
  writeFileSync(
    join(dir, ".marvin", "usage", "events.jsonl"),
    [
      '{"ts":"2026-07-01T10:00:00.000Z","kind":"prompt","name":"commit"}',
      "not json at all",
      '{"ts":"2026-07-02T10:00:00.000Z","kind":"tool","name":"task"}',
      '{"kind":"prompt"}', // no ts/name
      '{"ts":"2026-07-02T11:00:00.000Z","kind":"widget","name":"nope"}', // bad kind
      "[1,2,3]", // not an object
      '{"ts":"2026-07-03T10:00:00.000Z","kind":"prompt","name":"commit"}',
      "",
    ].join("\n"),
  );
}

test("dashboard aggregates a populated project into text + a valid extended DashboardState", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-dash-"));
  try {
    populate(dir);
    const result = await callDashboard(dir);
    const text = textOf(result);

    // every section renders
    for (const heading of [
      "## Project",
      "## Board",
      "## Artifacts",
      "## Decisions (ADR)",
      "## Lessons",
      "## Usage",
      "## Commands",
    ]) {
      assert.ok(text.includes(heading), `section ${heading} rendered`);
    }
    assert.match(text, /- wip: 1/);
    assert.match(text, /- Specs: 1/);
    assert.match(text, /- Verification: `verification\.md` 0 day\(s\) old/);
    assert.match(text, /- Security reports: 2 .*newest 0 day\(s\) old/);
    assert.match(text, /- Refactor: 1 audit · 1 smells · 1 plan/);
    assert.match(text, /- Handoffs: 1/);
    assert.match(text, /- Corpus: `docs\/adr` \(detected\) · 2 record\(s\)/);
    assert.match(text, /proposed: 1 · accepted: 1/);
    assert.match(text, /⚠ malformed: 1 file\(s\)/);
    assert.match(text, /- 2 lesson\(s\) — gotcha: 1 · pitfall: 1/);
    // malformed usage lines are skipped: 3 events, not 7
    assert.match(text, /- 3 event\(s\) between 2026-07-01 and 2026-07-03/);
    assert.match(text, /`commit` \(prompt\) ×2/);

    // structuredContent conforms to the extended shared contract
    const sc = result.structuredContent;
    const parsed = DashboardState.safeParse(sc);
    assert.ok(parsed.success, `contract accepts payload: ${JSON.stringify(parsed.error?.issues)}`);

    assert.equal(sc.board_counts.wip, 1);
    assert.equal(sc.board_role_counts.wip, 1);
    assert.deepEqual(sc.artifacts, {
      specs: 1,
      handoffs: 1,
      audits: 2,
      lessons: 2,
      verification: { exists: true, age_days: 0 },
    });
    assert.deepEqual(sc.adr, {
      dir: "docs/adr",
      total: 2,
      counts: { proposed: 1, accepted: 1, deprecated: 0, superseded: 0, rejected: 0 },
      malformed: 1,
    });
    assert.deepEqual(sc.security, { reports: 2, newest_age_days: 0 });
    assert.deepEqual(sc.refactor, { audits: 1, smells: 1, plans: 1 });
    assert.equal(sc.lessons.total, 2);
    assert.deepEqual(sc.lessons.by_tag, { infra: 1, ci: 1 });
    assert.deepEqual(sc.usage, {
      events: 3,
      window: { from: "2026-07-01T10:00:00.000Z", to: "2026-07-03T10:00:00.000Z" },
      top: [
        { kind: "prompt", name: "commit", count: 2 },
        { kind: "tool", name: "task", count: 1 },
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dashboard emits the four v2 sections in structuredContent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-dash-"));
  try {
    populate(dir);
    const sc = (await callDashboard(dir)).structuredContent;
    assert.ok(
      DashboardState.safeParse(sc).success,
      `contract accepts the v2 payload: ${JSON.stringify(DashboardState.safeParse(sc).error?.issues)}`,
    );

    // 1. servers — the union of `.mcp.json` + settings, sorted, all enabled
    assert.deepEqual(sc.servers, [
      { name: "context7", enabled: true },
      { name: "marvin", enabled: true },
    ]);

    // 2. current work — the active board card as a full TaskCard, plus the
    //    unshipped pipeline spec (`001-thing.md` carries no status = in flight)
    assert.deepEqual(sc.current_tasks.board, [
      {
        id: "001",
        type: "feature",
        status: { key: "wip", role: "wip" },
        title: "Demo task",
        branch: "feat/001--demo",
        tracker_url: null,
        pr: null,
        created: "2026-07-01T00:00:00.000Z",
        updated: "2026-07-01T00:00:00.000Z",
      },
    ]);
    assert.deepEqual(sc.current_tasks.specs, [{ slug: "thing", title: "spec", id: "001" }]);

    // 3. handoffs — age comes from the frontmatter `created`, not the mtime
    assert.deepEqual(sc.handoffs, [
      { slug: "demo-handoff", objective: "Finish the dashboard rework", age_days: 3 },
    ]);

    // 4. audits — the newest PARSEABLE security report (`001-scan.md` is prose
    //    only and newer, and is skipped) and the newest refactor register
    assert.deepEqual(sc.audits.security, {
      scanned_age_days: 2,
      total: 4,
      by_severity: { critical: 1, high: 1, medium: 2 },
      newest_report: "002-threat-model.md",
    });
    assert.deepEqual(sc.audits.refactor, {
      scanned_age_days: 1,
      total: 3,
      by_severity: { high: 1, medium: 1, low: 1 },
      newest_report: "002-smells-api.md",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dashboard renders the current work, handoffs and audits text sections", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-dash-"));
  try {
    populate(dir);
    const text = textOf(await callDashboard(dir));

    for (const heading of ["## Current work", "## Handoffs", "## Audits"]) {
      assert.ok(text.includes(heading), `section ${heading} rendered`);
    }
    assert.match(text, /- MCP servers: `context7` ✓ · `marvin` ✓/);
    assert.match(
      text,
      /- Active cards \(wip\/review\):\n {2}- `001` Demo task · wip · updated 2026-07-01/,
    );
    assert.match(text, /- Pipeline specs in flight:\n {2}- `001` spec/);
    assert.match(text, /- `demo-handoff` Finish the dashboard rework · 3 day\(s\) old/);
    assert.match(
      text,
      /- Security: 4 finding\(s\) · critical: 1 · high: 1 · medium: 2 · `002-threat-model\.md` · 2 day\(s\) old/,
    );
    assert.match(
      text,
      /- Refactor: 3 finding\(s\) · high: 1 · medium: 1 · low: 1 · `002-smells-api\.md` · 1 day\(s\) old/,
    );

    // the section filter narrows the text to Audits alone…
    const narrowed = await callDashboard(dir, { section: "audits" });
    const narrowedText = textOf(narrowed);
    assert.ok(narrowedText.includes("## Audits"), "requested section rendered");
    for (const heading of ["## Current work", "## Handoffs", "## Board", "## Artifacts"]) {
      assert.ok(!narrowedText.includes(heading), `section ${heading} omitted`);
    }
    // …while structuredContent stays complete
    const sc = narrowed.structuredContent;
    assert.ok(DashboardState.safeParse(sc).success);
    assert.equal(sc.current_tasks.board.length, 1, "payload ignores the section filter");
    assert.equal(sc.handoffs.length, 1);
    assert.ok(sc.servers.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dashboard zero-state emits the v2 sections in their empty form", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-dash-"));
  try {
    const result = await callDashboard(dir);
    const sc = result.structuredContent;
    assert.ok(DashboardState.safeParse(sc).success, "zero-state v2 payload conforms");

    // present-but-empty, never absent: a consumer can tell "the dashboard ran
    // and found nothing" from the `help` tool's narrower payload
    for (const key of ["servers", "current_tasks", "handoffs", "audits"]) {
      assert.ok(key in sc, `${key} present on a fresh project`);
    }
    assert.deepEqual(sc.servers, []);
    assert.deepEqual(sc.current_tasks, { board: [], specs: [] });
    assert.deepEqual(sc.handoffs, []);
    assert.deepEqual(sc.audits, { security: null, refactor: null });

    const text = textOf(result);
    assert.match(text, /- MCP servers: _none configured_/);
    assert.match(text, /_No active board cards — nothing in wip or review\._/);
    assert.match(text, /_No pipeline specs in flight under `\.marvin\/task\/`\._/);
    assert.match(text, /_No handoffs yet — `\/marvin:handoff` captures the first one\._/);
    assert.match(text, /- Security: _no report yet — `\/marvin:sec-scan` writes one\._/);
    assert.match(text, /- Refactor: _no report yet — `\/marvin:refactor-audit` writes one\._/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dashboard zero-state: a fresh project renders every section and validates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-dash-"));
  try {
    const result = await callDashboard(dir);
    const text = textOf(result);

    assert.match(text, /# marvin · toolbox dashboard · v\d+\.\d+\.\d+/);
    assert.match(text, /_\(not created yet\)_/); // config absent
    assert.match(text, /- todo: 0/);
    assert.match(text, /- Specs: 0/);
    assert.match(text, /- Verification: none yet/);
    assert.match(text, /- Corpus: `docs\/adr` \(default\) · 0 record\(s\)/);
    assert.match(text, /_No records yet/);
    assert.match(text, /_No lessons captured yet/);
    assert.match(text, /_No usage log yet/);

    const sc = result.structuredContent;
    assert.ok(DashboardState.safeParse(sc).success, "zero-state payload conforms");
    assert.deepEqual(sc.artifacts, {
      specs: 0,
      handoffs: 0,
      audits: 0,
      lessons: 0,
      verification: { exists: false, age_days: null },
    });
    assert.equal(sc.adr.total, 0);
    assert.equal(sc.adr.counts.accepted, 0);
    assert.deepEqual(sc.security, { reports: 0, newest_age_days: null });
    assert.deepEqual(sc.refactor, { audits: 0, smells: 0, plans: 0 });
    assert.equal(sc.lessons.total, 0);
    assert.ok(!("usage" in sc), "usage section absent without a log");

    // command groups cover the whole registry
    const groups = Object.fromEntries(sc.command_groups.map((g) => [g.group, g.count]));
    for (const g of ["core", "adr", "pr", "task", "sec", "refactor", "track"]) {
      assert.ok(groups[g] > 0, `group ${g} present`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dashboard partial project: present dirs count, missing dirs stay zero", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-dash-"));
  try {
    // only the security inventory exists
    mkdirSync(join(dir, ".marvin", "security"), { recursive: true });
    writeFileSync(join(dir, ".marvin", "security", "001-scan.md"), "# scan");

    const result = await callDashboard(dir);
    const sc = result.structuredContent;
    assert.ok(DashboardState.safeParse(sc).success, "partial payload conforms");
    assert.deepEqual(sc.security, { reports: 1, newest_age_days: 0 });
    assert.equal(sc.artifacts.specs, 0);
    assert.equal(sc.artifacts.handoffs, 0);
    assert.deepEqual(sc.refactor, { audits: 0, smells: 0, plans: 0 });
    assert.ok(!("usage" in sc));
    assert.match(textOf(result), /- Security reports: 1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dashboard `section` narrows the text; structuredContent stays complete", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-dash-"));
  try {
    const result = await callDashboard(dir, { section: "adr" });
    const text = textOf(result);
    assert.ok(text.includes("## Decisions (ADR)"), "requested section rendered");
    assert.ok(!text.includes("## Board"), "other sections omitted");
    assert.ok(!text.includes("## Usage"), "other sections omitted");
    // the payload ignores the filter
    const sc = result.structuredContent;
    assert.ok(DashboardState.safeParse(sc).success);
    assert.ok(sc.adr && sc.security && sc.refactor && sc.lessons, "full payload emitted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dashboard unknown `section` falls back to the full report with a hint", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-dash-"));
  try {
    const text = textOf(await callDashboard(dir, { section: "zzz" }));
    assert.match(text, /Unknown section `zzz`/);
    assert.ok(text.includes("## Board"), "still renders all sections");
    assert.ok(text.includes("## Commands"), "still renders all sections");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
