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
