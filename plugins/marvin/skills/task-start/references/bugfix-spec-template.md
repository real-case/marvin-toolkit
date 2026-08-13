---
slug: {kebab-case-slug}
type: bugfix
status: ready
created: {YYYY-MM-DD}
tracker: {#issue | PROJ-123 | URL | none}
supersedes: {prior-slug | none}
stack: {verified stack(s), comma-separated, e.g. typescript, shell | none}
severity: {critical | high | medium | low}
spike_required: false
test_command: {command that runs the tests, e.g. "npm test" | none}
---

# {Short bug description}

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
- Impact scope: {what else may be affected}

## Severity & Impact
{severity from frontmatter, plus blast radius}
How many users, and which flows, are affected.

## Spec Contract
The authoritative, machine-validated contract (the `spec` DoR gate parses and schema-checks this
block). The implementer/executor may touch **only** the files in `files`; a minimal fix touches
few. The regression test MUST be a `files` row, and **one criterion MUST carry `regression: true`**
(it asserts the test fails on pre-fix code and passes after). Use `<…>` for prose to fill; never
leave a `{…}` placeholder (it parses as a YAML map and fails the gate).

```yaml spec-contract
files:
  - id: F1
    path: path/to/file.ts
    action: edit          # new | edit | delete
    intent: the minimal change that fixes the root cause
    satisfies: [AC1]
    anchor: path/to/file.ts:42
  - id: F2
    path: test/path.test.ts
    action: new
    intent: regression test (see Regression Test Specification)
    satisfies: [AC1, AC2]
depends_on: []              # sibling spec slugs this depends on; each MUST be status: shipped (or [])
criteria:
  - id: AC1
    statement: Given the trigger, when run after the fix, then correct behaviour
    implemented_by: [F1, F2]
    oracle:
      kind: test
      ref: test/path.test.ts::the test name
    failure: reproduces as before
  - id: AC2
    statement: The regression test fails on pre-fix code and passes after the fix
    implemented_by: [F2]
    regression: true        # mandatory for a bugfix — the red→green proof
    oracle:
      kind: test
      ref: test/path.test.ts::the test name
      run: <exact command>  # optional — how to run THIS test alone. Without it the runner falls
                            # back to `gates.test_one` in .marvin/config.json, then to a narrow
                            # per-stack default, then records `not-run` rather than guessing.
    failure: passes before the fix → the test does not exercise the bug
```

A `regression: true` criterion's red→green pair is **recorded, not narrated**:
`/marvin:task-implement` calls the `verify` tool's `action: "oracles"` once with `expect: "fail"`
before the fix and once with `expect: "pass"` after it, and the delivery gate reads the resulting
journal — a red and a green at the same `contract_sha` over an unchanged test file — as
`red_green: "proven"`. Anything else, including a pair that was run by hand, reads as `missing`.
That is a warning on the gate's reason line today and does not block delivery.

## Host Bindings
Discovered from **this repo**, not assumed. Optional and advisory — the gate uses `spec_location` to
resolve `depends_on`; the rest records where the spec lives and what the host requires to merge. Fill
with `<…>`, never `{…}`.

```yaml host-bindings
spec_location: .marvin/task/     # where specs/RFCs live (default .marvin/task/, or the host's own convention)
decision_record:
  style: <madr | nygard | none>
  path: docs/adr/
merge_obligations:
  - <e.g. "ruff + mypy green (.pre-commit-config)">
gates:
  test: <the test command>
```

## Fix Approach
{The minimal change that addresses the root cause — nothing else. No adjacent refactoring.}

**Why this over alternatives:** (if alternatives existed)
- {alternative}: {reason for rejection}

## Regression Test Specification
**Test type:** unit | integration | e2e
**Test location:** {path to test file — MUST match its `files` row in the contract}
**What test verifies:** {specific behavior}
**Test must fail before fix:** yes (mandatory)

## Definition of Done
- [ ] regression test red before fix, green after
- [ ] {test_command} green
- [ ] lint / type-check / build green (whichever the host runs)
- [ ] host-specific merge obligations (e.g. a version bump, a committed build artefact) — or "none"

## Non-goals
- {what we explicitly do NOT fix in this task}

## Deferred slices
Slices split off from this task at the scope gate, each already a board card. The rows are
descriptive — the card is the work item, this list is the back-reference. Write `none` when nothing
was deferred: an unfilled section is reported by the DoR gate, an absent one is silent.

- {board id + one-line scope + why it is a separate PR, or none}

## Assumptions
{Decisions made under uncertainty. "none" if there are none.}
Every default the intake assumed instead of asking belongs here, written as "assumed X because Y;
correct now if wrong". "none" is an accepted value; the DoR gate records it as an advisory warning,
not a failure.

## Open Questions
{any question still unresolved — MUST be "none" before DoR passes}
A genuine unknown that needs investigation is NOT an Assumption: set `spike_required: true` and
resolve it first.

## Critic Verdict & Overrides
{marvin-tm-spec-critic verdict (PASS | PASS WITH WARNINGS | BLOCK | UNABLE); any author override.
The DoR gate reads the verdict off the first non-empty line, so write the token in capitals there. It
may lead the line ("BLOCK — resolved in this revision") or follow the critic's name
("marvin-tm-spec-critic — **PASS WITH WARNINGS**"); a lower-case mention inside prose is not read as
a verdict, and "none" is recognised only leading the line. NEEDS_CONTEXT is never recorded here — it
resolves on the re-dispatch or becomes UNABLE. "none" if skipped — a skipped critic is surfaced in
the PR, never silent, and an UNABLE verdict ("UNABLE — {reason}") is surfaced the same way.}

## Design Notes
{Related bugs, workarounds to remove, potential side effects of the fix.}
