---
description: Hunt for real defects in code — map flows, rank hotspots, hunt in batches, challenge each claim with a skeptic and a referee, prove bugs with reproducing tests. Records findings in the .marvin/hunt/ ledger; never fixes them.
---

# Hunt for defects in code

Find, challenge and prove defects in the configured scope, detect-only.

## Arguments

- `$ARGUMENTS` — Optional: path prefixes or globs, `since <ref>`, or `diff`.

## Instructions

**Read `skills/hunt-code/SKILL.md`** and follow its full workflow (steps 1–8). Pass `$ARGUMENTS` as the scope if provided.

## Examples

| Command                  | Behavior                                              |
| ------------------------ | ----------------------------------------------------- |
| `/hunt-code`             | Hunt the configured scope                             |
| `/hunt-code src/billing` | Hunt one directory                                    |
| `/hunt-code since dev`   | Hunt only files changed since the merge base with dev |
| `/hunt-code diff`        | Hunt the uncommitted diff                             |
