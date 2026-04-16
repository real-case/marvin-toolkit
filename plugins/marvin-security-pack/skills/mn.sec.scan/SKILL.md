---
description: Comprehensive security audit of the codebase aligned with OWASP Top 10:2025. Orchestrates specialized scans (secrets, dependencies) and adds deep static analysis. Use when user asks to "security scan", "full audit", "OWASP audit", or when reviewing code for production readiness.
---

# Full Security Scan

Comprehensive security audit of the project aligned with OWASP Top 10:2025. This is the "big audit" — it runs all specialized scans and adds deep manual code review on top.

For focused, faster scans use the specialized skills: `mn.sec.secrets`, `mn.sec.deps`, or `mn.sec.gate`.

## Core principle

**Breadth then depth.** Phase 1 and 2 delegate to specialized skills for thorough coverage. Phase 3 and 4 add the value that only a full-codebase manual review can provide — understanding how components interact, where trust boundaries are violated, and which patterns external tools miss.

## Scan sequence

Run all phases in order. Skip phases that don't apply to the project.

## Phase 1 — Secrets detection (delegated)

**Read `skills/mn.sec.secrets/SKILL.md`** and follow its full workflow (Phases 1–4).

Incorporate all findings into the unified report at the end.

## Phase 2 — Dependency vulnerabilities (delegated)

**Read `skills/mn.sec.deps/SKILL.md`** and follow its full workflow (Phases 1–5).

Incorporate all findings into the unified report at the end.

## Phase 3 — Static analysis (OWASP Top 10:2025)

Perform manual code review following the OWASP Top 10:2025 categories. This is the core value of the full scan — understanding context that automated tools miss.

#### A01 — Broken Access Control
- Missing or inconsistent authorization checks on endpoints/handlers
- Direct object references without ownership validation
- CORS misconfiguration (`Access-Control-Allow-Origin: *`)
- Missing CSRF protection on state-changing operations
- SSRF: user-controlled URLs passed to HTTP clients without allowlist

#### A02 — Security Misconfiguration
- Debug/dev modes enabled in production configs
- Default credentials or admin accounts
- Verbose error messages exposing stack traces, SQL, or internal paths
- Missing security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
- Overly permissive file/directory permissions

#### A03 — Software Supply Chain Failures
- Unpinned dependencies (floating versions, `*`, `latest`)
- Missing lockfile (`package-lock.json`, `go.sum`, `poetry.lock`)
- Pre/post-install scripts in dependencies that execute arbitrary code
- Dependencies from untrusted registries or forks

#### A04 — Cryptographic Failures
- Weak hashing for passwords (MD5, SHA1, plain SHA256 — use bcrypt/scrypt/argon2)
- Hardcoded encryption keys or IVs
- Use of deprecated TLS versions (< TLS 1.2)
- Sensitive data transmitted without encryption

#### A05 — Injection
- SQL/NoSQL injection: user input concatenated into queries
- Command injection: user input in `exec`, `system`, `subprocess`, `os/exec`
- Template injection: user input in server-side template rendering
- Path traversal: user input in file paths without sanitization

#### A06 — Insecure Design
- Missing rate limiting on auth endpoints
- No account lockout after repeated failed login attempts
- Business logic flaws that skip validation steps

#### A07 — Authentication Failures
- Plaintext password storage or transmission
- Missing MFA on sensitive operations
- Session tokens in URLs or logs
- JWT without expiration or signature verification

#### A08 — Software/Data Integrity Failures
- Deserialization of untrusted data (`pickle`, `yaml.load`, `eval`, `JSON.parse` of user input passed to logic)
- Missing integrity checks on downloaded artifacts

#### A09 — Logging & Alerting Failures
- Sensitive data in logs (passwords, tokens, PII)
- Missing audit logs for auth events and admin actions
- No alerting mechanism for security-relevant events

#### A10 — Mishandling Exceptional Conditions
- Bare `except`/`catch` that swallow errors silently
- Error handlers that return success or skip security checks
- Missing error handling on auth/crypto operations
- Race conditions in permission checks

## Phase 4 — Stack-specific analysis

Detect the stack and apply the corresponding section.

#### Python

Run `bandit -r . -f json` for AST-based security analysis. Key checks:
- `eval()`/`exec()` with dynamic content (B307)
- `subprocess` with `shell=True` (B602)
- `pickle` deserialization (B301)
- `assert` used for security checks (B101 — stripped in optimized Python)
- `random` instead of `secrets` for security-sensitive values (B311)
- Hardcoded passwords (B105/B106)
- SQL injection via string formatting (B608)
- Insecure protocol imports: `telnet`, `ftp` (B401–B412)

Framework-specific: check Django `SECRET_KEY`, `DEBUG=True`, `ALLOWED_HOSTS=['*']`; Flask `app.run(debug=True)`, missing CSRF; FastAPI missing dependency injection for auth.

#### Go

Run `gosec ./...` for AST-based security analysis. Key checks:
- Hardcoded credentials (G101)
- Command injection via `os/exec` (G204)
- Insecure TLS configurations (G402)
- Weak crypto: DES, RC4, MD5 (G401, G501)
- SQL injection (G201, G202)
- File path injection (G304)
- Unsafe `unsafe` package usage (G103)
- Unhandled errors — especially on `Close()`, crypto, and auth operations (G104)
- Integer overflow (G109)

Also run `govulncheck ./...` for known CVEs in dependencies. Check `go.sum` is committed and matches `go.mod`.

#### TypeScript / JavaScript

Run `npm audit` (or `yarn audit`) for dependency CVEs. Then review code for:
- `eval()`, `Function()`, `setTimeout(string)` with dynamic content
- `child_process.exec` with user input — use `execFile` with argument arrays
- `innerHTML`, `dangerouslySetInnerHTML` without sanitization (XSS)
- Missing `helmet` or equivalent security headers middleware
- Prototype pollution via `Object.assign`, deep merge of user input
- ReDoS-vulnerable regular expressions
- Missing `Content-Security-Policy`
- `JSON.parse` of unvalidated external input feeding business logic

If ESLint is configured, check for `eslint-plugin-security` or `eslint-plugin-secure-coding`. If absent, suggest adding them.

Framework-specific: Next.js — check `next.config.js` for `poweredByHeader: true`, missing CSP, exposed API routes without auth; Express — check for missing `helmet()`, `cors()` misconfiguration, `trust proxy` settings.

#### Other stacks

If the project uses a stack not covered above, research current best practices for that language/framework before proceeding. Identify the primary SAST tool, dependency auditor, and top vulnerability patterns for the stack. Apply the same OWASP Top 10 categories.

## Output format

```
## Security Audit Report

**Project:** <name>
**Stack:** <detected stack>
**Date:** <date>
**Findings:** N critical, N high, N medium, N low

### Summary Dashboard

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Secrets  |          |      |        |     |
| Dependencies |      |      |        |     |
| OWASP Static Analysis | | |        |     |
| Stack-Specific |     |      |        |     |

---

### [CRITICAL] <title> — <file>:<line>
**OWASP:** A0X — <category>
**Description:** <what was found>
**Fix:** <specific remediation>

### [HIGH] <title> — <file>:<line>
...
```

Group findings by severity (CRITICAL → HIGH → MEDIUM → LOW). Map each finding to its OWASP Top 10:2025 category. Include specific file paths and line numbers. Provide actionable fix recommendations, not generic advice.

At the end, add a "Next Steps" section suggesting:
- Run `mn.sec.fix` for critical/high findings
- Run `mn.sec.threat-model` if architectural issues were found
- Run `mn.sec.iac` if infrastructure configs were detected but not audited

## Edge cases

- **Empty or minimal codebase**: Still run all phases — even a project with one file can have hardcoded secrets or misconfigured dependencies. Report what was checked and what was N/A.
- **Monorepos**: Run the full scan but group findings by service/package. The summary dashboard should show findings per component.
- **Multiple stacks**: Detect all stacks (e.g., Go backend + TypeScript frontend) and apply Phase 4 for each. The report should cover all detected stacks.
- **No source code (IaC-only projects)**: Phase 3 and 4 may produce no findings. Note this and suggest running `mn.sec.iac` instead.

## Guidelines

- **This is the comprehensive audit.** Don't skip phases. If a phase doesn't apply (e.g., no Go code), briefly note "Phase 4 (Go): N/A — no Go code detected" and move on.
- **Delegate, don't duplicate.** Phases 1 and 2 use the specialized skills. Don't re-implement their logic inline.
- **Phase 3 is where you add the most value.** External tools find pattern-level issues. The manual OWASP review finds logic-level issues — missing auth on a specific route, business logic bypasses, insecure design decisions. Invest time here.
- **If external tools fail or are missing, continue.** Note it in the report and perform manual analysis instead. Never produce an empty report because a tool wasn't installed.
