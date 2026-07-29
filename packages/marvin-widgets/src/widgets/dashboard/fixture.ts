import type { DashboardState } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * A representative full DashboardState (ADR-0024 #8) shared by the tests and the
 * stories. It deliberately populates every section — the optional extended ones
 * (adr / lessons / usage) with non-null ages, a non-empty usage window and top
 * list, a malformed ADR count, and all four v2 sections (servers / current_tasks
 * / handoffs / audits) — so the render assertions are real, not tautologies.
 * This fixture is the "everything on" end of the range; the exported variants
 * below cover the other ends — help-narrow (absent sections), fresh-project
 * (present-but-zeroed), git-less, long-paths, and scanned-clean audits.
 *
 * Two ordering choices are load-bearing rather than cosmetic:
 *
 *  - `audits.security.by_severity` lists `medium` FIRST. A record preserves
 *    insertion order, so a widget that iterated it directly would render the
 *    bar out of rank order. A rank-ordered fixture would pass under both
 *    readings and prove nothing.
 *  - `board_counts` puts the largest count on a status that is NOT declared
 *    first, so a bar sorted by count renders in a different order than a bar
 *    following the configured status order.
 *
 * All values are fixed literals (no Date.now()) so snapshots stay deterministic.
 */
export const dashboardFixture: DashboardState = {
  version: "0.1.0",
  paths: {
    project: "/Users/dev/acme-api",
    tasks_dir: "/Users/dev/acme-api/.marvin/track",
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
  board_counts: { backlog: 4, "in-progress": 2, "in-review": 1, done: 7, blocked: 1 },
  board_role_counts: { todo: 4, wip: 2, review: 1, done: 7, blocked: 1 },
  git: { has_git: true, has_gh: true, branch: "feat/dashboard-rework" },
  artifacts: {
    specs: 3,
    handoffs: 3,
    audits: 2,
    lessons: 5,
    verification: { exists: true, age_days: 2 },
  },
  command_groups: [
    { group: "core", count: 9 },
    { group: "pr", count: 4 },
    { group: "task", count: 5 },
    { group: "sec", count: 10 },
    { group: "track", count: 7 },
  ],
  adr: {
    dir: "docs/adr",
    total: 30,
    counts: { proposed: 2, accepted: 24, deprecated: 1, superseded: 3, rejected: 0 },
    malformed: 1,
  },
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
  servers: [
    { name: "marvin", enabled: true },
    { name: "context7", enabled: true },
    { name: "gitmcp", enabled: true },
    { name: "github", enabled: true },
    { name: "postgres", enabled: true },
    { name: "playwright", enabled: false },
    { name: "sentry", enabled: false },
    { name: "obsidian", enabled: false },
  ],
  current_tasks: {
    board: [
      {
        id: "042",
        type: "feature",
        status: { key: "in-progress", role: "wip" },
        title: "Dashboard rework — activity zone",
        branch: "feat/042--dashboard-activity",
        tracker_url: null,
        pr: null,
        created: "2026-07-20T09:00:00.000Z",
        updated: "2026-07-27T16:20:00.000Z",
      },
      {
        id: "041",
        type: "bug",
        status: { key: "in-progress", role: "wip" },
        title: "Tracker-list URL escaping fix",
        branch: "fix/041--tracker-url",
        tracker_url: null,
        pr: null,
        created: "2026-07-19T11:00:00.000Z",
        updated: "2026-07-26T10:05:00.000Z",
      },
      {
        id: "038",
        type: "chore",
        status: { key: "in-review", role: "review" },
        title: "Extract shared link-dispatch helper",
        branch: "chore/038--link-dispatch",
        tracker_url: null,
        pr: null,
        created: "2026-07-14T08:30:00.000Z",
        updated: "2026-07-25T14:45:00.000Z",
      },
    ],
    specs: [
      { slug: "dashboard-widget-rework", title: "Dashboard widget rework", id: "019" },
      { slug: "website-widget-embeds", title: "Website widget embeds", id: "011" },
      { slug: "website-interactive-islands", title: "Website interactive islands", id: "010" },
    ],
  },
  handoffs: [
    { slug: "reports-widget-premium", objective: "Reports widget premium design", age_days: 2 },
    { slug: "website-scaffold", objective: "Website scaffold continuation", age_days: 9 },
    { slug: "e2e-stdio-flake", objective: "E2E stdio flake root-cause", age_days: 15 },
  ],
  audits: {
    security: {
      scanned_age_days: 5,
      total: 14,
      // deliberately NOT in rank order — see the fixture docstring
      by_severity: { medium: 6, critical: 1, low: 4, high: 3 },
      newest_report: "002-threat-model.md",
    },
    refactor: {
      scanned_age_days: 12,
      total: 9,
      by_severity: { medium: 4, high: 2, low: 3 },
      newest_report: "003-smells-api.md",
    },
  },
};

/**
 * The narrower `help`-shaped payload (ADR-0030): every optional section — adr /
 * lessons / usage, `artifacts.verification`, and all four v2 sections — is
 * ABSENT, not zeroed, so only the always-present cards render. Built standalone
 * rather than spread from the full fixture because a spread can only add fields,
 * never remove them.
 */
export const coreOnlyDashboardFixture: DashboardState = {
  version: "0.1.0",
  paths: {
    project: "/Users/dev/blog-engine",
    tasks_dir: "/Users/dev/blog-engine/.marvin/track",
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
  board_counts: { todo: 3, wip: 1, review: 0, done: 12, blocked: 0 },
  board_role_counts: { todo: 3, wip: 1, review: 0, done: 12, blocked: 0 },
  git: { has_git: true, has_gh: true, branch: "main" },
  artifacts: { specs: 2, handoffs: 1, audits: 0, lessons: 3 },
  command_groups: [
    { group: "core", count: 10 },
    { group: "adr", count: 6 },
    { group: "pr", count: 4 },
    { group: "task", count: 6 },
    { group: "sec", count: 11 },
    { group: "refactor", count: 4 },
    { group: "track", count: 7 },
  ],
};

/**
 * The `dashboard` tool's REAL fresh-project payload: every extended section is
 * PRESENT but empty — 0 counts, null ages, a null usage window, empty digests,
 * and BOTH audit areas null (never scanned). This is the present-but-zero side
 * of the contract, as opposed to the absent side above.
 */
export const freshDashboardFixture: DashboardState = {
  version: "0.1.0",
  paths: {
    project: "/Users/dev/greenfield",
    tasks_dir: "/Users/dev/greenfield/.marvin/track",
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
  board_counts: { todo: 0, wip: 0, review: 0, done: 0, blocked: 0 },
  board_role_counts: { todo: 0, wip: 0, review: 0, done: 0, blocked: 0 },
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
    { group: "track", count: 7 },
  ],
  adr: {
    dir: "docs/adr",
    total: 0,
    counts: { proposed: 0, accepted: 0, deprecated: 0, superseded: 0, rejected: 0 },
    malformed: 0,
  },
  lessons: { total: 0, by_type: {}, by_tag: {} },
  usage: { events: 0, window: null, top: [] },
  servers: [],
  current_tasks: { board: [], specs: [] },
  handoffs: [],
  audits: { security: null, refactor: null },
};

/**
 * The discriminating audit fixture: security was SCANNED AND FOUND NOTHING
 * (`total: 0`, empty `by_severity`, a real report name and age), while refactor
 * was NEVER SCANNED (`null`).
 *
 * The two states share every renderable number, so a widget that collapsed them
 * would render this fixture's two areas identically — which is exactly what the
 * story's baseline and the unit test are built to catch. Getting it wrong makes
 * a never-scanned project read as a clean bill of health.
 */
export const scannedCleanDashboardFixture: DashboardState = {
  ...dashboardFixture,
  audits: {
    security: {
      scanned_age_days: 0,
      total: 0,
      by_severity: {},
      newest_report: "004-scan.md",
    },
    refactor: null,
  },
};

/**
 * Not inside a git repository — `has_git`/`has_gh` false and `branch` null, so
 * the identity strip shows the dim badges and the "(not in a git repo)" note.
 * Smallest delta over the fresh fixture: only `git` changes.
 */
export const noGitDashboardFixture: DashboardState = {
  ...freshDashboardFixture,
  git: { has_git: false, has_gh: false, branch: null },
};

/**
 * The break-all stress shape: monorepo-deep project/tasks/config paths, a long
 * release base branch, and a long topic branch — everything the paths/config
 * cards and the identity strip render as `<code>` must wrap inside its card
 * instead of blowing the grid column open. Smallest delta over the full fixture.
 */
export const longPathsDashboardFixture: DashboardState = {
  ...dashboardFixture,
  paths: {
    project:
      "/Users/dev/workspace/clients/megacorp/platform-engineering/services/payments-orchestration-gateway",
    tasks_dir:
      "/Users/dev/workspace/clients/megacorp/platform-engineering/services/payments-orchestration-gateway/.marvin/track",
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
