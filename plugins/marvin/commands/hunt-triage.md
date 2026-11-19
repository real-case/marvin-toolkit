---
description: Triage the bug-hunter ledger — merge duplicates, group systemic patterns, re-verify stale findings, rank what is open and write one report under .marvin/hunt/reports/.
---

# Triage the hunt ledger

Rank and clean up everything the hunts have recorded.

## Arguments

- `$ARGUMENTS` — Optional: a focus (e.g. "only critical", "billing").

## Instructions

**Read `skills/hunt-triage/SKILL.md`** and follow its workflow. Pass `$ARGUMENTS` as the focus if provided.

## Examples

| Command                      | Behavior                                   |
| ---------------------------- | ------------------------------------------ |
| `/hunt-triage`               | Triage the whole ledger and write a report |
| `/hunt-triage only critical` | Same, presenting the critical ones first   |
