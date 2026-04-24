---
name: security-diff-gate
description: Fast security sanity-check scoped to the diff rather than the full codebase — scans staged or recent changes for injected secrets, obvious injections, unsafe deserialization, hard-coded credentials, and risky new dependencies. Use as a pre-commit gate, when the user says "check my changes for security issues", "quick sec check", "secure this diff", "gate this commit", or before pushing any branch touching auth, crypto, input handling, or infra.
---

# Security Gate

A fast, focused security check scoped to staged changes or a recent diff. Designed for frequent use — run it before every commit to catch secrets, vulnerability patterns, and unsafe code before they land in the repository.

## Core principle

**Speed over completeness.** This is not a full audit — that's what `mn.sec.scan` is for. This is a fast gate that catches the most common security mistakes introduced by a single change. It should feel lightweight enough to run on every commit without friction.

## Phase 1 — Get the diff

Determine what to scan based on context:

```bash
# If there are staged changes, scan them
git diff --cached --unified=0 --no-color

# If no staged changes, scan the last commit
git diff HEAD~1 --unified=0 --no-color
```

If `$ARGUMENTS` specifies a commit range (e.g., `HEAD~3..HEAD`), use that instead.

Collect:
- List of changed files
- Added/modified lines only (ignore deletions — removed code is not a new risk)
- Changed lockfiles or manifests (`package.json`, `go.mod`, `requirements.txt`, etc.)

## Phase 2 — Secret check (diff only)

Scan **added lines only** for hardcoded secrets. Use the high-signal patterns:

1. **Cloud provider keys**: `AKIA[0-9A-Z]{16}`, `AIza[0-9A-Za-z_-]{35}`, `AccountKey=`
2. **Platform tokens**: `ghp_`, `gho_`, `ghs_`, `sk-`, `sk_live_`, `xox[bps]-`, `SG.`, `glpat-`
3. **Private keys**: `-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----`
4. **Generic credentials**: assignments to `password`, `secret`, `api_key`, `token`, `credential` variables with non-placeholder string values
5. **Connection strings**: `(mysql|postgres|mongodb|redis)://.*:.*@`

Also check:
- New `.env` files added to staging — flag immediately
- New `.pem`, `.key`, `.p12` files added to staging

Any confirmed secret = **FAIL** verdict.

## Phase 3 — Vulnerability pattern check

Scan added lines for common vulnerability patterns. Focus on the highest-signal patterns only.

### Injection patterns
- SQL: string concatenation or interpolation in SQL queries (`f"SELECT...{user_input}"`, template literals in queries, `+` concatenation with query strings)
- Command: user input passed to `exec`, `system`, `subprocess.call`, `os/exec.Command`, `child_process.exec`
- XSS: `innerHTML`, `dangerouslySetInnerHTML`, `document.write`, `v-html` with dynamic content
- Path traversal: user input in file paths without sanitization (`path.join(userInput)`, `os.Open(userInput)`)

### Insecure function usage
- `eval()`, `Function()` with dynamic content
- `pickle.loads()`, `yaml.load()` (without SafeLoader), `Marshal.load()`
- `Math.random()` / `random.random()` used for security purposes (tokens, passwords)
- `md5()`, `sha1()` for password hashing

### Authentication / authorization gaps
- New API endpoint/route handler without any auth middleware or decorator
- `cors({ origin: '*' })` or `Access-Control-Allow-Origin: *`
- JWT without expiration check
- Disabled security middleware (commented out auth, `CSRF_ENABLED = False`)

Any CRITICAL pattern (injection, insecure deserialization) = **FAIL**.
Other patterns = **WARN**.

## Phase 4 — Dependency check

Only run if lockfile or manifest was modified in the diff.

```bash
# Check if package manifests changed
git diff --cached --name-only | grep -E 'package\.json|go\.mod|requirements\.txt|Cargo\.toml|Gemfile|pyproject\.toml|composer\.json'
```

If changed:
1. Check for new dependencies added with floating versions (`*`, `latest`, `>=` without upper bound)
2. Run a quick `npm audit` / `pip-audit` / `govulncheck` (whichever applies) — if the tool is available
3. Flag new dependencies with known critical CVEs

New vulnerable dependency = **WARN** (it might be intentional with a plan to fix).
Completely unpinned version = **WARN**.

## Phase 5 — Verdict

Issue a clear verdict:

### PASS
No security issues found in the diff. Output:

```
✓ SECURITY GATE: PASS
  Files checked: N
  Lines scanned: N added lines
  No issues found
```

### WARN
Non-critical issues found. The commit can proceed but issues should be addressed. Output:

```
⚠ SECURITY GATE: WARN (N issues)
  Files checked: N
  Lines scanned: N added lines

  Warnings:
  - [MEDIUM] <file>:<line> — <description>
  - [LOW] <file>:<line> — <description>

  Recommendation: Address these before merging to main.
```

### FAIL
Critical issues found. The commit should not proceed. Output:

```
✗ SECURITY GATE: FAIL (N critical issues)
  Files checked: N
  Lines scanned: N added lines

  Blocking issues:
  - [CRITICAL] <file>:<line> — <description>
  - [CRITICAL] <file>:<line> — <description>

  Fix these issues before committing.
  Run /mn.sec.fix for help generating fixes.
```

## Guidelines

- **Keep it fast.** This skill should complete in under 30 seconds. If a check is slow, skip it and suggest running the full `mn.sec.scan` instead.
- **Only scan added lines.** Deleted code is not a new risk. Modified lines should be checked in their new form only.
- **False positive tolerance is low.** Since this runs frequently, false positives create alert fatigue. Only flag patterns with high confidence. When in doubt, downgrade to WARN instead of FAIL.
- **No OWASP mapping.** This is a quick gate, not a compliance report. Keep the output compact.
- **Suggest next steps.** On FAIL, point to `mn.sec.fix`. On WARN with dependency issues, point to `mn.sec.deps`.
- **Don't block on missing tools.** If `npm audit` isn't available, skip the dependency check and add a line to the verdict: "Note: Dependency check skipped — `npm audit` not available. Run `/mn.sec.deps` for manual analysis." The gate should never fail because a tool is missing.
