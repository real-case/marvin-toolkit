# Proposal: Spec Size Reduction

| Field      | Value |
| ---------- | ----- |
| Status     | Proposed |
| Date       | 2026-09-27 |
| Applies to | `task-start` skill and both spec templates, `marvin-tm-spec-critic` and `marvin-tm-executor` agents, the `spec` tool, the `.marvin/config.json` schema, the task-metrics roll-up |
| Principle  | Every fact lives in one place, and every section has a reader. |

## Summary

Specs produced by `/marvin:task-start` can shrink to about a third of their current size without
losing anything the Definition-of-Ready gate, the implementer or the critic needs. The corpus median
of 37 KB should fall to 12–15 KB.

Most of the size comes from paraphrase rather than from extra sections: one decision is restated in
eight or nine places, and those copies have already started to contradict the contract. The fix has
two halves. The section set shrinks from eighteen to nine permanent sections plus three optional
ones, and the remaining text is written under a "one fact, one place" rule with length limits on the
contract fields. The critic gains the ability to flag redundancy, so that its review loop stops
adding text on every pass.

## Evidence

### The corpus

The analysis covers 49 sealed specs from three host projects, 1.73 MB in total.

| Project | Specs | Median size | Largest |
| ------- | ----- | ----------- | ------- |
| `vantage-erp-1` | 42 | 37 KB | 59 KB |
| `vantage-tag-helper` | 1 | 48 KB | 48 KB |
| `osint-chat-client` | 6 | 22 KB | 37 KB |

Even the smallest spec is large for what it asks. `osint-chat-client` spec 001 adds one constant flag
to one request, touches three files and has three criteria, and it still runs to 12 KB.

### Where the bytes go

The contract block holds 41% of all bytes, and prose holds the rest.

| Section | Share of corpus bytes |
| ------- | --------------------- |
| Contract `criteria` | 21.3% |
| Contract `files` (mostly `intent`) | 17.1% |
| Context | 10.8% |
| Chosen Approach | 8.2% |
| Assumptions | 5.2% |
| Design Notes | 5.1% |
| Critic Verdict & Overrides | 5.0% |
| Why this over alternatives | 3.8% |
| Test Plan | 3.7% |
| Non-goals | 3.2% |
| Definition of Done | 2.5% |
| Security / NFR | 2.1% |
| Goal, Host Bindings, Future Considerations, Data & Config, frontmatter | 1.0–1.9% each |

### What the text is made of

Four specs were classified paragraph by paragraph into what the implementer needs to act, what
restates something said elsewhere, and six further categories. The split within a paragraph is a
judgement, so the figures are estimates.

| Spec | Size | Needed to act | Restated | Estimated minimum |
| ---- | ---- | ------------- | -------- | ----------------- |
| `osint` 006 organisation-branding-dashboard-display | 38.7 KB | 37% | 33% | ~14 KB (−64%) |
| `erp` 024 offer-groups | 54.5 KB | 37% | 27% | ~17 KB (−69%) |
| `tag-helper` 001 autocheck-events | 49.5 KB | 39% | 25% | ~16 KB (−65%) |
| `erp` 012 claude-md-stable-markers | 60.6 KB | 41% | 30% | ~19 KB (−67%) |

The remainder splits into rationale for a human reviewer (6–14%), content derivable from the
repository or its configuration (5–10%), critic history (4–9%), measurements and provenance (3–7%)
and future work (2–5%).

### Why specs grow

1. **Decisions are paraphrased, not copied.** Literal overlap is low: the median share of a
   section's word 4-grams that recur elsewhere in the same spec is at most 6.5%. The same decision,
   however, is restated in different words across sections. The cross-organisation check in
   offer-groups appears in eight places, the no-space marker rule in stable-markers in nine, and the
   allow-list rule in autocheck-events in nine.
2. **The copies drift from the contract.** In offer-groups, item 6 of Chosen Approach contradicts
   file row F11 after a critic fix changed only the contract. In `osint` 006, `satisfies` and
   `implemented_by` disagree on four file–criterion pairs in a sealed, shipped spec. In
   autocheck-events, six requirements exist only in prose, where neither the gate nor the critic can
   bind them to a proof.
3. **The critic pushes in one direction.** Every item of its checklist asks what is missing, and none
   asks what is redundant. Each finding is resolved by adding a paragraph. Spec size correlates with
   the number of critic receipts at r = 0.70: specs with no receipt have a median of 23 KB, and specs
   with three have a median of 47 KB. The critic's own instructions route `PASS WITH WARNINGS`
   findings into the spec's Future Considerations (`marvin-tm-spec-critic.md:40`).
4. **Growth happens while authoring.** Across the 41 `erp` specs with git history, the total size
   grew by 1.3% between the first commit and today. The text is written before the seal, inside the
   intake and critic loop.
5. **The template makes every section mandatory.** The gate requires 8 prose sections and recommends
   6 more (`tools/spec.ts:85`), but `task-start` Step 5F says "Fill every section". As a result, Data &
   Config carries a paragraph in 46 of 48 specs and Security / NFR in 46 of 46, while Deferred slices
   reads "none" in 33 of 40 and Open Questions in 49 of 49.
6. **The contract fields have no limits.**
   - AC statements have a median of 44 words, a 90th percentile of 92 and a maximum of 331. A plain
     Given/When/Then needs 20–25.
   - `failure` lines mostly negate the statement.
   - File `intent`s have a median of 28 words and a maximum of 567. The intent of a test file usually
     restates every criterion it covers.
   - `oracle.run` repeats the test file already named in `oracle.ref` in 283 of 289 cases, because
     none of the three projects configures `gates.test_one`.
   - `satisfies` and `implemented_by` are exact transposes, yet both are written by hand.
   - The Host Bindings block is rewritten for each spec: 40 `erp` specs carry 34 distinct blocks.
7. **It costs time.** In the 10 tasks with both measurements, intake takes a median of 31 minutes and
   implementation 22. The spec critic accounts for about half of intake time.

## Target

- The median spec is at most 15 KB, with 12 KB as the stretch goal.
- A size budget of `3 KB + 400 B per file + 500 B per criterion` holds for new specs. Every spec in
  the current corpus exceeds it: the median is 2.6 times the budget, the minimum 1.7 times and the
  maximum 5.3 times. At the corpus medians of 11 files and 9 criteria, the budget is about 12 KB.
- Quality does not regress. SPEC GAP counts and diff-critic blockers per task stay at or below the
  current baseline.

## Section cleanup

The new shape keeps a section only if a consumer reads it or a human needs it to review the
decision. The table records who reads each section today, verified by searching the skills, agents
and server code.

| Section | Reader today | Decision |
| ------- | ------------ | -------- |
| Goal | executor, spec critic, diff critic | Keep, one or two sentences |
| Context | spec critic, diff critic | Keep as pointers only; evidence moves to a sidecar |
| Spec Contract | gate, every agent | Keep |
| Chosen Approach | `task-implement`, executor, diff critic, review fixer | Keep, limited to what the contract does not say |
| Non-goals | diff critic (a violation is a blocker), executor, review fixer | Keep as a short list |
| Assumptions | human reviewer; the gate warns when empty | Keep, limited to defaults not visible in the contract |
| Open Questions | gate (must read "none") | Keep; it is a drafting device and costs 20 bytes |
| Critic Verdict & Overrides | gate (first line), `task-deliver` and executor render it on the PR | Keep as one line |
| Delivery | metrics roll-up reads the PR URL (`lib/metrics-collect.ts`) | Keep, written by `task-deliver` |
| Data & Config | none by name | Optional: write it only when there is a migration, variable, flag or config key |
| Security / NFR | none by name | Optional: required when `risk: high` or when the change touches auth, crypto, PII or input parsing |
| Deferred slices | the gate's placeholder check, only while the stub is unfilled | Optional: write it only when slices were deferred |
| Host Bindings | the gate reads `spec_location` only | Remove; the fields move to `.marvin/config.json` |
| Definition of Done | none by name | Remove; gate commands come from config, unusual obligations become criteria |
| Test Plan | none by name | Remove; harness comes from config, non-obvious test design goes into the test file's `intent` |
| Why this over alternatives | spec critic (strawman check) | Merge into Chosen Approach as at most three lines |
| Design Notes | executor | Merge into Chosen Approach as a list of traps |
| Future Considerations | none; the critic parks warnings here | Remove; follow-ups go to the tracker |

Removing sections alone saves about 15–20% of the corpus. The larger saving comes from the writing
rules below, because the paraphrase lives inside the sections that remain.

Two removed sections hold content that must survive. The Test Plan of stable-markers carries about
1.2 KB of mutation design, and the Definition of Done of offer-groups lists tests that must be watched
to fail. Before a section is removed, such content moves into the contract as a criterion, a
`failure` line or a test file's `intent`.

### The new feature spec skeleton

````markdown
---
slug: …
type: feature
status: draft
created: YYYY-MM-DD
tracker: …
risk: low | medium | high
…
---

# Title

## Goal
One or two sentences: what this delivers and why.

## Context
- Pattern to follow: `path/to/sibling.ts:42`
- Callers of the changed surface: `path/to/caller.ts:17`, `path/to/other.ts:88`
- Evidence: `.marvin/task/runs/<slug>.evidence.md`

## Spec Contract
```yaml spec-contract
…
```

## Chosen Approach
The part of the design the contract cannot carry.
- Order: …
- Traps: …
- Rejected: <variant> because <project constraint>.

## Non-goals
- …

## Assumptions
- Assumed X because Y; correct now if wrong.

## Open Questions
none

## Critic Verdict & Overrides
PASS WITH WARNINGS — receipts 046, 047; override: <finding> because <reason>.
````

The optional sections (Data & Config, Security / NFR, Deferred slices) follow Assumptions when they
apply, and `task-deliver` appends Delivery.

## Changes by phase

### Phase 1: template and writing rules

This phase changes prose only, so it needs no server rebuild. It is expected to deliver 40–50% of the
reduction on its own.

The feature template adopts the skeleton above. The bugfix template drops Host Bindings, Definition
of Done and Future Considerations, and folds Design Notes into Fix Approach. It keeps its Problem,
Reproduction, Root Cause Analysis and Regression Test sections, because the corpus holds only one
bugfix spec and gives no evidence against them.

`task-start` Step 5F replaces "Fill every section" with these rules:

- **One fact, one place.** A requirement lives in the contract, as a criterion or a file intent.
  Prose refers to it by id (`F3`, `AC2`) and never restates it. A requirement found only in prose is
  a defect, because nothing proves it.
- **Chosen Approach carries only what the contract cannot.** That means the order of work, the traps
  an implementer would fall into, cross-cutting decisions and at most three rejected alternatives.
- **Context is pointers, not evidence.** Each bullet is a `path:line` and one clause.
- **Evidence goes to a sidecar.** Measurements, probes and provenance go to
  `.marvin/task/runs/<slug>.evidence.md`, cited from Context in one line. The `runs/` subdirectory is
  already invisible to every spec enumerator, and `erp` specs already keep such files there.
- **The critic's narrative goes to the receipt.** Critic Verdict & Overrides records the verdict, the
  receipt numbers and any override in one line.

The template states limits on the contract fields:

| Field | Limit |
| ----- | ----- |
| `statement` | At most 30 words, as Given/When/Then, one behaviour per criterion |
| `failure` | One sentence naming a wrong implementation the oracle catches, not a negation of the statement |
| `intent` | At most two sentences on what changes in this file; a test file's intent names the criteria it covers and any non-obvious fixture |
| `contract.signature` | The exact surface, with no comments that restate criteria |
| `oracle.run` | Omitted when `gates.test_one` derives it |
| Anywhere in the contract | No rationale, history or evidence, because the contract is sealed by `contract_sha` |

`marvin-tm-executor` reads Design Notes today, so its Step 1 list changes to read the traps in Chosen
Approach instead. Step 4.5F's "Keep the scope" branch records its rationale in Chosen Approach rather
than in Design Notes.

Files touched: `skills/task-start/SKILL.md`, both files under `skills/task-start/references/`,
`agents/marvin-tm-executor.md`, and `mcp/server/test/spec-templates.test.mjs`, which pins the
template stubs.

### Phase 2: the critic as a counterweight

The critic keeps every substantive check it has. It catches real defects, such as the AC15 oracle in
stable-markers that could not pass on a correct implementation. What changes is that it can now also
ask for text to be removed, and how its findings are resolved.

- A new checklist category, "Economy", adds three findings:
  - `[redundancy]` flags a decision restated outside the place it lives, as a warning.
  - `[drift]` flags a restatement that contradicts the contract, as a blocker.
  - `[prose-only]` flags a requirement that exists only in prose and must move into the contract, as
    a warning.
- Criteria that describe design rather than observable behaviour are reported under the existing
  acceptance-criteria category.
- The instruction to attach `PASS WITH WARNINGS` findings to Future Considerations is removed.
- `task-start` Steps 8F and 8B add a resolution rule: resolve a finding by editing the lines it names,
  and do not add a paragraph that explains the fix. The receipt under `.marvin/critique/` already
  records how each finding was handled.
- The dispatch passes the size budget to the critic, which reports an over-budget spec as a warning.

Files touched: `agents/marvin-tm-spec-critic.md` and `skills/task-start/SKILL.md`.

### Phase 3: mechanics in the `spec` tool and configuration

This phase locks the rules in so that they do not depend on the model remembering them. All changes
loosen or add advisory checks, so sealed specs keep passing and the release is a minor version.

- **The required section list shrinks.** `FEATURE_REQUIRED` becomes Goal, Chosen Approach,
  Non-goals and Open Questions. `FEATURE_RECOMMENDED` becomes Context, Assumptions and Critic Verdict
  & Overrides. The gate warns when `risk: high` and Security / NFR is absent.
- **Host bindings move to configuration.** Three of the four fields already have a home.
  `spec_location` maps to `spec.dir` (ADR-0037), `decision_record.path` maps to `adr.dir`, and `gates`
  maps to `gates` (ADR-0009). The fourth field, `merge_obligations`, becomes a new optional
  `string[]` key. `task-start` proposes the block once per project and writes it after the user
  confirms. A spec that still carries the block keeps passing.
- **`gates.test_one` is proposed on first run.** When it is absent, `task-start` proposes a template
  such as `npx vitest run {file} -t "{name}"`. The resolution chain in `storage/oracles.ts` already
  substitutes `{file}` and `{name}`, so no code change is needed for this part.
- **One traceability direction is derived.** `implemented_by` on the criterion stays hand-written,
  and `satisfies` becomes optional and is derived wherever it is read. The gate keeps failing a
  declared `satisfies` list that disagrees, so older specs are still checked.
- **Advisory size checks are added.**
  - `spec-size` warns when the file exceeds the budget formula.
  - `ac-length` warns on a statement over 40 words.
  - `intent-length` warns on an intent over 60 words.

  Each is a warning, like the Assumptions check, so no sealed spec becomes undispatchable.

A new ADR records the new spec shape. It amends ADR-0003 (the required section list) and ADR-0005
(host bindings inside the spec).

Files touched: `mcp/server/src/tools/spec.ts`, `mcp/server/src/storage/spec.ts`, the config schema
in `mcp/server/src/storage/schema.ts`, `mcp/server/test/spec.test.mjs`, a new ADR, the committed
`dist/server.js`, and the version bump.

### Phase 4: tiers and the split threshold

- **A numeric trigger for the scope gate.** The one-PR test in `references/routing.md` is
  qualitative today. A spec with more than 15 files or more than 12 criteria must present the split
  explicitly at Step 4.5F. That applies to 20 of the 49 specs in the corpus, including four `erp`
  specs with 29–31 files.
- **A light tier.** A spec with `risk: low` and at most five files gets one critic dispatch instead
  of two, and Context becomes optional. `osint` 001 would fit in about 4 KB under this tier.

Files touched: `skills/task-start/SKILL.md` and `skills/task-start/references/routing.md`.

### Phase 5: measurement and pilot

- **Measure spec size.** The task-metrics roll-up gains `spec_bytes` and `spec_words`, read from the
  spec at roll-up time, and `/marvin:task-metrics` reports them in the series. The baseline is the
  corpus above: a median of 37 KB and 31 minutes of intake.
- **Pilot on shipped work.** Rewrite offer-groups and autocheck-events under the Phase 1 rules. A
  fresh agent then compares each lean spec against the diff that actually shipped, confirms that
  every change in the diff is traceable to the lean spec, and lists anything that was lost.
- **Evaluate on new tasks.** Compare the next ten tasks against the baseline on spec size, intake
  time, spec-critic time, SPEC GAP count and diff-critic blockers.

Files touched: `mcp/server/src/lib/metrics-rollup.ts`, `lib/metrics-collect.ts`,
`lib/metrics-series.ts` and the metrics contract, which together make a minor version.

## Order of work

Phases 1 and 2 go first, because they deliver most of the reduction by changing prose only. The pilot
from Phase 5 runs right after them, before any server change, so that the rules are tested on
real specs before the gate enforces them. Phase 3 then makes the rules mechanical, and Phase 4 comes
last.

## Out of scope

- **The critic's substantive checks.** Only the way its findings are resolved changes.
- **Rationale for human reviewers.** It moves to the evidence sidecar or the PR body. It is not
  deleted.
- **Sealed specs.** Existing specs stay as they are. Rewriting a contract would change its
  `contract_sha` and invalidate its oracle journal.

## Risks

- **Executable content can hide in a removed section.** Phase 1 moves such content into the contract
  before the section goes, and the pilot checks lean specs against shipped diffs.
- **The implementer can lose the reason behind a decision.** The traps list keeps every non-obvious
  constraint, and the sidecar keeps the full rationale one link away.
- **A host can have no configuration.** `task-start` proposes the configuration block on first run
  and writes it only after the user confirms, as it already does for other host conventions.

## Open questions

1. Should `implemented_by` or `satisfies` be the hand-written direction? This proposal keeps
   `implemented_by` because it sits on the criterion, where the gate and the critic look first.
2. Should the size check ever fail a spec? This proposal keeps it a warning and revisits the question
   after twenty specs have been written under the new rules.
3. Should the light tier skip the critic entirely instead of running it once?
