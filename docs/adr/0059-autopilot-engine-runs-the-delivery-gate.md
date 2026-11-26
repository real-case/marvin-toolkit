# ADR 0059 — The autopilot engine runs the delivery gate itself

| Field         | Value |
| ------------- | ----- |
| Status        | **Proposed** |
| Date          | 2026-11-26 |
| Supersedes    | — |
| Superseded by | — |
| Related       | [ADR-0044](0044-deterministic-metrics-anchors.md) (the delivery gate writes the terminal metrics block), [ADR-0055](0055-autopilot-delivery-requires-a-proof.md) (under the autopilot, ALLOW needs a red→green proof) |

## Context

Two rules live in the `verify` tool's `action: "gate"`. On ALLOW it appends the terminal
`task-metrics` block to the task's record (ADR-0044), and under `MARVIN_PIPELINE=1` it ALLOWs
only a delivery with a proven red→green pair or a sealed `no_oracle` declaration (ADR-0055).
Under the autopilot, nothing but prose reached that gate: the executor child was told to call it
from `task-implement` and `task-deliver` in pipeline mode, and the engine committed whatever the
metrics record held at finalize (`pipeline/metrics-carry.ts`).

An analysis of 110 autopilot runs found that the executor called the gate in 8 of the 23
successful runs and called `metrics action: "rollup"` in none. Most autopilot deliveries
therefore carry no terminal block, and ADR-0055 never applied to them. A rule that depends on a
child choosing to call it is not enforced.

## Decision

1. **The engine calls the gate.** Once CI is green, or the orchestrator answers a `no_ci`
   judgment with `proceed`, the run stays in `ci_wait` and the engine runs a `deliver` work step
   before the retro. The step calls `deliverGate` from `tools/verify.ts`, the function the tool's
   `action: "gate"` calls, in the engine's own process. It does not spawn the MCP server.
2. **The autopilot rule is an argument, not an environment variable.** `deliverGate` takes
   `redGreenRequired`; the tool still derives it from `MARVIN_PIPELINE`, and the engine passes
   `true`. The gate's `ServerEnv` is built from the worktree alone, so a `MARVIN_*_DIR` variable
   in the engine's environment cannot redirect its reads or the record's write.
3. **The verdict the gate judges is the engine's.** The executor's last `verify` run is
   recorded before its final commit, so its provenance is stale for the delivered commit by
   construction, and its verdict is not the one that let the run through. The step writes the
   gate stage's report for the gated commit (`run.gateReport`) as the spec's per-spec run,
   `.marvin/task/runs/<slug>.md`, with provenance collected just before the gate reads it. A gate
   the stage passed on a retry or as inherited (ADR-0058) is a warning there, and a `not-run`
   gate keeps verify's own warning text, so the no-evidence refusal still applies. The global
   `verification.md` is not written. The step refuses outright when no passing gate is recorded,
   when the run holds no gate report, or when the worktree is not at the gated commit.
4. **Only an ALLOW reaches the retro, finalize and `ready`.** A BLOCK raises a `halt` judgment
   with the gate's reason and a `DELIVERY-gate` blocker finding, with the executor as the halted
   role. A `retry` starts an executor iteration on that finding; a `cancel` closes the run
   through the retro. It is not routed as an automatic rejection, because the most frequent
   reason, a red that was never recorded before the implementation, is one no later executor can
   supply.
5. **One terminal block per delivery.** The step appends no block when the record's last one
   names the gated commit (a replayed step, or an executor that called the gate after its last
   commit), or was derived after the current executor started. `task-deliver` calls the gate
   before it commits, so that executor's block names the parent commit and is still this
   delivery's. A block from an earlier executor is older and gets a fresh successor. Finalize
   commits the record as before.
6. **The executor's call stays, as a self-check.** `executor.md` and `task-deliver`'s pipeline
   mode now say the engine runs the gate and appends the block, and that the executor never calls
   `rollup`. The executor's own gate call before the pull request is kept: a refusal found there
   costs no CI round. The interactive path is unchanged.

## Consequences

- Every autopilot run that reaches the retro has passed the ADR-0055 rule and carries a terminal
  metrics block for the commit it delivers, whatever its executor did.
- Runs whose executor skipped the red phase now stop at the delivery gate instead of shipping
  unproven. The engine's seal stage proves a red on the base commit, but it does not journal that
  proof, so the gate cannot read it. Recording the seal's red in the oracle journal is a separate
  change.
- The per-spec run file is overwritten by the engine at delivery. It means "the latest run for
  this spec", and the engine's gate is the latest run. The verification-run journal gains a
  `gate` entry for every engine call, and no `run` entry, because the engine's gate stage is not
  a `verify` run.
- `deliver` is a new work kind and `delivery` a new observation. A run already past `ci_wait`
  when the engine is upgraded finishes without the step.
