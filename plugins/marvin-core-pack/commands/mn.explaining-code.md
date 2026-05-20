---
description: Explain how code works — logic, architecture, design rationale. Point to a file, function, or concept.
---

# Explain Code

Explain selected code or a specific area of the codebase.

## Arguments

- `$ARGUMENTS` — Optional: file path, function name, or concept to explain (e.g. "src/auth/middleware.ts" or "how does caching work")

## Instructions

**Read `skills/mn.explaining-code/SKILL.md`** and follow its approach and explanation structure.

Pass `$ARGUMENTS` as the target to explain if provided.

## Examples

| Command                                          | Behavior                                  |
| ------------------------------------------------ | ----------------------------------------- |
| `/mn.explaining-code`                             | Ask what to explain                       |
| `/mn.explaining-code src/auth/middleware.ts`      | Explain the auth middleware               |
| `/mn.explaining-code how does the caching work`   | Trace and explain the caching mechanism   |
