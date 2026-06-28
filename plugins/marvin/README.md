# marvin

> Claude Code toolkit for those who don't panic.

The complete Marvin toolkit as **one plugin, one MCP server, one slash prefix** —
`/marvin:`. Core dev tools, a spec-driven task pipeline, security scanners, and a
lightweight kanban tracker, covering the whole development lifecycle.

## Install

```shell
/plugin marketplace add real-case/marvin-toolkit
/plugin install marvin@marvin-toolkit
```

This registers the `marvin` MCP server; commands appear as `/marvin:<group>-<command>`.

## Command groups

| Group | What | Count | Examples |
|-------|------|-------|----------|
| _(bare)_ | core developer tools | 9 | `/marvin:commit`, `/marvin:debug`, `/marvin:handoff` |
| `pr-*` | pull-request operations | 4 | `/marvin:pr-create`, `/marvin:pr-review`, `/marvin:pr-resolve`, `/marvin:pr-merge` |
| `task-*` | spec-driven task pipeline | 4 | `/marvin:task-start`, `/marvin:task-verify` |
| `sec-*` | security scanners | 10 | `/marvin:sec-scan`, `/marvin:sec-threat-model` |
| `kanban-*` | lightweight task tracker | 13 | `/marvin:kanban-menu`, `/marvin:kanban-start` |

40 prompts total. Most are reachable three ways — by chat, by `/<command>`, and by
`/marvin:<command>` — all backed by the same skill.

## Documentation

- [Architecture tour (with diagrams)](../../docs/architecture.md)
- [Full command reference & lifecycle](../../README.md)
- [Architecture Decision Records](../../docs/adr/)
- [Changelog](./CHANGELOG.md)

## License

[MIT](../../LICENSE) © Yurii Anichkin
