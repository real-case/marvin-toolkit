# Configuration reference

Marvin works out of the box with no configuration. When you do need to change its
behavior, there are two mechanisms: a per-project `.marvin/config.json` file that tunes
the board, the verify gates, and telemetry, and a set of `MARVIN_*` environment
variables that repoint where Marvin reads and writes. This page documents both
completely.

## The `.marvin/` working directory

Every service file Marvin generates lives under a single hidden `.marvin/` directory at
the project root, one subdirectory per command group. This keeps Marvin's artifacts
together and easy to include in or exclude from version control.

| Path | Written by | Contents |
| ---- | ---------- | -------- |
| `.marvin/task/` | the `task-*` pipeline | immutable specs and the current `verification.md` |
| `.marvin/kanban/` | the `kanban-*` tracker | the task board as markdown files |
| `.marvin/security/` | the `sec-*` scanners | scan, threat-model, compliance, and pentest reports |
| `.marvin/refactor/` | the `refactor-*` family | findings registers and step plans |
| `.marvin/memory/` | the `lessons` tool | the team lessons-learned store and its index |
| `.marvin/handoff/` | the `handoff` tool | session-continuation documents |
| `.marvin/usage/` | the usage-log middleware | a local, never-committed telemetry log |
| `.marvin/config.json` | `kanban-config` and `verify` | the settings documented below |

Spec storage is host-adaptive. `.marvin/task/` is the default, but Marvin prefers an
existing host convention when it finds one, searching `.marvin/task/` first and then
`specs/`, `docs/specs/`, `docs/rfcs/`, and `rfcs/`.

## `.marvin/config.json`

This file holds project settings. It is optional — when it is absent, every field falls
back to the default described below. You do not edit it by hand; `/marvin:kanban-config`
shows and changes each setting with fail-closed validation, and preserves keys owned by
other tools when it writes. Invalid JSON or a schema violation causes Marvin to fall
back to defaults and surface a warning through `/marvin:dashboard` rather than failing.

A complete example, with every field set:

```json
{
  "base_branch": "main",
  "tracker_url_template": "https://acme.atlassian.net/browse/{tracker_id}",
  "branch_template": "{type_prefix}/{seq}-{slug}",
  "gates": {
    "test": "npm test",
    "lint": "npm run lint",
    "typecheck": "tsc --noEmit",
    "build": "npm run build"
  },
  "statuses": [
    { "key": "backlog", "role": "todo" },
    { "key": "in-progress", "role": "wip", "tracker_status": "In Progress" },
    { "key": "code-review", "role": "review", "tracker_status": "In Review" },
    { "key": "done", "role": "done", "tracker_status": "Done" },
    { "key": "blocked", "role": "blocked" }
  ],
  "usage": { "enabled": true }
}
```

### `base_branch`

The branch that new topic branches fork from and that pull requests target. It is a
string and defaults to `dev`. On a project with no config file, Marvin auto-detects the
value from `origin/HEAD`, so a `main`-based repository works on first run without any
setup. Once the file exists, an explicit `base_branch` always wins over detection.

### `tracker_url_template`

A URL template that turns a task's external tracker id into a link in lists and
summaries. It is a string or `null`, and defaults to `null` (no links). Use the
`{tracker_id}` placeholder to mark where the id goes, as in
`https://acme.atlassian.net/browse/{tracker_id}`.

### `branch_template`

A template for the branch name of a new task. It is an optional string; when it is
absent, Marvin uses the default scheme from ADR-0019. The available placeholders are
`{type_prefix}`, `{type}`, `{seq}`, `{tracker}`, and `{slug}`. If a template renders an
invalid git reference, Marvin falls back to the default scheme at create time and warns
rather than failing.

### `gates`

Overrides for the commands the `verify` tool runs. It is an optional object with four
optional string fields — `test`, `lint`, `typecheck`, and `build` — each a shell command.
When a field is set, `verify` runs that exact command for the gate; when it is absent,
`verify` auto-detects the command from the project's stack. See the [verify gates](#verify-gates)
section for how resolution works.

### `statuses`

The board's status vocabulary. It is an array of status objects and defaults to the
classic set of `todo`, `wip`, `review`, `done`, and `blocked`. Each entry has:

- `key` — the identifier stored in task files, written in lowercase alphanumerics and
  hyphens.
- `role` — one of `todo`, `wip`, `review`, `done`, or `blocked`. The lifecycle commands
  act by role, so `kanban-start` targets the first `wip`-role status and so on.
- `tracker_status` — an optional exact name from your external tracker's workflow, which
  a future connector will use as its mapping key.

You must define at least one status for each of the `todo`, `wip`, and `done` roles;
`review` and `blocked` are optional. An edit that violates this is rejected with the
exact problem, and nothing is written.

### `usage`

The kill-switch for the local usage log. It is an optional object with a single boolean
field `enabled` that defaults to `true`. Set `{ "enabled": false }` to turn telemetry
off entirely. See [telemetry](#telemetry) below.

### `adr`

The location of the ADR corpus, owned by the `adr` tool. It is an optional object with
two optional string fields: `dir`, the corpus directory relative to the project root,
and `index_file`, the file that carries the managed corpus-index block. When absent,
Marvin detects the corpus from `docs/adr/`, `docs/decisions/`, or `adr/`, and defaults to
`docs/adr/`.

## Environment variables

The `MARVIN_*` variables repoint where the server reads and writes. Set them in the
plugin's `.mcp.json` `env` block. Only the two task variables are set there by default;
the rest exist mainly for test isolation and each defaults to a subdirectory of
`.marvin/`.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `MARVIN_TASKS_DIR` | `.marvin/kanban` | where kanban task files live |
| `MARVIN_TASKS_CONFIG` | `.marvin/config.json` | the config file path |
| `MARVIN_MEMORY_DIR` | `.marvin/memory` | the lessons-learned store |
| `MARVIN_HANDOFF_DIR` | `.marvin/handoff` | session-continuation documents |
| `MARVIN_SECURITY_DIR` | `.marvin/security` | `sec-*` scanner reports |
| `MARVIN_USAGE_DIR` | `.marvin/usage` | the local usage log |

## Verify gates

The `verify` tool runs a project's quality gates — tests, lint, type-check, and build —
concurrently, and writes the outcome to `.marvin/task/verification.md`. It resolves each
gate's command config-first: an explicit command in the `gates` object always wins, and
only when a gate is unset does `verify` fall back to auto-detecting it from the stack. It
detects Go, Python, TypeScript, Rust, and Java, with an npm-script and Makefile fallback
for anything else.

Set `gates` when your project's commands differ from what auto-detection would choose,
for example a custom test runner or a monorepo build script. Leave it unset to let Marvin
detect the commands.

## Telemetry

Marvin keeps a local usage log at `.marvin/usage/events.jsonl`, appending one line per
prompt invocation and tool call as a small `{ts, kind, name}` record. This log powers the
usage summary in `/marvin:dashboard` and nothing else. It never leaves your machine: the
directory writes its own `.gitignore` of `*`, so the log is never committed, and the log
is size-capped with rotation.

Telemetry is opt-out. To disable it, set `usage.enabled` to `false` in
`.marvin/config.json`; the switch is re-read on every event, so the change applies
immediately. Recording is fail-open, meaning a logging error never interferes with the
command you ran.

## Committing `.marvin/` or ignoring it

Whether to version the `.marvin/` directory depends on how you use each part of it.

- **Commit for a team.** For a shared board, commit `.marvin/kanban/` and
  `.marvin/config.json` together so the tasks and their status vocabulary travel with the
  repository. Specs (`.marvin/task/`) and lessons (`.marvin/memory/`) are likewise team
  assets worth committing.
- **Ignore point-in-time artifacts.** Security reports (`.marvin/security/`) and session
  handoffs (`.marvin/handoff/`) are moments in time that most teams gitignore.
- **Never commit the usage log.** `.marvin/usage/` ignores itself, so it stays local
  regardless.

Keep the board and its configuration together: whichever location holds
`.marvin/kanban/` should also hold `.marvin/config.json`, because task files store status
keys that only parse against the matching `statuses` configuration.

## External MCP servers

Alongside its own server, the plugin registers two external MCP servers in `.mcp.json`:
`context7`, which looks up current library documentation and runs through `npx`, and
`gitmcp`, a remote service for GitHub repository documentation. Both back the research
workflows; neither is required for the core commands.
