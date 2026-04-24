---
description: Commit changes and create a pull request. Refuses if verification failed. Delegates to core-pack mn.commit and mn.pr.
---

# Deliver

Commit and create a pull request for verified changes.

## Arguments

- `$ARGUMENTS` — Optional: additional context for commit message or PR body

## Instructions

**Read `skills/mn.taskmaster-deliver/SKILL.md`** and follow its full workflow.

Pass `$ARGUMENTS` as additional delivery context if provided.

## Examples

| Command | Behavior |
|---------|----------|
| `/mn.taskmaster-deliver` | Check verification, commit, create PR |
| `/mn.taskmaster-deliver closes #42` | Deliver with issue reference for PR |
