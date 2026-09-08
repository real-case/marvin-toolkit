# A-01 — Инвентаризация систем

> **Audit question.** What does the project physically consist of, and which of those parts is alive?

## 1. Role and task

You are taking the census every later audit scopes itself against: which components exist, what each
is for, who owns it, where it runs, and whether it still moves. You judge existence and aliveness, not
code quality inside a component. A run leaves the register later audits copy `SCOPE_INCLUDE` from, the
environment map, and the list of components whose purpose nobody could establish.

## 2. Audit-specific parameters

On top of the ten standard parameters of `report-contract.md` §2.

| Parameter | Meaning | Derivation when unset |
|---|---|---|
| `REPO_LIST` | every repository in the audit | `REPO_PATH` alone. If `gh`/`glab` is authenticated, offer the owner's other repositories (`gh repo list <owner> --limit 200 --json name,pushedAt,isArchived`) and **ask the user** which belong to the project; never widen silently, and record a single-repository run as a limit in *Границы достоверности* |
| `ENV_LIST` | environments to map — A-01 is the sole producer of this list, and A-17 takes it when supplied | the **union** of: `environment:` keys in CI workflows, `gh api repos/{owner}/{repo}/environments`, compose file names, `namespace:` in k8s manifests, `.env.*` and `config/<env>.*` filenames, `terraform { workspaces }` blocks. An empty union yields **one environment named `unknown`**, stated as such in the map — never `production`, because assuming a production environment nobody found is exactly the false confidence the contract exists to prevent |
| `ACCESS_SCOPE` | `code` / `code+ci` / `code+ci+infra` | probe, do not ask first: `code` by default; `code+ci` when `gh auth status` or `glab auth status` succeeds. An infra probe **names its target before reading anything** — `kubectl config current-context`, `aws sts get-caller-identity --query Account --output text`, `gcloud config get-value project` — and the ambient context is very often production, so report those targets and reach `code+ci+infra` only on an explicit user yes plus a read-only answer (`kubectl auth can-i list pods --all-namespaces`, `docker info`). Record every probe, its target and its result |
| `COMPONENT_UNIT` | what counts as one component | a deployable or publishable unit declared by a manifest — a service, a package, a job, a lambda, a site. One repository with one manifest is one component; a monorepo is as many components as it declares |
| `ACTIVITY_WINDOW` | the window that makes a component "active", and the window the author-count metric is defined on | `90 days ago` — a git date expression passed verbatim to `--since`, so changing it moves the metric and the §6 statuses together. It must be shorter than 12 months; a longer value is clamped to 12 months, keeping the §6 rows disjoint, and the clamp is recorded |
| `DEPLOY_EVIDENCE` | what counts as proof a component runs | accepted sources, strongest first: an observed running workload (infra read); a successful deploy job in the last 90 days; an environment or deployment record in the forge; an IaC manifest naming the artefact — the last is `declared`, never `observed` |

All six are optional. With every one unset the audit still runs — one repository, one `unknown`
environment, `code` access, manifest-declared components, a 90-day window, repository-declared
deployment evidence — each recorded as derived, `confidence` at most `medium`.

## 3. Scope

**In scope.** Repositories; services; publishable packages; environments; entry points (binaries,
HTTP servers, CLI commands, lambda handlers); scheduled and background work (cron, timers, queue
workers); build artefacts (images, bundles, wheels, jars); owners; runtime versions and their EOL
status; the mapping between what the repository holds and what a deployment runs.

**Out of scope.**

| Excluded | Covered by |
|---|---|
| Quality and structure of the code inside a component — complexity, duplication, smells, boundaries | A-05, A-04 (history), A-09 (graph) |
| Bus factor 1 — whether one identity owns a module | A-04, whose §6 row files it on one identity above 70% of a module's changed lines over `HISTORY_WINDOW`. A-01 files the knowledge-holder **candidate** of §6 on the author count it collects, and never calls it bus factor 1 |
| Whether a component's dependencies are current, maintained or legally clean | A-03 |
| Pipeline speed, reversibility, environment parity | A-17; A-01 reads CI config only to find artefacts and deploy targets |
| Credentials or misconfiguration noticed while reading manifests | A-14 — file the pointer, do not expand it here |
| Cost of the environments mapped here | A-19 |
| Whether the documentation about a component is true | A-20 |
| Traffic volume and latency of a live component | A-15; traffic appears here only as a yes/no aliveness signal |
| Schemas and data owned by a component | A-10 |
| SaaS subscriptions and vendor contracts with no representation in the repository | **nothing in the programme covers this**; A-12 covers how such a dependency fails, not what is bought |

## 4. Collection protocol

Enumeration is exhaustive; only the deep reading of component sources is sampled (§7). Steps 1–5 are
the source protocol in its order; 6–9 turn its output into the register, the map and the metrics.
**Every command of §5 runs once per entry of `REPO_LIST`**, inside a loop binding `$R` to the repository
path and `$C` to a component path within it and exporting `GH_REPO="$owner/$repo"`; run outside that
loop, each silently answers for whichever repository the shell sits in. Every enumerating command
applies `report-contract.md` §2's canonical exclusion set — `GIT_EXCLUDE` wherever a git pathspec is
accepted, `EXCLUDE_RE` over a path list in hand; **A-01 adds nothing to it**. Cost: minutes of shell
per step at any repository size, except the deep read inside step 7, which carries the reading budget.

1. **Walk the repositories.** For each entry of `REPO_LIST` and each component path in it: primary
   language and language mix, size in lines, last commit date, distinct commit authors in
   `ACTIVITY_WINDOW`. Produces the raw component rows.
2. **Entry points, scheduled work and build artefacts.** Sweep manifests and CI config for what a
   component starts and produces — `bin`/`main`/`scripts`/workspaces in `package.json`,
   `[project.scripts]` in `pyproject.toml`, `package main` in Go, Dockerfile `ENTRYPOINT`/`CMD`/`EXPOSE`,
   compose `services:`, k8s `kind:`, CI build and publish jobs. Then run §5's scheduled-work sweep for
   the work nothing calls — cron files and systemd timers, CI schedule triggers, `kind: CronJob`, cloud
   scheduler resources in IaC, non-`web` `Procfile` process types, and queue consumers (a broker
   client's `subscribe`/`consume` in an entry module). Produces per component an entry-point list, an
   artefact list and a **scheduled/background-work list**, each item with its trigger and its file,
   feeding the `назначение` column and the environment map of §8.
3. **Deployable units, mapped to repositories.** List the units a target actually runs, at the
   strength `ACCESS_SCOPE` allows: infra read, else CI deploy jobs and forge environments, else IaC
   manifests marked `declared`; join each to a component by artefact name, image or path. Produces
   the unit ↔ component table, a `source` column, and an unmatched bucket at each end.
4. **Orphan detection, both directions.** From step 3's two unmatched buckets and from the register as
   a whole. Produces **M6** — register components that no deployment unit maps to, whether or not CI
   builds them, each carrying why the join failed (never built, built and never deployed, no artefact
   name to join on) — **M7**, deployed units mapping to no repository and no buildable source, and
   **M8**, deployed components whose last commit is older than 12 months. M7 and M8 stay separate: §6
   files them at different severities and their remedies differ.
5. **Runtimes and EOL.** Record each component's pinned runtime — `engines`, `.nvmrc`, `.node-version`,
   `requires-python`, the `go` directive, `rust-version`, `FROM` tags, `runtime:` in serverless config,
   CI matrix versions — resolve each to its slug by §5's rule, read the published date. Produces **M5**:
   runtimes past EOL, days left for those approaching it, and those no slug covers, as `гипотеза`.
6. **Owner attribution.** Read `CODEOWNERS` (root, `.github/`, `.gitlab/`, `docs/`), manifest owner
   fields, `OWNERS`/`MAINTAINERS`, team references in README and CI environment protection rules.
   None present means **no declared owner**. Produces **M4**.
7. **Purpose and status.** For **every** component state its purpose in one sentence with its evidence,
   from the cheap read: the README's first paragraph, the manifest `description`, the entry point's
   name, the route table. A component that read leaves unexplained enters the deep-read queue of §7; one
   the budget never reaches goes on the unknown-purpose list rather than being guessed. Assign each a
   status from §6. Produces the `назначение` and `статус` columns over all M1 rows — §9's denominator —
   and that list.
8. **Environment map.** Per entry of `ENV_LIST`: which components and scheduled jobs run there, from
   which artefact, how presence was established (`observed` / `declared`), and for every `observed`
   row the context, account or project and the region it was read from. Produces the map of §8.
9. **Metrics and register.** Compute **M1** component count, **M2**/**M3** the share with no commit in
   6 and 12 months, **M4**, **M5**, **M6**, **M7**, **M8** and the index of §9, then emit the
   `json components` register. Produces every number the findings are measured against, each with its
   command.

## 5. Tools

Each row degrades to its fallback; an absent tool goes to `tools_unavailable`.

| Tool | What it measures | Invocation | Fallback |
|---|---|---|---|
| `git` | last activity, author count, tracked file set | `git -C "$R" log -1 --format='%H %cI' -- "$C" "${GIT_EXCLUDE[@]}"` · `git -C "$R" log --since="$ACTIVITY_WINDOW" --format='%aE' -- "$C" "${GIT_EXCLUDE[@]}" \| sort -u \| wc -l` · `git -C "$R" rev-list --count --since='12 months ago' HEAD -- "$C" "${GIT_EXCLUDE[@]}"` | none — git is the floor of this audit; without it take the population from the filesystem (`find "$R" -name 'package.json' \| grep -Ev "$EXCLUDE_RE"`) and set `confidence: low` |
| `tokei` / `cloc` | size and language mix per component | over the pathspec-filtered file list, never the directory — neither tool excludes a committed `dist/`, and size in lines is a §7 ranking key: `git -C "$R" ls-files -z -- "$C" "${GIT_EXCLUDE[@]}" \| xargs -0 -r tokei` · `git -C "$R" ls-files -z -- "$C" "${GIT_EXCLUDE[@]}" \| xargs -0 -r cloc --quiet` | size: `git -C "$R" ls-files -z -- "$C" "${GIT_EXCLUDE[@]}" \| xargs -0 cat 2>/dev/null \| wc -l`; mix: `git -C "$R" ls-files -- "$C" "${GIT_EXCLUDE[@]}" \| sed -n 's/.*\.\([A-Za-z0-9]*\)$/\1/p' \| sort \| uniq -c \| sort -rn` |
| manifest sweep | the component population | `git -C "$R" ls-files -- . "${GIT_EXCLUDE[@]}" \| grep -Ei '(^\|/)(package\.json\|pyproject\.toml\|go\.mod\|Cargo\.toml\|pom\.xml\|build\.gradle(\.kts)?\|Gemfile\|composer\.json\|[^/]+\.csproj)$'` | `find "$R" -name '<manifest>' \| grep -Ev "$EXCLUDE_RE"` per manifest kind |
| `jq` | manifest fields without hand-parsing | `jq -r '.name, (.bin // {} \| if type == "object" then keys[] else . end), (.scripts // {} \| keys[]?), (.engines // {} \| to_entries[] \| "\(.key) \(.value)")' "$R/$C/package.json"` — the `if` is load-bearing: npm allows a **string** `bin`, on which a bare `keys` aborts the expression before `.engines`, the input step 5 needs | `grep -nE '"(name\|bin\|main\|scripts\|workspaces\|engines)"' "$R/$C/package.json"` |
| `yq` | compose and k8s structure | `yq '.services \| keys' "$R/docker-compose.yml"` | `grep -nE '^[[:space:]]{2}[a-z0-9_-]+:\|image:' "$R/docker-compose.yml"` |
| Dockerfile / compose / k8s read | artefacts and entry points | `git -C "$R" grep -HE '^(FROM\|ENTRYPOINT\|CMD\|EXPOSE) ' -- '*Dockerfile*' "${GIT_EXCLUDE[@]}"` · `git -C "$R" grep -lE '^kind:[[:space:]]*(Deployment\|StatefulSet\|DaemonSet\|CronJob\|Job)' -- '*.yaml' '*.yml' "${GIT_EXCLUDE[@]}"` — `-H`, never `-h`: the filename is what joins a line back to its component | none needed — plain-text reads |
| scheduled-work sweep | cron files, timers, CI schedules, cloud schedulers, worker processes | `git -C "$R" ls-files -- . "${GIT_EXCLUDE[@]}" \| grep -Ei '(^\|/)(crontab\|.*\.cron\|cron\.d/.*\|.*\.timer\|Procfile)$'` · `git -C "$R" grep -HnE '^[[:space:]]*(schedule\|cron):\|CI_PIPELINE_SOURCE == "schedule"\|aws_cloudwatch_event_rule\|google_cloud_scheduler_job' -- '*.yml' '*.yaml' '*.tf' "${GIT_EXCLUDE[@]}"` · queue consumers: `git -C "$R" grep -HnE '\.(subscribe\|consume\|basic_consume\|basicConsume)\(\|@(Kafka\|Rabbit\|Jms)Listener' -- . "${GIT_EXCLUDE[@]}"`, kept only where the hit sits in an entry module of step 2 — a bare `.subscribe(` is as often an observable | read the CI, IaC, `Procfile` and entry-module files the manifest and CI sweeps already listed, by hand |
| CI config read | build/publish/deploy jobs, environments, runtime matrices | `git -C "$R" ls-files -- . "${GIT_EXCLUDE[@]}" \| grep -Ei '^(\.github/workflows/\|\.gitlab-ci\.yml$\|\.circleci/\|Jenkinsfile$\|azure-pipelines\.yml$\|\.drone\.yml$\|bitbucket-pipelines\.yml$)'`, then read each file | none needed |
| `gh` / `glab` | forge environments and deployment records (`code+ci`) | with `GH_REPO="$owner/$repo"` exported per entry of `REPO_LIST`, so the placeholders resolve to that repository and not to the current directory: `gh api repos/{owner}/{repo}/environments --jq '.environments[].name'` · `gh api repos/{owner}/{repo}/deployments --jq '.[].environment' \| sort \| uniq -c` | CI workflow `environment:` keys, marked `declared` |
| `kubectl` | running workloads (`code+ci+infra`, only against the context §2 named and the user approved) | `kubectl get deploy,sts,ds,cronjob -A -o wide` · `kubectl get pods -A -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' \| sort -u`, every row recorded with the `kubectl config current-context` it came from | k8s manifests in the repository, marked `declared` |
| `docker` | locally running units | `docker ps --format '{{.Image}} {{.Names}}'` | compose files, marked `declared` |
| `aws` / `gcloud` | managed units (`code+ci+infra`, under the same approval) | `aws lambda list-functions --query 'Functions[].FunctionName' --output text` · `aws ecs list-clusters --output text` · `gcloud run services list --format='value(metadata.name)'`, every row recorded with its account or project and region | IaC text: `grep -REn '^resource "' --include='*.tf' "$R" \| grep -Ev "$EXCLUDE_RE"`, marked `declared` |
| EOL calendar | runtime support status | resolve the slug first — `curl -s https://endoflife.date/api/all.json \| jq -r '.[]' \| grep -i <runtime>` — then `curl -s https://endoflife.date/api/<slug>.json \| jq -r '.[] \| "\(.cycle) \(.eol)"'`. Slugs for the runtimes step 5 collects: `nodejs`, `python`, `go`, `rust`, `ruby`, `php`, `dotnet`, `debian`, `alpine-linux` (not `alpine`); a JVM resolves per vendor (`eclipse-temurin`, `amazon-corretto`, `oracle-jdk`, …), never `java`. Only the product name leaves the machine | a runtime the catalogue has no slug for: the vendor's release page read by the user, or the claim stated as `гипотеза` with that lookup as its confirming check; never a date from memory |

## 6. Analysis rules and thresholds

**Status vocabulary**, exactly one per component in the `статус` column, disjoint at any
`ACTIVITY_WINDOW`: `активен` — a commit inside `ACTIVITY_WINDOW` plus a deployment signal;
`поддерживается` — deployed, last commit outside `ACTIVITY_WINDOW` but within 12 months; `заморожен`
— deployed, last commit older than 12 months; `выведен` — an explicit retirement signal (archived
repository, removal from every environment); `требует подтверждения у команды` — everything else, in
particular any component with no deployment signal either way.

**Aliveness is never inferred from a date.** A component leaves `требует подтверждения у команды` only
on a `DEPLOY_EVIDENCE` signal: absent commits are not death, absent deployment evidence is absent
access. **At `ACCESS_SCOPE = code`** M6, M7 and M8 are unmeasurable — `null` with the reason, never
`0`, and `confidence` capped at `medium`.

| Condition | Threshold | Severity | Origin |
|---|---|---|---|
| Deployed unit mapping to no repository and no buildable source (**M7**) | ≥ 1 unit | S1 each | requirements |
| Runtime version past its published EOL date | ≥ 1 day past | S1 | requirements |
| Runtime version approaching its published EOL date | ≤ 180 days left | S3 | derived |
| Component deployed with no commit for over 12 months (**M8**, `заморожен`) | > 12 months | S2 | requirements |
| Component with no declared owner | 0 owner declarations | S2 deployed, S3 otherwise | requirements |
| Register component that no deployment unit maps to (**M6**) | ≥ 1 component | S3; S2 when CI still builds and deploys it on every merge | derived |
| Component whose purpose was not established | ≥ 1 component on the unknown-purpose list | S3; S2 when it is deployed | derived |
| Share of components with no commit in 6 / 12 months | > 25% of M1 | S3 / S2, one aggregate finding each | derived |
| Deployed component with one distinct commit author in `ACTIVITY_WINDOW`, or none — a **knowledge-holder candidate**, handed to A-04 to confirm against its bus-factor row and never called bus factor 1 here | 1 / 0 authors in `ACTIVITY_WINDOW` | S3 | derived |
| Transparency index (§9) | < 0.50 / 0.50–0.79; ≥ 0.80 files no finding | S2 / S3 | derived |

A `requirements` row may not be re-severitised to settle a disagreement with a neighbouring audit; a
`derived` row may. `report-contract.md` §5's position rule applies on top of it, never as a second row.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

- **Sampling unit:** the component, as `COMPONENT_UNIT` defines it; `coverage` counts components.
- **Enumeration and the cheap purpose pass are not sampled.** Steps 1–5 and step 7's one-line purpose
  and status read cover every component at every `DEPTH` — a manifest field and a README line each.
  `N` and `C` bound the **deep read alone**: opening sources to settle a purpose the cheap read left
  open and to confirm entry points against code. §9's three columns therefore cover all M1
  components, unextrapolated.
- **Top-`N` ranking:** production-deployed first; then artefact reach (a published package or a public
  endpoint over an internal job); then size in lines; ties by commits in the last 12 months.
- **Control sample `C`** is drawn from components with no deployment signal — the population most
  likely to hide both a mislabelled orphan and a live component the deploy view missed.
- **Audit-specific early stop:** the contract's control-sample stop, additionally requiring that a
  full `git ls-files` pass over every entry of `REPO_LIST` add no manifest kind the register lacks.

## 8. Report additions

| Addition | Goes in | Shape |
|---|---|---|
| Таблица компонентов (component table) | §7 *Приложения* | one row per component: `имя`, `назначение` (including the scheduled work it owns), `стек`, `статус`, `владелец`, `последняя активность`, plus `окружения` and `источник` (`observed` / `declared`). Sorted by status, `требует подтверждения у команды` first |
| Карта окружений (environment map) | §7 *Приложения* | one block per entry of `ENV_LIST`: the environment, its components and their scheduled jobs, the artefact each runs, how presence was established, and for every `observed` row the context, account or project and region it was read from |
| Список «неизвестного назначения» (unknown-purpose list) | §5 *Детальные находки* | attached to the aggregate finding it produces: the component, what was read while trying to establish its purpose, and the one question the team must answer |
| Component register | §7 *Приложения* | one fenced ` ```json components ` block, an array of `{"name", "path", "repo", "kind", "stack", "status", "owner", "last_commit", "environments", "purpose_known"}` — what a later audit copies `SCOPE_INCLUDE` out of. An appendix block: it never stands in for the register of `report-contract.md` §6 |

## 9. Score

**Индекс прозрачности** (transparency index), a ratio in `0.00–1.00` to two decimals, reported with
both counts:

```
TI = |{ components with a purpose AND a declared owner AND a status other than
        `требует подтверждения у команды` }| / M1
```

Numerator and denominator range over the same population: step 6 attributes the owner and step 7 the
purpose and status, both over every component, so the index measures the project, not the sample.
Report the three per-attribute shares and name which term drags the index down, the count behind it,
and what would raise it. A `code`-scope run scores low on the status term by construction.

## 10. Failure modes of this audit

1. **Absent evidence read as fact.** A stable library legitimately sits unchanged for eighteen months,
   and at `ACCESS_SCOPE = code` "not in deploy" means "not visible", so a `0` in M6–M8 is fabricated.
   *Countermeasure:* leaving `требует подтверждения у команды` needs a `DEPLOY_EVIDENCE` signal, else
   the claim is `гипотеза` naming its check — a deploy record, a traffic sample — plus §6's `null` rule.
2. **An IaC file read as reality.** A manifest states intent; the cluster may run something else, or
   nothing. *Countermeasure:* the `источник` column, `declared` for anything not observed, and
   `вероятно` confidence on every finding resting on a declared row.
3. **Vendored and generated trees counted as components.** They inflate M1 and drag the index down
   without one real finding. *Countermeasure:* `report-contract.md` §2's exclusion set, never a variant.
4. **The wrong unit.** A monorepo counted as one component hides everything inside it; a polyrepo
   counted per directory double-counts. *Countermeasure:* name `COMPONENT_UNIT` and the manifest behind
   each row before any metric.
5. **A frequent committer promoted to owner.** Concentration answers "who knows this", not "who is
   accountable". *Countermeasure:* fill the owner column only from a declaration; concentration yields
   the knowledge-holder candidate of §6, which A-04 confirms or drops.
6. **EOL dates from memory, or from a guessed slug.** A wrong date invents or hides an S1, and `alpine`
   or `java` returns nothing. *Countermeasure:* every EOL claim carries its slug lookup, query and date.

## 11. Audit-specific prohibitions

- **No mutating infrastructure verbs**: `get`, `describe`, `list`, `ps`, `auth can-i` only. Never
  `kubectl apply|delete|scale|rollout`, `docker run` / `compose up`, `aws … create|update|delete`,
  `terraform init|plan|apply`. Read the manifests statically and mark the rows `declared`.
- **Never read a cluster, account or project the user has not named.** The verb list constrains what
  you run, not where, and the ambient kube-context or cloud profile is very often production. Name the
  target per §2, get an explicit yes, and record it and the region beside every `observed` row.
- **No dependency resolution to find entry points**: no `npm install`/`npm ci`, `pip install`,
  `bundle install`, `go list ./...`, `mvn dependency:tree` — each writes a cache or a lockfile and some
  reach the network. Read manifests and lockfiles as text.
- **Never clone a repository of `REPO_LIST` into the audited tree.** Clone into a temporary directory
  outside every `REPO_PATH`, or read its metadata from the forge API; record which.
- **The only outbound request this audit may make is a runtime EOL lookup by product name.**
  Repository names, environment names, image tags and component names do not leave the machine.
- **Never print a value read out of a compose file, k8s manifest, `.env*` file or CI variable block.**
  Record the key and its file; a value that looks like a credential is a pointer filed for A-14.

## 12. Dependencies

**Input:** none. A-01 is the entry point of the programme and runs with no prerequisite report.

**Output:** the component register of §8 and the `SCOPE_INCLUDE` / `SCOPE_EXCLUDE` values derived from
it, which every later audit receives as a parameter value — a path to this report, or the values copied
out of it. Twelve audits name A-01 in their "Needs on input" cell of `audit-index.md`, the authoritative
direction of that relation: A-02, A-03, A-04, A-06, A-08, A-09, A-10, A-11, A-12, A-16, A-17, A-19.
Three products travel beside the register: the runtime/EOL table to A-03, the environment map to A-16,
A-17 and A-19, the knowledge-holder candidates to A-04, which owns the bus-factor call A-01 nominates.

## 13. Nearest marvin command

None: `audit-index.md` has no A-01 row in its marvin-command table, and no marvin command inventories
the audited project's components. The nearest two are neighbours, not overlaps: `/marvin:dashboard`
reports **marvin's own** `.marvin/` artefacts, `/marvin:onboard` introduces marvin rather than
enumerating the project. Either output is evidence to verify against §5, never a section to paste.
