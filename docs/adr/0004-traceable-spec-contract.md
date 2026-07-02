# ADR 0004 — Traceable spec contract and gate reordering

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-14                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0003](0003-tool-backed-dor.md), [ADR-0002](0002-tool-backed-verification.md), `plugins/marvin/skills/task-start/SKILL.md`, `plugins/marvin/mcp/server/src/tools/spec.ts` |

## Context

ADR-0003 moved the **shape** of the Definition of Ready into the `spec` tool: required
frontmatter, required sections, File-Change-Plan path existence, a non-empty `verified_by` per
acceptance criterion. That closed the largest hole — a self-graded prose checklist — but an audit
of the full Phase-1 → Phase-2 chain surfaced four residual gaps, all of which let a "ready" spec
still force the executor to *infer* its way to a result:

1. **No cross-section linkage.** The File Change Plan, Acceptance Criteria, and Test Plan were
   three independent tables. Nothing tied a criterion to the files that implement it or the test
   that proves it. The executor (`task-implement` / `marvin-tm-executor`) reconstructed that
   mapping by reading — exactly where non-determinism enters.
2. **`verified_by` checked only for non-emptiness.** `prose-review` is a sanctioned value, so a
   spec where *every* criterion is `prose-review` passed the mechanical gate — and in the headless
   path, where the semantic critic is most often unavailable, nothing else caught it. The
   tool also never checked that a `verified_by` test path was inside the allowlist; a test named as
   a proof but absent from the File Change Plan is a file the executor is *forbidden to create*.
3. **Expensive gate before the cheap one.** `task-start` ran the LLM-backed
   `marvin-tm-spec-critic` (Step 7) *before* the free deterministic `spec` tool (Step 8). A spec
   with a shape error burned a critic invocation before the tool rejected it for nothing.
4. **Context holes pre-draft.** Intake never swept for callers / reverse-dependencies, public-
   surface (backward-compat) impact, or repo merge-obligations (docs, changelog, version bump,
   committed build artefacts). The first reliably produces an incomplete allowlist; the critic
   caught it only *after* drafting, forcing an expensive loopback.

### The binding constraint

Determinism of execution is a function of how little the executor must infer. Every unlinked
table and every prose contract is an inference point — a place where spec and diff can diverge.
ADR-0003 proved the spec's *shape*; it did not make the spec's *internal references* a checkable
property, nor guarantee the context needed to make those references complete was gathered before
the allowlist was drafted.

## Decision

Make the spec a **traceable contract** whose execution-load-bearing elements are linked and tool-
validated, reorder the gates cheap-first, and push the missing context-gathering ahead of the
draft.

- **Traceability triple.** The File Change Plan gains an `ID` and a `Satisfies` column; Acceptance
  Criteria gain an `Implemented by` column. The `spec` tool now verifies the closed graph: every
  criterion's `Implemented by` names real plan IDs, every plan row's `Satisfies` names real
  criteria, every `verified_by` test path is an allowlisted plan row, and **≥1 criterion carries a
  non-`prose-review` proof**. This is what lets Phase 2 execute the AC→files→test mapping instead
  of inferring it.
- **Contract as code, not prose.** The Interface/Contract section is a literal code block the
  implementer copies; the tool warns when a non-`N/A` contract carries no code fence.
- **Definition of Done** is a new required section: merge-readiness beyond acceptance criteria
  (gates green plus repo-specific obligations, each a File Change Plan row if it touches a file).
- **Off-ramp for genuine unknowns.** A new `spike_required` frontmatter flag; the tool **fails**
  on `spike_required: true`. Unknowns that need investigation are resolved (e.g. via
  `/marvin:kanban-spike`) instead of being laundered into Assumptions to slip past the gate.
- **`breaking` declaration** (feature frontmatter) forces a conscious backward-compat call; the
  tool warns when it is omitted. `stack` may now be comma-separated for polyglot work.
- **Gate reorder.** `task-start` runs the `spec` tool **first** (Step 7), then the semantic critic
  **only on shape-valid specs** (Step 8), then finalize/write (Step 9). A critic `BLOCK` loops
  back and re-runs the mechanical gate before returning. A skipped critic is recorded *and* carried
  to the PR — never silent.
- **Pre-draft context sweep.** Intake gains three dimensions — callers / reverse-deps, backward-
  compat / public surface, merge obligations — and the feature flow now reads caller graphs, recent
  churn, and neighboring tests (parity with the bugfix flow), so the allowlist is complete before
  the critic rather than after.

## Consequences

### Positive

- The two largest sources of headless `⚠️ SPEC GAP` — an incomplete allowlist and a fictitious
  proof — become deterministic DoR failures (`ac-traceability`, `ac-test-in-plan`,
  `ac-verified-real`) instead of "the critic might catch it".
- The executor's degrees of freedom collapse: for each criterion, change exactly these files,
  prove with exactly this test. Spec↔diff divergence shrinks.
- The free gate runs first; the LLM critic is spent only on specs worth its time.
- Callers and merge-obligations are gathered before drafting, turning a late critic loopback into
  an intake question.

### Negative / accepted trade-offs

- The spec format changed again. Specs predating this ADR (three independent tables, no `Definition of Done`,
  no `breaking`/`spike_required`) are **not** auto-migrated — a missing-section/`traceability` WARN
  flags them on next gate run; re-author under the new templates. The format consumers
  (`task-implement`, `marvin-tm-executor`, `marvin-tm-spec-critic`) were updated in lock-step.
- The tool still checks **shape, not semantics** — a traced, allowlisted `verified_by` can still be
  a weak test. The critic and the judgment checklist remain the semantic complement; the tool
  narrows, it does not replace judgment.
- More required structure raises the authoring bar for trivial specs. Accepted: the pipeline targets
  headless dispatch, where under-specification is the dominant failure mode.
- DoR-logic changes continue to require a server rebuild and committed `dist/` (ADR-0003's
  trade-off), and the `spec` tool's availability inside a headless `claude -p` run is still not
  guaranteed — `task-start` falls back to a manual self-check and records the degradation.
