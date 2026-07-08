# Changelog — marvin-toolkit

Marketplace- and repository-level changes: CI, tooling, governance, and docs. The
**marvin** plugin keeps its own product changelog at
[`plugins/marvin/CHANGELOG.md`](./plugins/marvin/CHANGELOG.md); this file tracks the
surrounding monorepo. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the top-level
`metadata.version` in `.claude-plugin/marketplace.json` is bumped when the
marketplace manifest schema or plugin list changes.

## [0.1.0] — 2026-07-08

Initial release of the single-plugin marketplace (ADR-0001): one `marvin` plugin, one
MCP server, one `/marvin:` prefix. See
[`plugins/marvin/CHANGELOG.md`](./plugins/marvin/CHANGELOG.md) for the plugin's own
release notes.

### Added

- Community health files: `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), GitHub issue
  forms (bug / feature), and a pull-request template.
- `.github/dependabot.yml` — weekly npm and GitHub Actions update checks.
- Documentation home under [`docs/`](./docs/): the architecture tour
  (`docs/architecture.md`, Mermaid diagrams of the three doors, the task pipeline, and
  the `.marvin/` layout), the docs index, a getting-started guide, a usage guide, a
  configuration reference, the full command reference, and a plugin-level
  `plugins/marvin/README.md`.
- Engineering automation: husky + lint-staged pre-commit hooks, a documentation
  drift-guard (`npm run lint:docs`, cross-checking the ADR list and working-directory
  paths), c8 coverage reporting, a Node 20/22 CI matrix, and a tag-driven GitHub Release
  workflow.

### Security

- Pinned `esbuild` to `0.28.1` via `overrides`, clearing two high-severity build-time
  advisories (GHSA-gv7w-rqvm-qjhr, GHSA-g7r4-m6w7-qqqr) reachable through `tsup`.
  Build-time only — `esbuild` is not part of the shipped `dist/server.js`.
