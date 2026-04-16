---
description: Check code against OWASP ASVS compliance requirements. Produces a structured compliance matrix.
---

# Compliance Check

Verify the application against OWASP ASVS (Application Security Verification Standard) requirements.

## Arguments

- `$ARGUMENTS` — Optional: ASVS level (L1/L2/L3), specific chapter (e.g. "V2 Authentication"), or focus area (e.g. "session management")

## Instructions

**Read `skills/mn.sec.compliance/SKILL.md`** and follow its full workflow (Phases 1–5).

Use the ASVS checklist at `skills/mn.sec.compliance/asvs-4.0-checklist.md` as the reference standard.

Pass `$ARGUMENTS` to scope the check if provided.

## Examples

| Command                                  | Behavior                                          |
| ---------------------------------------- | ------------------------------------------------- |
| `/mn.sec.compliance`                     | L1 compliance check on the full application       |
| `/mn.sec.compliance L2`                  | L2 compliance check                               |
| `/mn.sec.compliance V2 Authentication`   | Check only authentication requirements            |
| `/mn.sec.compliance L3 src/api`          | L3 check scoped to the API directory              |
