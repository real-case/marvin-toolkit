---
description: Roll back an accepted ADR properly — a successor record supersedes it via the adr tool; links pair both ways, the old record's status flips, its content is never edited. Human-run.
---

# ADR Supersede

Supersede a decision record with a successor.

## Arguments

- `$ARGUMENTS` — Optional: the record being superseded (number or title fragment), optionally with the replacement title or successor number

## Instructions

**Read `skills/adr-supersede/SKILL.md`** and follow its full workflow (steps 1–4).

Pass `$ARGUMENTS` as the target (and successor, if named) if provided.

## Examples

| Command                                      | Behavior                                                  |
| -------------------------------------------- | --------------------------------------------------------- |
| `/adr-supersede`                             | Ask which decision is being rolled back                   |
| `/adr-supersede 7 Split the working dirs`    | Create a proposed successor skeleton and flip ADR-0007    |
| `/adr-supersede 7 with 31`                   | Pair existing ADR-0031 as ADR-0007's successor            |
