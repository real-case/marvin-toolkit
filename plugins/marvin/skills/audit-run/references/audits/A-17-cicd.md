# A-17 — CI/CD и конвейер поставки

> **Audit question.** How fast, how predictably and how reversibly does a change reach production?

## 1. Role and task

You audit the delivery pipeline **as it ran** — from CI configuration and the platform's own run history, never from the release runbook. One question
closes: the measured duration, the measured failure profile and the demonstrated reversibility of the path from a merged commit to production. A run
leaves three artefacts in *Приложения*: the stage table with durations (A1), the environment divergence table (A2), the dated rollback procedure (A3).

## 2. Audit-specific parameters

On top of the ten standard parameters of `report-contract.md` §2. With every one unset the audit runs in **config-only mode** over the repository's CI files, naming in *Границы достоверности* the halves of steps 1, 2, 5 and 6 that went unmeasured.

| Parameter | Meaning | Derivation when unset |
|---|---|---|
| `CI_PLATFORM` | the CI/CD system(s) in use | detected in the tree: `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, `.circleci/config.yml`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`, `.drone.yml`, `.buildkite/`. Several → audit each, and let the one reaching production set the headline numbers. None → that absence is the audit's first finding |
| `PIPELINE_HISTORY_ACCESS` | authenticated read access to the run-history API | probe `gh auth status`, then `glab auth status`; the first success names the platform. Both fail → **config-only mode**: step 2 is declared not measured, never estimated, and `confidence` is capped at `medium` |
| `ENV_LIST` | the deployment environments and their order | **A-01's environment map, when it was supplied** — the map is A-01's product and this audit is one of its consumers. Unsupplied, run A-01's own derivation unchanged: the **union** of `environment:` keys in CI workflows, `gh api "repos/{owner}/{repo}/environments" --jq '.environments[].name'`, compose file names, `namespace:` in k8s manifests, `.env.*` and `config/<env>.*` filenames, and `terraform { workspaces }` blocks. An empty union yields **one environment named `unknown`**, never `production`: assuming a production environment nobody found is the false confidence the contract exists to prevent. A derived list caps `confidence` at `medium` |
| `DEPLOY_FREQUENCY` | the cadence the team **believes** it has | **ask the user once**: how often does the team believe it deploys to production? Not derivable — the parameter is a belief, and deriving it would compare §9's measurement to itself. No answer → the declared-versus-measured comparison does not run, the §6 divergence row does not fire, and *Границы достоверности* records the unanswered ask |
| `PERIOD` | observation window for run statistics | last 90 days. Under 30 runs on the production path → widen to 180, then 365, stopping at the first window reaching 30; record the window used. Still under 30 at 365 → run anyway, cap `confidence` at `medium` |
| `IAC_PLAN_ACCESS` | permission and credentials for a read-only plan | **default no.** Ask the user once, naming the exact command of §5. No answer → step 8 is static-only and drift is reported *not measured*, never *absent* |
| `RUNTIME_ACCESS` | read credentials for the orchestrator or cloud API | **default no.** Same ask-once rule. Absent → deploy strategy and release history come from manifests, and the claim covers what is *declared* |
| `A07_REPORT` | path to the finished A-07 report, or its values | absent: the audit records which gates run, not whether they are worth running, and says so |
| `A08_REPORT` | path to the finished A-08 report, or its appendices A2/A3 | absent: step 1 rebuilds the required-check list from branch protection, and §9's lead time is measured from git |

## 3. Scope

**In scope.** Build; the checks the pipeline runs and which of them block; artefact production, identity and promotion; deployment to each environment in `ENV_LIST`; rollback; configuration, data and version parity; the infrastructure-as-code describing them. Migration bodies, which `report-contract.md` §2 excludes by default, are deliberately kept in for step 6's reversibility judgement.

**Out of scope.**

- **What the tests cover and whether they are worth running** → **A-07**. **Everything before the pipeline starts** — branching model, PR size and
  lifetime, review, routes reaching the mainline past a required check → **A-08**, which hands its bypass table here as input.
- **Supply-chain risk inside the pipeline** — action provenance, token permissions, secret handling, runner isolation → **A-14** and `/marvin:sec-ci`; a
  mutable action reference found in §4.3 is filed here as a determinism defect and cross-referenced there.
- **Runtime performance** → **A-15**. **Deploys and incidents in telemetry** → **A-16**. **Backup, restore, RTO/RPO** → **A-18**. **Pipeline and
  environment cost** → **A-19**. **Currency and licensing of what the build installs** → **A-03**. **Schema design and migration content** → **A-10**,
  §4.6 judging only whether a migration deployed in `PERIOD` can be reversed on the rollback path. **Truth of the release documentation** → **A-20**; a
  runbook is read here as a claim to check against history, never as a document to assess.

## 4. Collection protocol

Resolve `PERIOD` into `$P` days, the window start into `$SINCE` (`date -v-"$P"d +%F` on BSD, `date -d "$P days ago" +%F` on GNU) and the production
branch into `$M` (`git symbolic-ref --short refs/remotes/origin/HEAD`, else the first of `origin/main`, `origin/master`, `origin/dev` that `git
rev-parse --verify` resolves). Scratch files go in a `$TMP` directory **outside** the audited repository. Repo-wide scans carry `report-contract.md`
§2's `RG_EXCLUDE` / `GIT_EXCLUDE`; this audit adds none and reverses one (§3), saying so in *Методология*. §5 carries every invocation in full.

1. **Pipeline map — stages, order, parallelism, blocking.** §5's configuration enumeration lists the files and its job-graph scan (`needs:`, `if:`,
   `continue-on-error`, `timeout-minutes`) reads the dependencies; the mandatory-check list comes from `A08_REPORT` appendix A3 or §5's branch-protection
   row. **Produces:** the stage table — stage, trigger, jobs, dependencies, blocking yes/no, declared `timeout-minutes` — and appendix A1's node set, each
   node naming the jobs whose timings will label it in step 2. Nothing collected here is a duration. **Cost:** two local passes, no network.
2. **Run statistics over `PERIOD`.** Two populations, kept apart. Over **100% of `PERIOD`**: one row per run from §5's `actions/runs` invocation into
   `$TMP/runs.tsv`, which subtracts the timestamps at the source — `((.updated_at|fromdateiso8601)-(.created_at|fromdateiso8601))` is column 1, in
   seconds and at no extra request; raw ISO strings would all sort as 0. §5's window-and-segment row filters that file on column 5 and **splits it
   before anything is averaged** (§10.6): `$TMP/d` holds the production path's durations — column 6 the short `$M`, column 2 a workflow step 1's graph
   shows reaching a deploy job — and is the population every §6 duration row reads, while `$TMP/d.<workflow>` is one file per column-2 value; its
   median and p90 `awk` runs once per duration file, seconds reported as minutes. The two shares are counted from columns 3 and 4 over the window file,
   never over `$TMP/d`. Over **the top `N` and the `C` controls of §7 only**: the exact `timing` duration, per-job timings from
   `gh run view <id> --json jobs`, and `gh run view <id> --log-failed`, each failure classified `code`, `infrastructure`, `flake` or `unknown` under
   §10.4's evidence rule. **Produces:** from the window — median and p90 run duration per workflow and for the production path, the failed-run share,
   the retried-run share (`run_attempt > 1`); from the sample — the **per-stage median and p90** that label appendix A1's nodes, job timings summed into
   the stage each job belongs to in step 1's graph, and the failure-cause breakdown, `unknown` bucket shown. Every number carries its N, population and
   command. **Cost:** one paginated listing, then at most three calls per sampled run — `N + C` runs, never the population.
3. **Determinism — pinning, reproducibility, cache.** Three kinds of unpinned reference are counted: §5's `uses:` scan where the ref is not 40 hex
   characters; a `runs-on`, `image:` or `FROM` tag with no `@sha256:`; a missing toolchain file (§5's toolchain listing). A resolver invoked without
   `--frozen-lockfile`, `--immutable`, `--locked`, `--deployment` or the `ci` form resolves afresh every run; a cache key with no `hashFiles(` over the
   lockfile, or `restore-keys` broad enough to return a cache built from other inputs, is a wrong-cache candidate. Reproducibility is judged from that
   configuration plus history — where two runs share a `head_sha`, compare their recorded artefact digests — never by building anything (§11).
   **Produces:** the unpinned-reference inventory by kind, the install-determinism verdict per job, the cache-key table with its inputs. **Cost:** local
   greps, plus one digest comparison per shared `head_sha`.
4. **Artefact identity — built once and promoted, or rebuilt per environment.** Count build invocations across deploy jobs and trace what each deploy
   consumes, checking whether it names an immutable `@sha256:` digest (§5's build-invocation and image scans); under `RUNTIME_ACCESS`, confirm what
   actually runs with §5's `kubectl get deploy`. **Produces:** the promotion table — artefact, building stage, consuming environments, identity (immutable
   digest / mutable tag / rebuilt) — and the count of environments served by a rebuild. **Cost:** local greps, one `kubectl get` per cluster.
5. **Deployment — strategy, duration, automation, manual steps.** Read the strategy from the manifests with §5's strategy scan and, under
   `RUNTIME_ACCESS`, from `helm history`. Enumerate every human gate — environment protection rules through §5's environments invocation, its
   manual-trigger scan, and runbook steps through its runbook grep — counting a runbook step only where the pipeline does not do it. Deploy duration comes
   from step 2's sampled per-job timings and is labelled sample-derived. **Produces:** per environment — strategy, median deploy-job duration, trigger
   (automatic / dispatch / approval) — and the manual steps on the **production** path with their evidence. **Cost:** one environments call; step 2 already paid for the timings.
6. **Rollback — mechanism, time, whether it was ever really done, and migration reversibility.** Find the mechanism with §5's rollback grep, then the
   **fact** of its application, the only thing that counts (§10.1): a revert on the mainline (§5's `--grep='^Revert'` log) or a deployment whose `sha` is
   an ancestor of an earlier **successful** deployment to the same environment (`git merge-base --is-ancestor <new> <old>` over §5's deployments listing,
   success read from each deployment's statuses subresource — the listing itself carries no state, §9). Time that instance from the two statuses'
   `created_at`; with none, take the deploy-job median, label it an upper bound, and leave the rollback **unverified**. Then count migrations merged in
   `PERIOD` with no down path and flag destructive DDL among them (§5's DDL scan). **Produces:** appendix A3 — the procedure, its time in minutes and
   which kind of number that is, the date of the last real application or *никогда*, and the migrations that block a rollback. **Cost:** one deployments
   listing plus one statuses call per production-path deployment — the audit's largest request budget, reported in *Методология* with its count.
7. **Environment parity.** Extract the configuration key set per environment into `$TMP/<env>.keys` from the sources the deploy actually reads —
   `values-<env>.yaml`, `k8s/overlays/<env>/`, `<env>.tfvars`, `.env.<env>`, and CI variable **names** only through §5's name-only invocation (§11 says
   why the bare form is forbidden) — then compare them pairwise with §5's `sort` and `comm -3`. Version divergence comes from step 4's image identities
   plus the runtime pinned in each environment's manifests; data divergence is read from configuration alone — anonymisation and seeding jobs, declared
   dataset sizes — never from data. **Produces:** appendix A2, one row per environment pair: keys only on each side, runtime version delta, image identity
   delta, data-shape statement, source file per column. **Cost:** local reads plus one variable listing per environment.
8. **Infrastructure as code, and drift.** Inventory the modules and count declared resources with §5's IaC listing and its `^resource "` count; coverage
   is the share of `ENV_LIST` environments having a module or workspace. Hand-made change leaves traces: an environment with no module, manual-creation
   notes in runbooks (§5's manual-change grep), a committed `terraform.tfstate` recorded as present and never printed. Under `IAC_PLAN_ACCESS` only, run
   §5's read-only plan on a copy outside the repository (§11 says why the copy is mandatory). **Produces:** IaC coverage as a percentage of `ENV_LIST`,
   the resources the plan reports as changed, and the manual-change list with its evidence — or an explicit *not measured* where no plan ran, and equally
   where the only available reading is a stale or never-taken drift status (§5's CloudFormation row). **Cost:** a local inventory; under
   `IAC_PLAN_ACCESS`, one `init` and one `plan` against the provider and the state backend, minutes rather than seconds.

## 5. Tools

| Tool | What it measures | Invocation | Fallback when absent |
|---|---|---|---|
| CI configuration files | stages, order, gates, triggers, timeouts, cache keys, pinning | enumeration: `git ls-files -- .github/workflows .gitlab-ci.yml Jenkinsfile .circleci/config.yml azure-pipelines.yml bitbucket-pipelines.yml .drone.yml .buildkite`; job graph: `rg -n -e 'needs:' -e '^\s*if:' -e 'continue-on-error' -e 'timeout-minutes' .github/workflows`; branch protection: `gh api "repos/{owner}/{repo}/branches/${M#origin/}/protection" --jq '.required_status_checks.contexts[]'` | none needed — these are files in the repository. On an unrecognised platform, `git grep -n -E 'stages?:\|jobs:\|pipeline' -- '*.yml' '*.yaml' "${GIT_EXCLUDE[@]}"`; branch protection, when unreadable, is taken from `A08_REPORT` appendix A3 |
| GitHub run-history API via `gh` | durations, conclusions, attempts, deployments **and their state**, environments, job logs | `gh api --paginate "repos/{owner}/{repo}/actions/runs?per_page=100" --jq '.workflow_runs[] \| [((.updated_at\|fromdateiso8601)-(.created_at\|fromdateiso8601)),.name,.conclusion,.run_attempt,.created_at,.head_branch,.head_sha,.id,.event] \| @tsv' > "$TMP/runs.tsv"` — **the column order §4.2 reads**, duration first and in seconds; `gh api "repos/{owner}/{repo}/actions/runs/<id>/timing" --jq '.run_duration_ms'`; `gh run view <id> --json jobs --jq '.jobs[] \| [.name,.conclusion,.startedAt,.completedAt] \| @tsv'`; `gh run view <id> --log-failed`; `gh api --paginate "repos/{owner}/{repo}/deployments?per_page=100"`; **and, for every deployment whose outcome or finish time is used**, `gh api --paginate "repos/{owner}/{repo}/deployments/<id>/statuses?per_page=100" --jq '.[] \| [.state,.created_at] \| @tsv'` — the deployment object carries neither state nor completion time; `gh api "repos/{owner}/{repo}/environments"`; `gh variable list --json name --jq '.[].name'`, and `gh variable list --env <env> --json name --jq '.[].name'` per environment — name-only by construction, §11 | the three rows below; failing all of them, **config-only mode** with step 2 declared not measured |
| GitLab API via `glab` | the same on GitLab | `glab api --paginate "projects/:id/pipelines?per_page=100"`, then `glab api "projects/:id/pipelines/<id>"` for `duration`; `glab api "projects/:id/deployments?per_page=100"`, whose rows carry `status` and `updated_at` directly; logs via `glab api "projects/:id/jobs/<id>/trace"` | config-only mode |
| Any other platform's REST API | run history on Jenkins, CircleCI, Bitbucket, Azure DevOps, Buildkite | **GET only**: `curl -sS -H "Authorization: Bearer $TOKEN" "<api-base>/…"`; Jenkins: `curl -g -sS "$JENKINS_URL/job/$JOB/api/json?tree=builds[number,result,duration,timestamp]"` — `-g` is mandatory: curl otherwise reads `[…]` as a globbing range and aborts with `bad range in URL` before any request is issued | config-only mode |
| `git` | production branch, revert history, migration ages, toolchain files, runbook claims, the ancestry test | reverts: `git log --first-parent "$M" --since="$SINCE" --grep='^Revert' --format='%h %cI %s'`; ancestry: `git merge-base --is-ancestor <a> <b>`; toolchain: `git ls-files -- .nvmrc .tool-versions .python-version rust-toolchain.toml go.mod`; IaC: `git ls-files -- '*.tf' '*.tfvars' '*.bicep' 'Pulumi.yaml' 'charts/**' 'playbooks/**' 'kustomization.yaml' "${GIT_EXCLUDE[@]}"`; runbook steps: `git grep -n -i -E 'manually\|by hand\|вручную\|release checklist' -- '*.md' "${GIT_EXCLUDE[@]}"`; rollback: `git grep -n -i -E 'rollback\|rollout undo\|helm rollback\|argocd app rollback\|previous.?version' -- '*.yml' '*.yaml' '*.sh' '*.md' "${GIT_EXCLUDE[@]}"`; manual change: `git grep -n -i -E 'console\.aws\|portal\.azure\|created manually\|создан вручную' -- '*.md' "${GIT_EXCLUDE[@]}"` | this audit's floor; always present |
| `rg` (ripgrep) | pinning, cache keys, manual gates, strategies, image references, build invocations, destructive DDL | `rg -n 'uses:\s*\S+@\S+' .github/workflows`; `rg -n -A 6 -e 'actions/cache' -e '^\s*cache:' .github/workflows .gitlab-ci.yml`; builds: `rg -n -e 'docker build' -e 'buildx build' -e 'ko build' -e 'jib' -e 'upload-artifact' .github/workflows .gitlab-ci.yml`; images: `rg "${RG_EXCLUDE[@]}" -n 'image:\s*\S+' -g '*.yaml' -g '*.tf'`, and the contract's array likewise on every other repo-wide scan below; strategy: `rg -n -e 'strategy:' -e 'RollingUpdate\|Recreate\|canary\|blue.?green\|Rollout' -g '*.yaml' -g '*.tf'`; manual triggers: `rg -n -e 'workflow_dispatch' -e 'when:\s*manual' .github/workflows .gitlab-ci.yml`; DDL: `rg -n -i -e 'DROP (TABLE\|COLUMN)' -e 'ALTER .*(DROP\|RENAME)' <migration dir>`; resources: `rg -c '^resource "' -g '*.tf'` | `git grep -n -E '…'` with the same patterns in POSIX ERE |
| `jq` | reducing platform JSON to columns | the same reduction offline when the client has no `--jq`, over the listing saved raw (`gh api --paginate "repos/{owner}/{repo}/actions/runs?per_page=100" > "$TMP/runs.json"`): `jq -r '.workflow_runs[] \| [((.updated_at\|fromdateiso8601)-(.created_at\|fromdateiso8601)),.name,.conclusion,.run_attempt,.created_at,.head_branch,.head_sha,.id,.event] \| @tsv' "$TMP/runs.json" > "$TMP/runs.tsv"` — **all nine columns, in the GitHub row's order**: a shorter projection has no column 5, and §4.2's window filter then cannot run at all | `gh --jq` and `glab api` reduce in-process; otherwise `python3 -c "import json,sys;…"` |
| `sort`, `awk`, `comm`, `wc` | window filtering, segmentation, medians, p90, shares, key-set differences | window: `awk -F'\t' -v s="$SINCE" '$5 >= s' "$TMP/runs.tsv" > "$TMP/w"` (column 5 is `created_at`; ISO-8601 compares lexicographically against a `+%F` date); production path: `awk -F'\t' -v b="${M#origin/}" -v d="$DEPLOY_WF" 'BEGIN{n=split(d,x,",");for(i=1;i<=n;i++)w[x[i]]=1} $6==b&&(!n\|\|($2 in w)){print $1}' "$TMP/w" > "$TMP/d"`, where `$DEPLOY_WF` is the comma-separated names of the workflows step 1's graph shows reaching a deploy job, an empty one degrading to every run on `$M` and saying so in *Границы достоверности*; per workflow: `awk -F'\t' -v t="$TMP" '{f=$2; gsub(/[^[:alnum:]]/,"_",f); print $1 > (t "/d." f)}' "$TMP/w"`; median, once per duration file: `sort -n <file> \| awk '{a[NR]=$1} END{if(NR%2) print a[(NR+1)/2]; else print (a[NR/2]+a[NR/2+1])/2}'`, p90 from the same sorted file at `int(0.9*NR)+1`; shares: `awk -F'\t' '$3~/^(failure\|timed_out\|startup_failure)$/{f++} END{print 100*f/NR}' "$TMP/w"` and `awk -F'\t' '$4>1{r++} END{print 100*r/NR}' "$TMP/w"`; key sets: `sort "$TMP/production.keys" > "$TMP/a"; sort "$TMP/staging.keys" > "$TMP/b"; comm -3 "$TMP/a" "$TMP/b"` | POSIX; always present |
| `terraform plan`, read-only | drift between code and reality | only under `IAC_PLAN_ACCESS`, on a copy outside the repo: `cp -R <iac dir> "$TMP/iac" && TF_DATA_DIR="$TMP/tfdata" terraform -chdir="$TMP/iac" init -input=false -no-color && TF_DATA_DIR="$TMP/tfdata" terraform -chdir="$TMP/iac" plan -refresh-only -lock=false -input=false -no-color` | `tofu plan` with the same flags; `pulumi preview --diff --non-interactive`; `aws cloudformation describe-stacks --query 'Stacks[].{name:StackName,drift:DriftInformation.StackDriftStatus,checked:DriftInformation.LastCheckTimestamp}'` — **the last recorded status, not a measurement**: only `DRIFTED` and `IN_SYNC` count as one, `NOT_CHECKED` and `UNKNOWN` are drift *not measured*, `LastCheckTimestamp` is reported so a stale check is visible, and `detect-stack-drift` is never run (§11). IaC in a repository outside `REPO_PATH`, or none of the four commands → drift *not measured*, recorded in *Границы достоверности* |
| `kubectl`, `helm`, read-only verbs | what is really deployed, and the release history | `kubectl get deploy -A -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.containers[*].image}{"\n"}{end}'`; `helm history <release> -n <ns> -o json` | the manifests and IaC in the repository; the claim then covers what is *declared*, and says so |

## 6. Analysis rules and thresholds

Every **run-duration** row below reads the 100% column of §7 — `$TMP/d`, the production path of §4.2 — never the sampled one. The rollback row is
the exception: its number is the last real rollback's wall clock (§4.6) or, with none, the sampled deploy-job median labelled an upper bound.

| Condition | Threshold | Severity | Origin |
|---|---|---|---|
| Median duration of a run on the production path | > 15 min | S2 | requirements |
| Median duration of a run on the production path | > 40 min | S1 | derived |
| Share of failed runs whose cause is not the code (infrastructure, flake) | > 10% | S2 | requirements |
| Share of failed runs whose cause is not the code (infrastructure, flake) | > 25% | S1 | derived |
| Rollback of a production release cannot be completed within | 15 min | S1 | requirements |
| Manual steps on the production deploy path | ≥ 1 | S2 | requirements |
| Rollback with no dated evidence of a real application | 0 applications | S1 | requirements |
| Rollback last really applied | > 180 days ago | S2 | derived |
| Migration deployed in `PERIOD` with no down path, on the rollback path | ≥ 1 | S1 | derived |
| Deploy job not gated on the check jobs, so a failing gate cannot stop a release | ≥ 1 path | S1 | derived |
| Environments served by a rebuild rather than a promoted artefact | ≥ 1 | S2 | derived |
| Mutable references on the production path (`@main`, `:latest`, a tag with no digest) | ≥ 1 | S2 | derived |
| Dependency install without a frozen resolver, or a cache key omitting the lockfile hash | ≥ 1 job | S2 | derived |
| Change failure rate (§9) | > 15% | S2 | derived |
| Config keys, or a runtime major version, differing between production and the environment gating it | ≥ 1 | S2 | derived |
| IaC coverage of `ENV_LIST` | < 80% | S2 | derived |
| IaC coverage of `ENV_LIST` | < 50% | S1 | derived |
| Resources reported changed by a read-only plan (drift) | ≥ 1 | S2 | derived |
| Retried-run share (`run_attempt > 1`) | > 15% | S3 | derived |
| Median lead time for changes (§9), pipeline half only — A-08 owns the pre-pipeline half | > 7 days | S3 | derived |
| Measured deployment frequency below a **supplied** `DEPLOY_FREQUENCY` | by ≥ 2× | S3 | derived |

Overrides applied after the table. A **project that deploys nothing** — a library, a CLI, an SDK — files no deploy, rollback or parity finding; its
release-publication path is audited in their place, and the substitution is stated in *Границы достоверности*. A threshold crossed on **fewer than 30
runs** files one row lower with `confidence: probable`. A defect living only in a workflow whose triggers cannot reach production takes the reachability
discount of `report-contract.md` §5, with the trigger quoted. A **declared** control that step 6 or step 8 could not confirm is a hypothesis under
`report-contract.md` §7's hypothesis rule, never a confirmed absence.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

Two sampling units in different halves. For step 2 the unit is **one pipeline run**; for steps 4 to 8 it is **one deploy path**, an (environment ×
pipeline) pair. `coverage` takes the contract's semicolon-separated form, runs first as the primary unit — `"41/612 pipeline runs (7%); 4/4 deploy paths
(100%) — risk-ranked top N plus C random controls"`. Step 2 straddles two stages, so its outputs are split explicitly and the report never mixes the
columns:

| Computed over 100% of `PERIOD` | Computed over the top `N` + `C` only |
|---|---|
| per-workflow and production-path median and p90 run duration (`updated_at − created_at`), failed-run share, retried-run share, the deploy counts §9 divides | per-stage median and p90 (appendix A1), exact `timing` durations, failure-cause breakdown, deploy-job duration |

The top `N` runs are ranked by **delivery risk**, in this order: runs on the production path; failed runs; retried runs; runs in the top decile of
duration; runs on a release or hotfix branch; the `C` controls are drawn at random from the rest. Early stop: the contract's control-sample stop,
additionally requiring that every environment in `ENV_LIST` has a resolved rollback answer — a mechanism, a time, and a date or an explicit *никогда*.

## 8. Report additions

| Addition | Where | Shape |
|---|---|---|
| «Диаграмма конвейера с длительностями» / *Pipeline diagram with durations* | report §7 *Приложения*, appendix A1 | one Mermaid `flowchart LR`: a node per stage of §4.1 labelled `<stage> — median Xm / p90 Ym (N=n)` from §4.2's per-stage timings, where `n` is the sampled run count of §7 and not the window population; concurrent jobs as parallel branches from one node, a blocking edge solid and a non-blocking one dashed, a deploy node per environment. A stage no sampled run exercised is labelled `не измерено`, never left blank. The diagram is context; findings in report §5 reference its node names |
| «Таблица окружений и их расхождений» / *Environment divergence table* | report §7 *Приложения*, appendix A2 | one row per environment pair from §4.7: pair, keys only on the left, keys only on the right, runtime version delta, image identity delta (digest / tag / rebuilt), data-shape statement, source file per column. Every row crossing a §6 parity threshold also appears as a finding in report §5 *Детальные находки* |
| «Фактическая процедура отката» / *Actual rollback procedure* | report §7 *Приложения*, appendix A3 | the reconstructed step list per environment: mechanism, the command or control performing it, the time in minutes and whether it is measured or an upper bound, the date of the last real application or *никогда*, and the migrations blocking it. Its verdict is carried into report §5 as a **mandatory finding** whenever the procedure is unverified or exceeds the 15-minute threshold — the appendix describes, §5 judges |

## 9. Score

Five numbers, reported together and never averaged: the four DORA metrics in the best approximation the access permits, plus rollback time. Each is
computed over `PERIOD` with its N and its command; a metric the access does not support is reported `не измерено` — never zero, never an estimate.
**Deploy state and finish come from §5's statuses subresource, never from the deployments listing**, whose objects carry neither: a deployment is
successful when its newest terminal status is `success`, whose `created_at` is the finish, and failed on `failure` or `error`. One with no terminal
status is excluded from all five metrics, its id named in *Границы достоверности* — an exclusion, never a zero.

- **`DF`, deployment frequency** = successful production deploys in `PERIOD` ÷ weeks in `PERIOD`, in **deploys per week**; source order: the deployments
  API with its statuses, else deploy-job runs with `conclusion == "success"`, else tags reachable from `$M`. The source used is named beside the number.
- **`LT`, lead time for changes** = median over successful production deploys of (deploy finish − committer time of the newest commit in that deploy), in
  **hours**, by the median rule of §4.2. **`CFR`, change failure rate** = production deploys followed within 24 h by a rollback, a revert or a hotfix
  deploy ÷ production deploys, as a **percentage**.
- **`MTTR`, time to restore service** = median over those events of (restoring deploy finish − failing deploy finish), in **hours**. **`ROLLBACK_TIME`**
  = wall clock of the last real rollback of §4.6, in **minutes**; with none, the deploy-job median labelled *оценка сверху*, the rollback unverified.

Report it as `Итоговая оценка: DF = X/нед; LT = Y ч; CFR = Z%; MTTR = W ч; время отката = V мин (проверен/не проверен, последний факт — YYYY-MM-DD)`.
The justification names the stage dominating the duration, the dominant failure cause, and whether reversibility is demonstrated or only declared.
Whether the rollback is verified is repeated in report §1.

## 10. Failure modes of this audit

| # | How this audit produces a false result | Countermeasure |
|---|---|---|
| 1 | A `rollback.sh`, a `helm rollback` line in a runbook, or a documented procedure is read as a rollback capability, and the system is reported reversible when nobody has ever reversed it | The criterion is the **date of the last real application**, from §4.6's revert commits, ancestor deployments and incident records. No date, no capability: the finding files at S1 and appendix A3 says *никогда*. A procedure with no evidence is `confidence: hypothesis`, never `confirmed` |
| 2 | `timeout-minutes: 60`, or a runbook's "the build takes about ten minutes", is recorded as the run duration; a declared budget is not a measurement | Durations come only from run timestamps, the timing API or job timestamps. In config-only mode step 2 is reported *не измерено* and the §6 duration rows do not fire at all |
| 3 | A green badge, or the last run on the default branch, is taken for the failure rate; and re-run-until-green hides the rest, since a run list shows only the surviving attempt | The share is computed over every run in `PERIOD` from §4.2's paginated population, with its N. Count `run_attempt > 1` as its own metric, treat a retried run as a failed first attempt, and report both shares |
| 4 | Every failure is filed as a "flake" because the real cause was never read, moving the >10% threshold at will | A failure is `infrastructure` or `flake` only on log evidence — a network, registry, runner or quota error, or an identical `head_sha` passing on retry with no code change. Everything else is `unknown`, and that bucket is shown rather than distributed |
| 5 | Parity is judged from `.env.example` or a template that no deploy reads, so the environments look identical | Parity claims rest only on the sources the deploy consumes (§4.7). Where the real store is a secret manager or CI variables the audit cannot read, key-set parity is reported *не измерено*, not equal |
| 6 | A monorepo's `paths:` filters make most runs short, dragging the median below what a real change experiences — or the median is taken from §7's risk-ranked sample, selected for failure and slowness, and dragged the other way | Segment medians by workflow and by whether the run reached the deploy stage; the production path's median is the headline and the aggregate is context. The headline is the 100% column of §7, never the sampled one, and every duration says which population produced it |
| 7 | Drift is reported absent because no plan ran, or because a CloudFormation stack answers `NOT_CHECKED` — missing access turned into a clean bill of health; and deployment frequency is taken from tags on a project that tags quarterly but deploys daily | Absence of a plan is *not measured*, with `IAC_PLAN_ACCESS` named in *Границы достоверности* as what would settle it. A `StackDriftStatus` of `NOT_CHECKED` or `UNKNOWN` is the same verdict — it is the last recorded result, and refreshing it is a create call §11 forbids — so only `DRIFTED` / `IN_SYNC` count, reported with `LastCheckTimestamp` so a stale check is visible. `DF` follows §9's source order and names the source used; the declared-versus-measured divergence is filed only where `DEPLOY_FREQUENCY` was actually supplied |
| 8 | A-08's bypass rows are re-filed here, so one defect is counted twice and the programme's totals inflate | Reference the `A08_REPORT` finding id in `blocked_by`, and file here only what the pipeline owns — duration, artefact identity, deploy, rollback, parity, IaC |

## 11. Audit-specific prohibitions

- **Never start, cancel or re-run a pipeline**: no `gh workflow run`, `gh run rerun`, `gh run cancel`, `glab ci run`, no `curl -X POST` against a build
  API, no push of a branch, tag or empty commit "to see what fires".
- **Never perform a deploy, a promotion or a rollback — not in staging, and not to time it.** No `helm rollback` or `helm upgrade`, no
  `kubectl rollout undo` or `apply`, no `argocd app sync`/`rollback`, no `terraform apply`, `import`, `taint`, `state` subcommand or `force-unlock`, no
  `aws cloudformation detect-stack-drift`, no re-run of a deploy job. Rollback time comes from the last real instance or is reported as an upper bound.
  **No load, smoke, canary or chaos exercise against any environment**, staging included: read such a suite's configuration and its past results instead.
- **`terraform plan` only under `IAC_PLAN_ACCESS`, only `-refresh-only -lock=false -input=false`, and only on a copy outside the audited repository** —
  `terraform init` writes `.terraform.lock.hcl` and provider files into the directory it runs in, which would modify the tree. `TF_DATA_DIR` goes
  outside it too.
- **Read-only verbs only against an orchestrator or cloud API**: `kubectl get`/`describe`, `helm list`/`history`/`get manifest`, `aws … describe-*`/`list-*`.
  Never `edit`, `scale`, `patch`, `delete`, `rollout restart`, or any create call. `helm get values` is excluded from those verbs on purpose: it prints
  the release's supplied values, which routinely carry database passwords, tokens and registry credentials.
- **Install nothing to reproduce a build**: no `act`, no `docker build`, no `npm ci`, `pip install`, `mvn package` or `cargo build` run for the audit's
  own benefit; determinism is judged from configuration and from two recorded runs sharing a `head_sha`. **Do not download build artefacts into the
  audited repository**: use `gh run download <id> --dir "$TMP/artifacts"` outside the tree, and never extract into it.
- **Configuration variables are read by name, never by value.** The only permitted form is `gh variable list --json name --jq '.[].name'` (with
  `--env <env>` per environment): the bare `gh variable list` prints a value column, and no later reduction can un-print what the invocation already
  emitted into the session. `kubectl get secret` is not run, and a running container's environment is never dumped. §4.7 needs key sets, not values.

## 12. Dependencies

**Input.** **A-07**, as `A07_REPORT` or values copied from it: critical-flow coverage, the flake share and unstable-test table, and the per-level suite
run times — which gates are load-bearing, and how much of the duration is test time. **A-08**, as `A08_REPORT`: appendix A3's required-check and bypass
rows, which give step 1 its mandatory-check list and keep §10.8's double counting out. **A-01's environment map**, when available, as `ENV_LIST`: A-01
is its sole producer and this audit derives the list only in its absence. What each absence costs is in §2's derivation column.

**Output.** Delivery metrics go on as parameter values to **A-18** — `ROLLBACK_TIME`, appendix A3 with its verification date, the deploy strategy per
environment, the migration-reversibility list — and to **A-19**, which takes the run counts, the durations, the retried-run share and the environment
inventory as the volume side of the pipeline's cost.

## 13. Nearest marvin command

`/marvin:sec-ci`, the pairing `audit-index.md` records. `sec-ci` audits the pipeline's **security** posture — action provenance, token scope, secret
handling, runner isolation — while A-17 measures its **delivery** behaviour: duration, failure profile, artefact promotion, rollback, environment
parity. They touch at one point: §4.3's mutable references, filed here as a determinism defect and cross-referenced there. **`/marvin:task-verify`**
(one local gate run, not a population over `PERIOD`) and **`/marvin:task-metrics`** (a marvin-mediated subset of deliveries) are accelerators, not
sections: their numbers are evidence to verify, and a disagreement with §4.2's is itself a finding about pipeline coverage.
