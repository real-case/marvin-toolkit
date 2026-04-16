---
description: Generate a changelog from git history between tags, date ranges, or arbitrary refs.
---

# Changelog

Generate a structured changelog from git commit history.

## Arguments

- `$ARGUMENTS` — Optional: version range, tag, or date range (e.g. "v1.0..v1.1" or "since last release" or "last 2 weeks")

## Instructions

**Read `skills/mn.changelog/SKILL.md`** and follow its full workflow (Steps 1–5).

Pass `$ARGUMENTS` as the range specifier if provided.

## Examples

| Command                              | Behavior                                        |
| ------------------------------------ | ----------------------------------------------- |
| `/mn.changelog`                       | Generate changelog since last tag               |
| `/mn.changelog v2.0..v2.1`           | Changelog between specific tags                 |
| `/mn.changelog last 2 weeks`          | Changelog for the last 2 weeks of commits       |
