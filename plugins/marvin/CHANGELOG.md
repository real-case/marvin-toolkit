# Changelog

All notable changes to the **marvin** plugin are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the plugin
follows semver independently of the surrounding marketplace.

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
