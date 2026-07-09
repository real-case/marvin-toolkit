import type { DashboardState } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * A representative full DashboardState (ADR-0024 #8) shared by the tests and the story.
 * It deliberately populates every section — including all the OPTIONAL extended sections
 * (adr / security / refactor / lessons / usage) with non-null ages, a non-empty usage
 * window and top list, and a malformed ADR count — so the AC1 render assertions are real,
 * not tautologies. This fixture is the "everything on" end of the range; the exported
 * variants below cover the other ends — help-narrow (absent sections), fresh-project
 * (present-but-zeroed), git-less, and the long-paths stress shape.
 *
 * All values are fixed literals (no Date.now()) so snapshots stay deterministic.
 */
export const dashboardFixture: DashboardState = {
  version: "0.1.0",
  paths: {
    project: "/Users/dev/acme-api",
    tasks_dir: "/Users/dev/acme-api/.marvin/kanban",
    config_path: "/Users/dev/acme-api/.marvin/config.json",
  },
  config: {
    base_branch: "main",
    tracker_url_template: "https://linear.app/acme/issue/{id}",
    gates: {
      test: "npm test",
      lint: "eslint .",
      typecheck: "tsc --noEmit",
      build: "npm run build",
    },
    statuses: [
      { key: "backlog", role: "todo" },
      { key: "in-progress", role: "wip" },
      { key: "in-review", role: "review" },
      { key: "done", role: "done" },
      { key: "blocked", role: "blocked" },
    ],
  },
  kanban_counts: { backlog: 4, "in-progress": 2, "in-review": 1, done: 7, blocked: 1 },
  kanban_role_counts: { todo: 4, wip: 2, review: 1, done: 7, blocked: 1 },
  git: { has_git: true, has_gh: true, branch: "feat/widget-dashboard" },
  artifacts: {
    specs: 3,
    handoffs: 2,
    audits: 1,
    lessons: 5,
    verification: { exists: true, age_days: 2 },
  },
  command_groups: [
    { group: "core", count: 9 },
    { group: "pr", count: 4 },
    { group: "task", count: 5 },
    { group: "sec", count: 10 },
    { group: "kanban", count: 12 },
  ],
  adr: {
    dir: "docs/adr",
    total: 30,
    counts: { proposed: 2, accepted: 24, deprecated: 1, superseded: 3, rejected: 0 },
    malformed: 1,
  },
  security: { reports: 1, newest_age_days: 6 },
  refactor: { audits: 2, smells: 1, plans: 1 },
  lessons: {
    total: 5,
    by_type: { "bug-pattern": 2, gotcha: 2, convention: 1 },
    by_tag: { widgets: 3, mcp: 2 },
  },
  usage: {
    events: 128,
    window: { from: "2026-06-01T09:00:00.000Z", to: "2026-07-07T18:30:00.000Z" },
    top: [
      { kind: "prompt", name: "commit", count: 22 },
      { kind: "tool", name: "task", count: 18 },
      { kind: "prompt", name: "task-start", count: 9 },
    ],
  },
};

/**
 * The narrower `help`-shaped payload (ADR-0030): every optional extended section —
 * adr / security / refactor / lessons / usage, and `artifacts.verification` — is
 * ABSENT, not zeroed, so only the five always-present cards (paths · config ·
 * kanban · artifacts · commands) render. Built standalone rather than spread from
 * the full fixture because a spread can only add fields, never remove them.
 */
export const coreOnlyDashboardFixture: DashboardState = {
  version: "0.1.0",
  paths: {
    project: "/Users/dev/blog-engine",
    tasks_dir: "/Users/dev/blog-engine/.marvin/kanban",
    config_path: "/Users/dev/blog-engine/.marvin/config.json",
  },
  config: {
    base_branch: "main",
    tracker_url_template: null,
    statuses: [
      { key: "todo", role: "todo" },
      { key: "wip", role: "wip" },
      { key: "review", role: "review" },
      { key: "done", role: "done" },
      { key: "blocked", role: "blocked" },
    ],
  },
  kanban_counts: { todo: 3, wip: 1, review: 0, done: 12, blocked: 0 },
  kanban_role_counts: { todo: 3, wip: 1, review: 0, done: 12, blocked: 0 },
  git: { has_git: true, has_gh: true, branch: "main" },
  artifacts: { specs: 2, handoffs: 1, audits: 0, lessons: 3 },
  command_groups: [
    { group: "core", count: 10 },
    { group: "adr", count: 6 },
    { group: "pr", count: 4 },
    { group: "task", count: 6 },
    { group: "sec", count: 11 },
    { group: "refactor", count: 4 },
    { group: "kanban", count: 14 },
  ],
};

/**
 * The `dashboard` tool's REAL fresh-project payload: every extended section is
 * PRESENT but zeroed — 0 counts, null ages, a null usage window and empty top —
 * exercising the present-but-zero side of the contract (a card still renders,
 * with its neutral zero-state) as opposed to the absent side above.
 */
export const freshDashboardFixture: DashboardState = {
  version: "0.1.0",
  paths: {
    project: "/Users/dev/greenfield",
    tasks_dir: "/Users/dev/greenfield/.marvin/kanban",
    config_path: "/Users/dev/greenfield/.marvin/config.json",
  },
  config: {
    base_branch: "main",
    tracker_url_template: null,
    statuses: [
      { key: "todo", role: "todo" },
      { key: "wip", role: "wip" },
      { key: "review", role: "review" },
      { key: "done", role: "done" },
      { key: "blocked", role: "blocked" },
    ],
  },
  kanban_counts: { todo: 0, wip: 0, review: 0, done: 0, blocked: 0 },
  kanban_role_counts: { todo: 0, wip: 0, review: 0, done: 0, blocked: 0 },
  git: { has_git: true, has_gh: true, branch: "main" },
  artifacts: {
    specs: 0,
    handoffs: 0,
    audits: 0,
    lessons: 0,
    verification: { exists: false, age_days: null },
  },
  command_groups: [
    { group: "core", count: 10 },
    { group: "adr", count: 6 },
    { group: "pr", count: 4 },
    { group: "task", count: 6 },
    { group: "sec", count: 11 },
    { group: "refactor", count: 4 },
    { group: "kanban", count: 14 },
  ],
  adr: {
    dir: "docs/adr",
    total: 0,
    counts: { proposed: 0, accepted: 0, deprecated: 0, superseded: 0, rejected: 0 },
    malformed: 0,
  },
  security: { reports: 0, newest_age_days: null },
  refactor: { audits: 0, smells: 0, plans: 0 },
  lessons: { total: 0, by_type: {}, by_tag: {} },
  usage: { events: 0, window: null, top: [] },
};

/**
 * Not inside a git repository — `has_git`/`has_gh` false and `branch` null, so the
 * header shows the ✗ badges and the "(not in a git repo)" note. Smallest delta
 * over the fresh fixture: only `git` changes.
 */
export const noGitDashboardFixture: DashboardState = {
  ...freshDashboardFixture,
  git: { has_git: false, has_gh: false, branch: null },
};

/**
 * The break-all stress shape: monorepo-deep project/tasks/config paths, a long
 * release base branch, and a long topic branch — everything the paths/config
 * cards and the header render as `<code>` must wrap inside its card instead of
 * blowing the grid column open. Smallest delta over the full fixture.
 */
export const longPathsDashboardFixture: DashboardState = {
  ...dashboardFixture,
  paths: {
    project:
      "/Users/dev/workspace/clients/megacorp/platform-engineering/services/payments-orchestration-gateway",
    tasks_dir:
      "/Users/dev/workspace/clients/megacorp/platform-engineering/services/payments-orchestration-gateway/.marvin/kanban",
    config_path:
      "/Users/dev/workspace/clients/megacorp/platform-engineering/services/payments-orchestration-gateway/.marvin/config.json",
  },
  config: {
    ...dashboardFixture.config,
    base_branch: "release/2026.07-payments-orchestration-long-term-support",
  },
  git: {
    has_git: true,
    has_gh: true,
    branch: "feat/payments-orchestration-gateway-settlement-retry-backoff",
  },
};
