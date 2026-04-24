---
name: security-compliance-asvs
description: Check code against OWASP ASVS (Application Security Verification Standard) controls at L1/L2/L3 and report a gap analysis with evidence and remediation steps. Use when the user says "ASVS audit", "compliance check", "security verification", "compliance requirements", "readiness review", "pre-release security certification", or needs mapping between code and ASVS/SOC2/ISO requirements. Produces a control-by-control compliance report.
---

# OWASP ASVS Compliance Check

Verify the application against OWASP Application Security Verification Standard (ASVS) 4.0 requirements. Produces a structured compliance matrix with Pass/Fail/N-A status per requirement.

## Core principle

**Compliance is evidence-based.** Every Pass needs evidence (code reference, configuration check, or test result). Every Fail needs a specific remediation. "Probably compliant" is not a status — if you can't verify it, mark it as Cannot Verify and explain what's needed.

## Phase 1 — Scope determination

### 1.1 Select ASVS level

ASVS defines three verification levels:

| Level | Target | Requirements | When to use |
|-------|--------|-------------|-------------|
| **L1** | All applications | ~130 requirements | Minimum viable security. Good starting point for any project. |
| **L2** | Applications with sensitive data | ~200 requirements | Standard for most applications handling user data, PII, or financial data. |
| **L3** | High-value / critical applications | ~286 requirements | Banking, healthcare, critical infrastructure, government. |

If `$ARGUMENTS` specifies a level, use it. Otherwise:
- Ask the user, or
- Infer from context: if the project handles PII or financial data → L2. If it's a high-security domain → L3. Default to L1.

### 1.2 Identify applicable chapters

ASVS 4.0 has 14 chapters. Determine which are relevant based on the project:

| Chapter | Topic | Skip if... |
|---------|-------|-----------|
| V1 | Architecture, Design, Threat Modeling | Never skip — always applicable |
| V2 | Authentication | No authentication in the application |
| V3 | Session Management | No sessions (stateless API with token auth only) |
| V4 | Access Control | Single-user app with no roles |
| V5 | Validation, Sanitization, Encoding | Never skip |
| V6 | Stored Cryptography | No encryption used |
| V7 | Error Handling and Logging | Never skip |
| V8 | Data Protection | Never skip |
| V9 | Communication | No network communication (offline app) |
| V10 | Malicious Code | Never skip |
| V11 | Business Logic | Simple CRUD with no business rules |
| V12 | Files and Resources | No file upload/download |
| V13 | API and Web Service | No API endpoints |
| V14 | Configuration | Never skip |

## Phase 2 — Automated checks

For requirements that can be verified through code analysis, perform automated checks.

### V2 — Authentication (examples)

```bash
# V2.1.1 — Password length >= 12 characters
grep -rn -E 'minlength|min_length|MIN_PASSWORD|passwordMinLength' --include='*.ts' --include='*.py' --include='*.go' --include='*.java' .

# V2.1.2 — Passwords >= 64 characters allowed
grep -rn -E 'maxlength|max_length|MAX_PASSWORD|passwordMaxLength' --include='*.ts' --include='*.py' --include='*.go' --include='*.java' .

# V2.4.1 — Passwords stored using bcrypt/scrypt/argon2
grep -rn -iE 'bcrypt|scrypt|argon2|pbkdf2' .
grep -rn -iE 'md5|sha1|sha256' --include='*.ts' --include='*.py' --include='*.go' . | grep -iE 'password|passwd|hash'
```

### V3 — Session Management (examples)

```bash
# V3.1.1 — Session token minimum entropy
grep -rn -iE 'session|sessionid|session_id|connect\.sid' .

# V3.4.1 — Cookie attributes
grep -rn -iE 'httponly|secure|samesite' .
```

### V5 — Validation (examples)

```bash
# V5.3.1 — Output encoding
grep -rn -E 'innerHTML|dangerouslySetInnerHTML|document\.write|v-html' .
grep -rn -iE 'escape|encode|sanitize|purify' .
```

### V9 — Communication (examples)

```bash
# V9.1.1 — TLS for all connections
grep -rn -E 'http://' --include='*.ts' --include='*.py' --include='*.go' --include='*.yaml' . | grep -v 'localhost\|127\.0\.0\.1\|0\.0\.0\.0'
```

### V14 — Configuration (examples)

```bash
# V14.2.1 — Dependencies up to date
# Defer to mn.sec.deps for this check

# V14.3.1 — No debug flags
grep -rn -iE 'DEBUG\s*=\s*True|debug:\s*true|NODE_ENV.*development' .
```

For each automated check, record the result and the evidence (file:line or command output).

## Phase 3 — Manual verification

For requirements that need human judgment, present the requirement and the relevant code, then assess compliance.

### Verification approach per requirement

1. **Read the requirement** from the ASVS checklist (`skills/mn.sec.compliance/asvs-4.0-checklist.md`)
2. **Find relevant code**: Use Grep/Glob to locate implementation
3. **Assess compliance**: Does the code satisfy the requirement?
4. **Record evidence**: File path, line number, configuration value, or test result
5. **Determine status**:
   - **Pass**: Requirement is satisfied with clear evidence
   - **Fail**: Requirement is not satisfied or implemented incorrectly
   - **N/A**: Requirement doesn't apply to this application (explain why)
   - **Cannot Verify**: Need more information, access, or runtime testing

### Focus on high-impact chapters

Prioritize chapters in this order for manual review:
1. V2 (Authentication) and V4 (Access Control) — most critical for most apps
2. V5 (Validation) and V8 (Data Protection) — data handling
3. V1 (Architecture) and V14 (Configuration) — structural issues
4. Remaining chapters based on relevance

## Phase 4 — Gap analysis

### 4.1 Compliance matrix

Build a full matrix of all applicable requirements at the selected level:

```
| Req ID | Requirement | Status | Evidence | Remediation |
|--------|-------------|--------|----------|-------------|
| V2.1.1 | User can set password >= 12 chars | Pass | src/auth/validate.ts:15 — minLength: 12 | — |
| V2.1.7 | Breached password check | Fail | No implementation found | Integrate HaveIBeenPwned API |
| V3.4.1 | Cookie Secure flag | Pass | src/config/session.ts:8 — secure: true | — |
| V5.3.1 | Output encoding | Fail | src/views/profile.tsx:42 — dangerouslySetInnerHTML | Use DOMPurify |
```

### 4.2 Summary statistics

```
Level: L2
Total applicable requirements: N
Pass: N (X%)
Fail: N (X%)
N/A: N
Cannot Verify: N
```

### 4.3 Compliance assessment

Based on pass rate:
- **≥ 90% Pass**: Strong compliance posture. Address remaining failures.
- **70–89% Pass**: Moderate compliance. Significant gaps to address.
- **< 70% Pass**: Low compliance. Major security investment needed.

## Phase 5 — Remediation roadmap

For each Fail finding, produce a prioritized remediation item:

### Priority criteria

1. **Critical**: Authentication, access control, or cryptographic failures
2. **High**: Input validation, session management, data protection failures
3. **Medium**: Configuration, logging, error handling failures
4. **Low**: Best-practice improvements

### Remediation structure

```
1. [CRITICAL] V2.1.7 — Breached password check
   Gap: No check against known breached passwords
   Fix: Integrate HaveIBeenPwned API during registration and password change
   Effort: ~1 day
   Reference: /mn.sec.fix V2.1.7

2. [HIGH] V5.3.1 — Output encoding
   Gap: dangerouslySetInnerHTML in src/views/profile.tsx:42
   Fix: Replace with DOMPurify-sanitized output
   Effort: ~2 hours
   Reference: /mn.sec.fix XSS in src/views/profile.tsx:42
```

## Output format

```
## ASVS Compliance Report

**Project:** <name>
**ASVS Level:** L1 / L2 / L3
**Date:** <date>
**Compliance:** N/M applicable requirements passed (X%)

---

### Summary

| Chapter | Pass | Fail | N/A | Cannot Verify |
|---------|------|------|-----|---------------|
| V1 Architecture | N | N | N | N |
| V2 Authentication | N | N | N | N |
| ... | ... | ... | ... | ... |
| **Total** | **N** | **N** | **N** | **N** |

---

### Failures

#### [CRITICAL] V2.1.7 — Breached password check
**Status:** Fail
**Evidence:** No implementation found in authentication flow
**Remediation:** Integrate breached password check (HaveIBeenPwned API)
**Effort:** ~1 day

#### [HIGH] V5.3.1 — Output encoding
**Status:** Fail
**Evidence:** `dangerouslySetInnerHTML` at src/views/profile.tsx:42
**Remediation:** Sanitize with DOMPurify before rendering
**Effort:** ~2 hours

---

### Full Compliance Matrix

<detailed requirement-by-requirement matrix>

---

### Remediation Roadmap

1. [CRITICAL] ...
2. [HIGH] ...
3. [MEDIUM] ...
```

## Guidelines

- **Evidence is mandatory.** Don't mark Pass without pointing to the code that satisfies the requirement.
- **N/A is valid and expected.** Not every requirement applies to every application. But explain why — "N/A: no file upload functionality" is valid; "N/A" alone is not.
- **Cannot Verify is honest.** Some ASVS requirements need runtime testing (e.g., "verify that sessions expire after 30 minutes of inactivity"). If you can only check static code, mark as Cannot Verify and note what testing is needed.
- **Don't check every requirement at once for large codebases.** If the user hasn't specified a focus, start with the highest-impact chapters (V2, V4, V5) and offer to continue with the rest.
- **Reference mn.sec.fix for remediation.** For each Fail, suggest running `mn.sec.fix` with the specific requirement as input.
- **ASVS evolves.** The checklist file (`asvs-4.0-checklist.md`) is a reference. If a newer version of ASVS is available, note the version being checked.
