# A-15 — Производительность

> **Audit question.** Where does the system spend time and resources out of proportion to the value it returns?

## 1. Role and task

You measure where time and resources go — client, server, database, network, build — and close one question: which of that spending is disproportionate to what it
buys. Every number carries the conditions it was taken under; without them it is a rumour with a decimal point. A run also leaves three artefacts A-19 takes as
parameter values: the budget-versus-actual table, the top-10 costliest operations with the code producing them, and the conditions block.

## 2. Audit-specific parameters

On top of the ten in `report-contract.md` §2.

| Parameter | Meaning | Derivation when unset |
|---|---|---|
| `PERF_BUDGET` | per-surface budget the product commits to: page metrics, endpoint latency, bundle weight | prefer a budget the project already declares — `lighthouserc.*`, `budget.json`, `size-limit` or `bundlesize` in `package.json`. With none, the fixed rows of §6 become the budget, recorded as *выведено, не задано*; the absence is itself filed under T15 |
| `KEY_PAGES` | the pages that matter, as routes and, where a non-production environment is reachable, URLs | from A-13's frontend map when supplied; else from the router, the build's entry points and the templates, ranked by request count where a log or `RUM_ACCESS` exists. With nothing: the root route, the authenticated landing route, and the three routes with the most code beneath them. Never ask |
| `KEY_ENDPOINTS` | the operations that matter, in `report-contract.md` §8's unit | from an OpenAPI or GraphQL schema in the tree, else route registration (`rg -n -e 'router\.(get\|post\|put\|patch\|delete)\(' -e '@(Get\|Post\|Put\|Delete)\(' -e '@app\.route\|urlpatterns'`), ranked by access-log frequency. Every payment, auth and checkout operation is added regardless of rank |
| `BUILD_DIR` | the directory holding the **production** build step 2 measures | the newest production artefact already in the tree (`dist/`, `build/`, `out/`, `.next/static/`); else the out-of-tree directory of a §11-compliant build (`--out-dir`, `--outDir`, `distDir`, `BUILD_PATH=`) where one can be produced; with neither it stays unset and step 2 takes its no-artefact branch |
| `RUM_ACCESS` | access to field data: a RUM or APM export, a dashboard the user reads out, a readable access log | absent by default. Step 1 then falls to lab measurement or to its third branch, and step 3 to logs or static analysis; `confidence` caps at `medium` and *Границы достоверности* names what field data would have settled. **Ask only for an export file or a read-only log path — never for production credentials** |
| `DB_ACCESS` | the one database or cache this audit may query: a DSN, a `psql` target or a `redis-cli -u` URL the user names, on a read-only role | absent by default, and step 4 then issues no query at all: it falls to the migrations and static analysis of §5, step 5 to configuration reading, both layers cap at `confidence: probable`, and *Границы достоверности* names the plan that would have settled it. **Ask only for a replica or a non-production copy the user names — never for production credentials**, and never assemble a target from `PGHOST`, `~/.pgpass` or `REDIS_URL` in the ambient environment |
| `LOAD_PROFILE` | relative traffic per surface and peak concurrency: the score's weights, and the only legitimate shape for a load-stand run | `awk '{print $7}' <access.log> \| sort \| uniq -c \| sort -rn \| head -30`. With no log, weights are equal (`w = 1/\|S\|`), stated in *Итоговая оценка* and in *Границы достоверности*. Ask only when the ranking of the top three violations turns on it |

With all seven empty the run still completes: budgets fall to §6, surfaces to the router, client metrics to step 1's third branch, the bundle to step 2's no-artefact
branch, database and cache to static analysis, weights to equal, and an unset `LOAD_PROFILE` is itself a bar on any load run.

## 3. Scope

**In scope.** Client page metrics, rendering and main-thread work; the JavaScript and CSS bundle; server latency distributions and sequential call waterfalls; the
database — plans, N+1 (the family's only N+1 threshold is T5 here), transaction duration, unbounded statements; caching at every level; images, fonts and third-party scripts; the network shape of a request; the build, cold and incremental, with its cache.

**Out of scope.** Load testing of the production environment — nothing in the family covers it and nothing may; §11 permits a load stand only. Whether a documented
rate limit is **adequate** — no audit in the family judges that either; A-11 and A-14 file only its presence or absence, and a reader is not sent here for it.
Infrastructure spend and the money value of waste → A-19; telemetry visibility of slowness → A-16; schema design and migration safety → A-10; component structure,
state and rendering architecture → A-13; timeouts and breakers → A-12; pipeline duration and lead time → A-17, only the build step's own time and cache read here;
overload and capacity → A-18; cache-key confusion → A-14; assistive-technology experience → A-21; dependency currency, licences and CVEs → A-03, a dependency being
bytes and milliseconds here. Four neighbours own the other half of a site this audit also sees. A **missing or unused index** is A-10's schema finding: its row is
cited, never restated, and only the latency it causes is filed here, under T4 or T6. An operation whose published **contract** offers no limit and no cursor is
A-11's, whose unit is the operation where T7's is the statement — that difference in unit is why one apparent defect can carry two severities. A third-party
script's missing `integrity=` is A-14's and the same script as an uncontrolled external dependency with no self-hosted fallback is A-12's, T13 keeping its
render-blocking and main-thread cost alone.

## 4. Collection protocol

Cheap aggregates first, then measurement of the ranked top `N` surfaces (§7). Every census runs with `report-contract.md` §2's canonical exclusions (`RG_EXCLUDE`,
`GIT_EXCLUDE`); this audit adds none and **inverts two deliberately**: steps 2 and 6 read `dist/`, `build/` and minified bundles, because the built artefact is the measurement. **Write §8.4's conditions block before the first measurement, never after.**

**1. Client metrics.** Three branches, in order. Field data first — Core Web Vitals at p75 over 28 days per key page from `RUM_ACCESS`. With none but a URL reachable
in a non-production environment, measure in the lab: three runs per page, median reported, with profile, throttling, device, cache state and warm-up recorded. **With
neither** — the default for a repository-only audit — every lab metric is `не установлено`, T1, T2 and T13 go unevaluated, T3 rests on the built bundle's gzipped
bytes alone, `confidence` caps at `low` for the client layer, and *Границы достоверности* names the URL that would have settled it. Produces per key page LCP, CLS,
TBT and TTFB, INP from field data only, each tagged `поле` or `лаборатория` and bound to a conditions id.
```sh
for i in 1 2 3; do npx --no-install lighthouse "<url>" --only-categories=performance --preset=desktop --output=json --output-path="<OUTPUT_DIR>/lh-<page>-$i.json" --chrome-flags="--headless"; done   # §5 gives the acquisition form; a pinned on-demand runner replaces `--no-install` only under `report-contract.md` §9
jq -r '[.audits["largest-contentful-paint"].numericValue, .audits["cumulative-layout-shift"].numericValue, .audits["total-blocking-time"].numericValue] | @tsv' "<OUTPUT_DIR>"/lh-<page>-*.json; curl -s -o /dev/null -w 'ttfb=%{time_starttransfer} total=%{time_total} bytes=%{size_download}\n' "<url>"
```

**2. Bundle.** The **production** build in `BUILD_DIR` only — a dev-server bundle is not a measurement. Produces gzipped bytes per entry chunk, the ten largest
contributors, libraries duplicated **inside one bundle** with their versions, code shipped but never executed, and the split ratio `1 − entry_gz ÷ total_gz`, the
share of shipped JavaScript that loads lazily. **With `BUILD_DIR` unset or holding no `.js`** — no artefact in the tree and none producible out of tree (§11) — those
three are `не установлено`, never zero and never a ratio over an empty `total_gz`; T14, T18 and T3 go unevaluated — step 1's `size_download` is the document's
transfer, not the entry script's — the step goes to `tools_unavailable`, and *Границы достоверности* names the build that was missing.
```sh
find "$BUILD_DIR" -type f -name '*.js' 2>/dev/null | xargs -I{} sh -c 'printf "%s\t%s\n" "$(gzip -c "{}" | wc -c)" "{}"' | sort -rn > "<OUTPUT_DIR>/bundle.tsv"; head -20 "<OUTPUT_DIR>/bundle.tsv"; awk -F'\t' '{t+=$1} END {print (NR ? "total_gz=" t : "total_gz=не установлено")}' "<OUTPUT_DIR>/bundle.tsv"
{ jq -r '.[] | select(.isEntry) | .file' "$BUILD_DIR"/.vite/manifest.json 2>/dev/null; grep -rhoE 'src="[^"]+\.js"' --include='*.html' "$BUILD_DIR" 2>/dev/null | cut -d'"' -f2; } | sed 's#.*/##' | sort -u > "<OUTPUT_DIR>/entry.txt"; awk -F'\t' 'NR==FNR{e[$0];next} {b=$2; sub(/.*\//,"",b)} b in e {g+=$1} END {print (g ? "entry_gz=" g : "entry_gz=не установлено")}' "<OUTPUT_DIR>/entry.txt" "<OUTPUT_DIR>/bundle.tsv"   # the entry chunks: a build manifest's `isEntry`, else the scripts the built document itself loads; their summed gzip is T3's number and the split ratio's numerator, and no entry identified is `не установлено`, never a ratio of 1
find "$BUILD_DIR" -name '*.js.map' -print0 2>/dev/null | xargs -0 -I{} jq -r '.sources[]?' {} | sed -nE 's#.*node_modules/(@[^/]+/[^/]+|[^/@][^/]*)/.*#\1#p' | sort | uniq -c | sort -rn | head -20   # the packages actually inside the bundle; devDependencies excluded by construction
jq -r '(.packages // .dependencies) | to_entries[] | [(.key | sub(".*node_modules/";"")), (.value.version // "?")] | @tsv' package-lock.json 2>/dev/null || awk '/^[^ #]/{n=$0; gsub(/[":]/,"",n)} /^ +version/{gsub(/[",]/,"",$2); print n"\t"$2}' yarn.lock 2>/dev/null || pnpm why --json '<name>'   # versions for those names; `.packages // .dependencies` reads lockfileVersion 1 and 2+ alike, and ≥ 2 versions of one name in one bundle is T14
jq -r '.audits["unused-javascript"].details.items[]? | [.url, .wastedBytes] | @tsv' "<OUTPUT_DIR>/lh-<page>-1.json"   # shipped and not executed on the page; with no lab run it is `не установлено`, never zero
```

**3. Server.** Produces p50/p95/p99 per key operation with the sample size beside each, the slowest operations by total contribution, and the waterfall list —
handlers issuing three or more independent awaited calls with no parallelism. Without field data or a log every latency claim is `confidence: hypothesis`.
```sh
awk '$0 ~ "<endpoint>" {print $NF}' <access.log> | sort -n | awk '{a[NR]=$1} END {printf "n=%d p50=%s p95=%s p99=%s\n", NR, a[int(NR*0.50)], a[int(NR*0.95)], a[int(NR*0.99)]}'
rg -c '\bawait\b' -g '!*test*' "${RG_EXCLUDE[@]}" <handler-dir> | sort -t: -k2 -rn | head -20; rg -n -e 'Promise\.all\(' -e 'asyncio\.gather\(' -e 'errgroup' "${RG_EXCLUDE[@]}" <handler-dir>
```

**4. Database.** The `psql` invocations run against `DB_ACCESS` and nothing else (§11); unset, the step is its static analysis alone. Produces, per key query: N+1
verdict, the plan's access method, transaction duration and what is held open inside it, and whether the result set is bounded. A grep locates candidates; a plan or
a query count confirms them, never the grep. Index coverage is read as the cause of a latency number — the index itself is A-10's finding (§3).
```sh
psql "$DB_ACCESS" -X -c "SELECT calls, round(mean_exec_time::numeric,2) AS mean_ms, round(total_exec_time::numeric,2) AS total_ms, rows, query FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;"
psql "$DB_ACCESS" -X -c "SELECT now()-xact_start AS age, state, left(query,80) FROM pg_stat_activity WHERE xact_start IS NOT NULL ORDER BY 1 DESC LIMIT 10;"; psql "$DB_ACCESS" -X -c "EXPLAIN SELECT ...;"   # transaction duration for T10; plain EXPLAIN only — see §11
rg -n -A 12 "${RG_EXCLUDE[@]}" -e 'BEGIN;|\.transaction\(|@Transactional|with transaction|begin\(\)' | rg -i -e 'await |fetch\(|axios|http\.|\.rpc\(|sleep'   # T10's site: a network call or slow work inside a transaction block
rg -n -A 6 "${RG_EXCLUDE[@]}" -e '\.map\(' -e '\.forEach\(' -e 'for \(' -e 'for [a-z_]+ in ' | rg -i -e 'await |\.query\(|SELECT |find(One|ByPk|Unique)'   # N+1 candidates
rg -n -i "${RG_EXCLUDE[@]}" -e 'select_related|prefetch_related|joinedload|selectinload|FetchType\.LAZY|lazy: *true'; rg -n -i "${RG_EXCLUDE[@]}" -e 'findAll|\.all\(\)|SELECT \*' | rg -v -i -e 'limit|offset|take|cursor|paginate'   # T7 candidates
```

**5. Caching.** Produces the cache map: one row per cache with level (browser, CDN, proxy, application, ORM, memo, build), key composition, TTL, invalidation
trigger, eviction policy, and hit rate where `DB_ACCESS` names the cache. A cache whose invalidation cannot be named is `не установлено`, not absent.
```sh
rg -n -i "${RG_EXCLUDE[@]}" -e 'Cache-Control|s-maxage|max-age|stale-while-revalidate|ETag|Last-Modified|immutable|Vary:' -e 'redis|memcach|ioredis|lru-cache|node-cache|@Cacheable|cache_page|unstable_cache'
rg -n -i "${RG_EXCLUDE[@]}" -e '\bttl\b|expire|setex|invalidate|purge|revalidateTag'; redis-cli -u "$DB_ACCESS" info stats | grep -E 'keyspace_(hits|misses)'   # only where DB_ACCESS names a cache; otherwise hit rate is `не установлено` and T12 rests on its invalidation half
```

**6. Static resources.** Produces the per-page resource ledger: images with the oversized ones listed, fonts with their `font-display`, and every third-party script
with its loading attribute and, where a lab run exists, blocking ms.
```sh
git ls-files -z -- '*.png' '*.jpg' '*.jpeg' '*.webp' '*.svg' "${GIT_EXCLUDE[@]}" | xargs -0 ls -lS 2>/dev/null | awk '$5 > 102400' | head -20
git ls-files -- '*.woff' '*.woff2' '*.ttf' "${GIT_EXCLUDE[@]}" | wc -l; rg -n -i "${RG_EXCLUDE[@]}" -e 'font-display|@font-face|as="font"' -e '<script[^>]+src="https?://'; jq -r '(.audits["render-blocking-insight"] // .audits["render-blocking-resources"]).details.items[]? | [.url, .wastedMs] | @tsv' "<OUTPUT_DIR>/lh-<page>-1.json"   # Lighthouse 13 renamed the audit; the alternative keeps 12 readable
```

**7. Build.** Produces cold build time, incremental build time, and the CI cache verdict — which caches are configured and how often they hit over thirty runs. CI
history is the source and the real machine: partition the build job's durations by whether its cache step hit, a miss being cold and a hit incremental. Without it,
build twice into a temporary directory outside the repository (§11); with neither route both times are `не установлено`.
```sh
gh run list --limit 30 --json createdAt,updatedAt,conclusion,workflowName --jq '.[] | [((.updatedAt|fromdateiso8601)-(.createdAt|fromdateiso8601)), .conclusion, .workflowName] | @tsv' | sort -rn
gh run view <run-id> --json jobs --jq '.jobs[] | [.name, .startedAt, .completedAt] | @tsv'; gh run view <run-id> --log | rg -n 'Cache (restored|not found|saved)' | head; rg -n -e 'actions/cache' -e 'cache: *(npm|yarn|pnpm|pip|gradle|maven)' -e 'save-cache|restore-cache' .github .gitlab-ci.yml 2>/dev/null
```

## 5. Tools

Acquisition follows `report-contract.md` §9; this spec states no policy of its own, and a pinned on-demand runner's resolved version goes into `tools`.

| Tool | What it measures here | Invocation | Fallback |
|---|---|---|---|
| Lighthouse | lab page metrics, unused JavaScript, render-blocking resources, third-party blocking time | `npx --no-install lighthouse "<url>" --only-categories=performance --preset=desktop --output=json --output-path=<file> --chrome-flags="--headless"`, three runs; no project copy → §9's pinned runner, `npx --yes lighthouse@13.4.1`. Audit ids differ by major: 13 replaced `render-blocking-resources` with `render-blocking-insight`, so record the major in the conditions block | binary absent or the fetch declined: `curl -w` for TTFB and transfer size plus step 6's static ledger, recorded in `tools_unavailable`. **No reachable URL: nothing substitutes** — step 1's third branch applies, every lab metric is `не установлено`, and *Границы достоверности* names the URL that was missing |
| PageSpeed Insights / WebPageTest | CrUX **field** LCP/INP/CLS for a public URL — the only source of a real INP without RUM — and multi-location lab timings | `curl -s 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=<url>&strategy=mobile' \| jq '.loadingExperience.metrics'`; `webpagetest test "<url>" -k <api-key>`. Explicit consent required, recorded in *Методология* | none for field: an unconsented or authenticated URL is not sent, and field metrics then come from `RUM_ACCESS` or are absent. For lab timings, Lighthouse with an explicit throttling profile, three runs, median reported |
| Bundle analyzer | chunk composition and largest contributors | whichever the project already declares: `npx --no-install source-map-explorer "$BUILD_DIR/**/*.js"`, `npx --no-install webpack-bundle-analyzer stats.json --mode static --report <file>`, `npx --no-install vite-bundle-visualizer`; declaring none, §9's pinned runner `npx --yes source-map-explorer@2.5.3` | step 2's `gzip -c` sizing and source-map package extraction, which need no analyzer at all |
| `pg_stat_statements` | which statements own the total database time | `psql "$DB_ACCESS" -X -c "SELECT calls, mean_exec_time, total_exec_time, rows, query FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;"` (PostgreSQL ≤ 12: `mean_time`, `total_time`) | MySQL `SELECT digest_text, count_star, avg_timer_wait FROM performance_schema.events_statements_summary_by_digest ORDER BY sum_timer_wait DESC LIMIT 20;`; else the slow-query log; else step 4's static analysis |
| `EXPLAIN` | the access method of a key query: index, index-only, or a scan | `psql "$DB_ACCESS" -X -c "EXPLAIN SELECT ...;"`; MySQL `EXPLAIN FORMAT=JSON SELECT ...;`; SQLite `EXPLAIN QUERY PLAN SELECT ...;` | compare the indexed columns against the query's `WHERE` / `JOIN` / `ORDER BY` as written; the latency claim is then `confidence: probable` |
| `redis-cli` | cache hit rate and keyspace size | `redis-cli -u "$DB_ACCESS" info stats`; Memcached `memcached-tool <host> stats`; a managed cache through its provider's metrics export | the cache's own dashboard read out by the user; else hit rate is `не установлено` and T12 is judged on its invalidation half alone |
| APM | production p50/p95/p99, slowest transactions, query counts per request | consumed through `RUM_ACCESS` as an export or as values the user reads out; no vendor CLI is assumed | step 3's access-log percentiles; without a log, static waterfall analysis at `confidence: hypothesis` |
| `k6` / `autocannon` | latency under a shaped load — **load stand only** (§11) | `k6 run --vus <n> --duration 30s <script.js>`, or `npx --no-install autocannon -c <n> -d 30 "<url>"` and, with no project copy, §9's pinned runner `npx --yes autocannon@8.0.0`; shaped by `LOAD_PROFILE` | omit the step; latency then rests on field data, logs and plans, and *Границы достоверности* records that the system was never observed under load |
| ripgrep (`rg`), git + `gh`, POSIX (`jq`, `awk`, `find`, `grep`, `gzip`, `sort`) | N+1 candidates, transaction blocks, waterfalls, cache and resource markers; build duration and cache hits from real CI runs; Lighthouse audits, bundle, entry-chunk and lockfile reading, asset weight, log percentiles | `rg -n --no-heading -i "${RG_EXCLUDE[@]}" -e '<pattern>'`; `gh run list --limit 30 --json createdAt,updatedAt,conclusion --jq '…'`; and the invocations in §4 | `git grep -n -i -E '<pattern>'`, else `grep -RnIE '<pattern>' .`; without `gh`, churn from `git log --since='6 months ago' --oneline -- <path>` and build time `не установлено`; `python3 -c 'import json,sys;…'` for JSON. POSIX is the floor every stack has |

## 6. Analysis rules and thresholds

A finding is filed **per surface and metric**, with the code producing the cost as its evidence. **A threshold crossed by a number whose conditions were not recorded
is not a finding:** it is `не установлено`, and a cut to `confidence`. A number whose *code path* was not localised is a different case, governed by §8.3. T8 is
deliberately vacant: the missing or unused index that once stood there is A-10's finding, cited and never restated (§3), and the numbering does not shift because neighbouring specs cite these ids.

| # | Condition | Threshold | Severity | Origin |
|---|---|---|---|---|
| T1 | LCP on a key page | > 2.5 s | S2 | requirements |
| T2 | INP on a key page (field data only) | > 200 ms | S2 | requirements |
| T3 | Entry-page JavaScript, gzipped, over the wire | > 300 KB | S2 | requirements |
| T4 | Operation p99 | > 1 s | S2 | requirements |
| T5 | Any confirmed N+1 query pattern | ≥ 1 | S2 | requirements |
| T6 | Far past budget: page metric on the highest-weight surface, or an operation whose p99 reaches the caller's timeout so load becomes failure | LCP > 4 s or INP > 500 ms; p99 ≥ platform or client timeout, or > 10 s | S1 | derived |
| T7 | Statement with no `LIMIT`/cursor over a table that grows with usage, on a user-facing path | ≥ 1 statement | S2 — A-11 files the contract-level term on the operation; cross-reference, do not restate | derived |
| T9 | Independent awaited calls run sequentially in one handler | ≥ 3, no `Promise.all`/`gather` equivalent | S2 when the surface also breaks T4, else S3 | derived |
| T10 | Transaction held open across a network call or slow computation | ≥ 1 site, or an observed transaction age above the request budget | S2 — A-12 files the same site at S1 for hang exposure; cross-reference, do not restate | derived |
| T11 | In-process cache with no eviction and an unbounded key space | ≥ 1 | S2 | derived |
| T12 | Cache with a TTL and no invalidation on write over changing data; or hit rate of a cache protecting an expensive path | ≥ 1; < 80% | S3 | derived |
| T13 | Third-party script blocking the main thread on a key page | > 250 ms, or render-blocking with no `async`/`defer` | S2 — its missing `integrity=` is A-14's row and its uncontrolled origin A-12's; cross-reference both | derived |
| T14 | Duplicated copy of one library in a single bundle | ≥ 2 versions | S3, S2 above 50 KB gzip | derived |
| T15 | No performance budget declared anywhere and no regression check in CI | 0 | S3 | derived |
| T16 | Oversized image or page image weight; web font with no `font-display`; font files on a key page | file > 500 KB or page > 1 MB; ≥ 1; > 4 | S3 | derived |
| T17 | Cold CI build time, or dependency caches configured in CI | > 10 min / 0 caches | S3 | derived |
| T18 | Code shipped to a key page and never executed on it; or a split ratio of zero — the entry chunk is the whole bundle | > 40% of entry bytes; 0 | S3 | derived |

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

- **Two sampling populations, never summed.** Pages — one route the client renders — and **`operations`**, with the definition `report-contract.md` §8 gives that
  unit and no local variant. *Surface* below means either. `coverage` carries one clause per population in §8's semicolon form, the population with the larger
  traffic share first; *Методология* names which enumeration produced the operations — the specification, the code, or the access logs. `N` counts surfaces, not files.
- **Top-`N` ranking**, in order: traffic share from `LOAD_PROFILE` or the access log; membership of `KEY_PAGES` / `KEY_ENDPOINTS`; on a money or auth path; measured
  cost, slowest first; fan-out — a shared handler, layout or query.
- **Below `N`**, the remainder of the budget goes to the units beneath a surface — top queries by total time, largest bundle chunks — and `C` is drawn from those,
  which `coverage` states.
- **Early stop:** the contract's control-sample stop, additionally requiring that every top-`N` surface carries each budget metric §6 defines for its kind — T1, T2,
  T3 and T13 for a page, T4 for an operation — either measured with a conditions id or marked `не установлено`. An unmeasured metric is never a reason to stop.

## 8. Report additions

1. **«Бюджет и факт»** — inside §7 *Приложения*. One row per measured surface × metric: страница/операция | метрика | бюджет | факт | разрыв (absolute and as a share
   of budget) | условия замера (item 4's conditions id) | доля трафика | `path:line` | finding ids. Every cell holds a value or the literal `не установлено`, never a
   blank. It is the score's working, which §2 *Итоговая оценка* cites rather than recomputes.
2. **«Топ-10 самых дорогих операций»** — inside §5 *Детальные находки*, preceding the findings. Ranked by **total contribution** = frequency × unit cost, so a cheap
   operation on every request outranks an expensive one nobody calls. Columns: операция | слой (client / server / database / network / build) | частота | стоимость
   единицы | суммарный вклад | `path:line` | finding ids. State the unit per row; never mix milliseconds and bytes in one rank silently.
3. **Code localisation of every measured cost** — a column, not a paragraph. Both tables and every finding carry the `path:line` producing the cost, or the literal
   `источник не локализован`. A number with no `path:line` is still filed at the severity its threshold assigns, with that literal in the evidence and
   `confidence: probable`; only rows T7–T18 drop one severity for it, never below `S3`. T1–T6 are never capped: T1–T5 are the budget itself, T6 is failure not slowness.
4. **«Условия замера»** — inside §7 *Приложения*, written before the first measurement. One block per conditions id: environment (production / staging / local,
   production or dev build), network profile, throttling and device emulation, cache state, warm-up and runs, concurrency, dataset size with key-table row counts,
   tool versions — the Lighthouse **major** among them, because audit ids differ between 12 and 13 — commit SHA, timestamp. Every number names its conditions id.

## 9. Score

**Traffic-weighted budget violations.** `V = Σ over surfaces s, over metrics m checked on s: w(s) × [факт(s,m) > бюджет(s,m)]`, where `w(s)` is the traffic share of
`s` from `LOAD_PROFILE`, normalised so `Σ w(s) = 1` over measured surfaces. Unit: weighted violations — dimensionless, between 0 and the number of metrics checked
per surface. Emit it in §2 *Итоговая оценка* with the two numbers that make it readable, never alone: `Нарушений бюджета: R из K проверок; взвешенный показатель
V = <n.nn>; покрыто W% трафика`. With `LOAD_PROFILE` unset every `w(s) = 1/|S|`, so `V = R/|S|` — the mean number of violated metrics per surface, which is not the
share `R/K` and is never reported as one — and the same line says so. The justification names the metric that dominates `V`, the highest-weight violating surface,
and whether the violations concentrate on one layer or spread. Breaking one budget on the busiest page scores worse than breaking four on pages nobody opens:
intended.

## 10. Failure modes of this audit

1. **Comparing numbers taken under different conditions** — throttled against unthrottled, warm against cold — or recording no conditions
   at all. *Countermeasure:* the §8.4 block is written before the measurement, never reconstructed from memory; each number carries its id, and differing ids are reported side by side, never subtracted or ranked.
2. **Measuring a dev server or a debug build** — unminified, HMR-instrumented, caching disabled. *Countermeasure:* the
   conditions block names the build, and a dev-server number is `не установлено` for every budget in §6.
3. **Writing an INP number from a lab run.** Lighthouse reports total blocking time as a proxy, not INP. *Countermeasure:* T2 is
   checked against field data only; otherwise INP is `не установлено` and TBT is reported as TBT.
4. **Single-run numbers**, which measure the machine's mood. *Countermeasure:* step 1's loop writes one report per run, three
   minimum; median and run count are reported, cache state stated, and a cold and a warm path stay separate rows.
5. **Declaring an N+1 from a grep** — a query in a loop that runs once is not an N+1. *Countermeasure:* confirm by query count per
   request (an ORM log on the copy named in `DB_ACCESS`, an APM trace, `pg_stat_statements.calls`) or the loop's bound; else `hypothesis`.
6. **A p99 from too few samples, or "fast" concluded from a toy dataset** — below 1000 samples the tail is noise, and a scan of 200 rows
   outruns an index. *Countermeasure:* state `n` beside every percentile, report p95 below 1000 and mark p99 unreliable in *Границы достоверности*; record key-table row counts, and a scan over a table that grows with usage is a cost claim whatever it times today.
7. **Attributing network latency to the server.** *Countermeasure:* split the number with `curl -w` — DNS, connect, TTFB, total
   — and compare TTFB with a server-side timing before claiming server time.
8. **Reading a missing tool key as a zero.** A renamed or absent Lighthouse audit id yields `null` and `items[]?` swallows it silently,
   so "no render-blocking resources" gets written from a report that never held the key. The same trap sits under an absent build: an empty
   `bundle.tsv` sums to a blank total. *Countermeasure:* the invocations carry both ids, and an empty result is `не установлено` until the key or the artefact is shown to exist.
9. **Optimising what is easy to measure instead of what is expensive** — the build times itself and is rarely the user's
   problem. *Countermeasure:* the top-10 ranks by total contribution and the score weights by traffic.
10. **Measuring under uncontrolled concurrency** — a number taken while real traffic runs measures the audit plus the users, and generating
    load to "get a clean reading" corrupts both the number and the service. *Countermeasure:* record concurrency in the conditions block, and never generate load outside a load stand (§11).

## 11. Audit-specific prohibitions

Beyond `report-contract.md` §9.

- **No load test against production, against staging shared with users, or against anything the user has not named as a load
  stand.** `k6` and `autocannon` run on a stand shaped by `LOAD_PROFILE`; unset, there is no shape and so no run — omit the branch and say so, because an unshaped burst is an outage the audit caused.
- **Issue no query against a database or cache the user has not named in `DB_ACCESS`**, and never assemble a target out of `PGHOST`, `PGDATABASE`, `~/.pgpass` or
  `REDIS_URL` found in the environment: `pg_stat_statements` is populated only where real traffic ran, so a guessed target is production. Unset, step 4 falls to its static analysis and step 5 to configuration reading, and *Границы достоверности* says so.
- **No `EXPLAIN ANALYZE` on anything but a `SELECT`, and never against production** — `ANALYZE` executes the statement, so on an
  `INSERT`, `UPDATE` or `DELETE` it writes. Use plain `EXPLAIN`; for an actual plan, a non-production copy inside `BEGIN; … ROLLBACK;`.
- **No mutating, blocking or destructive command against a live store to test a hypothesis** — never `CREATE INDEX`, `ANALYZE`, `VACUUM`, `OPTIMIZE TABLE` or a
  statistics refresh, not even on a copy called disposable; `redis-cli info` and `scan` are permitted, `keys *`, `flushdb`, `flushall`, `monitor` and `debug` are not, and no CDN purge is issued to observe a cold path. An index goes into the recommendation, unexecuted.
- **Never build into the working tree**, git-ignored output directory or not: a production build runs the project's lifecycle scripts, which is a write the contract
  does not permit. Build into a temporary directory outside the repository with the toolchain's out-dir flag and set `BUILD_DIR` to it, or take timings from CI
  history; with neither, steps 2 and 7 take their no-artefact branch. Never delete a cache to force a cold build: `rm -rf node_modules/.cache`, `.next`, `.gradle`.
- **Do not change runtime configuration to observe better** — no profiler enabled, no `log_min_duration_statement` lowered, no APM sample rate raised, no debug flag toggled, no service restarted or scaled for a clean measurement.
- **Do not send an authenticated URL, a HAR file or a session cookie to a hosted analyser**, and do not paste raw log lines into the report:
  a HAR carries tokens and stays local, and access logs carry identifiers, addresses and query strings, so report aggregates and quote a path pattern rather than a request.

## 12. Dependencies

**Input, as parameter values and never as remembered context.** A-03 supplies the dependency list, which turns step 2's largest contributors into named, versioned
packages and makes a duplicate detectable rather than merely visible. A-10 supplies the data schema and its `запрос — план — индекс` table, so step 4 judges a plan
against the declared model and knows which tables grow with usage. A-13 supplies the frontend map, seeding `KEY_PAGES` and locating the intended split boundaries.
None is required: §2's derivations and step 2's source-map and lockfile reads stand in, *Границы достоверности* records the missing input and `confidence` drops.
**Output:** the bottleneck list — the top-10 table, the budget-gap table and the score `V` — feeds **A-19** (стоимость владения), which converts waste into money;
hand it as a path to this report or as values copied out of it. `audit-index.md` records exactly this pair of directions and nothing else.

## 13. Nearest marvin command

`audit-index.md`'s command table carries no row for A-15: no shipped marvin command measures performance. One touches step 7 in projects that use marvin themselves —
`/marvin:task-verify` records a per-gate duration in `.marvin/task/runs/<slug>.verify.md` and `/marvin:task-metrics` aggregates those across delivered tasks, free
build and test timing on the real machine. Treat it as an accelerator whose numbers are evidence to verify against CI history, never a section to paste; it times
gates, not users.
