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
[Architecture Decision Records](./adr/). Superseded entries are kept for the audit
trail.

| ADR | Decision | Status |
|-----|----------|--------|
| [0001](./adr/0001-source-format.md) | Source format — keep `plugins/` Claude-native | superseded by 0002 |
| [0002](./adr/0002-mcp-first-architecture.md) | MCP-first architecture | superseded by 0003 |
| [0003](./adr/0003-single-plugin-consolidation.md) | Single-plugin consolidation under one `/marvin:` prefix | active |
| [0004](./adr/0004-tool-backed-verification.md) | Tool-backed verification gate | active |
| [0005](./adr/0005-tool-backed-dor.md) | Tool-backed Definition-of-Ready gate | active |
| [0006](./adr/0006-traceable-spec-contract.md) | Traceable spec contract and gate reordering | active |
| [0007](./adr/0007-portable-spec-contract.md) | Portable, host-adaptive spec contract | active |
| [0008](./adr/0008-all-subagents-opus.md) | All subagents on Opus; economy via deterministic tools | active |
| [0009](./adr/0009-marvin-working-directory.md) | Unified `.marvin/` working directory | active |
| [0010](./adr/0010-mcp-door-resource-resolution.md) | MCP-door plugin-resource resolution | active |

## Work in progress

These capture how the project thinks and plans — kept public as a window into the
process, not finished deliverables.

- [proposals/](./proposals/) — design proposals under discussion.
- [requirements/](./requirements/) — requirements being shaped into specs.

## Reference

- [Security policy](../SECURITY.md) — supported versions and how to report a vulnerability.
- [Changelog (marketplace)](../CHANGELOG.md) and [changelog (plugin)](../plugins/marvin/CHANGELOG.md).
