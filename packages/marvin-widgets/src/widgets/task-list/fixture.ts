import type { TaskListPayload } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * A representative TaskListPayload (ADR-0024) shared by the tests and the story —
 * one card in each lifecycle role, a tracker link, a linked PR, and a spec slug,
 * so a single fixture exercises every branch the widget renders. Timestamps are
 * fixed literals (no `Date.now()`) to keep the story and snapshots deterministic.
 */
export const taskListFixture: TaskListPayload = {
  tasks: [
    {
      id: "001",
      type: "bug",
      status: { key: "todo", role: "todo" },
      title: "Fix login timeout on slow networks",
      branch: "fix/001-OSI-101--login-timeout",
      tracker_id: "OSI-101",
      tracker_url: "https://tracker.example/browse/OSI-101",
      pr: null,
      created: "2026-07-01T10:00:00.000Z",
      updated: "2026-07-01T10:00:00.000Z",
    },
    {
      id: "002",
      type: "feature",
      status: { key: "wip", role: "wip" },
      title: "Add dark-mode toggle to settings",
      branch: "feat/002-dark-mode-toggle",
      tracker_url: null,
      pr: { url: "https://github.com/acme/app/pull/12", number: 12 },
      created: "2026-07-02T09:30:00.000Z",
      updated: "2026-07-03T14:15:00.000Z",
    },
    {
      id: "003",
      type: "chore",
      status: { key: "review", role: "review" },
      title: "Bump build toolchain dependencies",
      branch: "chore/003-bump-deps",
      tracker_url: null,
      pr: { url: "https://github.com/acme/app/pull/15", number: 15 },
      created: "2026-07-03T08:00:00.000Z",
      updated: "2026-07-04T11:45:00.000Z",
    },
    {
      id: "004",
      type: "spike",
      status: { key: "done", role: "done" },
      title: "Evaluate Preact for inline widget bundles",
      branch: "spike/004-preact-eval",
      tracker_url: null,
      pr: null,
      spec_slug: "preact-eval",
      created: "2026-06-28T12:00:00.000Z",
      updated: "2026-07-01T16:20:00.000Z",
    },
    {
      id: "005",
      type: "bug",
      status: { key: "blocked", role: "blocked" },
      title: "Flaky end-to-end suite under load",
      branch: "fix/005-flaky-e2e",
      tracker_url: null,
      pr: null,
      created: "2026-06-30T07:10:00.000Z",
      updated: "2026-07-02T18:05:00.000Z",
    },
  ],
  counts: { todo: 1, wip: 1, review: 1, done: 1, blocked: 1 },
  role_counts: { todo: 1, wip: 1, review: 1, done: 1, blocked: 1 },
};
