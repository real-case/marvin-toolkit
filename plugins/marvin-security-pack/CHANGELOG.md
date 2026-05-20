# Changelog

All notable changes to **marvin-security-pack** are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the pack
follows semver independently of the surrounding marketplace.

## [1.0.0-alpha.1] — 2026-05-20

**Breaking:** migration to MCP-first architecture (see [ADR-0002](../../docs/adr/0002-mcp-first-architecture.md)) — hybrid model with skills as source of truth.

### Added

- MCP server `marvin-sec` exposing 11 prompts under `/marvin-sec:*` (10 primary + the deprecated `security-scan` alias).

### Changed

- MCP prompts exposed as `/marvin-sec:<name>` (new slash entry, 11 prompts including `security-scan` deprecated alias).
- `SKILL.md` files now serve **three doors**: Claude Code auto-discovery, the short `/mn.sec.<name>` (or `/mn.security-scan`) markdown command, and the MCP prompt.

### Kept

- All 11 skills in `skills/<name>/SKILL.md`, including `mn.security-scan` deprecated alias.
- All 11 `/mn.sec.*` and `/mn.security-scan` markdown slash commands under `commands/`.
- Agent `security-reviewer` — unchanged.
