# Changelog

All notable changes to **marvin-security-pack** are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the pack
follows semver independently of the surrounding marketplace.

## [1.0.0-alpha.1] — 2026-05-20

**Breaking:** migration to MCP-first architecture (see [ADR-0002](../../docs/adr/0002-mcp-first-architecture.md)) — hybrid model with skills as source of truth.

### Added

- MCP server `marvin-sec` exposing 11 prompts under `/marvin-sec:*` (10 primary + the deprecated `security-scan` alias).

### Changed

- Slash commands renamed from `/mn.sec.<name>` to `/marvin-sec:<name>` (10 commands).
- Deprecated alias `mn.security-scan` rewired to `/marvin-sec:security-scan` (kept for backward compatibility, scheduled for removal in 2.0).
- `commands/` directory removed — slash UX now comes from MCP server prompts.
- `SKILL.md` files now serve both Claude Code auto-discovery and MCP prompt resolution.

### Kept

- All 11 skills in `skills/<name>/SKILL.md` (including `mn.security-scan` deprecated alias).
- Agent `security-reviewer` — unchanged.
