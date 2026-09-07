# A-22 — Приватность и соответствие требованиям

> **Audit question.** What personal data does the system process, on what basis, and what actually happens when a subject asks for deletion?

## 1. Role and task

You assemble the factual record a privacy lawyer needs and cannot extract from a codebase themselves: which categories of personal data the system holds, where each one enters and where it leaves, how long it stays, who else receives it, and whether a deletion request can be executed at all. You do not rule on lawfulness — this audit produces facts and risks, and every question needing a legal judgement is routed to the list of §8 addition 4. Besides the report, a run leaves three reusable artefacts in *Приложения*: the processing register, the data-flow diagram with jurisdiction crossings marked, and the subject-rights matrix.

## 2. Audit-specific parameters

On top of the ten standard parameters of `report-contract.md` §2.

| Parameter | Meaning | Derivation when unset |
|---|---|---|
| `JURISDICTIONS` | whose residents' data is processed, and where it is stored and processed | infer from infrastructure regions (`AWS_REGION`, `region =` / `location =` in Terraform, bucket and database region suffixes), CDN and edge configuration, the region suffix of processor endpoints, the i18n locale list, and currency or tax configuration; record as *выведено, не задано*. Nothing derivable → record "jurisdiction not established", treat every external recipient as a crossing to be confirmed, and attach the question to the lawyer list rather than blocking |
| `REGULATIONS` | regimes the client operates under: GDPR, UK GDPR, CCPA/CPRA, LGPD, HIPAA, PCI DSS, COPPA, 152-ФЗ, none | `rg -li -e 'gdpr\|ccpa\|cpra\|lgpd\|hipaa\|coppa\|pci\|152-фз'` over docs and policy files, plus the presence of a consent platform or a "Do Not Sell" route, plus A-14's `COMPLIANCE_SCOPE` when its report is supplied. Unset → audit against no regime: file every fact, rank by technical exposure only, list each regime question for the lawyer, and never assert a violation of a regime nobody named |
| `DATA_CATEGORIES` | the categories the client believes it processes, or a path to the A-10 report or a schema inventory naming the fields | built entirely by protocol step 1. A supplied list is a **hypothesis to confirm**, never the population: diff it against step 1 and file both directions — declared but absent from code, present in code but undeclared (T16) |
| `PROCESSORS` | third parties receiving personal data: a subprocessor list, a DPA register, or a path to the A-14 or A-12 output naming them | built by steps 2 and 7 from script tags, SDK initialisation, egress configuration and outbound hosts. Same hypothesis rule as `DATA_CATEGORIES`; a processor named in a list but absent from code is as much a finding as the reverse |

With all four empty the run completes: steps 1, 2 and 7 build the populations, an unset `REGULATIONS` turns every regime question into a lawyer question, and an unset `JURISDICTIONS` makes every external recipient a crossing to be confirmed rather than assumed.

## 3. Scope

**In scope.** The inventory of personal data, derived, inferred and special categories included; the flows carrying it in and out; storage locations and retention; the technical feasibility of export and deletion across every store, backups, analytics, logs and caches included; consent capture, versioning and proof; transfers to third parties and across jurisdiction boundaries; personal data in logs, metrics, error reports and session recordings; third-party scripts and SDKs; encryption at rest and in transit for the data in the inventory; staff access to personal data and its journalling.

**Out of scope.** A legal opinion — whether a basis is lawful, whether a transfer mechanism suffices, whether a retention period is defensible: **nothing in this family covers it**; the audit prepares the facts and marks the question (§8 addition 4). Authentication, authorisation, injection and secret leakage → **A-14**, whose report is an input here. Schema structure, migration reversibility and the retention mechanism as an engineering artefact → **A-10**, likewise an input. Backup existence, restore rehearsal and RTO/RPO → **A-18**; this audit records only whether deletion reaches backups. Currency, licences and CVEs of the analytics SDKs → **A-03**; their failure behaviour → **A-12**. Whether telemetry suffices to investigate an incident → **A-16**; here it is a leakage channel only. Keyboard and screen-reader operability of the consent banner → **A-21**; the component structure behind it → **A-13**. The storage cost of data kept too long → **A-19**.

**The log line is split by what is on it, not by who found it.** Personal data reaching a log, a metric label, an error report or a session recording is filed **here**, as T1, and A-14 routes that half to this audit. A **credential or token** on the same line is A-14's row and is never filed here — one call site, one finding in each report, never the same finding twice.

## 4. Collection protocol

Aggregates over the whole tree first, then targeted reading of the ranked top `N` (§7). Paste `report-contract.md` §2's canonical exclusion set once per session — `RG_EXCLUDE` for the ripgrep passes, `GIT_EXCLUDE` for every `git` invocation, here and in §5, and `EXCLUDE_RE` for §5's `grep -R` fallback — together with these four glob sets. Every path-enumerating command below carries the form its own binary accepts, and a run that drops them is not this protocol.
```sh
FIX=(-g '*fixture*' -g '*seed*' -g '*dump*' -g '*.har' -g '**/{test,tests,spec,specs,__tests__,fixtures,seeds,factories}/**')
NOFIX=(-g '!*fixture*' -g '!*seed*' -g '!*dump*' -g '!*.har' -g '!**/{test,tests,spec,specs,__tests__,fixtures,seeds,factories}/**')
SAFE=("${RG_EXCLUDE[@]}" "${NOFIX[@]}")
NOFIX_GIT=(':(exclude)**/*fixture*' ':(exclude)**/*seed*' ':(exclude)**/*dump*' ':(exclude)**/*.har'
  ':(exclude)**/test/**' ':(exclude)**/tests/**' ':(exclude)**/spec/**' ':(exclude)**/specs/**'
  ':(exclude)**/__tests__/**' ':(exclude)**/fixtures/**' ':(exclude)**/seeds/**' ':(exclude)**/factories/**')
```

Four rules bind every step.

- **Exclusions are `report-contract.md` §2's `RG_EXCLUDE`, unmodified, plus whatever `SCOPE_EXCLUDE` names for this project.** This audit adds none of its own; `FIX`, `NOFIX` and `NOFIX_GIT` above are its only additions to the glob vocabulary. `NOFIX_GIT` is `NOFIX` as a git pathspec, for the two `git grep -n` passes; git's wildmatch has no brace expansion, so its directory half is spelled out. Without the set the field inventory — and therefore `C_total` and the score of §9 — is computed over generated code, which the contract forbids. `rg`'s gitignore default does not cover this: measured on one repository, 91 of step 1's 184 hits came from a committed server bundle and committed widget HTML, neither of them gitignored.
- **An inclusion glob is written BEFORE the exclusions, never after.** Last-match-wins governs the **file-level** globs only: a `**/`-prefixed directory glob prunes its subtree during traversal whatever its position, so `!**/node_modules/**` holds in either order. What the wrong order loses is `RG_EXCLUDE`'s file-level half — `*.snap`, `*.min.js`, `*.min.css`, `*.map`, `package-lock.json`, `*.generated.*`, `*_pb2.py`, `*.pb.go` — each of which a later `FIX` basename glob re-admits. Measured on ripgrep 15.1.0 over a tree holding `src/user.fixture.snap` and `src/seed.min.js`: `"${RG_EXCLUDE[@]}" "${FIX[@]}"` returns both, `"${FIX[@]}" "${RG_EXCLUDE[@]}"` returns neither. The two passes that enter `FIX` therefore write the inclusions first, whitelisting the fixture population and then subtracting the generated files from it.
- **A pattern matching a value never prints.** A pattern matching a **field or column name** may print lines (`rg -n`); a pattern matching a **value** — an address, a telephone number, a document id — runs with `-l` or `-c` only.
- **A file that holds values never prints, whatever the pattern matched.** In a fixture, seed, dump, snapshot or HAR file the value sits on the same line as the field name, so a *name*-matching `rg -n` over one puts a personal datum straight into the transcript. Every `-n` command below therefore excludes that population — `"${SAFE[@]}"` on the ripgrep passes, `"${NOFIX_GIT[@]}"` on the two `git grep -n` passes of steps 6 and 7. Only two commands enter it, and both run `-l`: step 1's fourth, over the whole of `FIX`, and step 4's third, over the test tree plus the test-suffixed basenames `FIX` does not reach. No line from that population is ever printed (§11).

**1. Inventory of personal data.** Produces the **field inventory**: field, store or service holding it, category, special-category flag, collected or derived, and `path:line` or the schema object. Cheap; covers 100% of the tree. Blob and free-text columns are entered as `не установлено` until their writers are read — an unread `jsonb` column is not an absence of personal data. The name patterns anchor on `(^|[^a-z0-9])`, not on `\b`: `_` is a word character to ripgrep, so `\buser_email\b` matches nothing and `\b`-anchoring drops every prefixed snake_case column — the dominant SQL and ORM naming form — from the register the score is computed over. The `(?-i)` branch, which overrides the `-i` for its own alternatives, catches the camelCase spelling of the same roots.
```sh
git ls-files -- '*.sql' '*schema*' '*model*' 'prisma/schema.prisma' 'db/structure.sql' 'db/schema.rb' "${GIT_EXCLUDE[@]}"
rg -n -i --no-heading "${SAFE[@]}" -e '(^|[^a-z0-9])(e?_?mail|phone|msisdn|first_?name|last_?name|full_?name|birth|dob|address|street|zip|postcode|passport|ssn|tax_?id|iban|card_?number|cvv|geo|latitude|longitude|ip_?addr|device_?id|user_?agent|avatar|selfie|biometr)' -e '(?-i)[a-z0-9](Email|Mail|Phone|FirstName|LastName|FullName|Birth|Dob|Address|Street|Passport|Ssn|TaxId|Iban|CardNumber|Geo|Latitude|Longitude|DeviceId|UserAgent)'
rg -n -i --no-heading "${SAFE[@]}" -e '(^|[^a-z0-9])(health|diagnos|medical|prescription|disabilit|religio|ethnic|race|nationalit|political|trade_?union|orientation|criminal|conviction|minor|child|age)'
rg -n -i --no-heading "${SAFE[@]}" -e '(^|[^a-z0-9])(score|segment|profile|risk_?level|propensity|inferred|predicted|fingerprint)' -e '(jsonb?|payload|meta_?data|attributes|extra|custom_?fields)\s*[:=]\s*(json|jsonb|text|blob|clob|nvarchar|Json|Record<|any)'
rg -l -i "${FIX[@]}" "${RG_EXCLUDE[@]}" -e '(^|[^a-z0-9])(e?_?mail|phone|passport|ssn|iban|card_?number|birth|dob)'
```
The third command's blob branch requires a column-declaration context: as a bare word match `payload`, `attributes` and `extra` returned 3,220 lines on one repository and 22 with the context. The fourth command is the T15 population and the one command covering the whole of `FIX`; `-l` gives the paths and `rg -c` on a named path gives the count, and neither prints a line. Its hits stay out of the field inventory — a seeded column evidences a fixture, not a store. `RG_EXCLUDE` narrows that population twice — snapshots (`**/*.snap`, `**/__snapshots__/**`) are outside every contract metric, and no glob here reaches binary media — so *Границы достоверности* records that a snapshot or a screenshot holding personal data is a T15 this protocol cannot see.

**2. Flows.** Produces the **flow register**: direction, source (form, import, partner feed, SDK), sink (store, processor, analytics, log, export), transport, the categories carried, the region of the sink, a crossing flag (`да` / `нет` / `не установлено`), each with `path:line`.
```sh
rg -o -i --no-filename "${SAFE[@]}" -g '!*.md' -e 'https?://[A-Za-z0-9._-]+' | sort | uniq -c | sort -rn | head -40
rg -n -i "${SAFE[@]}" -e 'connect-src|Content-Security-Policy' -e 'egress|allowlist|whitelist' -e 'Access-Control-Allow-Origin'
rg -n -i "${SAFE[@]}" -e 'AWS_REGION|aws_region|GOOGLE_CLOUD_REGION|AZURE_REGION|data_?residency' -e '^\s*(region|location)\s*='
rg -n -i "${SAFE[@]}" -e 'bulk_?export|data_?dump|\betl\b|webhook|bigquery|snowflake|redshift|clickhouse|kafka|zapier' -e 'analytics\.segment|segment\.(io|com)'
```
The first command ranks hosts instead of dumping call sites — the bare URL grep returned 1,816 lines on one repository, and a flow register cannot be built from that. Take the hosts the project does not own, then `rg -n` each host to reach its call sites. The fourth carries no bare `export`: it matches every ES-module and TypeScript statement, 2,399 of the 2,726 lines that pattern returned on the same repository, and the subject-rights sense of the word is step 4's `data_?export`. `segment` is bounded to its vendor hosts for the same reason.

**3. Retention.** Produces the **retention table**: category, declared period and where it is declared, mechanism (scheduled job, TTL, partition drop, soft delete), evidence the mechanism runs, and separately the retention of backups and of logs. A period stated in a policy with no mechanism in code is recorded as declared and unimplemented, not as a period.
```sh
rg -n -i "${SAFE[@]}" -e 'retention|retain|ttl|expires?_?(at|in)|purge|cleanup|prune|archiv|anonymi[sz]|pseudonymi[sz]|deleted_?at|soft_?delete'
rg -n -i "${SAFE[@]}" -e 'cron|schedule|celery|sidekiq|airflow|@Scheduled|node-cron|systemd'
rg -n -i "${SAFE[@]}" -e 'retention_in_days|log_retention|logrotate|lifecycle_rule|expiration|rollover|max_?age'
git log --since='24 months ago' -i -E --grep='retention|purge|cleanup|anonymi' --oneline -- . "${GIT_EXCLUDE[@]}"
```

**4. Subject rights.** Produces the **rights × store matrix** (§8 addition 3) and the **deletion-reach ratio**: stores the deletion path provably reaches, over stores holding the category. Read every handler the first grep returns — a route named `delete_account` that flips a flag is not deletion.
```sh
rg -n -i "${SAFE[@]}" -e 'gdpr|dsar|subject_?access|right_?to_?be_?forgotten|erasure|data_?export|download_?my_?data|delete_?account|close_?account|deactivate'
rg -n -i "${SAFE[@]}" -e 'ON DELETE (CASCADE|SET NULL|RESTRICT|NO ACTION)' -e 'onDelete|on_delete|dependent:\s*:?(destroy|delete)'
rg -l -i -g '**/{test,tests,spec,specs,__tests__}/**' -g '*[._-]{test,spec}[._-]*' "${RG_EXCLUDE[@]}" -e 'delete_?account|erasure|anonymi[sz]|export.*user'
```
The third command's globs are directory-aware on purpose. A ripgrep glob holding no `/` matches the **basename** only, so the `-g '*test*' -g '*spec*'` form silently misses every file inside `test/`, `tests/`, `spec/`, `specs/` and `__tests__/` — the layout Ruby, Python, Java, Go and most JS projects use — and returns a plausible non-empty result from the few files that happen to be named for their suffix. Its population is the test tree plus the test-suffixed basenames `FIX` does not reach, and it holds values exactly as `FIX` does, so it runs `-l`: read the files it names, and take the rights-matrix evidence from the reading.

**5. Logs and telemetry.** Produces the **PII-in-telemetry list**: sink (application log, metric label, error report, APM span, session recording), the field, `path:line`, whether a redaction configuration covers that exact field, and the destination the sink ships to. This list is the evidence set for T1; a line whose only sensitive token is a credential leaves the list and belongs to A-14 (§3).
```sh
rg -n -i "${SAFE[@]}" -e 'console\.(log|info|debug|warn|error)\(|logger?\.(info|debug|warn|error|trace)\(|print\(|fmt\.Print|log\.Print'
rg -n -i "${SAFE[@]}" -e 'sendDefaultPii|send_default_pii|beforeSend|scrub|redact|mask|sanitiz|filter_parameters|sensitive'
rg -n -i "${SAFE[@]}" -e 'sentry|datadog|newrelic|logtail|opentelemetry|logstash|fluent|cloudwatch|stackdriver'
rg -n -i "${SAFE[@]}" -e 'hotjar|fullstory|logrocket|smartlook|clarity|mouseflow|session_?replay|maskAllInputs|maskTextSelector'
```

**6. Consents.** Produces the **consent record**: mechanism and vendor, the purpose granularity offered, where the choice is stored (table plus the columns for subject, timestamp, policy version, scope, withdrawal), how the policy text is versioned, and the **pre-consent script set** — what loads or fires before a choice exists, each with `path:line`.
```sh
rg -n -i "${SAFE[@]}" -e 'consent|cookie_?(banner|consent|policy)|onetrust|cookiebot|klaro|osano|usercentrics|iubenda|didomi|termly|\btcf\b|consent_?mode'
rg -n -i "${SAFE[@]}" -e 'consents?\b.{0,40}(version|granted|denied|withdraw|revoke|timestamp|given_?at|scope|purpose)'
git grep -n -E '<script[^>]+src=' -- '*.html' '*.htm' '*.ejs' '*.erb' '*.twig' '*.astro' '*.vue' '*.jsx' '*.tsx' "${GIT_EXCLUDE[@]}" "${NOFIX_GIT[@]}"
git log -i -E --grep='consent|cookie|privacy policy' --oneline -- . "${GIT_EXCLUDE[@]}"
```

**7. Third-party scripts and SDKs.** Produces the **processor register**: script or SDK, origin host, the fields it is configured to send (read off the `identify` / `user_properties` call sites, never off the vendor's documentation), destination, loaded before or after consent, `async` / `defer` / SRI, self-hosted or third-party origin, and any DPA or subprocessor evidence present in the repository.
```sh
git grep -n -E '<script[^>]+src="https?://' -- '*.html' '*.ejs' '*.erb' '*.twig' '*.astro' '*.vue' '*.jsx' '*.tsx' "${GIT_EXCLUDE[@]}" "${NOFIX_GIT[@]}"
rg -n -i "${SAFE[@]}" -e 'gtag\(|googletagmanager|analytics\.load|mixpanel|amplitude|posthog|heap|matomo|piwik|ym\(|fbq\(|tiktok|linkedin|hubspot|intercom|drift|crisp'
rg -n -i "${SAFE[@]}" -e 'identify\(|setUserId|set_?user|people\.set|user_?properties|super_?properties'
jq -r '(.dependencies // {}) + (.devDependencies // {}) | keys[]' package.json
```

**8. Encryption and staff access.** Produces the **protection table** — per store: at rest (mechanism with `path:line`, or `не установлено`), in transit (verification enforced `да` / `нет`) — and the **staff-access record**: back-office routes and support tools that read personal data, the role gate on each, and whether the read is journalled.
```sh
rg -n -i "${SAFE[@]}" -e 'sslmode|require_ssl|rejectUnauthorized|verify\s*=\s*False|InsecureSkipVerify|Strict-Transport-Security|force_?ssl'
rg -n -i "${SAFE[@]}" -e 'encrypt|pgcrypto|attr_encrypted|storage_encrypted|encryption_key|\bkms\b|sops|cipher'
rg -n -i "${SAFE[@]}" -e 'admin|back_?office|staff|impersonat|masquerade|support_?tool'
rg -n -i "${SAFE[@]}" -e 'audit_?log|activity_?log|access_?log|paper_?trail|audited|event_?log'
```

## 5. Tools

| Tool | What it measures here | Invocation | Fallback |
|---|---|---|---|
| Database schema, from A-10 or from the tree | the authoritative field list behind step 1 | read the A-10 report path supplied as `DATA_CATEGORIES`; else `git ls-files -- '*.sql' 'prisma/schema.prisma' 'db/structure.sql' 'db/schema.rb' "${GIT_EXCLUDE[@]}"` and read the hits | ORM model files and migration bodies read on paper; `confidence: medium` at best, and *Границы достоверности* says the live schema was not seen |
| ripgrep (`rg`) | field names, flows, retention, consent and telemetry markers | `rg -n -i --no-heading "${SAFE[@]}" -e '<pattern>'` with §4's glob sets in scope; `rg -l` or `rg -c` for any value-matching pattern and for any pass entering `FIX` | `git grep -n -i -E '<pattern>' -- . "${GIT_EXCLUDE[@]}"`, else `grep -RnIE '<pattern>' . \| grep -Ev "$EXCLUDE_RE"` (both forms are `report-contract.md` §2's) — each loses `FIX`, so re-apply it by hand or drop the fixture pass |
| Third-party script inventory | what the browser loads from an origin the project does not own | `git grep -n -E '<script[^>]+src="https?://' -- '*.html' '*.jsx' '*.tsx' '*.vue' "${GIT_EXCLUDE[@]}" "${NOFIX_GIT[@]}"` | `find . -name '*.html' -exec grep -l '<script' {} + \| grep -Ev "$EXCLUDE_RE"`, then read the hits |
| Analytics and CMP configuration | what each SDK is told to collect, and when it may fire | `jq -r '.' <config>.json`; read the initialisation call sites step 7 returns | `sed -n '1,200p' <config>` and read; a minified vendor bundle is recorded unread, never guessed at |
| Page network requests | which hosts the page actually contacts, and which fire before consent | a HAR the user exports from their own browser devtools against an authorised non-production URL, then `jq -r '.log.entries[].request.url' page.har \| awk -F/ '{print $3}' \| sort -u` | static only: CSP `connect-src` and `script-src` hosts plus the step-7 register; record the check in `tools_unavailable` and say so in *Границы достоверности* |
| git | file enumeration, policy and consent history, retention-job history | `git log --since='24 months ago' -i -E --grep='gdpr\|privacy\|consent\|retention\|delete account' --oneline -- . "${GIT_EXCLUDE[@]}"` | none — git is this audit's floor |
| jq | dependency and configuration extraction | `jq -r '(.dependencies // {}) \| keys[]' package.json` | `sed -n '/"dependencies"/,/}/p' package.json`; other stacks `cat go.mod requirements.txt pyproject.toml Gemfile composer.json` |

## 6. Analysis rules and thresholds

A finding is filed **per data category** or **per recipient**, not per call site; call sites are its evidence.

| # | Condition | Threshold | Severity | Origin |
|---|---|---|---|---|
| T1 | Personal data reaching a log, a metric label, an error report or a session recording — a credential on the same line is A-14's row, cited in §3, and is not filed here | ≥ 1 call site | S1 | requirements |
| T2 | A data category with no technical path to deletion anywhere in the code | ≥ 1 category | S1 | requirements |
| T3 | A category transferred to a third party with no basis recorded in the repository or in `PROCESSORS` | ≥ 1 recipient | S1 | requirements |
| T4 | A category with no retention period declared anywhere | ≥ 1 category | S2 | requirements |
| T5 | Special-category data (health, biometrics, ethnicity, religion, politics, union membership, orientation, criminal record, precise geolocation, data of minors) held with no control beyond the ordinary — no encryption, no narrowed access, no separate note | ≥ 1 field | S1 | derived |
| T6 | A flow crossing a boundary in `JURISDICTIONS` with no residency or transfer mechanism recorded (the lawfulness of the crossing is a lawyer question, §8 addition 4) | ≥ 1 flow | S1 | derived |
| T7 | A third-party script that sets a persistent identifier or sends an event before a consent choice exists | ≥ 1 script | S1 when `REGULATIONS` names a consent-first regime, or names nothing while the locale list includes an EU/UK/BR market; otherwise S2 | derived |
| T8 | Deletion implemented in the primary store only — a store where the category also lives is not reached | ≥ 1 unreached store | S2; S1 when that store is a processor or an analytics warehouse | derived |
| T9 | Retention period declared with no mechanism, or a mechanism with no evidence it has run | ≥ 1 category | S2 | derived |
| T10 | Consent stored without proof — the record lacks subject, timestamp, policy version or scope — or the policy text carries no version | ≥ 1 missing field | S2 | derived |
| T11 | Consent can be given and not withdrawn | 0 withdrawal call sites | S2 | derived |
| T12 | Personal data in transit with verification disabled or over plaintext (`sslmode=disable`, `rejectUnauthorized: false`, `verify=False`, `InsecureSkipVerify`, `http://` to a processor) | ≥ 1 | S1 | derived |
| T13 | Special-category or direct-identifier data at rest with no encryption where the platform offers one | ≥ 1 store | S2 | derived |
| T14 | A staff or back-office read of personal data that is not journalled | ≥ 1 route | S2 | derived |
| T15 | Real-looking personal data committed to the repository — fixtures, seeds, dumps and HAR files | ≥ 1 file | S2; S1 for a special category or an evident production export | derived |
| T16 | A category present in code and absent from the policy or `DATA_CATEGORIES`, or declared there and absent from code | ≥ 1, either direction | S3 | derived |
| T17 | Processing readiness `P` (§9) | < 50% | S2 | derived |

`report-contract.md` §5's reachability and position rules apply once on top of every row. A cell you could not establish is `не установлено` — a cut to `confidence` named in *Границы достоверности*, never a crossing. **A threshold is crossed by a technical fact, never by a legal reading:** where a crossing would turn on a regime `REGULATIONS` does not name, file the fact at the severity its technical exposure earns and send the regime question to §8 addition 4.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

- **Sampling unit: the data category** — a set of fields sharing one purpose (contact, identity documents, payment, location, behaviour, health), not the field and not the file. `N` counts register rows.
- **Top-`N` ranking**, in order: special category; leaves the system, to a processor or across a border; direct identifier (mail, telephone, address, document, payment instrument); breadth, by the number of stores holding it from step 1; volume, from A-10 when its report was supplied.
- **The population is usually smaller than `N`.** Read it whole, record `coverage` as 100%, and spend the remainder at field level inside the widest categories. `C` is then drawn from **fields assigned to no category** — blob and `jsonb` columns, free text, derived scores — because that is where step 1's name-based grep is blind, and `coverage` says so.
- **Early stop:** the contract's control-sample stop, additionally requiring that every row of the processing register (§8 addition 1) carries every column backed by evidence or by the literal `не установлено`.

## 8. Report additions

1. **«Реестр обработки персональных данных»** — inside §7 *Приложения*. One row per category: категория | поля | источник | назначение | основание (as recorded, `не установлено` when the repository declares none) | место хранения | срок хранения | получатели | юрисдикция | finding ids. Every cell carries evidence or the literal `не установлено`. This table is `C_total` of §9.
2. **«Схема потоков данных»** — inside §7 *Приложения*. A Mermaid `flowchart` built from step 2, one `subgraph` per jurisdiction, every boundary-crossing edge labelled with the categories it carries and its `path:line`. A flow whose destination region could not be established is drawn dashed and labelled `юрисдикция не установлена`.
3. **«Матрица прав субъекта»** — inside §7 *Приложения*. Rows are the rights (доступ, экспорт, исправление, удаление, отзыв согласия); columns are the stores (основная БД, реплики, бэкапы, аналитика, логи, поисковый индекс, кэши и CDN, объектное хранилище, and each processor). Cells: `реализовано` / `частично` / `отсутствует` / `неприменимо`, each with `path:line`. It is the evidence for T2 and T8.
4. **«Вопросы, требующие участия юриста»** — inside §5 *Детальные находки*, as a numbered subsection **preceding** the findings. One line per question, naming the fact that raises it, the register row or finding id it attaches to, and what a lawyer would need in order to answer. A question here carries no severity and is never phrased as a conclusion.

## 9. Score

**Processing readiness** `P = C_ok / C_total`, unit: a ratio with a percentage. `C_total` is the number of rows in the processing register. `C_ok` counts the rows satisfying all three legs: a purpose and a basis **recorded** somewhere in the repository or the supplied policy (recorded, not judged lawful); a retention period with a mechanism and evidence it runs; and a deletion procedure reaching every store the category lives in, per §8 addition 3. Report the legs separately as well, because one number hides which one fails. Emit in §2 *Итоговая оценка* as `Готовность обработки: C_ok/C_total (NN%) — основание B/C_total, срок R/C_total, удаление D/C_total`. A leg you could not verify is not satisfied: `не установлено` counts against it, and the justification says how many rows were lost that way. Justify by naming the dominant failing leg, the category whose exposure costs most, and how many categories one missing mechanism would move.

## 10. Failure modes of this audit

1. **Writing a legal conclusion instead of a fact.** "This violates GDPR" is unverifiable, outside the audit's competence, and turns a factual report into a contested one. *Countermeasure:* every sentence is a fact plus a risk — "поле `users.email` уходит к процессору X за пределы `JURISDICTIONS`; механизм передачи в репозитории не зафиксирован" — and the words *нарушает*, *незаконно*, *не соответствует* appear nowhere. The judgement moves to §8 addition 4.
2. **Mistaking the field-name grep for the inventory.** Derived and inferred data (a score, a segment, a location inferred from an address, a device fingerprint) and opaque columns (`data`, `payload`, `meta`, `f1`) carry personal data under names step 1 cannot match. *Countermeasure:* the control sample `C` is drawn from unassigned fields (§7), and every blob column on a subject table stays `не установлено` until its writers are read.
3. **Trusting the privacy policy over the code.** The policy is a claim by the organisation being audited, and it lags the code by every feature shipped since it was written. *Countermeasure:* every register cell resolves to a `path:line` or a schema object; a policy-versus-code disagreement is filed in both directions as T16, never silently reconciled.
4. **Accepting a soft delete as deletion.** `deleted_at = now()` satisfies a route named `delete_account` and leaves every row in place, in the replicas, in the warehouse and at the processors. *Countermeasure:* the deletion leg is satisfied only by a purge with evidence; a flag flip records `частично` in the rights matrix and files T8.
5. **Counting a cookie banner as consent.** A banner that stores nothing proves nothing, and one that stores a boolean cannot show what was agreed to or when. *Countermeasure:* consent requires step 6's stored proof — subject, timestamp, policy version, scope, withdrawal — plus the pre-consent script set; anything less is T10 and T7.
6. **Missing the processors a tag manager loads.** A GTM or Segment container ships code that is not in the repository, so the register looks complete while the actual recipients are unknown. *Countermeasure:* record the container as one processor of unestablished contents, ask the user for the container export, and mark the gap in *Границы достоверности* — never infer its contents.
7. **Auditing the shipped code and the running page as if they were one.** A script removed from a template can survive in a cached bundle; a script present in code can be gated off at runtime. *Countermeasure:* the static reading defines the population and the network check, when authorised, confirms it; a disagreement between them is itself a finding.
8. **Reading an unset `REGULATIONS` as "no obligations".** An empty parameter means the auditor was not told, not that the client is unregulated. *Countermeasure:* file the facts anyway, rank by technical exposure, and put every regime question in §8 addition 4 beside the fact that raises it.

## 11. Audit-specific prohibitions

Beyond `report-contract.md` §9.

- **Do not copy a personal datum into the report, the appendices or the chat.** Field names, table names, counts and `path:line` — never a value, never a partial value, never a "redacted" sample from which a subject could be recognised. This extends the contract's secrets rule to a distinct class of data, and it is why §4 keys its `-l`/`-c` rule on the file as well as on the pattern: over a fixture or a seed, a *name*-matching `rg -n` prints the value beside the name.
- **File a T15 finding by path and count only.** The path, the categories its column names imply, and the count from `rg -c` on that path. The matched line is never printed, quoted, paraphrased or "shown with the value shortened", and the file is never attached to the report — the finding is that real-looking data is committed, and it stands on the path alone.
- **Do not query a production data store.** No `SELECT`, no row counts against live tables, no export, no read-only production DSN "just to count". Volumes come from A-10 or from a non-production copy.
- **Do not exercise the deletion, export or anonymisation path.** No subject request submitted, no account deleted, no retention job triggered, not even on staging with a seeded user — read the handlers and their tests.
- **Do not instrument the production site to test consent.** Loading the page fires the very trackers under audit and creates a real subject record from the auditor's own address. A network check runs only against a non-production URL the user explicitly authorises, only through the browser's own devtools, and never submits a form or creates an account.
- **Do not send processor names, endpoint hosts or the register anywhere** — no vendor DPA lookups, no compliance-checker services, no privacy-policy fetchers. Processors are named from the repository, and their contractual obligations are a lawyer's question.
- **Do not attempt re-identification.** No joining of datasets, no reversing of a hash or a pseudonymous id, no demonstration that an anonymisation is weak. Describe the risk from the code and stop.
- **Do not enable analytics or CMP debug modes** that emit events (a tag-manager preview, an analytics debugger, a `?debug` query the SDK forwards), and install no extension, agent or vendor debugger into the browser used for the check.

## 12. Dependencies

**Input, as parameter values and never as remembered context.** **A-10** supplies the schema, the retention and soft-delete inventory and the ER diagram, which seed `DATA_CATEGORIES` and step 3. **A-14** supplies its risk register, the rights matrix of its §8 addition 1, the log-destination list from its step 7 (which seeds step 5 here), and any regime gaps it filed as S4 observations against `COMPLIANCE_SCOPE`, which arrive as `REGULATIONS` context. Neither is required: with both absent, steps 1 to 3 build the inventory from the tree, *Границы достоверности* records the missing input and what it weakens, and `confidence` drops accordingly.

**Output.** `audit-index.md` lists no downstream audit for A-22, and this spec adds none. The processing register, the flow diagram and the rights matrix are produced for the client's legal counsel; the only machine-readable hand-off is the `json findings` block that `audit-summary` consolidates.

## 13. Nearest marvin command

`audit-index.md`'s command table carries no row for A-22, and no shipped command audits privacy. Three touch one step each. `/marvin:sec-compliance` is the closest by name and the easiest to confuse: it checks OWASP ASVS, a security-control standard, and answers "is the control present", where A-22 answers "which data, on what basis, deletable how" — the two meet only at step 8. `/marvin:sec-secrets` shares step 5's grep shape while hunting credentials rather than personal data. `/marvin:sec-scan` covers the access-control and leakage questions routed to A-14. Any of them may accelerate a step; its output is evidence to verify against the commands above, never a section to paste.
