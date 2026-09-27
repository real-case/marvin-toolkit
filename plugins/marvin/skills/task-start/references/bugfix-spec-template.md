---
slug: {kebab-case-slug}
type: bugfix
status: draft
created: {YYYY-MM-DD}
tracker: {#issue | PROJ-123 | URL | none}
supersedes: {prior-slug | none}
stack: {verified stack(s), comma-separated, e.g. typescript, shell | none}
severity: {critical | high | medium | low}
spike_required: false
test_command: {command that runs the tests, e.g. "npm test" | none}
---

# {Short bug description}

<!-- Writing rules (delete this comment). One fact, one place: a requirement lives in the contract,
as a criterion or a file intent, and prose refers to it by id (F1, AC2) without restating it.
Measurements, logs and probes go to the evidence sidecar, and the critic's narrative stays in its
receipt. Size budget: 3 KB + 400 B per file + 500 B per criterion; the DoR gate warns above it. -->

## Problem
{What happens — observed behavior.}

## Expected Behavior
{What should happen instead.}

## Reproduction Steps
1. {exact step}
2. {exact step}
3. {observed result}

**Frequency:** always | intermittent | rare

## Root Cause Analysis
- Affected code: {files and lines}
- Cause: {the specific mechanism, supported by evidence — not a guess}
- Callers / blast radius: {who exercises the affected path — file:line, or "none"}
- Evidence: {.marvin/task/runs/<slug>.evidence.md, or none}

## Severity & Impact
{severity from frontmatter, plus blast radius}
How many users, and which flows, are affected.

## Spec Contract
The authoritative contract, parsed and schema-checked by the `spec` DoR gate and sealed by
`contract_sha`. The implementer may touch **only** the files in `files`; a minimal fix touches few.
The regression test MUST be a `files` row, and **one criterion MUST carry `regression: true`** (it
asserts the test fails on pre-fix code and passes after). Use `<…>` for prose to fill; a `{…}`
placeholder parses as a YAML map and fails the gate. The field limits of the feature template apply
here too: a `statement` of at most 30 words, a `failure` that names a wrong implementation, an
`intent` of at most two sentences, no `oracle.run` when `gates.test_one` derives it, `satisfies`
optional, and no rationale anywhere in the block.

```yaml spec-contract
files:
  - id: F1
    path: path/to/file.ts
    action: edit          # new | edit | delete
    intent: <the minimal change that fixes the root cause>
    anchor: path/to/file.ts:42
  - id: F2
    path: test/path.test.ts
    action: new
    intent: <regression test covering AC1 and AC2>
depends_on: []              # sibling spec slugs; each MUST be status: shipped
criteria:
  - id: AC1
    statement: Given the trigger, when run after the fix, then correct behaviour
    implemented_by: [F1, F2]
    oracle:
      kind: test
      ref: test/path.test.ts::the test name
    failure: <a wrong fix this test catches>
  - id: AC2
    statement: The regression test fails on pre-fix code and passes after the fix
    implemented_by: [F2]
    regression: true        # mandatory for a bugfix — the red→green proof
    oracle:
      kind: test
      ref: test/path.test.ts::the test name
    failure: passes before the fix, so the test does not exercise the bug
```

A `regression: true` criterion's red→green pair is **recorded, not narrated**:
`/marvin:task-implement` calls the `verify` tool's `action: "oracles"` once with `expect: "fail"`
before the fix and once with `expect: "pass"` after it, and the delivery gate reads the resulting
journal — a red and a green at the same `contract_sha` over an unchanged test file — as
`red_green: "proven"`. Anything else, including a pair that was run by hand, reads as `missing`.
That is a warning on the gate's reason line today and does not block delivery.

## Fix Approach
{The minimal change that addresses the root cause — nothing else. No adjacent refactoring.}

- {Traps: side effects of the fix, workarounds to remove, related bugs}
- {Rejected: alternative because of a project constraint, if one existed}

## Regression Test Specification
**Test type:** unit | integration | e2e
**Test location:** {path to test file — MUST match its `files` row in the contract}
**What test verifies:** {the criterion ids it proves, and the trigger it uses}
**Test must fail before fix:** yes (mandatory)

## Non-goals
- {what we explicitly do NOT fix in this task}

## Assumptions
{Decisions made under uncertainty. "none" if there are none.}
Every default the intake assumed instead of asking belongs here, written as "assumed X because Y;
correct now if wrong". "none" is an accepted value; the DoR gate records it as an advisory warning,
not a failure.

## Deferred slices
Optional: keep this section only when sibling patterns were deferred at the scope gate. Each row is a
board card already created.

- {board id + one-line scope + which one-PR condition failed}

## Open Questions
{any question still unresolved — MUST be "none" before DoR passes}
A genuine unknown that needs investigation is NOT an Assumption: set `spike_required: true` and
resolve it first.

## Critic Verdict & Overrides
{VERDICT — receipts NNN, NNN; override: finding because reason}
One line. The DoR gate reads the verdict off the first non-empty line, so write the token in
capitals there (`PASS`, `PASS WITH WARNINGS`, `BLOCK`, `UNABLE — <reason>`), or "none — critic
skipped". NEEDS_CONTEXT is never recorded here. The critic's narrative stays in its receipt under
`.marvin/critique/`.
</content>
</invoke>
