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

/**
 * The green digest: every AC passed, every gate passed — what a task looks like
 * the moment `task-deliver` is allowed to run. The roll-up must read "3/3
 * acceptance passed · 4 gates passed" with no failure clause.
 */
export const allPassingSummaryFixture: TaskSummary = {
  slug: "board-link-pr",
  title: "Capture the PR URL on the board task",
  status: "done",
  acceptance: [
    {
      id: "AC1",
      statement: "`link-pr` stores the PR URL in the task file's frontmatter.",
      oracle_kind: "test",
      oracle_ref: "plugins/marvin/mcp/server/test/task.test.ts::link-pr stores the URL",
      outcome: "pass",
    },
    {
      id: "AC2",
      statement: "track-show renders the captured PR link next to the tracker link.",
      oracle_kind: "test",
      oracle_ref: "plugins/marvin/mcp/server/test/task.test.ts::show renders links",
      outcome: "pass",
    },
    {
      id: "AC3",
      statement: "A board file round-trips without losing foreign frontmatter keys.",
      oracle_kind: "command",
      oracle_ref: "npm run test",
      outcome: "pass",
    },
  ],
  gates: [
    { name: "test", status: "pass" },
    { name: "lint", status: "pass" },
    { name: "typecheck", status: "pass" },
    { name: "build", status: "pass" },
  ],
  commits: [
    { sha: "9f8e7d6", subject: "feat(track): link-pr captures the PR URL" },
    { sha: "5c4b3a2", subject: "test(track): frontmatter round-trip coverage" },
  ],
  lessons: [{ id: "frontmatter-roundtrip", title: "Read-modify-write must preserve foreign keys" }],
  links: [
    { kind: "spec", label: "board-link-pr", ref: "board-link-pr" },
    { kind: "pr", label: "PR #64", url: "https://github.com/real-case/marvin-toolkit/pull/64" },
  ],
};

/**
 * The mixed shot: a failed AC, a failed gate (with its detail), and an unknown
 * AC in one payload, so the roll-up carries a failure clause and the panel shows
 * all three badge palettes at once. No lessons — the section must be absent.
 */
export const failingSummaryFixture: TaskSummary = {
  slug: "verify-gate-races",
  title: "Fix the verify tool's concurrent-gate race",
  status: "in-progress",
  acceptance: [
    {
      id: "AC1",
      statement: "Concurrent gates merge into a single `verification.md` write.",
      oracle_kind: "test",
      oracle_ref: "plugins/marvin/mcp/server/test/verify.test.ts::gates merge once",
      outcome: "pass",
    },
    {
      id: "AC2",
      statement: "A failing gate marks the whole verification failed.",
      oracle_kind: "test",
      oracle_ref: "plugins/marvin/mcp/server/test/verify.test.ts::red gate fails the run",
      outcome: "fail",
    },
    {
      id: "AC3",
      statement: "Gate overrides from `.marvin/config.json` are honoured over autodetection.",
      oracle_kind: "prose-review",
      outcome: "unknown",
    },
  ],
  gates: [
    { name: "test", status: "fail", detail: "2 failed, 138 passed" },
    { name: "lint", status: "pass" },
    { name: "typecheck", status: "pass" },
    { name: "build", status: "skip", detail: "no build script" },
  ],
  commits: [{ sha: "0aa1bb2", subject: "fix(verify): serialize the verification.md merge point" }],
  lessons: [],
  links: [
    { kind: "spec", label: "verify-gate-races", ref: "verify-gate-races" },
    { kind: "branch", label: "fix/verify-gate-races", ref: "fix/verify-gate-races" },
  ],
};

/**
 * All five collections empty — a spec'd task nothing has happened to yet. Every
 * collection section must show its own empty note and the Lessons section must
 * be omitted entirely (it renders only when lessons exist).
 */
export const emptySummaryFixture: TaskSummary = {
  slug: "adr-lifecycle-docs",
  title: "Document the adr tool's decision lifecycle",
  status: "ready",
  acceptance: [],
  gates: [],
  commits: [],
  lessons: [],
  links: [],
};

/**
 * The stress fixture: multi-clause AC statements carrying inline markdown, long
 * Conventional-Commits subjects, and a dozen commits — proves the flex rows wrap
 * instead of overflowing and the panel stays readable at real-world verbosity.
 */
export const longSummaryFixture: TaskSummary = {
  slug: "single-plugin-consolidation",
  title:
    "Consolidate the four marvin packs into a single plugin with one MCP server, one slash prefix, and a shared skills directory",
  status: "in-review",
  acceptance: [
    {
      id: "AC1",
      statement:
        "Every command formerly reachable as `/marvin-core:*`, `/marvin-sec:*`, `/marvin-tm:*` or `/marvin-tasks:*` resolves under the consolidated `/marvin:` prefix, and the **old prefixes are gone** from the marketplace manifest, the plugin manifest, and every `SKILL.md` cross-reference in the corpus.",
      oracle_kind: "test",
      oracle_ref:
        "plugins/marvin/mcp/server/test/prompts.test.ts::every registered prompt resolves its skill body through the consolidated prompts directory",
      outcome: "pass",
    },
    {
      id: "AC2",
      statement:
        "The manifest linter and the committed-dist guard both pass after the merge, proving the single `dist/server.js` bundle registers **every prompt and tool** under the one `marvin` server key with no orphaned pack-era registrations left behind.",
      oracle_kind: "command",
      oracle_ref: "node scripts/lint-manifests.mjs && node scripts/verify-dist.mjs",
      outcome: "pass",
    },
    {
      id: "AC3",
      statement:
        "A reviewer following the migration notes in `docs/adr/0001-single-plugin-consolidation.md` can reinstall from a clean profile and reach every workflow — core, sec, task pipeline, track — without consulting the retired pack READMEs.",
      oracle_kind: "prose-review",
      outcome: "unknown",
    },
  ],
  gates: [
    { name: "test", status: "pass", detail: "140 passed in 12.4s" },
    { name: "lint", status: "pass", detail: "eslint + prettier clean" },
    { name: "typecheck", status: "pass" },
    { name: "build", status: "pass", detail: "tsup 1 file, 412 kB" },
  ],
  commits: [
    {
      sha: "1a2b3c4",
      subject: "feat(plugin): merge the four pack manifests into one marvin plugin",
    },
    {
      sha: "2b3c4d5",
      subject: "feat(server): register every prompt and tool under the single marvin server key",
    },
    {
      sha: "3c4d5e6",
      subject:
        "refactor(skills): move all SKILL.md directories under plugins/marvin/skills and rewrite cross-references",
    },
    { sha: "4d5e6f7", subject: "feat(commands): regenerate the markdown slash wrappers" },
    {
      sha: "5e6f7a8",
      subject: "refactor(shared): extract runPackServer into @marvin-toolkit/mcp-shared",
    },
    { sha: "6f7a8b9", subject: "chore(build): bundle the shared lib via tsup noExternal" },
    { sha: "7a8b9c0", subject: "test(server): stdio smoke-test asserts serverInfo.name == marvin" },
    {
      sha: "8b9c0d1",
      subject:
        "docs(adr): record the consolidation decision as ADR-0001 with the pack retirement plan",
    },
    { sha: "9c0d1e2", subject: "chore(ci): point validate-plugins at the single plugin" },
    { sha: "0d1e2f3", subject: "fix(prompts): strip frontmatter before returning skill bodies" },
    { sha: "1e2f3a4", subject: "chore(release): sync-version across every workspace package.json" },
    { sha: "2f3a4b5", subject: "docs(readme): rewrite install instructions for /plugin install" },
  ],
  lessons: [
    { id: "dist-staleness-lint-staged", title: "Rebuild dist after lint-staged reformats source" },
    { id: "single-version-source", title: "One repo version, propagated by sync-version" },
  ],
  links: [
    { kind: "spec", label: "single-plugin-consolidation", ref: "single-plugin-consolidation" },
    { kind: "branch", label: "feat/single-plugin", ref: "feat/single-plugin" },
    { kind: "pr", label: "PR #41", url: "https://github.com/real-case/marvin-toolkit/pull/41" },
    { kind: "adr", label: "ADR-0001", ref: "docs/adr/0001-single-plugin-consolidation.md" },
    { kind: "tracker", label: "MARVIN-1", url: "https://tracker.example.com/browse/MARVIN-1" },
  ],
};
