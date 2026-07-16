import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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

  // security: two reports; refactor: one of each kind; handoff: one doc
  writeFileSync(join(dir, ".marvin", "security", "001-scan.md"), "# scan");
  writeFileSync(join(dir, ".marvin", "security", "002-threat-model.md"), "# tm");
  writeFileSync(join(dir, ".marvin", "refactor", "001-audit-core.md"), "# audit");
  writeFileSync(join(dir, ".marvin", "refactor", "002-smells-api.md"), "# smells");
  writeFileSync(join(dir, ".marvin", "refactor", "003-plan-core.md"), "# plan");
  writeFileSync(join(dir, ".marvin", "handoff", "001-h.md"), "# handoff");

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
