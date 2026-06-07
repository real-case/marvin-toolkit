---
description: Audit dependencies for known vulnerabilities, license risks, and maintenance health.
---

# Dependency Audit

Scan project dependencies for CVEs, license compliance risks, and abandoned packages.

## Arguments

- `$ARGUMENTS` — Optional: specific focus area (e.g. "vulnerabilities only", "licenses only", "outdated only") or specific package name to investigate

## Instructions

**Read `skills/sec-deps/SKILL.md`** and follow its full workflow (Phases 1–5).

Pass `$ARGUMENTS` to narrow the scope if provided.

## Examples

| Command                            | Behavior                                              |
| ---------------------------------- | ----------------------------------------------------- |
| `/sec-deps`                     | Full audit: vulnerabilities, licenses, health          |
| `/sec-deps vulnerabilities`     | Only scan for known CVEs                               |
| `/sec-deps licenses`            | Only check license compliance                          |
| `/sec-deps express`             | Investigate a specific package                         |
