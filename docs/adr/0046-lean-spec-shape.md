# ADR 0046 — A spec keeps only the sections a reader uses, and states each fact once

| Field         | Value |
| ------------- | ----- |
| Status        | **Proposed** |
| Date          | 2026-09-27 |
| Supersedes    | — |
| Superseded by | — |
| Related       | [ADR-0003](0003-tool-backed-dor.md) (the required section list this amends), [ADR-0005](0005-portable-spec-contract.md) (the host-bindings block this retires for new specs), [ADR-0009](0009-config-first-gate-resolution.md) (`gates`, which now carries the host's gate commands), [ADR-0027](0027-tool-backed-adr-lifecycle.md) (`adr.dir`), [ADR-0036](0036-oracle-execution-and-red-green.md) (`gates.test_one`, which makes a per-criterion `oracle.run` redundant), [ADR-0037](0037-spec-corpus-mechanics.md) (`spec.dir`), [ADR-0039](0039-critique-receipts.md) (the receipt that now carries the critic's narrative), [ADR-0043](0043-task-workflow-metrics.md) (the series that gains Q13/Q14) |

## Context

The analysis in `docs/proposals/spec-size-reduction.md` measured 49 sealed specs from three host
projects. The median spec is 37 KB. About a third of the text restates something said elsewhere in
the same spec, and the restatements have started to contradict their contracts: a Chosen Approach
item that disagrees with a file row after a critic fix edited only the contract, `satisfies` and
`implemented_by` disagreeing on four pairs in a sealed spec, requirements that exist only in prose
where nothing can bind them to a proof.

Three mechanisms produced this. The template made every one of eighteen sections mandatory
(`task-start` Step 5F said "Fill every section"), so Security / NFR carried a paragraph in every
spec that had one while nothing read it. The contract fields had no length limits. The spec critic
asked only what was missing and routed its warnings into the spec's Future Considerations, so each
round added a paragraph: spec size correlates with the number of critic receipts at r = 0.70.

## Decision

1. **The section set shrinks to the sections a consumer reads.** A feature spec requires Goal,
   Chosen Approach, Non-goals and Open Questions, and recommends Context, Assumptions and Critic
   Verdict & Overrides. Data & Config, Security / NFR and Deferred slices are optional and written
   only when they apply. Test Plan, Definition of Done, Design Notes, Why this over alternatives,
   Future Considerations and Host Bindings are gone from the template: their executable content
   moves into the contract (a criterion, a `failure` line, a test file's `intent`), their design
   content into Chosen Approach as traps and at most three rejected alternatives, and follow-ups
   into board cards. A bugfix spec drops Definition of Done, Design Notes and Host Bindings and keeps
   its diagnostic sections.
2. **One fact, one place.** A requirement lives in the contract and prose refers to it by id.
   Context holds `path:line` pointers; evidence goes to a sidecar `<spec dir>/runs/<slug>.evidence.md`,
   which the non-recursive spec enumerators cannot see. The critic's narrative stays in its receipt,
   and Critic Verdict & Overrides is one line.
3. **Host bindings move to configuration.** `spec_location` is `spec.dir`, `decision_record.path`
   is `adr.dir`, `gates` is `gates`, and `merge_obligations` becomes a new optional top-level
   `string[]` in `.marvin/config.json`. `task-start` proposes the missing keys once per project,
   including a `gates.test_one` template, and writes them after the user confirms. The task summary
   links the ADR directory from `adr.dir` when a spec carries no block.
4. **`implemented_by` is the hand-written direction of the traceability graph**, and `satisfies` is
   optional. The gate already exempted a row without `satisfies` from the symmetry check, and keeps
   failing a declared list that disagrees, so older specs are still checked.
5. **The gate warns on size; it never fails on it.** `spec-size` warns above
   `3 KB + 400 B per file + 500 B per criterion`, `ac-length` on a statement over 40 words,
   `intent-length` on an intent over 60 words, and `security-nfr` when a `risk: high` feature has no
   Security / NFR section. The template's own limits (30 words, two sentences) sit below the
   warning thresholds, so a borderline field is the critic's call. `fcp-size` now fires above 15
   files or 12 criteria, the threshold at which Step 4.5F must present a split explicitly.
6. **The critic becomes a counterweight.** A new Economy category reports `[redundancy]` and `[size]`
   as warnings and `[drift]` as a blocker, plus `[prose-only]` for a requirement with no proof. A
   finding is resolved by editing the lines it names, never by adding a paragraph, and warnings are
   no longer parked in Future Considerations. The dispatch passes the size budget.
7. **A light tier.** A feature with `risk: low` and at most five files may omit Context, which the
   gate then does not recommend, and gets one critic dispatch instead of two.
8. **Size is measured.** The terminal `task-metrics` block gains `quality.spec_size`
   (`bytes`, `words`, `budget`), read from the spec at roll-up time, and the series reports Q13
   `spec_bytes` and Q14 `spec_words`.

## Consequences

- Every change to the gate removes a requirement or adds a warning, so every sealed spec keeps its
  verdict class: a spec that passed still passes, possibly with more warnings. The release is minor.
- A spec that still carries a `host-bindings` block keeps working. The gate still reads its
  `spec_location`, and the summary still prefers its `decision_record.path`.
- The executor reads traps from Chosen Approach, and still reads a `## Design Notes` section when an
  older spec has one.
- The budget is a heuristic. Every spec in the measured corpus exceeds it (median 2.6×), so it will
  warn on most specs until the rules take effect; whether it should ever fail is left open until
  twenty specs have been written under this record.
- The pilot and evaluation the proposal describes, rewriting two shipped specs and comparing the next
  ten tasks against the baseline, run on host projects and are not part of this change.

## Alternatives considered

- **Keep every section and add length limits only.** The paraphrase lives across sections, so
  limits per section leave the eight-fold restatement of one decision intact.
- **Fail on size.** Every sealed spec would become undispatchable on the next DoR call.
- **Make `satisfies` the hand-written direction.** `implemented_by` sits on the criterion, where the
  gate, the critic and the executor look first.
- **Skip the critic entirely on the light tier.** The critic still catches oracles that cannot fail
  on the wrong implementation, which the gate cannot judge; one dispatch keeps that check.
</content>
</invoke>
