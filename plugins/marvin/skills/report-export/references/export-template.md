<!--
  marvin report export — Markdown digest skeleton (template-only architecture, ADR-0033).

  HOW TO FILL (the full workflow lives in skills/report-export/SKILL.md):
    1. Replace the title and the provenance line — keep all five labels:
       Source, Command, Generated, Exported, Marvin.
    2. Keep exactly ONE cookbook section (findings / checks / document), delete the
       other two, and replace its SAMPLE content with the real report content.
    3. Escape/fence interpolated content so report text cannot break the digest
       structure; keep evidence inside fenced code blocks.
-->

# Security scan

> **Source:** `.marvin/security/scan-report.md` · **Command:** `/marvin:sec-scan` ·
> **Generated:** 2026-07-17T10:00:00Z · **Exported:** 2026-07-17T12:00:00Z ·
> **Marvin:** 0.9.0

<!-- mv:cookbook:findings -->
<!-- SAMPLE — findings digest (sec-* reports, refactor registers): summary table, then
     severity sections critical → high → medium → low → info, every finding expanded. -->

## Summary

| Severity | Count |
| -------- | ----- |
| critical | 0     |
| high     | 1     |
| medium   | 1     |
| low      | 0     |

## High (1)

### SAMPLE-1 — Hard-coded credential in the config loader

- **Severity:** high · **Location:** `src/config/load.ts:42` · **Category:** OWASP A05:2025

**Evidence**

```text
const token = "PLACEHOLDER_NOT_A_REAL_SECRET";
```

**Remediation**

Move the value into the environment and rotate the exposed credential.

**Links:** OWASP A05:2025 · `/marvin:sec-fix scan SAMPLE-1`

## Medium (1)

### SAMPLE-2 — Verbose error response leaks stack traces

- **Severity:** medium · **Location:** `src/http/errors.ts:17`

**Remediation**

Return a generic message; log the stack server-side.

<!-- mv:cookbook:checks -->
<!-- SAMPLE — checks digest (verification gates, refactor plan steps). -->

## Checks — 3/3 passed

| Check | Status | Note      |
| ----- | ------ | --------- |
| test  | ✓ pass | 212 tests |
| lint  | ✓ pass |           |
| build | ✓ pass | 4.1s      |

<!-- mv:cookbook:document -->
<!-- SAMPLE — document digest (task specs, handoffs): after the provenance line, carry
     the source document's markdown body over verbatim (it is already
     frontmatter-stripped in the report tool's envelope). -->

## Goal

A short sample paragraph standing in for the document body.

---

_Exported by the marvin toolbox · digest of the source file named above._
