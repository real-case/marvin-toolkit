# Marvin documentation

This is the in-repo documentation home. Start here to learn how Marvin is designed, why
the key decisions were made, and where the work is heading.

## Start here

- **[Getting started](./getting-started.md)** teaches you to install the plugin, confirm it works, and run your first commands.
- **[Usage guide](./usage.md)** walks through the common workflows: committing and opening a PR, the task pipeline, the task board, security, and refactoring.
- **[Architecture](./architecture.md)** is the visual tour of how the plugin is built, covering the "three doors" model, the task pipeline, the widget layer, and the working directory, with diagrams.
- **[Command reference](./commands.md)** lists every `/marvin:` command with a synopsis and the phrases that invoke it from chat.
- **[Configuration](./configuration.md)** documents the `.marvin/` working directory, the `.marvin/config.json` schema, and the `MARVIN_*` environment variables.
- **[Contributing](../CONTRIBUTING.md)** covers local setup, the quality gates every change must pass, and how to submit a PR.
- **[CLAUDE.md](../CLAUDE.md)** is the deep contributor reference with step-by-step recipes for adding prompts, tools, and agents.

## Decision history

Decisions with long-lived consequences are recorded as
[Architecture Decision Records](./adr/). The two pre-consolidation ADRs, which covered the
source format and the MCP-first stance, were retired in the publication cut, and their
still-relevant rationale is folded into ADR-0001, ADR-0013, and ADR-0018.

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
| [0014](./adr/0014-distribution-release-model.md) | Distribution and release model: git tag to GitHub Release, no npm | Accepted |
| [0015](./adr/0015-verify-shell-trust-boundary.md) | `verify` shell-execution trust boundary | Accepted |
| [0016](./adr/0016-bundled-external-mcp-deps.md) | Bundled external MCP dependencies (context7, gitmcp) | Accepted |
| [0017](./adr/0017-adversarial-critic-gates.md) | Adversarial critic gates in the task pipeline | Accepted |
| [0018](./adr/0018-three-doors-instrument-taxonomy.md) | Three doors and the instrument taxonomy | Accepted |
| [0019](./adr/0019-branching-and-pr-flow.md) | Branching model: release `main`, integration `dev`, changes via PRs | Accepted |
| [0020](./adr/0020-debugger-agent.md) | Root-cause analysis as the `marvin-debugger` agent | Accepted |
| [0021](./adr/0021-lessons-feedback-loop.md) | Tool-backed lessons-learned feedback loop | Accepted |
| [0022](./adr/0022-numbered-spec-files.md) | Numeric-prefixed spec filenames | Accepted |
| [0023](./adr/0023-pr-command-family.md) | Unified `pr-*` pull-request command family | Accepted |
| [0024](./adr/0024-mcp-apps-widget-architecture.md) | MCP Apps widget layer: data-first staging and shared data contracts | Accepted |
| [0025](./adr/0025-kanban-board-only.md) | Kanban goes board-only; git ops fold into the `commit` and `pr-create` skills | Accepted |
| [0026](./adr/0026-configurable-status-model.md) | Configurable status model: statuses are project data, roles stay closed | Accepted |
| [0027](./adr/0027-tool-backed-adr-lifecycle.md) | Tool-backed ADR lifecycle | Accepted |
| [0028](./adr/0028-lessons-hygiene-and-recall-expansion.md) | Lessons v2: hygiene surface and recall or capture expansion | Accepted |
| [0029](./adr/0029-refactoring-command-family.md) | Refactoring command family: read, plan, apply under hard rails | Accepted |
| [0030](./adr/0030-toolbox-dashboard-and-usage-log.md) | Toolbox dashboard and local usage log | Accepted |
| [0031](./adr/0031-track-command-group-rename.md) | Rename the `kanban-*` command group to `track-*` | Accepted |
| [0032](./adr/0032-track-surface-reduction.md) | Reduce the `track-*` surface to seven commands | Accepted |
| [0033](./adr/0033-report-export.md) | Report export is template-only (Claude fills a shipped print template) | Proposed |

## Work in progress

These documents capture how the project thinks and plans. They are kept public as a window
into the process rather than as finished deliverables.

- [proposals/](./proposals/) holds design proposals under discussion.
- [requirements/](./requirements/) holds requirements being shaped into specs.

## Reference

- The [command reference](./commands.md) lists every `/marvin:` command with a synopsis and a usage example.
- The [configuration reference](./configuration.md) documents the `.marvin/` working directory, the `.marvin/config.json` schema, and the `MARVIN_*` environment variables.
- [Publishing and promotion readiness](./publishing.md) is the requirements checklist and the ordered plan for shipping Marvin to the official directory and community marketplaces.
- The [security policy](../SECURITY.md) covers supported versions and how to report a vulnerability.
- The [marketplace changelog](../CHANGELOG.md) and the [plugin changelog](../plugins/marvin/CHANGELOG.md) track their respective histories.
