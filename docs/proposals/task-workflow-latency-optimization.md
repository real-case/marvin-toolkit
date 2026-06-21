# Proposal: Task Workflow Latency Optimization

| Field      | Value                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| Status     | **Implemented** 2026-06-13 — see `specs/taskmaster-latency-optimization.md`, ADR-0002     |
| Date       | 2026-06-08                                                                              |
| Applies to | `task-start`, `task-implement`, `task-verify` skills (taskmaster pipeline)              |
| Principle  | **Quality first, speed second** — every change must be latency-only, never reducing the depth of checks or dialogue |

## Motivation

The taskmaster pipeline (`task-start` → `task-implement` → `task-verify` → `task-deliver`)
produces results whose quality is already satisfactory in real-task testing. The goal here is
to cut end-to-end **wall-clock time** without changing *what* the pipeline checks or *how
deeply* it reasons — i.e. purely structural improvements (ordering, parallelism, redundant
work), not substantive ones.

**Hard constraint.** No optimization may reduce coverage, remove a quality gate, shorten the
clarifying dialogue, or weaken the Definition-of-Ready / verification gates. If a change trades
any quality for speed, it does not belong here.

## Where the time goes

Two distinct cost centers, optimized differently:

1. **Phase 1 (`task-start`) — human-bound.** Wall-clock is dominated by the user reading and
   deliberating, not by model latency. Round-trip count is a poor proxy for real time here.
   → Leave the dialogue cadence alone.
2. **Phases 2–3 (`task-implement` → `task-verify`) — machine-bound.** Wall-clock is dominated by
   slow tool operations (test suites, builds) and by independent steps run sequentially.
   → This is where structural parallelism pays off.

## Proposed changes

### P1 — Parallelize quality gates in `task-verify` *(Tier 1)*

**Today** (`task-verify`, Step 2): tests → lint → type-check → build run **in order**, "stop
early on critical failures." The four gates are independent, and the report (`verification.md`)
needs all of them regardless, so total wall-clock = the sum of all gates.

**Change:** run the independent gates **concurrently** (background processes), then collect and
write the verdict. Wall-clock ≈ the slowest single gate.

- On the common PASS path (the norm when quality is good) this is the largest single win.
- Keep a sequential / `--fail-fast` mode as an opt-in for resource-constrained machines or when
  fast first-failure feedback is preferred.
- **Quality impact: none** — identical commands, identical captured results.
- **Caveat:** concurrent test + build raises peak CPU/RAM; document the sequential fallback.

### P2 — Overlap `diff-critic` with `verify` in `task-implement` *(Tier 1)*

**Today:** self-review (`marvin-tm-diff-critic` subagent) runs **before** verify (Steps
6F → 7F, 9B → 10B), sequentially. Both are slow; neither mutates source on the happy path (the
critic is read-only; verify runs tools and writes only `verification.md`).

**Change:** launch `verify` in the background and run the `diff-critic` subagent
**concurrently**; merge both results before `task-deliver`.

- Two slow operations collapse to their maximum instead of their sum.
- If a verify FAIL triggers a fix, the diff changes — re-run the critic after the final green.
  The delivery gate is unchanged, so correctness is preserved.
- **Quality impact: none** — both still run; the ordering of their *results* at the delivery
  gate is unchanged.

### P4 — Stop re-deriving context across chained phases *(Tier 2)*

**Today:** in the interactive chain each phase re-derives what the previous one already knows —
`task-verify` Step 1 re-detects the stack and re-infers the spec type; `task-deliver` re-reads
the spec.

**Change:** when invoked as part of one chained session, pass `spec` / `type` / `stack` forward
and skip the redundant detection/parse. Preserve full re-derivation when a skill is invoked
**standalone**.

- **Quality impact: none** — same inputs, fewer tool calls and one fewer parse turn per handoff.

### P5 — Targeted verify retries *(Tier 2)*

**Today** (`task-implement` 7F / 8B): on a gate failure, fix and **re-run verify** (up to 2
retries), re-running the full suite each iteration.

**Change:** on FAIL, re-run **only the failed gate** to confirm the fix, then run a single full
pass as the final confirmation before delivery.

- **Quality impact: none** — the final green is still a complete run; intermediate iterations
  just skip slow gates that already passed and are unaffected by the fix.

### P6 — Default to 3 solution variants *(Tier 3, tunable)*

**Today** (`task-start`, Step 3F): "Generate 3–5 solution variants."

**Change:** default to **3** genuinely-different variants; expand to 5 only for high-uncertainty
or high-blast-radius tasks.

- **Quality impact: minor and bounded** — retains the anti-strawman rule and the mandatory
  NATIVE fallback. Three distinct variants suffice for most decisions, and the author can always
  request more.
- This is the **only** item with a (small, opt-out) substantive trade-off; included for
  completeness, lowest priority.

## Explicitly rejected

### R3 — Batching clarifying questions

**Considered:** collapse `task-start` Step 1.4 "one question at a time" into a single
multi-question prompt.

**Rejected.** Clarifying questions are answered by a human who needs focus on each one; answer
quality depends on undivided attention. Furthermore, Phase 1 wall-clock is human-bound, so
batching would save API round-trips but almost no real time — trading focus for a negligible
gain. The one-at-a-time cadence stays.

## Do not touch (quality backbone)

Out of scope for any latency change — these are the source of quality:

- `marvin-tm-spec-critic` and `marvin-tm-diff-critic` gates (already on the fast `sonnet` model).
- The Definition-of-Ready gate; regression-test-first for bugfixes; "verification gates delivery."
- Context mapping (2F) and root-cause analysis (3B).
- Model assignments: `sonnet` for critics, `opus` for `writer` / `executor` / `review-fixer` —
  already correct.
- Existing parallel reads (`task-start` 1.3, `task-implement` Step 3) — already optimal.

## Quality-safety summary

Every retained item (P1, P2, P4, P5) is **structural**: it changes ordering, parallelism, or
redundant work — not *what* is checked or *how deeply* the model reasons. P6 is the sole
substantive lever and is opt-out. No gate is removed; no dialogue is shortened.

| Change | Lever                         | Speed gain   | Quality impact            |
| ------ | ----------------------------- | ------------ | ------------------------- |
| P1     | parallel verify gates         | large        | none                      |
| P2     | `diff-critic` ‖ `verify`      | large        | none                      |
| P4     | no re-derivation in chain     | medium       | none                      |
| P5     | targeted verify retries       | medium       | none                      |
| P6     | 3 variants by default         | small        | minor, opt-out            |
| ~~R3~~ | ~~batch clarifying questions~~ | ~~negligible~~ | ❌ rejected (focus) |

## Implementation notes

- All changes are edits to `SKILL.md` prose, except where the skill drives `Bash` (P1/P2
  instruct background / concurrent execution). **No MCP server rebuild required** — skill bodies
  are read at request time.
- Affected files:
  - `plugins/marvin/skills/task-verify/SKILL.md` (P1)
  - `plugins/marvin/skills/task-implement/SKILL.md` (P2, P4, P5)
  - `plugins/marvin/skills/task-start/SKILL.md` (P6 only)
- **Recommended sequencing:** land **P1 + P2** first (the dominant win), then P4/P5, then P6 if
  desired.
- **Validation:** run the changed skills on a representative feature task and a bugfix task;
  confirm identical verdicts/coverage versus the current pipeline, with reduced wall-clock.
  Optionally route the edited specs through a `marvin-tm-spec-critic`-style review.

## Open questions

1. P1 default: parallel-by-default with a `--fail-fast` opt-in, or sequential-by-default with a
   parallel opt-in?
2. Bundle P4–P6 with P1–P2 in a single PR, or ship Tier-1 alone first?
