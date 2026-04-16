---
description: "[Deprecated — use mn.sec.scan] Perform a security audit of the codebase aligned with OWASP Top 10:2025."
---

**This skill has been replaced by `mn.sec.scan`.** Read `skills/mn.sec.scan/SKILL.md` and follow its full workflow instead.

The content below is kept for reference only during the transition period.

---

Perform a security audit of the current project aligned with OWASP Top 10:2025.

## Scan sequence

Run all phases in order. Skip phases that don't apply to the project.

### Phase 1 — Secrets detection

Search the entire codebase for hardcoded secrets:

```bash
grep -rn --include='*.go' --include='*.py' --include='*.ts' --include='*.js' --include='*.tsx' --include='*.jsx' --include='*.json' --include='*.yaml' --include='*.yml' --include='*.toml' --include='*.env*' --include='*.cfg' --include='*.conf' -iE \
  'password|passwd|secret|api_key|apikey|token|auth_token|credential|private_key|client_secret' .

grep -rn -E '-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----' .
grep -rn -E 'ghp_|gho_|ghs_|ghr_|github_pat_' .
grep -rn -E 'sk-[a-zA-Z0-9]{20,}' .
grep -rn -E 'AKIA[0-9A-Z]{16}' .
```

Also check: `git ls-files '*.env*'` — `.env` files must not be tracked.

### Phase 2 — Dependency vulnerabilities

Detect stack from config files, then run the appropriate audit:

| Stack | Config file | Audit command |
|-------|------------|---------------|
| Go | `go.mod` | `govulncheck ./...` |
| Python | `requirements.txt` / `pyproject.toml` | `pip-audit` or `safety check` |
| TypeScript/JS | `package.json` | `npm audit` or `yarn audit` |

Flag dependencies that are unmaintained (no release in 12+ months) or pinned to known-vulnerable versions.

### Phase 3 — Static analysis (OWASP Top 10:2025)

Perform manual code review following the OWASP Top 10:2025 categories. Use stack-specific tooling where available, then manually inspect patterns the tools miss.

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

### Phase 4 — Stack-specific analysis

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

---

### [CRITICAL] <title> — <file>:<line>
**OWASP:** A0X — <category>
**Description:** <what was found>
**Fix:** <specific remediation>

### [HIGH] <title> — <file>:<line>
...
```

Group findings by severity (CRITICAL → HIGH → MEDIUM → LOW). Map each finding to its OWASP Top 10:2025 category. Include specific file paths and line numbers. Provide actionable fix recommendations, not generic advice.