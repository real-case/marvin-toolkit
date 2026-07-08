import type { HandoffDetailPayload } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * A representative HandoffDetailPayload (ADR-0024 #5) shared by the tests and the
 * stories. Three handoffs in the newest-first order the `handoff` tool emits, with
 * varied optional fields so every card-field and link branch renders:
 *
 *  - `003` (selected first) — full fields (base, PR, spec) and a `body_markdown`
 *    covering a heading, a list, and a fenced code block, so the detail pane proves
 *    the body renders through the `<Markdown>` primitive (real `h*`/`li`/`pre>code`
 *    elements), not as literal text.
 *  - `002` — a PR but no spec slug.
 *  - `001` — the minimal case: `pr_url` null, no base, no spec.
 *
 * Each `continue_prompt` is the derived paste-ready string (the tool mirrors the
 * handoff skill's step-5 template); the tests assert the copy-to-chat action sends
 * `003`'s verbatim. Timestamps are fixed literals (no `Date.now()`) to keep the
 * story and snapshots deterministic.
 */
const FENCE = "```";
const BODY_003 = [
  "## Objective",
  "",
  "Ship the **handoffs** MCP Apps widget — a master-detail browser over the",
  "session-continuation docs.",
  "",
  "### Next steps",
  "",
  "- Wire the detail pane's continue-to-chat action",
  "- Rebuild the committed widget HTML",
  "- Run the full gate sweep",
  "",
  "Reference wiring:",
  "",
  FENCE,
  "app.sendMessage({ role: 'user', content: [{ type: 'text', text: prompt }] });",
  FENCE,
].join("\n");

export const handoffsFixture: HandoffDetailPayload = {
  handoffs: [
    {
      id: "003",
      slug: "handoffs-widget",
      objective: "Ship the handoffs widget",
      branch: "feat/widget-handoffs",
      base: "dev",
      pr_url: "https://github.com/acme/app/pull/88",
      spec_slug: "widget-handoffs",
      created: "2026-07-07T09:00:00.000Z",
      continue_prompt:
        'Continue work on Ship the handoffs widget. Full context is in `.marvin/handoff/003-handoffs-widget.md` — read that file first, then resume at its "Next steps". Repo is on branch `feat/widget-handoffs`.',
      body_markdown: BODY_003,
    },
    {
      id: "002",
      slug: "task-detail-widget",
      objective: "Land the task-detail widget",
      branch: "feat/widget-task-detail",
      base: "dev",
      pr_url: "https://github.com/acme/app/pull/87",
      created: "2026-07-05T14:30:00.000Z",
      continue_prompt:
        'Continue work on Land the task-detail widget. Full context is in `.marvin/handoff/002-task-detail-widget.md` — read that file first, then resume at its "Next steps". Repo is on branch `feat/widget-task-detail`.',
      body_markdown: "## Status\n\nMerged as PR #87. Nothing left to do here.",
    },
    {
      id: "001",
      slug: "widget-data-layer",
      objective: "Stand up the widget data layer",
      branch: "feat/widget-data-contracts",
      pr_url: null,
      created: "2026-07-01T11:15:00.000Z",
      continue_prompt:
        'Continue work on Stand up the widget data layer. Full context is in `.marvin/handoff/001-widget-data-layer.md` — read that file first, then resume at its "Next steps". Repo is on branch `feat/widget-data-contracts`.',
      body_markdown: "## Objective\n\nWiden the shared contract and land the data schemas.",
    },
  ],
};
