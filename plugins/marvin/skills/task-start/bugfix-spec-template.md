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

## File Change Plan
Authoritative allowlist. The implementer/executor MUST NOT touch files not listed here.
A minimal fix touches few files; a long list is a signal the fix is not minimal. The regression
test MUST appear here as a row, and `Satisfies` links each file to the criteria it serves.

| ID | Path | Action | Intent | Satisfies | Anchor |
|----|------|--------|--------|-----------|--------|
| F1 | {path/to/file} | edit | {the minimal change that fixes the root cause} | AC-1 | {file:line} |
| F2 | {path/to/test} | new | regression test (see Regression Test Specification) | AC-1, AC-2 | — |

## Fix Approach
{The minimal change that addresses the root cause — nothing else. No adjacent refactoring.}

**Why this over alternatives:** (if alternatives existed)
- {alternative}: {reason for rejection}

## Acceptance Criteria
Each criterion is traced to the File-Change-Plan rows that implement it and bound to a proof.
A test path named in `verified_by` MUST also appear as a File Change Plan row.

| ID | Given / When / Then | Implemented by | verified_by | Failure path |
|----|---------------------|----------------|-------------|--------------|
| AC-1 | Given the trigger, when run after the fix, then correct behavior | F1, F2 | {test/path::name} | {reproduces as before} |
| AC-2 | Regression test fails on pre-fix code, passes after | F2 | {test/path::name} | {passes before fix → test is wrong} |
| AC-3 | {additional behavioral criterion} | {…} | {…} | {…} |

## Regression Test Specification
**Test type:** unit | integration | e2e
**Test location:** {path to test file — MUST match its File Change Plan row}
**What test verifies:** {specific behavior}
**Test must fail before fix:** yes (mandatory)

## Definition of Done
- [ ] regression test red before fix, green after
- [ ] {test_command} green
- [ ] lint / type-check / build green
- [ ] repo-specific obligations (e.g. version bump + dist rebuild) — or "none"

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
