# ADR 0030 — Toolbox dashboard and local usage log

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-07-03                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0007](0007-marvin-working-directory.md) (`.marvin/` layout), [ADR-0021](0021-lessons-feedback-loop.md) / [ADR-0028](0028-lessons-hygiene-and-recall-expansion.md) (lessons store + stats), [ADR-0024](0024-mcp-apps-widget-architecture.md) (data-first staging, shared contracts), [ADR-0026](0026-configurable-status-model.md) (per-key counts doctrine, fail-closed config), [ADR-0027](0027-tool-backed-adr-lifecycle.md) (corpus parser), [ADR-0029](0029-refactoring-command-family.md) (findings registers), `docs/proposals/toolbox-expansion.md` (D4, WP6–WP7) |

## Context

The toolbox has grown into six command groups whose artifacts spread across the whole
`.marvin/` working directory (ADR-0007) plus the ADR corpus: task specs and the current
`verification.md`, security reports, refactoring findings registers and step plans
(ADR-0029), the kanban board, the lessons store (ADR-0021/0028), and session handoffs.
No single surface shows that state. The `help` tool renders the board counters and the
command index, and its `structuredContent` already carries the ADR-0024 stage-1
`DashboardState` (paths, config, kanban counts, git availability, flat artifact counts) —
but corpus-by-status breakdowns, report ages, lessons statistics, and the refactor
inventory are reachable only tool-by-tool, and several only as prose.

Two more facts shape the decision:

1. **The widget data layer is one contract short.** ADR-0024 staged the MCP Apps widget
   family *data first*: every widget's payload schema ships and is emitted as
   `structuredContent` before any UI exists. The marvin infrastructure dashboard is the
   last widget whose contract is still the narrow `help` subset.
2. **There is no usage signal at all.** Nothing records which commands a project
   actually invokes, so "which of the 50-odd commands does this team touch?" — the
   question that should drive pruning and polish — is unanswerable, and the dashboard
   would have nothing to render even if it asked.

## Decision

**One deterministic `dashboard` tool aggregates the whole toolbox state, and the usage
signal comes from a local, self-ignoring JSONL log written by a server middleware hook.**
The tool half ships now (WP6); the log half is specified here and implemented by WP7
against this record.

### Dashboard

1. **A `dashboard` MCP tool** aggregates: kanban / config / git state (the `help`
   computation, factored into a shared module rather than duplicated), artifact
   inventories with freshness (`.marvin/task/` specs plus `verification.md` age,
   `.marvin/security/` reports plus newest-report age, `.marvin/refactor/` registers
   counted by kind — audit / smells / plan, `.marvin/handoff/` docs), lessons statistics
   (the ADR-0028 `stats` computation), the ADR corpus by status (the ADR-0027 parser,
   honoring its host-adaptive directory resolution), and a usage summary when a log
   exists. Surfaced as `/marvin:dashboard`, an inline thin tool wrapper. `help` keeps the
   command index and board counters; `dashboard` is the whole-toolbox report.
2. **Text and data together** (ADR-0024 progressive enhancement): a sectioned terminal
   report in the `help` tool's rendering voice, plus `structuredContent` conforming to an
   **extended `DashboardState`** — new sections `adr` (per-status counts, reusing
   `AdrStatus`), `security` (report count + newest age), `refactor` (counts by kind),
   `lessons` (the shared `LessonsStats`), `usage`, and `verification` freshness under
   `artifacts`. Every addition is an **optional field**, so the `help` tool's existing
   narrower payload still conforms — the extension is not a schema break. This completes
   the ADR-0024 stage-1 data layer: the future widget consumes this same contract.
3. **Zero-state degradation.** Missing directories are zeros, a missing corpus is an
   empty corpus, an absent log means the usage section reports no data. Every section
   renders sensibly on a fresh project — the dashboard is safe to run as the first
   marvin command ever invoked.

### Usage log (implemented by WP7)

4. **One JSONL event per invocation.** `runPackServer` gains a middleware hook that
   appends one event — `ts` (ISO timestamp), `kind` (`prompt` | `tool`), `name` — per
   prompt-get and per tool-call to `.marvin/usage/events.jsonl`.
5. **The directory is self-ignoring.** marvin writes `.marvin/usage/.gitignore`
   containing `*`, so per-machine noise never reaches the repo regardless of whether the
   host commits the rest of `.marvin/`. The log is strictly local and never transmitted —
   the only reader is the local dashboard.
6. **Size cap and rotation.** The log is capped; on overflow it rotates so the file
   never grows unbounded.
7. **Kill-switch, fail-open.** `usage: { enabled: false }` in `.marvin/config.json`
   (read through the same fail-closed config path as the other tool-owned blocks,
   ADR-0026) turns logging off; absent config means enabled. Logger failures — unwritable
   directory, full disk, malformed config — must never break the prompt or tool call
   being logged.
8. **The dashboard parses the log defensively**: malformed lines are skipped, an absent
   or empty log renders the zero state. The reader ships in WP6 before the writer exists,
   so the format contract above is what WP7 must satisfy.

### Alternatives considered

- **A committed usage log** (team-shared, like the lessons store) — rejected: every
  invocation would dirty the working tree, pollute PRs, and generate merge churn between
  any two concurrent sessions. Usage is per-machine telemetry, not a team artifact.
- **A global `~/.marvin` usage store** — rejected: the dashboard is per-project and reads
  local state; a global store would need per-project keying and lifecycle syncing to
  answer "what does *this* project use", for no benefit over a local file.
- **Extending `help` instead of adding a tool** — rejected: `help` is the command index
  and board dashboard, called casually and often; folding every artifact inventory and
  corpus parse into each render bloats it, and the two reports answer different
  questions ("what can I run?" vs "what state is the toolbox in?").

## Consequences

- The ADR-0024 widget data layer is **complete**: the extended `DashboardState` is the
  last stage-1 contract, emitted and verifiable through the text path with no widget
  built. The widget stage consumes these contracts unchanged.
- Backward compatible by construction: every new contract section is optional, and the
  `help` tool keeps emitting its narrower payload untouched.
- The usage half lands in WP7. Until then the dashboard's usage section honestly reports
  that no data exists yet — an acceptable, visible gap rather than a blocked report.
- `.marvin/usage/` joins the ADR-0007 working-directory tables when WP7 lands the
  writer, together with a docs privacy note (local-only, self-ignored, how to disable).
- The dashboard reads the whole `.marvin/` tree plus the ADR corpus on every call —
  acceptable: all reads are directory listings and small-file parses, and the tool is
  invoked deliberately, not in any hot path.
