# A-16 — Наблюдаемость

> **Audit question.** Can a real incident be investigated to its cause from recorded telemetry alone, by someone with no access to the machines?

## 1. Role and task

You audit what the running system says about itself and close one question: could last quarter's incident have been
explained by a reader holding a query box and nothing else. The judgement is made by attempting it, never by listing the
stack. Besides the report a run leaves two artefacts A-18 reuses: a retrospective protocol per incident and the alert register.

## 2. Audit-specific parameters

On top of the ten in `report-contract.md` §2; with all four unset the run completes on the fallbacks below.

| Parameter | Meaning | Derivation when unset |
|---|---|---|
| `PAST_INCIDENTS` | two or three real incidents, each with a date, a user-visible symptom and the cause as eventually established | build candidates from history — `git log --since='12 months ago' -i --grep='incident\|outage\|postmortem\|hotfix\|rollback\|revert\|sev[0-9]' --oneline` (basic regex, where `\|` is the alternation; adding `-E` turns the same string into a search for a literal pipe and returns nothing), `git ls-files -- '*postmortem*' '*incident*'`, `gh issue list --state all --search 'incident OR outage' --limit 30` (skip when `gh` is absent), and `.marvin/memory/` lessons in a marvin project. **Ask the user** for the two or three most recent user-visible incidents: the *established cause* is what makes a retrospective scorable, and history rarely records it. With no answer, run step 1 as a **synthetic** retrospective over the two highest-severity rows of the A-12 failure matrix — absent A-12, the two areas with the most reverts (`git log --since='12 months ago' --grep='^Revert' --name-only --format='' \| sort \| uniq -c \| sort -rn \| head`) — file its findings at `hypothesis`, and say in *Границы достоверности* that the denominator is synthetic |
| `OBSERVABILITY_STACK` | the log, metric, trace, alert and client-error systems actually in use, each with the read surface through which it can be queried: an endpoint, a log path, or an exported window. The shell variables every command below uses — `$PROM`, `$AM`, `$GRAFANA` with `$GRAFANA_TOKEN` — are those read surfaces, bound from this parameter before step 1 and from nowhere else | derived by step 1's locate pass from manifests, IaC, CI environment and runtime config — never from documentation, which lags deployment. When a system is named but no read surface arrives, ask for a read-only endpoint, a read-scoped token, or an export covering the incident windows; with none, the audit runs over instrumentation code alone, the store enters `tools_unavailable`, and every claim about what the record *contains* drops to `hypothesis`. A command whose variable stayed unbound is not run and not quoted: its measurement takes the §5 fallback |
| `LOG_SAMPLE` | a file or export of raw application log lines from **one named service**, recorded with that service, its window and its line count — the denominator behind T4, T10, T15 and the level histogram | step 1's store query over one incident window, capped at the line budget §7 fixes per `DEPTH`; failing that, the largest file the tree offers (`git ls-files -- '*.log' 'logs/*'`, else the log destination in runtime config). **Ask the user** for an export covering an incident window when no store is readable. The window must be an incident window from step 1 or a stated peak window — a quiet one deflates every share computed from it (§10.6), and a sample that is only quiet is labelled `probable` and said so in *Границы достоверности*. With no sample at all the store enters `tools_unavailable`, T4, T10 and T15 read `не установлено`, and structuredness is judged from emitter code at `hypothesis` |
| `ALERT_CHANNELS` | where firings land and who is expected to answer | derived from receiver and routing blocks in Alertmanager, Grafana, Datadog or Terraform config, plus `team` / `owner` / `runbook_url` labels on the rules. Ask which channels a human actually watches and whether any is muted — T2 and T5 turn on it. With no answer, treat a channel with no route to a paging destination as unwatched and state that assumption in *Границы достоверности* |

## 3. Scope

### In scope

Logs and the code emitting them; metrics — instrument registration, the four golden signals, business metrics, label
cardinality; tracing — presence, cross-service coverage, join to logs; alert rules, routing, ownership, firing history;
dashboards; client-side errors and their comparability with server records; and the identifier correlating all five.

### Out of scope

Telemetry storage cost, retention pricing and sampling economics → **A-19**. Whether a dependency's failure is *handled* →
**A-12**; A-16 asks only whether it is *visible*. Recovery, RTO/RPO, runbooks, backups → **A-18**. Deploy visibility, DORA
metrics and rollback speed → **A-17**. Where time is spent → **A-15**; A-16 checks only that latency is measured. Personal
data reaching a log line, a metric label, an error report or a session recording → **A-22**, whose row files it; T8 keeps
only the cardinality half. A secret in a log line and security audit trails → **A-14**, step 2 recording only that a field
exists. Instrumentation tests → **A-07**. Dashboard accessibility → **A-21**. Runbook quality as knowledge → **A-20**.

## 4. Collection protocol

**Step 1 runs first and is not optional.** Steps 2–7 exist to explain its result; keep this order. Every `rg` census below
runs with `report-contract.md` §2's canonical `RG_EXCLUDE`; this audit's one addition is `-g '!**/*test*'`.

**1. Retrospective investigation — the main method.** Per incident: a locate pass over manifests, IaC and runtime config
(`git ls-files -- '*.env*' '*docker-compose*' '*.tf' '*.yaml' '*.yml'`) bounded to the readable surfaces, then the
investigation using **only** telemetry, anchored to the incident's own window — when did it start, which component, which
requests, what changed, why. Per question record the query verbatim, its answer, and one verdict of three; a question only
the host-shell `journalctl` answers is `нужен доступ к машине` and never feeds `I_t` (§9). Produces the **retrospective
protocol** (§8.1), a terminal verdict feeding the score, and the **gap points**. *Cost:* the dominant step — half an hour
to an hour per incident, and the one never shortened to buy the others.
```sh
rg -n -i -e 'otel|opentelemetry|sentry|datadog|newrelic|prometheus|grafana|loki|elastic|splunk|cloudwatch'
kubectl logs deploy/<svc> --since=24h --tail=500   # host-shell alternative, NOT creditable: journalctl -u <unit> --since '<t0>' --until '<t1>' -o json --no-pager
aws logs filter-log-events --log-group-name <g> --start-time <ms> --end-time <ms> --limit 200
gcloud logging read '<filter>' --limit=200 --format=json   # or: logcli query '{app="<svc>"}' --from=<rfc3339> --to=<rfc3339> --limit=200
```
**2. Logs** — structuredness, levels, correlation identifiers, end-to-end traceability of one request, noise, error-context
completeness, over the two populations §7 sizes. Produces the **structured share** with its N (T4), a **level histogram**
(T15), the unleveled-output count (`rg -c` prints one count per file and no total, so sum them), the id-propagation trace
across ≥ 2 hops (T1), the top-emitter share (T10), and the share of sampled catch sites logging without cause, stack or
input id (T14), read from each hit of `rg -n -A 4 -e 'catch \(' -e 'except ' -e 'rescue' -e 'if err != nil'`. *Cost:* the
sweeps are cheap; the catch-site reading is the expensive half, bounded by `N`.
```sh
rg -c --no-filename -e 'console\.log\(' -e 'fmt\.Print' -e 'System\.out\.print' -g '!**/*test*' | awk '{n+=$1} END{print n+0}'
awk '{n++} /^[[:space:]]*\{.*\}[[:space:]]*$/{j++} END{printf "structured %d/%d\n", j, n}' "$LOG_SAMPLE"
grep -oiE '\b(TRACE|DEBUG|INFO|WARN(ING)?|ERROR|FATAL|CRITICAL)\b' "$LOG_SAMPLE" | sort | uniq -c | sort -rn
rg -n -i -e 'traceparent|x-request-id|x-correlation-id|correlation_?id|request_?id|trace_?id' -e 'AsyncLocalStorage|contextvars|MDC\.|context\.WithValue|Baggage|propagat'
grep -oE '"(logger|msg|message)"[[:space:]]*:[[:space:]]*"[^"]{0,60}' "$LOG_SAMPLE" | sort | uniq -c | sort -rn | head -20
```
**3. Metrics** — golden-signal coverage per service on the critical path, business metrics, label cardinality. Produces
the **signal matrix** (service × latency/traffic/errors/saturation, each cell a `path:line` or `нет`), the business-metric
list with emitting sites, and the cardinality risk list. *Cost:* one sweep, then one read per matrix cell — the number of
services on the critical path sets the price, not the size of the tree.
```sh
rg -n -i -e 'prom-client|prometheus_client|micrometer|opentelemetry|statsd|Histogram|Counter|Gauge|Summary|meter\.create' -e 'labelNames|\.labels\(|with_label_values|Tags\.of'
curl -s "$PROM/api/v1/status/tsdb" | jq '.data.seriesCountByMetricName, .data.labelValueCountByLabelName'
```
**4. Tracing** — presence, coverage of cross-service calls, link to logs. Produces a per-edge verdict over the service
graph (traced / untraced / not applicable) and the log-join verdict (T9), the latter from `rg -n -e 'trace_?id'`, test
files excluded, against the emitters of step 2. *Cost:* one sweep plus one read per service edge, free where step 3 read it.
```sh
rg -n -i -e '@opentelemetry|opentelemetry-|OTEL_EXPORTER|otlp|jaeger|zipkin|tempo|elastic-apm' -e 'startSpan|start_as_current_span|tracer\.Start|StartActivity'
```
**5. Alerts** — inventory, the share of firings that led to an action, rules with no owner, critical scenarios with no
rule. Produces the **alert register** (§8.2) and the counts behind T2, T3 and T5. "Action" is an artefact **outside** the
alerting system — a ticket, a commit, a deploy, an acknowledgement — matched to the firing by time window. Firing counts
need a **history** source (the `ALERTS` series, a Grafana state-history export, the channel's own log); §5 says why the
`amtool` snapshot cannot supply one, and why no rule file at all is a finding input feeding T3 rather than a tool failure.
*Cost:* the rule half is minutes, the history the expensive half.
```sh
git ls-files -- '*.rules.yml' '*.rules.yaml' '*alert*' '*monitor*'
rules=$(git ls-files -- '*.rules.y*ml'); if [ -n "$rules" ]; then printf '%s\n' "$rules" | xargs -I{} promtool check rules {}; else echo 'no Prometheus rule files in repo'; fi
curl -s "$PROM/api/v1/rules" | jq -r '.data.groups[].rules[] | select(.type=="alerting") | .name'
curl -s --data-urlencode 'query=count_over_time(ALERTS{alertstate="firing"}[30d])' "$PROM/api/v1/query" | jq -r '.data.result[] | [.metric.alertname, .value[1]] | @tsv'
amtool --alertmanager.url="$AM" alert query --active; amtool --alertmanager.url="$AM" config routes show
rg -n -i -e 'slack_configs|pagerduty_configs|opsgenie_configs|webhook_configs|email_configs|runbook_url|team:|owner:'
```
**6. Dashboards** — currency, and whether a primary operational dashboard exists. Produces the board inventory with a
last-edit date per board and the operational-dashboard verdict (T11, T12). *Cost:* minutes — two commands and one date
per board.
```sh
git ls-files -- '*dashboard*.json' 'grafana/*'; git log -1 --format='%ad %h' -- <dashboard.json>
curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" "$GRAFANA/api/search?type=dash-db" | jq -r '.[] | [.uid,.title] | @tsv'
```
**7. Client errors** — whether they are collected, and whether they are comparable with server records. Produces the
collector list with its init site and the correlation verdict (T13): a shared release, session or request identifier
joining a browser error to a server log line, or none. *Cost:* one sweep and one read of the init site; skipped outright
when the product has no user interface.
```sh
rg -n -i -e '@sentry/(browser|react|vue)|Sentry\.init|bugsnag|rollbar|@datadog/browser-(rum|logs)|LogRocket' -e 'window\.onerror|unhandledrejection|ErrorBoundary|reportError|sendBeacon'
rg -n -i -e 'release:|dist:|sessionId|session_id|X-Request-Id'
```

## 5. Tools

| Tool | What it measures here | Invocation | Fallback |
|---|---|---|---|
| Log store access | what the record actually contains inside an incident window | the remote query surfaces of step 1 (`kubectl logs`, `aws logs filter-log-events`, `gcloud logging read`, `logcli query`); `journalctl` only where a host shell already exists, and its answers are marked host-access-only and excluded from `I_t` (§9) | a log file or export at `LOG_SAMPLE` read with `awk`/`grep`; failing that, record the store in `tools_unavailable` and judge from emitter code at `hypothesis` |
| Metric store access | instrument existence, series count, label cardinality | `curl -s "$PROM/api/v1/status/tsdb" \| jq .data`; `curl -s "$PROM/api/v1/label/__name__/values"` | the instrument registrations from step 3's `rg` — a registration proves emission, not queryability, and the report says so |
| Alert configuration | the rule set, thresholds, routing, owners | the guarded `promtool check rules` of step 5 (never an unguarded `$(git ls-files …)`: with no match the substitution is empty and `promtool` falls back to standard input); `curl -s "$PROM/api/v1/rules"`; `amtool --alertmanager.url="$AM" config routes show` — the URL flag has no default, and without it the command exits on a missing required flag | `amtool config routes show --config.file=<alertmanager.yml>` when only the repository is readable, else `git ls-files -- '*.rules.yml' '*alert*'` read by hand. **No rule file at all is a finding input feeding T3, not a tool failure** — record it and continue |
| Alert firing history | how often each rule fired and what followed, over the observation window | `curl -s --data-urlencode 'query=count_over_time(ALERTS{alertstate="firing"}[30d])' "$PROM/api/v1/query"`; a Grafana alert state-history export; a notification-channel log. `amtool alert query --active` measures only what is firing at this instant — it serves T5, never T2 | correlate `git log --since=` and the channel export against the incident windows; with neither, T2's share is `не установлено` |
| Instrumentation-code reading | the authoritative answer for every signal-matrix cell | open each emitter found in steps 2–4 and read the call | none — this cannot be delegated to a grep |
| ripgrep (`rg`) | emitters, ids, instruments, span starts, collectors | `rg -n --no-heading -i -e '<pattern>'` | `git grep -n -i -E '<pattern>'`, else `grep -RnIE '<pattern>' .` |
| jq, and the POSIX floor (`awk`, `grep`, `sort`, `uniq`) | JSON telemetry and rule dumps; structured share, level histogram, top emitters | `jq -r '.data[]' <file>`; `awk '{n++} /^[[:space:]]*\{/{j++} END{print j,n}' "$LOG_SAMPLE"` | for jq, `python3 -c 'import json,sys;...'` or `grep -o … \| wc -l` when only a count is needed; the POSIX half needs no fallback |
| git | incident candidates, board and rule currency, change-vs-instrumentation dates | `git log -1 --format='%ad %h' -- <path>` | none — git is this audit's floor |
| Grafana / Datadog read API | which boards and monitors are deployed, not merely committed | `curl -s -H "Authorization: Bearer $GRAFANA_TOKEN" "$GRAFANA/api/search?type=dash-db"` | the committed JSON of step 6, every such finding labelled `probable` — a committed board may not be provisioned |

## 6. Analysis rules and thresholds

A finding is filed **per telemetry defect**, not per incident; the incidents are its evidence.

| # | Condition | Threshold | Severity | Origin |
|---|---|---|---|---|
| T1 | A sampled critical request cannot be reconstructed end to end from one identifier — absent, not propagated to the next hop, or never printed into the record | ≥ 1 traced flow | S1 | requirements |
| T2 | Firings that led to no action, over all firings in the observation window | > 50% | S1 | requirements |
| T3 | Critical scenario with no rule that would fire on its failure | ≥ 1 scenario | S1 | requirements |
| T4 | Application log lines that do not parse as a structured record, over the counted sample | > 20% | S2 | requirements |
| T5 | Rule with no owner: no `team`/`owner` label, no runbook link, no route to a watched channel | ≥ 1 rule | S2 | derived |
| T6 | Golden signals covered for a service on the critical path | ≤ 2 of 4; 0 of 4 | S2; S1 | derived |
| T7 | Money or conversion flow whose success and failure are counted only as HTTP status, with no business metric | ≥ 1 flow | S2 | derived |
| T8 | Metric label bound to an unbounded value (user id, request or trace id, email, raw URL path, error text) | ≥ 1 label | S2 | derived |
| T9 | Services calling each other over the network with no tracing at all; or traces present but not joinable with logs (no trace id in the record) | ≥ 1 edge; ≥ 1 service | S2; S2 | derived |
| T10 | Noise: one non-error emitter over half the sampled volume, or `error` level used for handled expected conditions | > 50% share; ≥ 5 sites | S3 | derived |
| T11 | No primary operational dashboard: no single view carrying the critical path's golden signals | 0 such boards | S2 | derived |
| T12 | Dashboard unchanged while its service changed | 0 edits / 12 months, ≥ 1 service commit | S3 | derived |
| T13 | Client-side errors not collected in a product with a user interface; or collected but carrying no identifier shared with the server record | 0 collectors; ≥ 1 collector | S2; S3 | derived |
| T14 | Error records logged with no cause chain, no stack and no identifier of the failing input | > 30% of sampled catch sites | S2 | derived |
| T15 | Levels carry no signal: the histogram of step 2 puts nearly everything at one level, or a sample spanning a known failure holds no error-level line at all — severity cannot be filtered on, so the incident window cannot be narrowed | > 90% of lines at one level; 0 error lines | S2 | derived |

`report-contract.md` §5's reachability and position rules apply once on top of a row. A value you could not establish is
`не установлено` — not a crossing, but a cut to `confidence`. T2 is S1 for **alert fatigue**, not for the one firing nobody
acted on: past roughly half, the channel stops being read and the rule that would have caught the next incident fires unseen.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

- **Primary sampling unit: the alert rule** — `N` counts rules. **Ranking**, in order: routes to a paging destination;
  guards a critical or money flow; highest firing count in the window; edited in the last 90 days; carries no owner label.
- **Two sub-populations are read whole at every `DEPTH`:** the incidents of `PAST_INCIDENTS`, and the critical request
  flows traced for T1 — `min(5, all)`, from `BUSINESS_CONTEXT` and the A-12 matrix.
- **Two more populations are counted, so each carries its own N** — T4, T10, T14 and T15 are shares over them. *Log lines:*
  `LOG_SAMPLE` is read whole and its line count is the N, capped at 2 000 / 10 000 / 50 000 by `DEPTH`, over the window §2
  fixes; a truncated sample says so and keeps the tail, never the head. *Catch sites:* the top `N` of the contract, ranked
  critical-path modules first, then step 2's top-emitter files, then by hit count.
- **`coverage` is the contract's multi-population list** (§8), five clauses under one shared method note: the alert rules
  first, as this audit's primary unit, then incidents, traced flows, log lines and catch sites, each with its own N.
- **Control sample `C`:** rules that never fired in the window, where a dead rule hides. **Early stop:** the contract's
  control-sample stop, additionally requiring a terminal verdict on every incident and every gap point traced to a named
  defect with a `path:line` or an issued query.

## 8. Report additions

1. **Протокол ретроспективного расследования** — inside §5 *Детальные находки*, one per incident, before the findings.
   Header: дата, симптом, установленная причина, окно расследования. Then a numbered question trail, each row: вопрос |
   запрос (verbatim) | ответ | вердикт (`по телеметрии` / `нужен доступ к машине` / `ответа нет`) | точка нехватки данных.
   Closes with the terminal verdict and the finding ids its gaps evidence; an unattempted one goes to *Границы достоверности*.
2. **Таблица алертов с оценкой полезности** — inside §7 *Приложения*. One row per rule: алерт | источник (`path:line` or
   rule group) | что измеряет | порог и окно | владелец | канал | срабатываний за окно | из них с действием | вердикт
   (`полезный` / `шумный` / `мёртвый` / `без владельца`) | finding ids. Every cell carries evidence or the literal `не
   установлено`; blank is not permitted. T2 and T5 come from the last two columns.

## 9. Score

**Investigability** `I_t / I`, unit: a ratio reported with its percentage and its N. `I` is the number of incidents run
through step 1 — the members of `PAST_INCIDENTS`, or their synthetic substitutes, counted and labelled as such. `I_t` counts
incidents whose cause was established to a named component *and* a named mechanism using only telemetry a reader could query
without a shell on the host: no `ssh`, no `kubectl exec`, **no `journalctl`** or any other read of a file on the machine, no
inference from source the telemetry did not point to. A partial answer scores 0: the unit is a cause, not a lead. Report the
companion count `G` beside it, distinct gap points deduplicated by the defect they name, each mapped to a finding id. Emit in
§2 *Итоговая оценка* as `Расследуемо по телеметрии: I_t/I (NN%); точек нехватки данных: G`. The justification names the gap
that blocked the most incidents, the one cheapest to close, and — `I` being small by construction — the denominator's
provenance.

## 10. Failure modes of this audit

1. **Inventorying the stack instead of investigating it** — the central risk, and why step 1 is first: ELK, Prometheus,
   Grafana, Jaeger and Sentry all present yields a favourable report while the field the investigation needed was never
   emitted. *Countermeasures:* a capability claim cites the query issued with its answer or the `path:line` emitting the
   field, never a tool's presence; and reaching step 2 with no protocol written fails the audit — §2's fallback exists.
2. **Generalising from one log line** — a well-formed sample says nothing about the emitter producing most of the volume.
   *Countermeasure:* the structured share is counted over a sample with the stated N of §7, beside the top-emitter list.
3. **Crediting configuration that is not deployed** — a rule file may be unloaded, a dashboard JSON unprovisioned.
   *Countermeasure:* prefer the live system's own listing; when only the repository is readable, label those `probable`.
4. **Mistaking an id's presence for its propagation** — an id minted at the edge is not traceability if the next hop drops
   it or the log never prints it. *Countermeasure:* T1 is proven by joining one real identifier across at least two hops.
5. **Judging the alerts from the alerting system alone** — a rule that never fired and one that fired 400 times both count
   as one alert, and auto-resolution is not action. *Countermeasure:* the register carries firing counts, action is an
   artefact outside that system with its source named, and absent either the cell is `не установлено`, never `полезный`.
6. **Sampling a quiet window** — telemetry read at 3am on a Sunday looks complete. *Countermeasure:* anchor every query in
   steps 2–7 to an incident window from step 1, or to a stated peak window.

## 11. Audit-specific prohibitions

Beyond `report-contract.md` §9.

- **Do not write into the telemetry systems, and do not page anyone.** No test alert, no silence or maintenance window, no
  monitor muted or unmuted, no dashboard saved (including an edit view's accidental re-save), no annotation, no alert
  acknowledged or resolved, no incident opened, no webhook fired, no message posted. Read-only endpoints and exports only.
- **Do not manufacture signal.** No synthetic transaction, no deliberate 500, no injected error, no `kubectl delete pod`,
  no load generated to watch a dashboard react. Behaviour is derived from instrumentation code and recorded telemetry.
- **Do not run unbounded queries against a production store.** Every query carries a time window and a limit — no
  `{__name__=~".+"}` across a year, no unbounded scan. Where the store serves production, prefer an export and say so.
- **Do not copy telemetry into the report.** Records carry user identifiers, tokens and payloads: quote field names and at
  most one redacted line per point; a raw dump never enters the appendices.
- **Do not modify instrumentation to check it, and add nothing to the running system.** No log line added, no temporary
  metric, no debug flag flipped, no verbosity raised on a running service, no agent, exporter or collector deployed.

## 12. Dependencies

**Input, as parameter values, never as remembered context:** **A-01** supplies the component register, which names a service
with no telemetry at all, and its environment map (`ENV_LIST`, A-01's product and definition): a read surface belongs to one
environment, so telemetry proven in one is never credited to another, and with no map the readable surfaces are one
environment named `unknown` — A-01's empty-union default, never `production`. **A-12** supplies the failure matrix — which
failure modes must be visible, and the synthetic incidents when `PAST_INCIDENTS` is empty. Neither is required: absent both,
step 1 derives incidents from history, steps 3–4 the service set from the repo, *Границы достоверности* records it and
`confidence` drops.

**Output:** the telemetry gaps, the investigability ratio and the alert register feed **A-18** (надёжность и восстановление):
what cannot be detected bounds time-to-detect, and so bounds every RTO claimed. Hand A-18 this report's path, or its values —
the score line from *Итоговая оценка*, the protocols' gap points from *Детальные находки*, the register from *Приложения*.

## 13. Nearest marvin command

`audit-index.md`'s command table carries no row for A-16: no shipped command audits a product's telemetry. The nearest
*activity* is `/marvin:debug` and its `marvin-debugger` agent, which reach one defect's root cause from code and
reproduction, where A-16 asks whether telemetry alone could have reached it and files the missing field rather than the bug.
`/marvin:lessons` may hold incidents already written down and accelerates §2's `PAST_INCIDENTS`; `/marvin:dashboard` reports
marvin's own artefact state, not the audited system's. Either is evidence to verify, never a section to paste.
