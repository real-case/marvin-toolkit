# A-19 — Стоимость владения

> **Audit question.** Where does infrastructure money go, and what of it creates no value?

## 1. Role and task

You follow the money the project spends to exist — cloud resources, third-party services, CI minutes, storage and traffic
— and close one question: which of it buys nothing. Every reduction carries its own risk, because a saving that removes
redundancy or shortens retention has not removed the cost, only moved it into the incident column. Besides the report, a
run leaves two artefacts the client takes into planning as values: the **cost register** (§8.1), one row per billed line
with its utilisation and reduction potential, and the **safe-reduction list** (§8.2), priced and risk-rated.

## 2. Audit-specific parameters

On top of `report-contract.md` §2's ten. §12's four predecessor reports are optional paths; config-only mode (§4) follows from `BILLING_ACCESS` = `none` alone.

| Parameter | Meaning | Derivation when unset |
|---|---|---|
| `BILLING_ACCESS` | what cost data is reachable and how: a read-only cloud profile, a billing export, a CSV or PDF invoice the client supplied | probe in order — `aws sts get-caller-identity`, `gcloud auth list --filter=status:ACTIVE --format='value(account)'`, `az account show`, `gh auth status` — then look for an invoice or export the user named. If nothing resolves, set `none` and run **config-only**: the shapes of waste stay visible in IaC, CI configuration and manifests, the money column stays `не установлено`, and `confidence` is `low` |
| `COST_PERIOD` | the window the breakdown and the trend cover | the last three complete calendar months — start = the 1st, three months back; end = the 1st of the current month, exclusive. Three points is the minimum that makes step 1's dynamics a trend rather than a pair. In config-only mode, the last 90 days of git and CI history |
| `USAGE_METRICS` | the denominators of step 7 — active users, requests, builds — or a path to the A-17 report carrying the build counts | builds from step 7's CI run history, requests from load-balancer or CDN metrics; **ask the user** for one monthly active-user number, which no repository holds. With no answer, compute the unit costs whose denominator exists, write `не установлено` in the rest, and say so in *Границы достоверности* rather than inventing a denominator |

**Values written into the commands.** §4's dates are `COST_PERIOD`'s worked example, replaced with the derived bounds;
angle brackets are resolved before the command runs, never guessed, each by a command in the block that uses it.
`<billing_table>` — the GCP billing export, `bq ls --format=prettyjson <dataset>`, asked for when it lives outside the
audited project. `<instance_id>` — step 2's `describe-instances`. `<lb_dimension>` — step 7's `describe-load-balancers`,
the ARN tail after `:loadbalancer/`. `<workflow_id>` — step 7's `gh workflow list`, never `gh run list`'s `databaseId`,
which identifies a run. `$PROM` — the Prometheus URL in the project's configuration; else §5's row takes its fallback.

## 3. Scope

**In scope.** Cloud compute, storage, managed services and network; non-production environments; CI/CD minutes, runners
and caches; artefact, image and backup storage; telemetry volume and its retention; egress and cross-zone transfer;
third-party and SaaS subscriptions with their seat counts.

**Out of scope.** Salaries, headcount and organisational expenses — excluded by the audit's own definition, and **no
audit in the family covers them**. Compute spent out of proportion to value → A-15, whose bottlenecks this audit prices
rather than re-measures. Pipeline speed → A-17; here only the minutes billed. Whether telemetry suffices to investigate
an incident → A-16; here only its volume and retention. Whether a standby, replica or backup is required → A-18; A-19
never rules redundancy unnecessary on its own evidence. Open-source licences → A-03, vulnerabilities in the same
services → A-14 and A-03, cloud IAM strength → A-14; step 3 reads tags for ownership only, and personal data in logs a
reduction would truncate → A-22. Vendor negotiation, procurement, currency and tax sit outside the family entirely.

## 4. Collection protocol

Reuse the A-01 register when supplied and diff it against what these steps find, so nothing is priced twice or missed.
When `BILLING_ACCESS` is `none` every step still runs — over IaC, CI configuration, manifests and git — with the money
column `не установлено`: a shape of waste is a finding, a price is not invented (§10.5). `RG_EXCLUDE` and `GIT_EXCLUDE`
below are `report-contract.md` §2's canonical arrays; A-19 adds nothing to them.

**1. Breakdown by service and by environment over `COST_PERIOD`, with the dynamics.** Produces the **cost register**
skeleton: line, service, environment, amount, share, month-over-month delta; covers 100% of billed spend. Repeat the
first query with `Key=RECORD_TYPE` (usage versus credits and refunds, before any share) and `Type=TAG` (environments).
```sh
aws ce get-cost-and-usage --time-period Start=2026-06-01,End=2026-09-01 --granularity MONTHLY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE --output json
# without -m the svc column comes back blank; the resource group exists only inside instanceId, so parse it out of there
az consumption usage list -m --start-date 2026-06-01 --end-date 2026-08-31 --query "[].{svc:meterDetails.meterCategory,env:instanceId,cost:pretaxCost}" -o tsv; bq query --use_legacy_sql=false --format=csv 'SELECT service.description, SUM(cost) c FROM `<billing_table>` WHERE usage_start_time >= "2026-06-01" AND usage_start_time < "2026-09-01" GROUP BY 1 ORDER BY c DESC'
git ls-files -- '*.tf' '*.bicep' '*docker-compose*' '*.yaml' "${GIT_EXCLUDE[@]}" | xargs -r rg -n -e 'instance_type\s*=' -e 'machine_type' -e 'vm_size' -e 'desired_capacity' -e 'replicas:' -e 'node_count'
```

**2. Utilisation.** Produces three numbers per register row — mean, p95, maximum over the period — plus a separate reservation
column; oversizing is judged on p95, idleness on the maximum. A percentile is never a default: ask for it with
`--extended-statistics p95` below, or `quantile_over_time` in §5's row; `kubectl top` reads an instant, not a distribution.
Config-only: declared requests, limits and sizes read against A-15's load evidence; with neither, the column is `не
установлено` and T1 cannot fire.
```sh
aws ec2 describe-instances --query 'Reservations[].Instances[].InstanceId' --output text; aws cloudwatch get-metric-statistics --namespace AWS/EC2 --metric-name CPUUtilization --dimensions Name=InstanceId,Value=<instance_id> --start-time 2026-06-01T00:00:00Z --end-time 2026-09-01T00:00:00Z --period 86400 --statistics Average Maximum --extended-statistics p95
aws ce get-reservation-utilization --time-period Start=2026-06-01,End=2026-09-01 --granularity MONTHLY; aws ce get-savings-plans-utilization --time-period Start=2026-06-01,End=2026-09-01
kubectl top nodes; kubectl top pods -A --no-headers; kubectl get deploy -A -o json | jq -r '.items[] | [.metadata.name, (.spec.template.spec.containers[0].resources.requests.cpu // "none")] | @tsv'
```

**3. The forgotten** — idle environments and test stands, old snapshots, detached disks, log groups nobody deleted.
Produces the **orphan list**: resource, kind, age, size, last activity, and the evidence nothing uses it. An orphan lives
in the account, not the repository, so config-only mode records that gap rather than zero orphans; environment liveness
it still answers — no deploy, no build and no traffic make a T2 candidate.
```sh
aws ec2 describe-volumes --filters Name=status,Values=available --query 'Volumes[].{id:VolumeId,gb:Size,created:CreateTime}' --output table; aws ec2 describe-addresses --query 'Addresses[?AssociationId==null].PublicIp' --output text
aws ec2 describe-snapshots --owner-ids self --query 'Snapshots[].{id:SnapshotId,gb:VolumeSize,t:StartTime}' --output text | sort -k3; gcloud compute disks list --filter='-users:*' --format='table(name,sizeGb,zone)'; az disk list --query "[?diskState=='Unattached'].{name:name,gb:diskSizeGb}" -o table
kubectl get pv -o json | jq -r '.items[] | select(.status.phase=="Released") | .metadata.name'; git log -1 --format=%cI -- infra/staging/; gh run list --limit 200 --json workflowName,createdAt,conclusion -q '.[] | [.workflowName,.createdAt] | @tsv'
```

**4. Storage and retention.** Produces, per log group, bucket, index and metric store: volume, configured retention,
the derived **need**, and the delta. The need is A-16's investigation window when supplied; else the longest lookback in
`git log -i --grep='postmortem\|incident\|rca' --since='24 months ago' --oneline`; else 90 days for logs and 13 months
for metrics, as *выведено, не задано*. Where a legal retention obligation is plausible, ask before proposing any
shortening — A-22's territory, not a saving.
```sh
aws logs describe-log-groups --query 'logGroups[].{name:logGroupName,days:retentionInDays,bytes:storedBytes}' --output table
gcloud logging buckets list --format='table(name,location,retentionDays)'   # no --location: it filters, and 'global' hides every regional bucket
rg -n -i -e 'retention_in_days' -e 'retention' -e 'expiration' -e 'lifecycle_rule' -e '\bttl\b' -e 'storage\.tsdb\.retention' -e 'index_lifecycle|ilm_policy|_ism' -g '*.tf' -g '*.yml' -g '*.yaml' "${RG_EXCLUDE[@]}"
```

**5. Traffic.** Produces the transfer table: egress by direction, cross-zone and cross-region transfer, their share of
spend, and the architectural cause of each — a NAT gateway in the path, a chatty replica, an origin serving CDN assets.
```sh
aws ce get-cost-and-usage --time-period Start=2026-06-01,End=2026-09-01 --granularity MONTHLY --metrics UnblendedCost --group-by Type=DIMENSION,Key=USAGE_TYPE --output json | jq -r '.ResultsByTime[].Groups[] | [.Keys[0], .Metrics.UnblendedCost.Amount] | @tsv' | grep -i -e datatransfer -e bytes -e natgateway
aws ec2 describe-nat-gateways --query 'NatGateways[].{id:NatGatewayId,state:State}' --output table; rg -n -i -e 'availability_zone' -e 'multi_az' -e 'cross_zone' -e 'cloudfront|cdn' -g '*.tf' -g '*.yaml' "${RG_EXCLUDE[@]}"
```

**6. Third-party software.** Produces the subscription table: service, plan, seats paid, seats demonstrably used,
references in the tree, monthly amount. Seat truth lives in the vendor console (`BILLING_ACCESS`); the repository gives
the demand-side bound, emitted as counts only, never the names behind them (§11).
```sh
rg -l -i "${RG_EXCLUDE[@]}" -e 'datadog|newrelic|sentry|segment|mixpanel|amplitude|launchdarkly|algolia' -e 'auth0|okta|twilio|sendgrid|mailgun|stripe|snyk|sonarcloud|pagerduty|atlassian'
git ls-files -- '*.env*' '*.tfvars.example' '*.yml' "${GIT_EXCLUDE[@]}" | xargs -r rg -l -i -e 'API_KEY|TOKEN|LICENSE'; git shortlog -sn --since='90 days ago' HEAD | wc -l; gh api "/orgs/{owner}/members" --paginate -q '.[].login' | wc -l   # 404 under a user account: git shortlog is then the whole bound
```

**7. Unit cost.** Produces three numbers with their denominators and commands — **cost per active user**, **cost per request**,
**cost per build**, each per month of `COST_PERIOD` — plus their trend. A unit cost with no denominator is `не установлено`, not
an estimate. The build series is **run history** bucketed by month (§5's CI row), never `/timing`. Both denominators carry the
period: without `--search` and `created=>=`, `gh` returns the most recent rows up to `--limit` and saturates in silence.
```sh
gh api --paginate "repos/{owner}/{repo}/actions/runs?created=>=2026-06-01&per_page=100" --jq '.workflow_runs[] | [.created_at,.name,.conclusion,.run_started_at,.updated_at] | @tsv'
gh pr list --state merged --search "merged:2026-06-01..2026-09-01" --limit 1000 --json mergedAt -q '.[].mergedAt' | wc -l; gh workflow list --json id,name; gh api "repos/{owner}/{repo}/actions/workflows/<workflow_id>/timing" -q '.billable'
aws elbv2 describe-load-balancers --query 'LoadBalancers[].LoadBalancerArn' --output text; aws cloudwatch get-metric-statistics --namespace AWS/ApplicationELB --metric-name RequestCount --dimensions Name=LoadBalancer,Value=<lb_dimension> --start-time 2026-06-01T00:00:00Z --end-time 2026-09-01T00:00:00Z --period 86400 --statistics Sum
```

## 5. Tools

| Tool | What it measures here | Invocation | Fallback |
|---|---|---|---|
| Billing report / cost API | the only source of real money: amount per line, per environment, per month | the step 1 block — `aws ce get-cost-and-usage`, `az consumption usage list -m`, `bq query` over the GCP billing export | on Azure, `az costmanagement query --type Usage --timeframe Custom --time-period from=…,to=… --dataset-grouping name=ServiceName type=Dimension --dataset-grouping name=ResourceGroupName type=Dimension`, which returns both columns natively; else a client-supplied CSV invoice, its columns read from the header first: `awk -F, '{s[$2]+=$5} END{for(k in s) print s[k], k}' invoice.csv \| sort -rn`; else config-only mode and `не установлено` in the money column |
| Resource tags / cost allocation | which spend has an owner, and how much has none | `aws ce get-cost-and-usage --time-period Start=2026-06-01,End=2026-09-01 --granularity MONTHLY --metrics UnblendedCost --group-by Type=TAG,Key=Owner`; `aws resourcegroupstaggingapi get-resources --tags-per-page 100`; `az tag list` | `rg -n -e 'tags\s*=' -e 'default_tags' -e 'labels:' -g '*.tf' -g '*.yaml' "${RG_EXCLUDE[@]}"` — declared tags bound coverage from above, they never confirm it |
| Utilisation metrics | mean / p95 / maximum per resource; reservation utilisation | the step 2 block; `curl -sG "$PROM/api/v1/query" --data-urlencode 'query=quantile_over_time(0.95, container_memory_working_set_bytes[7d])'` against the project's own Prometheus, with `avg_over_time` and `max_over_time` for the other two columns | declared requests, limits and sizes from IaC read against A-15's bottleneck table; record the tool in `tools_unavailable` |
| Cloud resource CLIs (`aws`, `gcloud`, `az`) | the orphan population of step 3; log-group, bucket and disk volume and retention in step 4; NAT and transfer topology in step 5 | the step 3–5 blocks: `aws ec2 describe-volumes\|-addresses\|-snapshots\|-nat-gateways`, `aws logs describe-log-groups`, `gcloud compute disks list`, `gcloud logging buckets list`, `az disk list` | nothing reproduces them — an orphan exists in the account, not in the tree. IaC declarations (`git ls-files -- '*.tf' '*.yaml' "${GIT_EXCLUDE[@]}" \| xargs -r rg -n`) still give steps 4 and 5 their retention and topology settings and bound the population from above; step 3 records the orphan gap rather than zero orphans, the CLI goes into `tools_unavailable`, and `confidence` is capped at `medium` |
| A-01 inventory | the resource population the register must cover | read the component register from the supplied A-01 report path | rebuild from `git ls-files -- . "${GIT_EXCLUDE[@]}"` plus step 1's last line, and say in *Границы достоверности* that the population is repository-derived |
| CI run history | duration, conclusion and month per run — step 7's build series — and the merges those runs produced | `gh api --paginate "repos/{owner}/{repo}/actions/runs?created=>=2026-06-01&per_page=100"`, duration from `run_started_at` → `updated_at`; `gh run list --limit 200 --json databaseId,workflowName,createdAt,updatedAt,conclusion`; `glab api "projects/:id/pipelines"`. `gh api "repos/{owner}/{repo}/actions/workflows/<workflow_id>/timing"` is a current-cycle, private-repo-only, deprecated cross-check — never the series | matrix breadth × schedule from `rg -n -e 'matrix:' -e 'cron:' .github/workflows` × durations from run timestamps, labelled as an extrapolation with its N |
| kubectl | requests versus actual usage; released volumes; replica counts | `kubectl get deploy -A -o json`; `kubectl top pods -A --no-headers`; `kubectl get pv -o json` | the manifests and Helm values in the tree; a declared replica count is a floor, not a measurement |
| ripgrep (`rg`) and `jq` | retention settings, SaaS markers, sizing literals and tag blocks; reshaping cost and metric JSON into the register | `rg -n --no-heading -i -e '<pattern>'`; `jq -r '.ResultsByTime[].Groups[] \| [.Keys[0], .Metrics.UnblendedCost.Amount] \| @tsv'` | `git grep -n -i -E '<pattern>'`, else `grep -RnIE '<pattern>' .`; for `jq`, `--output text` or `--format='value(...)'` on the cloud CLI itself, then `awk` |
| git | environment liveness, seat demand, incident lookback, the history of every sizing change | `git log -1 --format=%cI -- <path>`; `git shortlog -sn --since='90 days ago' HEAD \| wc -l` | none — git is this audit's floor |

## 6. Analysis rules and thresholds

A finding is filed **per cost line or per resource class**, never per instance; individual resources are its evidence,
and every threshold is measured over `COST_PERIOD`.

| # | Condition | Threshold | Severity | Origin |
|---|---|---|---|---|
| T1 | Resource whose utilisation stays below the floor, judged on p95 rather than the mean | < 20% | S3; S2 when that line is ≥ 5% of period spend | requirements |
| T2 | Environment with no deploy, no build and no request traffic | > 30 days | S3; S2 when ≥ 5% of period spend | requirements |
| T3 | Spend attributable to no owner — untagged, unlabelled, or tagged to a value no team claims | > 15% of total | S2 | requirements |
| T4 | Reservation or committed-use discount left unused | utilisation < 80% | S3; < 50% → S2 | derived |
| T5 | Orphan: detached volume, unassociated address, balancer with no target, snapshot past its policy, untagged registry image | age > 90 days and 0 attachments | S3; S2 when orphans total ≥ 5% of spend | derived |
| T6 | Log or telemetry stream with no retention configured, or retention far beyond the step 4 need | unset, or > 3 × need | S3; S2 above 10% of spend | derived |
| T7 | Data transfer — egress plus cross-zone and cross-region — as a share of spend | > 5% | S3; > 10% → S2 | derived |
| T8 | Paid seats above measured demand | seats > 1.25 × active users, or ≥ 5 idle seats | S3 | derived |
| T9 | Paid subscription with no reference in code, configuration or CI over the period | 0 references | S3 | derived |
| T10 | A unit cost of step 7 rising while its denominator is flat or falling | > 20% period over period | S2 | derived |
| T11 | CI minutes billed for runs that produced no merged change — cancelled, superseded, abandoned branches | > 40% of billed minutes | S3 | derived |
| T12 | Total spend growing with no budget, alert or cap configured in the account or in IaC | > 50% month over month | S1 | derived |
| T13 | Non-production environment sized against production | ≥ 50% of production spend | S3 | derived |

`report-contract.md` §5's reachability and position rules apply once on top of every row. On T1–T3 the requirements fix
the threshold and the base severity; the spend-share escalation inside each of those three cells is this spec's own, and
may move. **A number you could not measure is `не установлено`** — a cut to `confidence`, never a crossing. A crossing
becomes a *reduction candidate* only with step 3's no-use evidence.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

- **Sampling unit: the cost line** — one billed service × environment row; in config-only mode, the declared resource
  from the step 1 register. **Top-`N` ranking**, in order: absolute spend over the period, descending; then
  month-over-month growth; then non-production lines; then lines with no owner tag.
- **Cover 80% of spend before anything else.** Read down the ranked list until the examined lines reach 80% of the
  period total — even if that is fewer rows than `N` — then spend what is left down the tail. **`C` is drawn from that
  tail**, load-bearing here: forgotten resources are individually small and never rank into the top `N`.
- **Early stop:** the contract's control-sample stop, additionally requiring that the examined lines exceed 80% of spend.

## 8. Report additions

1. **Таблица расходов** — inside §7 *Приложения*. One row per register line, columns `статья | сумма | доля |
   утилизация | потенциал сокращения | риск сокращения`, ordered by amount, with a totals row. *Утилизация* carries its
   window and statistic (p95 or maximum); *потенциал сокращения* is money per month, or §9's resource units in
   config-only mode; *риск сокращения* is `низкий` / `средний` / `высокий` and **never empty**. Beneath the table, step
   7's three unit-cost rows with their denominators and commands.
2. **Список безопасных сокращений** — inside §5 *Детальные находки*, as a subsection preceding the findings. Only
   `низкий`-risk entries, ordered by amount, each stating what is removed or resized, the money per month, whether it
   recurs or is one-off, the evidence nothing uses it, what breaks if that evidence is wrong, how to reverse it, and the
   finding ids it settles. An entry removing a standby, replica, backup copy, headroom or retention window is never
   `низкий` (§10.1) and stays in the register table at its real risk level.

## 9. Score

**Safe reduction and its share.** `E = Σ eᵢ` over the candidates rated `низкий`, in currency per month; `S = E / B`,
where `B` is mean monthly total spend over `COST_PERIOD`. Emit in §2 *Итоговая оценка* as `Безопасное сокращение: E
<валюта>/мес — NN% от расходов (k из m кандидатов; остальные исключены по риску)`. One-off recoveries (an archive
deleted, a term released) are a separate one-time figure, never folded into the monthly `E`. In config-only mode `E` is in resource units per month and `S` is `не установлено`. The justification names the largest
single line, the dominant waste class, the share of `E` that recurs, and the largest candidate excluded for risk.

## 10. Failure modes of this audit

1. **Booking a saving that only moves the cost** — the central risk. Cutting a replica, a standby, a backup copy or a
   retention window buys a line in the cloud bill with a line in the incident budget. *Countermeasure:* every candidate
   names what it removes and carries a risk rating; anything touching redundancy, backups, retention or headroom is
   capped at `средний`, excluded from `E`, and checked against A-18's RTO/RPO and A-16's telemetry gaps.
2. **Averaging away the peak.** A mean CPU of 8% can hide a daily spike that saturates the instance, and a batch node
   is idle by design between runs. *Countermeasure:* judge T1 on p95 and the maximum over a window covering a full
   business cycle, and look for a schedule — cron, autoscaler, start/stop automation — before filing T2.
3. **Reading an unused reservation as deletable waste.** The commitment is already paid, and cancelling can cost more
   than it saves. *Countermeasure:* T4's remedy is re-targeting workloads onto it, its saving bounded by the term.
4. **Treating untagged as unowned as unused.** Deleting untagged spend is how a cost audit causes an outage.
   *Countermeasure:* T3 never yields a deletion candidate; a resource enters §8.2 only with step 3's evidence.
5. **Inventing prices.** A rate card recalled from memory is fabricated tool output under `report-contract.md` §7, rule 2.
   *Countermeasure:* money comes only from billing data or a cited client-supplied rate; everything else, resource units.
6. **Calling growth waste.** Spend rising with usage is the system working. *Countermeasure:* divide by step 7's
   denominators before any trend finding — T10 fires on the unit cost, never on the total.

## 11. Audit-specific prohibitions

Beyond `report-contract.md` §9.

- **Change nothing in any account:** no `terminate-instances`, `delete-snapshot`, `delete-volume`, `kubectl delete`,
  `kubectl scale`, no resize, no lifecycle rule applied, no retention shortened — a reduction is a recommendation.
- **Do not run `terraform plan`, `apply`, `refresh`, `import` or `state`** — `plan` refreshes remote state and takes a
  state lock, which is a write. Read `.tf` with `rg`; for an existing plan artefact, `terraform show -json <file>`.
- **Do not touch billing configuration:** no budget, alert or tag written, no reservation or savings plan bought or
  cancelled, no subscription downgraded, no seat removed. Recommend it instead.
- **Do not run an enumeration that itself costs money, and do not create load to measure utilisation.** A cost audit
  that raises the bill has failed: no recursive bucket listing (`aws s3 ls --recursive`), no per-object scan, no Cost
  Explorer call in a loop, no load test, no synthetic traffic, no scaling experiment. Volume comes from storage
  metrics, inventory reports and one grouped query; utilisation from recorded metrics, or it is `не установлено`.
- **Report counts of people, never people:** seat demand is a number from `git shortlog -sn HEAD | wc -l` or the
  member API; no name, login or email of a licence holder appears, and no statement ties a seat to a person.
- **Do not carry billing data out of `OUTPUT_DIR`** — account and subscription ids, invoice numbers, contract terms,
  customer names, endpoint inventories: never pasted into a cost calculator, vendor portal or pricing API.

## 12. Dependencies

**Input, as parameter values — a path to a finished report, or the values copied out of it — never as remembered context.** A-01
supplies the component register and the environment map (`ENV_LIST`, A-01's product and definition), so step 1 prices what
exists rather than what a console happens to show and T2 and T13 range over enumerated environments. A-15 supplies the
bottleneck list, which turns "this line is expensive" into "expensive *because*", and is the only honest utilisation evidence in
config-only mode. A-17 supplies the run counts and durations that make step 7's cost-per-build a division rather than an
estimate. A-18 supplies the SPOF and RTO/RPO record, without which §10.1 cannot tell a redundant standby from an idle one.
**None is required:** with all four absent, step 1 builds its own population, `ENV_LIST` falls to A-01's derivation run
unchanged — its empty union yielding one environment named `unknown`, never an assumed `production` — step 2 falls to declared
sizes, step 7 to §5's CI run history, and every candidate touching redundancy is capped at `средний`. Each absent input is named
in *Границы достоверности* with what it weakened, and `confidence` drops. A-16 is not an input: step 4 and §10.1 use its
investigation window when supplied, and derive the retention need otherwise.

**Output: none.** A-19 is terminal in `audit-index.md`'s matrix — no audit consumes it. The cost register and the
safe-reduction list go to `audit-summary` and to the client for planning, not into another audit's parameters.

## 13. Nearest marvin command

`audit-index.md`'s command table carries no row for A-19: nothing in marvin reads a billing account. `/marvin:sec-iac`
reads the Terraform, Kubernetes and Docker files of steps 1–5, judging them for exposure while A-19 judges them for
sizing, retention and placement. `/marvin:dashboard` counts local artefacts and the `.marvin/usage/` log, which can seed
step 7's build denominator. Either may accelerate a step; its output is evidence to verify, never a section to paste.
