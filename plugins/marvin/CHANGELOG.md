# Changelog

All notable changes to the **marvin** plugin are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the plugin
follows semver independently of the surrounding marketplace.

## [0.7.1] — 2026-07-16

### Fixed

- **`/marvin:pr-resolve` never actually replied to or resolved review threads.** The
  reply step depended on a `$REPO` shell variable set in an earlier step — commands run
  in separate shells, so the variable was empty and the REST reply silently 404'd, after
  which the reply-then-resolve pair was abandoned. Every `gh` command in `pr-resolve`,
  `pr-review`, and the `marvin-tm-review-fixer` agent is now self-contained
  (`{owner}`/`{repo}` placeholders); thread replies moved to the GraphQL
  `addPullRequestReviewThreadReply` mutation keyed on the same thread node id as
  `resolveReviewThread` (the REST `/replies` + `databaseId` path is gone); a new
  "Verify closure" step re-queries the threads and forbids reporting success over a
  silent failure; and the change plan now includes per-thread draft replies discussed
  with the user before anything is applied — posted replies must answer the comment's
  substance, not just say "Fixed". Reply bodies pass through raw `-f` (`-F` magic-types
  values and substitutes `{owner}`/`{repo}` inside the text). The same `$REPO` bug is
  fixed in `pr-review`'s review POST; ADR-0023 carries a dated update note.

## [0.7.0] — 2026-07-16

### Changed

- **BREAKING — the `track-*` surface shrinks 14 → 7 commands** (ADR-0032). Removed:
  `/marvin:track-bug`, `-feature`, `-chore`, `-spike` (→ `/marvin:track-new` with the
  type as an argument/form field), `-review`, `-done` (→ `/marvin:track-move`, which
  also reaches any configured status), `-status`, `-tracker` (→ `/marvin:track-list`,
  which now routes between the full list, the work-in-progress view, and the tracked
  link-out view), and `-help` (→ `/marvin:help track`). The registry drops from 57 to
  50 prompts; the tools, their actions, and the widget bindings are unchanged, and
  natural-language phrasing keeps reaching the same tool actions.

## [0.6.0] — 2026-07-16

### Changed

- **BREAKING — the `kanban-*` command group is renamed `track-*`** (ADR-0031). All 14
  prompts rename mechanically (`/marvin:kanban-menu` → `/marvin:track-menu`, …
  `/marvin:kanban-help` → `/marvin:track-help`); the group key in the command registry,
  the `help` tool's `section` filter, and the widget fixtures now use `track`. The
  methodology-neutral vocabulary follows through the prose: the artifact is the "task
  board", the `commit`/`pr-create` skills are board-aware.
- **BREAKING — the board directory default moves to `.marvin/track/`** (archive:
  `.marvin/track/archive/`). Existing boards migrate with a single
  `mv .marvin/kanban .marvin/track`, or keep their location via `MARVIN_TASKS_DIR`.
- **BREAKING — `DashboardState` renames its board fields**: `kanban_counts` →
  `board_counts`, `kanban_role_counts` → `board_role_counts`; the `dashboard` tool's
  report section is now `board` (`## Board`).
- The curated help content for `track-tracker` and `track-status` now matches what the
  commands actually do (the read-only tracked-tasks list and the branch + WIP report);
  both previously described status/link *mutations*.

## [0.5.0] — 2026-07-12

### Changed

- **Help reference: two ways to call, one content source** (#101). The help widget's
  group-detail view shows each command with a Direct call chip plus ≥3 natural-language
  "marvin, …" phrases (new coverage-guarded `HelpCommand.phrases` contract field), and
  all curated reference data (`GROUP_BLURBS`, `COMMAND_BLURBS`, `COMMAND_DETAILS`,
  `COMMAND_EXAMPLES`, `COMMAND_PROMPTS`) moves into
  `@marvin-toolkit/mcp-shared/help-content` as the single source the server tool and the
  widget fixture both import. Help tool text output is byte-identical.

## [0.4.0] — 2026-07-10

### Fixed

- **Widgets rendered in the host serif font in production** (#99) — the CSS `font:`
  shorthand without a size is invalid and was silently dropped; fixed to `fontFamily`
  across all affected widgets.

### Added

- `<ListDetail>` keyboard a11y (single tab stop, `aria-activedescendant`), Markdown GFM
  strikethrough/task checkboxes with tiered inline precedence, an explicit link colour
  for dark hosts, and deterministic shared date formatting (#99).
- Storybook grows 19 → 93 stories (dark host theme, empty/minimal/stress states,
  interaction plays); every story is screenshot-gated via test-storybook +
  jest-image-snapshot with committed darwin baselines (#99).

## [0.3.0] — 2026-07-09

### Added

- **`help` widget "Read more" group drill-down** (`ui://marvin/help.html`, ADR-0024) — each
  command-group heading now carries a violet "Read more" link that opens a focused, in-widget
  detail view for that group: every command shown as `/marvin:<name>` with a richer
  description and an optional usage example, plus the 👤 human-run legend. The welcome panel
  is unchanged, and the drill-down is a pure client-side state swap over data the widget
  already holds — no extra tool round-trip. The terminal markdown door is unchanged.

### Changed

- The `help` tool's `HelpState` command entries gain a curated `description` (coverage-guarded
  like the existing blurb, with a `""` fallback so a missing entry fails CI) and an optional
  `example`, both curated in `help-data.ts` and surfaced only through the widget.

## [0.2.0] — 2026-07-09

### Added

- **`help` welcome widget** (`ui://marvin/help.html`, ADR-0024) — the `help` tool now
  binds a rich MCP Apps widget for desktop hosts: a CSS gradient wordmark, the
  per-project summary (project · git · kanban · artifacts), the configured MCP servers
  lit/dim by enabled state, the command-group table of contents, and the full
  per-command reference with authored blurbs. Terminal hosts keep the markdown fallback.

### Changed

- The `help` tool emits a purpose-built `HelpState` `structuredContent` (MCP servers with
  their enabled state, plus the full curated command index) in place of the narrower
  `DashboardState` base. The markdown fallback gains lit/dim server dots (`●` / `○`) and
  curated one-line command blurbs shared with the widget, so the two doors never drift.

## [0.1.0] — 2026-07-08

Initial release. Marvin delivers the full development lifecycle as **one MCP
server** under a single `/marvin:` slash prefix — 57 prompts and 12 deterministic
tools, reachable through three doors (chat auto-discovery, `/<command>` markdown
slash commands, and `/marvin:<command>` MCP prompts) that all resolve to the same
skill body.

### Added

- **Core developer tools** — `commit` (sensitive-file-aware Conventional Commits),
  `debug` (hypothesis-driven root-cause analysis), `adr` (tool-numbered decision
  records), `changelog`, `readme`, `migration-plan`, `explain`, `docs-search`,
  `handoff` / `handoff-list` (session continuation), `lessons` (the team
  lessons-learned store), `help`, and `dashboard` (whole-toolbox state report).
- **Pull-request lifecycle** — `pr-create`, `pr-review`, `pr-resolve`, `pr-merge`
  (ADR-0023).
- **Spec-driven task pipeline** — `task-start` (interactive spec co-creation behind a
  tool-backed Definition-of-Ready gate and an adversarial spec critic),
  `task-implement`, `task-verify` (concurrent quality gates with stack auto-detection),
  `task-deliver` (verification-gated commit + PR), and `task-summary`.
- **ADR lifecycle** — `adr-review`, `adr-accept`, `adr-audit`, `adr-coverage`,
  `adr-supersede`, `adr-sync`; deterministic mechanics live in the `adr` tool, with
  ratification, rollback, and project-memory sync reserved for humans (ADR-0027).
- **Security scanners** — `sec-scan` (OWASP Top 10:2025), `sec-secrets`, `sec-deps`,
  `sec-gate`, `sec-threat-model`, `sec-iac`, `sec-ci`, `sec-fix`, `sec-compliance`,
  `sec-pentest`, plus `sec-report` over the structured findings the scanners write.
- **Refactoring family** — `refactor-audit`, `refactor-smells`, `refactor-plan`,
  `refactor-apply`; a read → plan → apply progression under verify-gated rails
  (ADR-0029).
- **Kanban tracker** — a board-only per-project tracker (`kanban-*`, ADR-0025) with
  interactive elicitation forms, a configurable status model (ADR-0026), and PR-URL
  capture through the kanban-aware `commit` / `pr-create`.
- **Deterministic MCP tools** — `task`, `task-detail`, `tracker`, `help`, `dashboard`,
  `adr`, `verify`, `spec`, `lessons`, `handoff`, `summary`, and `audit`.
- **MCP Apps widgets** (ADR-0024) — seven bound `ui://` widgets (task-list, task-detail,
  tracker-list, handoffs, audit, task-summary, dashboard) over two React-on-Preact
  primitives (`<ListDetail>`, `<Markdown>`), each preserving a byte-unchanged terminal
  text fallback (progressive enhancement).
- **Agents** — `marvin-guide`, `marvin-researcher`, `marvin-debugger`, `marvin-auditor`,
  `marvin-refactor-auditor`, and the `marvin-tm-*` task-pipeline agents.
- **Working directory** — every generated service file lives under a single hidden
  `.marvin/` directory (ADR-0007); a local, self-ignoring usage log feeds the dashboard
  (ADR-0030).
- **Self-contained distribution** — a committed, bundled server (`dist/server.js`) and
  committed widget HTML, both guarded in CI for freshness (ADR-0013).
