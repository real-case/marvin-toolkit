import type { TaskDetail } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * A representative TaskDetail (ADR-0024) shared by the tests and the story. It
 * carries a tracker link, a linked PR, and a spec slug (so every card-field
 * branch renders), plus a `body_markdown` covering a heading, a list, and a
 * fenced code block — enough to prove the body renders through the `<Markdown>`
 * primitive (real `h*`/`li`/`pre>code` elements), not as literal text. Timestamps
 * are fixed literals (no `Date.now()`) to keep the story and snapshots deterministic.
 */
const FENCE = "```";
const BODY = [
  "## Summary",
  "",
  "Users on slow networks hit a **login timeout** before the token refresh completes.",
  "",
  "### Steps to reproduce",
  "",
  "- Throttle the network to 2G",
  "- Sign in with a valid account",
  "- Observe the request abort at ~30s",
  "",
  "Fix sketch:",
  "",
  FENCE,
  "await withRetry(() => refreshToken(), { attempts: 3 });",
  FENCE,
].join("\n");

export const taskDetailFixture: TaskDetail = {
  id: "001",
  type: "bug",
  status: { key: "wip", role: "wip" },
  title: "Fix login timeout on slow networks",
  branch: "fix/001-OSI-101--login-timeout",
  tracker_id: "OSI-101",
  tracker_url: "https://tracker.example/browse/OSI-101",
  pr: { url: "https://github.com/acme/app/pull/12", number: 12 },
  // A slug deliberately NOT a substring of the branch/title, so the test that
  // asserts it renders is a real assertion, not a tautology.
  spec_slug: "slow-network-retry",
  created: "2026-07-01T10:00:00.000Z",
  updated: "2026-07-03T14:15:00.000Z",
  body_markdown: BODY,
};

/**
 * The sparse end of the contract: every optional/nullable field absent or
 * `null` (no tracker, no PR, no spec) and a two-line plain-prose body — so the
 * story/tests prove the link row and the Spec row genuinely disappear rather
 * than rendering empty chrome.
 */
export const minimalTaskDetailFixture: TaskDetail = {
  id: "002",
  type: "chore",
  status: { key: "todo", role: "todo" },
  title: "Bump tsup and refresh the committed dist",
  branch: "chore/002--bump-tsup",
  tracker_url: null,
  pr: null,
  created: "2026-07-02T08:00:00.000Z",
  updated: "2026-07-02T08:05:00.000Z",
  body_markdown: [
    "Dependabot flagged tsup 8.4 as outdated; the lockfile still resolves 8.3.",
    "Bump it, rebuild dist/server.js, and let verify-dist confirm the sync.",
  ].join("\n"),
};

/**
 * A body exercising the `<Markdown>` primitive's whole GFM subset in one shot —
 * headings, plain list, task-list checkboxes, table, fenced code, blockquote,
 * strikethrough — the Markdown-in-context visual for the detail pane.
 */
const RICH_BODY = [
  "# Verify gate rollout",
  "",
  "Replace the ~~prose checklist~~ with the tool-backed **verify** gate matrix (ADR-0009).",
  "",
  "## Gate matrix",
  "",
  "| Gate | Command | Status |",
  "| --- | --- | --- |",
  "| tests | `npm test` | green |",
  "| lint | `npx eslint .` | green |",
  "| types | `npx tsc --noEmit` | red |",
  "",
  "## Rollout order",
  "",
  "- Config-first gate resolution from `.marvin/config.json`",
  "- Concurrent gate execution, single merge point",
  "- `verification.md` written on every run",
  "",
  "## Checklist",
  "",
  "- [x] Wire the config-first gate resolution",
  "- [x] Write the verification artifact on every run",
  "- [ ] Surface per-gate durations in the summary",
  "",
  "> Verification failed means delivery refuses: no verified green, no PR.",
  "",
  "Config override example:",
  "",
  FENCE,
  '{ "gates": { "build": false } }',
  FENCE,
].join("\n");

export const richBodyTaskDetailFixture: TaskDetail = {
  id: "003",
  type: "feature",
  status: { key: "review", role: "review" },
  title: "Verify gate matrix rollout",
  branch: "feat/003-OSI-142--verify-gate-matrix",
  tracker_id: "OSI-142",
  tracker_url: "https://tracker.example/browse/OSI-142",
  pr: { url: "https://github.com/acme/app/pull/27", number: 27 },
  spec_slug: "verify-gate-matrix",
  created: "2026-07-04T09:30:00.000Z",
  updated: "2026-07-06T16:45:00.000Z",
  body_markdown: RICH_BODY,
};

/**
 * The overflow probe: a ~140-char title plus a branch name long enough to
 * stress the master row and the `<code>` branch cell — how the layout copes
 * with real, verbose task naming instead of truncating fixtures.
 */
export const longTitleTaskDetailFixture: TaskDetail = {
  id: "004",
  type: "feature",
  status: { key: "wip", role: "wip" },
  // ~140 chars — long enough to wrap the master row and the detail heading.
  title:
    "Reconcile the board storage schema's status vocabulary with the shared contracts " +
    "package so widgets, gates and the task tool share one source",
  branch: "feat/004-OSI-215--reconcile-board-storage-status-vocabulary-with-shared-contracts",
  tracker_id: "OSI-215",
  tracker_url: "https://tracker.example/browse/OSI-215",
  pr: null,
  spec_slug: "status-vocabulary-reconciliation",
  created: "2026-07-05T11:00:00.000Z",
  updated: "2026-07-07T13:20:00.000Z",
  body_markdown: [
    "The server's `storage/schema.ts` re-declares `TaskType` and `StatusRole`.",
    "",
    "Make it import them from `@marvin-toolkit/mcp-shared/contracts` instead, so the",
    "widget contracts and the storage layer cannot drift apart (Stage-1 reconciliation).",
  ].join("\n"),
};
