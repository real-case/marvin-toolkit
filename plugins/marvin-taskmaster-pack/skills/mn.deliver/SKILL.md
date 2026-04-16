---
description: Commit changes and create a pull request, delegating to core-pack skills. Refuses to deliver if verification failed. Final phase of taskmaster pipelines.
---

# Deliver

Commit changes and create a pull request. This is the final phase — it gates on successful verification and delegates the actual commit/PR creation to core-pack skills.

## Core principle

**Don't ship unverified code.** Delivery is the last gate. It checks that verification passed, then delegates to the battle-tested commit and PR workflows from core-pack.

## Workflow

### 1. Check verification

Look for verification report:
1. Check `.taskmaster/current-task/verification.md`
2. If not found, check if verification results exist in conversation context

**If no verification found:** stop and tell the user — "Verification has not been run. Run `/mn.verify` before delivering."

**If the verdict is FAIL:** stop and tell the user — "Verification failed. Fix the issues and re-run `/mn.verify` before delivering." Show the failing checks from the verification report.

**If the verdict is PASS or PASS WITH WARNINGS:** proceed. If there are warnings, show them to the user and confirm they want to proceed.

### 2. Commit

Follow the `/mn.commit` workflow.

When composing the commit:
- Use the spec title as the commit scope/subject
- Reference the spec for the "why" in the commit body — what problem this solves or what feature this delivers
- Read spec for context: check `specs/` directory first (match by slug from conversation), fall back to `.taskmaster/current-task/spec.md`

### 3. Create pull request

Follow the `/mn.pr` workflow.

When composing the PR:
- Include the spec summary in the PR body
- Include the verification results summary
- Reference the original issue/ticket if one was identified during intake
- If spec is v2.0 format (from `specs/`), use the v2.0 PR body structure:

```markdown
## Summary
{from spec goal/problem statement}

## Spec Reference
`specs/{slug}.md`

## Changes
{key changes grouped by area}

## Self-Review Notes
{any concerns or trade-offs noted}

## Tests
- [ ] New tests written for acceptance criteria
- [ ] Regression test (bugfix only)
- [ ] All existing tests pass
```

### 4. Preserve artifacts

Do NOT delete `.taskmaster/current-task/` artifacts. They serve as documentation:
- `spec.md` — what was intended
- `plan.md` — how it was implemented
- `verification.md` — that it was verified

## Guidelines

- **Never bypass the verification gate.** If verification wasn't run or failed, refuse to deliver. This is the whole point of the pipeline.
- **Delegate, don't duplicate.** The commit and PR workflows are in core-pack — use them via command invocation. Don't re-implement commit message generation or PR body formatting.
- **Enrich, don't replace.** Add spec/plan/verification context to the commit and PR, but let the core-pack workflows handle their standard checks (sensitive files, pre-flight, etc.).
- **Artifacts are documentation.** After delivery, the `.taskmaster/` directory is a record of the decision process. Users can archive or clean up at their discretion.
