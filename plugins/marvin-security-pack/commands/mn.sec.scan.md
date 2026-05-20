---
description: Comprehensive security audit aligned with OWASP Top 10:2025. Full codebase scan including secrets, dependencies, and static analysis.
---

# Full Security Scan

Run a comprehensive security audit of the codebase.

## Arguments

- `$ARGUMENTS` — Optional: specific files, directories, or focus areas to scan (e.g. "src/api" or "OWASP only")

## Instructions

**Read `skills/mn.sec.scan/SKILL.md`** and follow its full scan sequence (Phases 1–4).

Pass `$ARGUMENTS` to scope the scan if provided.

## Examples

| Command                          | Behavior                                      |
| -------------------------------- | --------------------------------------------- |
| `/mn.sec.scan`                   | Full OWASP audit of the entire codebase       |
| `/mn.sec.scan src/api`           | Focused scan on the API directory              |
| `/mn.sec.scan dependencies`      | Run only dependency vulnerability checks       |
