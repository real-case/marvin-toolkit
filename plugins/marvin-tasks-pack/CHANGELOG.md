# Changelog

All notable changes to **marvin-tasks-pack** are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the pack
follows semver independently of the surrounding marketplace.

## [1.0.0-alpha.1] — 2026-05-19

Initial release. MCP-first pack with one MCP server (`marvin-tasks`).

### Added

- 13 slash prompts under the `/marvin-tasks:*` prefix:
  `menu`, `bug`, `feature`, `chore`, `spike`, `start`, `review`, `done`,
  `list`, `status`, `help`, `commit`, `create-pr`.
- 3 MCP tools wired to the prompts: `task`, `git`, `help`.
- File-based task storage under `marvin/tasks/<seq>[-<tracker>]--<slug>.md`,
  zod-validated frontmatter, monotonic sequential IDs.
- Optional `marvin/config.json` (`base_branch`, `tracker_url_template`).
- Git-aware lifecycle: branch off the base, commit with task `Refs:` line,
  open PR via `gh` (with copy-paste fallback when `gh` is missing).
- Graceful degradation outside a git repo (list/status still work).
- Smoke-tested MCP server (`initialize` → `serverInfo`).
