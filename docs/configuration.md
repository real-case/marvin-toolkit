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
| `.marvin/task/runs/` | The `verify` and `spec` tools | What each spec's own runs recorded: whether the gates passed, whether its acceptance oracles went red then green, and how far an interrupted intake or implementation run got before it stopped, and how many verification runs and delivery-gate decisions it took to get there (`<slug>.verify.md`, append-only, because the run file itself is overwritten by every run). The progress record is what a resumed session recovers instead of starting the dialogue over; the run journal is what the metrics roll-up reads. Nothing here is edited by hand. |
| `.marvin/track/` | The `track-*` tracker | The task board as markdown files. |
| `.marvin/security/` | The `sec-*` scanners | Scan, threat-model, compliance, and pentest reports. |
| `.marvin/refactor/` | The `refactor-*` family | Findings registers and step plans. |
| `.marvin/memory/` | The `lessons` tool | The team lessons-learned store and its index. |
| `.marvin/handoff/` | The `handoff` tool | Session-continuation documents. |
| `.marvin/critique/` | The calling session, at the four pipeline critic call sites | Critic receipts: the critic's report verbatim plus a typed verdict block with a compliance and a quality axis. Read back by `/marvin:reports` and `/marvin:task-summary`; they never change a delivery decision. |
| `.marvin/research-results/` | The `marvin-researcher` agent | Dated library research notes, written once and never read back. |
| `.marvin/usage/` | The usage-log middleware | A local, never-committed telemetry log. |
| `.marvin/report/` | The `report` tool's `triage` action | The triage baseline — which finding identities were last recorded as seen. Local and self-ignoring, never committed. Despite the name it is not a report group: it holds the tool's own state, not generated reports, and the viewer never lists it. Created only when a `snapshot` is asked for. |
| `.marvin/preview/` | The `widget-preview` command | Rendered widget panels, never committed. |
| `.marvin/config.json` | `track-config` and `verify` | The settings documented below. |

Spec storage is host-adaptive. `.marvin/task/` is the default, but Marvin prefers an
existing host convention when it finds one, searching `.marvin/task/` first and then
`specs/`, `docs/specs/`, `docs/rfcs/`, and `rfcs/`. The [`spec`](#spec) setting overrides
that search with an explicit directory. Specs move with it; the verification artifacts
Marvin writes about a run do not, because `verification.md` and `runs/` are service files
and stay under `.marvin/task/` wherever the specs themselves live.

## `.marvin/config.json`

This file holds the project settings. It is optional, and when it is absent every field
falls back to the default described below. You do not edit it by hand; `/marvin:track-config`
shows and changes each setting with fail-closed validation and preserves keys owned by
other tools when it writes. The one exception is `usage.enabled`: no tool action writes
that key, so it is set by editing the file directly, leaving every other key in place.
That is the edit `/marvin:onboard` offers to make for you. Invalid JSON or a schema
violation makes Marvin fall back to defaults and surface a warning through
`/marvin:dashboard` rather than failing.

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

`{tracker_id}` is the only placeholder Marvin substitutes, and every occurrence of it is
replaced. A template that omits it, or that carries a second placeholder such as
`{project}`, cannot produce a working URL: the id would have nowhere to go, or the link
would point at an address still containing braces. Marvin never renders such a link.
`/marvin:track-config` refuses to write a template like that, and one edited into the file
by hand is ignored on load — tasks show their tracker id as plain text, and the reason
appears in `/marvin:track-config` and `/marvin:dashboard`. The rest of the file keeps
working: only this setting is dropped.

### `branch_template`

This is a template for the branch name of a new task. It is an optional string, and when
it is absent Marvin uses the default scheme from [ADR-0019](./adr/0019-branching-and-pr-flow.md).
The available placeholders are `{type_prefix}`, `{type}`, `{seq}`, `{tracker}`, and
`{slug}`. If a template renders an invalid git reference, Marvin falls back to the default
scheme at create time and warns rather than failing.

### `gates`

These are overrides for the commands the `verify` tool runs. It is an optional object with
four optional string fields — `test`, `lint`, `typecheck`, and `build` — each a shell
command. When a field is set, `verify` runs that exact command for the gate, replacing every
command detection would have produced under that name; when it is absent, `verify`
auto-detects the command from the project's stack. The [verify gates](#verify-gates) section
explains resolution in full.

A fifth key, `test_one`, is recognised under the same object and is **not a gate**. It is the
template that runs a single test, and it exists only so a `kind: test` acceptance oracle can
resolve to a command. It is never scheduled, never appears in a verdict, and never reaches
`verification.md`; the dry-run plan lists the four gates and nothing else. See
[single-test resolution](#single-test-resolution-test_one) below.

Those four *gate* keys are the complete set. There is no fifth gate and no way to declare one: a
key Marvin does not recognise, whether a typo such as `tests` or an invented `audit`, is stripped
when the config loads, and the gate it was meant to configure falls back to detection with no
error reported anywhere. [ADR-0009](./adr/0009-config-first-gate-resolution.md) records that
as an accepted trade-off. The effective set stays inspectable: the report's `Stacks:` line
names `.marvin/config.json` whenever an override applied, and the dry-run plan (`verify` with
`dryRun: true`) lists the exact command resolved for each gate. The dry run is the one that
catches a stripped key in a config where other keys did apply, because the `Stacks:` marker
appears as soon as any single key survives.

### `statuses`

This is the board's status vocabulary. It is an array of status objects and defaults to
the classic set of `todo`, `wip`, `review`, `done`, and `blocked`. Each entry has three
fields:

- `key` is the identifier stored in task files, written in lowercase alphanumerics and hyphens.
- `role` is one of `todo`, `wip`, `review`, `done`, or `blocked`. The lifecycle commands act by role, so `track-start` targets the first `wip`-role status and so on.
- `tracker_status` is an optional exact name from your external tracker's workflow, which a future connector will use as its mapping key.

You must define at least one status for each of the `todo`, `wip`, and `done` roles, while
`review` and `blocked` are optional. An edit that violates this is rejected with the exact
problem, and nothing is written.

### `usage`

This is the kill-switch for the local usage log. It is an optional object with a single
boolean field `enabled` that defaults to `true`. Set it to `false` to turn telemetry off
entirely, as the [telemetry](#telemetry) section describes.

### `hooks`

This is the kill-switch for Marvin's two blocking hooks. It is an optional object with a
single boolean field `enabled` that defaults to `true`.

**Marvin can block a shell command.** The plugin ships two `PreToolUse` hooks that run
before every `Bash` tool call and can refuse one
([ADR-0040](./adr/0040-runtime-enforcement-hooks.md)). They arrive with the plugin and are
armed with no enablement step:

- **`bypass-guard`** refuses a commit that skips your local gates — `git commit
  --no-verify` or `-n`, and `git merge --no-verify` — and a force-push or branch deletion
  aimed at a protected branch. The flag has to be a real argument on a command that
  actually runs: a commit message that mentions `--no-verify` is not a match, and neither
  is an `echo`, a `#` comment, or a heredoc body that shows the command — including the
  one that produced this page. Nor is `git merge -n` (there `-n` is `--no-stat`), any
  `git push --dry-run`, or a `git commit --dry-run`; an attached option value is read as a
  value and not as flag letters, so `git commit -uno` is `--untracked-files=no`.
- **`secret-guard`** scans the lines the pending commit would add against a
  high-confidence credential-pattern list and refuses on a match. It names the pattern and
  the `file:line` and never prints the matched value.

The protected set is the union of three inputs: `base_branch` below, the default branch
`origin/HEAD` resolves to, and a shipped list of conventional integration-branch names
(`main`, `master`, `dev`, `develop`). A project whose integration branch is named anything
else sets `base_branch` and is covered.

**Two ways to turn it off.** Set `hooks.enabled` to `false` in this file to disable both
guards for the project, or export `MARVIN_HOOKS_DISABLED=1` to disable them for one
session. Every deny message repeats both.

**The failure direction is deliberate.** An absent, unreadable or malformed config file, a
config with no `hooks` block, an unrecognised key under `hooks`, an unreadable command, a
directory that is not a git repository, a failed `git` call, and any unexpected error all
leave the command **allowed**. Only an explicit `false`, or `MARVIN_HOOKS_DISABLED` set to
exactly `1`, disables the guards, and only a confirmed match blocks a command. Nothing is
written to disk and nothing leaves your machine.

**A trap worth naming: `MARVIN_TASKS_CONFIG` does not repoint the hooks.** That variable
scopes to the MCP server, and the hooks deliberately ignore it even when it is set in the
session — a test-isolation affordance must not decide what a blocking guard reads. The
hooks read `$CLAUDE_PROJECT_DIR/.marvin/config.json` and nothing else. So a project that
repoints its server config gets a server reading one file and a hook reading another, and
the kill switch lives in the hook's file.

### `adr`

This is the location of the ADR corpus, owned by the `adr` tool. It is an optional object
with two optional string fields: `dir`, the corpus directory relative to the project root,
and `index_file`, the file that carries the managed corpus-index block. When it is absent,
Marvin detects the corpus from `docs/adr/`, `docs/decisions/`, or `adr/`, and defaults to
`docs/adr/`.

### `spec`

This is the location of the spec corpus, owned by the `spec` tool. It is an optional object
with one optional string field, `dir`, the spec directory relative to the project root. When
it is set, it wins over the host-adaptive search: it decides where a new spec's ordering
number is allocated, which directory `/marvin:task-implement`, `/marvin:task-verify` and
`/marvin:task-deliver` consult first, and which specs `/marvin:dashboard` counts and lists.
When it is absent, Marvin detects the directory from `.marvin/task/`, `specs/`,
`docs/specs/`, `docs/rfcs/`, or `rfcs/` — in that order — and defaults to `.marvin/task/`.

Setting it is how a choice survives the session that made it. Detection cannot see a
directory that does not exist yet, which is exactly the state a freshly chosen location is
in, so without this key the next session re-derives the answer and may pick differently.

A slug lookup still searches every conventional directory, so configuring this never orphans
specs that already live elsewhere. What does **not** move is the verification artifacts:
`verification.md` and the per-run files under `runs/` stay in `.marvin/task/` whatever `dir`
says. A spec is a project document and follows the host's conventions; everything Marvin
generates about a run is a service file and stays in the working directory
([ADR-0037](./adr/0037-spec-corpus-mechanics.md)).

## Environment variables

The `MARVIN_*` variables repoint where the server reads and writes, and you set them in
the plugin's `.mcp.json` `env` block. Only the two task variables are set there by default;
the rest exist mainly for test isolation, and each defaults to a subdirectory of
`.marvin/`.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `MARVIN_TASKS_DIR` | `.marvin/track` | Where the board task files live. |
| `MARVIN_TASKS_CONFIG` | `.marvin/config.json` | The config file path. |
| `MARVIN_MEMORY_DIR` | `.marvin/memory` | The lessons-learned store. |
| `MARVIN_HANDOFF_DIR` | `.marvin/handoff` | The session-continuation documents. |
| `MARVIN_SECURITY_DIR` | `.marvin/security` | The `sec-*` scanner reports. |
| `MARVIN_CRITIQUE_DIR` | `.marvin/critique` | The critic receipts. |
| `MARVIN_USAGE_DIR` | `.marvin/usage` | The local usage log. |
| `MARVIN_REPORT_DIR` | `.marvin/report` | The triage baseline — local and self-ignoring, written only on a `snapshot`. |
| `MARVIN_HOOKS_DISABLED` | unset | Set to exactly `1` to disable both blocking hooks. Read by the hooks, not by the server. |

`MARVIN_HOOKS_DISABLED` is the one variable in this table whose scope is a **session**
rather than a call. A `PreToolUse` hook runs before the command it inspects and inherits
the session's environment, never the inspected command's, so prefixing it onto the blocked
git command puts it inside the command string where the hook does not read it. Export it in
the session instead.

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

### Single-test resolution: `test_one`

A gate command runs the whole suite. An **acceptance oracle** runs one test — the criterion
named `AC2`, not everything — so that a bugfix's red phase and its green phase are recorded
against that one criterion rather than against the project. `test_one` is how a project declares
the command shape that does it:

```json
{
  "gates": {
    "test": "pytest",
    "test_one": "pytest {file}::{name}"
  }
}
```

Three placeholders are substituted, all taken from the criterion's `oracle.ref` (written
`path/to/file::the test name`):

| Placeholder | Value |
|-------------|-------|
| `{file}` | the path half of the ref |
| `{name}` | the test-name half |
| `{ref}` | the whole ref, unsplit |

**Substitution is literal, and the quoting is yours.** `"pytest -k '{name}'"` keeps a test name
with spaces intact; `"pytest -k {name}"` does not. Marvin will not add quotes, because the
placeholder usually sits inside a flag you already quoted and re-quoting it produces a command
that fails for a reason nobody can read. What it does instead is refuse: a ref carrying a shell
metacharacter (`;`, `|`, `&`, a backtick, `$(`, a redirection, a newline) is never substituted at
all — the run records `not-run` with the reason `unsafe-ref` and no child process is started.

`test_one` is **not a gate**. It is never scheduled, its exit code never enters a verdict, and it
never appears in `verification.md`. Only `verify`'s `action: "oracles"` reads it.

**Without it, nothing is guessed.** Resolution walks a fixed chain — the per-call command, then
the criterion's own `oracle.run`, then a `kind: command` oracle's `ref` verbatim, then this
template, then a narrow default table (pytest, `go test`, `cargo test` — admitted only where the
runner's documented single-invocation form takes a file and a test name and the stack detector
matches exactly one such runner). When no rung applies, the run is recorded `not-run` with a
reason. There is deliberately **no JavaScript or TypeScript default row**: a synthesized
`node --test`-shaped command would run the wrong workspace's suite in any repository whose
`npm test` fans out, and a green from a suite that never contained the test is worse than no
answer. Marvin's own repository is that case, and starts at `not-run` for every one of its
`kind: test` oracles until it declares a `test_one` of its own.

One template serves the whole project, which a polyglot repository outgrows — three workspaces
with three runners cannot share one string. Such a project declares `run:` on the individual
criteria instead, where the command is exact. A `test_one` keyed by path glob is recorded as
future work in [ADR-0036](./adr/0036-oracle-execution-and-red-green.md).

### Scanners as gates

A gate command is an ordinary shell command, so a gate is not limited to the kind of tool its
name suggests. `npm audit --audit-level=high`, `gitleaks detect`, and `semgrep --config auto`
are all legitimate gate content, and running one under `verify` is what makes it blocking:
the result lands in `verification.md`, and through it in the delivery gate.

Because the four gate names are the complete set, adding a scanner means chaining it onto a
gate you already run:

```json
{
  "gates": {
    "lint": "npm run lint && gitleaks detect"
  }
}
```

Chaining has a cost. The two commands share one gate result, `&&` stops at the first failure
so a lint error means the scan never ran at all, and both the status line and the truncated
output kept in the report describe the chain rather than either command. Attributing a red
chained gate takes one manual re-run.

**A missing binary depends on the shape of the command.** Before it spawns anything, `verify`
checks whether a gate's binary can be resolved — but only for a **single simple command**. Such
a gate is recorded `not-run` rather than failed: the verdict becomes `PASS WITH WARNINGS`, a
warning names the gate and the missing token, and delivery proceeds. `"lint": "gitleaks detect"`
therefore no longer blocks a contributor who has not installed the tool.

**The chained form above is not covered, and still fails.** A command containing a shell
metacharacter — `&&`, a pipe, a quote, a redirection — is left alone and runs exactly as it
always has, so `"lint": "npm run lint && gitleaks detect"` on a machine without `gitleaks`
still exits non-zero, still yields `FAIL`, and still blocks `/marvin:task-deliver`. This is the
same cost the previous paragraph describes, seen from another angle: a chain is one gate to
everything downstream, and `command -v` cannot answer for it. Guessing at shell grammar risks
the opposite error — reporting `not-run` for a chain whose real failure was somewhere else,
which turns a genuine red into a warning. So for a shared config the advice is unchanged:
either keep chained scanner gates out of it, or make the binary a documented prerequisite of
the project.

**A `not-run` gate never makes delivery easier.** The delivery gate refuses outright, with no
input that waives it, when the run recorded a `test` gate and every `test` gate was `not-run`,
or when every recorded gate was `not-run`. A missing scanner degrades to a warning because the
pipeline's central claim survives it; "no tests ran" is not a degraded proof but the absence of
one. See [ADR-0035](adr/0035-evidence-provenance.md).

## Telemetry

Marvin keeps a local usage log at `.marvin/usage/events.jsonl`, appending one line per
prompt invocation and tool call as a small `{ts, kind, name}` record. Of the shipped
commands, only `/marvin:dashboard` reads it. It never leaves your machine, because the
directory writes its own `.gitignore` of `*` so the log is never committed, and the file is
size-capped with rotation so it cannot grow without bound.

Telemetry is opt-out. To disable it, set `usage.enabled` to `false` in `.marvin/config.json`;
the switch is re-read on every event, so the change applies immediately. Recording is
fail-open, meaning a logging error never interferes with the command you ran.

The log is the smaller of the two things installing Marvin turns on. The other is that
Marvin can block a shell command: two `PreToolUse` hooks arrive with the plugin, armed with
no enablement step, and refuse a gate-skipping commit, a destructive push at a protected
branch, or a commit carrying a credential-shaped string. The [`hooks`](#hooks) section above
states what they block and the two ways to turn them off.

### Reading the surface back

This repository ships a contributor script that answers the log's other question: which
declared commands has a project never invoked.

```shell
npm run usage:surface                                    # read <project>/.marvin/usage
MARVIN_USAGE_DIR=/path/to/.marvin/usage npm run usage:surface
```

It is a report, not a gate, and exits 0 in every case, including when no log exists. It
resolves the directory exactly as the server does, from `MARVIN_USAGE_DIR` or
`CLAUDE_PROJECT_DIR`, and reads both `events.jsonl` and the rotated `events.jsonl.1`,
because a project that has crossed the size cap keeps half its history in the second file.
Prompts and tools are reported as separate axes: four names — `help`, `lessons`,
`dashboard`, `reports` — exist in both namespaces, so a merged count would credit a prompt
invocation to a tool that has never run.

Read the result as observation rather than usage. A never-invoked name has no age, so the
report leads with the observation window and gives distinct calendar days per name
alongside the call count: fifty commands invoked once each within one second is a sweep,
not adoption. Two logs exist in this checkout, and the report names the one it read —
`<repo>/.marvin/usage/` by default, with a second at
`plugins/marvin/mcp/server/.marvin/usage/` written by test runs whose working directory is
the server package. Logs recorded before `scripts/smoke-commands.mjs` was given a scrubbed
environment also carry that script's own registry-wide sweeps, one per run.

## Committing `.marvin/` or ignoring it

Whether to version the `.marvin/` directory depends on how you use each part of it.

- **Commit it for a team.** For a shared board, commit `.marvin/track/` and `.marvin/config.json` together so the tasks and their status vocabulary travel with the repository. Specs in `.marvin/task/` and lessons in `.marvin/memory/` are likewise team assets worth committing.
- **Ignore the point-in-time artifacts.** Security reports in `.marvin/security/` and session handoffs in `.marvin/handoff/` are moments in time that most teams gitignore.
- **Leave the usage log alone.** `.marvin/usage/` ignores itself, so it stays local regardless.

Keep the board and its configuration together. Whichever location holds `.marvin/track/`
should also hold `.marvin/config.json`, because task files store status keys that only
parse against the matching `statuses` configuration.

## External MCP servers

Alongside its own server, the plugin registers two external MCP servers in `.mcp.json`.
The first is `context7`, which looks up current library documentation and runs through
`npx`. The second is `gitmcp`, a remote service for GitHub repository documentation. Both
back the research workflows, and neither is required for the core commands.
