---
description: Regenerate the marker-managed "Architecture decisions" digest in CLAUDE.md from accepted ADRs only — diff shown, explicit confirmation before writing. Human-run.
---

# ADR Sync

Sync the accepted decisions into the project memory.

## Arguments

- `$ARGUMENTS` — none expected; ignore extra input

## Instructions

**Read `skills/adr-sync/SKILL.md`** and follow its full workflow (steps 1–4).

## Examples

| Command     | Behavior                                                                  |
| ----------- | ------------------------------------------------------------------------- |
| `/adr-sync` | Rebuild the CLAUDE.md digest from accepted records; diff + confirm first  |
