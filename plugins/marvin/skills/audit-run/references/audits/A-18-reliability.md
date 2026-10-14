# A-18 — Надёжность и восстановление

> **Audit question.** What happens when a component or its data is lost, and how long is the way back?

## 1. Role and task

You audit the project's ability to survive loss — of a component, of a datum, of a certificate — and close one question: how long the way back is, and whether anyone has ever walked it. The
audit judges **evidence of recovery, not the presence of a backup job**: a backup nobody has restored is an unverified backup whatever its configuration says. Besides the report, a run
leaves three reusable artefacts — the SPOF table, the failure matrix, and the list of questions only the team can answer — which A-19 takes as parameter values.

## 2. Audit-specific parameters

On top of the ten in `report-contract.md` §2.

| Parameter | Meaning | Derivation when unset |
|---|---|---|
| `RTO_TARGET` | maximum tolerable time to restore service, per critical flow | search first: `rg -n -i -e '\bRTO\b' -e 'recovery time objective' -e 'time to restore'` over docs, SLA and contract files. Nothing found → **never invent one**: put it in the §8.3 question list, record `цель не задана`, and file T2. Ask the user once alongside `BUSINESS_CONTEXT`; no answer does not block the run |
| `RPO_TARGET` | maximum tolerable data-loss window | the same search for `RPO`, `recovery point`, `data loss`. Unset → derive a **ceiling** from the backup interval of step 1, label it *выведено, не задано*, and never treat it as a target: the ratio stays `цель не задана` |
| `BACKUP_CONFIG` | handles to backup configuration living outside the repository — managed-service settings, a vault, a console export | built entirely by step 1 from the tree and the IaC. A supplied value is a **hypothesis to confirm**: diff it against step 1 and file both directions — declared but absent from configuration, present in configuration but undeclared |
| `SLO_DEFINITIONS` | availability and latency objectives, and the error-budget policy | derived by step 4 from the tree. Nothing found → step 4 files T13 rather than asking; ask only when documentation refers to an SLO the repository does not hold |
| `INFRA_ACCESS` | read-only access to the running environment, or an export from it (a `kubectl` context, a cloud profile, console screenshots) | absent, the run proceeds over repository, IaC and documentation alone: record it in `tools_unavailable`, cap `confidence` at `medium`, and mark every infrastructure claim `заявлено` |
| `PAST_INCIDENTS` | **A-16's parameter, A-16's population, A-16's definition** — real incidents, each with a date, a user-visible symptom and the cause as eventually established. Take A-16's list when its report is supplied; A-18 defines no second one | `git ls-files \| grep -Ei 'incident\|postmortem\|outage\|sev[0-9]'` plus `git log -i --grep='incident\|outage\|postmortem\|hotfix'` — the second stays basic regex, where `\|` is the alternation; adding `-E` to it turns the same string into a search for a literal pipe and returns nothing. An empty history is a finding candidate (T17 context), not a blocker |

With all six empty the run completes end to end: step 1 builds the backup population and the placement pair T3 needs, step 3 builds the component inventory, steps 2–7 run over the tree,
both targets are reported absent, and §9's uncovered-scenario count carries the rest.

## 3. Scope

**In scope.** Backups — coverage, frequency, retention, encryption, geography, isolation from production. Restore — the procedure, its last actual exercise, its measured duration. Single
points of failure per layer: database, cache, queue, file storage, external dependencies, DNS, certificates. Redundancy and failover. SLO, their measurement and their error budget.
Degradation when a non-critical component is lost. Expiry of certificates, tokens, domains and licences, and the monitoring of it. Recovery procedures: runbooks, on-call, escalation.

**Out of scope.** Destructive experiments in production — no audit covers them, and §11 forbids them here. Schema reversibility and destructive migration steps → A-10,
whose output this audit consumes. Per-integration timeout, retry, idempotency and breaker behaviour → A-12; A-18 asks only whether the loss of that party is survivable and
for how long. Whether an incident can be investigated from telemetry at all → A-16; A-18 uses only the detection column. Deployment rollback speed and environment parity →
A-17; its rollback time is one term of RTO here. The cost of redundancy, standby capacity and backup storage → A-19, which this audit feeds. Secret strength, key scope and
leakage → A-14; step 1 records only that a backup is encrypted and where the key lives. Retention against legal or privacy requirements → A-22; here retention is judged
only against corruption-detection time. Throughput and latency under load → A-15. The degraded interface's accessibility → A-21. Quality of failure-path tests → A-07.

## 4. Collection protocol

Aggregate greps over the whole tree first, then targeted reading of the ranked top `N` scenarios (§7). Every step marks each result **подтверждено** (a drill, a job log, telemetry, an incident record) or **заявлено** (configuration or documentation
only); §6 forbids mixing them. Anything a step leaves unestablished becomes a question in the §8.3 list, never a guess: an audit of an environment it cannot see closes by naming what it could not see, what it assumed, and what each answer would change.
**The exclusions are the contract's**: `report-contract.md` §2's canonical set, as `"${RG_EXCLUDE[@]}"` on every ripgrep run, `"${GIT_EXCLUDE[@]}"` on every git pathspec and `$EXCLUDE_RE` over a path list already in hand. A-18 adds none of its own.

**1. Backups: coverage, frequency, retention, encryption, geography, isolation.** Produces the **backup register** — one row per protected asset with schedule, retention,
destination, encryption and key location, each with a `path:line` — plus the list of authoritative stores (from A-10, else from manifests) appearing in **no** row, plus the
**placement pair** T3 compares: the provider, account or project, and region of the destination and of the production store it protects, each resolved from the variable,
workspace or environment directory of the same IaC root, with the `path:line` that resolved it.
```sh
rg -n -i -e 'pg_?dump|pg_?basebackup|mysqldump|mongodump|wal-?g|pgbackrest|barman|restic|borg|duplicity|velero|litestream|rclone' -e '\bbackup\b|\bsnapshot\b'
rg -n -i -g '*.tf' -g '*.tfvars' -g '*.yaml' -g '*.yml' -g '*.json' -e 'backup_retention_period|aws_backup_plan|aws_backup_vault|point_in_time_recovery|deletion_protection|skip_final_snapshot' -e 'kind:\s*CronJob' -e 'schedule:|retention|ttl' -e 'kms_key|storage_encrypted|server_side_encryption|encryption_at_rest' -e 'region|availability_zone|multi_?az|cross_?region|replication_configuration|account_id|project_id'
git ls-files | grep -Ei 'backup|snapshot|disaster|(^|/)dr[-_/]'
```

**2. Restore — the key step. Establish the date of the last actual restore.** Produces one dated statement per register row: *last verified restore — YYYY-MM-DD, evidence `<ref>`*, or *never verified*. **A
backup with no such date is an unverified backup and is a T1 finding at S1 whatever its configuration says.** Configuration is not evidence here; a drill record, a job log, a CI run or a postmortem is.
```sh
git log -i -E --grep='restore|recovery|dr drill|game ?day|disaster|rehears' --oneline --since='24 months ago'
git ls-files | grep -Ei 'restore|runbook|drill|gameday|postmortem'
rg -n -i -e 'pg_restore|mongorestore|velero restore|restic restore|restore-?db|restore\.sh|import.*dump' -e 'verify.?backup|checksum|integrity'
```

**3. Single points of failure, layer by layer.** Enumerate the components first, then their redundancy. The first two commands are the **component inventory** — the population §7
draws its scenarios from — covering cache, queue and file storage, the three layers no other step reaches; database rows come from A-10's store list, else from step 1's register;
external rows from A-12's register when supplied. A layer the inventory leaves empty is a row reading `не установлено`, not an absent row, and a §8.3 question: "no cache is
configured" and "the cache is somewhere this run cannot see" are different answers. Produces the **SPOF table** (§8.1): one row per enumerated component, its redundancy, what breaks on its loss, its blast radius.
```sh
rg -n -i -g '*.tf' -g '*.yaml' -g '*.yml' -g '*.json' -g 'docker-compose*' -e 'elasticache|memcached|\bredis\b|rabbitmq|\bkafka\b|aws_sqs|aws_sns|pubsub|\bnats\b|celery|sidekiq|beanstalk' -e 'aws_s3_bucket|google_storage_bucket|azurerm_storage_account|minio|blob_container|\bgcs\b'
git ls-files | grep -Ei '(^|/)docker-compose[^/]*\.ya?ml$' | while read -r f; do awk '/^services:/{s=1;next} /^[^[:space:]]/{s=0} s&&/^  [A-Za-z0-9_.-]+:/{print FILENAME": "$0}' "$f"; done
rg -n -i -g '*.yaml' -g '*.yml' -e 'replicas:\s*1\b' -e 'kind:\s*(Deployment|StatefulSet)' -e 'PodDisruptionBudget|topologySpreadConstraints|affinity:'
rg -n -i -e 'multi_?az|read_?replica|standby|failover|sentinel|quorum|raft|cluster_mode|primary|leader' -e 'aws_route53|cloudflare_record|google_dns|dns_name|zone_id'
git ls-files -- '*.pem' '*.crt' '*.cer' "${GIT_EXCLUDE[@]}"
```

**4. SLO: formulated, measured, budgeted.** Produces a three-column verdict per critical flow — сформулирован / измеряется / есть бюджет ошибок — each
cell an evidence reference or `нет`.
```sh
rg -n -i -e '\bSLO\b|\bSLA\b|service level objective|error.?budget|availability target|uptime|apdex' -e 'sloth|pyrra|nobl9|slo-generator|grafana'
rg -n -i -g '*.yaml' -g '*.yml' -e 'kind:\s*PrometheusRule' -e '^\s*record:' -e '^\s*alert:'
```

**5. Degradation.** Produces, per non-critical component, what the system does on its loss: continues degraded (naming what the user sees), fails
whole, or `не установлено`. The grep locates candidates; the verdict comes from reading the enclosing handler.
```sh
rg -n -i -e 'degrad|fallback|read.?only mode|maintenance mode|feature.?flag|kill.?switch|circuit.?break|cache.?only|graceful' -e 'healthz|readyz|liveness|readiness'
rg "${RG_EXCLUDE[@]}" -n -A 8 -e 'catch \(' -e 'except ' -e 'rescue' -e 'if err != nil'
```

**6. Expiry: certificates, tokens, domains, licences — and whether anything watches them.** Produces the **expiry inventory**: artefact, kind, expiry
date where readable, renewal mechanism, monitoring, owner.
```sh
rg -n -i -e 'expir|not_?after|valid_?until|renew|cert-?manager|certbot|acme|lets?encrypt|auto_?renew' -e 'licen[sc]e_?key|subscription_expires|token_?ttl'
rg -n -i -e 'probe_ssl_earliest_cert_expiry|x509_cert_not_after|ssl_cert|domain_expiry|days_until_expiry'
openssl x509 -noout -subject -enddate -in <path-to-committed-cert>
```

**7. Procedures: runbook, on-call, escalation.** Produces the procedure verdict per top-`N` scenario — runbook path or `нет`, owner, escalation route,
and the date the runbook was last touched.
```sh
git ls-files | grep -Ei 'runbook|playbook|on-?call|escalation|incident|postmortem'; git log -1 --format='%h %ad' --date=short -- <runbook-or-restore-script-path>
rg -n -i -e 'pagerduty|opsgenie|victorops|grafana.?oncall|alertmanager|routing_key|escalation_polic'
```

## 5. Tools

| Tool | What it measures here | Invocation | Fallback |
|---|---|---|---|
| Backup configuration | steps 1–2: schedule, retention, destination, encryption, key location | read every file matched by step 1; managed-service settings through `INFRA_ACCESS` | none for the reading — without `INFRA_ACCESS` the row is `заявлено` and enters the question list |
| IaC and Compose sources | step 3's component inventory (cache, queue, file storage), redundancy, regions, accounts, retention, DNS, certificate resources | `rg -n -i -g '*.tf' -g '*.yaml' -g '*.json' -g 'docker-compose*' -e '<pattern>'` over Terraform, CloudFormation, Pulumi, Helm, k8s, Compose | `git ls-files -- '*.tf' '*.tfvars' '*.yaml' '*.yml' '*.json' "${GIT_EXCLUDE[@]}"` then read. **Never execute the IaC tool** (§11); `helm template` is the local render |
| Incident history | how the system has actually failed, and how long recovery took | `git log --since='24 months ago' --date=short --format='%h %ad %s' -i --grep='incident\|outage\|postmortem\|rollback\|restore'` — basic regex, for §2's reason | the `PAST_INCIDENTS` documents; absent, record it and say in *Границы достоверности* that RTO rests on documentation alone |
| Documentation | runbooks, DR plans, SLA text, ownership, escalation | `git ls-files -- . "${GIT_EXCLUDE[@]}" \| grep -i -e runbook -e disaster -e sla -e on-call -e oncall` then read each hit | `find . -name '*.md' \| grep -Ev "$EXCLUDE_RE"` and grep the same words |
| Team question list | everything the repository cannot answer | the §8.3 appendix, assembled as the protocol runs | none — this **is** the fallback for every other row |
| ripgrep (`rg`) | every aggregate grep above | `rg -n --no-heading -i -e '<pattern>'` | `git grep -n -i -E '<pattern>'`, else `grep -RnIE '<pattern>' .` |
| git | history, file enumeration, drill and incident evidence, artefact age | `git log`, `git ls-files`, `git log -1 --format=%ad --date=short -- <path>` | none — git is this audit's floor |
| `openssl` | expiry of a certificate committed to the tree | `openssl x509 -noout -subject -enddate -in <file>` | read `not_after` from the IaC or issuer configuration and record the date as `заявлено` |
| Live-environment CLIs (optional accelerators, need `INFRA_ACCESS`) | replica counts, PDBs, CronJobs, managed backup and replication settings | **establish the environment first and write it into *Методология*** — `kubectl config current-context`, the profile name, and `aws --profile <profile> sts get-caller-identity` recorded as the account **alias or profile name only**, never the id or the ARN (§11) — then pin it in every call: `kubectl --context <ctx> get deploy,sts,cronjob,pdb -A`; `aws --profile <profile> --region <region> rds describe-db-instances --output table`; `aws --profile <profile> --region <region> backup list-backup-plans`; `aws --profile <profile> s3api get-bucket-versioning --bucket <name>` — `get`/`list`/`describe` verbs only | read the manifests and the IaC instead, mark the row `заявлено`, and record the CLI in `tools_unavailable` |

## 6. Analysis rules and thresholds

Two rules govern every row. **A finding is filed per component or per scenario**, never per matched line; lines are its evidence. **Declared and confirmed are different claims:** configuration,
a runbook or a vendor page makes a cell `заявлено`; only a drill record, a job log, telemetry or an incident report makes it `подтверждено`. A threshold is crossed on `подтверждено` evidence,
or on the **absence** of evidence where the threshold is about absence (T1, T2, T4); a `заявлено` cell never softens a crossing and never substitutes for the drill T1 asks for.

| # | Condition | Threshold | Severity | Origin |
|---|---|---|---|---|
| T1 | Restore never actually verified, or the date of the last verification cannot be established | 0 drills | S1 | requirements |
| T2 | RTO unknown — no target stated for a critical flow and none recoverable from the tree | ≥ 1 flow | S1 | requirements |
| T3 | Backup stored in the same account, project or region as production | ≥ 1 destination | S1 | requirements |
| T4 | No monitoring of certificate expiry | 0 checks or alerts | S2 | requirements |
| T5 | Last verified restore older than twelve months | > 12 months | S2 | derived |
| T6 | Authoritative store absent from the backup register entirely | ≥ 1 store | S1; S0 when it holds money or identity data and no replica or export exists either | derived |
| T7 | Backup unencrypted at rest, or its key stored beside it | ≥ 1 row | S2 | derived |
| T8 | Estimated RPO exceeds `RPO_TARGET` | RPO_est > target | S1 | derived |
| T9 | Estimated RTO exceeds `RTO_TARGET` | RTO_est > target | S1 | derived |
| T10 | SPOF on a critical flow with neither redundancy nor a documented manual recovery | ≥ 1 | S1 | derived |
| T11 | Loss of a non-critical component takes the whole system down — no degradation path | ≥ 1 | S2 | derived |
| T12 | Backup retention shorter than the plausible time to notice a logical corruption | < 30 days | S2 | derived |
| T13 | No SLO formulated for any critical flow | 0 | S2 | derived |
| T14 | SLO stated but not measured (no query, recording rule or dashboard behind it), or measured with no error budget and no policy | ≥ 1 | S3 | derived |
| T15 | No runbook covering the top-ranked failure scenario | 0 | S2 | derived |
| T16 | Runbook naming no owner or escalation route, or untouched for twelve months | ≥ 1 | S3 | derived |
| T17 | No on-call and no escalation defined anywhere | 0 | S2 | derived |
| T18 | Expiring token, domain or licence with neither an owner nor renewal automation — an artefact whose production use is unconfirmed goes to the §8.3 question list, not to a finding | ≥ 1 per kind | S3; S1 when the artefact is confirmed in production use and expires in ≤ 30 days | derived |
| T19 | Backup job with no automated restorability check — no checksum, no test restore; distinct from T1's human drill | ≥ 1 row | S2 | derived |
| T20 | Failure scenario with no detection path — nothing alerts, a user reports it (§3 routes the telemetry detail to A-16) | ≥ 1 | S2 | derived |
| T21 | Share of enumerated scenarios with all three evidence columns of the §8.2 matrix — обнаружение, реакция, время восстановления — established | < 50% | S3 | derived |

`report-contract.md` §5's reachability and position rules apply once on top of the table. A cell you could not establish is `не установлено`: it feeds T21 and the question
list and cuts `confidence`, and it is not a crossing.

**T3 is decided from configuration, not from access.** Compare step 1's placement pair: the same account or project, or the same region, on both sides is the crossing, recorded
`подтверждено` from the IaC that resolved both; a differing pair closes the row. Where no root identifies itself as production — no `prod`/`production` workspace, environment
directory, `tfvars` file or variable value — T3 becomes a §8.3 question naming the root read and the placement assumed, so the S1 is reported unresolved rather than absent.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

- **Sampling unit: the failure scenario** — one component of step 3's inventory paired with one loss mode. The four modes are полная потеря экземпляра, потеря или повреждение данных,
  недоступность зоны или региона, истечение срока. `N` counts scenarios, and so does `coverage`.
- **Top-`N` ranking**, in order: holds the authoritative copy of business data; sits on a `BUSINESS_CONTEXT` critical flow; has no redundancy; lies outside the team's
  control (external party, DNS, registrar, certificate authority); fails on a date rather than on an event.
- **The population is usually smaller than `N`**, so the contract's whole-population rule is the normal case here rather than the exception; the budget it frees goes to
  step 5's degradation reading, from which `C` is drawn. **Early stop:** the contract's control-sample stop, additionally requiring that every enumerated critical scenario has all three evidence columns of the §8.2 matrix backed by evidence or by an explicit entry in the §8.3 question list.

## 8. Report additions

1. **Таблица SPOF** — inside §7 *Приложения*. One row per component of every layer of step 3, columns: уровень | компонент | избыточность | что ломается при потере |
   радиус поражения | оценка RTO | статус (`подтверждено` / `заявлено` / `не установлено`) | finding ids. Every cell carries a `path:line`, a command, or `не установлено`.
2. **Матрица «сценарий отказа — обнаружение — реакция — время восстановления»** — inside §5 *Детальные находки*, as a subsection preceding the findings. One row per
   enumerated scenario: сценарий | обнаружение (what alerts, after how long, or «пользователь сообщит») | реакция (runbook, owner, escalation) | время восстановления (the
   estimate and its four terms) | статус | finding ids. A row whose recovery time cannot be derived is written `не установлено` and counted into `U` (§9).
3. **Вопросы команде** — inside §7 *Приложения*. Every question the repository could not answer, each with what is unknown, which threshold or matrix cell it settles, what
   the audit assumed meanwhile, and how the report changes on each plausible answer. Never empty while any cell is `не установлено`.

## 9. Score

Three numbers, reported together in §2 *Итоговая оценка* and never averaged into one.

- **RTO ratio** = `RTO_est / RTO_TARGET`, unit: hours and a multiple. `RTO_est` is the **maximum** over the critical scenarios of `t_обнаружение + t_решение + t_восстановление + t_проверка`, each term from evidence: detection from the alert's own `for:` plus its notification route, or «пользователь
  сообщит» when nothing alerts; decision from the acknowledge and escalation timeouts of the on-call policy step 7 found (`escalation_polic`, PagerDuty or Opsgenie routing),
  else the median alert-to-first-action interval in `PAST_INCIDENTS`; restore from the last drill's measured duration or the runbook's own step times; validation from the
  post-restore checks that exist. The four terms fill the three §8.2 columns — detection to обнаружение, decision to реакция, restore and validation to время восстановления —
  so a term with no evidence leaves its column `не установлено` and counts the scenario into `U` instead of being guessed at.
- **RPO ratio** = `RPO_est / RPO_TARGET`, unit: minutes and a multiple. `RPO_est` is the backup interval plus the replication lag of the authoritative store, or the
  archive interval under continuous archiving (WAL shipping, PITR).
- **Uncovered failure scenarios** `U / S`, unit: a count and a share. `S` is the number of enumerated scenarios; `U` counts §8.2 rows missing at least one of detection,
  reaction or recovery time.

Emit as `RTO: <est> ч при цели <target> ч (×<ratio>); RPO: <est> мин при цели <target> мин (×<ratio>); непокрытых сценариев отказа: U/S (NN%)`. An absent RTO target makes its
ratio the literal `цель не задана` and fires T2; an absent RPO target does the same and goes to the question list, no threshold being defined for it. Justify by naming the
scenario that sets `RTO_est`, the store that sets `RPO_est`, and how much of both is `заявлено` rather than `подтверждено`.

## 10. Failure modes of this audit

1. **Reading a configured backup as a working backup.** A retention setting proves a job was defined, not that its output restores. *Countermeasure:* step 2 is mandatory
   and dated; with no date T1 fires at S1 and every RTO term below the restore is `заявлено`.
2. **Mixing declared and confirmed.** A documented runbook and an executed one read identically in prose, and no reader can separate them afterwards. *Countermeasure:* the
   status column of §8 on every cell, the `заявлено` share stated in the score, and any sentence without that marker deleted before release.
3. **Treating a replica as a backup.** Replication propagates a `DELETE`, a bad migration and an encryption event within seconds. *Countermeasure:* a replica satisfies
   redundancy in the SPOF table and never satisfies T6; only a point-in-time-recoverable copy does.
4. **Auditing the development topology.** A `docker-compose.yml` with one Postgres describes a laptop, not production. *Countermeasure:* record which environment each
   artefact describes; without `INFRA_ACCESS`, production redundancy is `не установлено` and becomes a question, never a "single instance" finding. Placement is the one
   exception, because the IaC states it: T3 is decided as §6 says whether or not the environment can be reached.
5. **Crediting a tool's presence as monitoring.** `cert-manager` installed, or an exporter scraped, is not an alert reaching a person. *Countermeasure:* T4 is satisfied
   only by a check with a threshold and a route to a recipient; trace both, or file it.
6. **Estimating RTO from the fast path.** The restore command's runtime is a fraction of the way back — detection, decision, DNS or cache propagation and validation
   dominate. *Countermeasure:* §9's four terms are recorded separately, and a missing term makes the scenario uncovered rather than optimistic.
7. **Wanting to check by breaking.** The one direct way to measure RTO is to stop a component, and this audit may not. *Countermeasure:* §11 forbids it without exception;
   the estimate comes from incident history, drill records and the runbook's own steps, every untestable question goes to the §8.3 list with the value assumed meanwhile.

## 11. Audit-specific prohibitions

Beyond `report-contract.md` §9.

- **Do not stop, restart, scale, drain, fail over, or inject a fault into anything.** No `kubectl delete`, `drain`, `cordon`, `rollout restart` or `scale`; no
  `docker compose down` or `stop`; no `systemctl stop`; no leader step-down; no chaos tool, host blackholed in `/etc/hosts` or a firewall rule, latency proxy, load or
  failover test, or flag toggled to force degradation. Behaviour is derived from configuration, incident history and code paths; an untraceable scenario is
  `не установлено`, not an experiment.
- **Do not rehearse a restore.** No `pg_restore`, `mysql < dump`, `mongorestore`, `velero restore`, `restic restore`, snapshot restore or PITR — not even into a scratch
  environment, where it still consumes the backup, holds locks and is easily mistaken for the real thing. Read the restore script and the record of its last execution.
- **Do not execute the IaC tooling.** No `terraform plan`, `apply`, `destroy`, `import` or `refresh` — `plan` alone locks and refreshes remote state; no `pulumi up` or
  `preview`; no `helm install` or `upgrade`. Read the sources, and render locally with `helm template` when a rendered form is needed.
- **Do not touch or probe expiry.** No `certbot renew` (its `--dry-run` still contacts ACME), no certificate, token, key or domain renewal, rotation or TTL change; no
  `openssl s_client`, `curl` or `dig` against production, no uptime checker or status-page lookup. `openssl x509` on a file in the tree is the sanctioned form.
- **Do not reach a live environment on an ambient default.** No `kubectl` or cloud CLI call inherits the current kubeconfig context or the credential chain: every one carries
  an explicit `--context` and `--profile` (and `--region` where the API takes one) naming an environment established and written into *Методология* before the first call, and
  the verbs stay `get`, `list` and `describe`. An unlabelled result is not evidence of anything — without the recorded context the row is `не установлено`, not production.
  Record the account by profile name or alias only, never by id or ARN.
- **Do not read backup contents, and do not page anyone to obtain an answer.** Existence, size, timestamp, destination and encryption state are the whole of what is
  recorded: never download, list or open a backup artefact, and never print a DSN, a bucket path carrying an account id, a vault path or an alerting integration key. No
  test alert, no on-call trigger, no incident opened to see what happens — the §8.3 question list is the mechanism for everything the repository cannot answer.

## 12. Dependencies

**Input, as parameter values.** **A-10** — the schema, the destructive migration steps and the backup-before-migration evidence, seeding step 1's authoritative-store list and §7's
data-loss scenarios. **A-12** — the resilience matrix and the external single-point-of-failure count, entering step 3's external-dependency layer directly. **A-16** — the telemetry gaps, which populate the detection
column of the §8.2 matrix and decide T20. **A-17** — the delivery metrics, whose rollback time is one term of `RTO_est` and whose environment-parity finding bounds how far a staging restore proves anything. Each
arrives as a report path or as copied values. Absent A-10, step 1 builds the authoritative-store list from the manifests; absent A-12, step 3 enumerates the external layer from the
dependency manifests and the outbound-call sites; absent A-16, T20 rests on step 4's alerting rules alone; absent A-17, rollback time is read from the deployment configuration as `заявлено`.

**Output.** The SPOF table, the failure matrix and the RTO/RPO estimates go to **A-19** (стоимость владения), which prices redundancy, standby
capacity and backup storage against the risk they buy. Hand it this report's path. `audit-index.md` lists no other consumer.

## 13. Nearest marvin command

`audit-index.md`'s command table carries no row for A-18: no shipped command audits recoverability. Two touch one step each. `/marvin:sec-iac` overlaps steps 1 and 3 — it reads the same Terraform, Kubernetes and
Compose sources, but judges security posture, where A-18 reads them for durability, redundancy and placement. `/marvin:migration-plan` overlaps step 7's runbook question and is forward-looking: it drafts a rollback
strategy for a change not yet made, while A-18 measures the recovery paths that already exist. Either may accelerate a step; its output is evidence to verify against the commands above, never a section to paste.
