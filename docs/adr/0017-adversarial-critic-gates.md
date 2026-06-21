# ADR 0017 — Adversarial critic gates in the task pipeline

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-21                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0004](0004-traceable-spec-contract.md) (gate ordering), [ADR-0003](0003-tool-backed-dor.md) (DoR), [ADR-0006](0006-all-subagents-opus.md) (critics on Opus), `plugins/marvin/agents/marvin-tm-spec-critic.md`, `plugins/marvin/agents/marvin-tm-diff-critic.md` |

> Records a design pattern already in effect in the task pipeline; prior ADRs touched the
> critics' model tier and gate ordering but never the pattern itself.

## Context

The task pipeline's deterministic gates — the `spec` DoR gate ([ADR-0003](0003-tool-backed-dor.md)),
the traceability checks ([ADR-0004](0004-traceable-spec-contract.md)), the contract seal, the
scope allowlist, and the delivery gate — prove a spec's and a diff's **shape**. They cannot
judge **semantics**: whether a stated proof is *genuine* rather than a weak test named to pass
the check, whether an integration point is *real*, whether a "rejected alternative" is a
strawman, or whether a diff quietly drifts beyond the spec's intent.

A second failure mode is human: the spec author (`marvin-tm-writer`) and the user build shared
**confirmation bias** during the authoring dialogue. A reviewer who saw that dialogue inherits
the same blind spots.

## Decision

**Add two fresh-context, read-only red-team critic subagents to the pipeline, each isolated
from the context that produced the artifact it reviews.**

- **`marvin-tm-spec-critic`** runs in `task-start` *after* the mechanical `spec` gate passes
  and *before* the spec is written. It grounds the candidate spec in the current codebase and
  reports semantic weaknesses the mechanical gate cannot — catching the confirmation bias the
  writer and user accumulate together.
- **`marvin-tm-diff-critic`** runs before the Create-PR step: it reads the staged/branch diff
  with a context that did *not* write the code, grounds it in the spec, and reports
  scope-creep, out-of-scope changes, and missing acceptance-criteria coverage before a PR
  opens.
- **Fresh context is the point.** Each critic is spawned without the authoring conversation,
  so it reviews the artifact on its own merits. Both are **read-only**.
- **Cheap gate first.** Per [ADR-0004](0004-traceable-spec-contract.md), the free deterministic
  gate runs before the critic, so a critic invocation is spent only on shape-valid artifacts —
  a stronger ordering now that critics run on Opus ([ADR-0006](0006-all-subagents-opus.md)).

## Consequences

### Positive

- A semantic safety net over the deterministic gates: the checks that catch what code analysis
  cannot, at exactly the two highest-leverage points (before a spec is sealed, before a PR is
  opened).
- Isolation from authoring context structurally counters confirmation bias.

### Negative / accepted trade-offs

- Two extra Opus subagent invocations per task on the hot path — cost accepted, mitigated by
  running the free gate first.
- Critics produce judgment, not proofs; a skipped or unavailable critic (e.g. in a headless
  `claude -p` run) is recorded and carried to the PR rather than silently dropped — semantic
  review is a complement to the deterministic gates, not a replacement for them.
