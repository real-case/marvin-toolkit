---
description: Plan a migration or major refactoring with dependency analysis, steps, risks, and rollback strategy.
---

# Migration Plan

Create a structured migration or refactoring plan.

## Arguments

- `$ARGUMENTS` — Optional: description of the migration (e.g. "upgrade React 18 to 19" or "migrate from REST to gRPC")

## Instructions

**Read `skills/migration-plan/SKILL.md`** and follow its full workflow (Phases 1–3).

Pass `$ARGUMENTS` as the migration description if provided.

## Examples

| Command                                    | Behavior                                      |
| ------------------------------------------ | --------------------------------------------- |
| `/migration-plan`                        | Ask what's being migrated, then plan           |
| `/migration-plan upgrade to Next.js 16`  | Analyze impact and create upgrade plan         |
| `/migration-plan move auth to Clerk`     | Plan service migration with rollback strategy  |
