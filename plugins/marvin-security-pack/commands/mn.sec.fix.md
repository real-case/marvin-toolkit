---
description: Generate and verify fixes for security vulnerabilities with regression tests.
---

# Security Fix

Generate a minimal, tested fix for a security vulnerability.

## Arguments

- `$ARGUMENTS` — Required: vulnerability description, CVE ID, file:line reference, or finding from a scan (e.g. "SQL injection in src/api/users.ts:42" or "CVE-2024-1234")

## Instructions

**Read `skills/mn.sec.fix/SKILL.md`** and follow its full workflow (Phases 1–5).

Pass `$ARGUMENTS` as the vulnerability to fix.

## Examples

| Command                                          | Behavior                                          |
| ------------------------------------------------ | ------------------------------------------------- |
| `/mn.sec.fix SQL injection in src/api/users.ts:42` | Generate fix for specific vulnerability           |
| `/mn.sec.fix CVE-2024-1234`                      | Research and fix a specific CVE                   |
| `/mn.sec.fix hardcoded API key in src/config.ts` | Fix a secret exposure finding                     |
