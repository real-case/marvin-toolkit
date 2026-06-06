---
description: Fast security check on staged or recent changes. Lightweight pre-commit gate.
---

# Security Gate

Quick security check scoped to your current diff — run before committing.

## Arguments

- `$ARGUMENTS` — Optional: commit range (e.g. "HEAD~3..HEAD") or specific files to check

## Instructions

**Read `skills/sec-gate/SKILL.md`** and follow its full workflow (Phases 1–5).

Pass `$ARGUMENTS` to scope the check if provided.

## Examples

| Command                            | Behavior                                              |
| ---------------------------------- | ----------------------------------------------------- |
| `/sec-gate`                     | Check staged changes (or last commit if nothing staged)|
| `/sec-gate HEAD~3..HEAD`        | Check the last 3 commits                              |
| `/sec-gate src/auth/login.ts`   | Check specific file only                               |
