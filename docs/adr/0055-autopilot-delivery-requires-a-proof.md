# ADR 0055 — The autopilot's delivery gate requires a red→green proof or a declared reason why none exists

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed** |
| Date          | 2026-11-19 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0012](0012-tool-backed-delivery-gate.md) (the delivery gate this extends), [ADR-0036](0036-oracle-execution-and-red-green.md) (the advisory `red_green` field this makes blocking in the autopilot), [ADR-0047](0047-feature-red-phase.md) (the feature red phase) |

## Context

The delivery gate (`verify action: "gate"`) reports `red_green` beside its decision: `proven` when
the oracle journal holds a red followed by a green over one unchanged test file at the sealed
`contract_sha`, `missing` when a criterion that should carry that pair does not, and `unknown` when
there is nothing to look for. ADR-0036 made the field advisory, because a person was expected to
weigh a missing proof before delivering.

In the autopilot nobody weighs it. The executor is a headless `claude -p` session, and its
delivery gate decides alone. One host project measured 106 autopilot gate decisions: 95 ALLOW, of
which only 44 had `red_green: "proven"`. 32 were `missing` and 19 `unknown`, so 51 deliveries went
out with no proof that any test ever failed for the change. 13 of those 51 had no oracle record at
all; they are most likely documentation or configuration tasks, for which no test can fail first.

Making `red_green` blocking everywhere would turn every such task into a waiver a person has to
grant, and the autopilot has no person to grant it.

## Decision

1. **A spec can declare that it has no oracle a test can execute.** The sealed `spec-contract`
   block takes an optional `no_oracle: { reason: <text> }`. The reason is required and may not be
   blank: a bare `no_oracle: true` fails the schema. The declaration sits inside the sealed block,
   so adding it after the seal reads as a tampered contract. Since the seal hashes the block's raw
   text, the new key needs no migration of existing seals.
2. **The declaration is checked against the criteria.** A criterion contradicts it when its oracle
   is `kind: test` or it is marked `regression: true`. A `command` oracle does not: a docs task's
   `grep` over a planned file is a check, and the Definition-of-Ready gate requires at least one
   real proof. One function, `noOracleContradictions` in `storage/spec.ts`, holds this rule. The
   Definition-of-Ready gate uses it to report a `no-oracle` check, FAIL when contradicted and PASS
   otherwise; a spec that declares nothing gets no check. The delivery gate uses it as well.
3. **A contradicted declaration BLOCKs delivery in every session.** It is a false statement in a
   sealed contract, and the same spec would fail the Definition of Ready.
4. **In the autopilot, ALLOW needs a proof.** When the server runs with `MARVIN_PIPELINE=1`, which
   the engine sets on every child and the child's MCP server inherits, the gate allows a delivery
   only when `red_green` is `proven` or the contract carries a declaration it bears out. A
   `missing` or `unknown` proof without one is a BLOCK, and the reason names the criterion that
   lacks its red (for `missing`), or what made the proof unreadable (for `unknown`: no `specSlug`,
   an unreadable or tampered contract, a feature with no `kind: test` criterion, a bugfix with no
   regression criterion). It also names the declaration that would answer it.
5. **Interactive sessions keep ADR-0036.** Without `MARVIN_PIPELINE=1` a missing proof remains a
   clause in the ALLOW reason. A person is present there to weigh it.
6. **The answer is on the record.** The `deliver-gate` block gains `no_oracle` (`declared`,
   `contradicted`, `absent`, `unknown`) and `red_green_required` (a boolean). The
   verification-run journal's `gate` entry carries both as optional fields, so a series can count
   the ALLOWs that rested on a declaration rather than a proof. Older entries still parse.

## Consequences

- At first the autopilot will block more deliveries. Each one is a task whose red was never
  recorded, or a docs or config task whose spec declared nothing. After such a BLOCK,
  `/marvin:task-deliver`'s pipeline mode hands back to `/marvin:task-implement`, which delivers a
  draft pull request that reports the refusal, as it already does for a FAIL. The proof cannot be
  recorded after the implementation, since a red needs the code that is not there yet. A blocked
  run is therefore a signal to the planner and the retro, not something the executor can repair.
- The planner has to decide at intake whether a task has an executable oracle. The feature and
  bugfix templates and `/marvin:task-start` describe the declaration and when it applies.
- A spec sealed before this change declares nothing. Under the autopilot it needs its red proven,
  or a re-seal with a declaration.
- The gate still reads only files: no runs and no tokens.

## Alternatives considered

- **Block on every caller.** Rejected for ADR-0036's reason: an interactive user has the context to
  judge a missing proof, and a gate that refuses on its own uncertainty is disabled at the first
  false refusal.
- **A caller-passed `requireRedGreen` input.** Rejected: the executor would have to remember to
  pass it on every delivery, and a forgotten flag would bring back the gap this ADR closes. The
  pipeline's environment cannot be forgotten.
- **Count the seal stage's red.** The engine runs each sealed acceptance test red before the
  executor starts, but records that only in its own run state, outside the repository. The executor
  already records that red in the oracle journal (`/marvin:task-implement`'s pipeline mode), so the
  gate keeps one source of proof.
- **A declaration outside the sealed block** (frontmatter). Rejected: the executor may edit the
  frontmatter (`status`), so a delivery could exempt itself after the seal.
