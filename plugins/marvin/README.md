# marvin

> Claude Code toolkit for those who don't panic.

The complete Marvin toolkit as **one plugin, one MCP server, and one slash prefix** —
`/marvin:`. It covers the whole development lifecycle: core developer tools, the ADR
decision-record lifecycle, a spec-driven task pipeline, security scanners, a code-health
refactoring family, and a lightweight task tracker. Under the hood it ships **55 prompts,
13 MCP tools, 10 agents, and 9 interactive widgets**.

## Install

Run these two commands inside Claude Code:

```shell
/plugin marketplace add real-case/marvin-toolkit
/plugin install marvin@marvin-toolkit
```

This registers the `marvin` MCP server, and its commands appear as
`/marvin:<group>-<command>`.

**Installing also lets Marvin block a shell command.** Two hooks arrive with the plugin and
are armed with no enablement step: one refuses a commit that skips your local gates
(`git commit --no-verify`) and a force-push or deletion aimed at a protected branch, the
other refuses a commit whose added lines carry a credential-shaped string. Everything else
runs untouched — a quoted `--no-verify` in a commit message is not a match, a dry-run push
is never blocked, and any internal error allows the command rather than blocking it. To turn
them off, set `"hooks": { "enabled": false }` in `.marvin/config.json`, or export
`MARVIN_HOOKS_DISABLED=1` for one session. The
[configuration reference](../../docs/configuration.md#hooks) has the details.

## Command groups

| Group | Purpose | Count | Examples |
|-------|---------|-------|----------|
| _(bare)_ | Core developer tools | 17 | `/marvin:onboard`, `/marvin:commit`, `/marvin:debug`, `/marvin:adr`, `/marvin:report-export` |
| `adr-*` | ADR lifecycle | 6 | `/marvin:adr-review`, `/marvin:adr-accept`, `/marvin:adr-audit` |
| `pr-*` | Pull-request operations | 4 | `/marvin:pr-create`, `/marvin:pr-review`, `/marvin:pr-resolve`, `/marvin:pr-merge` |
| `task-*` | Spec-driven task pipeline | 6 | `/marvin:task-start`, `/marvin:task-verify`, `/marvin:task-audit` |
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
