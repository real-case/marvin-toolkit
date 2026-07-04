---
description: List the structured security-audit reports under .marvin/security/ — typed findings by severity, newest first.
---

# Security report list

List the typed security-audit reports the `sec-*` scanners wrote under `.marvin/security/`
(ADR-0024 #7 — each report carries a machine-readable `audit-report` block alongside its prose).

## Instructions

Invoke the `audit` MCP tool from the `marvin` server with `action: list`. Present the
returned list as-is (newest first); do not add preamble. Each entry shows the scan kind, its
target, the finding count, and a per-severity breakdown.

To read a report's full prose, open its file under `.marvin/security/<kind>-report.md`.
