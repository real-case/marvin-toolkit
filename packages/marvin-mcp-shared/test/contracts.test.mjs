import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LinkRef,
  TaskCard,
  TaskListPayload,
  TaskSummary,
  HandoffCard,
  AuditReport,
  DashboardState,
} from "../dist/contracts/index.js";

const NOW = "2026-06-29T00:00:00.000Z";

test("LinkRef accepts a url-bearing external link and rejects an empty label", () => {
  assert.equal(
    LinkRef.safeParse({ kind: "pr", label: "PR #12", url: "https://x/pr/12" }).success,
    true,
  );
  assert.equal(LinkRef.safeParse({ kind: "pr", label: "" }).success, false);
});

test("TaskCard requires a 3-digit id and a non-null tracker_url/pr (nullable, not optional)", () => {
  const card = {
    id: "001",
    type: "feature",
    status: "wip",
    title: "Do the thing",
    branch: "feat/thing",
    tracker_id: "OSI-12",
    tracker_url: "https://tracker/OSI-12",
    pr: { url: "https://x/pr/1", number: 1, state: "open" },
    created: NOW,
    updated: NOW,
  };
  assert.equal(TaskCard.safeParse(card).success, true);
  // nullable fields must be present (as null) — a bare omission fails.
  assert.equal(TaskCard.safeParse({ ...card, pr: null, tracker_url: null }).success, true);
  assert.equal(TaskCard.safeParse({ ...card, id: "1" }).success, false);
  assert.equal(TaskCard.safeParse({ ...card, status: "shipped" }).success, false);
});

test("TaskListPayload counts are keyed by status", () => {
  const ok = TaskListPayload.safeParse({ tasks: [], counts: { todo: 2, wip: 0 } });
  assert.equal(ok.success, true);
  const bad = TaskListPayload.safeParse({ tasks: [], counts: { nope: 1 } });
  assert.equal(bad.success, false);
});

test("TaskSummary joins criteria, gates and links", () => {
  const ok = TaskSummary.safeParse({
    slug: "thing",
    title: "Thing",
    status: "shipped",
    acceptance: [
      {
        id: "AC1",
        statement: "works",
        oracle_kind: "test",
        oracle_ref: "t/x.test.ts",
        outcome: "pass",
      },
    ],
    gates: [{ name: "test", status: "pass" }],
    commits: [{ sha: "abc", subject: "feat: thing" }],
    lessons: [],
    links: [{ kind: "pr", label: "PR", url: "https://x/pr/1" }],
  });
  assert.equal(ok.success, true);
});

test("HandoffCard keeps pr_url nullable and objective required", () => {
  const base = {
    id: "003",
    slug: "thing",
    objective: "Continue thing",
    branch: "feat/thing",
    pr_url: null,
    created: NOW,
  };
  assert.equal(HandoffCard.safeParse(base).success, true);
  assert.equal(HandoffCard.safeParse({ ...base, objective: "" }).success, false);
});

test("AuditReport validates findings and severity-keyed summary", () => {
  const ok = AuditReport.safeParse({
    kind: "scan",
    scanned_at: NOW,
    summary: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
    findings: [
      {
        id: "F1",
        severity: "high",
        title: "SQLi",
        category: "OWASP A03:2025",
        file: "a.ts",
        line: 9,
      },
    ],
  });
  assert.equal(ok.success, true);
  assert.equal(
    AuditReport.safeParse({ kind: "nope", scanned_at: NOW, summary: {}, findings: [] }).success,
    false,
  );
});

test("DashboardState mirrors the help tool's computed state", () => {
  const ok = DashboardState.safeParse({
    version: "2.0.0",
    paths: { project: "/p", tasks_dir: "/p/.marvin/kanban", config_path: "/p/.marvin/config.json" },
    config: { base_branch: "dev", tracker_url_template: null },
    kanban_counts: { todo: 1, wip: 2 },
    git: { has_git: true, has_gh: false, branch: "dev" },
    artifacts: { specs: 0, handoffs: 1, audits: 0, lessons: 3 },
    command_groups: [{ group: "task", count: 4 }],
  });
  assert.equal(ok.success, true);
});
