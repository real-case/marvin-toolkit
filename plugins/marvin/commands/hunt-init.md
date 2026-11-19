---
description: Set up the bug hunter — detect the stack, propose scope, severity floors, budgets and detect-only authority, write the `hunt` key of .marvin/config.json and create .marvin/hunt/. Changes no source code.
---

# Set up the bug hunter

Configure `/marvin:hunt-code` and `/marvin:hunt-triage` for this project.

## Arguments

- `$ARGUMENTS` — Optional: what to change (e.g. "only src/, floor medium").

## Instructions

**Read `skills/hunt-init/SKILL.md`** and follow its workflow. Pass `$ARGUMENTS` as the requested changes if provided.

## Examples

| Command                             | Behavior                                          |
| ----------------------------------- | ------------------------------------------------- |
| `/hunt-init`                        | Detect the stack and propose the default settings |
| `/hunt-init only src, floor medium` | Propose settings with that scope and floor        |
