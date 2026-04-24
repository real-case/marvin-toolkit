---
name: security-ci-audit
description: Audit CI/CD pipelines for security risks across GitHub Actions, GitLab CI, CircleCI, Jenkins, and similar configurations — pinned actions, least-privilege tokens, secret exposure, untrusted inputs, artifact tampering, cache poisoning. Use when the user says "check CI security", "audit pipeline", "review GitHub Actions", "harden workflows", "supply chain security", "SLSA", or before enabling a new workflow or granting a runner elevated credentials.
---

# CI/CD Pipeline Security Audit

Analyze CI/CD pipeline configurations for supply chain risks, secret exposure, excessive permissions, and insecure build practices.

## Core principle

**Your CI/CD pipeline has the keys to the kingdom.** It has write access to your repository, deployment credentials, signing keys, and package registry tokens. A compromised pipeline means a compromised supply chain — every user who installs your package or deploys your code is affected.

## Phase 1 — Pipeline discovery

Find all CI/CD configuration files:

```bash
find . -maxdepth 3 \( \
  -path './.github/workflows/*.yml' -o \
  -path './.github/workflows/*.yaml' -o \
  -name '.gitlab-ci.yml' -o \
  -name 'Jenkinsfile' -o \
  -name 'Jenkinsfile.*' -o \
  -path './.circleci/config.yml' -o \
  -name '.travis.yml' -o \
  -name 'azure-pipelines.yml' -o \
  -name 'bitbucket-pipelines.yml' -o \
  -name 'cloudbuild.yaml' -o \
  -name 'taskfile.yml' -o \
  -name 'Makefile' \
\) -not -path '*/node_modules/*' 2>/dev/null
```

Also check for:
- `.github/actions/*/action.yml` — custom composite actions
- `scripts/` directory — scripts invoked by CI
- Docker files used in CI builds

If no pipeline files found, report "No CI/CD configurations detected" and exit.

## Phase 2 — Action and plugin audit

### 2.1 Third-party action pinning (GitHub Actions)

Check every `uses:` reference in workflow files:

| Pattern | Risk | Severity |
|---------|------|----------|
| `uses: owner/action@main` | **Tag-based**: maintainer can push malicious code to main | **CRITICAL** |
| `uses: owner/action@v3` | **Tag-based**: tags can be moved to point at different commits | **HIGH** |
| `uses: owner/action@v3.2.1` | **Exact version tag**: better, but still mutable | **MEDIUM** |
| `uses: owner/action@abc1234...` | **SHA-pinned**: immutable, supply chain safe | **OK** |

Flag all non-SHA-pinned actions. For critical actions (checkout, setup-*, deploy, publish), SHA pinning is **HIGH** priority.

### 2.2 Action trustworthiness

For each third-party action:
- Is it from a verified creator or the `actions/` org?
- How many stars / downloads does it have?
- When was it last updated?
- Does it request excessive permissions?

Flag actions from:
- Unknown or low-reputation publishers
- Archived or unmaintained repositories
- Actions that haven't been updated in 12+ months

### 2.3 GitLab CI / Jenkins / other platforms

- **GitLab**: Check for `include:` from external URLs, unvetted templates, shared runners with elevated access
- **Jenkins**: Check for `script` blocks with hardcoded credentials, use of `credentials()` binding, Groovy sandbox escapes
- **CircleCI**: Check for `orbs` version pinning, context usage, resource class permissions

## Phase 3 — Secret handling audit

### 3.1 Secret injection

Verify secrets are handled correctly:
- Secrets should be injected via environment variables from the platform's secret store (`secrets.*`, CI/CD variables)
- Secrets should **never** appear in:
  - Workflow file content (hardcoded)
  - Command arguments in logs (`echo $SECRET`, `curl -u $TOKEN`)
  - Artifact outputs or cache keys
  - Pull request titles or descriptions

```bash
# Check for potential secret exposure in GitHub Actions
grep -rn -E '(echo|printf|print)\s+.*\$\{\{?\s*secrets\.' .github/workflows/
grep -rn -E 'curl.*\$\{\{?\s*secrets\.' .github/workflows/
```

### 3.2 Secret masking

- GitHub: Secrets are auto-masked in logs, but `toJSON()` and multi-line secrets can bypass masking
- GitLab: Variables must be explicitly masked with the "Masked" flag
- Jenkins: Check for `credentials()` usage vs. plain environment variables

### 3.3 Secret scope

- Are secrets scoped to specific environments (production, staging)?
- Can pull requests from forks access secrets? (`pull_request_target` is dangerous — it runs with write access and secrets from the base repo on PR code from forks)
- Are `GITHUB_TOKEN` permissions scoped to minimum needed?

## Phase 4 — Build integrity

### 4.1 Reproducible builds

- Are build steps deterministic? (pinned dependency versions, locked package managers)
- Are build outputs verified? (checksums, signatures)
- Is caching configured securely? (cache poisoning risk if key is attacker-controllable)

### 4.2 Artifact security

- Are published artifacts signed?
- Are container images built with proper provenance? (SLSA, Sigstore)
- Are deployment artifacts stored in a trusted registry?

### 4.3 Code checkout security

- Is `actions/checkout` configured with minimal permissions?
- For `pull_request_target` workflows: is the PR code checked out safely? (never run PR scripts with base repo secrets)
- Are submodules fetched from trusted sources?

## Phase 5 — Permission scoping

### 5.1 GitHub Actions permissions

Check for `permissions:` at workflow and job level:

| Pattern | Risk |
|---------|------|
| No `permissions:` key | Defaults to `write-all` in many contexts — **HIGH** |
| `permissions: write-all` | Explicit but overly broad — **HIGH** |
| `permissions: read-all` | Better, but still broader than needed — **MEDIUM** |
| Per-permission scoping | Best practice — **OK** |

Recommended minimum permissions pattern:
```yaml
permissions:
  contents: read
  # Add only what's needed:
  # pull-requests: write  (only if commenting on PRs)
  # packages: write       (only if publishing packages)
  # deployments: write    (only if deploying)
```

### 5.2 Runner security

- **Self-hosted runners**: Are they isolated? Shared runners between repos risk cross-contamination
- **Runner labels**: Can any workflow target any runner, or are runners restricted by label?
- **Runner environment**: Are runners ephemeral (fresh per job) or persistent (risk of state leaks)?

### 5.3 Environment protection rules

- Are production deployments gated by environment protection rules?
- Do deployments require manual approval?
- Are deployment secrets scoped to specific environments?

## Output format

```
## CI/CD Security Audit

**Project:** <name>
**Pipelines detected:** GitHub Actions / GitLab CI / Jenkins / etc.
**Date:** <date>
**Findings:** N critical, N high, N medium, N low

---

### [CRITICAL] <title> — <file>:<line>
**Category:** Action Pinning / Secret Exposure / Permission Scope / Build Integrity
**Description:** <what was found and the attack scenario>
**Fix:**
```yaml
<specific configuration fix>
```

### [HIGH] ...

---

### Action Inventory

| Action | Version | Pinned | Publisher | Status |
|--------|---------|--------|-----------|--------|
| actions/checkout | v4 | SHA ✓ | GitHub (verified) | OK |
| some/action | main | Tag ✗ | Unknown | HIGH risk |

---

### Permission Summary

| Workflow | Current Permissions | Recommended |
|----------|-------------------|-------------|
| ci.yml | write-all (implicit) | contents: read |
| deploy.yml | write-all | contents: read, deployments: write |
```

## Guidelines

- **`pull_request_target` is the most dangerous trigger.** It runs workflow code from the base branch with write access and secrets, but can be triggered by any fork PR. Any workflow using this trigger deserves extra scrutiny.
- **SHA pinning is the gold standard.** Version tags are convenient but mutable. For any action that has access to secrets or deployment credentials, SHA pinning is worth the maintenance overhead.
- **Implicit permissions are permissive.** When no `permissions:` key is set, GitHub Actions defaults depend on the repository settings but are often `write-all`. Always recommend explicit scoping.
- **Scripts invoked from CI are part of CI.** If a workflow runs `./scripts/deploy.sh`, that script's security is just as important as the workflow file itself. Read those scripts too.
- **If actionlint is available, run it.** `actionlint` catches syntax errors and common mistakes. But it doesn't check for security issues — that's this skill's job.
- **Makefile targets matter.** If CI runs `make deploy`, read the Makefile target. It may contain hardcoded credentials, unsafe curl commands, or excessive permissions.
