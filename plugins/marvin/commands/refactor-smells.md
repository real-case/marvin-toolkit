---
description: Scoped code-smell scan of a path, module, or diff — smells, anti-patterns, idiom and naming inconsistencies. Read-only; produces a numbered findings register under .marvin/refactor/.
---

# Code-Smell Scan

Scan a scoped part of the codebase for code smells and produce a findings register.

## Arguments

- `$ARGUMENTS` — The scope: a path (`src/api`), a module name, or a diff spec ("diff vs dev", "staged", a PR number)

## Instructions

**Read `skills/refactor-smells/SKILL.md`** and follow its full workflow (Phases 1–4 plus the closing board offer).

Pass `$ARGUMENTS` as the scope. If no scope was given, ask for one — whole-project work belongs to `/refactor-audit`.

## Examples

| Command                              | Behavior                                        |
| ------------------------------------ | ----------------------------------------------- |
| `/refactor-smells src/api`           | Smell scan of the API directory                 |
| `/refactor-smells the storage layer` | Smell scan of the storage module                |
| `/refactor-smells diff vs dev`       | Smell scan of the current branch's diff         |
