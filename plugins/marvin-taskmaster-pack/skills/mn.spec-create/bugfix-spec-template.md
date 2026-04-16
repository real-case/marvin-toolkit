# Bugfix: {short bug description}
Type: bugfix
Created: {date}
Status: ready
Severity: critical | high | medium | low

## Problem
{what happens — observed behavior}

## Expected Behavior
{what should happen}

## Reproduction Steps
1. {exact step}
2. {exact step}
3. {observed result}

**Frequency:** always | intermittent | rare

## Root Cause Analysis
- Affected code: {files and lines}
- Cause: {description of the cause}
- Impact scope: {what else may be affected}

## Fix Approach
{description of the fix approach}

**Why this over alternatives:** (if alternatives existed)
- {alternative}: {reason for rejection}

## Acceptance Criteria
- [ ] Bug is not reproducible after fix
- [ ] Regression test is added and passes
- [ ] Regression test fails on code before fix
- [ ] {additional criteria}

## Non-goals
- {what we explicitly do NOT fix in this task}

## Regression Test Specification
**Test type:** unit | integration | e2e
**Test location:** {path to test file}
**What test verifies:** {specific behavior}
**Test must fail before fix:** yes (mandatory)

## Design Notes
{context — related bugs, workarounds to remove,
potential side effects of the fix}
