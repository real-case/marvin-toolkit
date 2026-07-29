import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AdrCorpusSummary,
  DashboardState,
  UsageSummary,
  VerificationFreshness,
} from "../dist/contracts/index.js";
import * as contracts from "../dist/contracts/index.js";

/**
 * The ADR-0030 DashboardState extension: whole-toolbox sections are optional
 * (backward compatible with the `help` tool's narrower payload) and each
 * section schema validates fail-closed on its own.
 */

const BASE = {
  version: "0.12.0",
  paths: { project: "/p", tasks_dir: "/p/.marvin/track", config_path: "/p/.marvin/config.json" },
  config: {
    base_branch: "dev",
    tracker_url_template: null,
    statuses: [
      { key: "todo", role: "todo" },
      { key: "wip", role: "wip" },
      { key: "done", role: "done" },
    ],
  },
  board_counts: { todo: 1, wip: 0, done: 2 },
  board_role_counts: { todo: 1, wip: 0, done: 2 },
  git: { has_git: true, has_gh: false, branch: "dev" },
  artifacts: { specs: 1, handoffs: 0, audits: 2, lessons: 3 },
  command_groups: [{ group: "core", count: 13 }],
};

test("DashboardState still accepts the help tool's narrow payload (backward compatible)", () => {
  const parsed = DashboardState.safeParse(BASE);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test("DashboardState accepts the full ADR-0030 extension", () => {
  const parsed = DashboardState.safeParse({
    ...BASE,
    artifacts: { ...BASE.artifacts, verification: { exists: true, age_days: 2 } },
    adr: {
      dir: "docs/adr",
      total: 30,
      counts: { proposed: 1, accepted: 27, deprecated: 0, superseded: 2, rejected: 0 },
      malformed: 0,
    },
    lessons: { total: 3, by_type: { gotcha: 2, pitfall: 1 }, by_tag: { ci: 1 } },
    usage: {
      events: 12,
      window: { from: "2026-07-01T10:00:00.000Z", to: "2026-07-03T09:00:00.000Z" },
      top: [{ kind: "prompt", name: "commit", count: 5 }],
    },
  });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test("VerificationFreshness: age is a nonnegative integer or null", () => {
  assert.equal(VerificationFreshness.safeParse({ exists: false, age_days: null }).success, true);
  assert.equal(VerificationFreshness.safeParse({ exists: true, age_days: 0 }).success, true);
  assert.equal(VerificationFreshness.safeParse({ exists: true, age_days: -1 }).success, false);
  assert.equal(VerificationFreshness.safeParse({ exists: true }).success, false);
});

test("AdrCorpusSummary: status counts stay on the closed vocabulary", () => {
  const ok = AdrCorpusSummary.safeParse({
    dir: "docs/adr",
    total: 1,
    counts: { accepted: 1 },
    malformed: 0,
  });
  assert.equal(ok.success, true);
  const bad = AdrCorpusSummary.safeParse({
    dir: "docs/adr",
    total: 1,
    counts: { shipped: 1 }, // not an AdrStatus
    malformed: 0,
  });
  assert.equal(bad.success, false);
  assert.equal(
    AdrCorpusSummary.safeParse({ dir: "", total: 0, counts: {}, malformed: 0 }).success,
    false,
  );
});

test("the v1 SecurityInventory / RefactorInventory schemas are gone from the surface", () => {
  assert.equal(contracts.SecurityInventory, undefined);
  assert.equal(contracts.RefactorInventory, undefined);
});

test("DashboardState no longer carries the v1 security / refactor fields", () => {
  // zod STRIPS unknown keys rather than rejecting them, so "it still parses" is
  // not the proof — the parsed OUTPUT is. A payload carrying the old blocks
  // parses, and they are absent from the result precisely because the schema no
  // longer declares them. Were either field still declared, it would survive
  // into `data` and this assertion would fail: that is what makes it a removal
  // proof rather than a restatement.
  const parsed = DashboardState.safeParse({
    ...BASE,
    security: { reports: 2, newest_age_days: 4 },
    refactor: { audits: 1, smells: 2, plans: 1 },
  });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  assert.equal("security" in parsed.data, false);
  assert.equal("refactor" in parsed.data, false);
  // the sibling that supersedes them is still declared and still round-trips,
  // so this cannot pass by the schema having lost both blocks wholesale
  const withAudits = DashboardState.safeParse({
    ...BASE,
    audits: {
      security: { scanned_age_days: 1, total: 1, by_severity: { high: 1 } },
      refactor: null,
    },
  });
  assert.equal(withAudits.success, true, JSON.stringify(withAudits.error?.issues));
  assert.deepEqual(withAudits.data.audits.refactor, null);
  assert.equal(withAudits.data.audits.security.total, 1);
  // and `artifacts.audits` — the security DOCUMENT count — is untouched
  assert.equal(parsed.data.artifacts.audits, 2);
});

test("UsageSummary: kind is closed to prompt|tool, window may be null", () => {
  assert.equal(UsageSummary.safeParse({ events: 0, window: null, top: [] }).success, true);
  assert.equal(
    UsageSummary.safeParse({
      events: 1,
      window: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z" },
      top: [{ kind: "tool", name: "task", count: 1 }],
    }).success,
    true,
  );
  assert.equal(
    UsageSummary.safeParse({
      events: 1,
      window: null,
      top: [{ kind: "widget", name: "task", count: 1 }],
    }).success,
    false,
  );
  assert.equal(
    UsageSummary.safeParse({ events: 1, window: null, top: [{ kind: "tool", name: "", count: 1 }] })
      .success,
    false,
  );
});

/**
 * DashboardState v2 (ADR-0024 data-first staging): the added sections —
 * `servers`, `current_tasks` {board, specs}, `handoffs`, `audits` — are all
 * optional, so a full v2 payload parses, a v1-narrow payload still parses
 * (ADR-0030 back-compat), and malformed v2 data is rejected fail-closed.
 */

const V2_CARD = {
  id: "001",
  type: "feature",
  status: { key: "wip", role: "wip" },
  title: "Rework dashboard",
  branch: "task/dashboard-state-v2",
  tracker_url: null,
  pr: null,
  created: "2026-07-01T10:00:00.000Z",
  updated: "2026-07-02T10:00:00.000Z",
};

test("parses a full v2 payload", () => {
  const parsed = DashboardState.safeParse({
    ...BASE,
    servers: [
      { name: "marvin", enabled: true },
      { name: "context7", enabled: false },
    ],
    current_tasks: {
      board: [V2_CARD],
      specs: [{ slug: "dashboard-state-v2", title: "DashboardState v2", id: "017" }],
    },
    handoffs: [{ slug: "resume-widget", objective: "Continue the widget slice", age_days: 1 }],
    audits: {
      security: {
        scanned_age_days: 4,
        total: 3,
        by_severity: { high: 1, low: 2 },
        newest_report: "003-sec-scan.md",
      },
      refactor: { scanned_age_days: null, total: 0, by_severity: {} },
    },
  });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test("keeps a narrow no-v2-section payload valid", () => {
  // BASE omits every v2 field — an existing narrow producer must still conform.
  const parsed = DashboardState.safeParse(BASE);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test("rejects malformed v2 sections", () => {
  // by_severity carries a key outside the closed Severity vocabulary.
  const badSeverity = DashboardState.safeParse({
    ...BASE,
    audits: {
      security: { scanned_age_days: 1, total: 1, by_severity: { blocker: 1 } },
      refactor: null,
    },
  });
  assert.equal(badSeverity.success, false);

  // current_tasks.board holds a TaskCard with a malformed id (not 3 digits).
  const badCard = DashboardState.safeParse({
    ...BASE,
    current_tasks: { board: [{ ...V2_CARD, id: "1" }], specs: [] },
  });
  assert.equal(badCard.success, false);
});
