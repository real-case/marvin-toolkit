# ADR 0047 — A feature records one red phase, and the delivery gate reads it

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed** |
| Date          | 2026-09-27 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0036](0036-oracle-execution-and-red-green.md) (the oracle journal and the `red_green` field this **amends**), [ADR-0043](0043-task-workflow-metrics.md) (Q3 `red_green`, which this leaves bugfix-only), [ADR-0044](0044-deterministic-metrics-anchors.md) (the delivery gate as a metrics anchor) |

> Amends [ADR-0036](0036-oracle-execution-and-red-green.md) rather than superseding it. Its journal,
> its proof rule (a red and a green for one criterion, at one `contract_sha`, over one unchanged
> test file) and its advisory status are unchanged. What changes is which specs the delivery gate
> reads a proof for.

## Context

ADR-0036 made the red-green proof executable: `verify` `action: "oracles"` with `expect: "fail"`
records a red, a later `expect: "pass"` records a green, and the delivery gate reports
`red_green: "proven"` when the pair exists. It scoped the proof to bugfix specs, because the red
phase existed only in `/marvin:task-implement` Step 6B and the executor's bugfix step 3.

Three host projects then ran the pipeline between 2026-09-11 and 2026-09-23
(`docs/proposals/pipeline-stage-efficiency.md`). Every delivered task in the corpus was a feature.
`red_green` read `unknown` in 19 of 19 delivery decisions, so the field has never carried a signal.
The oracle journals hold 359 runs, two of them red, and neither was asked for by any step.

A test written after the code it covers can pass for reasons unrelated to the behaviour it names:
it asserts the wrong thing, or it exercises nothing. A red run before the implementation is the
cheapest evidence against that, and an oracle run costs about half a second on the largest host.

## Decision

1. **The feature path records one red.** In `/marvin:task-implement` Step 5F and in
   `marvin-tm-executor` §2, before implementing anything, the session writes the test of the
   **first** criterion whose oracle is `kind: test` and records one run of it with `expect: "fail"`.
   The test file is not edited again; the oracle run after the gates are green (Step 6F, executor §3)
   is its green. A spec with no `kind: test` criterion has no red phase.
2. **The first criterion, not a primary one.** The contract has no field that marks a criterion as
   primary, and adding one would be a schema change for a rule that needs only a deterministic
   choice. Contract order is that choice.
3. **The delivery gate reads a feature's proof.** For a `type: feature` spec, `red_green` is
   `proven` when **any** `kind: test` criterion has a proven pair, `missing` when none has, and
   `unknown` when the spec has no `kind: test` criterion. A `missing` answer names the first such
   criterion, the one the red phase asks for. The gate accepts any criterion so that a session which
   proved a different one is not reported as unproven.
4. **The bugfix rule is unchanged.** A bugfix still proves every `regression: true` criterion.
5. **The field stays advisory.** A `missing` pair adds a warning to the ALLOW reason and never changes
   the decision, exactly as in ADR-0036.
6. **Q3 stays a bugfix metric.** The roll-up's `quality.red_green` measures the share of a bugfix's
   criteria with a pair. A feature proves one criterion by design, so that share would read as
   incompleteness. The per-decision `red_green` in the verification-run journal is where the feature
   proof is counted.

## Consequences

- A feature whose first `kind: test` criterion has no red on the record now reads `missing` where it
  read `unknown`, and its ALLOW reason carries one more clause. No decision changes.
- The implementation step gains one oracle run per feature, a few seconds.
- The headless executor records its bugfix red and green through `verify` when the tool is
  available, so both paths leave the same evidence.
- Whether the red phase changes rework is measurable: compare fix rounds and diff-critic blockers on
  features with a proven pair against those without, once ten tasks have run under this record.

## Alternatives considered

- **A red for every `kind: test` criterion.** Stronger evidence, but it turns test-first into a
  requirement for every criterion of every feature. One red per task is enough to make the field
  carry a signal, and the cost of more can be decided from the measurement above.
- **Prove only the first criterion at the gate.** Simpler to state, but a session that recorded a
  red for another criterion would be reported as unproven while holding a valid proof.
- **Make the pair a delivery requirement.** ADR-0036 rejected this for bugfixes because a missing
  runner declaration would block delivery; the same holds for features.
