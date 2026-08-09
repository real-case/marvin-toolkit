# Changelog

All notable changes to the **marvin** plugin are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the plugin
follows semver independently of the surrounding marketplace.

## [0.12.3] — 2026-08-08

### Fixed

- **`migration-plan` is no longer advertised as model-invocable.** Its skill has carried
  `disable-model-invocation: true` all along, but the 👤 marker came from hand-typed lists
  that were never updated, so `/marvin:help`, the public command catalog, the Storybook
  preview and both shipped command tables all told the model it was free to auto-trigger a
  human-run command.

### Changed

- **Skill frontmatter is now the only source of the human-run flag.** `humanRunSkills()`
  reads `disable-model-invocation` from each `skills/*/SKILL.md` at call time through the
  ADR-0005 frontmatter codec, and the website generator reads the same frontmatter, so
  neither carries a name list to keep in sync. A flag change in a `SKILL.md` now needs no
  second edit and no rebuild, consistent with ADR-0008.

## [0.12.2] — 2026-08-02

### Fixed

- **A broken `tracker_url_template` no longer produces links to nowhere.** `{tracker_id}`
  is the only placeholder substitution fills, but nothing checked that a template
  actually contained it. A config edited by hand to
  `"https://example.com/issues/{id}"` — a path `/marvin:track-config` documents — flowed
  through untouched, and every tracked card carried a live URL ending in a literal
  `{id}`: a markdown link in the `tracker` tool, an anchor in the tracker-list widget,
  with no warning anywhere. `trackerUrl` is now the guarantee rather than a passthrough:
  a template that cannot substitute derives `null`, which every surface already renders
  as the tracker id in plain text. Repeated `{tracker_id}` occurrences are all replaced;
  before, only the first was.
- **A setting that cannot work is dropped alone, with its reason.** The loader neutralises
  an unusable `tracker_url_template` and reports why through `/marvin:track-config` and
  `/marvin:dashboard`. It does not fall back to whole-file defaults, so one mistyped URL
  no longer risks the board's `statuses`, `gates` and `base_branch` alongside it.
- **The config surface refuses such a template instead of noting it.** Writing one was
  previously allowed with an advisory note; it is now a fail-closed error that writes
  nothing. The interactive `edit=true` form is held to the same rule — it used to bypass
  the check entirely and reach disk.

## [0.12.1] — 2026-08-02

### Fixed

- **A character split across two pipe reads no longer corrupts what a subprocess
  sends back.** Every stdio client in the repo accumulated output as
  `buf += chunk.toString()`, which decodes each read in isolation: a character whose
  UTF-8 bytes straddle a chunk boundary becomes U+FFFD on both sides of it, turning
  one character into three. Whether it happened depended on where the kernel chose to
  slice the stream, so it struck under load and vanished on retry. All of them now
  decode through the stream's own `StringDecoder`.
  - `bin/widget-preview.mjs` — the widget documents are ~300 KB with ~4% of their byte
    offsets on a continuation byte, so a preview could silently embed a document that
    was not the committed one. This is what kept CI red: the suite's byte-identity
    assertion caught it on roughly a third of runs, reported against whichever widget
    happened to be affected.
  - `verify` — a gate's captured output feeds the `details` block of
    `verification.md`, and test reporters emit ✔/✖/→ by the line, so a long enough
    gate could write mojibake into the artifact the user reads back.
  - `scripts/mcp-call.mjs`, `scripts/smoke-commands.mjs` and the trigger-eval harness,
    which had the same defect in developer tooling.

## [0.12.0] — 2026-07-31

### Added

- **`/marvin:widget-preview`** — open a marvin widget as a real rendered panel, with
  this project's own data, on a host that cannot render widgets. It writes one
  self-contained file to `.marvin/preview/<widget>.html` and opens it. This is what
  makes the widget family reachable from the terminal at all: the Claude Code CLI
  implements no part of MCP Apps, so every widget-bound tool has only ever shown its
  markdown fallback there ([ADR-0034](../../docs/adr/0034-widget-preview-door.md)).
- **`mcp/server/bin/widget-preview.mjs`** — the command behind it. A dependency-free
  script with no build target of its own: it drives the committed `dist/server.js`
  over stdio, resolves the widget from the `_meta.ui.resourceUri` binding the server
  already publishes (so no widget is named in it anywhere), fetches the document over
  `resources/read`, and composes it with the tool's payload and a small host that
  answers the five protocol messages a framed view needs.

### Notes

- Covers all nine bound widgets, but not all of them render on defaults: `help`,
  `dashboard` and `reports` do, while the task and board widgets need their tool's
  arguments, e.g. `widget-preview task-list '{"action":"list"}'`. A tool that returns
  no payload prints its own message and exits without writing a file.
- `.marvin/preview/` writes its own `.gitignore` of `*`, the `.marvin/usage/`
  convention — a preview is a derived artifact and never reaches a commit.
- The panel follows the operating system's light/dark scheme: the preview host
  advertises no theme, so the widgets' own fallback governs.

## [0.11.0] — 2026-07-31

### Added

- **The widgets follow the host's theme.** All nine `ui://` documents now read the
  light/dark theme the MCP host advertises over the protocol and render on it,
  instead of always following the operating system's `prefers-color-scheme`. A
  dark host no longer shows a light widget on a light desktop, and a theme the
  host changes mid-session is picked up without re-running the tool.
- **`src/lib/host-theme.ts`** — the shared resolver behind it. One effect seeds
  from `app.getHostContext()` and subscribes to `hostcontextchanged`; both the
  production and the seam wiring of every widget call it, which is what lets the
  seam-driven tests prove the code that actually ships.

### Notes

- When a host advertises no theme, the widgets deliberately stay on the OS
  scheme: `data-theme` is left unset rather than defaulted. Embedders that set
  the attribute on the framed `.mvroot` themselves — the marvin website does —
  keep working unchanged.
- The host's style variables, fonts and locale are still ignored. Marvin's own
  tokens and typography continue to define the widgets' appearance.

## [0.10.0] — 2026-07-29

The dashboard rework, delivered in three slices (contract → tool → widget). This
entry covers all three, since the earlier two deliberately deferred the version
bump so a single one could carry the whole change.

### Added

- **`DashboardState` v2 sections** — `servers` (the configured MCP servers),
  `current_tasks` (active board cards plus pipeline specs in flight), `handoffs`
  (recent session-continuation docs with their age), and `audits` (findings by
  severity for the newest security and refactor report). Every field is optional,
  so the narrower `help` payload keeps conforming.
- **The `dashboard` tool emits all four**, backed by four digest readers in
  `lib/state.ts` (`boardDigest` / `specDigest` / `handoffDigest` / `auditDigest`),
  plus three new terminal sections: **Current work**, **Handoffs** and **Audits**.
- **A reworked dashboard widget** on that payload: a nav sidebar, an identity
  strip, and three zones — Project (repo, board distribution bar, artifacts, MCP
  servers), Work in progress (current tasks, handoffs, audit findings with
  per-severity spark-bars), and Toolbox state (paths, config, ADR corpus, lessons,
  usage, commands). Controls send their marvin command to the conversation, and
  degrade to the clipboard, then to a revealed command, when the host declines.
- **`src/lib/actions.ts`** — the shared chat-action ladder behind those controls.
  A host refusal arrives as a RESOLVED `{ isError: true }` rather than a
  rejection, which the two pre-existing `sendMessage` call sites do not check.

### Changed

- **An audit area with no report now renders differently from one scanned clean.**
  A never-scanned project previously read as a clean bill of health.
- `specDigest` treats `superseded` specs as delivered, matching the predicate the
  task pipeline already applies. A superseded spec no longer reports as in flight.
- The `dashboard` blurb in the command reference now describes the v2 sections.

### Removed

- **`SecurityInventory` and `RefactorInventory`** from the contract, the tool
  payload, and the widget cards that rendered them. `DashboardAudits` supersedes
  both with findings and freshness per area, and `artifacts.audits` still carries
  the security document count. The refactor register counts by kind have no v2
  equivalent and were dropped deliberately, not relocated. The Artifacts text
  section no longer reports a security document count beside the Audits finding
  count: the two measured different things and read as a contradiction.

Registry unchanged: 52 prompts, 13 tools, 9 widgets.

## [0.9.0] — 2026-07-17

### Added

- **Report export, template-only** (ADR-0033): the new `/marvin:report-export`
  skill exports any generated `.marvin/` report — security scans, refactor
  registers and plans, task specs, verification, handoffs — as a **Markdown
  digest** or **print-ready HTML** (the PDF path: open in a browser → print →
  save as PDF). Claude fills the shipped print-quality template in-session;
  **no export code ships in the MCP server** — the plugin carries only the
  template (styled on the `.mvroot` widget theme tokens, locked to the token
  sheet by a new guard test) and the instructions. Exports land in
  `.marvin/export/`, which self-ignores from git. Registry: 52 prompts, tools
  unchanged (13).

## [0.8.1] — 2026-07-16

### Added

- **Reports zone-A `Sync` action** (design §A): a ghost header button that asks the
  conversation to re-run `/marvin:reports` through the host's `sendMessage` chat
  action — the handoffs continue-button precedent, and the first partial answer to
  the design doc's prompt-bridge open question.

### Fixed

- Register-table parsing no longer shifts columns when a cell carries an escaped
  pipe (`\|`) — cells split on unescaped pipes only and unescape afterwards.
- The `.marvin` report scan skips symlinked entries, so a planted symlink can no
  longer pull out-of-tree file content into `structuredContent`.
- Storybook: all widget story files now map the `hostTheme` toolbar onto the view's
  `theme` prop (previously 6 of 11 ignored the toolbar and stayed light on a dark
  canvas); the preview contract comment is true again.
- Server test loader: `esbuild` is a declared devDependency (was a phantom hoisted
  transitive) and compiled test bundles reuse one hash-keyed cache directory via
  atomic renames instead of leaking a temp dir per run.

## [0.8.0] — 2026-07-16

### Added

- **`/marvin:reports` — a unified viewer over every report marvin generates**
  (docs/design/reports-widget.md). The new `report` MCP tool scans `.marvin/` in one
  pass — security scans (via the shared audit-report parser), refactor findings
  registers and plans, task specs and `verification.md`, handoffs — and emits a
  `ReportListPayload`: one typed envelope per document, newest first, with
  server-computed staleness (> 7 days for security/refactor reports) and continuation
  commands as data. Terminals get a grouped markdown summary; MCP Apps hosts render the
  new `ui://marvin/reports.html` widget — KPI strip, group segments, a local search
  filter, per-kind detail bodies (findings with severity triage, checks, documents),
  and copy-only re-run/fix chips. Registry: 51 prompts / 13 tools / 9 widgets.

### Changed

- **Premium family restyle — all widgets move to one theme module.** A new
  `packages/marvin-widgets/src/theme/` owns the design language: a token stylesheet on
  a `.mvroot` scope (light + dark via `prefers-color-scheme`, pinnable with
  `data-theme`), the `MvRoot` boundary component, and TS token constants
  (`TOKENS` / `SEVERITY_TOKENS` / `BAR_TOKENS`) that widgets reference inline. All 8
  existing widgets plus the `<ListDetail>` / `<Markdown>` primitives were restyled to
  it: lowercase dot-pill statuses on a shared role→tone mapping, mono code chips, ghost
  link buttons, microlabel headings, segmented filters, no shadows, weights 400/500.
  The old per-widget host-var palette (`--color-*`) is gone. Darwin visual baselines
  were regenerated wholesale (92 updated + 9 new for reports).

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
