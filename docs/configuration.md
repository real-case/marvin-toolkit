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
| `.marvin/metrics/` | The `metrics` tool | One task-metrics record per spec, named after the spec file: live events appended during the run and a terminal block derived at delivery. Read back by `/marvin:task-metrics` and the dashboard's Metrics section. Meant to be committed — see [Committing `.marvin/` or ignoring it](#committing-marvin-or-ignoring-it). |
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
`/marvin:dashboard` rather than failing. The two autopilot subtrees, `gates.extra` and
`pipeline`, are the exception: a mistake inside one of them resets that subtree alone and
leaves the rest of the file in force (see [`pipeline`](#pipeline)).

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
    "build": "npm run build",
    "extra": [{ "name": "css-types", "command": "npm run css-types:check" }]
  },
  "pipeline": {
    "bootstrap": "npm ci --prefer-offline",
    "lockfile": "package-lock.json",
    "stall_minutes": 15,
    "allowed_commands": ["git", "gh pr create", "npm run", "npx --no"]
  },
  "statuses": [
    { "key": "backlog", "role": "todo" },
    { "key": "in-progress", "role": "wip", "tracker_status": "In Progress" },
    { "key": "code-review", "role": "review", "tracker_status": "In Review" },
    { "key": "done", "role": "done", "tracker_status": "Done" },
    { "key": "blocked", "role": "blocked" }
  ],
  "scope": { "exempt": [".claude/agent-memory/**", "**/*.d.mts", "bun.lock"] },
  "merge_obligations": ["a CHANGELOG entry for every user-visible change"],
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

Those four *gate* keys are the complete set that detection and overrides know about. A key Marvin
does not recognise, whether a typo such as `tests` or an invented `audit`, is stripped when the
config loads, and the gate it was meant to configure falls back to detection with no error
reported anywhere. A project's own gates have exactly one home, `extra`, described next. [ADR-0009](./adr/0009-config-first-gate-resolution.md) records that
as an accepted trade-off. The effective set stays inspectable: the report's `Stacks:` line
names `.marvin/config.json` whenever an override applied, and the dry-run plan (`verify` with
`dryRun: true`) lists the exact command resolved for each gate. The dry run is the one that
catches a stripped key in a config where other keys did apply, because the `Stacks:` marker
appears as soon as any single key survives.

#### `gates.extra`

This is a list of project gates that `verify` runs **after** the four standard ones. It is an
optional array of `{ "name", "command" }` objects and defaults to `[]`; the shape is for checks
that are not a stack's test, lint, type-check or build, such as `npm run css-types:check` or a
format check that only reads.

```json
{
  "gates": {
    "extra": [
      { "name": "css-types", "command": "npm run css-types:check" },
      { "name": "format", "command": "npm run format:check" }
    ]
  }
}
```

- A `name` starts with a letter or digit and uses only letters, digits, `_`, `.` and `-`. It may
  not be one of `test`, `lint`, `typecheck` or `build`, and may not start with `prepare:` or
  `oracle:`, which the pipeline's gate stage keeps for its own entries. Names are unique, and
  compared case-insensitively. The `command` is a non-empty shell command.
- The standard gates run as the `execution` mode says; the extras then run one at a time, in the
  order written. Under `parallel` and `sequential` every extra runs even after a failure; under
  `fail-fast` the run stops at the first failure, extras included. Each extra gets its own
  `<name> Results` section in `verification.md` and its own row in the verdict, and a failing one
  fails the run.
- The extras are not detected from the stack, and a call that names its own gates leaves them out:
  `only` and an explicit `gates` list run exactly what they name. The dry-run plan lists them after
  the four standard gates.
- A `gates.extra` the schema rejects is dropped on its own, with the reason shown by
  `/marvin:track-config`, `/marvin:dashboard` and as a `verify` warning, so a gate never vanishes
  silently. Everything else in the file stays in force.

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

### `merge_obligations`

This is what the project needs before a pull request can merge beyond its gates: a version
bump, a committed build artefact, a changelog entry. It is an optional list of strings. Until
[ADR-0046](./adr/0046-lean-spec-shape.md) every spec rewrote it into a `host-bindings` block;
now `/marvin:task-start` proposes it once per project, together with any missing `spec.dir`,
`adr.dir`, `gates` or `gates.test_one`, writes it only after you confirm, and turns each
obligation that touches a file into a row of the spec's contract.

```json
{ "merge_obligations": ["npm run sync-version", "commit the rebuilt dist/server.js"] }
```

### `scope`

This holds the by-product exemptions for a task's scope, read by the `spec` tool's scope gate
and by the task-metrics roll-up. It is an optional object with one optional field, `exempt`, a
list of path patterns. When it is absent nothing is exempt: marvin ships no defaults, so the
scope gate of a project only widens by that project's own decision
([ADR-0045](./adr/0045-scope-byproduct-exemptions.md)).

A spec's `files` list is the allowlist for a task's changes, and the scope gate fails on any
changed file outside it. Some files change as a by-product of doing the task rather than as
part of it, and no spec author can plan them: a reviewer subagent writing notes into its own
`.claude/agent-memory/` directory, a lock file rewritten when an allowed dependency is added, a
hand-written `.d.mts` sidecar the project requires beside every module a typed test imports.
Without an exemption each of them is a SPEC GAP recorded by hand and an `undeclared` path in the
task's metrics. A changed file that matches a pattern here is not a violation. The gate still
names it, with the pattern that matched, and the task's metrics record list it under
`scope_drift.exempt` instead of `undeclared`. A file the contract declares is always counted as
declared, even when a pattern would match it too.

The pattern grammar is deliberately small:

| Pattern | Matches |
|---------|---------|
| `**` as a whole segment | zero or more directories: `**/*.d.mts` matches `x.d.mts` and `scripts/x.d.mts` |
| `*` | any characters within one segment, including a leading dot |
| `?` | exactly one character within a segment |
| a trailing `/` | everything under that directory: `.claude/agent-memory/` equals `.claude/agent-memory/**` |
| anything else | itself, literally; there are no character classes, braces or negation |

Every pattern is matched against the whole project-relative path, so `bun.lock` is the lock
file at the root and `**/bun.lock` is every lock file in the tree. Unlike `.gitignore`, a slash
does not change where a pattern applies. A pattern that is empty, absolute, contains a
backslash or a `.`/`..` segment, starts with `!`, or consists only of wildcards (which would
exempt every file) is ignored. `/marvin:track-config` refuses to write one, and one edited into
the file by hand is reported by `/marvin:track-config`, `/marvin:dashboard`, and the scope gate
itself.

`/marvin:track-config` sets the list with `scope_exempt`, a JSON array of patterns that replaces
the whole list; an empty string removes it. `.marvin/` is never part of a task's scope, whatever
this list says, so a harness kept under `.marvin/task/runs/` needs no entry.

### `pipeline`

This holds the settings of the autopilot pipeline (`marvin-pipe`). It is an optional object, and
every key has a default, so an absent block means all of them. The pipeline reads it from the
base commit's `.marvin/config.json`, never from a run's worktree.

| Key | Default | Purpose |
|-----|---------|---------|
| `branch_template` | `feature/{tracker}--{slug}` | The name of a run's branch. `{tracker}` is the spec's tracker id, or `tracker_default` when it names none; `{slug}` is the spec's slug. |
| `tracker_default` | `TBD` | The tracker id used in the branch name when the spec has none. |
| `bootstrap` | `null` | A command run once in a fresh run worktree before any child starts, such as `npm ci --prefer-offline`. `null` runs nothing. |
| `lockfile` | `null` | The lockfile `bootstrap` installs from, such as `package-lock.json`. |
| `github.token_command` | `null` | A command that prints the GitHub token for the pipeline's `gh` calls, such as `gh auth token --user <login>`. `null` uses `gh`'s own authentication. |
| `stall_minutes` | `15` | Minutes without output from a child before it counts as stalled. |
| `no_ci_minutes` | `10` | Minutes after a push with no CI run appearing before the pipeline concludes the branch has no CI. |
| `gate_timeout_minutes` | `20` | Minutes one gate command may run before it is killed. |
| `ci_poll_seconds` | `60` | Seconds between CI status checks. |
| `test_path_pattern` | `(^\|/)(__tests__/\|[^/]+\.(test\|spec)\.[cm]?[jt]sx?$)` | A JavaScript regular expression over repo-relative paths: which files are tests. The test-author may write only these. |
| `scope_exempt_pattern` | `null` | A JavaScript regular expression over repo-relative paths that the pipeline's scope check tolerates as by-products of a task. `null` exempts nothing. |
| `format_command` | `null` | A formatter run over the files the pipeline itself writes, with each path appended. |
| `conventions` | `""` | Project conventions, as prose, handed to the verifier. |
| `allowed_commands` | `["git", "gh pr create", "gh pr view", "gh pr edit", "npm run", "npm ci", "npx --no"]` | The command prefixes the writing roles (planner, test-author, executor) may run in Bash. `npx --no` runs a tool that is already installed and never downloads one. |

Two things differ from the rest of the file. The two pattern keys are regular expressions, not
the globs of [`scope.exempt`](#scope), and a pattern that does not compile is refused when the
config loads. Each `allowed_commands` entry must be a usable prefix: no `(`, `)`, `,`, `[` or `*`,
no newline, and no leading or trailing space.

A value the schema rejects, or an invalid `gates.extra`, resets **that subtree alone** to its
default. The rest of the config is untouched and every other tool keeps working; the issue is
named by `/marvin:track-config` and `/marvin:dashboard`. The pipeline fails closed instead: it
refuses to start until the subtree is fixed, because running with defaults the project did not
choose could do the wrong thing.

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
| `MARVIN_METRICS_DIR` | `.marvin/metrics` | The task-metrics records, one per spec. |
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
detect the commands for you. Checks beyond the four go in [`gates.extra`](#gatesextra), which
`verify` runs after the standard gates.

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

**Every substituted value reaches the shell as literal text.** Write the placeholders unquoted:
`"npx vitest run {file} -t {name}"`. Marvin single-quotes each value it substitutes, so a path
such as `src/app/(dashboard)/[id]/page.test.tsx`, a space, a `$` or a single quote stays one
argument. A placeholder you have already quoted is escaped for that quote instead of being quoted
again, so templates written before marvin quoted keep working: `"pytest -k '{name}'"` and
`"vitest run \"{file}\""` produce the same arguments as their unquoted forms. Before any of
this, a ref carrying a shell metacharacter (`;`, `|`, `&`, a backtick, `$(`, a redirection, a
newline) is refused rather than substituted: the run records `not-run` with the reason
`unsafe-ref` and no child process is started.

The [autopilot pipeline](#pipeline)'s seal stage reads the same template to run one whole
test file, so it accepts a narrower form: `{file}` only, unquoted. It refuses `{name}` and
`{ref}`, because it runs every test in the file, and a quoted `{file}`. A template that serves
both is `"npx vitest run {file}"`; one that adds `-t {name}` serves `verify` and the oracles
but not the seal stage.

`test_one` is **not a gate**. It is never scheduled, its exit code never enters a verdict, and it
never appears in `verification.md`. Only `verify`'s `action: "oracles"` and the autopilot
pipeline read it.

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
- **Commit the metrics series.** `.marvin/metrics/` holds one record per delivered task and earns its value by accumulating, so it has to reach a clone; the pipeline runs in a worktree that is removed once the branch merges, and an ignored record disappears with it. Negate it after the blanket exclusion, and mind the pattern: `.marvin/*` followed by `!.marvin/metrics/`. A blanket `.marvin/` does not work — git does not descend into an excluded directory, so a negation beneath it is unreachable and silently does nothing. Keep Markdown out of your formatter as well (`**/*.md` in `.prettierignore`): a reflowed record is a rewritten record. The `rollup` answer reports the record as ignored until the negation is in place.

Keep the board and its configuration together. Whichever location holds `.marvin/track/`
should also hold `.marvin/config.json`, because task files store status keys that only
parse against the matching `statuses` configuration.

## External MCP servers

Alongside its own server, the plugin registers two external MCP servers in `.mcp.json`.
The first is `context7`, which looks up current library documentation and runs through
`npx`. The second is `gitmcp`, a remote service for GitHub repository documentation. Both
back the research workflows, and neither is required for the core commands.
