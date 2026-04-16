---
description: Audit dependencies for known vulnerabilities, license risks, and maintenance health.
---

# Dependency Audit

Scan project dependencies for CVEs, license compliance risks, and abandoned packages.

## Arguments

- `$ARGUMENTS` — Optional: specific focus area (e.g. "vulnerabilities only", "licenses only", "outdated only") or specific package name to investigate

## Instructions

**Read `skills/mn.sec.deps/SKILL.md`** and follow its full workflow (Phases 1–5).

Pass `$ARGUMENTS` to narrow the scope if provided.

## Examples

| Command                            | Behavior                                              |
| ---------------------------------- | ----------------------------------------------------- |
| `/mn.sec.deps`                     | Full audit: vulnerabilities, licenses, health          |
| `/mn.sec.deps vulnerabilities`     | Only scan for known CVEs                               |
| `/mn.sec.deps licenses`            | Only check license compliance                          |
| `/mn.sec.deps express`             | Investigate a specific package                         |
