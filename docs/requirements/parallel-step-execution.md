# Requirements: Parallel Execution of Independent Workflow Steps

| Field      | Value                                                                            |
| ---------- | -------------------------------------------------------------------------------- |
| Status     | **Implemented** 2026-06-13 — see `specs/taskmaster-latency-optimization.md`, ADR-0002 |
| Date       | 2026-06-08                                                                       |
| Applies to | taskmaster pipeline — `task-implement`, `task-verify` skills                     |
| Related    | `docs/proposals/task-workflow-latency-optimization.md` (items P1, P2)            |
| Keywords   | **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, **MAY** are to be interpreted as in RFC 2119. |

## 1. Purpose

Reduce the end-to-end wall-clock time of the task workflow by executing **independent**
steps concurrently instead of sequentially — **without changing what is checked or how deeply
the model reasons**. Quality is the primary constraint; speed is an objective pursued only
where it is provably quality-neutral.

## 2. Scope

### In scope

- Concurrent execution of the independent quality gates inside `task-verify`.
- Overlapping the `marvin-tm-diff-critic` review with `task-verify` inside `task-implement`.
- A general rule for identifying and parallelizing independent steps across the pipeline.

### Out of scope

- The clarifying-question dialogue in `task-start` — human-bound; it remains one question at a
  time for focus (see §10).
- Any step that depends on the result of another — dependency chains remain serial along the
  critical path.
- Parallel execution of multiple distinct tasks (covered separately by batch dispatch).
- Reducing model reasoning effort (a separate lever that *does* trade quality).

## 3. Definitions

- **Independent steps** — two steps are independent **iff** neither reads state the other
  writes and neither's inputs depend on the other's outputs. Only independent steps are
  eligible for parallelization.
- **Gate** — an automated quality check (test, lint, type-check, build) whose result
  contributes to a verdict.
- **Merge point** — the moment at which all parallel branches' results are collected, before
  any verdict, gate, or delivery decision is made.

## 4. General requirements

- **R-GEN-1** — The workflow **MUST** execute independent steps concurrently when doing so
  reduces wall-clock time.
- **R-GEN-2** — Parallelization **MUST** be purely structural: the set of checks performed,
  their inputs, and the resulting verdict **MUST** be identical to a sequential execution for
  the same repository state.
- **R-GEN-3** — Steps that are not provably independent **MUST** run sequentially.
- **R-GEN-4** — All parallel branches **MUST** reach a single merge point before any
  verdict / gate / delivery decision. No decision **MAY** be made on a partial result set.

## 5. Specific requirements

### REQ-VERIFY-PAR — Concurrent quality gates (`task-verify`, Step 2)

- **R-V-1** — `task-verify` **MUST** run the independent gates — tests, lint, type-check,
  build — concurrently.
- **R-V-2** — The verification report (`verification.md`) **MUST** contain the result of every
  gate, identical in content to a sequential run.
- **R-V-3** — Failure of one gate **MUST NOT** abort or discard the results of the others; in
  parallel mode every gate runs to completion and every result is recorded.
- **R-V-4** — The aggregate verdict **MUST** be computed only at the merge point, after all
  gates complete.
- **R-V-5** — A sequential / fail-fast mode **MUST** remain available and selectable (for
  resource-constrained environments or fast first-failure feedback).

### REQ-CRITIC-OVERLAP — Overlap diff-critic with verify (`task-implement`, 6F→7F / 9B→10B)

- **R-C-1** — `task-implement` **MUST** launch `task-verify` and the `marvin-tm-diff-critic`
  review concurrently rather than sequentially.
- **R-C-2** — Both results **MUST** be collected at a merge point before the delivery decision
  (`task-deliver`); delivery **MUST NOT** proceed on only one of them.
- **R-C-3** — If `task-verify` fails and triggers a code fix, the `diff-critic` review **MUST**
  be re-run against the updated diff before delivery — its prior result is stale.
- **R-C-4** — The presence, ordering, and blocking semantics of the critic and verify results
  at the delivery gate **MUST** be identical to the sequential design.

### REQ-READS-PAR — Independent reads and analyses

- **R-R-1** — Independent context reads and read-only analyses (e.g. reading multiple files,
  independent greps) **SHOULD** be issued concurrently. This codifies the existing pattern in
  `task-start` §1.3 and `task-implement` Step 3.

## 6. Quality invariants (MUST hold)

- **I-1** — No gate, critic, or check is removed, weakened, or skipped by parallelization.
- **I-2** — For an identical repository state, the parallel run and the sequential run **MUST**
  produce the same verdict and the same captured findings (verdict parity).
- **I-3** — No decision is made on partial results (enforced by the merge point, R-GEN-4).
- **I-4** — Parallelization **MUST NOT** introduce nondeterminism into the verdict. Concurrency
  **MAY** reorder logs/output, but **MUST NOT** change outcomes.

## 7. Failure and retry handling

- **F-1** — A crash or non-zero exit in one branch **MUST** be captured as that branch's result,
  not propagated as a loss of sibling results.
- **F-2** — Retries (per `task-implement` 7F/8B) operate after the merge point. On a gate
  failure the retry **MAY** re-run only the failed gate to confirm the fix, but a full run
  **MUST** be performed as the final confirmation before delivery.
- **F-3** — If concurrent execution is unavailable (tooling or resource limits), the workflow
  **MUST** fall back to sequential execution and still produce a correct verdict.

## 8. Non-functional requirements

- **N-1** — Concurrency **MAY** be bounded by a configurable maximum, to respect machine
  CPU/RAM limits.
- **N-2** — The flow **MUST** remain observable: the workflow **SHOULD** report which steps are
  running concurrently and surface each result as it completes, preserving the interactive
  "show each major step" principle.
- **N-3** — The default mode (parallel vs. sequential/fail-fast) **MUST** be documented and
  configurable.

## 9. Acceptance criteria (testable)

- **AC-1** — On a project exposing all four gate types, `task-verify` executes the four gates
  concurrently and `verification.md` records all four results. *(verify via concurrent process
  start and wall-clock < sum-of-gates)*
- **AC-2** — For a fixed repository state, the parallel verdict equals the sequential verdict,
  with identical findings. *(verdict-parity test)*
- **AC-3** — When one gate fails, the other three results are still present in
  `verification.md`. *(no-loss-on-failure test)*
- **AC-4** — `diff-critic` and `task-verify` run concurrently in `task-implement`, and both
  results are present before `task-deliver` runs. *(overlap + merge-point test)*
- **AC-5** — After a verify-triggered fix, the delivered PR reflects a `diff-critic` review of
  the **final** diff, not the pre-fix diff. *(stale-review prevention)*
- **AC-6** — A sequential / fail-fast mode is selectable and produces a correct verdict.
  *(fallback test)*
- **AC-7** — The wall-clock of the parallel verify path is **≤** the sequential path for the
  same inputs. *(latency non-regression)*

## 10. Explicit non-requirements

- **NR-1** — Clarifying questions in `task-start` remain one question at a time.
- **NR-2** — Dependent steps and dependent tasks remain serial.
- **NR-3** — No reduction in reasoning effort or check depth is implied or permitted.

## 11. Open questions

1. Default mode — parallel-by-default with a sequential opt-in, or sequential-by-default with a
   parallel opt-in?
2. Default value of the max-parallelism bound and how it is configured.
3. Whether **R-R-1** should be elevated from SHOULD to MUST.
