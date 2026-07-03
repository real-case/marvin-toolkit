# marvin

> Claude Code toolkit for those who don't panic.

The complete Marvin toolkit as **one plugin, one MCP server, one slash prefix** —
`/marvin:`. Core dev tools, the ADR decision-record lifecycle, a spec-driven task
pipeline, security scanners, a code-health refactoring family, and a lightweight kanban
tracker, covering the whole development lifecycle.

## Install

```shell
/plugin marketplace add real-case/marvin-toolkit
/plugin install marvin@marvin-toolkit
```

This registers the `marvin` MCP server; commands appear as `/marvin:<group>-<command>`.

## Command groups

| Group | What | Count | Examples |
|-------|------|-------|----------|
| _(bare)_ | core developer tools | 13 | `/marvin:commit`, `/marvin:debug`, `/marvin:adr`, `/marvin:dashboard` |
| `adr-*` | ADR lifecycle (tool-backed; accept/supersede/sync are human-run) | 6 | `/marvin:adr-review`, `/marvin:adr-accept`, `/marvin:adr-audit` |
| `pr-*` | pull-request operations | 4 | `/marvin:pr-create`, `/marvin:pr-review`, `/marvin:pr-resolve`, `/marvin:pr-merge` |
| `task-*` | spec-driven task pipeline | 5 | `/marvin:task-start`, `/marvin:task-verify` |
| `sec-*` | security scanners | 10 | `/marvin:sec-scan`, `/marvin:sec-threat-model` |
| `refactor-*` | code-health family (read → plan → apply) | 4 | `/marvin:refactor-audit`, `/marvin:refactor-plan`, `/marvin:refactor-apply` |
| `kanban-*` | lightweight task tracker (board-only) | 12 | `/marvin:kanban-menu`, `/marvin:kanban-start`, `/marvin:kanban-config` |

54 prompts total. Most are reachable three ways — by chat, by `/<command>`, and by
`/marvin:<command>` — all backed by the same skill.

## Documentation

- [Architecture tour (with diagrams)](../../docs/architecture.md)
- [Command reference (with natural-language phrases)](../../docs/commands.md)
- [Lifecycle overview](../../README.md)
- [Architecture Decision Records](../../docs/adr/)
- [Changelog](./CHANGELOG.md)

## License

[MIT](../../LICENSE) © Yurii Anichkin
