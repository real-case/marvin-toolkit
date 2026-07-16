import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AdrCorpusSummary,
  DashboardState,
  RefactorInventory,
  SecurityInventory,
  UsageSummary,
  VerificationFreshness,
} from "../dist/contracts/index.js";

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
    security: { reports: 2, newest_age_days: 4 },
    refactor: { audits: 1, smells: 2, plans: 1 },
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

test("SecurityInventory and RefactorInventory reject negative counts", () => {
  assert.equal(SecurityInventory.safeParse({ reports: 0, newest_age_days: null }).success, true);
  assert.equal(SecurityInventory.safeParse({ reports: -1, newest_age_days: null }).success, false);
  assert.equal(RefactorInventory.safeParse({ audits: 0, smells: 0, plans: 0 }).success, true);
  assert.equal(RefactorInventory.safeParse({ audits: 0, smells: -2, plans: 0 }).success, false);
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
