# ADR 0043 — Task workflow metrics are a committed per-task series, derived at delivery

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed** |
| Date          | 2026-09-03 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0007](0007-marvin-working-directory.md) (the `.marvin/` service-file convention this amends with a seventh committed-or-not directory, `.marvin/metrics/`), [ADR-0021](0021-lessons-feedback-loop.md) (the committed-record argument reused here), [ADR-0035](0035-evidence-provenance.md) and [ADR-0036](0036-oracle-execution-and-red-green.md) (the two `runs/` siblings the new journal joins), [ADR-0037](0037-spec-corpus-mechanics.md) (the corpus mechanics and the progress journal this draws a boundary with), [ADR-0039](0039-critique-receipts.md) (the receipts the roll-up reads, and the amendment convention this record follows), [ADR-0042](0042-bounded-critique-and-serialised-review.md) (the one-off measurement this turns into a series), `docs/proposals/task-metrics.md` (the proposal), `docs/proposals/task-metrics-implementation-plan.md` (the plan) |

## Context

ADR-0042 reversed a shipped design decision on the strength of one measurement: an instrumented run
of a single feature task, reconstructed by hand from a session transcript, showed 67% of the wall
clock inside the two critic agents. The finding paid for itself, and it cannot be repeated cheaply,
compared against the next run, or checked a month later. Its record ends with the sentence "Marvin
still cannot see this."

The quality half has no measurement at all. `docs/proposals/task-workflow-latency-optimization.md`
asserts that quality "is already satisfactory in real-task testing" and changes the pipeline on that
basis. No artifact in the repository can confirm the assertion, and no later change can be checked
against it.

Most of what a series would need is already written to disk, in typed blocks: the spec's sealed
contract and frontmatter flags, the progress journal's timestamped steps, the oracle journal's
per-criterion runs with their resolution rung, the `verify-result` block's per-gate outcomes and
durations, and the critique receipt's two axes with their blocker and warning counts. Three things
are missing, and each has a different cause:

1. **One record is destroyed by design.** Every verification run overwrites `runs/<slug>.md`, so
   only the final attempt survives. How many attempts preceded it, and how long the first green one
   took, cannot be recovered from anything on disk. The delivery gate (`verify action: "gate"`)
   persists nothing at all, so the freshness waivers it grants through `allowStale` have no source
   either.
2. **The volatile counters live only in the session.** Fix-cycle rounds, SPEC GAPs, items deferred
   or blocked at a loop's budget, critic passes and their dispatch-to-verdict time exist in
   `TodoWrite` and in the model's context, both of which compaction destroys. This is the problem
   the progress journal was built to solve, and it needs the same answer.
3. **Recording is optional.** `verify` writes a per-spec run only when the caller passes `specSlug`,
   and the skill prose asks for it rather than requiring it. Measured against this repository's own
   corpus — 35 specs, 33 shipped — there is one progress journal, six oracle journals, one
   verification run and two receipts. Metrics computed today would be almost empty, and the 33
   delivered specs stay unmeasured whatever is decided here.

The proposal settles what is measured (time, quality, and the rework that sits across both) and
argues for committing the series. This record fixes the artifacts, their boundaries, and the one
behavioural change the pipeline makes to close the third gap.

## Decision

### 1. `.marvin/metrics/` is committed, one record per spec, named after the spec's own file

Metrics live in a new `.marvin/metrics/` directory, a sibling of the per-group directories ADR-0007
established, and **outside** `.marvin/task/`, where three non-recursive enumerators would read any
new Markdown file as a spec. The `.gitignore` negation `!.marvin/metrics/` landed with the proposal
(#199), before any writer existed, so the first record is committable on the day it is written.

The argument for committing is ADR-0021's: a record of this kind earns its value by accumulating,
so it has to reach a clone. The pipeline runs in a worktree that is removed once the branch merges,
and a lesson was once hand-rescued from exactly that sequence. Committing also means the record for
a task arrives on `dev` in the same pull request as the task, so the series grows precisely when
work is accepted. One file per task never conflicts on merge, which a single `metrics.jsonl` would
on every pair of parallel branches.

The record reuses the spec's basename: `.marvin/metrics/<NNN>-<slug>.md` for a numbered spec, and
`<slug>.md` for a spec that lives unnumbered in a host directory. Nothing is allocated, the record
and its spec share a name, and both directions of the join are a filename lookup. This departs from
the creation-order numbering `.marvin/critique/` uses: that scheme needs a directory scan before the
first append and can mint the same number on two parallel branches, and a record written against a
draft at intake would otherwise be numbered before its spec is.

### 2. A record holds live `metric-event` blocks and one terminal `task-metrics` block, and the last terminal block is authoritative

Two block tags, chosen to differ by more than one letter. A ` ```json metric-event ` block is
appended **during** the run for exactly the information that is otherwise lost — a fix-cycle round
and which loop spent it, a SPEC GAP, an item deferred or blocked at a budget, a critic dispatch and
the verdict that answers it with its pass number, a Definition-of-Ready gate call and its verdict.
A ` ```json task-metrics ` block is **derived at delivery** — in `task-deliver`, after the delivery
gate allows and before the commit, so it ships in the same commit as the work — from the artifacts
already on disk: the spec, the progress journal, the oracle journal, the verification-run journal,
the `verify-result` block, the receipts and git. Nothing derivable is copied, because a copy can
only ever disagree with its source.

The terminal block records which sources were present. Every metric field is nullable, and null
means the source was absent, never zero: a task that ran with no per-spec verification appears in
the series as a measured gap rather than a silent absence, and a record with no events reports the
event-sourced counters as null, because a session that recorded nothing is indistinguishable from
one with nothing to record.

The file is append-only. A delivery that was blocked and retried appends a second terminal block;
readers take the last one and the roll-up notes the count. The writer is one `metrics` tool with
three actions — `record`, `rollup`, `series` — with a `.strict()` input like `spec` and `report`, so
a mistyped key is an error rather than a successful-looking call that recorded nothing. One owner
per directory is the pattern `lessons` and `handoff` already follow; a `metric` action on `spec`
would put a second journal into a 2,000-line tool and blur the boundary in item 4.

### 3. `.marvin/task/runs/<slug>.verify.md` is the third `runs/` sibling, append-only, and records both runs and gate decisions

The verification-run journal closes the first gap. It follows `storage/progress.ts` in shape — one
tag, `verify-run`, a fence regex derived from it, one zod schema, an append that never reads the
file back, a read that drops an unparseable block rather than the file — and it holds two entry
kinds under that one tag, discriminated on `kind`:

- `run`, appended by `verify` immediately after it writes the per-spec run file, carrying the
  verdict, the mode and execution, the `only` subset or null, every gate's status and duration, the
  wall-clock and summed-gate durations and the `head_sha` the run proved. `only` is recorded on
  purpose: the fix-cycle protocol re-runs one gate at a time, and "runs before the first green
  **full** run" is decidable only if a targeted retry is distinguishable from a full pass.
- `gate`, appended by `action: "gate"` on **every** decision for a resolved slug — a BLOCK for a
  missing artifact is a decision worth counting too — carrying the decision, the verdict read, the
  staleness, `allowStale`, `red_green` and the artifact judged. The `verify-result` block never
  carries `allowStale`, so without this entry the freshness-waiver metric has no source.

Both writes are **fail-open**: a journal write that throws is swallowed, so the journal can never
change a verdict or a decision. The full artifact `runs/<slug>.md` stays the latest run, so the
delivery gate is unchanged. The journal lives under `runs/` for the same structural reason its two
siblings do: a subdirectory is invisible to the top-level enumerators by construction rather than
by an exclusion list.

### 4. The boundary with the progress journal: position and prose there, typed counters here, timestamps read rather than copied

Two journals beside each other converge into one unless the division is stated. The progress
journal answers **where the work stopped**: it carries free-form prose in `detail`, and its reader is
a human or a session resuming after an interruption. The metrics record answers **what the work
cost**: it carries typed counters, and its reader is the aggregator. The metrics record never copies
a timestamp from the progress journal; the roll-up reads the phase boundaries from there when it is
computed, so the two cannot disagree about when a step happened. The one rule they share is the
progress journal's: `detail`, where present, is one line and never a credential, a token or a
customer datum, because in a host layout that keeps specs in a tracked directory both journals are
tracked with them.

### 5. Metrics are not a report group; the reading surface is the `series` action and one dashboard line

`ReportGroup` is a closed enumeration of five values, and `test/report-groups.test.mjs` derives the
set from the contract and asserts it against every code enumeration and twelve pinned prose sites.
A sixth value costs those twelve edits and a standing obligation, and buys nothing: a metrics record
is a data series, not a document of findings, and the precedent for a `.marvin/` directory that the
viewer never lists already exists in `.marvin/report/`. The series is read through
`metrics action: "series"`, surfaced as `/marvin:task-metrics`, which aggregates every record into
the three groups with a count, a median and a maximum per metric over the records where the field
is present, and reports coverage — how many shipped specs have a record — which is the number that
says whether the series can be trusted yet. `dashboard` gains one line from the same data.

### 6. A pipeline verification run that names no spec warns

The third gap is closed narrowly. A `verify` run in `feature` or `bug` mode with no `specSlug`
records a warning stating that no per-spec run was written, that the delivery gate will judge the
global artifact, and that the metrics series will not see this run. Warnings already degrade PASS to
PASS WITH WARNINGS, and `task-deliver` already surfaces that verdict for confirmation, so the gap
reaches the user at the moment it happens and no other surface changes. A `standalone` run keeps no
warning: it legitimately has no spec. The `task-verify` skill passes `mode` on every chained run, so
the pipeline path is covered, and a run that passes no `mode` at all defaults to `standalone`.

## Consequences

- **The series begins with the first task delivered after the writer lands, and the 33 delivered
  specs stay unmeasured.** Retroactive analysis is not available and is not attempted. Landing the
  verification-run journal first (this record, WP4) means the time-to-green and runs-before-green
  metrics exist from the first record instead of being absent for the head of the series.
- **The live events are only as reliable as the prose that writes them.** A skill that forgets a
  `record` call loses that counter silently. The terminal block's `sources` map and the coverage
  line make the gap visible, and the trade is accepted: the alternative — moving every event
  tool-side — would put a metrics call inside the DoR gate, the seal check and the receipt writer,
  which is a second telemetry system beside the one that exists. If a later measurement shows the
  events are routinely missing, the two a tool already witnesses (the DoR verdict, the receipt) can
  move tool-side as a follow-up.
- **A host project that ignores `.marvin/` wholesale never commits its series.** The `rollup`
  answer reports whether git ignores the record, and `docs/configuration.md` states the negation to
  add and asks the host to keep Markdown out of its formatter, so a committed record is never
  reflowed and re-hashed.
- **`action: "gate"` now writes on every delivery-gate call for a slug.** Tests call the gate often;
  every one runs against a temporary project root, the write is fail-open, and a read-only or
  absent directory cannot change a decision. `test/critique-protocol.test.mjs`'s byte-identity
  assertion over the gate's output stays green, because the journal is written beside the answer
  and never into it.
- **A previously clean pipeline run can now be PASS WITH WARNINGS.** That is the intent of item 6:
  the warning names the missing slug and what it costs, and `task-deliver` asks for confirmation
  rather than refusing. A standalone run is untouched.
- **The tool count moves from 13 to 14 and the prompt count from 55 to 56**, across the pinned
  documentation sites the plan enumerates. Only the site catalog test guards them.
- **ADR-0007's table is not edited.** An accepted record's content stays immutable; this record
  declares itself an amendment through its Related row, exactly as ADR-0039 did when it added
  `.marvin/critique/`.

## Alternatives considered

- **A single append-only series file** (`metrics.jsonl`, the `.marvin/usage/` shape). Rejected for
  one reason: the usage log is never versioned and this record is. Two branches that each append a
  line to the same file conflict on merge, and parallel branches are routine here.
- **Keep the series local.** Defensible, and it narrows what the series can answer to one machine
  and whichever worktrees remain open; the outcome metrics lose their meaning entirely.
- **A `metric` action on the `spec` tool.** It would put the second journal into the tool that owns
  the first and blur the boundary item 4 draws. One owner per directory is the house pattern.
- **A sixth report group.** Twelve pinned prose sites and a machine-checked enumeration, for a data
  series the viewer would render as a document with nothing to say.
- **Number the records in creation order, as the receipts are.** Consistency with
  `.marvin/critique/` was the argument for it; the scan-before-append, the parallel-branch
  collision and the draft-before-spec ordering were the arguments against. The proposal's scheme
  stays available if the owner prefers consistency.
- **Store the review-fix commit count and the escaped-defect join in the record.** Both change after
  delivery — the first with every review round, the second as later specs ship — so a stored value
  would go stale. They are computed by `series` at query time and never stored.
- **Instrument the usage log instead.** ADR-0030's log records `{ts, kind, name}` per MCP call and
  deliberately nothing else; it sees no skill step, no agent dispatch, no verdict and no duration,
  and widening it would make a local, self-ignoring telemetry file carry the record this ADR argues
  must reach a clone.
