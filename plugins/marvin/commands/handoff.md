---
description: Capture the current work's full context into a handoff document and emit a paste-ready prompt to continue in a fresh session. Optionally pass a focus note or slug hint.
---

# Handoff

Generate a session-continuation handoff for the current work.

## Arguments

- `$ARGUMENTS` — Optional: a focus note or slug hint (e.g. what to emphasize, or a phrase for the filename).

## Instructions

**Read `skills/handoff/SKILL.md`** and follow its full workflow (Inspect state → Reconstruct narrative → Allocate file → Write handoff → Emit paste-ready prompt).

Pass `$ARGUMENTS` as the focus note / slug hint if provided.

## Examples

| Command                              | Behavior                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `/handoff`                           | Infer the objective, write `.marvin/handoff/<NNN>-<slug>.md`, print the prompt |
| `/handoff emphasize the migration risk` | Same, weaving the focus note into the handoff and slug             |
