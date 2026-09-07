# A-08 — Аудит процесса разработки

> **Audit question.** How does a change travel from idea to production, and where does it stall?

## 1. Role and task

You audit the delivery process **as practised**, reconstructed from version control, platform and CI
configuration — never from the documented process. One question closes: the real path of a change, its
measured cycle time, and every route reaching the mainline without passing the controls the project believes
are mandatory. Besides the report, the run leaves a process-metrics table (appendix A2) that A-17 and A-20
consume as parameter values, and a bypass table (appendix A3) whose every row is either proven closed or
filed as a finding.

## 2. Audit-specific parameters

On top of the ten standard parameters of `report-contract.md` §2. All six are optional: with every one
unset the audit runs in git-only mode over a 90-day window on `origin/HEAD`.

| Parameter | Meaning | Derivation when unset |
|---|---|---|
| `VCS_PLATFORM_ACCESS` | authenticated read access to the hosting platform API | probe `gh auth status`, then `glab auth status`; the first success names the platform. Both fail → **git-only mode**, degradation recorded in *Границы достоверности* |
| `TRACKER_ACCESS` | read access to the issue tracker | none. Linkage is then measured **textually** (§4.6); a change with no textual reference is *unlinked*, which is not the claim *untracked* |
| `PERIOD` | observation window | last 90 days. Under 20 mainline integrations in it → widen to 180, then 365, stopping at the first window reaching 20; record the window used. Still under 20 at 365 → run anyway, cap `confidence` at `medium` (`low` under 10) |
| `MAINLINE_BRANCH` | the branch a change must reach to count as delivered | `git symbolic-ref refs/remotes/origin/HEAD`; else the first of `origin/main`, `origin/master`, `origin/dev`, `origin/develop` that `git rev-parse --verify` resolves; else the branch receiving the most first-parent merges in `PERIOD` |
| `BOT_ACTORS` | automation identities counted separately | logins ending `[bot]`, plus names matching the alternation `dependabot`, `renovate`, `github-actions`, `mergify` |
| `A01_REPORT` | path to the finished A-01 report, for the repository and component list | absent: enumerate from `REPO_PATH` alone and note in *Границы достоверности* that a multi-repository product may be covered only in part |

## 3. Scope

### In scope

Branching model in practice; pull/merge request size, lifetime and iteration count; the review procedure
and its actual strictness; the checks that genuinely block a merge and the routes around them; the hotfix
path including the retrospective return to the mainline; the share of changes attached to a tracker item.

### Out of scope

- **Performance or productivity of individual people** — nothing in this family covers it, by design (§10.1, §11).
- **Pipeline duration, flake share, rollback time, environment parity** → A-17, which also files the pipeline half
  of lead time; A-08 files the pre-pipeline half, as median time to merge (§6). **Cost of the pipeline** → A-19.
  **Incident response once a hotfix is live** → A-18.
- **CI supply-chain risk, token permissions, secrets in the pipeline** → A-14 (and `/marvin:sec-ci`).
- **Whether the tests that run are worth running** → A-07; A-08 records only whether they block.
- **Quality of the code inside the changes** → A-05; churn and ownership concentration → A-04.
- **Truth and coverage of process documentation, knowledge distribution** → A-20.

## 4. Collection protocol

Resolve `MAINLINE_BRANCH` into **two** variables: `$M`, the git revision (`refs/remotes/origin/dev`,
`origin/main`), for every git command; and `$B`, the bare branch name (`dev`, `release/2.0`), for every platform
API path, derived by stripping the remote prefix — `B=${M#refs/remotes/}; B=${B#origin/}`, not the last path
segment, which would cut `release/2.0` down to `2.0`. The APIs address a branch by bare name only: `branches/$M`
404s on GitHub and GitLab alike, and that 404 is indistinguishable from the missing-scope case of §10.5. Window
start is `$SINCE` (`date -v-90d +%F` on BSD, `date -d '90 days ago' +%F` on GNU). Scratch files go outside the
audited repository. Size is measured under the `GIT_EXCLUDE` pathspec of `report-contract.md` §2, this audit
adding nothing to it; a merge diff limited by any pathspec is empty unless `--diff-merges=first-parent` is given
beside it, and a platform `additions`/`deletions` count cannot be filtered at all, so appendix A2 names the mode
beside every size figure.

1. **Branching model by fact**, not by documentation:
   `git for-each-ref --sort=-committerdate --format='%(refname:short) %(committerdate:short)' refs/remotes/origin`;
   `git log --first-parent --merges "$M" --since="$SINCE" --format='%s'` (merge subjects name their source
   branches); `git for-each-ref --sort=-creatordate --format='%(refname:short) %(creatordate:short)' refs/tags`.
   Classify prefixes (`feat/`, `fix/`, `hotfix/`, `release/`, integration branches) by count and median age; read
   `CONTRIBUTING.md`, `README`, `docs/` **afterwards**, separately. *Produces:* observed model, documented model, deltas.
2. **Pull-request statistics over `PERIOD`.** Platform mode:
   `gh pr list --state merged --limit 500 --json number,createdAt,mergedAt,additions,deletions,changedFiles,baseRefName,author,mergedBy,reviews,closingIssuesReferences,url`,
   filtered on `mergedAt >= $SINCE` (GitLab: `glab api "projects/:id/merge_requests?state=merged&per_page=100&page=1"`).
   Reduce `author` and `mergedBy` to the booleans `is_bot` and `self_merged` **at this step**, discarding
   identities before any aggregation. Git-only mode, per first-parent merge `$C`: size from
   `git show --numstat --format='' --diff-merges=first-parent "$C" -- . "${GIT_EXCLUDE[@]}"` summed with `awk`;
   lifetime from `git show -s --format=%cI "$C"` minus `git log --format=%cI "$C^1..$C^2" | tail -1` —
   **committer dates on both ends**, an author date surviving a rebase being exactly the inflation §10.8 names;
   branch commits from `git rev-list --count "$C^1..$C^2"`.
   Median from `sort -n` plus `awk '{a[NR]=$1} END{if(NR%2) print a[(NR+1)/2]; else print (a[NR/2]+a[NR/2+1])/2}'`.
   *Produces:* median changed lines, median changed files, median time to merge (hours), median time to
   first review, median iterations — each with and without `BOT_ACTORS`, each with its N, and each naming the
   clock it was read from (platform `createdAt`/`mergedAt`, or git `%cI`) in the appendix A2 command column.
3. **Review: required, by how many, how substantive.** Configuration:
   `gh api "repos/{owner}/{repo}/branches/$B/protection" --jq '.required_pull_request_reviews'` (GitLab:
   `glab api "projects/:id/approval_rules"`). Behaviour over the §7 sample, GitHub — three **disjoint** comment
   surfaces: step 2's `reviews` field (a review body),
   `gh api "repos/{owner}/{repo}/pulls/<n>/comments" --jq 'length'` (inline diff comments **only**), and
   `gh api "repos/{owner}/{repo}/issues/<n>/comments" --jq 'length'` (the conversation thread). A review is
   **substantive** when a non-author populated any one of them; a PR counts as approve-without-comment only when
   its state is `APPROVED` and all three are empty, since a review written as prose with no inline anchor is
   otherwise scored a rubber stamp. Iterations are `1 + count(reviews in state CHANGES_REQUESTED)`, named as the
   proxy it is; self-merge is step 2's `self_merged` boolean; time to first review is the earliest non-author
   event across the three surfaces. GitLab, per MR iid:
   `glab api "projects/:id/merge_requests/<iid>/approvals"` for approval state, and
   `glab api "projects/:id/merge_requests/<iid>/notes"` for the rest — a note with `system: false` from a
   non-author is substantive (diff-anchored ones also appear under `.../discussions`), its earliest `created_at`
   is time to first review, and iterations are `1 + count(system notes whose body begins "unapproved")`, a weaker
   proxy than `CHANGES_REQUESTED` and labelled as one in appendix A2. Git-only mode: review is unmeasurable, so
   say so and invent no proxy. *Produces:* review required yes/no, required reviewer count, approve-without-comment
   share, self-merge share, time to first review, median iterations — as shares over a stated N.
4. **What actually blocks a merge, and how it is bypassed.** Configuration:
   `gh api "repos/{owner}/{repo}/branches/$B/protection/required_status_checks"`;
   `gh api "repos/{owner}/{repo}/branches/$B/protection" --jq '.enforce_admins.enabled, .allow_force_pushes.enabled, .required_linear_history.enabled'`;
   `gh api "repos/{owner}/{repo}/rulesets"` (GitLab: `glab api "projects/:id/protected_branches"`). Then hunt
   the routes around it, each a candidate finding: an empty required-check list while workflows exist;
   `enforce_admins` false; ruleset `bypass_actors`; `continue-on-error: true`, `paths-ignore` or an `if:`
   guard on a required job (`git grep -nE 'continue-on-error|paths-ignore' "$M" -- .github/workflows`),
   since a required check filtered out of a path reports success by never running; `[skip ci]` usage
   (`git log --first-parent "$M" --since="$SINCE" -E --grep='\[(skip ci|ci skip)\]' --format=%h | wc -l`);
   direct pushes with no PR (`git log --first-parent "$M" --since="$SINCE" --format='%H %p %s'`, counting
   single-parent commits whose subject carries no `(#<n>)`, confirmed by
   `gh api "repos/{owner}/{repo}/commits/<sha>/pulls" --jq 'length'` returning `0`); a policy only a local git
   hook enforces, which `--no-verify` removes. *Produces:* the required-check list, and appendix A3 with one row
   per route, its evidence, and whether it was exercised inside `PERIOD`.
5. **The hotfix path**, from history: `git tag --merged "$M" --sort=-creatordate | head -20`, branches
   matching `hotfix/`, and commits that reached a release branch or tag without passing the mainline
   (`git log --first-parent origin/<release> --since="$SINCE" --format='%H %s'`). Test the retrospective
   return per hotfix commit `$H` with `git merge-base --is-ancestor "$H" "$M" && echo merged-back || echo NOT-merged-back`,
   plus `git branch -r --contains "$H"`. Compare the checks applied here against step 4's list for the normal
   path. *Produces:* the hotfix procedure, hotfix count in `PERIOD`, the count and list never returned to the
   mainline, and the check delta between the two paths.
6. **Tracker linkage** — share of mainline integrations carrying a tracker reference:
   `git log --first-parent "$M" --since="$SINCE" -E --grep='(#[0-9]+|[A-Z][A-Z0-9]{1,9}-[0-9]+)' --format=%H | wc -l`
   over `git log --first-parent "$M" --since="$SINCE" --format=%H | wc -l`. With platform access, refine using the
   `closingIssuesReferences` field step 2 requests — GitHub only; GitLab's MR payload carries no equivalent, so
   read `Closes #n` out of the MR `description` there. With `TRACKER_ACCESS`, resolve a sample of the keys read-only
   to confirm they exist and are current; without it, claim only that a reference is *present*, never that it is
   *valid*. *Produces:* linked share with its N, the reference syntaxes in use, and the count of unresolved ones.

## 5. Tools

| Tool | What it measures | Invocation | Fallback when absent |
|---|---|---|---|
| `git log`, `git show`, `git for-each-ref` | model, branch and tag inventory, sizes, lifetimes, direct pushes, tracker text | as in §4 | none needed — git is this audit's floor; without dated refs use `git branch -r` plus `git tag` |
| GitHub API via `gh` | PR statistics, reviews, protection, rulesets | `gh pr list --json …`; `gh api "repos/{owner}/{repo}/branches/$B/protection"` | git-only mode: steps 2 and 5 from merge commits, step 3 declared unmeasurable |
| GitLab API via `glab` | the same on GitLab: MR statistics, approval rules, approvals, notes, protected branches | `glab api "projects/:id/merge_requests?state=merged&per_page=100&page=1"`; `glab api "projects/:id/merge_requests/<iid>/notes"`; `glab api "projects/:id/approval_rules"` | git-only mode for steps 2 and 5; step 3 keeps its §4.3 GitLab measurement while `notes` is readable, and is declared unmeasurable only when it is not |
| Generic platform REST | any other host (Bitbucket, Gitea, Azure DevOps) | `curl -sS -H "Authorization: Bearer $TOKEN" "<api-base>/…"`, GET only | git-only mode |
| Branch-protection config | which checks are mandatory, and who may skip them | `gh api "repos/{owner}/{repo}/branches/$B/protection"`; `glab api "projects/:id/protected_branches"` | `gh api "repos/{owner}/{repo}/branches/$B" --jq '.protected'` yields only the boolean; on 404 apply §10.5 before recording *unreadable*, and never *absent* |
| CI configuration | what runs, and on which paths | `git ls-tree -r --name-only "$M" -- .github/workflows`; `git show "$M":.gitlab-ci.yml`, `:Jenkinsfile`, `:.circleci/config.yml`, `:azure-pipelines.yml`, `:bitbucket-pipelines.yml` | `git grep -n 'jobs:' "$M" -- '*.yml' '*.yaml'` |
| `jq`, `awk`, `sort`, `wc` | reducing the JSON above; medians, shares, counts | `jq -r '.[] .number'` over a saved response file; the `awk` median of §4.2 | `gh api … --jq '…'` reduces JSON in-process without `jq` installed, otherwise pipe the response to `python3 -c`; `awk`/`sort`/`wc` are POSIX and always present |

## 6. Analysis rules and thresholds

| Condition | Threshold | Severity | Origin |
|---|---|---|---|
| Median PR size, changed lines, bots excluded | > 400 | S2 | requirements |
| Median PR size, changed lines (escalation) | > 1000 | S1 | derived |
| Median time to merge | > 3 days | S2 | requirements |
| Median time to merge (escalation) | > 10 days | S1 | derived |
| Approve-without-comment share | > 70% | S2 | requirements |
| Any route reaching `MAINLINE_BRANCH` past a check the project treats as mandatory | ≥ 1 route | S1 | requirements |
| Self-merge share of PRs on a protected branch | > 30% | S2 | derived |
| Review not required on `MAINLINE_BRANCH` | required reviewers = 0 | S2 | derived |
| Hotfixes never returned to the mainline | ≥ 1 | S2 | derived |
| Hotfixes never returned to the mainline (escalation) | > 25% of hotfixes | S1 | derived |
| Median time to first review | > 24 h | S3 | derived |
| Tracker-linked share of mainline integrations | < 60% | S3 | derived |
| Median iterations per PR | > 3 | S3 | derived |
| Documented branching model contradicts the observed one | ≥ 1 contradiction | S3 | derived |

Overrides applied after the table. An **unused bypass route still files at S1** when reachable today, and takes
the reachability discount of `report-contract.md` §5 only when provably unreachable — an empty actor set, a
deleted workflow — with that reason in the evidence. A **single-contributor repository** files self-merge,
required-review and approve-without-comment findings no higher than S3, those thresholds measuring a control such
a team structurally cannot satisfy; state the contributor count as the reason. A **threshold crossed on a
population under 20** files one row lower with `confidence: probable`. **Bot-authored changes are excluded from
every median** and reported separately: a median over an automated dependency stream is not a process metric.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

The sampling unit is **one merged pull/merge request**; in git-only mode, one first-parent integration commit
on `MAINLINE_BRANCH`. Steps 2 and 6 are aggregates covering 100% of `PERIOD`; run them before any sampling.
The top `N` for targeted reading (full timeline, reviews, checks, linked issue) is ranked by **process risk**,
in this order: merged with no review; merged while a required check was absent, skipped or failing; cycle time
in the top decile; size in the top decile; no tracker reference. Early stop: the contract's control-sample
stop, additionally requiring that every appendix A3 row be confirmed by a real example or proven closed by
configuration.

## 8. Report additions

| Addition | Where | Shape |
|---|---|---|
| «Фактический путь изменения» / *Actual change path* | report §7 *Приложения*, appendix A1 | one Mermaid `flowchart LR` of the observed path — idea → branch → PR → review → checks → merge → release — the hotfix route as a separate edge into the release, and every edge skipping a control drawn dashed and labelled with its A3 row id. Findings in §5 reference the edge; the diagram is not itself a finding |
| «Обязательные и обходимые проверки» / *Required and bypassable checks* | report §7 *Приложения*, appendix A3 | one row per check: name, where configured (file:line or API path), blocking yes/no, bypass route, evidence, exercised in `PERIOD` yes/no/unknown. Every row with a non-empty bypass route also appears as a finding in report §5 *Детальные находки* at the severity §6 assigns |
| «Метрики процесса» / *Process metrics* | report §7 *Приложения*, appendix A2 | one row per metric of §4 steps 2, 3, 5 and 6: metric, value, unit, N, exact command, bots included yes/no. This is the table A-17 and A-20 receive as parameter values |

Findings themselves follow the schema of `report-contract.md` §4; nothing else is added.

## 9. Score

Two numbers, reported together and never averaged into one. `CYCLE_TIME_MEDIAN` is the median over `PERIOD`
of (merge timestamp − first commit timestamp on the branch), **in hours**, bots excluded, by the median
rule of §4.2 over the population that fed the medians there, with that N beside it. `BYPASS_COUNT` is the
count of distinct appendix A3 rows whose bypass route is non-empty and reachable today, **an integer** —
routes, not incidents: one misconfigured ruleset used forty times is one. Report it as
`Итоговая оценка: медианное время цикла N ч; обходных путей мимо контроля качества M`. The justification names
the dominant contributor to the cycle time (waiting for first review, after changes requested, for checks, for
a release), what moved it, and the most reachable bypass route. `BYPASS_COUNT ≥ 1` is stated plainly in report §1
*Executive summary*: it is the answer a reader who stops there must leave with.

## 10. Failure modes of this audit

| # | How this audit produces a false result | Countermeasure |
|---|---|---|
| 1 | Every command in §4.2 and §4.3 returns an author identity, and the natural next sentence attaches a number to it. The result is false, not merely rude: a long time-to-first-review measures reviewer availability, release pressure and time zones, none of which the named individual controls | Reduce identity to the `is_bot` / `self_merged` booleans at collection time, keep no author column in any intermediate file, and let §11 forbid the output shape outright |
| 2 | Reading `CONTRIBUTING.md` first anchors every later observation, and the documented model is then reported as the practised one | §4.1 collects history before documentation and keeps the two in separate columns; a contradiction is a finding, never a correction to the data |
| 3 | Squash and rebase merges erase branch history, so `"$C^1..$C^2"` is empty; filling the gap with commit-date arithmetic yields confident, wrong cycle times | Detect single-parent integrations, use platform `createdAt` / `mergedAt` instead, and where neither exists mark time-to-merge *not measurable* and drop `confidence` to `medium` |
| 4 | Bot traffic dominates the population: thirty Dependabot merges a month produce a small median size and a short cycle time while every human change is large and slow | The `BOT_ACTORS` exclusion, both figures reported, and the split stated in the `coverage` note |
| 5 | A 404 on `/protection` is read as "no protection" — a token without admin scope cannot read it, and absence looks identical to an unprotected branch. A malformed path 404s identically and is then absorbed as a scope limit: an empty required-check list, a `BYPASS_COUNT` of §9 computed from nothing, and a report blaming the token | Before recording any protection read as *unreadable*, confirm `gh api "repos/{owner}/{repo}/branches/$B"` returns 200 — a 404 **there** is a path bug (`$B` is the bare name, `$M` the git revision), not a permission. Then distinguish *unreadable* from *absent* (§5, branch-protection row), corroborate with `--jq '.protected'` on that same call, and file the ambiguity as `confidence: hypothesis` with the check that would settle it |
| 6 | Checks that never run are counted as protection: a required workflow gated by `paths-ignore` passes by not running, and the protection API alone shows it as enforced | §4.4 cross-reads workflow triggers against the required-check list and treats a never-running required check as a bypass row |
| 7 | A short `PERIOD` yields an unstable median, then compared against a threshold as if it were a property of the process | The widening rule of `PERIOD`, the N beside every median, and the under-20 downgrade of §6 |
| 8 | Rewritten history lies about time: author dates survive rebases and can be set by hand | Prefer committer dates (`%cI`) for interval arithmetic, prefer platform timestamps where available, and say which was used |

## 11. Audit-specific prohibitions

- **No per-author statistic reaches any artefact** — not a table, a sentence, an appendix, a chat message or an
  intermediate file, including neutral counts. `report-contract.md` §9 forbids evaluating people; this audit also
  forbids the per-author *shape*, which the tooling supplies by default, one paragraph from an evaluation.
- **Never exercise a bypass route to confirm it**: no test push to a protected branch, no `git push --force`,
  no opening or merging a PR, no `gh workflow run`, no `gh pr merge --admin`. A route is confirmed from
  configuration plus historical evidence that it was already used.
- **GET only against the platform and the tracker.** No `gh api -X PUT/POST/PATCH/DELETE`, no `gh pr comment`,
  `gh pr review`, `gh pr edit`, `gh issue close`, and no toggling a protection setting "to see what happens"
  and restoring it. An unreadable value is reported unreadable.
- **Read other branches with `git show <ref>:<path>` and `git ls-tree <ref>`.** This audit reads workflow and
  protection files living on `$M` while HEAD is elsewhere, and those two are its whole mechanism for it;
  `git stash`, `git switch` and `git worktree add`, unnamed in the contract's list, are forbidden substitutes.
- **Do not repair the clone**: no `git fetch --unshallow`, `--prune`, `git gc`, `git remote add`. A shallow or partial
  clone is a limit to declare in *Границы достоверности* and, where it blocks a step, a full clone to request.
- **Do not quote change content.** Sizes, timings and states are needed; diffs are not. Reference a PR by
  number and URL rather than pasting PR bodies, review text or commit bodies.

## 12. Dependencies

**Input.** A-01, as `A01_REPORT` (a path) or values copied from it: the repository list and component register,
which decide how many repositories this audit spans. Absent, it runs over `REPO_PATH` alone and says so, never blocking.

**Output.** Appendix A2 (process metrics) and appendix A3 (bypass table) are handed on as parameter values to
**A-17**, which takes the required-check list, the bypass rows and the cycle-time median as the starting point
for measuring the pipeline itself, and to **A-20**, which takes the documented-versus-observed delta of §4.1 as
direct evidence of documentation that is not true.

## 13. Nearest marvin command

`audit-index.md` lists no marvin command against A-08. The nearest is **`/marvin:task-metrics`**, with
**`/marvin:sec-ci`** adjacent on the configuration half. `task-metrics` aggregates the `.marvin/metrics/` series
— cycle time, rework rounds, gate calls — for tasks run through marvin's own spec pipeline in this repository,
so its population is marvin-mediated work only; A-08's is every integration into the mainline over `PERIOD`,
whatever tooling produced it. Where both exist, `task-metrics` output may accelerate the cycle-time picture and
is then **evidence to verify against git**, never a section to paste — a disagreement between the two is itself
a finding about pipeline coverage. `sec-ci` audits the pipeline's security posture; A-08 reads the same
configuration files for a different question: what blocks a merge, and what walks around it.
