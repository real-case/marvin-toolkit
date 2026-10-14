# A-14 — Безопасность

> **Audit question.** Which paths in this project lead to unauthorised access, leakage or corruption of data?

## 1. Role and task

You audit the project as an attacker would read it, and you read only. You close one question: which reachable path lets someone obtain data, privileges or write access they are not entitled to. Authorisation is the priority axis — horizontal privilege, whether each endpoint proves that the object it returns belongs to the caller, is where real systems fail and where a scanner is silent.

Besides the report, a successful run leaves the three enumerations of §8, of which A-22 takes the rights matrix as one of its parameter values (§12), and — where any credential was found that is not proven dead — a record of the out-of-band notification that went out before the report existed (§10 R4).

## 2. Audit-specific parameters

On top of the ten standard parameters of `report-contract.md` §2.

| Parameter | Meaning | Default and derivation when unset |
|---|---|---|
| `THREAT_MODEL` | the adversaries taken seriously and the assets they would go after | `rg -li -e 'threat model' -e STRIDE -e 'модель угроз' docs SECURITY.md` for a committed one (separate `-e` patterns, never an alternation: a `\|` escaped for this table matches a literal pipe when pasted); else derive exposure from deployment configuration (a public host, an ingress, a published port). With neither, run the default triple — an unauthenticated internet caller, an authenticated caller holding the least-privileged role, a compromised transitive dependency — and record which model was used |
| `AUTH_MECHANISM` | how identity is established and carried | detected in step 1 as one or more of `session-cookie`, `jwt`, `oauth/oidc`, `api-key`, `mtls`, `none`. `none` on an externally reachable surface is a finding, never a reason to stop |
| `DATA_SENSITIVITY` | the data classes held: credentials, payment, personal, health, business-confidential | derive from `A10_REPORT`'s schema inventory when supplied, else from column and field names. **Ask the user** when a class decides a severity row and no schema names it; with no answer, assume the highest class the field names suggest, say so in *Границы достоверности*, and continue |
| `COMPLIANCE_SCOPE` | regimes in force: GDPR, PCI DSS, HIPAA, SOC 2, none | `rg -li -e gdpr -e pci -e hipaa -e 'soc ?2' docs README* SECURITY.md`, one `-e` per pattern for the reason above. Unset → audit against no regime and file regime-specific gaps as S4 observations routed to A-22 |
| `A03_REPORT`, `A06_REPORT`, `A10_REPORT`, `A11_REPORT` | paths to the finished A-03, A-06, A-10 and A-11 reports, each supplying the input §12 names for it | any of them unset → derive that substitute per §12 and lower `confidence`; a missing predecessor never blocks the run |
| `HISTORY_SCAN_REF` | the earliest revision the history secret scan covers | the whole history. When that exceeds the budget, `git rev-list -1 --before='24 months ago' HEAD`; an empty result means the history is younger than the bound, so the full history stands. **Both history detectors in step 3 consume it** — `gitleaks` through `--log-opts`, `trufflehog` through `--since-commit` — and unset, both fall through to the whole history. Record any bound in *Границы достоверности* — an uncovered period is unmeasured, not clean |
| `LIVE_HOST` | a locally started instance whose response headers may be read | unset → headers judged from code and configuration only. Never a deployed environment, whatever this parameter holds (§11) |
| `WORK_DIR` | the scratch tree holding every generated artefact | `WORK_DIR=$(mktemp -d)` — **outside the audited repository** and never `OUTPUT_DIR` (§11); removed with `rm -rf "$WORK_DIR"` at the end of the run |

## 3. Scope

### In scope

Authentication; authorisation, with horizontal privilege as the priority; secrets in the working tree, in the whole git history, in client bundles, in configuration and in CI; input handling and output encoding, including file upload, deserialisation, SSRF and path traversal; transport and security headers; supply chain — install scripts, package origins, known CVEs, third-party scripts, read out of the lockfiles; logs as a leakage channel; and infrastructure settings visible in committed configuration.

### Out of scope

- **Active testing and any attempt at exploitation** — no audit in this family performs it. `/marvin:sec-pentest` produces a checklist for a human team to execute under its own authorisation; this audit neither runs it nor simulates it.
- Dependency currency, maintenance health, licences and bundle weight → **A-03**. Known CVEs stay here, because A-03 defers them.
- **Lockfile state** — a manifest with no committed lockfile, competing lockfiles, a lockfile drifted from its manifest → **A-03, its T0 row**, which claims it alone. This audit opens a lockfile only to reach install scripts, package origins and CVE paths; step 6's lockfile-coverage output is context for those three, not a finding of its own.
- Personal-data inventory, lawful basis, retention and deletion requests → **A-22**, which takes this report as input.
- Schema reversibility, migration safety and backups → **A-10** and **A-18**; contract shape, versioning and error formats → **A-11**; strength of the types carrying DTOs → **A-06**.
- Delivery speed, rollback time and environment parity → **A-17**, though secrets and permissions *inside* CI configuration stay here (steps 3 and 6); incident investigability from telemetry → **A-16**, since logs appear here only as a place data leaks to.
- Whether a documented rate limit is **adequate**: no audit in this family judges it. Its existence as a brute-force control on the authentication surface stays here (T16).
- Personal data reaching a log, a metric label, an error report or a session recording → **A-22, its T1 row**, which is fixed by that audit's requirements; step 7 hands over the call sites it finds rather than filing them. A credential on the same line is this audit's (T20).
- A third-party script as an uncontrolled external dependency with no self-hosted copy and no defined behaviour when its origin fails → **A-12 T14**; the same script blocking render → **A-15 T13**. Its missing `integrity=` stays here (T15).
- Runtime cloud state absent from the repository — live IAM bindings, actual bucket ACLs, deployed WAF rules: **nothing in this family reads a cloud account**. Say so in *Границы достоверности*.

## 4. Collection protocol

Resolve the parameters of §2 first (`AUTH_MECHANISM` falls out of step 1). `WORK_DIR` holds every generated artefact. Protocol steps are executed as separate shell invocations, so every step that redirects into it re-establishes it first with `WORK_DIR=${WORK_DIR:-$(mktemp -d)}`; unset, each redirect would land at the filesystem root. Every `rg` sweep below runs with the contract's `RG_EXCLUDE` array (`report-contract.md` §2) already expanded into it — `rg "${RG_EXCLUDE[@]}" …` — and the only globs written inline are this audit's additions; step 3 names the one place the contract's set is deliberately lifted. Steps 1, 2, 4 and 7 read the top-N sample of §7; steps 3, 5, 6 and 8 enumerate the whole tree. **Step 3 has the shortest path to real harm: start it first when the run is time-boxed, and send the out-of-band notification the moment a credential appears that is not proven dead (§10 R4), not at the end of the audit.**

**1 — Authentication.** Mechanism, token storage and lifetime, session refresh, logout, password recovery, MFA, brute-force protection. Locate the stack with `rg -n -i 'passport|next-auth|devise|spring-security|django.contrib.auth|flask_login|jsonwebtoken|pyjwt|jose'`; token handling with `rg -n 'jwt\.(decode|verify|sign)\(|algorithms|expiresIn|maxAge|SESSION_COOKIE_AGE'`; storage with `rg -n 'localStorage\.setItem|sessionStorage\.setItem|document\.cookie'`; hashing with `rg -n -i 'bcrypt|argon2|scrypt|pbkdf2|md5|sha1|password_hash'`; and the remaining capabilities with `rg -n -i 'rate.?limit|lockout|max.?attempts|captcha|mfa|totp|webauthn|logout|revoke|denylist|session\.destroy|reset.?token'`. Produces: the `AUTH_MECHANISM` value, and one row per capability — storage, access-token TTL, refresh, revocation on logout, password reset, MFA, anti-brute-force — marked `present | partial | absent` with its `path:line`. Feeds T6, T7, T16–T18, T26. Cost: the cheapest step, one pass plus the two or three files the greps converge on.

**2 — Authorisation, the priority step.** Vertical checks are found by grep; horizontal ones are not. For every operation (§7) returning or mutating a user-owned object, the question is whether the ownership predicate sits on the data-access path, not whether a guard ran before it.

```sh
rg -n '\.(get|post|put|patch|delete)\(|@(Get|Post|Put|Patch|Delete|Controller)\('
rg -n '@(Get|Post|Put|Patch|Delete|Request)Mapping|\[Http(Get|Post|Put|Delete)\]|HandleFunc\(|path\(|re_path\('
rg -n -i 'requireAuth|isAuthenticated|@PreAuthorize|@RolesAllowed|permission_classes|before_action|authorize\(|enforce\('
rg -n 'where.*\b(user_?id|owner_?id|tenant_?id|account_?id)\b|get_queryset|current_user\.|req\.user\.'
rg -n 'findById\(|findByPk\(|get_object_or_404\(|findOne\(' -g '!*test*'
```

Produces: the ownership table of §8, one row per operation (§7); the counts `ownership_applicable`, `owner_checked`, `role_only`, `public`; and, for each applicable row with no predicate, the identifier parameter an attacker would substitute. Feeds T3 and the coverage line of §9. Cost: the most expensive step — every top-N operation is read down to its data access, not matched.

**3 — Secrets: working tree, full history, bundles, configuration, CI, rotation.** **No command in this step prints match content.** Coordinates go to the screen, everything content-bearing stays in `WORK_DIR` (§10 R2) — which is why the two `rg` sweeps end in `cut`: on a public-prefixed variable and on a hard-coded CI literal the matched content *is* the credential the step exists to find.

```sh
WORK_DIR=${WORK_DIR:-$(mktemp -d)}
gitleaks detect --source . --redact ${HISTORY_SCAN_REF:+--log-opts="$HISTORY_SCAN_REF..HEAD"} --report-format json --report-path "$WORK_DIR/history.json"
gitleaks detect --source . --no-git --redact --report-format json --report-path "$WORK_DIR/tree.json"
trufflehog git "file://$PWD" ${HISTORY_SCAN_REF:+--since-commit=$HISTORY_SCAN_REF} --only-verified --no-update --json > "$WORK_DIR/verified.json"
git log --all --diff-filter=A --name-only --format='%H %cI' | rg -i '\.env|\.pem$|id_rsa|\.keystore|credentials'
git ls-files -- ':(glob)**/dist/**' ':(glob)**/build/**' ':(glob)**/public/**' ':(glob)**/static/**' '*.min.js' '*.js.map' > "$WORK_DIR/bundles.txt"
[ -s "$WORK_DIR/bundles.txt" ] && xargs rg -l -e 'NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_' -e 'eyJ[A-Za-z0-9_-]{20,}' < "$WORK_DIR/bundles.txt"
rg -n 'NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_' | rg -i 'key|secret|token|password' | cut -d: -f1,2
rg -n -i 'secret|token|api.?key|password' .github/workflows .gitlab-ci.yml Jenkinsfile 2>/dev/null | rg -v 'secrets\.' | cut -d: -f1,2
```

The four directory pathspecs of the bundle census carry `:(glob)**/` for the reason the contract's ripgrep globs carry `**/`: a plain `'dist/*'` matches the top-level directory only and leaves `packages/*/dist/` unread.

Produces: the secret table of §8 — detector rule id, `path:line`, first and last commit, `verified | unverified`, still-tracked — **with no value and no fragment of a value anywhere**; the shipped-bundle hit list, for which the contract's default exclusion of `dist/` and `build/` (§2) is lifted for the `xargs rg -l` over `bundles.txt` alone, because a public-prefixed credential reaches the user only in the built artefact and T10 has no other source — when no bundle is committed and the owner built none, record in *Границы достоверности* that the bundle surface went unread, since this audit builds nothing (§11) and the source sweep above proves only that the variable exists; the CI-secret inventory separating managed references from literals; and the rotation verdict from `rg -ni rotat README* SECURITY.md docs`. Feeds T1, T2, T10, T24. Cost: a few minutes of wall clock, dominated by the two history passes, plus the largest share of the auditor's own reading, because every candidate is resolved to coordinates by hand rather than pasted.

**4 — Input: validation, query parameterisation, output encoding, upload, deserialisation, SSRF, path traversal.**

```sh
rg -n 'SELECT .*\+|f"(SELECT|INSERT|UPDATE|DELETE)|cursor\.execute\(.*%|\.raw\(|createQuery\(.*\+'
rg -n 'exec\(|execSync\(|os\.system|subprocess\.(run|call|Popen)' | rg -i 'req|request|params|input'
rg -n 'zod|joi|yup|class-validator|ajv|pydantic|marshmallow|jakarta\.validation|@Valid|go-playground/validator'
rg -n 'dangerouslySetInnerHTML|innerHTML\s*=|v-html|render_template_string|Html\.fromHtml'
rg -n 'pickle\.loads|yaml\.load\(|unserialize\(|readObject\(|Marshal\.load'
rg -n 'fetch\(|axios\.(get|post)\(|requests\.(get|post)\(|path\.join\(|os\.path\.join\(|sendFile\(' | rg -i 'req\.|request\.|params'
```

Produces: per sink class — SQL, command, template, deserialisation, outbound request, filesystem path, and upload from `rg -n 'multer|formidable|busboy|MultipartFile|request\.files'` — the call sites with user-controlled input reaching them, each with the parameter carrying the input and the validation, if any, between the two. Feeds T4, T5, T11, T13. Cost: moderate — six cheap sweeps, then one read per surviving sink to find the parameter and whatever sits between it and the entry point.

**5 — Transport and headers.** Read them from configuration: `rg -n -i 'helmet|Strict-Transport-Security|Content-Security-Policy|X-Frame-Options|X-Content-Type-Options|Referrer-Policy'`; CORS with its credentials flag in context, `rg -n -i -B2 -A4 'cors\(|Access-Control-Allow-Origin|allow_origins|AllowedOrigins'`; cookie flags, `rg -n -i 'httpOnly|sameSite|SESSION_COOKIE_SECURE|secure_cookie'`; and TLS termination, `rg -n -i 'ssl_certificate|listen 80|force_ssl|SECURE_SSL_REDIRECT' -g '*.conf' -g 'Caddyfile*' -g '*.tf' -g '*.y*ml'`. Only when `LIVE_HOST` is set and the owner started that instance, `curl -sSI "$LIVE_HOST"` adds an observation of the instance, never of the commit (§11). Produces: the header matrix as `enforced | present | absent | platform-set` with its source, the CORS verdict per origin rule, and the cookie-flag table per cookie. **`platform-set` is the fourth state and it is not `absent`:** where headers are issued by a CDN, an ingress controller, an edge function or a PaaS default rather than by committed configuration — named by `rg -n -i -e cloudflare -e cloudfront -e ingress -e vercel.json -e netlify.toml -e staticwebapp.config.json -g '*.json' -g '*.toml' -g '*.y*ml' -g '*.tf'` — the repository cannot answer, so ask the owner for that layer's configuration export or for a `LIVE_HOST`, and until one arrives the cell is unread. Feeds T9, T14, T19. Cost: minutes, configuration only, plus one request when `LIVE_HOST` is set.

**6 — Supply chain: lockfiles, install scripts, package origins, known CVEs, third-party page scripts.**

Each line runs only where its own manifest exists — `[ -f package-lock.json ]`, `[ -f requirements.txt ]` — and is skipped, never adapted, on an ecosystem that has none.

```sh
WORK_DIR=${WORK_DIR:-$(mktemp -d)}
git ls-files | rg '(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Gemfile\.lock|go\.sum|Cargo\.lock)$'
jq -r 'select(.lockfileVersion >= 2) | (.packages // {}) | to_entries[] | select(.value.hasInstallScript == true) | .key' package-lock.json
jq -r '((.packages // .dependencies) // {}) | .[].resolved // empty' package-lock.json | sed -E 's#^(https?://[^/]+)/.*#\1#' | sort | uniq -c
osv-scanner --format json -r . > "$WORK_DIR/osv.json"
npm audit --json --omit=dev > "$WORK_DIR/npm.json" ; jq -r '(.vulnerabilities // {}) | to_entries[] | select(.value.severity == "critical") | .key' "$WORK_DIR/npm.json"
pip-audit --no-deps -r requirements.txt --format json > "$WORK_DIR/pip.json"   # only when the file is fully ==-pinned; see below
```

`hasInstallScript` exists only from `lockfileVersion` 2, which is why the first `jq` guards on it and the second falls back to `.dependencies`; on a version-1 lockfile record install-script detection as unavailable rather than inferring it, and never regenerate the lockfile to obtain the field (§11). `pip-audit --no-deps` is mandatory (§11) **and it refuses a requirements file that is not fully pinned** — `--no-deps` disables resolution, so `flask>=2.0` or a transitive-only file is an error, not a scan. Test it with `rg -v '^\s*(#|-|$)' requirements.txt | rg -cv '=='`: on any non-zero count do not drop the flag. Point pip-audit at a compiled lock instead (`requirements.lock`, `poetry.lock`), or let `osv-scanner -r .` carry the Python half, and record the substitution in *Границы достоверности*.

Produces: lockfile coverage per manifest; the install-script package list; the registry-origin histogram; the CVE list restricted to production dependencies, each with severity, fixed version and the dependency path that makes it reachable; and the external-script inventory with its SRI state, from `rg -n '<script[^>]+src="https?://' -g '*.html' -g '*.ejs' -g '*.erb' | rg -v 'integrity='`. Feeds T8, T15, T21, T23. Cost: one to three minutes of scanner time; the reading is short, because a CVE is judged by the dependency path that reaches it, never by the advisory text.

**7 — Logs as a leakage channel.** `rg -n 'console\.(log|info|debug)\(|logger\.(info|debug|warn|error)\(|print\(|log\.Print' | rg -i 'token|password|secret|authorization|cookie|card|ssn|passport|email|phone'` for the call sites; `rg -n -i 'redact|mask|scrub|filter_parameters|sensitive_fields'` for the redaction configuration; `rg -n -i 'sentry|datadog|newrelic|logtail|opentelemetry'` for the destinations. Produces: the call sites emitting a **credential**, recorded by `path:line` and field name only, which is what T20 files; the personal-data call sites of the same sweep, which are A-22's row and cross as coordinates rather than as findings (§3); the redaction configuration with the field set it covers; and the list of destinations log data leaves the system for, which A-22 consumes. Feeds T20 and A-22. Cost: three sweeps and one short read of the redaction configuration.

**8 — Infrastructure within reach of the repository.** `rg -n 'EXPOSE |ports:|hostPort|0\.0\.0\.0' -g 'Dockerfile*' -g 'docker-compose*.y*ml' -g '*.y*ml'` for exposure; `rg -n 'acl.*public-read|allUsers|allAuthenticatedUsers|"Principal"\s*:\s*"\*"|block_public_acls\s*=\s*false'` for public buckets; `rg -n 'roles/owner|cluster-admin|"Action"\s*:\s*"\*"|AdministratorAccess|privileged:\s*true|runAsUser:\s*0'` for service-account permissions; and, after `WORK_DIR=${WORK_DIR:-$(mktemp -d)}`, `trivy config --format json --output "$WORK_DIR/trivy.json" .` across all of it. Produces: the exposed-port table from committed manifests, each marked `loopback | host | cluster`; storage reachable by an anonymous principal; the over-privileged identity list with the workload each is bound to; and an explicit note of what exists only in a cloud account and was therefore not read. Feeds T12, T22, T25. Cost: one `trivy` pass plus three sweeps; nothing here is read line by line.

## 5. Tools

| Tool | What it measures | Invocation | Fallback when absent |
|---|---|---|---|
| `git` | history, first and last commit of a secret, added-file names | `git log --all --diff-filter=A --name-only --format='%H %cI'` | none needed; git is the floor |
| `ripgrep` (`rg`) | every call-site enumeration of §4 | `rg "${RG_EXCLUDE[@]}" -n 'jwt\.decode\('`, the array from `report-contract.md` §2 | `grep -rEn 'jwt\.decode\(' .`, its output piped through `grep -Ev "$EXCLUDE_RE"` — the contract's ERE (§2) rather than a second copy of the list; the pipe is described, not written, for the reason the `jq` row gives |
| `jq` | lockfile fields and scanner JSON | the two `package-lock.json` lines of step 6, guarded on `lockfileVersion` (written there, not here, because a jq pipe cannot survive a table cell) | `python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(*[k for k,v in d.get('packages',{}).items() if v.get('hasInstallScript')],sep=chr(10))" package-lock.json` |
| `gitleaks` | secret candidates in the tree and across history | `gitleaks detect --source . --redact ${HISTORY_SCAN_REF:+--log-opts="$HISTORY_SCAN_REF..HEAD"} --report-format json --report-path "$WORK_DIR/history.json"` (v8.19+: `gitleaks git . --redact`) | `git grep -lIE '<pattern>' $(git rev-list --all -n 500)` for paths, `-cIE` for counts, over the `secret-patterns` block of `skills/sec-gate/SKILL.md`. **Never the `-n` form, and no other content-bearing variant:** it prints the whole matching line, so the one command that runs precisely when the redacting detector is missing would put the credential in the transcript. Record the bound in *Границы достоверности* |
| `trufflehog` | which candidates are **live**, by the detector's own verification | `trufflehog git "file://$PWD" ${HISTORY_SCAN_REF:+--since-commit=$HISTORY_SCAN_REF} --only-verified --no-update --json` — verification is egress and is owner-approved and recorded (§11) | no verification is available, or the owner withheld approval: every candidate stays `unverified`, files at T2, and the owner is asked to check the provider console — §11 forbids checking it yourself |
| `semgrep` | injection, deserialisation, SSRF and traversal patterns with real dataflow | `semgrep --config p/security-audit --config p/secrets --metrics=off --json --output "$WORK_DIR/semgrep.json" .` | the step-4 `rg` patterns. `--config p/…` downloads rules and uploads nothing; with egress blocked, `--config <local-rules-dir>` |
| `osv-scanner` | known vulnerabilities across every lockfile in the tree | `osv-scanner --format json -r .` (v2: `osv-scanner scan source -r .`) | `npm audit` / `pip-audit` per ecosystem; with neither, list direct dependency versions and file the CVE question at `hypothesis` |
| `npm audit` | CVEs in the JavaScript production tree | `npm audit --json --omit=dev`, filtered with `jq` | `osv-scanner` on `package-lock.json`. Do not use `--audit-level` to filter: it sets the exit code, not the output |
| `pip-audit` | CVEs in the Python requirement set | `pip-audit --no-deps -r requirements.txt --format json` — **only when the file is fully `==`-pinned**: `--no-deps` disables resolution, and the tool errors on an unpinned or transitive-only file | absent, **or present against an unpinned file** — the same substitution either way, because `--no-deps` is mandatory (§11) and is never dropped to make the tool accept the input: `pip-audit --no-deps -r requirements.lock`, else `osv-scanner -r .` over `poetry.lock` or `requirements.txt`. Record which ran in *Границы достоверности* |
| `trivy` | misconfiguration in committed IaC, plus a second secret opinion | `trivy config --format json --output "$WORK_DIR/trivy.json" .`, or `trivy fs --scanners vuln,secret,misconfig .` | the step-8 `rg` patterns over Dockerfiles, compose files, Kubernetes manifests and Terraform |
| header inspection | HSTS, CSP, CORS and cookie flags as actually served | static first, the step-5 `rg` sweep over middleware and reverse-proxy configuration; with `LIVE_HOST` set and the owner's approval, `curl -sSI "$LIVE_HOST"` | static evidence alone; mark the header matrix `derived from configuration, not observed`, and each cell an edge layer owns `platform-set` rather than `absent` |

Tool acquisition, version pinning and the recording of resolved versions follow `report-contract.md` §9; this audit adds no policy of its own.

## 6. Analysis rules and thresholds

| # | Condition | Threshold | Severity | Origin |
|---|---|---|---|---|
| T1 | secrets in git history that a detector marks verified, or the owner confirms live | `>= 1` | S0 | requirements |
| T2 | secret candidates in the tree or history that could not be verified either way | `>= 1` | S1, promoted to S0 on owner confirmation | requirements |
| T3 | operations acting on a user-owned object with no ownership predicate on the data-access path | `>= 1` | S0 | requirements |
| T4 | query call sites concatenating or interpolating user input into SQL, NoSQL, LDAP or a shell command | `>= 1` | S0 | requirements |
| T5 | deserialisation of user-controlled data by an unsafe API (`pickle.loads`, `yaml.load`, `unserialize`, `readObject`) | `>= 1` reachable | S0; S1 when reachability is unproven | derived |
| T6 | authentication bypass: a token consumed without signature verification, or `alg: none` accepted | `>= 1` | S0 | derived |
| T7 | password storage in plaintext | `>= 1` | S0; unsalted MD5/SHA-1 → S1 | derived |
| T8 | CVEs of critical severity in a production (non-dev) dependency | `>= 1` | S1 | requirements |
| T9 | CORS rules combining a wildcard or reflected origin with credentials | `>= 1` | S1 | requirements |
| T10 | secrets reachable in a shipped client bundle (public-prefixed variable holding a credential) | `>= 1` | S1 | derived |
| T11 | user input reaching an outbound-request host, a filesystem path, or an upload sink with no allowlist, containment, or type-and-size limit | `>= 1` per class | S1 | derived |
| T12 | storage objects or policies reachable by an anonymous principal in committed IaC | `>= 1` | S1 | derived |
| T13 | user-controlled data rendered as raw HTML with no encoding or sanitiser | `>= 1` | S1 | derived |
| T14 | session or authentication cookie missing all of `HttpOnly`, `Secure`, `SameSite` | `>= 1` | S1; any single flag missing → S2 | derived |
| T15 | third-party `<script src>` without `integrity=` on a credential or payment page (§3: A-12 and A-15 file the other two properties of the same tag) | `>= 1` | S1; elsewhere S2 | derived |
| T16 | brute-force protection — rate limit, lockout or CAPTCHA — on authentication endpoints; presence only, never adequacy (§3) | `= 0` | S2; S1 when the surface is public and MFA is absent | derived |
| T17 | access-token lifetime and revocation | no expiry, or `> 30 days`, or no revocation on logout | S2 | derived |
| T18 | password-reset tokens single-use and short-lived | reusable, or lifetime `> 24 h` | S2 | derived |
| T19 | HTTPS enforced and HSTS present on a public surface; CSP present | either absent | S2; CSP present with `unsafe-inline` in `script-src` → S3. A `platform-set` cell never fires it: the header is unread, not missing, and it goes to *Границы достоверности* plus an S4 question to the owner | derived |
| T20 | log call sites emitting a **credential**; personal data on the same line is A-22's T1 and is not filed here (§3) | `>= 1` | S2; S1 at info level in production | derived |
| T21 | a package whose install script resolves from a git or URL source rather than from the registry | `>= 1` | S1 | derived |
| T22 | identities with wildcard actions, `roles/owner` or `cluster-admin` | `>= 1` | S2; S1 when bound to an internet-reachable workload | derived |
| T23 | packages resolved from a registry other than the ecosystem's primary one, unpinned | `>= 1` | S2 | derived |
| T24 | documented rotation procedure where T1 or T2 fired | absent | S2 | derived |
| T25 | database, cache or admin ports bound to `0.0.0.0` in committed manifests | `>= 1` | S2 | derived |
| T26 | MFA available for administrative roles where `COMPLIANCE_SCOPE` or `DATA_SENSITIVITY` requires it | absent | S2 | derived |

Overrides, applying the promotion and discount rules of `report-contract.md` §5 to this audit's unit:

- **An `Origin` of `requirements` is not re-severitised** to settle a disagreement with a neighbouring audit; a `derived` row may be. **A threshold on the credential, payment or administrative path is already at its promoted row.** Do not promote twice for the same reason; name the path in the evidence instead.
- **The contract's reachability discount needs a committed default here, not an appearance.** An unreached-*looking* pattern in shipped code is not proven unreachable and does not drop; the off-by-default flag's value is quoted from a committed file or the discount is not taken. This is R1 as a threshold rule.
- **A test credential is not automatically dead:** drop a row only when the value's own provider marks it a test key by construction (a `sk_test_` prefix, a documented sandbox tenant) — a comment saying "fake" is repository text, not evidence. **T3 and T4 never merge**, and T8 counts a CVE once per dependency at the highest severity across the paths reaching it; dev-only and configuration-unreachable CVEs go to the appendix at S3 or lower.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

- **Sampling unit:** the contract's `operations`, with the contract's definition and no local one. The population is step 2's code-side enumeration, or `A11_REPORT`'s operation inventory when it is supplied; *Методология* names which of the two produced it, because they disagree and R7 is that disagreement.
- **Steps 3, 5, 6 and 8 are not sampled.** They are tool-driven or configuration-wide enumerations covering 100% of the tree; only the manual reading of steps 1, 2, 4 and 7 draws on `N`.
- **Top-N ranking**, in order: reachable without authentication; state-changing before read-only; acting on a user-owned object; touching a class named in `DATA_SENSITIVITY`; on the authentication, credential or payment path; then handler churn, `git log --since='12 months ago' --format= --name-only -- . "${GIT_EXCLUDE[@]}" | sed '/^$/d' | sort | uniq -c | sort -rn` — the contract's pathspec array (§2), and `sed` because `--format=` leaves one blank line per commit.
- **Early stop:** the contract's control-sample stop, additionally requiring that no sampled operation failed T3. When one does, extend the ownership check to the whole `ownership_applicable` population, or to `3N`, whichever is smaller, and record the expansion: a sampled answer to "how many operations are unprotected" is not an answer. **The history secret scan never stops early** — it stops where `HISTORY_SCAN_REF` puts it, which step 3 passes to both detectors, or at the root commit, and the bound is reported.

## 8. Report additions

Three additions, all enumerations rather than judgements, so all three go in report section **7 (Приложения)**. Every finding in section **5 (Детальные находки)** resting on one of them cites the appendix row in its *Доказательство* field — and a T3 finding covering several operations names each failing one inside section 5, because "twelve operations" is not an actionable finding.

1. **«Матрица прав: роль × ресурс × операция»** (*Rights matrix*) — Приложения. Rows are roles as the code defines them, the anonymous role included; columns are resources; cells hold the permitted operations `C/R/U/D` and the mechanism enforcing each — middleware, policy object, query scope, or nothing. A cell whose enforcement is `nothing` is the evidence for a T3 or an over-permission finding. Roles the code implies but never checks are listed below the matrix.
2. **«Таблица эндпоинтов с проверкой владения»** (*Endpoint ownership table*) — Приложения. One row per operation (§7): method and path, handler `path:line`, authentication required (`yes/no`), role check (`none | role | policy`), ownership predicate (`query-scoped | explicit check | absent | not applicable`), the identifier parameter an attacker would substitute, and the data class returned. The counts in the ownership column are the coverage line of §9 and are repeated in report section 2.
3. **«Результаты сканирования истории на секреты»** (*History secret-scan results*) — Приложения. One row per candidate: detector and rule id, `path:line`, first commit and date, last commit and date, still tracked (`yes/no`), verification state, rotation evidence — a row identifies a secret by coordinates, never by content (`report-contract.md` §9).

## 9. Score

The requirements are explicit that an aggregate is meaningless here — one critical finding outweighs any average — so the score is a pair of counts, not a position on a scale, and no weighted index is computed.

```
S0_COUNT  = |{ f in findings : f.severity == "S0" }|     # unit: findings
S1_COUNT  = |{ f in findings : f.severity == "S1" }|     # unit: findings
A14_SCORE = "S0=<S0_COUNT> / S1=<S1_COUNT>"
```

Report it in report section 2 in exactly that form — `S0=2 / S1=5` — and beside it, as context and never blended into it, the two rates the protocol measured: `OWNERSHIP_COVERAGE = 100 * owner_checked / ownership_applicable` percent, from §8 addition 2, and the verified-secret count from §8 addition 3. The justification names the single worst finding and the path it sits on, the operation population and how much of it was read, and any protocol step that could not run. `S0=0 / S1=0` is a real result, reported with the coverage that earned it; it is never reported as "secure".

## 10. Failure modes of this audit

**R1 — Proving nothing, then writing as if you had.** This audit may not exploit anything, so every finding rests on a read path, and the failure is silent inflation: an injection point behind a validator, or an "unprotected" endpoint whose guard lives in a base class, filed as *подтверждено*. *Countermeasure:* a finding is `confirmed` only when the whole chain — entry point, absent check, sink — was read in the source; anything shorter is `probable` or `hypothesis`, with the settling check named in the recommendation. Absence of a guard is proven by reading the handler and its inherited chain, never by a grep that returned nothing.

**R2 — A secret value entering the evidence.** Pasting a matched string into the report, an appendix or the chat turns the audit artefact into a second copy of the leak, and the report travels further than the repository. *Countermeasure:* run detectors with `--redact`, keep raw scanner JSON in `WORK_DIR` and never in `OUTPUT_DIR`, and cite a secret only as detector rule id plus `path:line` plus commit — no prefix, no suffix, no length. The chat transcript is part of the report's blast radius, so every sweep and every §5 fallback emits coordinates only: a content-printing grep over history or over a bundle is itself the second copy, and it runs exactly when no detector is there to redact.

**R3 — Touching a running system for a "quick check".** One `curl` against production attributes that environment's answer to the audited commit, and one probe against a login endpoint can lock out real users or trip a WAF. *Countermeasure:* headers and CORS are judged from committed configuration; a live read happens only against `LIVE_HOST`, only when the owner started it, and it is labelled an observation of that instance rather than of the commit.

**R4 — Delivering a credential's discovery inside the report, or waiting for `verified` before speaking.** The report is written at the end of the run, and the window between discovery and rotation is the harm. Verification is the wrong trigger for the notification: a detector verifies only the providers it implements (R5) and §11 forbids testing the key yourself, so a rule keyed to *live* leaves the majority case — a genuine secret nobody can verify — delivered at the end, which is the delay the requirement exists to remove. *Countermeasure:* **the moment any credential is found that is not proven dead — verified, or unverified but still tracked, reachable in a checked-out path, or carrying no rotation evidence — stop and notify out of band, as the first message, before any further collection**: affected system, commit, path, and the instruction to rotate. The single exception is a value its own provider marks a test key by construction (§6); a comment saying "fake" is not one. Verification afterwards only grades the finding, T1 against T2 — it never gates the message. Record that the notification went out and when; the finding still appears in the report, but the report is not how the owner first learns of it.

**R5 — Believing the verification flag in both directions.** `--only-verified` proves a key is live; it never proves the rest are dead, because a detector verifies only the providers it implements. A report listing one live secret above forty unverified candidates reads as if thirty-nine were safe. *Countermeasure:* T2 files unverified candidates at S1; name in *Границы достоверности* which providers the detector can verify and which it cannot; and never verify a key by using it (§11).

**R6 — Mistaking authentication for authorisation.** A route behind `requireAuth` is protected against strangers and open to every other customer. This is the most common false clean result in this audit: a report stating "authorisation enforced" about a system where any user reads any other's data by changing an identifier. *Countermeasure:* the ownership column of §8 addition 2 is filled from the data-access statement — the `where` clause, the scope, the policy object — never from the middleware chain. An operation whose query filters on the primary key alone is `absent`, whatever guards precede it.

**R7 — Enumerating operations with one grep.** Dynamically registered routes, generated CRUD controllers, gateway rewrites and mounted subrouters are invisible to a single pattern, so the ownership denominator shrinks and coverage is overstated in the project's favour. *Countermeasure:* run every step-2 pattern the stack matches, grep for registration helpers (`registerRoutes`, `include_router`, `use(`), reconcile the total against committed gateway or ingress configuration, and record the difference in `coverage`.

**R8 — Filing scanner output as findings.** A pasted CVE list counts dev dependencies, unreachable paths and duplicate advisories; an audit that files fifty of them at S1 has produced a data dump the reader will ignore, including the two that mattered. *Countermeasure:* every CVE is filed with the dependency path that makes it reachable in production, dev-only and configuration-unreachable entries go to the appendix at S3 or lower, and §9 counts findings, never scanner rows.

## 11. Audit-specific prohibitions

Beyond `report-contract.md` §9.

- **Do not exploit anything.** No crafted payload, no authorisation-bypass attempt, no identifier substitution against a running system, no SQL, XSS, SSRF or traversal probe, no fuzzing, no credential stuffing, no triggered password-reset flow. *Instead:* read the path in the source and file the finding with the chain you read.
- **Do not send a request to a deployed environment** — production, staging, or any shared instance — including a "harmless" `curl -I`, a DNS enumeration, or a port scan (`nmap`, `masscan`, `testssl.sh`). *Instead:* judge headers and exposure from committed configuration, or from a locally started instance via `LIVE_HOST` with the owner's approval.
- **Do not test a discovered credential to see whether it works, do not notify its provider, and do not revoke it yourself.** Using a key is both use of someone's credential and a request to a third party, and it can lock an account or raise an alert someone must handle. *Instead:* let the detector verify under the egress rule below, or leave the candidate unverified, and notify the repository owner out of band (§10 R4) so they decide.
- **Do not write raw scanner output into `OUTPUT_DIR`.** Gitleaks, trufflehog and semgrep JSON may carry candidate values. *Instead:* `WORK_DIR` (§2), extract the coordinates, and let it be discarded.
- **Do not install a scanner into the project or change its dependency state.** No `npm install`, no `pip install`, no `bundle audit --update`, and no `pip-audit` without `--no-deps` — it resolves and installs to compute the tree. *Instead:* acquire the tool under `report-contract.md` §9, or take the §5 fallback.
- **Do not rewrite history as remediation and do not offer it as the first step.** No `git filter-repo`, no BFG, no force push: a rewritten history does not un-leak a secret that was already cloned. *Instead:* recommend rotation first, purge second, and say so in the finding.
- **Do not weaken a check to observe an effect** — no disabled middleware, no relaxed CSP, no added scanner baseline or `.gitleaksignore` entry, not even locally.
- **Detector-side verification is the one egress this audit adds to the contract's package-lookup allowance, and it is not free.** `trufflehog --only-verified` sends the *candidate value* to the issuing provider's API — a third-party request that can raise an alert, which is the same risk the do-not-test-a-credential bullet forbids you to take by hand. So it is owner-approved before it runs, aimed only at the provider that issued the key, and recorded in *Методология* with what left the machine. Without that approval, drop `--only-verified`, file every candidate at T2, and say so in *Границы достоверности*. Nothing else may leave: no repository, file or matched string to an online scanner, sandbox, regex tester or paste service.

## 12. Dependencies

**Input**, as parameter values — a path to a finished report, or the values copied out of it — never as remembered context. The four below are exactly the "Needs on input" cell `audit-index.md` gives A-14. **A-03** (`A03_REPORT`) — the resolved dependency list with versions and the CVE handover it collected but did not file, which is step 6's population; absent, run `osv-scanner` yourself and lower `confidence`, because a tree derived here separates dev from production less reliably. **A-06** (`A06_REPORT`) — the boundary map and the external inputs with no runtime validation, which is step 4's untrusted-input surface; absent, judge validation from the call sites alone. **A-10** (`A10_REPORT`) — the schema inventory, which supplies the resource axis of the rights matrix and most of `DATA_SENSITIVITY`; absent, derive both from field names and say so. **A-11** (`A11_REPORT`) — the operation inventory with its consumer-facing and validation columns, which is the population of §7; absent, enumerate operations with the step-2 greps and expect the undercount R7 describes.

**Output.** This report is an input of **A-22**, the whole of the "Hands to" side of the same relation. Five things cross: the risk register; the rights matrix of §8 addition 1; the log-destination list from step 7; that step's personal-data call sites — A-22's T1 row, never filed here (§3); and, where `COMPLIANCE_SCOPE` was unset, the regime gaps this audit filed as S4 observations against it (§2), which reach A-22 as its `REGULATIONS` value. Those are what a privacy audit builds its data-flow and deletion analysis on. Nothing else here is produced for A-22, and each of the five crosses as a parameter value, never as remembered context.

## 13. Nearest marvin command

`/marvin:sec-scan` and `/marvin:sec-secrets`, per the command table of `audit-index.md`: `sec-scan` is the OWASP-aligned scan and `sec-secrets` the deep secret sweep including history, while A-14 additionally builds the role × resource × operation matrix and the per-endpoint ownership check — the half no scanner produces. Four more commands touch adjacent territory: `/marvin:sec-deps` for step 6, `/marvin:sec-iac` for step 8, `/marvin:sec-ci` for the CI half of step 3, and `/marvin:sec-compliance` when `COMPLIANCE_SCOPE` is non-empty. `/marvin:sec-pentest` is named only to be excluded — it produces a checklist for a human team, and this audit neither executes it nor simulates its results. Any of them may be used as an accelerator, and `/marvin:sec-report` lists what earlier runs produced; each of those outputs is evidence to re-verify with a command of your own, never a section to paste.
