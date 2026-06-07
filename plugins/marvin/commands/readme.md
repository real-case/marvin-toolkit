---
description: Generate or update README.md based on actual codebase analysis.
---

# README

Generate or update the project's README.md.

## Arguments

- `$ARGUMENTS` — Optional: specific sections to focus on or instructions (e.g. "update quick start only")

## Instructions

**Read `skills/readme/SKILL.md`** and follow its full workflow (Analysis → Template → Rules).

Pass `$ARGUMENTS` as additional context if provided.

## Examples

| Command                          | Behavior                                |
| -------------------------------- | --------------------------------------- |
| `/readme`                      | Analyze codebase and generate full README |
| `/readme update quick start`   | Update only the Quick Start section       |
