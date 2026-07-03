# Marvin documentation

The in-repo documentation home. Start here to understand how Marvin is designed,
why the key decisions were made, and where work is heading.

## Start here

- **[Architecture](./architecture.md)** — the visual tour: system overview, the
  "three doors, one room" model, the task pipeline, and the working-directory
  convention, with diagrams.
- **[Contributing](../CONTRIBUTING.md)** — local setup, the quality gates every
  change must pass, and how to submit a PR.
- **[CLAUDE.md](../CLAUDE.md)** — the deep contributor reference and step-by-step
  recipes for adding prompts, tools, and agents.

## Decision history

Decisions with long-lived consequences are recorded as
[Architecture Decision Records](./adr/). The two pre-consolidation ADRs (source-format,
MCP-first) were retired in the v2 publication cut; their still-relevant rationale is folded
into 0001/0013/0018.

| ADR | Decision | Status |
|-----|----------|--------|
| [0001](./adr/0001-single-plugin-consolidation.md) | Single-plugin consolidation under one `/marvin:` prefix | Accepted |
| [0002](./adr/0002-tool-backed-verification.md) | Tool-backed verification gate | Accepted |
| [0003](./adr/0003-tool-backed-dor.md) | Tool-backed Definition-of-Ready gate | Accepted |
| [0004](./adr/0004-traceable-spec-contract.md) | Traceable spec contract and gate reordering | Accepted |
| [0005](./adr/0005-portable-spec-contract.md) | Portable, host-adaptive spec contract | Accepted |
| [0006](./adr/0006-all-subagents-opus.md) | All subagents on Opus; economy via deterministic tools | Accepted |
| [0007](./adr/0007-marvin-working-directory.md) | Unified `.marvin/` working directory | Accepted |
| [0008](./adr/0008-mcp-door-resource-resolution.md) | MCP-door plugin-resource resolution | Accepted |
| [0009](./adr/0009-config-first-gate-resolution.md) | Config-first gate resolution for `verify` | Accepted |
| [0010](./adr/0010-tool-backed-contract-seal.md) | Tool-backed contract-seal verification | Accepted |
| [0011](./adr/0011-tool-backed-scope-gate.md) | Tool-backed scope-allowlist gate | Accepted |
| [0012](./adr/0012-tool-backed-delivery-gate.md) | Tool-backed delivery gate | Accepted |
| [0013](./adr/0013-self-contained-server-bundle.md) | Self-contained committed server bundle | Accepted |
| [0014](./adr/0014-distribution-release-model.md) | Distribution & release model (git tag → GitHub Release; no npm) | Accepted |
| [0015](./adr/0015-verify-shell-trust-boundary.md) | `verify` shell-execution trust boundary | Accepted |
| [0016](./adr/0016-bundled-external-mcp-deps.md) | Bundled external MCP dependencies (context7, gitmcp) | Accepted |
| [0017](./adr/0017-adversarial-critic-gates.md) | Adversarial critic gates in the task pipeline | Accepted |
| [0018](./adr/0018-three-doors-instrument-taxonomy.md) | Three doors & instrument taxonomy | Accepted |
| [0019](./adr/0019-branching-and-pr-flow.md) | Branching model: release `main`, integration `dev`, changes via PRs | Accepted |
| [0020](./adr/0020-debugger-agent.md) | Root-cause analysis as the `marvin-debugger` agent | Accepted |
| [0021](./adr/0021-lessons-feedback-loop.md) | Tool-backed lessons-learned feedback loop | Accepted |
| [0022](./adr/0022-numbered-spec-files.md) | Numeric-prefixed spec filenames (`NNN-<slug>.md`) | Accepted |
| [0023](./adr/0023-pr-command-family.md) | Unified `pr-*` pull-request command family | Accepted |
| [0024](./adr/0024-mcp-apps-widget-architecture.md) | MCP Apps widget layer: data-first staging + shared data contracts | Accepted |
| [0025](./adr/0025-kanban-board-only.md) | Kanban goes board-only; git ops fold into the `commit`/`pr-create` skills | Accepted |
| [0026](./adr/0026-configurable-status-model.md) | Configurable status model: statuses are project data, roles stay closed | Accepted |
| [0027](./adr/0027-tool-backed-adr-lifecycle.md) | Tool-backed ADR lifecycle | Accepted |
| [0028](./adr/0028-lessons-hygiene-and-recall-expansion.md) | Lessons v2: hygiene surface and recall/capture expansion | Accepted |
| [0029](./adr/0029-refactoring-command-family.md) | Refactoring command family: read → plan → apply under hard rails | Accepted |
| [0030](./adr/0030-toolbox-dashboard-and-usage-log.md) | Toolbox dashboard and local usage log | Accepted |

## Work in progress

These capture how the project thinks and plans — kept public as a window into the
process, not finished deliverables.

- [proposals/](./proposals/) — design proposals under discussion.
- [requirements/](./requirements/) — requirements being shaped into specs.

## Reference

- [Command reference](./commands.md) — every `/marvin:` command with a one-line synopsis and a usage example.
- [Publishing & promotion readiness](./publishing.md) — the requirements checklist and the ordered plan for shipping Marvin to the official directory and community marketplaces.
- [Security policy](../SECURITY.md) — supported versions and how to report a vulnerability.
- [Changelog (marketplace)](../CHANGELOG.md) and [changelog (plugin)](../plugins/marvin/CHANGELOG.md).
