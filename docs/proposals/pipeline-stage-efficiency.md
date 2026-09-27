# Proposal: Pipeline Stage Efficiency

| Field      | Value |
| ---------- | ----- |
| Status     | Proposed |
| Date       | 2026-09-27 |
| Applies to | `task-start` and `task-implement` skills, `marvin-tm-spec-critic` and `marvin-tm-executor` agents, the `metrics`, `spec` and `verify` tools, `changedFilesForScope` in `lib/git.ts` |
| Principle  | A check earns its place by separating good work from bad. A check that almost always fires, or never fires, costs time and returns no signal. |

## Summary

Three host projects ran the task pipeline between 2026-09-11 and 2026-09-23. Their `.marvin/`
journals show which stages pay for themselves. The mechanical gates are cheap and effective: the
Definition-of-Ready gate and `verify` together cost minutes per task and catch real defects. The
spec critic is the most expensive stage and the least discriminating one: it takes 63% of intake
time and blocks 97% of first drafts, yet the specs sealed over its surviving blockers show only
slightly more rework than the specs it approved. The red/green proof never fires, because the red
phase exists only for bug fixes and every delivered task in the corpus was a feature.

Versions 0.25.0 to 0.27.0 (PRs #213, #214, #217) addressed part of this. This proposal compares the
measurements with the current implementation and lists the remaining changes in order of expected
gain.

## Evidence

### The corpus

Every event in the corpus was recorded by marvin 0.24.0 or earlier. None of the host projects has
run 0.25.0 or later yet, so the figures describe the pipeline before this week's changes.

| Project | Metric records | Terminal blocks | Progress journals | Critic receipts |
| ------- | -------------- | --------------- | ----------------- | --------------- |
| `vantage-erp-1` | 38 | 17 | 33 | 78 |
| `vantage-tag-helper` | 1 | 1 | 1 | 3 |
| `osint-chat-client` | 1 | 0 | 7 | 9 |

Only `vantage-erp-1` is large enough for statistics. All 17 of its delivered tasks are features,
16 of them `risk: medium`. The other two projects confirm or contradict its figures but do not
carry weight alone.

### Stage by stage

Times are wall-clock medians. Intake runs from the first to the last `task-start` entry of the
progress journal, and implementation from the first to the last `task-implement` entry, so both
include the critic dispatches inside them.

| Stage | Measured | Verdict |
| ----- | -------- | ------- |
| Intake and drafting | 31 min per task (erp, n=26); 33 min in osint | Expensive |
| Definition of Ready | 106 calls, 19 FAIL (18%), 3 calls per spec, near-zero time | Effective |
| Spec critic | 30 of 31 first passes BLOCK; median blockers 4, then 2; 24 of 32 specs sealed over a BLOCK; 9.8 min per pass; 745 of 1187 intake minutes (63%) | Expensive, weakly discriminating |
| Implementation | 45 min per task; 43 SPEC GAPs over 21 tasks, a third of them by-product files; 15 fix rounds | Moderate |
| Diff critic | 3 of 20 first passes BLOCK (15%); 5 blockers and 77 warnings over 27 verdicts; 207 min, 16% of implementation time | Moderate |
| `verify` | 61 runs; the first run fails in 29% of tasks; median 2 min; 3 stale refusals in 16 delivery decisions | Effective |
| Acceptance oracles | 359 runs, 2 red; `red_green` is `unknown` in 19 of 19 delivery decisions | Not working |
| Delivery and metrics | terminal block on 17 of 38 records; 17 erp specs still `ready`, 3 of them delivered | Incomplete |

### The spec critic does not discriminate

A gate that blocks almost every draft cannot separate a weak spec from a strong one by its verdict.
The downstream data agrees:

| Spec critic outcome | Implemented | SPEC GAPs per task | Fix rounds per task | Diff critic BLOCK |
| ------------------- | ----------- | ------------------ | ------------------- | ----------------- |
| Sealed over a BLOCK | 14 | 2.1 | 0.8 | 3 of 14 |
| Approved | 7 | 1.4 | 0.6 | 1 of 7 |

The gap exists, but it is small, and harder tasks plausibly produce both more blockers and more
gaps, so part of it is not the critic's doing. The blockers that could be tagged fall mostly into
`[oracle]` (25 of 87) and `[grounding]` (23 of 87). The 2026-09-27 analysis found that most of
these are semantic rather than mechanical; the decidable subset moved into the DoR gate in #213.

### The critic budgets are not enforced

`task-start` has limited the spec critic to two dispatches since 2026-09-03 (#198), and
`task-implement` has limited the diff critic to one. Both limits live only in skill prose. After
2026-09-03 one spec (`fleet-capability-ledger`, 2026-09-23) took six spec-critic passes and 41
minutes, another took three, and diff-critic re-dispatches of up to four passes occurred on three
separate days. Nothing in a tool answer told the session the budget was spent.

### The red phase exists only for bug fixes

`task-implement` records a red run (`verify` `action: "oracles"`, `expect: "fail"`) only in Step 6B,
on the bugfix path. The feature path (Steps 5F to 7F) runs oracles only with `expect: "pass"`, and
`marvin-tm-executor` mirrors that split. With a corpus made entirely of features, the delivery
gate's `red_green` field had nothing to read in any of the 19 decisions. The two red runs in the
erp journal were recorded on feature tasks without any step asking for them.

### Delivered specs stay `ready`

`task-deliver` Step 4 sets `status: shipped` and appends a `## Delivery` section. The headless
executor opens its PR with `gh pr create` directly and has no equivalent step, and it writes no
progress journal either. The erp specs `006`, `007` and `029` carry terminal metric blocks, are
tracked in git on `staging`, and still read `status: ready` with no `## Delivery` section. The
`029` terminal block states the second consequence itself: its time fields are absent because "no
progress journal is written on the headless path".

### Other measured facts

- **Lint is the most common first-run failure.** Across the three hosts, lint accounts for 6 of the
  9 failed gates in `verify` runs. A failed full run costs about two minutes on erp and osint.
- **Scope drift counts base-branch commits.** `changedFilesForScope` runs `git diff --name-only
  <base>` against the working tree, so commits that land on the base branch after the fork appear as
  undeclared changes. Most of erp's 691 undeclared paths are of this kind.
- **`scope.exempt` is inert on the hosts.** It shipped in 0.26.0 with no defaults, and no host
  config sets it, so the 14 by-product SPEC GAPs it was measured against would recur unchanged.

## Comparison with the current implementation

The current DoR gate (0.27.0) was run over all 55 host specs.

| Check | Result on the corpus | Assessment |
| ----- | -------------------- | ---------- |
| `oracle-filter` (#213) | FAIL on 2 specs, 3 oracles of the form `-t "--…"` | Real defects: vitest exits 1 on them, and the erp spec 019 oracles were never run |
| `spec-size` (#217) | warns on 54 of 55; median 2.45× the budget | No signal until specs are written in the ADR-0046 shape |
| `ac-length`, `intent-length` (#217) | warn on 51 and 33 specs | Same |
| `oracle-narrow` (#213) | warns on 5 specs | Plausible, unverified |
| `cite-lines`, `fcp-paths` | FAIL on 6 specs each | Not judgeable: the tree has already been changed by the implementation |

Beyond the DoR gate:

| Finding | Status in 0.27.0 |
| ------- | ---------------- |
| Spec critic cost and calibration | Economy category added (`[redundancy]`, `[drift]`, `[prose-only]`); BLOCK criteria unchanged. `[drift]` is a blocker, so the BLOCK rate may rise |
| Critic budgets | Unchanged, prose only |
| Red phase for features | Unchanged |
| By-product SPEC GAPs | `scope.exempt` available, not configured on any host |
| Two-dot scope diff | Unchanged |
| Headless status flip and progress journal | Unchanged |
| Lint before `verify` | Unchanged |
| `oracle-filter` wording | Still says the filter "selects nothing" and the oracle passes; measured on vitest 4.0.15 it crashes with `CACError: Unknown option` |

## Changes

Ordered by expected gain per unit of work.

### 1. Calibrate the spec critic

The critic's BLOCK should mean "this will cause rework if sealed", not "this could be better".

- In `marvin-tm-spec-critic`, state the blocker test explicitly: a finding is a blocker only when
  an implementer following the spec literally would build the wrong thing, miss an integration
  point, or be unable to prove a criterion. Everything else is a warning.
- Move `[drift]` to a warning unless the contradiction concerns a contract field (a `files` entry,
  a criterion, an oracle). Prose that drifts from the contract is deleted by the Economy rule
  anyway.
- Target, measured over the next ten specs: first-pass BLOCK below 50%, and a clearer rework gap
  between sealed-over-BLOCK and approved specs.

### 2. Make the critic budgets observable in a tool answer

The `metrics` tool already receives every `critic-dispatch` event with its `pass` number before the
dispatch happens. It can compare that number with the budget (two for the spec critic, one on the
light tier, one for the diff critic) and answer with an explicit `budget: "exceeded"` line and the
instruction to stop and present the survivors to the user. The event is still recorded, since
refusing it would only lose the measurement. The roll-up then reports `critic_budget_exceeded` per
task, and `/marvin:task-metrics` counts it.

This keeps the decision with the user and the session, while giving the session a signal that
survives compaction, which the prose budget does not.

### 3. Add a red phase to the feature path

In `task-implement` Step 5F and in `marvin-tm-executor`, before implementing a criterion whose
oracle is a test of new behaviour, write the test first and record one run with `expect: "fail"`.
One criterion per task is enough to make `red_green` meaningful; the rule can name the first
criterion with a `kind: test` oracle. A red run takes seconds (the erp oracle median is about half
a second).

`red_green` stays advisory. The delivery decision does not change.

### 4. Record delivery on the headless path

Give `marvin-tm-executor` the same Step 4 as `task-deliver`: after `gh pr create` succeeds, set
`status: shipped` and append `## Delivery`. Add `spec` `action: "progress"` entries at its phase
boundaries, as `task-implement` does, so headless tasks get time fields.

### 5. Count scope from the merge base

Change `changedFilesForScope` to diff from `git merge-base <base> HEAD` rather than from `<base>`.
Both callers (the scope gate and the Q1 roll-up) go through it, so they stay in agreement. The
no-base case (`HEAD`) is unchanged.

### 6. Suggest `scope.exempt` at the first by-product gap

When `task-implement` records a SPEC GAP whose path matches a common by-product shape (a lockfile,
a generated declaration file, an agent-memory file), the skill points the user at `scope.exempt`
with the matching pattern. Shipping defaults stays out of scope, as ADR-0045 decided.

### 7. Run lint before the full `verify`

In `task-implement` Step 6F, run `verify` with `only: ["lint"]` first, fix what it reports, then run
the full gate set. The lint pass costs seconds; the full run it prevents costs about two minutes.

### 8. Correct the `oracle-filter` wording

Change the check detail in `tools/spec.ts` and the 0.25.0 CHANGELOG entry: a test-name filter that
starts with `-` is parsed as an option and the runner exits with an error, so the oracle can never
pass. The check itself is correct; only the stated consequence is wrong.

## Order of work

1. Change 8, alone: a wording fix, one patch release.
2. Changes 4 and 5: independent, mechanical, each one PR.
3. Changes 2 and 3: they touch the metrics contract and both implementation paths; one PR each,
   with an ADR amending ADR-0036 for the feature red phase.
4. Change 1 after at least five specs have been written in the ADR-0046 shape, so that its effect is
   not confounded with the shape change.
5. Changes 6 and 7: small skill edits, any time.

## Measurement

Repeat this analysis after ten tasks on 0.27.0 or later, with the same scripts, and compare:

- first-pass spec-critic BLOCK rate and spec-critic share of intake time;
- the SPEC GAP and fix-round gap between sealed-over-BLOCK and approved specs;
- share of delivery decisions with `red_green` other than `unknown`;
- share of delivered specs with `status: shipped` and a terminal block;
- median spec size against the ADR-0046 budget.

## Out of scope

- Removing the spec critic. It still catches semantic defects the gate cannot, and its warnings
  carry most of the value; the problem is the verdict, not the review.
- Gating the diff critic by risk. On erp, 16 of 17 tasks were `risk: medium`, so a risk gate would
  skip almost nothing.
- Shipping default `scope.exempt` patterns (ADR-0045).

## Risks

- **A softer critic lets real defects through.** Mitigation: the blocker test in change 1 is
  written around rework, and the measurement compares rework before and after.
- **The feature red phase slows trivial tasks.** It is one test run per task, and a criterion
  without a test oracle is exempt.
- **One large project dominates the evidence.** The two smaller hosts agree on the directions
  (first-pass BLOCK, lint failures, no red runs) but not on magnitudes.

## Open questions

- Should change 2 also apply to a `NEEDS_CONTEXT` re-dispatch, which today keeps its own allowance?
- Which criterion carries the feature red phase when several have test oracles: the first, or the
  one the spec marks as primary?
