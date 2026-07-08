# Configuration reference

Marvin works out of the box with no configuration. When you do need to change its
behavior, there are two mechanisms, and this page documents both completely. The first is
a per-project `.marvin/config.json` file that tunes the board, the verify gates, and
telemetry. The second is a set of `MARVIN_*` environment variables that repoint where
Marvin reads and writes.

## The `.marvin/` working directory

Every service file Marvin generates lives under a single hidden `.marvin/` directory at
the project root, with one subdirectory per command group. Keeping the artifacts together
makes them easy to include in or exclude from version control as a unit.

| Path | Written by | Contents |
| ---- | ---------- | -------- |
| `.marvin/task/` | The `task-*` pipeline | Immutable specs and the current `verification.md`. |
| `.marvin/kanban/` | The `kanban-*` tracker | The task board as markdown files. |
| `.marvin/security/` | The `sec-*` scanners | Scan, threat-model, compliance, and pentest reports. |
| `.marvin/refactor/` | The `refactor-*` family | Findings registers and step plans. |
| `.marvin/memory/` | The `lessons` tool | The team lessons-learned store and its index. |
| `.marvin/handoff/` | The `handoff` tool | Session-continuation documents. |
| `.marvin/usage/` | The usage-log middleware | A local, never-committed telemetry log. |
| `.marvin/config.json` | `kanban-config` and `verify` | The settings documented below. |

Spec storage is host-adaptive. `.marvin/task/` is the default, but Marvin prefers an
existing host convention when it finds one, searching `.marvin/task/` first and then
`specs/`, `docs/specs/`, `docs/rfcs/`, and `rfcs/`.

## `.marvin/config.json`

This file holds the project settings. It is optional, and when it is absent every field
falls back to the default described below. You do not edit it by hand; `/marvin:kanban-config`
shows and changes each setting with fail-closed validation and preserves keys owned by
other tools when it writes. Invalid JSON or a schema violation makes Marvin fall back to
defaults and surface a warning through `/marvin:dashboard` rather than failing.

Here is a complete example with every field set:

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

This is the branch that new topic branches fork from and that pull requests target. It is
a string and defaults to `dev`. On a project with no config file, Marvin auto-detects the
value from `origin/HEAD`, so a `main`-based repository works on first run without any
setup. Once the file exists, an explicit `base_branch` always wins over detection.

### `tracker_url_template`

This is a URL template that turns a task's external tracker id into a link in lists and
summaries. It is a string or `null` and defaults to `null`, which produces no links. Use
the `{tracker_id}` placeholder to mark where the id goes, as in
`https://acme.atlassian.net/browse/{tracker_id}`.

### `branch_template`

This is a template for the branch name of a new task. It is an optional string, and when
it is absent Marvin uses the default scheme from [ADR-0019](./adr/0019-branching-and-pr-flow.md).
The available placeholders are `{type_prefix}`, `{type}`, `{seq}`, `{tracker}`, and
`{slug}`. If a template renders an invalid git reference, Marvin falls back to the default
scheme at create time and warns rather than failing.

### `gates`

These are overrides for the commands the `verify` tool runs. It is an optional object with
four optional string fields — `test`, `lint`, `typecheck`, and `build` — each a shell
command. When a field is set, `verify` runs that exact command for the gate; when it is
absent, `verify` auto-detects the command from the project's stack. The
[verify gates](#verify-gates) section explains resolution in full.

### `statuses`

This is the board's status vocabulary. It is an array of status objects and defaults to
the classic set of `todo`, `wip`, `review`, `done`, and `blocked`. Each entry has three
fields:

- `key` is the identifier stored in task files, written in lowercase alphanumerics and hyphens.
- `role` is one of `todo`, `wip`, `review`, `done`, or `blocked`. The lifecycle commands act by role, so `kanban-start` targets the first `wip`-role status and so on.
- `tracker_status` is an optional exact name from your external tracker's workflow, which a future connector will use as its mapping key.

You must define at least one status for each of the `todo`, `wip`, and `done` roles, while
`review` and `blocked` are optional. An edit that violates this is rejected with the exact
problem, and nothing is written.

### `usage`

This is the kill-switch for the local usage log. It is an optional object with a single
boolean field `enabled` that defaults to `true`. Set it to `false` to turn telemetry off
entirely, as the [telemetry](#telemetry) section describes.

### `adr`

This is the location of the ADR corpus, owned by the `adr` tool. It is an optional object
with two optional string fields: `dir`, the corpus directory relative to the project root,
and `index_file`, the file that carries the managed corpus-index block. When it is absent,
Marvin detects the corpus from `docs/adr/`, `docs/decisions/`, or `adr/`, and defaults to
`docs/adr/`.

## Environment variables

The `MARVIN_*` variables repoint where the server reads and writes, and you set them in
the plugin's `.mcp.json` `env` block. Only the two task variables are set there by default;
the rest exist mainly for test isolation, and each defaults to a subdirectory of
`.marvin/`.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `MARVIN_TASKS_DIR` | `.marvin/kanban` | Where the kanban task files live. |
| `MARVIN_TASKS_CONFIG` | `.marvin/config.json` | The config file path. |
| `MARVIN_MEMORY_DIR` | `.marvin/memory` | The lessons-learned store. |
| `MARVIN_HANDOFF_DIR` | `.marvin/handoff` | The session-continuation documents. |
| `MARVIN_SECURITY_DIR` | `.marvin/security` | The `sec-*` scanner reports. |
| `MARVIN_USAGE_DIR` | `.marvin/usage` | The local usage log. |

## Verify gates

The `verify` tool runs a project's quality gates — tests, lint, type-check, and build —
concurrently, and writes the outcome to `.marvin/task/verification.md`. It resolves each
gate's command config-first: an explicit command in the `gates` object always wins, and
only when a gate is unset does `verify` fall back to auto-detecting it from the stack. It
detects Go, Python, TypeScript, Rust, and Java, with an npm-script and Makefile fallback
for anything else.

Set `gates` when your project's commands differ from what auto-detection would choose, for
example a custom test runner or a monorepo build script. Leave it unset to let Marvin
detect the commands for you.

## Telemetry

Marvin keeps a local usage log at `.marvin/usage/events.jsonl`, appending one line per
prompt invocation and tool call as a small `{ts, kind, name}` record. This log powers the
usage summary in `/marvin:dashboard` and nothing else. It never leaves your machine,
because the directory writes its own `.gitignore` of `*` so the log is never committed, and
the file is size-capped with rotation so it cannot grow without bound.

Telemetry is opt-out. To disable it, set `usage.enabled` to `false` in `.marvin/config.json`;
the switch is re-read on every event, so the change applies immediately. Recording is
fail-open, meaning a logging error never interferes with the command you ran.

## Committing `.marvin/` or ignoring it

Whether to version the `.marvin/` directory depends on how you use each part of it.

- **Commit it for a team.** For a shared board, commit `.marvin/kanban/` and `.marvin/config.json` together so the tasks and their status vocabulary travel with the repository. Specs in `.marvin/task/` and lessons in `.marvin/memory/` are likewise team assets worth committing.
- **Ignore the point-in-time artifacts.** Security reports in `.marvin/security/` and session handoffs in `.marvin/handoff/` are moments in time that most teams gitignore.
- **Leave the usage log alone.** `.marvin/usage/` ignores itself, so it stays local regardless.

Keep the board and its configuration together. Whichever location holds `.marvin/kanban/`
should also hold `.marvin/config.json`, because task files store status keys that only
parse against the matching `statuses` configuration.

## External MCP servers

Alongside its own server, the plugin registers two external MCP servers in `.mcp.json`.
The first is `context7`, which looks up current library documentation and runs through
`npx`. The second is `gitmcp`, a remote service for GitHub repository documentation. Both
back the research workflows, and neither is required for the core commands.
