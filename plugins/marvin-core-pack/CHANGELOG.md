# Changelog

All notable changes to **marvin-core-pack** are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the pack
follows semver independently of the surrounding marketplace.

## [1.0.0-alpha.1] — 2026-05-20

**Breaking:** migration to MCP-first architecture (see [ADR-0002](../../docs/adr/0002-mcp-first-architecture.md)) — hybrid model with skills as source of truth.

### Added

- MCP server `marvin-core` (bundled to `mcp/server/dist/server.js`) exposing 10 prompts under `/marvin-core:*`.

### Changed

- Slash commands renamed from `/mn.<name>` to `/marvin-core:<name>` (10 commands).
- `commands/` directory removed — slash UX now comes from MCP server prompts.
- `SKILL.md` files now serve **two doors**: Claude Code auto-discovery (as before) **and** MCP prompt body (read at request time, frontmatter stripped).

### Removed

- `mn.eject` skill and the entire scaffold/eject mechanism (the `marvin` CLI is gone).

### Kept

- All 10 skills (`mn.commit`, `mn.pr`, `mn.review`, `mn.debug`, `mn.adr`, `mn.changelog`, `mn.readme`, `mn.migration-plan`, `mn.explaining-code`, `mn.docs-search`) in `skills/<name>/SKILL.md` — Claude Code still auto-discovers them via frontmatter.
- Agents (`onboarding-guide`, `research`) — unchanged.
- External MCP servers (`context7`, `gitmcp`) — registered alongside `marvin-core`.
