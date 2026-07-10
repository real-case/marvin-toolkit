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

/**
 * The zero-handoffs payload — a project where `/marvin:handoff` has never run.
 * Drives the `<ListDetail>` empty state ("No handoffs yet — run /marvin:handoff…").
 */
export const emptyHandoffsFixture: HandoffDetailPayload = {
  handoffs: [],
};

/**
 * The minimal contract shape as a one-row payload: `pr_url` null and the optional
 * `base` / `spec_slug` keys absent entirely, so the detail pane's Base/Spec rows
 * and the PR button all take their hidden branch. Mirrors the fixture's `001` card
 * but isolated, so the story shows nothing else.
 */
export const minimalHandoffFixture: HandoffDetailPayload = {
  handoffs: [
    {
      id: "001",
      slug: "usage-log-rotation",
      objective: "Cap the usage events log with rotation",
      branch: "fix/usage-log-rotation",
      pr_url: null,
      created: "2026-06-28T08:45:00.000Z",
      continue_prompt:
        'Continue work on Cap the usage events log with rotation. Full context is in `.marvin/handoff/001-usage-log-rotation.md` — read that file first, then resume at its "Next steps". Repo is on branch `fix/usage-log-rotation`.',
      body_markdown:
        "## Objective\n\nRotate `.marvin/usage/events.jsonl` to `events.jsonl.1` once it crosses the size cap.",
    },
  ],
};

/**
 * The pre-wrap stress payload: a 30-line `continue_prompt` (a full step-by-step
 * continuation brief instead of the usual one-liner) plus a long multi-section
 * `body_markdown`, so the story exercises the prompt `<pre>`'s `pre-wrap` /
 * `break-word` behaviour and a detail pane that genuinely scrolls.
 */
const LONG_CONTINUE_PROMPT = [
  "Continue work on Migrate the verify gates to config-first resolution.",
  "Full context is in `.marvin/handoff/004-verify-config-first.md` — read that file first.",
  "",
  "State when this session ended:",
  "1. `.marvin/config.json` now carries a `gates` block (ADR-0009 shape).",
  "2. The `verify` tool reads it before stack detection — done, tested.",
  "3. Gate overrides merge over the detected defaults — done, tested.",
  "4. The `verification.md` writer records which source each gate came from — HALF DONE.",
  "5. The e2e stdio test for the override path is still red — see below.",
  "",
  "Next steps, in order:",
  "- Finish the source column in `verification.md` (writer is in `flows/verify-report.ts`).",
  "- Fix the red e2e: the test inherits `MARVIN_TASKS_CONFIG` from the worktree;",
  "  run it hermetically (`env -u MARVIN_TASKS_CONFIG npm test`) before debugging further.",
  "- Rebuild `dist/server.js` and re-run `node scripts/verify-dist.mjs`.",
  "- Run the full gate sweep: tests, lint, type-check, build.",
  "",
  "Constraints to respect:",
  "- Do NOT change the `gates` schema — ADR-0009 is accepted; overrides stay additive.",
  "- Config-first, detection-second: a configured gate always wins over a detected one.",
  "- The single merge point in `verify.ts` must stay the only place results join.",
  "- Keep the terminal fallback text byte-identical; only `structuredContent` grew.",
  "- Cross-check ADR-0009's consequences section before touching resolution order.",
  "",
  "Verification before delivery:",
  "- `npm run test` green from the repo root (hermetic env, see above).",
  "- `node scripts/mcp-call.mjs verify '{}'` shows the configured gate set.",
  "- `verification.md` lists every gate with its source (config vs detected).",
  "",
  "Repo is on branch `feat/verify-config-first`, based on `dev`.",
].join("\n");

const LONG_BODY = [
  "## Objective",
  "",
  "Move the `verify` tool's gate resolution to a **config-first** model: gates",
  "declared in `.marvin/config.json` win over stack detection, per ADR-0009.",
  "",
  "## Decisions taken",
  "",
  "- Config gates merge *over* detected gates key-by-key — no all-or-nothing switch,",
  "  so a project can pin just its test command and keep detected lint/build.",
  "- Resolution order is recorded per gate and written into `verification.md`,",
  "  because a red gate is only debuggable when you know where its command came from.",
  "- The e2e flake was root-caused to a `MARVIN_TASKS_CONFIG` env-leak, not load:",
  "  the config-write test pollutes the worktree config the read tests then see.",
  "",
  "### Open questions",
  "",
  "- Should a configured gate that names a missing binary fail closed or degrade",
  "  to the detected command? Current draft fails closed (matches the spec gate).",
  "",
  "Reference resolution:",
  "",
  FENCE,
  "const gates = { ...detectGates(stack), ...configGates };",
  FENCE,
].join("\n");

export const longPromptHandoffFixture: HandoffDetailPayload = {
  handoffs: [
    {
      id: "004",
      slug: "verify-config-first",
      objective: "Migrate the verify gates to config-first resolution",
      branch: "feat/verify-config-first",
      base: "dev",
      pr_url: "https://github.com/acme/app/pull/92",
      spec_slug: "verify-config-first",
      created: "2026-07-08T16:20:00.000Z",
      continue_prompt: LONG_CONTINUE_PROMPT,
      body_markdown: LONG_BODY,
    },
  ],
};
