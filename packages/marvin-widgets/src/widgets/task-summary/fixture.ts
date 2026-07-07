import type { TaskSummary } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * A representative TaskSummary (ADR-0024 #3) shared by the tests and the story.
 * It deliberately spans the full width of the contract so the render assertions
 * are real, not tautologies:
 *
 *  - acceptance covers all three AcOutcome values — `pass`, `unknown`, `fail` — and
 *    all three oracle kinds (test / command / prose-review). The tool is conservative
 *    (it emits only pass/unknown today), but the contract permits `fail`, so the
 *    fixture exercises the fail badge for a payload a host could deliver otherwise.
 *    AC1's statement carries an inline code span so the `<Markdown>` render is proven.
 *  - gates cover all three GateOutcome statuses — `pass`, `skip`, `fail` — with a
 *    `detail` on the failure.
 *  - links span the internal (ref-only: spec/branch/adr) and external (url: pr/tracker)
 *    halves of the 3-type link model.
 *
 * Timestamps/counts are fixed literals (no Date.now()) so snapshots stay deterministic.
 */
export const taskSummaryFixture: TaskSummary = {
  slug: "widget-task-summary",
  title: "Task-summary MCP Apps widget",
  status: "in-review",
  acceptance: [
    {
      id: "AC1",
      statement: "The pure `TaskSummaryView` renders every panel section from the payload.",
      oracle_kind: "test",
      oracle_ref:
        "packages/marvin-widgets/src/widgets/task-summary/TaskSummaryWidget.test.tsx::renders the panel sections",
      outcome: "pass",
    },
    {
      id: "AC2",
      statement: "Links dispatch through the three-type link model.",
      oracle_kind: "command",
      oracle_ref: "npm run build",
      outcome: "unknown",
    },
    {
      id: "AC3",
      statement: "The panel degrades cleanly when a section is empty.",
      oracle_kind: "prose-review",
      outcome: "fail",
    },
  ],
  gates: [
    { name: "test", status: "pass" },
    { name: "lint", status: "pass" },
    { name: "typecheck", status: "skip" },
    { name: "build", status: "fail", detail: "exit 1" },
  ],
  commits: [
    { sha: "a1b2c3d", subject: "feat(widgets): task-summary panel view" },
    { sha: "d4e5f6a", subject: "test(widgets): mock-host story + unit tests" },
  ],
  lessons: [{ id: "widget-block-inline", title: "The Markdown primitive is block-level" }],
  links: [
    { kind: "spec", label: "widget-task-summary", ref: "widget-task-summary" },
    { kind: "branch", label: "feat/widget-task-summary", ref: "feat/widget-task-summary" },
    { kind: "pr", label: "PR #91", url: "https://github.com/real-case/marvin-toolkit/pull/91" },
    { kind: "tracker", label: "MARVIN-3", url: "https://tracker.example.com/browse/MARVIN-3" },
    { kind: "adr", label: "ADR-0024", ref: "docs/adr/0024-mcp-apps-widget-architecture.md" },
  ],
};
