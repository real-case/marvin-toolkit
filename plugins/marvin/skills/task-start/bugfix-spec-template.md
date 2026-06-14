---
slug: {kebab-case-slug}
type: bugfix
status: ready
created: {YYYY-MM-DD}
tracker: {#issue | PROJ-123 | URL | none}
supersedes: {prior-slug | none}
stack: {verified primary stack, e.g. typescript | none}
severity: {critical | high | medium | low}
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
- Impact scope: {what else may be affected}

## Severity & Impact
{Severity from frontmatter, plus blast radius: how many users / flows are affected.}

## File Change Plan
Authoritative allowlist. The implementer/executor MUST NOT touch files not listed here.
A minimal fix touches few files; a long list is a signal the fix is not minimal.

| Path | Action | Intent | Anchor |
|------|--------|--------|--------|
| {path/to/file} | edit | {the minimal change that fixes the root cause} | {file:line} |
| {path/to/test} | new | regression test (see Regression Test Specification) | — |

## Fix Approach
{The minimal change that addresses the root cause — nothing else. No adjacent refactoring.}

**Why this over alternatives:** (if alternatives existed)
- {alternative}: {reason for rejection}

## Acceptance Criteria
`verified_by` names a test, a command, or "prose-review" — never empty.

| ID | Criterion | verified_by | Failure path |
|----|-----------|-------------|--------------|
| AC-1 | Bug is not reproducible after the fix | {test/path::name} | {reproduces as before} |
| AC-2 | Regression test fails on pre-fix code, passes after | {test/path::name} | {passes before fix → test is wrong} |
| AC-3 | {additional behavioral criterion} | {…} | {…} |

## Regression Test Specification
**Test type:** unit | integration | e2e
**Test location:** {path to test file}
**What test verifies:** {specific behavior}
**Test must fail before fix:** yes (mandatory)

## Non-goals
- {what we explicitly do NOT fix in this task}

## Assumptions
{Decisions made under uncertainty. "none" if there are none.}

## Open Questions
{MUST be "none" before the DoR gate passes.}

## Critic Verdict & Overrides
{marvin-tm-spec-critic verdict; any author override. "none" if skipped.}

## Design Notes
{Related bugs, workarounds to remove, potential side effects of the fix.}
