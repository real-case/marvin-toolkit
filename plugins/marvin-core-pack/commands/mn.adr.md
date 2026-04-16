---
description: Create an Architecture Decision Record documenting a technical decision.
---

# ADR

Create an Architecture Decision Record.

## Arguments

- `$ARGUMENTS` — Optional: decision title (e.g. "Use PostgreSQL for user data") or title with context flag ("Use Redis --context docs/research.md")

## Instructions

**Read `skills/mn.adr/SKILL.md`** and follow its full workflow (Phases 1–4).

Pass `$ARGUMENTS` as the ADR title and flags if provided.

## Examples

| Command                                          | Behavior                                      |
| ------------------------------------------------ | --------------------------------------------- |
| `/mn.adr`                                         | Ask what decision to document                 |
| `/mn.adr Use PostgreSQL for user data`            | Draft ADR with the given title                |
| `/mn.adr Use Redis --context docs/research.md`   | Draft ADR using research notes as input       |
