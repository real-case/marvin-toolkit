# A-20 — Документация и распределение знаний

> **Audit question.** Which knowledge exists only in people's heads, and what happens to this project when the
> person holding it leaves?

## 1. Role and task

You establish where the project's knowledge is written down, whether what is written is **true**, and which parts of the
system are described by nothing but one person's memory. A run leaves the coverage map, the retrospective-ADR list and
the claim table beside the report, and judges artefacts, never people (§11).

## 2. Audit-specific parameters

On top of the ten standard parameters of `report-contract.md` §2. With all eleven unset the run still completes: population
from `git ls-files` plus the harvested links, bus factor recomputed, onboarding delta at its documented half.

| Parameter | Meaning | Derivation when unset |
|---|---|---|
| `DOC_LOCATIONS` | where documentation lives, inside the repository and outside it | in-repo: step 1's `git ls-files` pathspec under `GIT_EXCLUDE`, written once there and never re-encoded here. Out-of-repo: links harvested from those files with `rg -o -N -e 'https?://[^ )>]*(confluence\|notion\|atlassian\|wiki\|readthedocs\|gitbook\|sharepoint\|docs\.google)[^ )>]*'`. **Ask the user** only for a system the tree points at but you cannot open; an unreachable location goes to `tools_unavailable` and *Границы достоверности*, and the score is computed over what was readable |
| `BUS_FACTOR_MAP` | modules whose knowledge sits with one identity — the A-04 report path, or its map copied out | recomputed in step 5a with **A-04's definition**, which this audit consumes and never restates differently: one identity above 70% of a module's changed lines over A-04's `HISTORY_WINDOW` (default 18 months), recorded as an estimate. When supplied, **adopt its module boundaries and window verbatim** (§10 item 5) |
| `ONBOARDING_LOG` | A-02's chronological journal, tribal-knowledge list and `U` — a path, or the values | absent → step 7 produces the documented side only, names the missing input, and caps `confidence` at `medium` |
| `A08_DELTA` | A-08's documented-versus-observed process delta (its appendix A2 / §4.1) | absent → process documents are claim-checked like any other in step 2; no process metric is recomputed here (§3) |
| `MODULE_MAP` | how paths group into modules | `BUS_FACTOR_MAP`'s grouping when supplied; else workspace roots from the manifests (`package.json` `workspaces`, `go.work`, `Cargo.toml` `members`, Maven modules, `pyproject.toml` packages); else the first two path segments |
| `CRITICAL_MODULES` | the denominator of the score | A-01 or `BUSINESS_CONTEXT` when supplied; else modules holding auth, payment, billing, persistence or the entry points; else **ask the user**, and with no answer use the top decile by churn over `HISTORY_WINDOW` — churn only, and therefore not `HOTSPOTS`, which is A-04's ranking of files by churn × size over the same window, and not the same population — say so in *Границы достоверности*, and cap those findings at S2 |
| `KEY_DECISIONS` | the architectural decisions the ADR check is measured against | built in step 3b from manifests, lockfiles, infrastructure files and directory seams; a supplied list is a hypothesis to extend, never the population |
| `CLAIM_SAMPLE_N` | claims verified against code in step 2 | `5` at `quick` — the requirements floor — `12` at `standard`, `25` at `deep` |
| `COMMENT_SAMPLE_N` | comment lines classified in step 6 | `50` at `quick`, `120` at `standard`, `250` at `deep`, drawn at random from the step-6 population |
| `STALENESS_MONTHS` | how far a document may lag the code it describes | `6` months |
| `WORK_DIR` (`$W`) | scratch space | `$(mktemp -d)` — **never inside the audited repository** |

## 3. Scope

**In scope.** Documentation in the repository and outside it; architecture decision records; runbooks and operational
instructions; code comments and TODO/FIXME markers; the zones where a module's knowledge has a single holder. Truth is
the subject; presence is only the precondition. Migration directories are the one class `report-contract.md` §2 excludes
that step 4 deliberately keeps: enumerated as an operations surface — their existence, never their bodies as a metric.

**Out of scope.** Evaluation of people — **no audit in the family covers it** (`report-contract.md` §9). The onboarding
path → A-02, whose journal arrives as a parameter; bus factor 1 as a finding of its own, churn and hotspots → A-04, whose
70%-share rule this audit consumes as an input fact for T3 and T8; process metrics → A-08; comment density as a metric
and lint suppressions → A-05; API-contract well-formedness → A-11, here only whether the documentation about it is true;
architecture rules in CI → A-09; runbook drills and RTO/RPO → A-18; telemetry behind an incident → A-16; secrets and
credentials → A-14; privacy and consent docs → A-22; cost → A-19; a11y → A-21.

## 4. Collection protocol

`RG_EXCLUDE`, `GIT_EXCLUDE` and `EXCLUDE_RE` are `report-contract.md` §2's canonical set, used by name below.

**1. Documentation inventory with dates, against the code it describes.** *Produces* the **doc register**: path, kind,
subject paths, doc date, subjects' newest date, delta, staleness verdict. *Cost:* minutes, 100% of the tree.
```sh
SINCE=$(date -v-18m +%F 2>/dev/null || date -d '18 months ago' +%F)   # A-04's HISTORY_WINDOW default; BSD, else GNU
git ls-files -- '*.md' '*.mdx' '*.rst' '*.adoc' '*.txt' '*.org' 'docs/*' 'doc/*' "${GIT_EXCLUDE[@]}" > "$W/docs.txt"
while IFS= read -r f; do printf '%s\t%s\n' "$(git log -1 --format=%ad --date=short -- "$f")" "$f"; done < "$W/docs.txt" | sort > "$W/doc-dates.tsv"
rg -o -N -r '$1$2' -e '\]\(([^)#][^)]*)\)' -e '`([A-Za-z0-9_./-]+\.[a-z]{1,5})`' "$f"  # subject paths of one document
git ls-files --error-unmatch -- "$p" >/dev/null 2>&1 || echo "gone: $p"; git log -1 --format=%ad --date=short -- "$p"  # gone = terminal staleness, else its newest change
```
The replacement is `$1$2`, never `$1`: two `-e` patterns compile into one alternation numbered across both, so a
backticked path is group 2, `-r '$1'` prints an empty line for it at exit 0, and the T1 comparison silently loses half.

**1b. The out-of-repo half of that register.** *Produces* the `out-of-repo` rows; `DOC_LOCATIONS` whole is the
population. Run §2's harvest over `$W/docs.txt` (`tr '\n' '\0' | xargs -0 rg …`) into `$W/external.txt`, open each
reachable page and append its last-updated stamp, `kind`, subject paths and marker — staleness being that stamp against
the subjects' newest change, no stamp `не установлено`. Unreachable pages enter no row (§5). *Cost:* off-box minutes.

**2. Sample truth check.** Draw `CLAIM_SAMPLE_N` **verifiable claims** (a path, a default, a port, an env variable, a
command, a boundary), stratified so setup, architecture, operations, interface and configuration each contribute one
where one exists, at least one from an `out-of-repo` row when 1b produced any. *Produces* the **claim table**: `C-nn`,
doc `path:line` (page + section out of repo), the claim, the check, the verdict (`верно` / `устарело` / `неверно` /
`непроверяемо`), and the code `path:line` or command that settled it — every verdict cites code, never a document
(§10 item 4). Locate with `rg -n -i`; date a once-true claim with §5's `git log -1`. *Cost:* the step the audit exists for.

**3. ADR: existence and coverage.** *Produces* (a) the ADR inventory — id, title, status, date, subject; (b)
`KEY_DECISIONS`; (c) the **retrospective-ADR list** `D-nn`, decisions **unexplained** — no record, design document or
commit body gives the reason and the rejected alternative — the `-S` search's emptiness being the evidence.
```sh
git ls-files -- 'docs/adr/*' 'doc/adr/*' 'adr/*' 'docs/decisions/*' 'docs/rfcs/*' "${GIT_EXCLUDE[@]}"   # 3a: the corpus
rg -l -i "${RG_EXCLUDE[@]}" -e 'architecture decision record' -e '^\s*(\||\*\*)?\s*status\b.*(proposed|accepted|superseded|rejected)'  # both styles
git ls-files -- '*Dockerfile*' '*docker-compose*' '*.tf' 'k8s/*' 'charts/*' '.github/workflows/*' "${GIT_EXCLUDE[@]}"  # 3b
jq -r '(.dependencies // {}) + (.devDependencies // {}) | keys[]' package.json; git log -S'<library or marker>' --format='%h %ad %s' --date=short -- <path> | tail -5   # choices made; reason ever written?
```

**4. Runbooks for the routine operations.** *Produces* the **runbook coverage table**: operation | instruction
(`path:line`, or `нет`) | last content change | truth verdict. Operations come from the repository's own surface, the
floor set where it implies them being deploy, rollback, restore from backup, run and revert a migration, rotate a
credential, triage an incident, disable a feature, restart a stuck job.
```sh
jq -r '.scripts // {} | keys[]' package.json; git ls-files -- 'Makefile' 'Taskfile.y*ml' 'scripts/*' "${GIT_EXCLUDE[@]}"
git ls-files -- 'migrations/*' '*/migrations/*'   # §3's declared keep; both anchors — `*/…` alone misses a top-level one
rg -l -i "${RG_EXCLUDE[@]}" -e 'runbook|playbook|on-?call|incident|troubleshoot|disaster.?recovery|rollback|restore'
```

**5. Risk zones — bus factor crossed with documentation.** *Produces* the **coverage map** (§8 item 1). *5a, only when
`BUS_FACTOR_MAP` is unset*, per module `$m`, with A-04's rule verbatim so the maps join (§10 item 5): mailmap-canonical
identity (`%aE`, never `%ae`), `--no-renames`, `GIT_EXCLUDE`, the duplicate-identity review before any share, and
pseudonymisation **in the pipeline, not in the prose** — the map to `$W` under `umask 077`, only `share% ⇥ A0n` to
stdout. *5b:* join each module to its step-1/1b documents and step-2 verdicts; a module whose only document failed
step 2 is **not documented** (§10 item 2).
```sh
umask 077
test -f .mailmap; git shortlog -sne --since="$SINCE" HEAD -- . "${GIT_EXCLUDE[@]}" > "$W/shortlog.txt"   # review IN $W
git log --since="$SINCE" --no-merges --format='%aE' -- . "${GIT_EXCLUDE[@]}" | sort -u | awk '{printf "%s\tA%02d\n",$0,++n}' > "$W/identities.tsv"   # never printed
git log --since="$SINCE" --no-merges --no-renames --numstat --format='C%x09%aE' -- "$m" "${GIT_EXCLUDE[@]}" |
  awk -F'\t' -v M="$W/identities.tsv" 'BEGIN{while((getline l<M)>0){split(l,p,"\t"); id[p[1]]=p[2]}}
    $1=="C"{a=($2 in id)?id[$2]:"A00"; next} NF==3 && $1!="-"{s[a]+=$1+$2; t+=$1+$2}
    END{if(t>0) for(k in s) printf "%.1f\t%s\n", 100*s[k]/t, k}' | sort -rn | head -3
```
`git shortlog` reads stdin given no revision range, so `HEAD` is load-bearing; merge near-duplicate identities before
any share (§10 item 5). *Методология* records the canonicalisation and that a recomputed bus factor is an estimate.

**6. Comments: explanation versus narration, and TODO age.** *Produces* (a) the **why-share** and (b) the **TODO
register**: marker, `path:line`, age in months. The why-share's population is the modules named among the **subject paths
of the top-`N` documents** (§7) — this audit ranks documents, never modules — sampled at `COMMENT_SAMPLE_N` lines (§2).
**Two rules, no third:** *why* states a constraint, a rejected alternative, a bug reference or a non-obvious invariant;
*what* restates the statement below it; anything else is `непроверяемо` and leaves the denominator.
```sh
rg -n --no-heading -i "${RG_EXCLUDE[@]}" -e '\b(TODO|FIXME|HACK|XXX|WORKAROUND)\b' --stats; CUTOFF=$(( $(date +%s) - 365*24*3600 ))
git blame --line-porcelain -L "$l,$l" -- "$f" | sed -n 's/^author-time //p'  # one marker's epoch, against $CUTOFF
rg -n --no-heading "${RG_EXCLUDE[@]}" -e '^\s*(//|#|\*|--)' -- <the step-6 modules> | awk 'BEGIN{srand()}{print rand()"\t"$0}' | sort -n | cut -f2- | head -"$COMMENT_SAMPLE_N"   # the sample, then classified by reading
```

**7. Documentation against the observed onboarding.** *Produces* the **onboarding delta**: each `ONBOARDING_LOG` row
marked `не документировано` or contradicted by a document, mapped to the responsible document `path:line`, plus each
tribal-knowledge entry `T-nn` with no documentary home. Absent that input, take the getting-started document's ordered
steps, mark each verifiable or not by reading, record that no observed side exists — and never execute them (§11).

## 5. Tools

| Tool | What it measures here | Invocation | Fallback |
|---|---|---|---|
| `git log` per file, `git blame` per line | last content change of a document and of the code it describes; the age of one TODO/FIXME line | `git log -1 --format=%ad --date=short -- <path>`, content-only via `git log -3 -p --format='%h %ad %s' --date=short -- <path>`; `git blame --line-porcelain -L "$l,$l" -- "$f" \| sed -n 's/^author-time //p'` | for the dates none — git is this audit's floor, and with no history staleness is `не установлено` and `confidence` drops to `low`; for the age `git log -1 --format=%at -- "$f"`, a file-level upper bound marked an estimate |
| `git ls-files` | the document population, and whether a referenced path still exists | `git ls-files -- '*.md' 'docs/*' "${GIT_EXCLUDE[@]}"` — a bare `.` beside the patterns would match the whole tree and defeat them; `git ls-files --error-unmatch -- <path>` | `find . -name '*.md' -print \| grep -Ev "$EXCLUDE_RE"` — §2's canonical regex, so the untracked-tree fallback drops exactly what the pathspec dropped; `test -e <path>` |
| ripgrep (`rg`) | TODO/FIXME markers, ADR markers, doc links, comment lines, claim locations | `rg -n --no-heading -i "${RG_EXCLUDE[@]}" -e '<pattern>'`; extraction with **one group per pattern index**, `rg -o -N -r '$1$2' -e '<p1>' -e '<p2>'` | `git grep -n -E '<pattern>'`, else `grep -RnIE '<pattern>' .` filtered through `grep -Ev "$EXCLUDE_RE"` (no `-o -r`: extract with `sed -n 's/.*(\(.*\)).*/\1/p'`) |
| `jq` | scripts and dependencies as the operational and decision surface | `jq -r '.scripts // {} \| keys[]' package.json` | `sed -n '/"scripts"/,/}/p' package.json`; other stacks `Makefile`, `Taskfile.yml`, `pyproject.toml`, `Rakefile`, `pom.xml`, `mix.exs` |
| `cloc` | comment-line totals per language over the step-6 modules — the frame the sample is drawn from, never T11's denominator, which is the classified sample | `git ls-files -- <the step-6 modules> "${GIT_EXCLUDE[@]}" > "$W/files.txt"; cloc --quiet --json --list-file="$W/files.txt"` — the same modules and the same exclusions as step 6's `rg`, so the two cannot drift apart | `xargs tokei < "$W/files.txt"`, else `rg -c "${RG_EXCLUDE[@]}" -e '^\s*(//\|#\|\*\|--)'` over that same list, the ratio then declared a sample estimate |
| Document and code reading; `/marvin:adr-audit` and `/marvin:docs-search` as accelerators (§13) | every truth verdict — the only source of one; ADR-corpus lint (3a) and locating the document that makes a claim (step 2) | open the claim, then open the code it claims about; `/marvin:adr-audit`, `/marvin:docs-search <question>` | none for the reading — it is the audit and cannot be delegated to a grep; for the accelerators, step 3's `git ls-files` + `rg` inventory and `rg -n -i -e '<claim keywords>'` over `DOC_LOCATIONS`, their output evidence to verify, never a section to paste |
| External doc systems | the out-of-repo half of the population: pages, their own last-updated stamps, their claims | step 1b — harvest into `$W/external.txt`, open each link, append the page to the doc register as an `out-of-repo` row | per page: `tools_unavailable`, the gap named in *Границы достоверности*, that page's modules scored on in-repo documentation only, and the split stated in `coverage` |

## 6. Analysis rules and thresholds

| # | Condition | Threshold | Severity | Origin |
|---|---|---|---|---|
| T1 | Document lags the last change to the code it describes | > `STALENESS_MONTHS` (`6` unset — the requirements number is the default, and §9 honours the parameter) | S3 | requirements |
| T1b | The same lag, where the document is a getting-started document, a runbook, or the document of a `CRITICAL_MODULES` module | > `STALENESS_MONTHS` | **S2** | derived |
| T2 | Key architectural decision with no explanation in any record, document or commit body | ≥ 1 | **S2** | requirements |
| T3 | Critical module with no documentation and bus factor 1 | 1 holder, 0 documents | **S1** | requirements |
| T4 | TODO / FIXME / HACK marker still open | > `12` months | **S3** | requirements |
| T5 | Sampled claim contradicted by code (`неверно`, not merely `устарело`) | ≥ 1 | S2 per claim | derived |
| T6 | Share of the claim sample proved false — the corpus itself is untrustworthy | ≥ 1/3 of `CLAIM_SAMPLE_N` | S1, filed once for the corpus | derived |
| T7 | Critical module documented, and its sampled claim proved false | ≥ 1 | **S1** — ranked above T3 on purpose (§10 item 2) | derived |
| T8 | Non-critical module with bus factor 1 and no documentation | 1 holder, 0 documents | S2 | derived |
| T9 | No instruction for a recovery operation the surface implies (rollback, restore, credential rotation, migration revert) | 0 instructions | S1 for recovery, S2 for the rest | derived |
| T10 | No decision records at all, while step 3b lists unexplained key decisions | 0 records, ≥ 5 decisions | S2, filed once, rolling up its T2 rows | derived |
| T11 | Why-share of the step-6 sample — `COMMENT_SAMPLE_N` lines from the top-`N` documents' modules, classified by the two rules, `непроверяемо` excluded from the denominator | < 20% | S3 | derived |
| T12 | Documented onboarding step contradicted by `ONBOARDING_LOG`, or a tribal-knowledge entry with no documentary home | ≥ 1 | S2 each; S1 when more than half the documented steps disagree | derived |

A finding is filed **per document or per module**, not per line; lines are its evidence. T1b and T8 are this spec's
promotions of T1 and T3, and their `derived` Origin is what allows it. **T3 and T8 split one requirements sentence** —
«модуль с единственным носителем и без документации даёт S1», unqualified there: S1 on the critical path, S2 off it,
where blast radius cannot reach S1; a T8 row standing on a derived `CRITICAL_MODULES` (§2's top-churn fallback) says so,
since on another denominator it is a T3. Bus factor 1 in T3 and T8 is A-04's **condition at A-04's definition**, which
this spec never restates differently; the value behind it is recomputed in step 5a whenever `BUS_FACTOR_MAP` is unset,
and is an estimate then (§2, §9). An unestablished date is `не установлено`: a cut to `confidence`, never a crossing.
Recency is not truth (§10 item 3): T1 dates the last **content** change, and a document passing it can still fail T5.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

- **Sampling unit: the document** — a register row from step 1 or 1b, ranked in one list. **Top-`N` ranking:** on the
  onboarding or recovery path; describes a `CRITICAL_MODULES` module; describes a bus-factor-1 module; largest staleness
  delta; broadest subject set. `C` is what catches the quiet document that is a behaviour's only description.
- **Two nested samples, no second ranking:** `CLAIM_SAMPLE_N` claims from the top `N` (step 2) and `COMMENT_SAMPLE_N`
  comment lines from the modules those documents name as subjects (step 6). `coverage` is therefore the contract's
  multi-population list — documents primary, then claims, then comment lines, the documents clause carrying 1b's split.
- **Early stop:** the contract's control-sample stop, additionally requiring, for every `CRITICAL_MODULES` module, a
  coverage-map row whose документация, актуальность and носителей знания cells are all settled — §9's three `K`
  conditions. `нет` settles документация and `0` settles носителей знания; `не установлено` never settles актуальность.

## 8. Report additions

1. **Карта покрытия знаний** — inside §7 *Приложения*. One row per module: модуль | документация (`path` list, an
   out-of-repo page marked as such, or `нет`) | актуальность (delta in months, or `не установлено`) | достоверность
   (`проверено` / `неверно` / `не проверялось`, citing `C-nn`) | носителей знания | критичный | finding ids.
2. **Решения, требующие ретроспективного ADR** — inside §5 *Детальные находки*, before the findings. Per `D-nn`: the
   decision, where it is visible (`path:line`), what code cannot recover (the rejected alternative, the constraint that
   forced it), the finding id it evidences; a decision whose rationale the code states is recorded, not a gap.
3. **Результаты проверки достоверности выборки** — inside §7 *Приложения*: the full step-2 claim table, all
   `CLAIM_SAMPLE_N` rows including those that passed; beside it the TODO register with ages (T4) and the classified
   comment sample with its population, method and two rules (T11). Every `неверно` row is also a §5 finding.

## 9. Score

One number with one qualifier, reported together in §2 *Итоговая оценка* and never merged. **Knowledge coverage of the
critical modules** `K / T`, a ratio with a percentage: `T` is `|CRITICAL_MODULES|`, and `K` counts modules meeting all
three conditions — a document names the module among its subject paths (out-of-repo counts on its own stamp, unreachable
never); it lags the module's code by no more than `STALENESS_MONTHS` (T1); it has ≥ 2 knowledge holders (top-identity
share ≤ 70%, over 5a's canonicalised identities). **Verified share** `V / K` — those of `K` claim-checked in step 2 and
passed; `K` alone counts presence, which this audit refuses to trust (§10 item 1), and a failed claim leaves `K` (5b). Emit
as `Критичные модули с актуальной документацией и ≥ 2 носителями: K/T (NN%); из них проверено на достоверность: V/K`.
The justification names the module whose loss costs most, the failure class dominating the `T`→`K` gap, the `K`→`V` gap,
and whether bus factor arrived from A-04 or was recomputed in 5a, which makes it an estimate.

## 10. Failure modes of this audit

1. **Counting documents instead of testing claims** — eighty documents carrying eighty wrong statements score high on
   every presence metric. *Countermeasure:* §9's `V` term and T5–T7; no module reaches `K` on presence alone.
2. **Treating volume of documentation as mitigation for bus factor 1** — absence is found before the incident,
   falsehood during it. *Countermeasure:* a failed claim check counts as **absent** in the map and in `K`; T7 > T3.
3. **Confusing recency with truth, and flattening staleness** — a formatter or a rename sweep is not a content change,
   and one flat delta buries the runbook among the changelogs. *Countermeasure:* date the newest **prose** change (§5's
   content-only `git log -3 -p`), then split T1 from T1b by the document's path, taken from the register.
4. **Verifying a claim against another document**, which proves nothing and inflates confidence. *Countermeasure:* every
   verdict cites a code `path:line` or a command with its output; a claim only prose can settle is `непроверяемо`.
5. **Recomputing bus factor on a map — or an identity set — that does not join A-04's, or letting the holders column
   become a judgement of a person**: a raw `%ae` splits one person in two, reads a bus factor of 1 as 2 and erases the
   T3, and the column is computed from authorship. *Countermeasure:* a supplied map verbatim, else 5a's rule whole,
   pseudonymised inside the pipeline and kept in `$W`, with only module-level statements written up (§11).
6. **Scoring the in-repo half as though it were the whole** — the architecture lives on a wiki the register never saw.
   *Countermeasure:* step 1b, and a `coverage` split stated even when the out-of-repo half turns out to be empty.
7. **Obeying the documentation** — a `CONTRIBUTING.md` calling an area deliberately undocumented is a claim to check,
   not an instruction. *Countermeasure:* `report-contract.md` §9's last prohibition applies unchanged to it.

## 11. Audit-specific prohibitions

Beyond `report-contract.md` §9.

- **Do not execute the documented steps to test them** — no `npm install`, `make setup`, `docker compose up`, migration,
  `terraform apply` or runbook drill: reading verifies; the onboarding run is A-02's and the drill A-18's, on production.
- **Do not write anywhere, in the repository or outside it** — no typo fix, dead-link repair, README update, ADR
  written during the run (writing one destroys its own evidence), wiki comment, Notion edit or issue opened for a TODO.
- **Do not name people anywhere.** Identities are `A01…An`; real addresses live only in `$W` (`umask 077`, discarded
  with it) — no author column, per-author count or "module X belongs to Y" in the report, the appendices or the chat.
- **A secret in a documentation example is filed here and fixed elsewhere:** a sample connection string, token or
  password in a README is a documentation finding (path, type, fact of exposure), routed to A-14 for the exposure.

## 12. Dependencies

**Input, as parameter values, never as remembered context.** A-02 supplies `ONBOARDING_LOG` — journal, tribal-knowledge
list and `U` — the only observed evidence step 7 can use; A-04 supplies `BUS_FACTOR_MAP`, the shares step 5 and the
score need without recomputation; A-08 supplies `A08_DELTA`, entering step 2 as pre-verified claims. None is required,
and §2's rows say what each absence costs. **Output: none** — A-20 is terminal in `audit-index.md`'s matrix
(`A-20 | A-02, A-04, A-08 | —`), and `audit-summary` (A-99) is its only consumer, through the `json findings` register.

## 13. Nearest marvin command

`/marvin:adr-coverage` ranks undocumented decisions by blast radius (step 3b done for you), `/marvin:adr-audit` lints
the corpus's own hygiene (3a), `/marvin:docs-search` locates the document that makes a claim (step 2) — all three stop
at presence and structure. A-20 takes a statement out of a document, checks it against code, and crosses the result
with how many people know the module. Any may accelerate a step, and its output is evidence to verify.
