# ADR 0003 — Single-plugin consolidation under one `/marvin:` prefix

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-06                                                  |
| Supersedes    | ADR 0002 — reverses C1 (per-pack servers) and C3 (`marvin-<pack>:` prefixes) |
| Superseded by | —                                                           |

## Context

ADR-0002 shipped the toolkit as **four independently-installable plugins**, each
with its own MCP server (`marvin-core`, `marvin-sec`, `marvin-tm`, `marvin-tasks`).
A Claude Code MCP slash command is `/<server-key>:<prompt>`, where the server key
comes from the plugin's `.mcp.json`. That produced long, per-pack prefixes:
`/marvin-taskmaster:start`, `/marvin-core:commit`, `/marvin-sec:scan`.

In daily use the per-pack prefixes proved cumbersome: the user must remember which
pack owns a command, and the prefixes are long. The maintainer asked for a single
short prefix with a two-part command name — `/marvin:<group>-<command>` — e.g.
`/marvin:task-start`, `/marvin:pr-create`, `/marvin:commit`.

### The binding constraint

The slash prefix **is** the MCP server key, not the plugin name. MCP servers are not
shared between plugins — each `.mcp.json` server entry is an independent process, and
two plugins registering the same key (`marvin`) collide (last-wins, undefined). So a
single `/marvin:` prefix spanning commands that today live in different packs
(`task-start` from taskmaster, `commit` from core) is achievable **only** by serving
all prompts from one MCP server inside one plugin.

## Decision

Collapse the four packs into **one plugin** (`plugins/marvin/`) shipping **one MCP
server** (key `marvin`). All prompts, skills, agents, and the kanban tool server live
under it. Commands are renamed to `/marvin:<group>-<command>`; singletons stay bare.

### Locked sub-decisions

| #  | Decision |
|----|----------|
| D1 | **One plugin, one server.** `plugins/marvin/` with `.mcp.json` key `marvin`. Reverses ADR-0002 C1. Trade-off accepted: packs are no longer installed à la carte — installing `marvin` brings core + security + taskmaster + kanban together. |
| D2 | **Naming scheme `/marvin:<group>-<command>`.** Groups reflect task families; singletons are bare. Reverses ADR-0002 C3/C7. The full map lives in the consolidation plan and CLAUDE.md. |
| D3 | **Collision resolution.** Flattening four namespaces into one surfaced real clashes — `start`, `review`, `commit` each existed in two packs. Resolved by group prefixes: taskmaster → `task-*`, kanban → `kanban-*` (every kanban prompt prefixed, including `kanban-menu`), security → `sec-*`. Core keeps bare `commit`/`debug` and the `pr-*` pair (`pr-create`, `pr-review`). |
| D4 | **Deprecated alias dropped.** The `security-scan` backward-compat alias (skill + command + prompt) is removed — noise under a fresh single prefix. |
| D5 | **`SKILL.md` stays the single source of truth (ADR-0002 C4 kept).** Skill directories and their frontmatter `name:` are renamed to the new unified names so dir = name = command. The kanban group keeps inline `body:` tool-wrappers (no skills), as before. |
| D6 | **One server bundle.** The stateful kanban tools (`task`/`git`/`help`) and their `storage/`/`lib/`/`flows/` modules move into the unified server `src/`. The server registers all 38 prompts plus the 3 tools, loading `MARVIN_TASKS_*` env at build time. |
| D7 | **Agents stay as `plugins/marvin/agents/*.md` (ADR-0002 C2 kept).** All eight agents merge into one `agents/` directory. |
| D8 | **Versioning.** The consolidated plugin and server jump to `2.0.0-alpha.1` to signal the breaking server-key rename; marketplace `metadata.version` follows. |

## Repository layout

```
plugins/marvin/
├── .claude-plugin/plugin.json        # name: "marvin"
├── .mcp.json                         # key "marvin" (+ context7, gitmcp, MARVIN_TASKS_* env)
├── CHANGELOG.md
├── skills/<command>/SKILL.md         # unified names; single source of truth
├── commands/<command>.md             # markdown slash aliases (no mn. prefix)
├── agents/*.md                       # all 8 agents
└── mcp/server/
    ├── src/
    │   ├── server.ts                 # name: "marvin"; registers prompts + tools
    │   ├── prompts/index.ts          # 38 prompts (skill-backed + inline kanban)
    │   ├── tools/ lib/ storage/ flows/   # kanban tool server
    └── dist/server.js                # committed bundle
```

## Consequences

### Positive

- One short, memorable prefix; command names carry their own group.
- No cross-pack prefix bookkeeping; the whole toolkit appears as one coherent menu.
- Single build, single `dist/server.js`, single smoke-test target.

### Negative / accepted trade-offs

- **No à-la-carte install.** A user who only wants commits also gets the security and
  taskmaster surface. Given a solo maintainer and a cohesive toolkit, acceptable.
- **Door overlap.** A markdown command (`commands/commit.md`) and the MCP prompt
  (`commit`) can both surface for `commit`; this mirrors the existing "three doors"
  design and is verified in the live slash menu.
- **Breaking change.** Every `/marvin-<pack>:*` command is renamed. Communicated via
  the CHANGELOG and the major version bump.
