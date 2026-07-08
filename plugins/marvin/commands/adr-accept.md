---
description: Ratify a proposed ADR — proposed → accepted with a date stamp, through the adr tool's fail-closed readiness gate. Human-run.
---

# ADR Accept

Ratify one proposed decision record.

## Arguments

- `$ARGUMENTS` — Optional: the record to ratify — a number (`31`, `0031`) or a title fragment

## Instructions

**Read `skills/adr-accept/SKILL.md`** and follow its full workflow (steps 1–3).

Pass `$ARGUMENTS` as the target record if provided.

## Examples

| Command            | Behavior                                           |
| ------------------ | -------------------------------------------------- |
| `/adr-accept`      | List proposed records and ask which one to ratify  |
| `/adr-accept 31`   | Ratify ADR-0031 (gate-checked, stamped with today) |
