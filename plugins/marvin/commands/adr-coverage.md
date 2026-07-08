---
description: Read-only gap analysis — recorded ADRs vs the decisions visible in the actual stack (dependencies, infra, CI, architectural seams); ranks undocumented decisions by blast radius.
---

# ADR Coverage

Find the significant decisions the corpus does not record.

## Arguments

- `$ARGUMENTS` — Optional: focus area (e.g. "infra", "the storage layer")

## Instructions

**Read `skills/adr-coverage/SKILL.md`** and follow its full workflow (Phases 1–5).

Pass `$ARGUMENTS` as the focus area if provided.

## Examples

| Command               | Behavior                                              |
| --------------------- | ----------------------------------------------------- |
| `/adr-coverage`       | Whole-project gap analysis, candidates ranked         |
| `/adr-coverage infra` | Gap analysis with a deeper look at infrastructure     |
