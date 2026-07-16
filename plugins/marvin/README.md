# marvin

> Claude Code toolkit for those who don't panic.

The complete Marvin toolkit as **one plugin, one MCP server, and one slash prefix** —
`/marvin:`. It covers the whole development lifecycle: core developer tools, the ADR
decision-record lifecycle, a spec-driven task pipeline, security scanners, a code-health
refactoring family, and a lightweight task tracker. Under the hood it ships **50 prompts,
12 MCP tools, 10 agents, and 8 interactive widgets**.

## Install

Run these two commands inside Claude Code:

```shell
/plugin marketplace add real-case/marvin-toolkit
/plugin install marvin@marvin-toolkit
```

This registers the `marvin` MCP server, and its commands appear as
`/marvin:<group>-<command>`.

## Command groups

| Group | Purpose | Count | Examples |
|-------|---------|-------|----------|
| _(bare)_ | Core developer tools | 13 | `/marvin:commit`, `/marvin:debug`, `/marvin:adr`, `/marvin:dashboard` |
| `adr-*` | ADR lifecycle | 6 | `/marvin:adr-review`, `/marvin:adr-accept`, `/marvin:adr-audit` |
| `pr-*` | Pull-request operations | 4 | `/marvin:pr-create`, `/marvin:pr-review`, `/marvin:pr-resolve`, `/marvin:pr-merge` |
| `task-*` | Spec-driven task pipeline | 5 | `/marvin:task-start`, `/marvin:task-verify` |
| `sec-*` | Security scanners | 11 | `/marvin:sec-scan`, `/marvin:sec-threat-model` |
| `refactor-*` | Code-health family (read, plan, apply) | 4 | `/marvin:refactor-audit`, `/marvin:refactor-plan`, `/marvin:refactor-apply` |
| `track-*` | Lightweight task tracker | 7 | `/marvin:track-menu`, `/marvin:track-new`, `/marvin:track-start` |

Most commands are reachable three ways — by chat, by `/<command>`, and by
`/marvin:<command>` — all backed by the same skill.

## Documentation

- [Architecture tour, with diagrams](../../docs/architecture.md)
- [Command reference, with natural-language phrases](../../docs/commands.md)
- [Getting started](../../docs/getting-started.md) and the [usage guide](../../docs/usage.md)
- [Lifecycle overview](../../README.md)
- [Architecture Decision Records](../../docs/adr/)
- [Changelog](./CHANGELOG.md)

## License

[MIT](../../LICENSE) © Yurii Anichkin
