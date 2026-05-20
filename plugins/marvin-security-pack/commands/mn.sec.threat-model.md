---
description: Generate STRIDE-based threat models for features, systems, or the entire application.
---

# Threat Model

Generate a threat model with data flow analysis, STRIDE evaluation, and prioritized mitigations.

## Arguments

- `$ARGUMENTS` — Optional: specific feature, subsystem, or scope to model (e.g. "authentication flow", "payment processing", "API gateway")

## Instructions

**Read `skills/mn.sec.threat-model/SKILL.md`** and follow its full workflow (Phases 1–5).

Pass `$ARGUMENTS` to scope the analysis if provided.

## Examples

| Command                                    | Behavior                                          |
| ------------------------------------------ | ------------------------------------------------- |
| `/mn.sec.threat-model`                     | Full system threat model                          |
| `/mn.sec.threat-model authentication`      | Threat model for the auth subsystem               |
| `/mn.sec.threat-model src/api/payments`    | Threat model for the payment processing flow      |
