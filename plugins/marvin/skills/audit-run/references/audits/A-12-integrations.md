# A-12 — Внешние интеграции и отказоустойчивость

> **Audit question.** What happens to the system when each external dependency fails?

## 1. Role and task

You audit every point where the system depends on a party it does not control, and close one question: what happens there when
the other side is slow, wrong, or gone. Judgement is made on code — a vendor's promise and an SDK's reputation are not evidence.
Besides the report, a run leaves two reusable artefacts in *Приложения*: the integration register (one row per dependency with
its call sites) and the resilience matrix, which later audits take as parameter values, not as context.

## 2. Audit-specific parameters

On top of the ten in `report-contract.md` §2.

| Parameter | Meaning | Derivation when unset |
|---|---|---|
| `INTEGRATION_LIST` | the external dependencies in play, or a path to the A-01 component register / A-11 contract inventory naming them | built entirely by protocol step 1 from code. A supplied list is a **hypothesis to confirm**, never the population: diff it against step 1 and file both directions — declared but absent from code, present in code but undeclared |
| `SLA_EXPECTATIONS` | latency and availability the product promises its users, per flow | use the platform's own hard limits as the ceiling — HTTP server, ingress, gateway or serverless function timeouts found in configuration — recorded as *выведено, не задано*. Ask the user only when a T5 decision turns on it and no platform limit exists in the tree; **when that ask goes unanswered, T5's own 30 s ceiling applies**, stated as an assumption in *Границы достоверности* |
| `CRITICAL_FLOWS` | flows whose failure costs money or trust — the same set A-07 and A-21 audit under this name | derived from `BUSINESS_CONTEXT`, the README, route and handler names, and the call sites of payment, auth and messaging SDKs. Ask which flows are the money flows when the repository does not say and an S0 call (T3) depends on it; with no answer, treat every flow touching a payment, an identity provider or a user-facing write as critical and state that assumption in *Границы достоверности* |

With all three empty the run completes: step 1 builds the population, T5 falls back to the platform ceiling and
then to its own 30 s ceiling, criticality to the payment/auth/write rule.

## 3. Scope

**In scope.** External HTTP, GraphQL and gRPC APIs of other parties; payment and billing providers; mail, SMS and push senders;
brokers and queues outside the system; object and file storage; third-party browser scripts (analytics, chat widgets, tag
managers, hosted fonts, CDN assets); identity and OAuth providers; webhooks both ways; hosted feature-flag services; their SDKs.

**Out of scope.** Internal services of the same system → A-09. The shape and versioning of the interfaces → A-11. Secret storage
strength, key scope and leakage → A-14; step 6 records only the fact. The project's own database and its migrations → A-10, its
loss and restore → A-18. Throughput and latency under load → A-15. Visibility of failures in telemetry → A-16. Currency,
licences and CVEs of the SDKs → A-03 and A-14. Service cost → A-19. RTO/RPO and recovery after an outage → A-18. The degraded
UI's accessibility → A-21.

On a third-party `<script>` three audits see three different properties and file one each: a missing `integrity=` → **A-14
T15**; the script blocking render → **A-15 T13**; T14 here keeps only the uncontrolled dependency itself.

## 4. Collection protocol

Aggregate greps over the whole tree first, then targeted reading of the ranked top `N` (§7).

**0. The search wrapper every step below uses.** ripgrep's defaults skip hidden files and honour `.gitignore`, which hides
`.env*`, `.github/`, `.circleci/` and `.npmrc` — the files this audit is largely about. `--hidden` and `--no-ignore` are this
audit's whole delta from `report-contract.md` §2, and they are also why the wrapper is needed: with the `.gitignore` protection
gone, §2's canonical `RG_EXCLUDE` is the only thing keeping vendored and generated trees out. Define `RG_EXCLUDE` and
`EXCLUDE_RE` from §2 before the first sweep — the second filters the path lists `git ls-files` and `find` hand back — and add
every `SCOPE_EXCLUDE` path to `RG_EXCLUDE` as one more `**/`-prefixed `-g '!…'`, never as a root-anchored glob.
```sh
rgx() { rg --hidden --no-ignore "${RG_EXCLUDE[@]}" "$@"; }
```

**1. Every external call, found in code and not in documentation.** Produces the **integration register**: name,
kind, transport, SDK version from the lockfile (opened by name — it stays out of the sweeps), call sites as
`path:line`, user-request or background, criticality. Cheap; covers 100% of the tree.
```sh
rgx -n -i -e 'https?://[A-Za-z0-9._-]+' -e '<script[^>]+src="https?://' -e 'stripe|paypal|adyen|twilio|sendgrid|mailgun|postmark|\bses\b|\bs3\b|gcs|azure|kafka|rabbit|amqp|sqs|pubsub|firebase|auth0|okta|segment|sentry|datadog'
rgx -n --no-heading -e '\bfetch\(' -e '\baxios\b' -e '\bgot\(' -e 'node-fetch|undici|HttpClient|RestTemplate|WebClient|OkHttp' -e 'requests\.(get|post|put|patch|delete|request)\b' -e 'httpx\.|urllib\.request|Net::HTTP|Faraday|http\.(Client|Get|Post)'
git ls-files -- '*.env*' '*docker-compose*' '*.tf' '*.yaml' '*.yml' '*.toml' '*.ini' | grep -Ev "$EXCLUDE_RE"
[ -f package.json ] && jq -r '(.dependencies // {}) + (.devDependencies // {}) | keys[]' package.json
```

**2. Failure behaviour per integration** — timeout set or infinite; retries and their strategy; idempotency
of a repeat; circuit breaker; what the UI and the data do while it is down. Read every constructed client
(`rgx -n -B 5 -A 15 -e 'new [A-Za-z]*Client\('`); produces the five matrix columns, each with its `path:line`.
```sh
rgx -n -i -e 'timeout|deadline|AbortSignal|AbortController|ReadTimeout|ConnectTimeout|context\.WithTimeout'
rgx -n -i -e 'retry|retries|backoff|jitter|max_?attempts|p-retry|axios-retry|tenacity|resilience4j|Polly|urllib3' -e 'circuit.?break|opossum|pybreaker|gobreaker|hystrix|bulkhead|kill.?switch'
```

**3. Partial failure.** A slow answer is worse than a refused connection: it holds a worker, a socket and often
a transaction. Produces a hang-exposure note per integration — which of connect / read / total budgets exist and
what is held meanwhile; `rgx -n -i -e 'beginTransaction|@Transactional|db\.transaction'` tells whether an
external call sits inside an open transaction.
```sh
rgx -n -i -e 'connect_?timeout' -e 'read_?timeout' -e 'AbortSignal\.timeout' -e 'Promise\.race' -e 'asyncio\.wait_for' -e 'context\.WithDeadline' -e 'orTimeout'
rgx -n -i -e 'keep_?alive|maxSockets|pool_?maxsize|MaxIdleConns|pool_size' -e 'visibility_?timeout|ack_?deadline|max_?poll_?interval'
```

**4. Idempotency** — what happens on a double send of a payment or an email. Produces a per-write verdict
(idempotent / not idempotent / not applicable) with the key and **where it is generated**, traced by
`rgx -n -B 10 -e 'Idempotency-Key'`; a key minted inside the retry loop is not idempotency.
```sh
rgx -n -i -e 'idempotenc|Idempotency-Key|X-Request-Id|dedup|exactly.?once|ON CONFLICT|upsert|unique.*(constraint|index)'
rgx -n -i -e 'charge|payment|payout|refund|invoice|subscription|send_?mail|send_?email|send_?message|notify'
```

**5. Consistency** — distributed operations with no compensation. Grep `rgx -n -i -e 'saga|compensat|outbox|inbox|two.?phase|reversal|undo|rollback'`, then read the enclosing function of
every writing register row and record the ordering (external write then local commit, or the reverse) and what
survives a crash between them. Produces that list, each entry with its failure window.

**6. Secrets and key rotation for the integrations, as a fact only;** detail belongs to A-14. Produces, per integration, where the
credential comes from (env, secret manager, file in tree) and whether the history shows a rotation within twelve months. Both
sweeps name files and print no line: open each named file, read the assignment **with the value elided**, and record the path, the
variable name and the credential type. `.env*` is normally untracked — `git ls-files` and `git grep` cannot see it; `rgx` can.
```sh
rgx -l -i -e 'API_KEY|SECRET|TOKEN|PRIVATE_KEY|CLIENT_SECRET|WEBHOOK_SECRET'
rgx -l -i -e 'vault|secretsmanager|parameter_?store|\bssm\b|keyvault|sops|doppler|\bkms\b'
git log --since='12 months ago' -i -E --grep='rotate|rotation|revoke|new key|credential' --oneline
```

**7. Tests and stubs for failure scenarios.** Produces the **failure-test coverage ratio**: critical integrations with at least
one test exercising a timeout or a non-2xx, over all critical integrations. Both sweeps carry a directory-aware glob beside the
basename ones, because without it a `test/`- or `__tests__/`-organised project returns nothing and manufactures T11 and T12
against a project that does test its failures. Read the matched tests — a file that merely imports `nock` proves nothing.
```sh
rgx -l -i -g '**/{test,tests,__tests__,spec,specs}/**' -g '*test*' -g '*spec*' -e 'nock|msw|wiremock|mockserver|responses\.|httpretty|vcr|betamax|testcontainers|httpmock'
rgx -n -i -g '**/{test,tests,__tests__,spec,specs}/**' -g '*test*' -g '*spec*' -e 'ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|\b50[234]\b|timeout|retr(y|ies)'
```

## 5. Tools

| Tool | What it measures here | Invocation | Fallback |
|---|---|---|---|
| Client-code reading | the authoritative answer for every matrix cell | open each client module from step 1; read the constructor and the call | none — this cannot be delegated to a grep |
| HTTP-client configuration | timeouts, pools, base URLs, interceptors, proxy retries | `git ls-files -- '*.env*' '*.yaml' '*.yml' '*.toml' '*.ini' \| grep -Ev "$EXCLUDE_RE"`, then read the hits | `find . -type f \( -name '*.env*' -o -name '*.yaml' -o -name '*.yml' -o -name '*.toml' -o -name '*.ini' \) \| grep -Ev "$EXCLUDE_RE"` — run it in addition to the primary whenever `.env*` is untracked |
| ripgrep, through `rgx` (§4 step 0) | call sites and timeout / retry / breaker / idempotency markers | `rgx -n --no-heading -i -e '<pattern>'` | `git grep -n -i -E '<pattern>'`, else `grep -RnIE '<pattern>' .` |
| ripgrep for the step-6 credential sweep | which files hold a credential — never its value | `rgx -l -i -e '<pattern>'` | `git grep -l -i -E '<pattern>'`, else `grep -RlIE '<pattern>' .`; the listing flag is not optional here — the `-n` forms print the matched line, which is the credential |
| Error-handler analysis | whether a `catch` degrades or swallows | `rgx -n -A 10 -e 'catch \(' -e 'except ' -e 'rescue' -e 'if err != nil'`, then read each hit | the grep fallbacks above; the reading is manual either way |
| git | history, file enumeration, rotation and incident evidence | `git log --since='12 months ago' -i --grep=timeout --grep=outage --grep=incident --grep=retry --oneline` — repeated `--grep` is git's OR; an alternation written `\|` inside a table cell is read as a literal pipe by `-E` and matches nothing | none — git is this audit's floor |
| jq | dependency lists from JSON manifests | `[ -f package.json ] && jq -r '(.dependencies // {}) + (.devDependencies // {}) \| keys[]' package.json` | `sed -n -E '/"(dev)?[Dd]ependencies"/,/}/p' package.json` — the bare `"dependencies"` form matches nothing in a devDependencies-only manifest; other stacks `cat go.mod requirements.txt pyproject.toml Gemfile composer.json pom.xml 2>/dev/null` |
| Failure logs, when a path is accessible | how the integrations actually fail in production | `grep -Rho -E -e ETIMEDOUT -e ECONNRESET -e ECONNREFUSED -e EAI_AGAIN -e '50[234]' <log-path> \| sort \| uniq -c \| sort -rn \| head -20` — one `-e` per pattern for the same reason | skip; record in `tools_unavailable` and say in *Границы достоверности* that behaviour rests on code alone |

**The three search tools see three different file sets** — `git grep` tracked files only, `grep -RnIE` everything including hidden and ignored, plain `rg` neither. Record in *Методология* which one ran, and when it
was `git grep`, that untracked `.env*` was outside the population.

## 6. Analysis rules and thresholds

A finding is filed **per integration**, not per call site; call sites are its evidence.

| # | Condition | Threshold | Severity | Origin |
|---|---|---|---|---|
| T1 | Outbound call whose effective total timeout is unset or infinite | ≥ 1 call site | S1 | requirements |
| T2 | Retry policy whose delay does not grow **exponentially** — fixed, zero, or linear interval | attempts ≥ 2, and for some `n` either `delay(n+1)/delay(n) ≤ 1` or the growth is a constant increment | S2 | requirements |
| T3 | Retried write that is not idempotent on a money path (charge, payout, refund, invoice, subscription) | ≥ 1 | S0 | requirements |
| T4 | Integration whose failure has no defined degradation — no fallback, no cache, no skip | ≥ 1 | S2 | requirements |
| T5 | Timeout set, but far above the flow's promised budget | > 10 × `SLA_EXPECTATIONS`; when it is unset, > 10 × the platform ceiling of §2, and > 30 s on a synchronous user-facing call when the tree holds no platform limit either | S2 | derived |
| T6 | Retries unbounded in total elapsed time, or many attempts with no jitter and no breaker | attempts ≥ 5, or no elapsed budget | S2 | derived |
| T7 | Critical-flow integration with no circuit breaker, bulkhead, budget or kill switch | ≥ 1 | S2 | derived |
| T8 | Operation writing to ≥ 2 systems with no compensation, outbox or reconciliation | ≥ 1 | S1 | derived |
| T9 | External call inside an open database transaction, or holding a request thread with no budget | ≥ 1 | S1 | derived |
| T10 | Integration on a critical flow with no alternative provider, cache or queue — an external single point of failure | ≥ 1; every such row is also counted into `K` (§9) | S1 | derived |
| T11 | Critical integration with zero tests exercising a timeout or a 5xx | 0 tests | S2 | derived |
| T12 | Failure-scenario test coverage across the critical integrations | < 50% | S3 | derived |
| T13 | Integration credential with no rotation in history and no secret manager | 0 rotations / 12 months | S3 | derived |
| T14 | Third-party script from an origin the project does not control, with no self-hosted copy and no defined behaviour when the origin fails to serve it (§3 routes its SRI to A-14 and its render cost to A-15) | ≥ 1 | S2 | derived |

`report-contract.md` §5's reachability and position rules apply once on top of the table. T4 is deliberately scoped to *every*
integration: S2 is the floor the requirements set for the non-critical case, and the position rule — not a second row — raises
the same missing degradation on a payment, auth or credential path. A cell you could not establish is `не установлено` — a cut
to `confidence` named in *Границы достоверности*, not a crossing.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

- **Sampling unit: the integration.** `N` counts register rows, not files.
- **Top-`N` ranking**, in order: on a `CRITICAL_FLOWS` path; moves money or sends to a person; synchronous in a
  user request rather than a background job; fan-out, by call-site count from `rgx -c`; a shared client other
  integrations are constructed from.
- **When the population is exhausted before `N`** — the usual case here — spend the remainder on the call sites
  of the highest-fan-out rows: `C` is then drawn from **call sites** rather than integrations, which makes the
  run two-population — `coverage` states both clauses in the contract's semicolon form, integrations first.
  One integration whose call sites disagree about timeouts is what that buys.
- **Early stop:** the contract's control-sample stop, additionally requiring that every register row has all
  five matrix columns backed by a `path:line`.

## 8. Report additions

1. **Матрица устойчивости интеграций** — inside §7 *Приложения*. One row per register entry, columns:
   интеграция | тип | таймаут (value + `path:line`) | ретраи (strategy, attempts, delay) | идемпотентность
   (да / нет / неприменимо + where the key comes from) | circuit breaker | деградация (what the user sees, what
   happens to the data) | критичность | finding ids. Every cell carries evidence or the literal `не установлено`.
2. **Сценарии отказа** — inside §5 *Детальные находки*, as a subsection preceding the findings. One paragraph per
   critical integration in three modes: полный отказ, медленный ответ, частичный или ошибочный ответ. Each traces
   the code path, names its end state for the user and for the data, cites `path:line`, and lists the finding ids
   it evidences. An untraceable scenario is not written.
3. **Вопросы команде** — inside §7 *Приложения*. One row per matrix cell left `не установлено` and per §2 ask that went
   unanswered: вопрос | что он решает (matrix cell, threshold) | что принято на время (the platform ceiling, the 30 s ceiling,
   the payment/auth/write rule) | как изменится отчёт при каждом ответе. Never empty while any cell is `не установлено`.

## 9. Score

Two numbers, reported together in §2 *Итоговая оценка* and never averaged into one. **Protection ratio** `P / T`, unit: a ratio
with a percentage — `T` is the number of register rows, `P` counts the rows meeting all five conditions (a finite total timeout;
bounded retries with growing delay, or a deliberate no-retry on a non-idempotent write; idempotency for every retried write; a
breaker, bulkhead or kill switch; a degradation defined for UI and for data). **External single points of failure** `K`, unit: a
count — register rows satisfying T10. Emit as `Полная защита: P/T (NN%); внешних точек отказа: K`. The justification names the
dominant failure class, the integration whose loss costs most, and the largest number of rows blocked by one missing mechanism.

## 10. Failure modes of this audit

1. **Trusting an SDK default** — the central risk. Node's `fetch`/undici sets no total timeout, axios ships `timeout: 0`, Python
   `requests` has none, Go's zero-value `http.Client` has none, Java's `HttpClient` has no request timeout. *Countermeasure:* no
   explicit timeout in code is recorded as **no timeout**; to record otherwise, quote the SDK version from the lockfile and its documented default.
2. **Auditing configuration instead of call sites** — one config sets a timeout, three other sites build their own
   client. *Countermeasure:* every call site resolves to a client whose configuration you read; an unresolved one counts as unprotected.
3. **Crediting a platform timeout to the client** — a gateway or function limit ends the caller's request while the
   socket and the worker still hang. *Countermeasure:* record platform limits in their own column; they never satisfy T1.
4. **Missing a retry layer** — retries in an SDK, a proxy and application code multiply into a storm.
   *Countermeasure:* count retry layers per call path; two or more uncoordinated ones is a T6 finding.
5. **Reading a `try`/`catch` as degradation** — a swallowed error returning `null` corrupts data silently.
   *Countermeasure:* the cell states what the user sees and what the data becomes; a bare catch is a T4 finding
   at S2, promoted one row by position when the integration sits on a money, auth or credential path.
6. **Accepting an idempotency key at face value** — a fresh UUID per attempt makes retries look safe.
   *Countermeasure:* record where the key is generated; a key not stable across attempts is `нет`.
7. **Under-counting the population** — an integration reached through a generic HTTP helper, an inbound webhook or a URL in an
   environment variable is invisible to a name grep, and a list copied from documentation lags the code, which is why step 1
   forbids it. *Countermeasure:* cross-check the register against the outbound host list, the egress allowlist or CSP
   `connect-src`, and `INTEGRATION_LIST`; file both directions as findings.
8. **The tool's own defaults hid the file the answer was in — or printed what it must not.** Plain `rg` skips hidden files and
   honours `.gitignore`, so a tree whose credentials sit in `.env` and whose timeouts sit in `.github/` reads as having neither,
   and step 6 reports "no credential in tree" for a project that has them. The mirror image is worse: `rg -n` and `grep -Rn`
   print the whole matching line, so a credential sweep leaks the value it was sent to count. *Countermeasure:* every sweep runs
   through `rgx`, and the step-6 sweeps run with the listing flag only — name the file, then open it and read the value elided.

## 11. Audit-specific prohibitions

Beyond `report-contract.md` §9.

- **Do not call the integrations.** No `curl` to a vendor endpoint, no sandbox charge, no test email or SMS, no
  webhook replay, no requeued message. Read the client code and the recorded failure logs.
- **Do not inject faults.** No chaos experiment, no host blackholed in `/etc/hosts` or a firewall, no flag
  toggled, no proxy inserted, no load test. Behaviour comes from code paths and past incidents.
- **Do not run the project's failure tests if they open sockets or start containers** (`testcontainers`, a
  `docker compose up`, a recording VCR cassette), and **do not run package managers that write** — `npm install`,
  `go mod tidy`, `go list -m all`, `bundle install`. Read the test bodies and the manifests.
- **The listing flag (`-l`, `-Rl`) is mandatory in every step-6 sweep and in its fallbacks**, and the elision
  continues into the reading of every file it names (`report-contract.md` §9). §10 item 8 is the mechanism.
- **Do not send the integration inventory anywhere** — host names, endpoint URLs, tenant or key ids,
  webhook paths — including to uptime checkers, status pages and reachability probes.

## 12. Dependencies

**Input, as parameter values and never as remembered context:** A-01 supplies the component register that seeds `INTEGRATION_LIST`;
A-11 the contract inventory, which separates an interface this system owns from one it consumes. Neither is required — with both
absent, step 1 builds the population from code, *Границы достоверности* records the missing input, and `confidence` drops.

**Output:** the resilience matrix and the external-SPOF count go to **A-16** (наблюдаемость), which reads its telemetry gaps off
the same matrix, and to **A-18** (надёжность и восстановление), which turns them into RTO/RPO and recovery paths. Hand either
one this report's path.

## 13. Nearest marvin command

`audit-index.md`'s command table carries no row for A-12: no shipped command audits resilience, and two touch one step each.
`/marvin:sec-secrets` overlaps step 6 — it hunts leaked credentials, while A-12 records only that a credential exists, where it
comes from and whether it was rotated, leaving the rest to A-14. `/marvin:sec-deps` overlaps step 1's SDK inventory, ranking
vulnerabilities rather than describing failure behaviour. Either may accelerate a step; its output is evidence to verify.
