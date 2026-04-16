---
description: Generate and verify fixes for security vulnerabilities. Takes a finding from any scanner or manual review and produces a minimal, tested patch. Use when user asks to "fix vulnerability", "patch security issue", "remediate finding", or after running any mn.sec.* scan.
---

# Security Fix Generator

Take a security finding and produce a correct, minimal fix with a regression test. This closes the feedback loop: scan → find → **fix** → verify.

## Core principle

**Minimal, correct, tested.** A security fix should change exactly what's needed to close the vulnerability. No refactoring, no improvements, no adjacent changes. Every fix comes with a test that proves the vulnerability existed and is now closed.

## Phase 1 — Understand the finding

Parse the vulnerability to fix. The input can be:
- A finding from `mn.sec.scan`, `mn.sec.secrets`, `mn.sec.deps`, `mn.sec.gate`, or `mn.sec.iac`
- A CVE identifier
- A code location and description (e.g., "SQL injection in src/api/users.ts:42")
- A user's description of the vulnerability

Extract:
1. **Vulnerability type**: Injection, XSS, SSRF, hardcoded secret, misconfiguration, etc.
2. **Affected file and location**: Exact file path and line number(s)
3. **Attack vector**: How an attacker would exploit this (input source → vulnerable function → impact)
4. **OWASP category**: If applicable, map to OWASP Top 10

Read the affected code — the full function/method, its callers, and its type definitions. Understand the context before proposing a fix.

## Phase 2 — Research the fix pattern

Select the appropriate fix pattern for the vulnerability type:

### Injection (SQL, NoSQL, Command, Template)
- **SQL injection**: Replace string concatenation/interpolation with parameterized queries
- **Command injection**: Replace `exec`/`system` with argument-array variants (`execFile`, `subprocess.run` with list args)
- **Template injection**: Use autoescaping, sandboxed template engines, or strip user input from template expressions
- **Path traversal**: Validate and canonicalize paths, use allowlists, check result is within expected directory

### Cross-Site Scripting (XSS)
- **Stored/Reflected XSS**: Use context-appropriate output encoding (HTML entities, JS encoding, URL encoding)
- **DOM XSS**: Replace `innerHTML`/`document.write` with `textContent` or sanitized HTML via DOMPurify
- **React**: Avoid `dangerouslySetInnerHTML`; if needed, sanitize with DOMPurify first

### Authentication / Authorization
- **Missing auth**: Add auth middleware/decorator to the route handler
- **IDOR**: Add ownership check — verify the requesting user owns the resource
- **JWT issues**: Add expiration validation, signature verification, audience check

### Cryptographic issues
- **Weak password hashing**: Replace MD5/SHA1/SHA256 with bcrypt/scrypt/argon2
- **Hardcoded keys**: Move to environment variables or secret manager
- **Weak TLS**: Set minimum TLS version to 1.2

### Secret exposure
- **Hardcoded secret in code**: Move to environment variable, add to `.gitignore`, rotate the secret
- **Secret in git history**: Rotate first, then provide BFG/filter-branch instructions

### Configuration
- **Debug mode in production**: Add environment-based configuration
- **Missing security headers**: Add helmet (Express), SecurityMiddleware (Django), appropriate framework middleware
- **CORS misconfiguration**: Replace `*` with explicit origin allowlist

## Phase 3 — Generate the fix

Produce a minimal code change:

1. **Only modify what's necessary.** Don't refactor, rename, or "improve" adjacent code.
2. **Follow project conventions.** Match the existing code style, patterns, and library choices.
3. **Preserve behavior.** The fix should close the vulnerability without changing any expected functionality.
4. **Handle edge cases.** If input validation is the fix, consider: null/undefined, empty strings, unicode, extremely long inputs.

Present the fix as a clear before/after diff:

```
File: <path>

Before (vulnerable):
<exact code being replaced>

After (fixed):
<corrected code>
```

If the fix requires a new dependency (e.g., DOMPurify for XSS, helmet for headers), note it explicitly and provide the install command.

## Phase 4 — Verify the fix

### 4.1 Correctness check

Re-read the fixed code and verify:
- The attack vector is actually closed (trace the input path again)
- No new vulnerabilities are introduced by the fix
- Edge cases are handled (null, empty, boundary values)
- The fix doesn't break the function's expected behavior

### 4.2 Pattern search

Search for the same vulnerable pattern elsewhere in the codebase:

```bash
# Example: if fixing SQL injection via string interpolation
grep -rn "f\"SELECT.*{" --include='*.py' .
grep -rn 'query.*\+.*req\.' --include='*.ts' --include='*.js' .
```

If siblings are found, list them with their locations. The user can run `mn.sec.fix` on each one or batch the fixes.

## Phase 5 — Generate regression test

Write a test that:
1. **Fails without the fix** — demonstrates the vulnerability exists
2. **Passes with the fix** — proves the vulnerability is closed
3. **Follows project test conventions** — use the same test framework, naming, and patterns as existing tests

### Test structure

```
Test: <descriptive name>
Framework: <jest/pytest/go test/etc.>
File: <suggested test file path>

<test code>
```

### Test examples by vulnerability type

- **SQL injection**: Test with input `' OR 1=1 --` and verify it doesn't return unauthorized data
- **XSS**: Test with input `<script>alert(1)</script>` and verify output is encoded
- **Command injection**: Test with input `; rm -rf /` and verify it's rejected or escaped
- **IDOR**: Test accessing resource with different user's ID and verify 403/404
- **Path traversal**: Test with `../../etc/passwd` and verify it's rejected

## Output format

```
## Security Fix

**Vulnerability:** <type> — <OWASP category>
**Location:** <file>:<line>
**Risk:** CRITICAL / HIGH / MEDIUM

---

### Attack Vector

<brief explanation of how this vulnerability could be exploited>

### Fix

**File:** `<path>`

```diff
- <vulnerable code>
+ <fixed code>
```

<explanation of why this fix works>

### Dependencies

<new dependencies needed, if any, with install commands>

### Siblings Found

<other locations with the same pattern, if any>

| File | Line | Same pattern |
|------|------|-------------|
| ... | ... | ... |

### Regression Test

**File:** `<test file path>`

```<language>
<test code>
```

### Post-Fix Checklist

- [ ] Run existing tests to verify no regressions
- [ ] Run the regression test above
- [ ] If secret was exposed: rotate the credential
- [ ] If git history is affected: consider BFG cleanup
```

## Guidelines

- **Fix one vulnerability at a time.** Don't batch multiple fixes into one change — each fix should be independently reviewable and testable.
- **Don't gold-plate.** The temptation to also refactor the surrounding code is strong. Resist it. Clarity of the security fix comes from its minimality.
- **Test the attack, not the fix.** The regression test should attempt the attack and verify it fails, not just check that the new code runs.
- **If unsure, say so.** If the correct fix pattern is ambiguous or could have multiple valid approaches, present the options and let the developer decide. Don't guess.
- **Rotation comes first.** For exposed secrets, emphasize that rotation must happen before or immediately after the code fix. The code fix alone is not sufficient.
- **Check for framework-specific solutions.** Before implementing a manual fix, check if the project's framework has a built-in solution (e.g., Django ORM for SQL injection, React's default XSS protection, Express's helmet for headers).
