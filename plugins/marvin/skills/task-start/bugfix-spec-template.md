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
{Severity from frontmatter, plus blast radius: how many users / flows are affected.}

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
    failure: passes before the fix → the test does not exercise the bug
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

## Assumptions
{Decisions made under uncertainty. "none" if there are none.}

## Open Questions
{MUST be "none" before the DoR gate passes. A genuine unknown that needs investigation is NOT an
Assumption: set `spike_required: true` and resolve it first.}

## Critic Verdict & Overrides
{marvin-tm-spec-critic verdict; any author override. "none" if skipped — a skipped critic is
surfaced in the PR, never silent.}

## Design Notes
{Related bugs, workarounds to remove, potential side effects of the fix.}
