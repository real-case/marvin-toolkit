# Changelog

All notable changes to the **marvin** plugin are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the plugin
follows semver independently of the surrounding marketplace.

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
