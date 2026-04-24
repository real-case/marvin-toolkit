---
name: security-deps-audit
description: Audit project dependencies for known CVEs, license risks, unmaintained packages, typosquats, and transitive risk across package.json, requirements.txt, Gemfile, go.mod, Cargo.toml, pom.xml, and similar manifests. Use when the user says "check dependencies", "audit packages", "find vulnerable libraries", "npm audit", "pip-audit", "license check", "SBOM", or before releases and compliance reviews. Produces a prioritized findings report with upgrade paths.
---

# Dependency Security Audit

Analyze project dependencies for known vulnerabilities (CVEs), license compliance risks, maintenance health, and provide a concrete remediation plan.

## Core principle

**Dependencies are attack surface you didn't write.** Most production breaches exploit known vulnerabilities in third-party code. The defense is not just scanning for CVEs — it's understanding which vulnerabilities are reachable, which licenses create legal risk, and which packages are abandoned and will never be patched.

## Phase 1 — Stack detection and audit dispatch

Detect the project's package ecosystems from config files. A project may use multiple stacks.

| Stack | Config files | Lockfile | Audit command |
|-------|-------------|----------|---------------|
| Node.js / TypeScript | `package.json` | `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` | `npm audit --json` or `yarn audit --json` or `pnpm audit --json` |
| Python | `requirements.txt` / `pyproject.toml` / `Pipfile` / `setup.py` | `poetry.lock` / `Pipfile.lock` | `pip-audit --format json` or `safety check --json` |
| Go | `go.mod` | `go.sum` | `govulncheck -json ./...` |
| Rust | `Cargo.toml` | `Cargo.lock` | `cargo audit --json` |
| Ruby | `Gemfile` | `Gemfile.lock` | `bundler-audit check --format json` |
| Java / Kotlin | `pom.xml` / `build.gradle` | — | `mvn dependency-check:check` or `gradle dependencyCheckAnalyze` |
| PHP | `composer.json` | `composer.lock` | `composer audit --format json` |
| .NET | `*.csproj` / `*.fsproj` | `packages.lock.json` | `dotnet list package --vulnerable --format json` |

For each detected stack:
1. Verify lockfile exists and is committed. Missing lockfile = **HIGH** finding (builds are non-reproducible, vulnerable to dependency confusion).
2. Run the audit command. If the tool is not installed, note it and continue with manual analysis.
3. Parse output and collect vulnerabilities.

## Phase 2 — Vulnerability triage

For each vulnerability found:

### 2.1 Severity assessment

Map to a unified severity scale:

| Audit severity | Unified severity | Action |
|---------------|-----------------|--------|
| Critical (CVSS ≥ 9.0) | **CRITICAL** | Must fix before deploy |
| High (CVSS 7.0–8.9) | **HIGH** | Fix within current sprint |
| Moderate (CVSS 4.0–6.9) | **MEDIUM** | Plan to fix |
| Low (CVSS < 4.0) | **LOW** | Track, fix at convenience |

### 2.2 Reachability analysis

Not all vulnerable dependencies are exploitable. Assess:
- **Direct vs. transitive**: Is the vulnerable package a direct dependency or pulled in transitively? Transitive vulnerabilities may be unreachable.
- **Affected function**: Does the project actually import/use the vulnerable function or module? Check import statements and call sites.
- **Attack vector context**: A server-side RCE in a library used only in a CLI tool has different risk than in a web server.

Mark reachability as: `Reachable` / `Potentially reachable` / `Likely unreachable` / `Unknown`.

### 2.3 Duplicate and chain detection

Multiple CVEs may affect the same package. Group them and note when a single upgrade resolves multiple vulnerabilities.

## Phase 3 — License analysis

### 3.1 License detection

For each direct dependency, identify the license. Common sources:
- `package.json` → `license` field
- `go.mod` dependencies → check each module's LICENSE file
- `pip-audit` or `pip-licenses` output
- `license-checker` (npm) or `cargo-license` (Rust)

If `license-checker` (npm) is installed:
```bash
npx license-checker --json --production
```

### 3.2 License risk classification

| Risk level | Licenses | Issue |
|-----------|----------|-------|
| **HIGH** — Copyleft | GPL-2.0, GPL-3.0, AGPL-3.0 | May require open-sourcing your code if distributed |
| **MEDIUM** — Weak copyleft | LGPL-2.1, LGPL-3.0, MPL-2.0, EPL-2.0 | Copyleft applies to modifications of the library only |
| **LOW** — Permissive | MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Unlicense | Generally safe for commercial use |
| **UNKNOWN** — No license / custom | No LICENSE file, UNLICENSED, custom terms | Legal risk — cannot determine usage rights |

Flag HIGH and UNKNOWN licenses. Note: license risk depends on distribution model — AGPL is only a concern if you're distributing or providing network access to the software.

### 3.3 License compatibility

Check for known incompatibilities between dependency licenses and the project's own license (if declared). Common conflicts:
- GPL dependencies in MIT/Apache-licensed projects (if distributing)
- Multiple copyleft licenses with conflicting terms

## Phase 4 — Maintenance health check

For each direct dependency, assess maintenance signals:

### 4.1 Staleness indicators

- **Last release date**: Flag if > 12 months since last release as MEDIUM ("possibly unmaintained")
- **Last release date**: Flag if > 24 months since last release as HIGH ("likely abandoned")
- **Open security issues**: Check if the package has known unpatched vulnerabilities with no maintainer response

### 4.2 Signals to check

- Look at `package.json` / `go.mod` / `Cargo.toml` for pinned versions with `^`, `~`, `>=`, or `*`
- Flag `*` or `latest` as **HIGH** — completely unpinned, vulnerable to supply chain attacks
- Flag missing lockfile as **HIGH** — builds are non-deterministic

### 4.3 Deprecated packages

Check for deprecated packages:
- npm: `npm info <package> deprecated` or `npm outdated` output
- Python: check PyPI status or deprecation notices
- Go: check `Deprecated:` comments in module documentation

## Phase 5 — Remediation plan

Generate a concrete, actionable upgrade plan:

### 5.1 For each vulnerability

```
Package: <name>@<current version>
Vulnerability: <CVE-ID> — <title>
Severity: CRITICAL/HIGH/MEDIUM/LOW
Reachability: Reachable/Potentially reachable/Likely unreachable
Fix version: <version>
Breaking changes: Yes/No/Unknown
Upgrade command: <exact command>
```

Upgrade commands by ecosystem:
- npm: `npm install <package>@<version>` or `npm audit fix`
- yarn: `yarn upgrade <package>@<version>`
- pip: `pip install <package>==<version>` (update requirements.txt)
- Go: `go get <module>@<version>`
- Rust: update `Cargo.toml`, then `cargo update`
- Ruby: `bundle update <gem>`

### 5.2 Upgrade strategy

Prioritize fixes:
1. **CRITICAL + Reachable** — fix immediately
2. **HIGH + Reachable** — fix in current sprint
3. **CRITICAL/HIGH + Unreachable** — plan to fix (still in dependency tree)
4. **MEDIUM** — batch with other updates
5. **LOW** — track

For breaking changes, note what to watch for and suggest running the project's test suite after upgrading.

### 5.3 Alternative packages

For abandoned or permanently vulnerable packages, suggest alternatives:
- Name the alternative package
- Explain migration effort (drop-in replacement vs. API changes)
- Note if the alternative is actively maintained

## Output format

```
## Dependency Audit Report

**Project:** <name>
**Stacks:** <detected stacks>
**Date:** <date>
**Vulnerabilities:** N critical, N high, N medium, N low
**License issues:** N high-risk, N unknown
**Health issues:** N abandoned, N deprecated

---

### Vulnerabilities

#### [CRITICAL] <CVE-ID> — <package>@<version>
**Title:** <vulnerability title>
**Reachability:** Reachable / Likely unreachable
**Fix:** Upgrade to <version>
**Command:** `npm install <package>@<version>`
**Breaking changes:** No

#### [HIGH] ...

---

### License Issues

| Package | License | Risk | Notes |
|---------|---------|------|-------|
| <name> | GPL-3.0 | HIGH | Copyleft — may require open-sourcing |
| <name> | UNLICENSED | UNKNOWN | No license detected |

---

### Maintenance Health

| Package | Last release | Status | Action |
|---------|-------------|--------|--------|
| <name> | 2023-01-15 | Abandoned (2+ years) | Consider migrating to <alt> |
| <name> | Deprecated | Deprecated by maintainer | Migrate to <alt> |

---

### Remediation Plan

1. [IMMEDIATE] Upgrade <package> to <version> — `<command>`
2. [THIS SPRINT] Upgrade <package> to <version> — `<command>`
3. [PLANNED] Evaluate migration from <abandoned-pkg> to <alternative>
```

## Edge cases

- **No package manifests found**: Report "No dependency manifests detected (no package.json, go.mod, requirements.txt, etc.)" and exit. The project may use vendored dependencies or a language without a package manager.
- **Monorepos with multiple manifests**: Scan each manifest independently. A monorepo may have `packages/*/package.json` or `services/*/go.mod`. Group findings by manifest location.
- **Unsupported package ecosystems**: If the project uses a package manager not listed in Phase 1 (e.g., Elixir/mix, Haskell/cabal, Swift/SPM), note it as "Stack not supported for automated audit — manual dependency review recommended" and check for known general-purpose tools (`trivy fs .` works across many ecosystems).
- **Multiple stacks in one project**: Common in full-stack apps (e.g., Go backend + TypeScript frontend). Run audit for each detected stack separately and merge findings into one report.

## Guidelines

- **Lockfile is mandatory.** A missing lockfile is itself a high-severity finding, not just a warning.
- **Don't just list CVEs — triage them.** A vulnerability in an unused transitive dependency is lower priority than one in a directly imported function.
- **License checks are not optional.** A GPL dependency in a commercial SaaS can be as damaging as a CVE.
- **Prefer `audit fix` with caution.** Automated fixes are convenient but can introduce breaking changes. Always recommend running tests after.
- **Note what you couldn't check.** If a tool isn't installed, say so. If reachability is uncertain, mark it as Unknown rather than guessing.
- **One upgrade can fix many CVEs.** Group vulnerabilities by package and show the single upgrade command that resolves all of them.
