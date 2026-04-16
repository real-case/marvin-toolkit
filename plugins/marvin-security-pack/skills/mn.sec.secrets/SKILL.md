---
description: Deep scan for leaked secrets, credentials, and API keys across code, config, and git history. Use when user asks to "scan for secrets", "find leaked keys", "check for credentials", "secret detection", or before any production deployment.
---

# Secret & Credential Scanning

Find hardcoded secrets, leaked credentials, and insecure secret management patterns across the codebase and its git history.

## Core principle

**Secrets leak in layers.** The obvious layer is code — hardcoded passwords, API keys in config files. The hidden layer is git history — a key committed and then "removed" is still in every clone. The structural layer is configuration — missing `.gitignore` rules, absent secret managers, `.env` files without `.env.example` parity. A thorough scan covers all three.

## Phase 1 — Pattern-based code scanning

Search the entire codebase for hardcoded secrets using high-signal patterns. Group by category.

If `$ARGUMENTS` specifies a directory or file, restrict all grep commands to that path instead of `.` (project root). If `$ARGUMENTS` specifies a focus area (e.g., "git history only", "config only"), skip non-matching phases.

### 1.1 Generic credential patterns

```bash
grep -rn \
  --include='*.go' --include='*.py' --include='*.ts' --include='*.js' --include='*.tsx' --include='*.jsx' \
  --include='*.java' --include='*.rb' --include='*.php' --include='*.rs' --include='*.cs' \
  --include='*.json' --include='*.yaml' --include='*.yml' --include='*.toml' --include='*.xml' \
  --include='*.properties' --include='*.cfg' --include='*.conf' --include='*.ini' --include='*.env*' \
  --exclude-dir='node_modules' --exclude-dir='vendor' --exclude-dir='.git' \
  --exclude-dir='dist' --exclude-dir='build' --exclude-dir='.terraform' \
  -iE 'password\s*[:=]|passwd\s*[:=]|secret\s*[:=]|api_key\s*[:=]|apikey\s*[:=]|api[-_]?secret|auth_token\s*[:=]|access_token\s*[:=]|private_key\s*[:=]|client_secret\s*[:=]|encryption_key\s*[:=]|signing_key\s*[:=]|database_url\s*[:=]' .
```

**False positive filtering**: Exclude test fixtures, mocks, documentation, and example/template files (`.example`, `.sample`, `.template`). Apply judgment:
- `password = "test123"` in a test fixture → **false positive** (mark as such in report)
- `password = "Pr0d$ecret!"` in a config → **true positive** (CRITICAL)
- `password = os.getenv("DB_PASSWORD")` → **safe pattern** (reading from env, not hardcoded)
- `password_hash`, `password_field`, `password_validator` → **false positive** (variable naming, not a credential)

### 1.2 Cloud provider keys

| Provider | Pattern | Regex |
|----------|---------|-------|
| AWS Access Key | `AKIA...` (20 chars) | `AKIA[0-9A-Z]{16}` |
| AWS Secret Key | 40-char base64 | `(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])` (near `aws_secret`) |
| GCP Service Account | JSON with `"type": "service_account"` | `"type"\s*:\s*"service_account"` |
| GCP API Key | `AIza...` (39 chars) | `AIza[0-9A-Za-z_-]{35}` |
| Azure Connection String | `DefaultEndpointsProtocol=...AccountKey=` | `AccountKey=[A-Za-z0-9/+=]{86}==` |
| Azure Client Secret | UUID-like | Check near `AZURE_CLIENT_SECRET` or `client_secret` |

```bash
grep -rn -E 'AKIA[0-9A-Z]{16}' .
grep -rn -E '"type"\s*:\s*"service_account"' .
grep -rn -E 'AIza[0-9A-Za-z_-]{35}' .
grep -rn -E 'AccountKey=[A-Za-z0-9/+=]{86}==' .
```

### 1.3 SaaS and platform tokens

| Service | Pattern | Regex |
|---------|---------|-------|
| GitHub PAT/tokens | `ghp_`, `gho_`, `ghs_`, `ghr_`, `github_pat_` | `(ghp\|gho\|ghs\|ghr\|github_pat_)[A-Za-z0-9_]{16,}` |
| GitLab tokens | `glpat-` | `glpat-[A-Za-z0-9_-]{20,}` |
| OpenAI | `sk-...` | `sk-[A-Za-z0-9]{20,}` |
| Stripe | `sk_live_`, `rk_live_` | `(sk\|rk\|pk)_live_[A-Za-z0-9]{20,}` |
| Slack | `xoxb-`, `xoxp-`, `xoxs-` | `xox[bps]-[A-Za-z0-9-]{10,}` |
| Twilio | `SK...` (34 chars) | `SK[a-f0-9]{32}` |
| SendGrid | `SG.` | `SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}` |
| Mailgun | `key-...` | `key-[a-f0-9]{32}` |
| NPM token | `npm_...` | `npm_[A-Za-z0-9]{36}` |
| PyPI token | `pypi-...` | `pypi-[A-Za-z0-9_-]{100,}` |
| Docker Hub | `dckr_pat_` | `dckr_pat_[A-Za-z0-9_-]{20,}` |
| Telegram Bot | `bot...` | `[0-9]{8,10}:[A-Za-z0-9_-]{35}` |

```bash
grep -rn -E '(ghp_|gho_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{16,}' .
grep -rn -E 'glpat-[A-Za-z0-9_-]{20,}' .
grep -rn -E 'sk-[A-Za-z0-9]{20,}' .
grep -rn -E '(sk|rk|pk)_live_[A-Za-z0-9]{20,}' .
grep -rn -E 'xox[bps]-[A-Za-z0-9-]{10,}' .
grep -rn -E 'SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}' .
grep -rn -E 'npm_[A-Za-z0-9]{36}' .
```

### 1.4 Cryptographic material

```bash
grep -rn -E '-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----' .
grep -rn -E '-----BEGIN CERTIFICATE-----' .
```

Check if any `.pem`, `.key`, `.p12`, `.pfx`, `.jks` files are tracked:

```bash
git ls-files '*.pem' '*.key' '*.p12' '*.pfx' '*.jks' '*.keystore'
```

### 1.5 Database connection strings

```bash
grep -rn -iE '(mysql|postgres|postgresql|mongodb|redis|amqp|mssql)://[^\s"'"'"']+@[^\s"'"'"']+' .
```

Look for connection strings with embedded passwords (credentials between `://` and `@`).

### 1.6 Entropy analysis (heuristic)

For values assigned to suspicious variable names (`secret`, `token`, `key`, `password`, `credential`) that don't match known patterns above, evaluate the assigned string:
- Length > 20 characters
- Mix of uppercase, lowercase, digits, and special characters
- Not a common placeholder (`changeme`, `TODO`, `xxx`, `placeholder`, `example`)

Flag as MEDIUM severity: "Possible hardcoded secret — verify whether this is a real credential."

## Phase 2 — Git history scanning

Secrets committed and then deleted are still in the repository history and accessible to anyone who clones it.

### 2.1 Search for removed secrets

```bash
git log --all --diff-filter=D --name-only -- '*.env' '*.pem' '*.key' '*.p12'
```

Check if sensitive files were ever committed and then deleted.

### 2.2 Search for secrets in diffs

For the most critical patterns (cloud provider keys, private keys), scan recent history:

```bash
git log -p --all -S 'AKIA' --since="6 months ago" -- '*.go' '*.py' '*.ts' '*.js' '*.yaml' '*.json'
git log -p --all -S 'BEGIN PRIVATE KEY' --since="6 months ago"
git log -p --all -S 'sk_live_' --since="6 months ago"
```

If any secrets are found in history, flag as HIGH severity — the secret must be rotated regardless of whether it was "removed" from the current code.

### 2.3 External tool integration (optional)

If `trufflehog` is installed:
```bash
trufflehog git file://. --only-verified --json 2>/dev/null
```

If `gitleaks` is installed:
```bash
gitleaks detect --source . --report-format json 2>/dev/null
```

If neither is installed, note in the report: "Install trufflehog or gitleaks for deeper git history analysis."

## Phase 3 — Configuration audit

### 3.1 `.gitignore` coverage

Verify that `.gitignore` includes rules for:
- `.env`, `.env.*` (except `.env.example`)
- `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`
- IDE credential stores (`.idea/`, `.vscode/settings.json` with secrets)
- Cloud credential files (`credentials.json`, `serviceAccountKey.json`, `.aws/`, `.gcp/`)

```bash
cat .gitignore 2>/dev/null | grep -iE '\.env|\.pem|\.key|\.p12|credentials|secret'
```

Flag missing entries as MEDIUM severity.

### 3.2 `.env` file parity

If `.env.example` (or `.env.sample`, `.env.template`) exists, compare its keys against any `.env` file:
- Every key in `.env` should have a corresponding entry in `.env.example`
- `.env.example` should not contain real values

### 3.3 Secret management integration

Check whether the project uses a secret manager:
- Vault: look for `vault` in dependencies or `VAULT_ADDR` in config
- AWS Secrets Manager / SSM: look for `secretsmanager` or `ssm` in code
- GCP Secret Manager: look for `secretmanager` in code
- Azure Key Vault: look for `keyvault` in code
- Doppler / 1Password / Infisical: look for their CLI or SDK references
- `.env` files loaded via `dotenv` without any secret manager

If no secret manager is detected, add a LOW finding: "No secret management solution detected. Consider adopting one for production deployments."

## Phase 4 — Remediation guidance

For each confirmed secret, provide:

1. **Immediate action**: Rotate the credential. Provide service-specific rotation steps:
   - AWS: "Deactivate the access key in IAM console, create a new one"
   - GitHub: "Revoke the token at Settings → Developer settings → Personal access tokens"
   - OpenAI: "Rotate the key at platform.openai.com/api-keys"
   - Database: "Change the password and update all connection strings"
   - Private key: "Generate a new key pair, replace the public key everywhere it's deployed"

2. **Prevention**: How to avoid this in the future:
   - Use environment variables or a secret manager
   - Add pre-commit hooks (e.g., `pre-commit` with `detect-secrets`)
   - Add the pattern to `.gitignore`

3. **History cleanup** (if found in git history):
   - Note that `git filter-branch` or `BFG Repo-Cleaner` can remove secrets from history
   - Warn that all collaborators must re-clone after history rewriting
   - Emphasize: **rotation comes first** — history cleanup is defense-in-depth, not a substitute for rotation

## Output format

```
## Secret Scan Report

**Project:** <name>
**Scope:** <full codebase / directory / file>
**Date:** <date>
**Findings:** N critical, N high, N medium, N low

---

### [CRITICAL] <secret type> found in <file>:<line>
**Category:** <Cloud Key / API Token / Private Key / Database Credential / Generic Secret>
**Pattern:** <what matched>
**Value preview:** <first 4 chars>...****
**In git history:** Yes/No
**Rotation steps:** <service-specific instructions>

### [HIGH] <title>
...

---

### Configuration Issues

- [MEDIUM] `.gitignore` missing `.env` exclusion
- [LOW] No secret management solution detected

---

### Recommendations

1. Rotate all CRITICAL and HIGH findings immediately
2. <additional project-specific recommendations>
```

Never print full secret values in the report. Show at most the first 4 characters followed by `...****`.

## Edge cases

- **Empty or minimal codebase**: If no source files are found, report "No scannable source files detected" and skip to Phase 3 (configuration audit) — `.gitignore` and secret management checks still apply.
- **Monorepos**: If the project contains multiple services or packages, scan each independently and group findings by service/package in the report.
- **Binary files**: Skip binary files. Secret patterns in compiled code are not actionable.
- **Large repositories**: If grep output exceeds 500 results for generic patterns (Phase 1.1), narrow the search by excluding `vendor/`, `node_modules/`, `dist/`, `.git/`, and test fixture directories.

## Guidelines

- **Never print full secrets.** Even in the report. Truncate to first 4 characters maximum.
- **False positives are expected.** Test fixtures, example configs, and placeholder values will trigger patterns. Mark them as false positives in the report rather than omitting them silently — the reader should see that they were evaluated.
- **Rotation before cleanup.** If a secret is found in git history, the first action is always rotation. History rewriting is secondary.
- **Don't skip git history.** A secret that was "removed" from code but exists in history is just as dangerous as one that's currently in code.
- **Context matters.** A `password = "admin"` in a Docker Compose for local dev is different from the same pattern in a production config. Use severity to reflect this distinction.
- **Suggest tooling.** If trufflehog/gitleaks aren't installed, recommend them. If pre-commit hooks aren't set up, suggest `detect-secrets` or `gitleaks` as a pre-commit hook.
