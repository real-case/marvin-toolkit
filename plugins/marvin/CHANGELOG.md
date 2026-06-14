# Changelog

All notable changes to the **marvin** plugin are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the plugin
follows semver independently of the surrounding marketplace.

## [2.0.0-alpha.5] — 2026-06-14

`spec` DoR gate hardened to **fail closed** — Phase 1 of the portable spec contract
(see [ADR-0007](../../docs/adr/0007-portable-spec-contract.md)).

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
(see [ADR-0006](../../docs/adr/0006-traceable-spec-contract.md)).

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
[ADR-0003](../../docs/adr/0003-single-plugin-consolidation.md), which supersedes ADR-0002).

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

**Breaking:** migration to MCP-first architecture (see [ADR-0002](../../docs/adr/0002-mcp-first-architecture.md)) — hybrid model with skills as source of truth.

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
- Agents (`onboarding-guide`, `research`) — unchanged.
- External MCP servers (`context7`, `gitmcp`) — registered alongside `marvin-core`.
