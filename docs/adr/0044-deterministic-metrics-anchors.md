# ADR 0044 — The metrics record is written by two gates, not by prose

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed** |
| Date          | 2026-09-04 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0043](0043-task-workflow-metrics.md) (the series this narrows — its writer invariant and its "events are only as reliable as the prose" consequence), [ADR-0035](0035-evidence-provenance.md) (the delivery gate whose decision now carries the write), [ADR-0039](0039-critique-receipts.md) (the amendment convention this record follows, as ADR-0041 followed it for ADR-0024), [ADR-0003](0003-tool-backed-dor.md) (the seal gate this attaches to) |

## Context

ADR-0043 put the task-metrics series under `.marvin/metrics/`, one record per spec, and made the
`metrics` tool its writer. Every call to that writer is an instruction in a SKILL.md: `task-start`
records the DoR gate calls and the critic dispatches, `task-implement` records the fix rounds and the
spec gaps, `task-deliver` rolls the terminal block up at step 1.5. The record file itself is created
lazily, on the first append.

That design was accepted with its risk stated: *"The live events are only as reliable as the prose
that writes them. A skill that forgets a `record` call loses that counter silently."* The same
sentence closed with the exit — *"the two a tool already witnesses (the DoR verdict, the receipt) can
move tool-side as a follow-up."*

What the sentence understates is the failure's shape. A missing event loses **one counter**. A
delivery that never issues the roll-up loses **the whole record**, because nothing else creates it;
and a task abandoned between intake and delivery leaves no trace at all, so the series cannot
distinguish "no task ran" from "a task ran and was dropped". Coverage — the number that says whether
the series can be trusted — is measured against the shipped corpus, and it degrades silently in
exactly the case where a reader would most want to know.

Two points in the pipeline are not prose. `spec action: "seal"` is the mandatory pre-execution gate
of `/marvin:task-implement`, and `verify action: "gate"` is the mandatory pre-delivery gate of
`/marvin:task-deliver`. Both are deterministic code, both already resolve the spec, and one of them
already performs a fail-open side-write of exactly this kind — the verification-run journal of
ADR-0043 §3.

## Decision

### 1. The seal gate creates the record; the delivery gate writes the terminal block on ALLOW

Two anchors, each at a gate the pipeline must call:

- **`spec action: "seal"`** creates `.marvin/metrics/<NNN>-<slug>.md` with its header and nothing
  else. A run that reaches execution therefore has a record before it has anything to put in it, and
  a run abandoned afterwards is visible in the series rather than absent from it.
- **`verify action: "gate"`** derives the terminal ` ```json task-metrics ` block and appends it —
  **only on ALLOW**, and only for a slug that resolves. A BLOCK is not a delivery: `rolled_up` is
  what coverage reads as tasks shipped, so writing a block for a refused attempt would make that
  number overstate what was delivered. Refusals stay visible in the verification-run journal, which
  already records every gate decision.

`/marvin:task-deliver` step 1.5 stops writing and becomes a relay: it reads the record back and
reports the digest. `marvin-tm-executor` §5.0 **keeps** its own roll-up call, because that agent
never calls the delivery gate — it runs `verify` in `mode: feature` and opens its own pull request —
so it is the only writer of a headless run's terminal block. The asymmetry is deliberate and is
asserted, so a later edit that tidies the two into agreement goes red instead of silently leaving
every headless task unmeasured.

### 2. The seal write is conditioned four ways, and each condition is a defect it would otherwise have

1. **The spec was read from disk.** `specContent` and `specPath` may legally arrive together, and the
   inline fragment then wins while the path stays truthy; a guard written on the *supplied* input
   would name a record after a file it never opened.
2. **A slug resolves** — frontmatter first, else the filename with `.md` and any `NNN-` prefix
   stripped.
3. **That slug is kebab-case.** The slug becomes a filename, so this fails closed exactly as the
   `metrics` tool does before joining a path. It also makes the step-1.5 skeleton unreachable rather
   than merely forbidden by prose: an unfilled template still carries `{kebab-case-slug}`.
4. **The verdict is not FAIL.** A `shipped` or `superseded` spec, or a tampered contract, is work
   that is over; a record for one would fill the series' `empty` bucket with its opposite.

### 3. The one-writer invariant moves from the tool to the storage module

ADR-0043 §2 named the `metrics` tool "the writer" of `.marvin/metrics/`. That is narrowed here: the
writer is `storage/metrics.ts`, reached through one shared module, `lib/metrics-record.ts`, which
owns the rule that decides a record's **filename**. Three callers now reach it — the tool's `rollup`
action and the two gates — and two copies of that rule would give one task two record files that no
reader joins. This is the shape the repository already uses for shared behaviour between tools:
`changedFilesForScope` moved into `lib/git.ts` so the scope gate and the roll-up judge one file set.

The shared module deliberately does **not** own fail-open behaviour. Each caller wraps its own call
in its own `try/catch`, exactly as `journalVerifyEntry` does, so one anchor's failure can never
decide another's and the "a record can never change a verdict" property stays checkable by reading
the few lines around each call site.

### 4. Coverage gains an `empty` bucket, in the series and on the dashboard

A record created at seal and never written to belonged to no bucket: `rolled_up` needs a terminal
block and `events_only` needs at least one event, so it counted in `records` and vanished from the
breakdown. `MetricsSeriesCoverage` and `MetricsSummary` both gain `empty`. On the dashboard it sits
beside the record total for a specific reason: without it a bare count reads as "tasks measured"
while counting files nothing has written to — the opposite of the signal this record exists to make
honest.

### 5. The gate's answer names the record, in the markdown and never in `reason`

`gateResult` serialises `reason` into the ` ```json deliver-gate ` block, and
`test/critique-protocol.test.mjs` pins that block byte-for-byte to prove a critique receipt is never
a veto. The record line is therefore appended to the answer's markdown after the block is composed,
and carries only a path and a boolean — no count, no timestamp — so two consecutive calls produce
identical text even though the second appended a second terminal block. Routing it through `reason`
would look like the obvious implementation and would break the guarantee.

## Consequences

- **Coverage becomes a real measurement rather than a hope.** Every started run has a file and every
  delivery has a terminal block, so `shipped_with_record` now says something about the pipeline
  instead of about whether a session followed prose.
- **The difference between `records` and `rolled_up` becomes meaningful.** It is the count of runs
  that started and did not deliver — a number the series could not previously express at all.
- **A test that seals a spec now writes a file.** Every such test runs against a temporary project
  root, the write is fail-open, and an unwritable directory cannot change a verdict; the five
  refusal paths are asserted directly.
- **The live events stay prose-driven.** This record moves the two writes that lose a whole record,
  not the counters that lose one field. `spec action: "dor"` recording its own gate call is the one
  plausible next anchor; with two anchors an event registry would cost more indirection than it
  saves, and the critic dispatches cannot move at all, since they happen in a Task-tool call rather
  than inside any marvin tool.
- **`marvin-tm-executor` and `task-deliver` now differ on purpose.** Anyone reading them side by side
  will see an inconsistency; the reason is stated in the executor's own §5.0 and asserted in
  `test/metrics-record.test.mjs`.

## Alternatives considered

- **A pipeline-hooks registry** (`onSeal`, `onDeliverAllow`), so future anchors register rather than
  being wired. Rejected: the defect being fixed is that a write was invisible because it lived in
  prose, and hiding it behind an event name reintroduces the same opacity one level down — a reader
  of `verify.ts` would see `onDeliverAllow(...)` and not that a terminal block is appended. It also
  pulls the `try/catch` into the registry, where one handler's throw decides another's fate.
- **Direct calls in both gates with no shared module.** Rejected: it duplicates the filename rule,
  which is precisely the logic that must not diverge.
- **Rolling up on every gate decision, not only ALLOW.** Rejected: it makes `rolled_up` count refused
  attempts, so coverage against the shipped corpus overstates what shipped.
- **Creating the record with a placeholder event instead of a bare header.** Rejected: `events_only`
  means "recorded something real", and a synthetic event would move an abandoned run into it.
- **Leaving the roll-up in prose and adding a warning when it is skipped.** Rejected: the warning
  would have to be issued by the same prose that skipped the call.
