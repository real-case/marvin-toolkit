# Changelog

All notable changes to **marvin-taskmaster-pack** are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the pack
follows semver independently of the surrounding marketplace.

## [1.0.0-alpha.1] — 2026-05-20

**Breaking:** migration to MCP-first architecture (see [ADR-0002](../../docs/adr/0002-mcp-first-architecture.md)) — hybrid model with skills as source of truth.

### Added

- MCP server `marvin-tm` exposing 5 prompts under `/marvin-tm:*`.

### Changed

- Slash commands renamed from `/mn.taskmaster-<name>` to `/marvin-tm:<name>` (5 commands).
- `commands/` directory removed — slash UX now comes from MCP server prompts.
- `SKILL.md` files now serve both Claude Code auto-discovery and MCP prompt resolution.
- Cross-pack references in skill bodies updated (`/mn.commit` → `/marvin-core:commit`, etc).
- `marvin-tm-executor` frontmatter updated to reference future batch-dispatch tooling instead of the removed shell script.

### Removed

- `scripts/dispatch.sh` — batch dispatch is deferred to a future feature designed against the MCP boundary.

### Kept

- All 5 skills (`mn.start`, `mn.run`, `mn.verify`, `mn.deliver`, `mn.fix-pr`) in `skills/<name>/SKILL.md`.
- All 5 agents (`marvin-tm-writer`, `marvin-tm-executor`, `marvin-tm-spec-critic`, `marvin-tm-diff-critic`, `marvin-tm-review-fixer`) — unchanged.
