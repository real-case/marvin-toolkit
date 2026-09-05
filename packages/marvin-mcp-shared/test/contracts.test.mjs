import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LinkRef,
  TaskCard,
  TaskListPayload,
  TaskSummary,
  HandoffCard,
  AuditReport,
  RefactorFinding,
  DashboardState,
} from "../dist/contracts/index.js";
import * as contracts from "../dist/contracts/index.js";

const NOW = "2026-06-29T00:00:00.000Z";

test("LinkRef accepts a url-bearing external link and rejects an empty label", () => {
  assert.equal(
    LinkRef.safeParse({ kind: "pr", label: "PR #12", url: "https://x/pr/12" }).success,
    true,
  );
  assert.equal(LinkRef.safeParse({ kind: "pr", label: "" }).success, false);
});

test("TaskCard requires a 3-digit id, a {key, role} status, and non-null tracker_url/pr", () => {
  const card = {
    id: "001",
    type: "feature",
    status: { key: "in-progress", role: "wip" },
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
  // status is {key, role} (ADR-0026): the key is open, the role is closed.
  assert.equal(TaskCard.safeParse({ ...card, status: "wip" }).success, false);
  assert.equal(
    TaskCard.safeParse({ ...card, status: { key: "qa", role: "shipping" } }).success,
    false,
  );
});

test("TaskListPayload counts: open per-key record plus a closed role roll-up (ADR-0026)", () => {
  const ok = TaskListPayload.safeParse({
    tasks: [],
    counts: { backlog: 2, "code-review": 0 }, // any configured key is valid
    role_counts: { todo: 2, review: 0 },
  });
  assert.equal(ok.success, true);
  // the roll-up keys stay closed to the lifecycle roles
  const bad = TaskListPayload.safeParse({
    tasks: [],
    counts: { backlog: 2 },
    role_counts: { shipping: 1 },
  });
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

test("RefactorFinding carries the register fields and requires evidenced findings (ADR-0029)", () => {
  const finding = {
    id: "F1",
    title: "God module: server.ts owns routing, config and IO",
    severity: "high",
    effort: "medium",
    evidence: [{ file: "src/server.ts", line: 12, note: "changed 47x in 12 mo" }],
    direction: "Split registration, config and IO into dedicated modules",
    source_report: ".marvin/refactor/001-audit-core.md",
  };
  assert.equal(RefactorFinding.safeParse(finding).success, true);
  // the register id shape is F<n>
  assert.equal(RefactorFinding.safeParse({ ...finding, id: "1" }).success, false);
  // severity reuses the audit vocabulary; effort is the register's own scale
  assert.equal(RefactorFinding.safeParse({ ...finding, severity: "sev1" }).success, false);
  assert.equal(RefactorFinding.safeParse({ ...finding, effort: "epic" }).success, false);
  // no finding without evidence
  assert.equal(RefactorFinding.safeParse({ ...finding, evidence: [] }).success, false);
});

test("DashboardState mirrors the help tool's computed state", () => {
  const ok = DashboardState.safeParse({
    version: "2.0.0",
    paths: { project: "/p", tasks_dir: "/p/.marvin/track", config_path: "/p/.marvin/config.json" },
    config: {
      base_branch: "dev",
      tracker_url_template: null,
      statuses: [
        { key: "todo", role: "todo" },
        { key: "in-progress", role: "wip", tracker_status: "In Progress" },
        { key: "done", role: "done" },
      ],
    },
    board_counts: { todo: 1, "in-progress": 2 },
    board_role_counts: { todo: 1, wip: 2 },
    git: { has_git: true, has_gh: false, branch: "dev" },
    artifacts: { specs: 0, handoffs: 1, audits: 0, lessons: 3 },
    command_groups: [{ group: "task", count: 4 }],
  });
  assert.equal(ok.success, true);
});

// ── task metrics (ADR-0043) ──────────────────────────────────────────────────

const METRIC_EVENT_BASE = {
  slug: "demo-slug",
  source: "task-implement",
  step: "6F",
  contract_sha: "1b0d247e9e203673",
  at: "2026-09-03T10:00:00.000Z",
};

test("MetricEvent accepts a well-formed event of every kind", () => {
  const { MetricEvent } = contracts;
  const fixtures = [
    { kind: "fix-round", loop: "verify-gate", round: 1 },
    { kind: "spec-gap", detail: "the spec did not say where the fixture lives" },
    {
      kind: "open-item",
      classification: "deferred",
      detail: "widget rendering of the new section",
    },
    { kind: "critic-dispatch", critic: "marvin-tm-diff-critic", pass: 1 },
    {
      kind: "critic-verdict",
      critic: "marvin-tm-diff-critic",
      pass: 1,
      verdict: "PASS WITH WARNINGS",
      blockers: 0,
      warnings: 2,
    },
    { kind: "gate-call", gate: "dor", call: 1, verdict: "FAIL" },
  ];
  for (const f of fixtures) {
    const parsed = MetricEvent.safeParse({ ...METRIC_EVENT_BASE, ...f });
    assert.equal(parsed.success, true, `${f.kind}: ${JSON.stringify(parsed.error?.issues)}`);
  }
});

test("MetricEvent is fail-closed per kind: a missing kind field, a wrong vocabulary or a bad slug does not validate", () => {
  const { MetricEvent } = contracts;
  const reject = (over, why) =>
    assert.equal(MetricEvent.safeParse({ ...METRIC_EVENT_BASE, ...over }).success, false, why);
  // the plan's own example: a critic-verdict without its pass number
  reject(
    {
      kind: "critic-verdict",
      critic: "marvin-tm-diff-critic",
      verdict: "PASS",
      blockers: 0,
      warnings: 0,
    },
    "critic-verdict without pass",
  );
  reject({ kind: "fix-round", round: 2 }, "fix-round without loop");
  reject({ kind: "spec-gap" }, "spec-gap without detail");
  reject({ kind: "open-item", detail: "x" }, "open-item without classification");
  reject({ kind: "gate-call", gate: "dor", call: 1 }, "gate-call without verdict");
  // a critic verdict is terminal; NEEDS_CONTEXT is structurally unrecordable
  reject(
    {
      kind: "critic-verdict",
      critic: "marvin-tm-diff-critic",
      pass: 1,
      verdict: "NEEDS_CONTEXT",
      blockers: 0,
      warnings: 0,
    },
    "critic-verdict NEEDS_CONTEXT",
  );
  // a gate-call speaks the DoR gate's vocabulary, not the critic's
  reject({ kind: "gate-call", gate: "dor", call: 1, verdict: "BLOCK" }, "gate-call BLOCK");
  reject(
    { kind: "fix-round", loop: "verify-gate", round: 1, slug: "Not Kebab" },
    "slug not kebab-case",
  );
  reject({ kind: "fix-round", loop: "verify-gate", round: 1, source: "someone" }, "unknown source");
  reject({ kind: "unknown", detail: "x" }, "unknown kind");
});

const TASK_METRICS_FIXTURE = {
  slug: "demo-slug",
  contract_sha: "1b0d247e9e203673",
  type: "feature",
  risk: "medium",
  breaking: false,
  spike_required: false,
  created: "2026-09-03",
  rolled_up_at: "2026-09-03T12:00:00.000Z",
  head_sha: "44707ed44707ed44707ed44707ed44707ed44707",
  base_branch: "dev",
  sources: {
    spec: "present",
    progress: "present",
    oracles: "present",
    verify_journal: "present",
    verify_result: "present",
    critique: "present",
    events: "present",
    git: "present",
  },
  time: {
    intake_ms: 723000,
    implement_ms: 114000,
    first_green_ms: 343000,
    active_ms: 1180000,
    gate_efficiency: 0.42,
    oracle_ms: [{ criterion: "AC1", ms: 1800 }],
    gate_ms: [{ gate: "test", ms: 52000 }],
    critic_ms: {
      total: 540000,
      dispatches: [{ critic: "marvin-tm-diff-critic", pass: 1, ms: 540000 }],
    },
  },
  quality: {
    scope_drift: { declared: 12, changed: 14, undeclared: ["README.md", "docs/x.md"] },
    oracle_strength: { criteria: 6, executable: 5, share: 0.833 },
    red_green: null,
    not_run: { gates: 4, not_run: 1, share: 0.25 },
    freshness_waivers: 0,
    critics: {
      spec: {
        compliance: { verdict: "PASS", blockers: 0, warnings: 1 },
        quality: { verdict: "PASS WITH WARNINGS", blockers: 0, warnings: 3 },
      },
      diff: null,
    },
    spec_gaps: 1,
    open_items: { deferred: 1, blocked: 0 },
    dor_first_call: false,
    oracle_resolution: { by_source: { "oracle.run": 3, "config.test_one": 2 }, unresolved: 1 },
  },
  rework: {
    seals: 2,
    reseals: 1,
    critic_passes: { spec: 2, diff: 1 },
    fix_rounds: { verify_gate: 1, critic: 0, red_green: 0 },
    runs_before_green: 2,
  },
  notes: ["T8: 1 critic dispatch(es) without a recorded verdict — excluded"],
};

test("TaskMetrics parses a full terminal block and an all-absent one, and refuses a missing section", () => {
  const { TaskMetrics } = contracts;
  const full = TaskMetrics.safeParse(TASK_METRICS_FIXTURE);
  assert.equal(full.success, true, JSON.stringify(full.error?.issues));

  // Every metric is nullable — null means the source was absent, never zero —
  // and the sources map is what says so.
  const absent = TaskMetrics.safeParse({
    ...TASK_METRICS_FIXTURE,
    contract_sha: null,
    type: null,
    risk: null,
    breaking: null,
    spike_required: null,
    created: null,
    head_sha: null,
    sources: Object.fromEntries(
      Object.keys(TASK_METRICS_FIXTURE.sources).map((k) => [k, "absent"]),
    ),
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
  });
  assert.equal(absent.success, true, JSON.stringify(absent.error?.issues));

  // Both axes are always written, even when one is empty (the proposal's
  // requirement): a block missing its quality section does not validate.
  const { quality: _dropped, ...noQuality } = TASK_METRICS_FIXTURE;
  assert.equal(TaskMetrics.safeParse(noQuality).success, false);
  // and a presence value outside the vocabulary fails too
  assert.equal(
    TaskMetrics.safeParse({
      ...TASK_METRICS_FIXTURE,
      sources: { ...TASK_METRICS_FIXTURE.sources, git: "maybe" },
    }).success,
    false,
  );
});
