import type { DashboardState } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * A representative full DashboardState (ADR-0024 #8) shared by the tests and the story.
 * It deliberately populates every section — including all the OPTIONAL extended sections
 * (adr / security / refactor / lessons / usage) with non-null ages, a non-empty usage
 * window and top list, and a malformed ADR count — so the AC1 render assertions are real,
 * not tautologies. The fresh-project and help-narrow shapes (present-but-zeroed / absent)
 * are built inline in the test; this fixture is the "everything on" end of the range.
 *
 * All values are fixed literals (no Date.now()) so snapshots stay deterministic.
 */
export const dashboardFixture: DashboardState = {
  version: "0.22.0",
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
