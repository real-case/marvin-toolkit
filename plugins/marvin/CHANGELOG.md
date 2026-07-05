# Changelog

All notable changes to the **marvin** plugin are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the plugin
follows semver independently of the surrounding marketplace.

## [0.16.1] — 2026-07-05

Adds the second reusable widget primitive, **`<Markdown>`** — a minimal,
dependency-free renderer that turns the marvin-generated markdown bodies
(`TaskDetail`/`HandoffDetail` `body_markdown`, plus audit fragments and
dashboard/summary copy) into DOM elements inside the host CSP. It ships
**unconsumed** ahead of the widgets that need it, so there is no `ui://` resource
or server change this release.

### Added

- **`<Markdown>` primitive** (`packages/marvin-widgets/src/primitives/Markdown.tsx`)
  — parses a GFM subset (ATX headings, paragraphs, bold/italic, inline + fenced
  code, ordered/unordered lists, links, blockquotes, thematic breaks, tables) and
  emits Preact elements via the JSX runtime. **No `dangerouslySetInnerHTML` and no
  sanitiser:** text is JSX-escaped (raw HTML renders as literal text) and link
  `href`s are scheme-allowlisted (`http(s)`/`mailto`/`tel`/relative; a
  `javascript:`/`data:` link degrades to plain text). The parser is total —
  arbitrary input never throws.

## [0.16.0] — 2026-07-04

The widgets bundle migrates from React to **Preact** and the committed widget HTML
is now **minified** (ADR-0024's named bundle-size escape hatch). The shipped
`task-list` widget behaves identically — its full suite, including the mock-host
App↔AppBridge handshake, stays green — while the committed document drops from
708 KB / ~21.7k lines to **292 KB / ~80 lines**, so every subsequent widget PR is
a compact diff instead of a 20k-line one. The spike behind this found the inlined
bundle is ~95 % third-party (zod via `@modelcontextprotocol/ext-apps`), so the win
comes from minifying a hash-guarded build artifact — real review lives in the
`.tsx` source and tests, not the committed HTML.

### Changed

- **Widgets render on Preact.** `react`/`react-dom` are aliased to `preact/compat`
  via `@preact/preset-vite` (with `react-dom/client` aliased too, and the browser
  entry mounting through Preact's `render`). No component logic changes — the code
  stays React-shaped.
- **Committed widget HTML is minified** (`vite build` `minify: "esbuild"`), guarded
  byte-for-byte by `verify-widgets` exactly as before.
- **Tests use `@testing-library/preact`**; Storybook keeps `@storybook/react-vite`
  with the compat aliases injected via `viteFinal` (story files unchanged).

## [0.15.0] — 2026-07-04

The first MCP Apps widget ships end-to-end (ADR-0024 Stage-2). A React `task-list`
widget renders the `task` tool's `TaskListPayload` inside a rich host's `ui://`
iframe, while the terminal text fallback stays byte-for-byte unchanged. This slice
also lands the reusable widget foundation — a `<ListDetail>` primitive, the
3-type link model, the Vite singlefile toolchain, a Storybook + mock-host harness,
and a committed-HTML dist guard — that the remaining widgets will reuse.

### Added

- **`packages/marvin-widgets` workspace** — the browser widget bundle (React +
  `@modelcontextprotocol/ext-apps` v1.7.4, Vite + `vite-plugin-singlefile`). Emits
  one self-contained HTML per widget to the committed `plugins/marvin/widgets/`.
- **`task-list` `ui://` widget** — a `<ListDetail>` master-detail view over the
  `TaskListPayload`, wired via `useApp()` (`ontoolresult`). Served as
  `ui://marvin/task-list.html` (mimeType `text/html;profile=mcp-app`) and bound to
  the `task` tool through `_meta.ui.resourceUri`. The server stays ext-apps/React
  free — the binding is a plain `_meta` object plus the shared `registerResource`.
- **`<ListDetail>` primitive + the 3-type link model** — the reusable foundation
  the remaining widgets build on.
- **Storybook + mock-host harness** — a fake ext-apps host over an in-memory
  transport drives the real handshake in vitest and Storybook without a browser
  iframe; `scripts/verify-widgets.mjs` guards the committed HTML (in sync with a
  fresh build and self-contained).

### Changed

- **`task` tool** gains `_meta.ui.resourceUri` (additive) and the server advertises
  the `resources` capability. Text + `structuredContent` output are unchanged.

## [0.14.0] — 2026-07-04

Security scanners gain a machine-readable side (ADR-0024 #7 Tier-2), closing the
last Stage-1 data item of the MCP Apps widget layer. Every `sec-*` scanner now
emits a typed `audit-report` block alongside its prose, and a new read-side
`audit` tool surfaces those findings as `structuredContent`. Registry grows to
55 prompts / 10 tools.

### Added

- **`audit` MCP tool + `/marvin:sec-report`** — reads the `.marvin/security/*.md`
  reports, recovers each scanner's fenced ` ```json audit-report ` block, zod-
  validates it against the `AuditReport` contract, and returns a text summary
  plus an `AuditListPayload` (the audit-viewer widget payload, ADR-0024 #7).
  Reports with no block are skipped (legacy prose stays valid); a present-but-
  invalid block is isolated as malformed so one bad report never breaks the
  listing (the `handoff` fail-open precedent).
- **`AuditListPayload` contract** — the read-side/widget wrapper over
  `AuditReport[]` in `@marvin-toolkit/mcp-shared/contracts`.
- **`MARVIN_SECURITY_DIR`** env override (default `.marvin/security`) for test
  isolation, mirroring `MARVIN_HANDOFF_DIR`.

### Changed

- **All 8 `sec-*` scanner skills** (`sec-scan`, `sec-secrets`, `sec-deps`,
  `sec-iac`, `sec-ci`, `sec-threat-model`, `sec-compliance`, `sec-pentest`) now
  append a typed `audit-report` block after their prose report — one finding per
  vulnerability / ASVS gap / STRIDE threat / checklist item, with per-severity
  counts. `sec-gate` and `sec-fix` are unchanged (no findings register).

## [0.13.0] — 2026-07-03

Usage telemetry (toolbox-expansion WP7), completing ADR-0030: the dashboard can
finally answer "which of the 50-odd commands does this project actually use?"
from a local, self-ignoring event log. Middleware and wiring only — no new
prompt and no new tool (registry stays 54 / 9).

### Added

- **Local usage log** (`.marvin/usage/events.jsonl`) — a `runPackServer`
  middleware hook appends one JSONL event per prompt-get and per tool-call:
  `{ ts, kind, name }` and nothing else. The event is deliberately minimal —
  the ISO timestamp, whether it was a `prompt` or a `tool`, and the registered
  command name — so no arguments, payloads, or anything user-identifying is
  ever recorded. The `dashboard` tool's usage section (shipped in 0.12.0) now
  has a real producer; the format matched its defensive reader unchanged.
- **`usage.enabled` config kill-switch** — `usage: { enabled: false }` in
  `.marvin/config.json` turns all logging off, read through the same
  fail-closed config path as the other tool-owned blocks (foreign keys survive
  read-modify-write). Absent config, or an absent `usage` block, means enabled:
  telemetry is opt-OUT.

### Guarantees

- **Local-only, never committed.** On first write the log's directory gets a
  `.gitignore` whose sole content is `*`, so neither the log nor the directory
  ever reaches git — per-machine telemetry stays per-machine regardless of
  whether the host commits the rest of `.marvin/`. The log is read only by the
  local `dashboard` tool and is never transmitted anywhere.
- **Bounded.** The log is size-capped (~1 MiB); on overflow it rotates to
  `events.jsonl.1` (one generation kept) and a fresh file starts — no unbounded
  growth.
- **Fail-open.** Any logger failure — unwritable directory, full disk,
  malformed config, a bad path — is swallowed. Logging is best-effort and never
  breaks or delays the prompt-get or tool-call it observes; results and errors
  are byte-for-byte unchanged whether logging succeeds, fails, or is disabled.

### Privacy

Usage data lives only in the project-local `.marvin/usage/` directory, is never
committed (self-ignored) and never transmitted. What is recorded: command names
and timestamps only — no arguments, no file contents, no PII. To disable, set
`usage: { enabled: false }` in `.marvin/config.json` (via
`/marvin:kanban-config` or by hand); logging stops immediately, no restart
needed.

### Fixed

- **`debug` / `explain` trigger boundary** — the two skills overlapped on the
  phrase "walk me through": a real bug ("this throws and I don't understand
  why — walk me through") could be auto-selected by `explain` instead of
  `debug`. Both descriptions now key on **intent** rather than that phrase —
  `debug` owns finding or fixing the cause of a failure (even when phrased as a
  walk-through), `explain` owns understanding how code behaves (including code
  that throws) when no fix is wanted and defers failures to `debug`. Surfaced
  and verified by the Tier-B triggering harness (`evals/trigger/`).

## [0.12.0] — 2026-07-03

The toolbox dashboard (toolbox-expansion WP6, ADR-0030): one deterministic
command shows the whole toolbox state, and the MCP Apps widget data layer
(ADR-0024 stage 1) is complete — the extended `DashboardState` is the last
stage-1 contract.

### Added

- **`dashboard` MCP tool + `/marvin:dashboard`** (inline thin wrapper, tools
  8 → 9, registry 53 → 54) — a sectioned whole-toolbox report: project
  paths/config/git, kanban board counters (per configured status, ADR-0026),
  artifact inventories with freshness (task specs + `verification.md` age,
  security reports + newest-report age, refactor registers by kind —
  audit/smells/plan per the ADR-0029 naming, handoffs), lessons statistics
  (the ADR-0028 `stats` computation), the ADR corpus by status (the ADR-0027
  parser with its host-adaptive directory resolution), and a usage summary
  read defensively from `.marvin/usage/events.jsonl` when one exists
  (malformed lines skipped; the writer arrives with the usage-telemetry work
  package). Optional `section` filter narrows the text; `structuredContent`
  always carries the full extended `DashboardState`. Every section degrades
  to a sensible zero state on a fresh project. The command index stays on
  `/marvin:help`.
- **Extended `DashboardState` contract** (shared `contracts/`, ADR-0030) —
  new optional sections `adr` (per-status counts over the closed `AdrStatus`
  vocabulary), `security` (report count + newest age), `refactor` (counts by
  kind), `lessons` (the shared `LessonsStats`), `usage` (event count, window,
  top commands), and `verification` freshness under `artifacts`. All optional,
  so the `help` tool's narrower payload keeps conforming — no schema break.
- **ADR-0030** — records both halves of the design: the dashboard (this
  release) and the local, self-ignoring `.marvin/usage/` JSONL events log
  with size cap, rotation, and a `usage.enabled` kill-switch (specified here,
  implemented by the next work package).

### Changed

- The `help` tool's state computation (kanban counters, git availability,
  artifact counts, registry-derived command groups) moved to a shared
  `lib/state.ts` module consumed by both `help` and `dashboard` — no
  behaviour change to `help` beyond the fix below.

### Fixed

- The registry-derived command groups now recognise `adr-*` and `refactor-*`
  as their own groups instead of lumping them into *core* (drift left by the
  WP2/WP4 landings), and the bare `/marvin:adr` singleton stays in *core*.
  `help`'s `section` filter accepts `adr` and `refactor` accordingly.

## [0.11.0] — 2026-07-03

The refactoring family is complete (toolbox-expansion WP5, ADR-0029): findings
become sequenced plans, and small steps execute one at a time under the hard
rails the ADR reserved for the mutating side — no new MCP tool, every
deterministic need already covered by `verify`, `lessons`, and `task`.

### Added

- **`/marvin:refactor-plan`** — turns selected findings from audit/smells
  registers into a sequenced, risk-annotated plan
  (`.marvin/refactor/NNN-plan-<slug>.md`, same number sequence as the
  reports). Evidence is re-verified against `HEAD` before planning; each step
  carries rationale, dependency ordering, risk, rollback, test strategy, and
  effort. Items above the small-step threshold (multi-module surgery,
  behaviour changes, schema/API moves) are not planned inline — they are
  routed to the task pipeline as `route: task-start` entries with a
  ready-to-use `/marvin:task-start` input block. Closes by offering
  `/marvin:refactor-apply` for the first step, kanban chores via the `task`
  tool, and dispatch of the routed items.
- **`/marvin:refactor-apply`** — executes exactly **one** behaviour-preserving
  step per invocation (from a plan, or a directly named `F<n>` in a register)
  under an explicit rail protocol: pre-flight `verify` must be green (red
  baseline → refusal with the failing gates; a clean working tree is required
  so the step is the only diff); the touched code must have test coverage —
  uncovered code is refused with an offer to write the pin-down
  (characterization) test first, in scope for the same run; `lessons search`
  runs before the edit (a hit becomes a constraint) and at most one genuine
  lesson is captured after (anti-boilerplate guards); `verify` re-runs after
  the edit, and on red the step is **rolled back, never debugged forward** —
  red gates after a behaviour-preserving step are evidence the step was too
  big. Ends by updating the plan's step marker and step log (date + commit
  ref) and suggesting the next step.

### Changed

- `docs/commands.md`, both READMEs, CLAUDE.md, and the architecture tour now
  describe the full read → plan → apply family; `.marvin/refactor/` table rows
  mention the plan files. Registry counts updated to the actual 53 after the wave-2 landings (the
  two READMEs and CLAUDE.md had gone stale at 44).

## [0.10.0] — 2026-07-02

WP2 of the toolbox expansion — the command surface for
[ADR-0027](../../docs/adr/0027-tool-backed-adr-lifecycle.md)'s tool-backed ADR
lifecycle. The full lifecycle is now reachable through all three doors, with
the mutating-authority steps reserved for humans.

### Added

- **`adr-*` command family** — six skill-backed commands over the WP1 `adr`
  tool (registry 45 → 51):
  - `/marvin:adr-review` — deep review of one `proposed` record: section
    validation, grounding of every claim in the actual codebase, auto-fix of
    formal defects only (formatting, links, mechanical placeholder fills —
    never the substance of the decision), verdict `READY_FOR_ACCEPTANCE` or a
    defect list. Never sets `accepted`.
  - `/marvin:adr-accept` 👤 — ratification `proposed → accepted` via the
    tool's fail-closed readiness gate; refusals are translated into a fix
    path per failure class. Human-run (`disable-model-invocation`).
  - `/marvin:adr-audit` — read-only corpus lint rendering the `adr audit`
    findings with remediation guidance per class (malformed files, invalid
    statuses, duplicate numbers, dangling references, broken supersede pairs,
    placeholder residue, numbering holes, stale index).
  - `/marvin:adr-coverage` — read-only gap analysis: the recorded corpus vs
    the decisions visible in the actual stack (dependencies, infra, CI,
    architectural seams), ranked by blast radius; explicit deferrals honored;
    no mutation.
  - `/marvin:adr-supersede` 👤 — proper rollback: a successor record (fresh
    `proposed` skeleton or an existing draft) pairs with the old one, links
    flip both ways, the old record's content is never edited. Human-run.
  - `/marvin:adr-sync` 👤 — regenerates a marker-managed
    (`<!-- marvin:adr-digest:start/end -->`) "Architecture decisions" digest
    in the project's `CLAUDE.md` from **accepted** records only — diff shown,
    explicit confirmation before writing. Human-run.

### Changed

- **`/marvin:adr` (creation) reworked** — the interview/drafting flow and the
  MADR-ish template stay, but all mechanics now delegate to the `adr` tool:
  `next` replaces the manual number scan and yields the exact target path,
  `list` provides corpus context, `index` refreshes the corpus index after
  writing. Drafts always land with status `proposed` — ratification moved to
  `/marvin:adr-accept` — and supersession is routed to `/marvin:adr-supersede`
  instead of hand-edited links. `disable-model-invocation` is dropped:
  creation is model-invocable now that a wrong draft costs nothing (ADR-0027).

## [0.9.0] — 2026-07-02

WP1 of the toolbox expansion ([ADR-0027](../../docs/adr/0027-tool-backed-adr-lifecycle.md)):
every deterministic ADR-lifecycle guarantee moves out of prose into a new `adr`
MCP tool. This package ships the mechanics only — the `adr-*` command surface
(review, accept, audit, coverage, supersede, sync) arrives with WP2.

### Added

- **`adr` MCP tool** — six actions over the project's decision-record corpus:
  `next` (collision-free numbering + target-path preview), `list` (parsed
  corpus with statuses and per-status counts), `audit` (corpus lint: dangling
  `ADR-NNNN` references, numbering holes/duplicates, broken supersede pairs,
  placeholder residue, invalid statuses, stale index — errors fail it,
  warnings inform), `index` (regenerates the corpus index between
  `<!-- marvin:adr-index:start/end -->` markers so hand-written prose
  survives; skips gracefully with no target), `accept` (readiness gate — no
  `{…}` placeholders outside code, required sections present, cross-references
  resolve — then a status + date stamp in the record's own header style), and
  `supersede` (creates a `proposed` skeleton or pairs an existing successor,
  links both ways, and flips the old record's status — its content is never
  edited). Mutating actions validate fail-closed.
- **Host-adaptive corpus resolution** — `adr.dir` in `.marvin/config.json`
  wins; otherwise the first existing of `docs/adr/`, `docs/decisions/`,
  `adr/`; otherwise `docs/adr/`. The optional `adr.index_file` names the
  managed index target. The `adr` block rides the same fail-closed config
  path as the kanban settings; keys owned by other tools survive every
  read-modify-write.
- **Dual-style record parser** — one record shape from both header styles in
  the wild: marvin's table style (`| Status | **Accepted** … |`) and the
  MADR/Nygard heading style (`## Status`). Status vocabulary is the closed
  set `proposed | accepted | deprecated | superseded | rejected`; files the
  parser cannot read surface per file through a malformed channel instead of
  sinking the corpus.
- **`AdrRecord` contract family** (`AdrStatus`, `AdrRecord`, `AdrListPayload`,
  `AdrAuditFinding`, `AdrAuditPayload`) in the shared `contracts/` module
  (ADR-0024 data-first staging); the tool emits `structuredContent` built
  from it alongside its text rendering — the future dashboard's ADR feed.

## [0.8.0] — 2026-07-02

Lessons v2 (WP3 of the toolbox expansion, ADR-0028): the ADR-0021 feedback
loop widens on both ends — every code-writing flow now recalls prior lessons
before touching code, the PR-review channel captures them — and the store
gains a maintenance surface so it stays small and scannable by tooling, not
by hope.

### Added

- **`stats` action on the `lessons` tool** — counts by type and by tag,
  rendered as text and emitted as `structuredContent` conforming to the new
  shared `LessonsStats` contract (the planned dashboard's lessons feed,
  ADR-0024 data-first staging). The closed type taxonomy is reported per key
  even at 0; tags are an open vocabulary.
- **`prune` action on the `lessons` tool** — with no arguments it lists
  candidates (lessons older than 180 days; near-duplicate title pairs) and
  deletes nothing. Deleting takes an explicit `slug` plus explicit
  confirmation — an elicitation form on capable hosts, `confirm: true`
  elsewhere — and removes the lesson file together with its
  `.marvin/memory/MEMORY.md` index line, so the pair can never drift.
- **Near-duplicate guard on `lessons add`** — the tool searches before
  writing; a title that slug-collides with or heavily overlaps an existing
  lesson answers with a warning naming the existing slug instead of writing.
  `force: true` overrides deliberately.
- **`/marvin:lessons` prompt** — an inline thin wrapper (kanban-style), so
  humans search / add / stats / prune the store from chat (registry 44 → 45).

### Changed

- **Recall reaches every write path** (ADR-0028): `task-implement` searches
  the store while reading context, `sec-fix` at finding intake, and the two
  code-writing agents (`marvin-tm-executor`, `marvin-tm-review-fixer`) get a
  search-first step before touching code. Degradation unchanged — skim
  `MEMORY.md`, or skip silently in headless runs without the tool.
- **`pr-resolve` captures review lessons** — a retrospective step with the
  same anti-boilerplate guards as `task-deliver`: routine feedback writes
  nothing, at most one or two lessons, `source: "PR #<n>"`. (The expansion
  plan named `task-fix-pr` as this capture point; that command was renamed to
  `pr-resolve` by ADR-0023.)

## [0.7.0] — 2026-07-02

The refactoring family opens its read side (toolbox-expansion WP4, ADR-0029):
the project can now be audited and scanned for structural debt without any
mutation. Findings land as numbered registers under `.marvin/refactor/`,
compose across commands, and can be filed straight to the kanban board. The
plan/apply half of the family (sequenced plans, verify-gated execution)
follows in the next package against the same ADR.

### Added

- **`/marvin:refactor-audit`** — whole-project structural audit: architecture
  map, hotspots (git churn × file size, with concrete `git log`-based
  commands), dependency tangles, dead-code candidates. Heavy reading is
  delegated to the new read-only `marvin-refactor-auditor` agent; every
  finding carries `file:line` evidence. Writes a findings register to
  `.marvin/refactor/NNN-audit-<slug>.md` (`F<n>` id, severity, effort,
  evidence, suggested direction) and closes by offering to file selected
  findings as kanban chores via the `task` tool.
- **`/marvin:refactor-smells`** — scoped scan of a path, module, or diff:
  code smells, anti-patterns, idiom/naming inconsistencies judged against the
  project's own dominant conventions. Emits the same register format as the
  audit (`NNN-smells-<slug>.md`), so scoped reports compose with the
  whole-project one.
- **`marvin-refactor-auditor` agent** — read-only structural auditor
  (`tools: Read, Glob, Grep, Bash` allowlist, ADR-0017 pattern): structure
  mapping, hotspot ground truth, dependency tracing, dead-code detection,
  smell verification; returns register-ready candidate findings and never
  writes.
- **`.marvin/refactor/` working directory** — joins the ADR-0007 table:
  numeric-prefixed reports in creation order, one sequence shared by audit
  and smell scans (mirrors the handoff convention).
- **`RefactorFinding` contract** — zod schema in the shared `contracts/`
  module (ADR-0024 data-first staging): id, title, severity (shared audit
  vocabulary), effort, evidence locations, direction, source report.
  Data-only; the dashboard and widget stages are the intended consumers.
- **ADR-0029** — records the whole `refactor-*` family design: the read →
  plan → apply split, the shared register format, task-pipeline routing for
  oversized items, and the hard rails of the future `refactor-apply`
  (green `verify` before and after, pin-down tests on uncovered code,
  lessons consulted and fed).

## [0.6.0] — 2026-07-02

Polish and coverage sweep (WP5, the final package of the kanban rework): the
board gets an archive, the kanban help stops shouting the full command index,
the onboarding guide learns the board exists, and the whole lifecycle is now
covered end to end by stdio-driven tests.

### Added

- **`archive` action on the `task` tool** — move finished work off the board
  into `.marvin/kanban/archive/`. An explicit `taskId` archives that one task
  (role-checked to done, like the other lifecycle verbs); with no `taskId` it
  archives every done-role task after a confirmation — an elicitation form on
  capable hosts, `confirm: true` elsewhere. Archived tasks leave the board
  everywhere (list, counters, structured payloads); their ids stay reserved
  (`nextSeq` scans the archive too), and `kanban-list` shows an
  "N archived task(s)" footer while the archive is non-empty. Reachable from
  the `kanban-menu` picker and by name.
- **End-to-end lifecycle test sweep** — stdio-driven coverage of the full
  chain (create → start → move → review → link-pr → done → archive → list)
  across server restarts, a config read/update round-trip mid-session, the
  archive confirmation/degradation paths, and the id-reservation regressions
  (malformed and archived files).

### Changed

- **`/marvin:kanban-help` is scoped to the kanban group** — it now calls the
  `help` tool with `section: "kanban"` (board state + the 12 kanban commands)
  instead of rendering the full 42-command index. The full dashboard stays on
  `/marvin:help`.
- **`marvin-guide` knows the board** — the onboarding agent checks for
  `.marvin/kanban/` and, in repos that use it, shows what is in flight and
  points new developers at the `/marvin:kanban-*` commands.

## [0.5.0] — 2026-07-02

The board gets its configuration surface (WP4 of the kanban rework): a
first-run and tracker-connection entry point, so nobody hand-writes
`.marvin/config.json`.

### Added

- **`config` action on the `task` tool + `/marvin:kanban-config` prompt**
  (audit finding 17 and the config half of finding 4) — with no arguments it
  renders the effective configuration: project/tasks/config paths,
  `base_branch` with its source (config file · auto-detected from
  `origin/HEAD` · default), `tracker_url_template`, `branch_template`, and
  the statuses table (key, role, tracker_status). With arguments it edits the
  file: `base_branch`, `tracker_url_template`, `branch_template` as plain
  strings (an empty string clears a setting back to its default), `statuses`
  as a JSON array validated fail-closed against the config schema — invalid
  payloads answer with the exact issues (missing todo/wip/done roles, bad
  keys, duplicates) and write nothing. Scalar fields are also editable through
  an interactive form (`edit=true`) on hosts with elicitation; hosts without
  get the WP3-style instructive error naming the retry arguments. The file is
  created on first edit (pinning the auto-detected `base_branch` so creating
  a config never flips a main-based repo back to `dev`); writes are atomic
  (temp + rename), and the read-modify-write preserves every key the surface
  does not manage — the `verify` tool's `gates` and anything a future tool
  adds. Switching vocabularies on a live board warns about tasks stranded in
  now-unknown statuses.
- **`branch_template` config setting** — new-task branches can follow a
  custom scheme with `{type_prefix}`, `{type}`, `{seq}`, `{tracker}` and
  `{slug}` placeholders (without a tracker id, `{tracker}` plus one preceding
  `-`/`_`/`.` collapses). The rendered name is checked against git ref rules:
  a bad template falls back to the default ADR-0019 scheme and warns in the
  create output instead of failing the create; setting a template previews
  the rendered branch (with and without a tracker id) immediately.

### Changed

- **Tools read `.marvin/config.json` per call** instead of capturing a
  snapshot at server startup, so `config` edits (and hand edits) apply to the
  same session immediately — no server restart. Affects the `task`, `help`
  and `summary` tools; `verify` already worked this way.

## [0.4.0] — 2026-07-02

The model becomes a first-class caller of the kanban board (WP3 of the kanban
rework): every form field is also a tool argument, elicitation degrades
gracefully, and the storage layer survives real-world input.

### Added

- **Model-passable arguments on the `task` tool** — `title`, `description`,
  `tracker_id` (create) and `status` (the target key for `move`) join `action`,
  `type`, `taskId`, `url`. Each flow elicits only the fields still missing after
  the arguments are applied: `create` with `type` + `title` runs with no form at
  all, `move` with a valid `status` skips the picker (an unknown key answers
  with the configured keys). `review` and `done` now honor an explicit `taskId`
  (role-checked, like `start`). Explicit-but-invalid values earn instructive
  errors (`title` against the TaskTitle contract, `tracker_id` against
  SHORT-123) instead of silent re-asks. The kanban prompt bodies tell the model
  to mine the user's message for these arguments up front.
- **Elicitation capability detection** — new `canElicit(server)` in the shared
  lib reads the client's declared capabilities. On hosts without elicitation
  support, interactive flows return an instructive `isError` naming exactly the
  arguments to pass on retry — never a raw wire error; argument-complete calls
  work end to end. `elicit()` itself now throws a readable message if called
  without the capability (backstop, documented in its JSDoc).
- **Unicode titles** — the TaskTitle contract accepts any printable Unicode
  (3..120 chars, control characters rejected); the derived elicitation-form
  pattern stays a portable ECMA-262 regex. Slugs remain ASCII kebab-case; a
  fully non-Latin title falls back to the task type as its slug
  (`001--bug.md`), so filenames and branches never get an empty slug segment.

### Changed

- **Branch names follow the ADR-0019 topic-branch convention** — new tasks
  generate `<type-prefix>/<seq>[-<tracker>]--<slug>` with bug→`fix`,
  feature→`feat`, chore→`chore`, spike→`spike` (e.g.
  `fix/007-OSI-123--login-timeout`, previously `007-OSI-123--login-timeout`).
  Existing tasks keep their stored `branch` frontmatter — no migration.

### Fixed

- **Sequence ids are derived from every `.md` filename** in the tasks dir —
  including files whose frontmatter fails validation — so a malformed file can
  no longer cause its id to be handed out twice.
- **Task writes are crash-safe** — files land via temp-file-plus-rename in the
  same directory; readers see the old task file or the new one, never a torn
  half-write.

## [0.3.0] — 2026-07-02

Statuses become project data ([ADR-0026](../../docs/adr/0026-configurable-status-model.md)):
the board runs any tracker vocabulary while the lifecycle commands stay role-driven.

### Changed (breaking — widget contracts)

- **`TaskCard.status` is now `{ key, role }`** and the board counts are an **open
  per-key record plus a closed per-role roll-up** (`TaskListPayload.counts` +
  `role_counts`, `DashboardState.kanban_counts` + `kanban_role_counts`; the dashboard
  `config` also carries the configured `statuses`). Shipped before the first ADR-0024
  widget consumer on purpose — the structured-content tests are the reference consumers.
- **Lifecycle transitions are role-driven.** `create`/`start`/`review`/`done` target the
  first configured status of their role; candidate pickers filter by role. `review`
  without a review-role status explains itself and points at `move`.
- **Honest empty-candidate replies** — "no tasks in a …-role status" instead of the
  misleading "Cancelled — no changes made" (audit finding 8), and `start` with an explicit
  `taskId` now applies the same todo-role filter as the picker (finding 14).

### Added

- **`statuses` in `.marvin/config.json`** — `{ key, role, tracker_status? }[]` with role
  invariants (todo/wip/done required, review/blocked optional, unique keys). Defaults to
  the classic five (key == role), so existing boards parse unchanged; unknown status keys
  in task files surface through the malformed-file channel with an explicit reason.
- **Generic `move` action on the `task` tool** — transition a task to *any* configured
  status (the previously unreachable `blocked` included, finding 5), resolving the task
  like the other actions: explicit `taskId`, else the current branch's task, else a picker.
- **`base_branch` auto-detection from `origin/HEAD`** when no config file exists
  (finding 4's detection half) — main-based repos work on first run; a config file always
  wins.

## [0.2.0] — 2026-07-02

The kanban group goes **board-only** ([ADR-0025](../../docs/adr/0025-kanban-board-only.md)):
git operations move out of the tracker and into the task-aware core skills.

### Removed (breaking)

- **Prompts `/marvin:kanban-commit` and `/marvin:kanban-create-pr`** — use
  `/marvin:commit` and `/marvin:pr-create`, which now pick up board-task context
  automatically (kanban 13 → 11 commands, 41 prompts total).
- **The `git` MCP tool.** The PR lifecycle is prose-driven (ADR-0023); the one
  deterministic piece that had to survive — PR-URL capture onto task frontmatter
  (ADR-0024 widget data) — moved to the `task` tool as the new `link-pr` action.

### Added

- **`task` tool `link-pr` action** — validates an http(s) PR URL and persists it
  onto the linked task's frontmatter via `setTaskPr` (explicit `taskId` wins,
  otherwise the task whose `branch` matches the current branch; a typed error
  when neither resolves).
- **`pr` column in `task list`** — the stored PR URL renders as a link in the
  board table, and the structured payload carries the populated `PrRef`.

### Changed

- **`commit` skill is kanban-aware** — when the current branch belongs to a board
  task, the commit message gains a `Refs: <id>[, <tracker_id>]` footer.
- **`pr-create` skill is kanban-aware** — task-prefixed title (`[<tracker_id>]`
  falling back to `[<id>]`), `Task:`/`Tracker:` body lines, an explicit
  `git push -u origin <branch>` step, and — after creation — a `task link-pr`
  call plus an offer to move the task to review.
- The `task` and `help` tool descriptions now name the **kanban board**, so chat
  phrases like "add a bug to the board" keep routing to the tracker (the group
  has no skills; the descriptions are its only auto-discovery surface).

## [0.1.0] — 2026-07-01

First public release. Marvin is one Claude Code plugin backed by a single MCP server,
exposing the whole development lifecycle under the `/marvin:` slash prefix. The version
resets from the internal `2.0.0-alpha` line — which tracked the four-pack → single-plugin
consolidation, never a shipped 1.x — to an honest pre-1.0 start (see ADR-0001).

### Added

- **Core developer tools** — `commit`, `debug`, `adr`, `changelog`, `readme`,
  `migration-plan`, `explain`, `docs-search`, `handoff` (+ `handoff-list`), and `help`
  (a registry-derived dashboard and full command index).
- **Pull-request lifecycle (`pr-*`)** — `pr-create`, `pr-review`, `pr-resolve`, `pr-merge`.
- **Spec-driven task pipeline (`task-*`)** — `task-start` (interactive spec co-creation with a
  tool-backed Definition-of-Ready gate), `task-implement`, `task-verify` (concurrent quality
  gates with stack auto-detection), `task-deliver` (delivery gated on verification), and
  `task-summary`.
- **Security scanners (`sec-*`)** — `sec-scan`, `sec-secrets`, `sec-deps`, `sec-gate`,
  `sec-threat-model`, `sec-iac`, `sec-ci`, `sec-fix`, `sec-compliance`, `sec-pentest`.
- **Kanban tracker (`kanban-*`)** — a lightweight per-project board with interactive
  MCP-elicit forms (13 commands).
- **Deterministic MCP tools** — `task`, `git`, `help`, `verify`, `spec`, `lessons`,
  `handoff`, `summary` — used where determinism matters (file CRUD, git ops, quality gates,
  the DoR contract, the lessons store).
- **Nine subagents** — read-only auditors/critics and code-writing executors for the task
  pipeline and research.
- **43 prompts total**, reachable through three doors — chat auto-discovery, `/<command>`
  markdown slash commands, and `/marvin:<command>` MCP prompts — all sharing one `SKILL.md`.

### Notes

- Distribution is git-tag → GitHub Release (no npm publish); install via the Claude Code
  plugin marketplace (ADR-0014).
- The committed `dist/server.js` is the shipped artifact; CI verifies it stays in sync on
  every server change.

## [2.0.0-alpha.30] — 2026-06-30

Add the task-summary aggregator and make verification.md machine-readable.

### Added

- **`/marvin:task-summary`** — a "what was done" summary for a spec-pipeline task,
  backed by the new `summary` MCP tool. Joins five already-typed sources for one spec —
  the spec-contract `criteria`, the `verification.md` gate outcomes, the branch's git
  log, the captured lessons, and the artifact links — into one `TaskSummary`
  `structuredContent` payload plus a text fallback (ADR-0024, widget #3). Per-criterion
  outcome is conservative: "pass" only when verification passed and the criterion has a
  real (test/command) oracle; otherwise "unknown" — it never fabricates a per-AC verdict.
  Prompt count 42 → 43.

### Fixed

- **`verify` now persists the `verify-result` block into `verification.md`.** The
  machine-readable block previously lived only in the tool's return value, so a real
  `task-verify` → `task-deliver` always blocked at the delivery gate (which reads the
  block back from the file) with "no machine-readable verify-result block". The written
  artifact now matches the returned text.

### Changed

- The spec-contract / host-bindings schemas and extractors moved from the `spec` tool
  into a shared `storage/spec.ts`, so the `spec` DoR gate and the task-summary aggregator
  read the same authoritative shape (no behaviour change to the gate).

## [2.0.0-alpha.29] — 2026-06-30

Make the dashboard command index registry-driven and filterable.

### Added

- **`/marvin:help [section]`** — the marvin dashboard now lists the **full** command index,
  derived from the prompt registry (`PROMPTS`) and grouped by `core` / `pr` / `task` / `sec` /
  `kanban`, instead of a hand-maintained list that only covered the kanban group. Pass a
  section (e.g. `/marvin:help sec`) to filter to one group; an unknown section falls back to
  the full index with a hint. Prompt count 41 → 42.

### Changed

- The `help` tool's `## Commands` section and the `DashboardState.command_groups` payload are
  now the single registry-derived source, so the dashboard can no longer drift from the real
  command set.

## [2.0.0-alpha.28] — 2026-06-29

Add a read side for handoffs and make the handoff artifact machine-readable.

### Added

- **`/marvin:handoff-list`** — list the session-continuation handoff documents under
  `.marvin/handoff/`, newest first. A thin wrapper over the new `handoff` MCP tool, which
  returns both a text listing (terminal fallback) and a typed `HandoffListPayload`
  `structuredContent` for MCP Apps hosts (ADR-0024, the handoff widget #5). Prompt count
  40 → 41.
- **Handoff frontmatter** — the `/marvin:handoff` skill now opens each handoff document with
  a YAML frontmatter block (`id`, `slug`, `objective`, `branch`, `base?`, `pr_url?`,
  `spec_slug?`, `created`) validated against the `HandoffCard` data contract. The list source
  reads it directly — no prose parsing. Legacy handoffs without frontmatter are surfaced as
  malformed rather than dropped.

## [2.0.0-alpha.27] — 2026-06-28

Add a session-handoff command.

### Added

- **`/marvin:handoff`** — capture the current work's full, inspected context into a
  durable handoff document at `.marvin/handoff/<NNN>-<slug>.md` (numeric-prefixed,
  creation order) and emit a short paste-ready prompt that points a fresh session at
  it. Self-sufficient by design — objective, repository state, decisions and their
  rationale, relevant files, next steps, and open questions — so the next session
  resumes with no loss of context. A bare core command with all three doors; adds the
  `.marvin/handoff/` working-dir subdir (ADR-0007). Prompt count 39 → 40.

## [2.0.0-alpha.26] — 2026-06-28

Unify the pull-request commands into one `pr-*` lifecycle family.

### Added

- **`/marvin:pr-merge`** — merge a PR (`gh pr merge --delete-branch`, repo's default
  method), then check out the PR's base branch and pull, leaving the working copy
  clean on an up-to-date base. Confirms before merging.

### Changed

- **`pr-*` is now the full PR lifecycle** ([ADR-0023](../../docs/adr/0023-pr-command-family.md)):
  `pr-create` (open) · `pr-review` (review) · `pr-resolve` (resolve) · `pr-merge` (merge).
- **`/marvin:pr-review` now reviews on GitHub** — fetches the PR diff, reviews it, and
  submits a GitHub review (summary + inline comments by severity) instead of printing a
  local, chat-only review. For a local read-only pre-commit review use `/code-review` or
  the `marvin-auditor` agent. `disable-model-invocation` is removed so "review the PR"
  triggers it.

### Removed / renamed

- **`/marvin:task-fix-pr` → `/marvin:pr-resolve`** (BREAKING) — the review-feedback
  command moves out of the `task-*` pipeline into the `pr-*` family. Beyond the rename it
  now fetches only the **unresolved** review threads (GraphQL `reviewThreads.isResolved`),
  drafts a change plan first, and after pushing fixes **replies to each thread and resolves
  it** (`resolveReviewThread`) — spec-conflicts stay open. The autonomous twin
  `marvin-tm-review-fixer` is updated in lock-step.

## [2.0.0-alpha.25] — 2026-06-22

Spec files now sort by creation order.

### Changed

- **Numeric-prefixed spec filenames** ([ADR-0022](../../docs/adr/0022-numbered-spec-files.md)) —
  `/marvin:task-start` now writes specs as `<NNN>-<slug>.md` (zero-padded sequence = highest
  existing prefix in the spec dir + 1), so `.marvin/task/` lists in creation order instead of
  alphabetically by topic. The number is filename-only: `slug` stays the spec's identity and the
  `contract_sha` seal is unaffected.
- **Prefix-tolerant slug resolution** — the `spec` tool's `depends_on` gate (new
  `resolveSpecBySlug` helper) and the `task-implement` / `task-deliver` / `task-verify` skills now
  resolve a slug to either `<slug>.md` (legacy, unnumbered) or `<NNN>-<slug>.md`, so existing
  un-numbered specs keep working with no migration.

## [2.0.0-alpha.24] — 2026-06-22

Enforce the read-only / read-mostly agent contracts that were previously prose-only (honor-system).

### Security

- **Agent `tools:` allowlists** — six agents now declare a `tools:` frontmatter allowlist so Claude
  Code enforces their constrained access instead of granting the full default toolset (a subagent that
  omits `tools:` silently inherits *every* tool, so the prior "read-only" contracts were honor-system
  only):
  - `marvin-guide`, `marvin-tm-writer` → `Read, Glob, Grep`
  - `marvin-auditor`, `marvin-tm-spec-critic`, `marvin-tm-diff-critic` → `Read, Glob, Grep, Bash`
    (read-only `git`)
  - `marvin-debugger` (read-mostly) → `Read, Glob, Grep, Bash, Write, mcp__plugin_marvin_marvin__lessons`
    (may write a throwaway reproducer and record a lesson)

  Execution agents (`marvin-tm-executor`, `marvin-tm-review-fixer`) and `marvin-researcher`
  intentionally omit `tools:` and keep the full toolset.

### Fixed

- **Bogus `LS` tool reference** — `marvin-auditor`, `marvin-guide`, `marvin-tm-writer`, and
  `marvin-tm-spec-critic` advertised a non-existent `LS` tool in their Capabilities prose (`Glob`
  superseded `LS`); corrected the prose and omitted it from the allowlists.
- **`marvin-tm-spec-critic` capability drift** — its prose claimed read-only `Read, Glob, Grep` but
  Step 2 runs `git log`; `Bash` added to both the stated contract and the allowlist.

## [2.0.0-alpha.23] — 2026-06-22

Bugfix block + a lessons-learned feedback loop (see
[ADR-0020](../../docs/adr/0020-debugger-agent.md),
[ADR-0021](../../docs/adr/0021-lessons-feedback-loop.md)).

### Added

- **`marvin-debugger` agent** — hypothesis-driven root-cause analysis as a fresh-context,
  read-mostly agent, now the single source of the debugging methodology. Invoked from `task-start`
  Step 3B, the `/marvin:debug` skill (now a thin door), and as the executor's fallback when a fix
  stalls. Prescribes a minimal fix + regression test; never applies it.
- **`lessons` MCP tool + `.marvin/memory/` store** — a tool-backed, git-committed, team-shared
  lessons-learned memory. `action: "add"` captures a typed lesson (`bug-pattern` / `gotcha` /
  `convention` / `pitfall` / `process`); `action: "search"` recalls relevant ones. Written by
  `marvin-debugger` (on reflect) and `task-deliver` (retrospective), read by `task-start` at
  intake — the pipeline's first backward feedback channel.

### Changed

- **`/marvin:debug` and `task-start` Step 3B** dispatch `marvin-debugger` instead of carrying two
  duplicated copies of the root-cause methodology (which would have drifted).
- **`task-deliver`** gains a retrospective step that captures a lesson after a successful ship.
- **`task-start` Step 1.3** recalls prior lessons at intake so past mistakes inform new specs.

### Removed

- **The inert `memory: project` field** from all agents — it declared a per-agent native-memory
  capability nothing curated; the shared `.marvin/memory/` store is the single memory layer now.

### Fixed

- **Server `VERSION` const** was left at `alpha.21` by the `alpha.22` agent-rename release while
  the manifests moved to `alpha.22`; realigned here (all now `alpha.23`).

## [2.0.0-alpha.22] — 2026-06-22

Agent naming convention — every agent now carries the `marvin-` prefix plus a
single role-profession, so names cannot collide with agents from other plugins.

### Changed

- **The three unprefixed agents are renamed:** `research` → `marvin-researcher`,
  `onboarding-guide` → `marvin-guide`, `security-reviewer` → `marvin-auditor`. The
  five `marvin-tm-*` agents already satisfied the convention and are unchanged. This
  renames the agent invocation identifier — anything that referenced the old names
  (e.g. `subagent_type: "research"`) must use the new name. Cross-references in the
  agents, README, and ADR-0006/0016 were updated in lock-step.

## [2.0.0-alpha.21] — 2026-06-16

Tool-backed delivery gate (see
[ADR-0012](../../docs/adr/0012-tool-backed-delivery-gate.md)).

### Added

- **The `verify` tool gains `action: "gate"` — a deterministic delivery gate.** It reads
  `.marvin/task/verification.md`, parses the machine-readable `verify-result` verdict, and returns a
  `deliver-gate` decision: ALLOW (PASS / PASS WITH WARNINGS) or BLOCK (FAIL, missing file, or
  unparseable verdict). Because the same tool writes and reads the `verify-result` format, the
  delivery decision cannot drift from what verify recorded.

### Changed

- **`task-deliver` no longer reads the verdict in prose.** Its verification check (Step 1) now calls
  `verify` with `action: "gate"` instead of "look for the verdict… if FAIL stop" — an eyeballing step
  the model could get wrong on the pipeline's last gate. With seal (alpha.19) and scope (alpha.20),
  this completes moving the three implementation-time prose checks to deterministic tools.

## [2.0.0-alpha.20] — 2026-06-16

Tool-backed scope-allowlist gate (see
[ADR-0011](../../docs/adr/0011-tool-backed-scope-gate.md)).

### Added

- **The `spec` tool gains `mode: "scope"` — a deterministic scope-creep gate.** It compares the
  working-tree diff (`git diff --name-only`, default base HEAD, plus untracked) against the
  spec-contract `files` allowlist and FAILs listing any changed file outside it. marvin's own
  `.marvin/` artifacts and the spec file are excluded; intentional out-of-allowlist files are passed
  in `allow: [...]` as recorded SPEC GAPs — fail-closed with an explicit, auditable override. Outside
  a git repo it returns PASS WITH WARNINGS.

### Changed

- **`task-implement` (Step 6F) and `marvin-tm-executor` (§3) run the scope gate before the merge
  point.** The mechanical "is every changed file in the allowlist?" check is now tool-backed;
  `marvin-tm-diff-critic` keeps the _semantic_ half (is an in-allowlist change doing something out of
  scope?). The prose "modify only the files in the allowlist" instruction is now enforced, not merely
  stated.

## [2.0.0-alpha.19] — 2026-06-16

Tool-backed contract-seal verification (see
[ADR-0010](../../docs/adr/0010-tool-backed-contract-seal.md)).

### Added

- **The `spec` tool gains `mode: "seal"` — a deterministic contract-immutability check.** It
  recomputes the spec-contract hash and compares it to the stamped `contract_sha`, returning PASS
  (intact) / FAIL (`TAMPERED`) / PASS WITH WARNINGS (unsealed) / FAIL (no block), reusing the exact
  `contractHash` the DoR gate stamps so seal and stamp cannot drift.

### Changed

- **`task-implement` no longer asks the model to compute SHA-256.** Its immutability check (Step 2)
  now calls `spec` with `mode: "seal"` instead of the prose "re-hash the block and compare" — an
  operation an LLM cannot perform reliably. The seal becomes a real tamper gate rather than
  "determinism by name"; `task-start`'s description of the check is updated to match.

## [2.0.0-alpha.18] — 2026-06-16

Built-in stack detection broadened to the top ~10 ecosystems.

### Added

- **`verify` now recognises 11 stacks out of the box, up from 5.** Added canonical gate sets for
  **C#/.NET** (`*.sln` / `*.csproj` / `*.fsproj` or `global.json` → `dotnet test` / `build` /
  `format`), **JVM via Gradle** (`build.gradle[.kts]` → `./gradlew test` / `build`), **Swift**
  (`Package.swift` → `swift test` / `build`), **Ruby** (`Gemfile` → `bundle exec rspec` / `rubocop`),
  **PHP** (`composer.json` → `composer test`), and **C/C++ via CMake** (`CMakeLists.txt` → a
  self-contained `cmake` build), alongside the existing Go, Rust, Python, TypeScript, and
  Java/Maven. Python detection now also picks up `setup.py` / `setup.cfg`. Canonical commands are
  best-effort defaults — override any of them per gate via `.marvin/config.json`
  ([ADR-0009](../../docs/adr/0009-config-first-gate-resolution.md)); a genuinely unrecognised stack
  still falls back to declared npm / Makefile commands, then the honest "no gates detected" message.

### Changed

- **Stack detection moved from exact-filename matching to per-stack predicates.** This lets globbed
  markers (`*.csproj`) and alternative manifests (`build.gradle.kts`, `setup.cfg`) be recognised. The
  `stack` hint argument now names a stack **id** (`go`, `dotnet`, …) rather than a marker filename; an
  unrecognised hint is ignored and normal detection runs. The headless `marvin-tm-executor`
  inline-Bash fallback (used only when the `verify` tool is unavailable) mirrors the same 11 stacks
  and honours `.marvin/config.json` `gates`.

## [2.0.0-alpha.17] — 2026-06-16

Config-first gate resolution for `verify` (see
[ADR-0009](../../docs/adr/0009-config-first-gate-resolution.md)).

### Added

- **`gates` in `.marvin/config.json` — durable, per-project quality-gate commands.** `verify` now
  resolves its gate plan **config-first**: an explicit per-call `gates` argument still wins, then any
  `gates` declared in `.marvin/config.json` (e.g. `"gates": { "test": "vitest run", "lint": "biome
  check ." }`) override the detected commands **per gate**, then stack auto-detection (`STACK_TABLE`
  → declared-command fallback) fills the rest. This closes the toolchain-coupling gap left by
  [ADR-0005](../../docs/adr/0005-portable-spec-contract.md)'s open stack detection: a project on a
  non-canonical toolchain (Python `tox`/`uv`, TypeScript `vitest`/`bun`, Rust `cargo nextest`, …) can
  pin exactly how it is built **once**, instead of re-passing `gates` on every call. The report's
  `Stacks:` line appends `.marvin/config.json` when an override applies; a malformed config warns and
  falls back to detection. Backwards-compatible — no `gates` key means byte-identical behaviour
  (parity test added).

## [2.0.0-alpha.16] — 2026-06-14

General door-3 fix: the MCP door now resolves plugin-relative resource paths.

### Fixed

- **The MCP door (`/marvin:*`) now resolves `skills/...` paths referenced in skill prose.** When a
  skill tells the model to read a plugin resource by a plugin-relative path (e.g. `sec-compliance`
  → `skills/sec-compliance/asvs-4.0-checklist.md`), the server prepends the absolute plugin root to
  the returned prompt body so the path resolves regardless of the model's working directory.
  Previously such a read silently failed through the MCP door (the body is returned verbatim while
  the cwd is the user's project) and the model improvised from memory. This is the general fix for
  the bare-path bug class — the safety net behind the per-resource patterns: invoke sibling skills by
  command (`sec-scan`, alpha.14) and inline a skill's own scaffolding (`task-start` templates,
  alpha.15). See [ADR-0008](../../docs/adr/0008-mcp-door-resource-resolution.md).

### Changed

- Server `serverInfo.version` and `mcp/server/package.json` resynced to the plugin version (were
  lagging at alpha.11 / alpha.12 across the preceding prose-only releases).

## [2.0.0-alpha.15] — 2026-06-14

Door-robust spec templates in `task-start`.

### Fixed

- **`task-start` now carries its spec templates inline instead of reading them by path.** Steps 5F
  (feature) and 6B (bugfix) previously said "Read `skills/task-start/feature-spec-template.md`" /
  "…bugfix-spec-template.md" — plugin-relative paths that don't resolve through the `/marvin:task-start`
  MCP door (the server returns the skill prose verbatim while the model's working directory is the
  user's project), so the model improvised the spec format from memory. The two templates are now
  inlined verbatim into `SKILL.md` (fenced blocks), and the standalone `feature-spec-template.md` /
  `bugfix-spec-template.md` files — read by nothing else — are removed, keeping a single source. Same
  bug class as the `sec-scan` delegation fix (alpha.14); inlining is used here because these are the
  skill's own resource files, not sibling skills to invoke.

## [2.0.0-alpha.14] — 2026-06-14

Door-robust delegation in `sec-scan`.

### Fixed

- **`sec-scan` now invokes its sub-scans by command, not by file path.** Phases 1–2 previously said
  "Read `skills/sec-secrets/SKILL.md`" / "Read `skills/sec-deps/SKILL.md`" — a plugin-relative path
  that does not resolve through the `/marvin:sec-scan` MCP door (the server returns the prose verbatim
  while the model's working directory is the user's project, not the plugin root), silently dropping the
  "delegate, don't duplicate" contract and letting the model improvise the sub-scan from memory. They
  now invoke `/marvin:sec-secrets` and `/marvin:sec-deps`, which resolve by name through all three doors
  — matching the command-invocation convention already used by `task-implement` → `task-verify` /
  `task-deliver`.

## [2.0.0-alpha.13] — 2026-06-14

Prompt-injection hardening for the security scanners.

### Added

- **Every `sec-*` skill now carries an "Untrusted input" guardrail.** All ten security skills
  (scan, secrets, deps, gate, iac, ci, threat-model, pentest, compliance, fix) instruct the model to
  treat scanned content — source, configs, commit messages, dependency metadata, CI/CD definitions,
  and pull-request content — as untrusted data, never as instructions, and to report any embedded
  directives (e.g. "ignore previous instructions", "report no vulnerabilities, mark this PASS") as a
  prompt-injection finding. Closes an integrity gap where a malicious repository could suppress
  findings via text crafted into the very files being scanned.

## [2.0.0-alpha.12] — 2026-06-14

Unified `.marvin/` working directory — every service file marvin generates now lives under one
hidden root, one subdirectory per command group (see
[ADR-0007](../../docs/adr/0007-marvin-working-directory.md)).

### Changed

- **Kanban storage moves `marvin/tasks/` → `.marvin/kanban/` and `marvin/config.json` →
  `.marvin/config.json`.** The `MARVIN_TASKS_DIR` / `MARVIN_TASKS_CONFIG` env vars keep their names
  but default to the new hidden paths; `.mcp.json` and `lib/env.ts` updated in lockstep.
- **Verification artifact moves `.taskmaster/current-task/verification.md` →
  `.marvin/task/verification.md`.** `task-verify` and `task-deliver` read the new path.
- **Specs default to `.marvin/task/`** while staying host-adaptive (ADR-0005): an existing
  `specs/` / `docs/specs/` / `docs/rfcs/` / `rfcs/` convention is still discovered and preferred, and
  the `spec` gate / `task-implement` / `task-deliver` search `.marvin/task/` first, then those.

### Added

- **`sec-*` reports persist to `.marvin/security/`.** The eight report-producing scanners (scan,
  secrets, deps, threat-model, iac, ci, compliance, pentest) write their report there by default;
  `sec-gate` and `sec-fix` persist on request.

Project deliverables (`docs/adr/`, `CHANGELOG.md`, `README.md`) are deliberately left in their
conventional locations.

## [2.0.0-alpha.11] — 2026-06-14

All subagents run on Opus (see [ADR-0006](../../docs/adr/0006-all-subagents-opus.md)).

### Changed

- **`marvin-tm-spec-critic` and `marvin-tm-diff-critic` move `sonnet` → `opus`.** Every subagent
  now runs on the top tier, and new agents default to opus. Token economy comes from the
  deterministic MCP tools (`spec`, `verify`, `task`/`git`) carrying the load-bearing work so the
  model does *less* — not from running the model at a *lower tier*. The free `spec` gate still runs
  before the now-opus critic, so the critic is spent only on shape-valid specs.

## [2.0.0-alpha.10] — 2026-06-14

Coverage, archetype router, and an enforceable immutability seal — M4 (final) of
[ADR-0005](../../docs/adr/0005-portable-spec-contract.md).

### Added

- **`contract_sha` immutability seal.** The `spec` tool emits a SHA-256 fingerprint of the
  spec-contract block; `task-start` re-gates the **written** file (not just the inline draft) and
  stamps `contract_sha` into the frontmatter, and `task-implement` re-hashes the block on read and
  refuses a spec whose contract was edited after sealing. The immutability rule is now enforced, not
  merely conventional.
- **Archetype router** in `task-start` intake — API / data-migration / CLI / library / UI / infra /
  AI, each with 2–3 must-pin questions on top of the general sweep, so questioning deepens by task
  shape instead of running one flat checklist.
- **Coverage dimensions** added to the intake sweep: concurrency/idempotency, external-dependency
  failure/timeout, test-environment availability, cost/quota, and new-dependency licence.

This completes ADR-0005 (M1–M4): the spec contract is portable (host-discovered, open-stack,
location-aware), fail-closed (a schema-validated YAML block with mechanical traceability + sibling
gate), and sealed (a tamper-evident hash binds the written artifact to a passing gate).

## [2.0.0-alpha.9] — 2026-06-14

Host bindings + mechanical sibling-dependency gate — M3 of
[ADR-0005](../../docs/adr/0005-portable-spec-contract.md).

### Added

- **`depends_on` is now mechanically enforced.** The spec-contract block gains an optional
  `depends_on` list of sibling slugs; the gate resolves each (via the host's `spec_location`, then
  conventional dirs) and **FAILS** unless the dependency exists and is `status: shipped` — closing
  the gap where the prose claimed the gate forbade incomplete-sibling dependencies but nothing
  checked it (`depends-on`).
- **`host-bindings` block (Contract B).** An optional ` ```yaml host-bindings ` block records what
  the spec discovers about the host — `spec_location`, `decision_record` (ADR/RFC convention),
  `merge_obligations`, `gates` — so the artifact conforms to the host instead of importing marvin's
  layout. Advisory: a malformed block warns, never blocks (`host-bindings`).

### Changed

- `task-start` intake discovers host conventions (ADR/RFC dir + style, `CONTRIBUTING`, PR template,
  pre-commit) and populates the host-bindings block; crystallization emits it.
- `task-implement` and `task-deliver` resolve a spec across the spec directories (`specs/`,
  `docs/specs/`, `docs/rfcs/`, `rfcs/`), not just `specs/` — the location-aware tail of M1's
  discoverable output location.

## [2.0.0-alpha.8] — 2026-06-14

The spec contract is now an authoritative, schema-validated YAML block — M2 of
[ADR-0005](../../docs/adr/0005-portable-spec-contract.md). **Breaking spec-format change.**

### Changed

- **`spec-contract` YAML block replaces the markdown tables.** The File Change Plan, Acceptance
  Criteria, and Interface/Contract sections move into one ` ```yaml spec-contract ` block (`files`,
  `criteria`, `build_order`, `contract`) parsed by `yaml` and validated by a `zod` schema. The gate
  now **fails closed**: a missing field, a dangling `implemented_by` / `satisfies` reference, an
  unfilled `{…}` placeholder (which parses as a YAML map), an empty contract `signature`, an
  all-`prose-review` proof set, or a bugfix with no `regression: true` criterion is a typed FAIL —
  none can be silently downgraded the way a renamed table column could.
- **`oracle` replaces `verified_by`.** Each criterion carries a typed `oracle` (`kind: test |
  command | prose-review` + `ref`); a `kind: test` ref must be an allowlisted `files` path.
- **Hard cutover.** Legacy single-table specs now FAIL with a migrate message. The format consumers
  (`task-implement`, `marvin-tm-executor`, `marvin-tm-spec-critic`, `marvin-tm-diff-critic`) read the
  block; the templates and `task-start` crystallization emit it.
- **`frontmatter.ts` consolidated onto the `yaml` library** (failsafe schema — strings stay strings),
  replacing the hand-rolled parser; a round-trip test guards kanban task files.

### Added

- Runtime dependency `yaml`, bundled into `dist` (with a `createRequire` banner for the ESM/CJS
  require shim). New tests: spec-contract schema + traceability, malformed YAML, placeholder-as-map,
  empty signature, bugfix regression, and a kanban frontmatter round-trip.

## [2.0.0-alpha.7] — 2026-06-14

Portable spec output location and host-neutral Definition of Done — completes M1 of
[ADR-0005](../../docs/adr/0005-portable-spec-contract.md).

### Changed

- **`task-start` writes where the host keeps specs.** The finalize step detects an existing
  convention (`specs/`, `docs/specs/`, `docs/rfcs/`, `rfcs/`, or a `CONTRIBUTING`-named directory)
  and proposes it, defaulting to `specs/` only when none exists — the spec follows the host's
  layout, not marvin's. (Consumers still resolve `specs/` by default; made location-aware in M2.)
- **Definition-of-Done templates are host-neutral.** The examples no longer assume marvin's own
  obligations ("version bump + dist rebuild"); they point at whatever the host's `CONTRIBUTING` / CI
  requires, with the marvin-specific examples generalised to "a version bump, a committed build
  artefact, a generated file — or none".

## [2.0.0-alpha.6] — 2026-06-14

Open stack detection for `/marvin:task-verify` and the spec authoring flow — M1 of
[ADR-0005](../../docs/adr/0005-portable-spec-contract.md).

### Added

- **Declared-command fallback in the `verify` tool.** When no tabled stack (Go/Python/TypeScript/
  Rust/Java) is present, `verify` now builds its gate set from the commands the project declares
  itself — `package.json` scripts, then `Makefile` targets — instead of leaving an untabled
  ecosystem (PHP, Ruby, .NET, Elixir, Swift, Dart, …) silently unverified. A project that declares
  nothing returns an explicit "no gates detected" message naming what to pass, never a silent pass.

### Changed

- `task-start` intake detects the dependency manifest by what the host actually has (not a fixed
  five), and when discovering the test harness it prefers the command the project **declares** (CI
  job, `Makefile` target, manifest script) over a guessed ecosystem default — asking the user about
  an unrecognised stack rather than guessing a `test_command` that would poison every gate.
- `task-verify` documents the fallback; its description reflects the wider coverage.

## [2.0.0-alpha.5] — 2026-06-14

`spec` DoR gate hardened to **fail closed** — Phase 1 of the portable spec contract
(see [ADR-0005](../../docs/adr/0005-portable-spec-contract.md)).

### Changed

- **Traceability is now mandatory, not additive.** A spec whose File Change Plan lacks an `ID`
  column, or whose Acceptance Criteria lack an `Implemented by` column, now **FAILS** the gate
  (`traceability`) instead of passing with a warning. A renamed or omitted linking column can no
  longer silently disable the AC ⇄ files ⇄ tests graph — the strongest guarantee in the gate. This
  matters most in a headless run inside a foreign repo, where the semantic critic is unavailable and
  the mechanical gate is the only arbiter.
- **`breaking` is now required on features.** Omitting the `breaking` frontmatter flag now **FAILS**
  the gate (`fm-breaking`) instead of warning — public-surface impact must be a conscious call, not
  an omission.

### Fixed

- Server `serverInfo.version` drift: `src/server.ts` reported `2.0.0-alpha.3` while the package was
  `alpha.4`; both now track the plugin version.

## [2.0.0-alpha.4] — 2026-06-14

Traceable spec contract and gate reordering for `/marvin:task-start`
(see [ADR-0004](../../docs/adr/0004-traceable-spec-contract.md)).

### Added

- **Traceability triple** in the `spec` DoR tool: the File Change Plan gains `ID` + `Satisfies`
  columns and Acceptance Criteria gain `Implemented by`, and the tool now verifies the closed
  graph — every criterion maps to real plan IDs, every `Satisfies` points at a real criterion,
  every `verified_by` test is an allowlisted plan row, and ≥1 criterion carries a non-`prose-review`
  proof (`ac-traceability`, `fcp-traceability`, `ac-test-in-plan`, `ac-verified-real`).
- New required **Definition of Done** section (feature + bugfix templates and the tool).
- Frontmatter `breaking` (feature, warns if omitted) and `spike_required` (the tool **fails** on
  `spike_required: true` — an off-ramp so unknowns are spiked, not laundered into Assumptions).
- Interface/Contract as a literal code block — the tool warns on a prose contract (`contract-code`).
- File-Change-Plan size warning (`fcp-size`) for sprawling plans.
- Intake sweep dimensions: callers / reverse-deps, backward-compat / public surface, merge
  obligations; the feature flow now reads caller graphs, recent churn, and neighboring tests.

### Changed

- **Gate order reversed.** `task-start` runs the mechanical `spec` tool **first** (Step 7), then
  the semantic `marvin-tm-spec-critic` only on shape-valid specs (Step 8), then finalize/write
  (Step 9). A skipped critic is recorded and surfaced in the PR, never silent.
- `task-implement` and `marvin-tm-executor` use the traceability graph as their work list.
- `stack` frontmatter may be comma-separated for polyglot tasks.

## [2.0.0-alpha.1] — 2026-06-06

**Breaking:** consolidated the four packs (`marvin-core-pack`, `marvin-security-pack`,
`marvin-taskmaster-pack`, `marvin-tasks-pack`) into a **single plugin** `marvin` with one
MCP server under one slash prefix `/marvin:` (see
[ADR-0001](../../docs/adr/0001-single-plugin-consolidation.md), which supersedes the prior
four-pack, per-pack-server design).

### Changed

- Single server key `marvin`; every command is now `/marvin:<group>-<command>`. All previous
  `/marvin-core:*`, `/marvin-sec:*`, `/marvin-tm:*`, `/marvin-tasks:*` commands are renamed.
- Naming scheme: core stays bare (`commit`, `debug`, …) plus the `pr-*` pair; security → `sec-*`;
  taskmaster pipeline → `task-*` (`run` → `task-implement`); kanban tracker → `kanban-*` (every
  prompt prefixed, including `kanban-menu`). `explaining-code` → `explain`.
- Skill directories and frontmatter `name:` renamed to match the unified command names.
- The kanban tool server (`task`/`git`/`help` + `storage`/`flows`/`lib`) now lives inside the
  single server and is registered alongside the 38 prompts.

### Removed

- The deprecated `security-scan` alias (skill + command + prompt).
- Per-pack plugins/servers — the toolkit no longer installs à la carte.

## [1.0.0-alpha.1] — 2026-05-20

**Breaking:** migration to MCP-first architecture — hybrid model with skills as source of truth. (The MCP-first ADR was retired in the v2 publication cut; its still-relevant rationale lives in [ADR-0013](../../docs/adr/0013-self-contained-server-bundle.md) and [ADR-0018](../../docs/adr/0018-three-doors-instrument-taxonomy.md).)

### Added

- MCP server `marvin-core` (bundled to `mcp/server/dist/server.js`) exposing 10 prompts under `/marvin-core:*`.

### Changed

- MCP prompts exposed as `/marvin-core:<name>` (new slash entry, 10 prompts).
- `SKILL.md` files now serve **three doors**: Claude Code auto-discovery, the short `/mn.<name>` markdown command, and the MCP prompt (frontmatter stripped at request time).

### Removed

- `mn.eject` skill and command, and the entire scaffold/eject mechanism (the `marvin` CLI is gone).

### Kept

- All 10 skills in `skills/<name>/SKILL.md` (`mn.commit`, `mn.pr`, `mn.review`, `mn.debug`, `mn.adr`, `mn.changelog`, `mn.readme`, `mn.migration-plan`, `mn.explaining-code`, `mn.docs-search`).
- All 10 `/mn.*` markdown slash commands under `commands/` — short aliases that delegate to the same SKILL.md.
- Agents (`marvin-guide`, `marvin-researcher`) — unchanged.
- External MCP servers (`context7`, `gitmcp`) — registered alongside `marvin-core`.
