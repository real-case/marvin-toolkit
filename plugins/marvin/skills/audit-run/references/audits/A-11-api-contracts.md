# A-11 — Контракты API

> **Audit question.** How predictable are this project's interfaces for the people who consume them, and how safe are they to change?

## 1. Role and task

You audit the contracts the project exposes outward — HTTP, GraphQL, gRPC and asynchronous events — as artefacts other people depend on. You close one question: can a consumer predict the interface from what is published, and can a maintainer change it without breaking someone silently. You judge the contract, not the implementation behind it and not the authorisation in front of it.

Besides the report, a successful run leaves three enumerations that later audits take as parameter values: the operation inventory with its drift marks, the error-format catalogue, and the consumer list with known and presumed entries separated (§8, §12).

## 2. Audit-specific parameters

On top of the ten standard parameters of `report-contract.md` §2.

| Parameter | Meaning | Default and derivation when unset |
|---|---|---|
| `API_TYPES` | which interface kinds exist: REST, GraphQL, gRPC, events | detect in step 1: OpenAPI/Swagger files or HTTP route registrations → REST; `.graphql`/`.graphqls` or a `type Query` declaration → GraphQL; `.proto` carrying `service`/`rpc` → gRPC; AsyncAPI files or broker publish call sites → events. Record every kind found and audit each as its own surface |
| `SPEC_PATHS` | paths of machine-readable specifications | the `git ls-files` filter of step 1. Matching nothing leaves the parameter empty and fires threshold T1 — an empty value is a finding, not a blocker |
| `CONSUMERS` | who calls each surface | derived in step 6 from in-repo call sites, then `ACCESS_LOGS`, then deployment configuration; each entry labelled `known` or `presumed`. Ask the user only when the surface is contracted to external partners and neither repository nor logs name them; continue with `presumed` if no answer arrives |
| `HISTORY_BASE_REF` | the revision compatibility is measured against | `git describe --tags --abbrev=0`; with no tags, `git rev-list -1 --before='180 days ago' HEAD`; in a younger repository, `git rev-list --max-parents=0 HEAD`. Record which rule fired |
| `ACCESS_LOGS` | path or glob of access/gateway logs available locally; step 6 expands it unquoted, so a glob is deliberate and a glob matching no file is the same as unset | unset, or matching nothing → skip the log branch of step 6, mark every consumer `presumed`, and cap consumer findings at `confidence: hypothesis` |

## 3. Scope

### In scope

Machine-readable specifications and their currency; the operation inventory and its drift against code; consistency of error bodies, status codes, pagination, filtering, naming, date formats and empty-value handling; the versioning mechanism, the deprecation policy and support for retired versions; backward compatibility in history and whether CI enforces it; consumer knowledge and contract tests; request validation at the boundary and its agreement with the specification; whether the surface publishes rate-limit terms at all, as a presence fact and never as a judgement of the number (T16). The published consumer-facing reference is here too, as a contract artefact rather than as prose: whether one exists at all, whether it is older than the specification it describes, and whether its examples agree with that specification and with the code.

### Out of scope

- Authentication, authorisation, the role × resource matrix and per-endpoint ownership checks → **A-14**.
- Latency, payload size and query amplification → **A-15**. A statement with no `LIMIT` over a table that grows with usage is **A-15**'s row as well: its unit is the query, T12's unit is the operation's published contract, and that difference in unit is why the two rows may carry different severities for what looks like one defect. What stays here is the contract-level term — an operation whose contract offers no limit and no cursor.
- Whether a documented rate limit is **adequate**: no audit in this family judges it. The documented *existence* of rate-limit terms stays here as a published contract term (T16); their existence as a brute-force control on the authentication surface is **A-14**'s row, cited rather than restated.
- Behaviour when an interface the project *calls* fails — retries, timeouts, fallbacks → **A-12**. This audit covers interfaces the project *exposes*.
- Schema and migration reversibility behind the API → **A-10**; strength of the type system carrying the DTOs → **A-06** (arrives as input, §12).
- Prose documentation quality, its structure and how knowledge is distributed across the team → **A-20**. What stays here is the consumer-facing reference judged against the specification and the code, and nothing else about documentation.
- Personal-data fields in payloads and their lawful basis → **A-22**; the project's own client-side consumption patterns → **A-13**.
- Commercial and SLA terms of a published API: **no audit in this family covers them**. Say so in *Границы достоверности* if the question is raised.

## 4. Collection protocol

Resolve `API_TYPES` and `SPEC_PATHS` first; every step runs once per surface, and three shell variables carry the surface being audited through the steps below: **`$SPEC`** is that surface's machine-readable specification — the member of `SPEC_PATHS` belonging to it, never the whole set — **`$GQL_SPEC`** its `.graphql`/`.graphqls` schema, **`$PROTO_SPEC`** its `.proto` file. Create the run's scratch directory once, `TMP=$(mktemp -d)`, and — where `$SPEC` is an OpenAPI or AsyncAPI document — normalise it into JSON there before any `jq` runs: such documents are more often YAML than JSON, and `jq` parse-errors on YAML rather than degrading.

```sh
SPECJSON=$TMP/spec.json
case "$SPEC" in *.json) cp "$SPEC" "$SPECJSON";; *) yq -o=json '.' "$SPEC" > "$SPECJSON";; esac
```

Every `jq` filter below reads `"$SPECJSON"`; every `git`, `oasdiff`, `spectral` and diff command reads the specification's own path. Path exclusions are `report-contract.md` §2's canonical set — `"${RG_EXCLUDE[@]}"` on every `rg` census, `"${GIT_EXCLUDE[@]}"` on every `git ls-files` — and this audit adds none of its own. Step 8's two fixture censuses are the only deliberate exception and say so where they stand; a command given an explicit file or directory list is not a census and carries neither array.

**When a surface has no specification** — `SPEC_PATHS` empty, or empty for this surface — file T1 and skip the specification side of the protocol rather than dereferencing an empty `$SPEC`: step 2 keeps only the handler dates, step 3 runs from handler and middleware code alone, step 5 from the code-level git signals alone, step 7 from the validation call sites alone. Record the reduced protocol in *Границы достоверности*. When step 1 finds no interface of any kind, file one S4 observation, record `coverage` as `0/0`, and stop — a project that exposes nothing has no contract to audit.

**1 — Inventory of operations and events, matched against the specification.** Enumerate from code first and from the specification second: the code side is the population, the specification side is a claim about it. The `jq` reads `.paths` for OpenAPI and `.channels` for AsyncAPI, then `{}`: an event surface carries no `paths`, and a filter naming that key alone exits 5 on the whole branch instead of enumerating it.

```sh
git ls-files -- . "${GIT_EXCLUDE[@]}" | grep -Ei '(openapi|swagger|asyncapi).*\.(ya?ml|json)$|\.(graphql|graphqls|proto)$'
rg -n "${RG_EXCLUDE[@]}" '\.(get|post|put|patch|delete)\(|@(Get|Post|Put|Patch|Delete|Controller)\('   # Express, Koa, Nest, tsoa
rg -n "${RG_EXCLUDE[@]}" '@(Get|Post|Put|Patch|Delete|Request)Mapping|\[Http(Get|Post|Put|Patch|Delete)\]|HandleFunc\('
rg -n "${RG_EXCLUDE[@]}" -g '*.py' 'path\(|re_path\(|router\.register\(|@(app|router)\.(get|post|put|patch|delete)\('
rg -n "${RG_EXCLUDE[@]}" '^\s*rpc |type (Query|Mutation|Subscription)|publish\(|produce\(|sendMessage\('
jq -r '(.paths // .channels // {}) | to_entries[] | "\(.key) \(.value | keys | join(","))"' "$SPECJSON"
```

Produces: the operation table of §8, one row per operation, each marked `documented`, `undocumented` (in code, absent from the specification) or `phantom` (in the specification, no handler resolvable in code); and the population count for §7.

**2 — Currency of the specification.** Decide per surface whether it is generated from code, maintained by hand or absent, and whether anything checks the two for divergence.

```sh
rg -n 'swagger-jsdoc|@nestjs/swagger|springdoc|drf-spectacular|tsoa|utoipa|go-swagger' package.json pom.xml build.gradle requirements.txt pyproject.toml go.mod 2>/dev/null
git log -1 --format=%cI -- "$SPEC"; git log -1 --format=%cI -- src/api
rg -n 'spectral|oasdiff|graphql-inspector|buf breaking|git diff --exit-code' .github/workflows .gitlab-ci.yml Jenkinsfile .circleci 2>/dev/null
```

The same step locates the published consumer-facing reference — `git ls-files -- . "${GIT_EXCLUDE[@]}" | grep -Ei 'redocly|docusaurus|mkdocs|slate|(^|/)(docs?|reference)/.*api.*\.(mdx?|html)$'` — and dates it with `git log -1 --format=%cI --` on the path it returns.

Produces: per surface, `generated | manual | absent`; the drift-check job with its file and name, or its absence; the age gap in days between specification and handlers; and the consumer-facing reference with its path and its own age gap against the specification, or its absence. Feeds T1, T2, T15 and failure mode R3.

**3 — Consistency across the surface.** Seven dimensions, decided once per surface: error body shape, status codes, pagination, filtering, naming, date/time format, empty-value handling. The block's last line collects one further fact that is **not** an eighth dimension and takes no `consistent | mixed | undefined` verdict: whether the surface publishes rate-limit terms at all — a rate-limit or `Retry-After` header, a declared `429`, a written quota — which is T16's input and the whole of what this audit files about them (§3).

```sh
rg -l 'errorHandler|ExceptionFilter|@ExceptionHandler|problem\+json|ProblemDetail' src
rg -o --no-filename --replace '$1' 'status\(\s*([0-9]{3})' src | sort | uniq -c | sort -rn
rg -n -i 'limit|offset|per_page|cursor|next_token|toISOString|DateTimeFormatter|strftime|nullable|omitempty' src
jq -r '[.. | objects | select(has("properties")) | .properties | keys[]] | unique[]' "$SPECJSON" | awk '/_/{s++} /[A-Z]/{c++} END{print "snake="s+0, "camel="c+0}'
rg -n -i "${RG_EXCLUDE[@]}" 'x-ratelimit|retry-after|rate.?limit|throttl' .; jq -r '[.. | objects | keys[]? | select(test("^429$|^x-ratelimit|retry-after"; "i"))] | unique[]' "$SPECJSON"
```

Produces: the error-format catalogue of §8, the status-code histogram, a verdict of `consistent | mixed | undefined` per dimension, and the surface's published rate-limit terms with the file that carries them, or their absence. Feeds T4, T11–T13 and T16.

**4 — Versioning.** Identify the mechanism, whether a deprecation policy exists in writing, and how many versions are live.

```sh
rg -o '/v[0-9]+/' --no-filename src | sort | uniq -c
rg -n -i "${RG_EXCLUDE[@]}" 'accept-version|x-api-version|Sunset:|Deprecation:|@deprecated|deprecated = true|reserved '
rg -n -i 'deprecat|sunset|end.of.(life|support)' README* CHANGELOG* docs 2>/dev/null
git ls-files -- . "${GIT_EXCLUDE[@]}" | grep -E '/v[0-9]+/' | sed -E 's#.*/(v[0-9]+)/.*#\1#' | sort | uniq -c
```

Produces: the mechanism (`path | header | media type | schema-level | none`), the number of concurrently supported versions, and the deprecation policy with its location or its absence. Feeds T7.

**5 — Compatibility in history and its enforcement.** Compare the current contract against `HISTORY_BASE_REF`, and look for a CI gate that would have refused a break.

```sh
git show "$HISTORY_BASE_REF":"$SPEC" > "$TMP/base.yaml"; oasdiff breaking "$TMP/base.yaml" "$SPEC"
git show "$HISTORY_BASE_REF":"$GQL_SPEC" > "$TMP/base.graphql"
npx --yes @graphql-inspector/cli@7.0.0 diff "$TMP/base.graphql" "$GQL_SPEC"
buf breaking --against ".git#ref=$HISTORY_BASE_REF"
git log -S'"/v1/' --oneline -- src; git log --diff-filter=D --name-only --format='%h %cI' -- "$SPEC" src/api
```

Every comparison in this step is measured against `HISTORY_BASE_REF` and against nothing else; a detector pinned to a branch name would put one signal on a different baseline from the rest. `buf breaking` additionally needs a `buf.yaml` module in the tree — a project with `.proto` files and no module takes the §5 git-diff fallback and is not recorded as a missing tool.

Produces: the list of breaking changes since the base ref, each with its commit; and the enforcement state of the CI gate — `enforced`, `advisory` or `absent`. Feeds T3, T9 and the second half of the score.

**6 — Consumers.** Three evidence sources in descending strength: in-repo call sites, access logs, deployment configuration.

```sh
rg -n "${RG_EXCLUDE[@]}" 'fetch\(|axios\.|HttpClient|requests\.(get|post)|grpc\.Dial'
rg -l "${RG_EXCLUDE[@]}" 'pact|@pact-foundation|spring-cloud-contract|dredd|schemathesis|karate' .
git ls-files -- . "${GIT_EXCLUDE[@]}" | grep -Ei '(^|/)pacts?/|contract.*test'
for f in $ACCESS_LOGS; do [ -f "$f" ] || continue; awk '{split($7,p,"?"); print p[1]}' "$f"; done | sort | uniq -c | sort -rn | head -50
for f in $ACCESS_LOGS; do [ -f "$f" ] || continue; awk -F'"' '{print $6}' "$f"; done | sort | uniq -c | sort -rn | head -30
```

`$ACCESS_LOGS` is unquoted in both loops on purpose, because the parameter is documented as a glob and quoting it would suppress the expansion — the two commands would then read no file at all while the audit believed logs were supplied. A glob that matches nothing leaves the loop with no iteration, which is treated exactly as no logs: every consumer stays `presumed`, its findings are capped at `confidence: hypothesis`, and *Границы достоверности* records that the pattern matched nothing rather than that none was given.

The query string is cut inside the pipeline, not afterwards: request targets carry API keys, session and reset tokens, e-mail addresses and account identifiers, and a line that reaches the appendix cannot be unread. The second loop's user-agent strings carry device and installation identifiers — resolve them to a client family and a count, and record only that (§11).

Produces: the consumer list of §8 with per-entry evidence; the set of operations covered by a contract test; and, where logs exist, the observed call distribution together with the window length in days. Feeds T8 and failure mode R5.

**7 — Input validation at the boundary and its agreement with the specification.** Locate the validation library — `rg -n "${RG_EXCLUDE[@]}" 'zod|joi|yup|class-validator|ajv|pydantic|marshmallow|jakarta.validation|@Valid|go-playground/validator'` — then, for each sampled operation, read the handler and compare what it enforces against what the contract declares, e.g. `jq -r '.paths["/orders"].post.requestBody.content["application/json"].schema.required[]' "$SPECJSON"`, and on an event surface the same read against the message payload, `jq -r '.channels["order/created"] | .. | objects | select(has("payload")) | .payload.required[]?' "$SPECJSON"`. Produces: per sampled operation, `validated | partial | absent`, plus the fields required by the specification and not enforced by code, and the reverse. Feeds T10.

**8 — Sample verification of the specification against real behaviour.** Mandatory; §10 R1 says why. Verify at least `K = max(5, N/3)` operations from the top-N sample against recorded behaviour rather than against the specification's own words. Find the recordings with `git ls-files | grep -Ei 'cassette|fixture|__snapshots__|\.(http|rest)$|golden'` and the assertions with `rg -n 'expect\(.*status|assertStatus|status_code ==' test tests spec 2>/dev/null` — the two censuses that deliberately run without the contract's exclusions, because snapshots and fixtures are the evidence here rather than a population being measured. Sources in descending strength: recorded HTTP fixtures and VCR cassettes; integration-test assertions on status codes and body shapes; committed generated clients; and, only with the owner's explicit approval, a locally started instance queried with safe methods (§11). Produces: the `verified | contradicted | unverified` column of the operation table, and the mismatch count the score's numerator depends on.

## 5. Tools

| Tool | What it measures | Invocation | Fallback when absent |
|---|---|---|---|
| `git` | inventory, history, base ref, staleness | `git log -1 --format=%cI -- "$SPEC"` | none needed; git is the floor |
| `ripgrep` (`rg`) | route, resolver, error and validation call sites | `rg -n '@(Get\|Post)\(' src` | `grep -rEn '@(Get\|Post)\(' src` |
| `jq` | operation and field enumeration from the normalised specification | `jq -r '(.paths // .channels // {}) \| keys[]' "$SPECJSON"` | `python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(*(d.get('paths') or d.get('channels') or {}),sep=chr(10))" "$SPECJSON"` |
| `yq` (mikefarah v4) | normalises a YAML specification into `$SPECJSON` (§4 preamble) | `yq -o=json '.' "$SPEC" > "$SPECJSON"` | `python3 -c "import yaml,json,sys;json.dump(yaml.safe_load(open(sys.argv[1])),open(sys.argv[2],'w'))" "$SPEC" "$SPECJSON"`; with no PyYAML either, `rg -n '^  /' "$SPEC"` lists path keys and the method is recorded as textual |
| `spectral` | specification quality and house rules | `printf 'extends: ["spectral:oas"]\n' > "$TMP/.spectral.yaml"; npx --yes @stoplight/spectral-cli@6.16.3 lint --ruleset "$TMP/.spectral.yaml" "$SPEC"` — `spectral:asyncapi` for an AsyncAPI document. Spectral 6 has no default ruleset and errors without `--ruleset` unless the project ships its own `.spectral.yaml`; when it does, run that one instead and say so | check rows T11–T13 of §6 by hand; record in `tools_unavailable` |
| `oasdiff` | breaking changes between two OpenAPI revisions | `oasdiff breaking "$TMP/base.yaml" "$SPEC"` | `git diff "$HISTORY_BASE_REF" -- "$SPEC"` read for removed paths, removed fields, narrowed types, new required fields |
| `graphql-inspector` | breaking changes between two GraphQL schemas | `npx --yes @graphql-inspector/cli@7.0.0 diff "$TMP/base.graphql" "$GQL_SPEC"`, after step 5 has extracted the base side | `git diff "$HISTORY_BASE_REF" -- "$GQL_SPEC"` under the same four rules |
| `buf` | proto lint and breaking changes | `buf breaking --against ".git#ref=$HISTORY_BASE_REF"` | `git diff "$HISTORY_BASE_REF" -- "$PROTO_SPEC"` for changed field numbers, removed fields, changed types — also the route for a tree with `.proto` files and no `buf.yaml` module, which is a missing configuration and not a missing tool |
| Pact / contract tests | whether consumers pin the contract executably | detection only, and a census, so it carries the contract's array exactly as its twin in §4 step 6 does: `rg -l "${RG_EXCLUDE[@]}" 'pact\|spring-cloud-contract\|dredd' .` | `git ls-files -- . "${GIT_EXCLUDE[@]}" \| grep -Ei '(^\|/)pacts?/'`; absence is itself the measurement (T8) |
| access-log analysis | which operations real consumers call | `for f in $ACCESS_LOGS; do [ -f "$f" ] \|\| continue; awk '{split($7,p,"?"); print p[1]}' "$f"; done \| sort \| uniq -c \| sort -rn` | no logs, or a glob matching none → consumers are `presumed`, findings capped at `hypothesis`, and *Границы достоверности* says so |

## 6. Analysis rules and thresholds

| # | Condition | Threshold | Severity | Origin |
|---|---|---|---|---|
| T1 | machine-readable specification files for a surface | `= 0` | S2 | requirements |
| T2 | drift-check jobs in CI where the specification is maintained by hand | `= 0` | S2 | requirements |
| T3 | breaking changes since `HISTORY_BASE_REF` released with no version bump and no new version path | `>= 1` | S1 | requirements |
| T4 | distinct error body shapes within one API surface | `> 1` | S2 | requirements |
| T5 | undocumented operations as a share of the code-side population | `> 10%` | S2 | derived |
| T6 | phantom operations (documented, no handler resolvable) | `>= 1` → S3; `> 10%` of the specification's own operation list, which is the only population containing them | S2 | derived |
| T7 | written deprecation rules where at least one version has been retired | `= 0` | S2 | derived |
| T8 | operations covered by a contract test where at least one external consumer exists | `= 0` | S2 | derived |
| T9 | blocking CI job running a breaking-change detector | `= 0` → S2; advisory only | S3 | derived |
| T10 | sampled write operations with no boundary validation | `>= 1` → S3; `> 20%` of the sample | S2 | derived |
| T11 | distinct date/time serialisation formats on one surface | `> 1` | S3 | derived |
| T12 | operations whose contract offers no limit and no cursor on a returned collection | `>= 1` → S3; `> 5` | S2 | derived |
| T13 | field-naming conventions in use on one surface (snake, camel, other) | `> 1` | S3 | derived |
| T14 | sampled operations whose recorded behaviour contradicts the specification | `>= 1` → S2; `> 25%` of `K` | S1 | derived |
| T15 | surfaces with at least one external consumer whose published consumer-facing reference is absent, or was last committed before the specification's last change | `>= 1` | S3 | derived |
| T16 | published rate-limit terms — header, declared `429` or written quota — on a surface with at least one external consumer; presence only, never adequacy (§3) | `= 0` | S3 | derived |

Overrides:

- Apply `report-contract.md` §5's promotion and discount with the operation as the unit. For this audit, *unreachable* means a surface whose every caller ships inside the same deployable, because a break there is caught by the project's own build.
- T3 does not fire for a surface marked experimental *in a committed document* whose effective date precedes the change. Quote the document; a comment in code is not a policy.
- T1 and T5 never double-count: a surface with no specification at all files T1 once and does not additionally file T5 at 100%.
- T12 judges the published contract and nothing behind it. The unbounded *statement* serving the same list is **A-15**'s row, cited rather than restated here; §3 states why one defect can carry two severities across the two units.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

- **Sampling unit:** `operations`, with the definition `report-contract.md` §8 gives it and no local variant. The population is the code-side inventory of step 1, never the specification's list; *Методология* names that enumeration as the one that produced it, which is what makes this report's coverage comparable with A-14's and A-15's.
- **Top-N ranking**, in order: externally reachable before internal; state-changing before read-only; named in `BUSINESS_CONTEXT` before not; then handler churn, `git log --since='12 months ago' --format= --name-only -- src/api | sort | uniq -c | sort -rn`; then breadth of consumers from step 6.
- **Split `N` across surfaces proportionally** to operation count. A project with REST and gRPC does not spend all of `N` on the larger one; each surface gets at least three operations, or its whole population when that is smaller.
- **Audit-specific early stop:** the contract's control-sample stop, additionally requiring that every one of the seven consistency dimensions of step 3 already holds a verdict — they are properties of a surface, not of an operation, and a control sample that surfaces no new class while a dimension is still undecided does not license stopping. Record in *Границы достоверности* which of the two conjuncts held last.
- Deciding all seven early is **not** that stop and shortens no sample: it retires step 3's own reading, while steps 7 and 8 carry on to `N` and the control sample to `C`. Record that as a step-3 stop, not as a reduced sample.
- Step 8 never stops early: `K = max(5, N/3)` is a floor, and falling below it caps `confidence` at `medium`.

## 8. Report additions

Three additions. All three are enumerations rather than judgements, so all three go in report section **7 (Приложения)**; every finding in section **5 (Детальные находки)** that rests on one of them cites the appendix row in its *Доказательство* field.

1. **«Таблица эндпоинтов»** (*Endpoint table*) — Приложения. One row per operation: surface, the operation identified in the form `report-contract.md` §8 defines, source (`code`, `spec`, `both`), state (`documented`, `undocumented`, `phantom`), verification (`verified`, `contradicted`, `unverified`), version, consumer-facing (`yes`/`no`), rate-limit terms (`yes`/`no`, presence only — the row T16 reads), owning module path. The counts in the state and verification columns are the score's inputs and are repeated in report section 2. This is the table A-12 and A-14 consume as their operation population (§12).
2. **«Каталог форматов ошибок»** (*Error-format catalogue*) — Приложения. One row per distinct error body shape: the shape as field names only and never a captured payload, the module or middleware that emits it, the status codes it appears with, and the operations affected. More than one row is the evidence for the T4 finding.
3. **«Список потребителей»** (*Consumer list*) — Приложения. One row per consumer: name or identifier, `known` or `presumed`, the evidence (call site, log line count and window length, deployment configuration), the operations it uses, and whether a contract test pins them. This is the appendix A-12 consumes (§12).

## 9. Score

Two components, as the requirements state: coverage by a *current* specification, and the presence of automatic compatibility control. Currency is a **factor of the numerator**, not a separate finding filed elsewhere — an operation described by a document nobody checks against the code is not a covered operation, and counting it as one is the outcome R1 says this audit must not produce.

```
CURRENCY(s)   = 1.0 generated from code in CI, or hand-maintained with a drift check that fails the build
              | 0.5 hand-maintained, no drift check (T2 fired), age gap within one release cycle
              | 0.0 hand-maintained, no drift check, age gap beyond one release cycle (R3); or no specification
SPEC_COVERAGE = 100 * Σ_s CURRENCY(s) * documented_and_not_contradicted(s) / live_operations   # percent
COMPAT_GATE   = 1.0 blocking CI detector | 0.5 advisory or partial | 0.0 absent
A11_SCORE     = round(SPEC_COVERAGE * (0.5 + 0.5 * COMPAT_GATE))                               # points out of 100
```

`live_operations` is the code-side population of step 1, summed over surfaces. `documented_and_not_contradicted(s)` counts operations of surface `s` that appear in its machine-readable specification, are not marked `phantom`, and were not marked `contradicted` by step 8. An operation step 8 did not sample counts as documented but is reported separately, so a reader can see how much of the numerator is unverified.

Report the score in report section 2 as the triple `A11_SCORE / SPEC_COVERAGE% / COMPAT_GATE` — for example `41 / 82% / 0.0` — and justify it by naming the population size, the step-2 verdict and the `CURRENCY` factor of each surface, the unverified share of the numerator, and which of the two components dominates the loss. When step 8 could not run at all, report `SPEC_COVERAGE` as an upper bound and say so in the same sentence.

## 10. Failure modes of this audit

**R1 — Reading the specification as ground truth.** A specification is a claim about code, and an unverified claim drifts in one direction: towards flattering the interface. Counting specification entries as coverage produces a report claiming 100% about a surface that broke months ago. *Countermeasure:* step 8 is mandatory; only operations step 8 did not contradict enter the numerator; a run without step 8 caps `confidence` at `medium` and labels the score an upper bound.

**R2 — Building the inventory from one place.** Dynamically registered routes, decorator-generated handlers, gateway rewrites and plugin-mounted subrouters are invisible to a single grep, so undocumented operations are undercounted and the denominator shrinks in the specification's favour. *Countermeasure:* run every step-1 pattern that matches the stack, grep for registration helpers (`registerRoutes`, `include_router`, `use(`), and cross-check the total against the committed gateway or reverse-proxy configuration.

**R3 — "Generated, therefore current".** A generator in the dependency list is not a generator in CI; an artefact produced by hand once from a generator is a manual specification with a misleading provenance. *Countermeasure:* let the step-2 date comparison decide, not the dependency list — where the specification's last commit predates the handlers' by more than one release cycle, treat it as manual for T2 however it was first produced.

**R4 — Judging compatibility from specification diffs alone.** Where the specification was added late, its history shows no breaking changes for a surface that broke repeatedly. *Countermeasure:* bound every compatibility claim by the specification's first commit (`git log --diff-filter=A --format=%cI -- "$SPEC"`), and cover the period before it with the code-level signals of step 5.

**R5 — Miscounting consumers in both directions.** A generated client in the same monorepo or a caller in the same deployable is not an independent consumer, and counting it makes an internal interface look externally contracted; conversely, a quarterly integration produces no traffic in a week of logs, and an "unused" verdict handed to A-12 becomes a real outage. *Countermeasure:* classify by deploy boundary rather than package boundary; mark anything not proven by a call site or a log line as `presumed` with `confidence: hypothesis`; record the log window in days beside every log-derived number and never file `unused` above S4 on a window under 30 days.

**R6 — Miscounting error formats.** The framework's default error body coexists with the handled one, so the catalogue either misses a second shape or counts one shape twice because two middlewares render it. *Countermeasure:* enumerate from the handler code *and* the framework default, then confirm against recorded 4xx/5xx fixtures from step 8 before filing T4.

## 11. Audit-specific prohibitions

Beyond `report-contract.md` §9.

- **Do not call a deployed environment.** No `curl`, `grpcurl`, GraphQL introspection or event publication against production, staging or any shared instance, and no non-idempotent method anywhere. *Instead:* verify from recorded fixtures, cassettes and integration-test assertions; when those are exhausted, ask the owner for approval to start a local instance from the project's own dev script and query it with safe methods only.
- **Do not run the specification generator or a client codegen inside the repository.** It overwrites the committed artefact, which is the evidence. *Instead:* compare `git show "$HISTORY_BASE_REF":"$SPEC"` against the working copy, or generate into a directory outside the tree (`mktemp -d`).
- **Do not obtain the base revision by checking it out, branching, stashing or adding a worktree.** *Instead:* `git show <ref>:<path>` into that temporary directory.
- **Do not leave a tool's configuration in the tree.** Every ruleset or module file a tool needs — `$TMP/.spectral.yaml`, a buf module — is written into the run's temporary directory. A `.spectral.yaml` or `buf.yaml` left behind in the repository is a modification of an audited artefact and a standing false signal to the project's own CI, which will lint against a ruleset nobody chose. How the tool itself is acquired is `report-contract.md` §9's policy, not this audit's.
- **Do not publish to or query a Pact broker** (`pact-broker publish`, `can-i-deploy`): both write records, and the second can gate someone else's deploy. *Instead:* read the local pact files and the contract-test sources.
- **Do not run a route-enumeration command that boots the application** (`rails routes`, `manage.py show_urls`, `artisan route:list`) against a configuration pointing at a real database or broker. *Instead:* enumerate statically as in step 1, or boot only against a disposable local configuration with the owner's approval.
- **Do not reproduce real request data.** Bodies, request targets, query strings and headers from logs, fixtures and cassettes all carry it: keys and reset tokens ride in query strings, device and installation identifiers in user-agents, account identifiers in both. *Instead:* report field names, types and shapes; record log evidence only as a path-only aggregate (§4 step 6), a per-consumer count and a window length — never a captured value and never a raw log line, in the report, the appendices or the chat.

## 12. Dependencies

**Input.** `A-01` supplies the component register and `SCOPE_*`, which say which deployables expose interfaces and where their handlers live; without it, derive the surfaces in step 1 and lower `confidence`. `A-06` supplies the boundary map and the state of typing at the edges, which is what step 7 compares validation against; without it, judge validation from the call sites alone and record the gap.

**Output.** The three appendices of §8 are the artefact, and they go to two audits, exactly as `audit-index.md` records in both directions. **A-12** builds its integration-failure matrix on the operation inventory and the consumer list. **A-14** takes the operation inventory as the population for its role × resource × operation matrix and its per-endpoint ownership check, so its coverage is stated over the same unit as this report's. Both read the report the way any audit reads an earlier one: as a path passed in a parameter, never as remembered context.

## 13. Nearest marvin command

None. `audit-index.md`'s command table has no `A-11` row, because no marvin command produces an API-contract report. Two commands touch adjacent territory and are named so a reader is not surprised: `/marvin:docs-search` retrieves what the documentation *claims* about the interfaces, where this audit tests those claims against code and against recorded behaviour; `/marvin:sec-scan` reports missing input validation as a vulnerability class, where step 7 asks the different question of whether validation agrees with the published contract. Either may be used as an accelerator, and its output is evidence to verify with a command of your own — never a section to paste.
