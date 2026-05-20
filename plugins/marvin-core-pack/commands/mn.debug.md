---
description: Systematic debugging with structured root-cause analysis. Describe the bug or paste an error message.
---

# Debug

Debug a bug using structured root-cause analysis.

## Arguments

- `$ARGUMENTS` — Optional: error message, symptom description, or file path to investigate

## Instructions

**Read `skills/mn.debug/SKILL.md`** and follow its full workflow (Phases 1–6).

Pass `$ARGUMENTS` as the initial symptom description if provided.

## Examples

| Command                                        | Behavior                                  |
| ---------------------------------------------- | ----------------------------------------- |
| `/mn.debug`                                     | Ask for symptom, then run full analysis   |
| `/mn.debug TypeError in auth middleware`         | Start analysis from the described symptom |
| `/mn.debug src/api/handler.ts:42`               | Investigate the specified location         |
