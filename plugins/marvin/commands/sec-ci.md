---
description: Audit CI/CD pipelines for supply chain risks, secret exposure, and excessive permissions.
---

# CI/CD Security Audit

Review CI/CD pipeline configurations for security risks.

## Arguments

- `$ARGUMENTS` — Optional: specific workflow file or pipeline to audit (e.g. ".github/workflows/deploy.yml" or "GitLab CI only")

## Instructions

**Read `skills/sec-ci/SKILL.md`** and follow its full workflow (Phases 1–5).

Pass `$ARGUMENTS` to scope the audit if provided.

## Examples

| Command                                          | Behavior                                          |
| ------------------------------------------------ | ------------------------------------------------- |
| `/sec-ci`                                     | Audit all detected CI/CD pipelines                |
| `/sec-ci .github/workflows/deploy.yml`        | Audit a specific workflow                         |
| `/sec-ci permissions`                          | Focus on permission scoping issues                |
