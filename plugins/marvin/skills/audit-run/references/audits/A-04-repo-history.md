# A-04 — Анализ истории репозитория

> **Audit question.** Where are this codebase's problem areas, judged by how the code has actually behaved over time rather than by anyone's impression of it?

## 1. Role and task

You are a repository archaeologist: from version-control history alone you establish which files absorb change, which change together across module lines, and which modules carry a single knowledge
holder. Besides the report a run leaves the three artefacts §12 hands on, and it measures artefacts, never people (§11).

## 2. Audit-specific parameters

On top of the ten standard parameters of `report-contract.md` §2. The audit runs with all ten of them unset.

| Parameter | Meaning | Default and derivation when unset |
|---|---|---|
| `HISTORY_WINDOW` | analysis window | `18 months`; when the first commit is younger (`git log --max-parents=0 --format=%ad --date=short`), use the full history and record the real span |
| `RENAME_MAP` | moves and renames, so history does not break at a path change | derived in step 1b; **ask the user** only when a top-N file has far fewer commits than its module's median and no rename explains it |
| `EXCLUDE_PATHS` | generated, vendored, built | the `EX` array of §4 — `report-contract.md` §2's `GIT_EXCLUDE` minus migration bodies, the single class this audit keeps (§3); append paths marked `linguist-generated`/`linguist-vendored` (`git check-attr linguist-generated linguist-vendored -- <path>`) as further `':(exclude)…'` elements |
| `MODULE_MAP` | how paths group into modules | the A-01 register when supplied — substitute its lookup for the `mod()` function of §4; else workspace roots from the manifests (`package.json` `workspaces`, `go.work`, `Cargo.toml` `members`, Maven modules, `pyproject.toml` packages); else `mod()`'s own default, the first two path segments |
| `CRITICAL_MODULES` | modules that gate the S1 rows of §6 | A-01 or `BUSINESS_CONTEXT` when supplied; else modules holding auth, payment, billing, persistence or the entry points; else **ask the user**, and with no answer treat top-decile-churn modules as critical, say so in *Границы достоверности*, and cap those findings at S2 |
| `MECHANICAL_REVS` | revisions dropped from every metric | derived in step 1d, seeded from `.git-blame-ignore-revs` when present |
| `BOT_AUTHORS` | non-human identities | email matching `bot@\|noreply\|dependabot\|renovate\|github-actions\|semantic-release` |
| `GIANT_COMMIT_LINES`, `GIANT_COMMIT_FILES` | the two sizes above which a commit is a giant, either alone qualifying | `400` changed lines; `30` files — both counted after `EXCLUDE_PATHS`, and both passed to step 5 as separate shell variables |
| `COMPLEXITY_PROXY` | second factor of the hotspot rank | first installed of `scc` complexity, `lizard` CCN, lines × mean indentation (§5); record which ran, since ranks from different proxies are not comparable |
| `WORK_DIR` (`$W`) | scratch space for tool output | `$(mktemp -d)` — **never inside the audited repository** (§11) |

## 3. Scope

**In scope.** Churn by file and directory, hotspot ranking, temporal coupling, bus factor as a property of modules, and the commit rhythm profile. The unit is the file, aggregated to the module. **Bus factor is
defined here for the whole family** — one identity above **70%** of a module's changed lines over `HISTORY_WINDOW` (T5); A-01's single-author components arrive as candidates on an author count and are confirmed
or refuted against T5, and A-20 consumes the resulting map unchanged. **Exclusions are `report-contract.md` §2's canonical set, referenced rather than re-encoded, with one declared delta:** migration bodies
stay **in**, because §2 removes them from code metrics while a migration is exactly the kind of change this audit measures.

**Out of scope.** People, productivity and individual output: no audit in the family covers this and none may (§11). Static code quality — complexity distributions, duplication, lint debt →
**A-05**. Whether the hotspots are tested → **A-07**. Whether cross-module coupling violates declared architecture → **A-09**: A-04 reports the co-change fact, A-09 judges it against rules.
Whether the knowledge gap is closed by documentation → **A-20**. The process around the commit — lead time, review latency, branching model → **A-08**, **A-17**. Secrets in history → **A-14**.
Dependency currency and licences → **A-03**; bot commits are noise here. Authorship attribution and CLA coverage: nothing in the family covers it.

## 4. Collection protocol

`$W` = `WORK_DIR`; `$SINCE` = `HISTORY_WINDOW` as a git approxidate (`'18 months ago'`); `$N` = the targeted-read count of `report-contract.md` §8; §2's `GIT_EXCLUDE` is in the shell first and step 1 builds
`EX` from it. `EXCLUDE_PATHS` is a shell **array**, never a string, always expanded quoted as `-- "${EX[@]}"` (§10.6). Confirm `git log --oneline --since="$SINCE" -- "${EX[@]}" | wc -l` is non-zero first.

**1. Normalise the history.** *Produces* `$W/renames.tsv`, `$W/authors.map`, `$W/sizes.txt`, `$W/mechanical.txt` and `$W/hist.tsv` — one pseudonymised, exclusion-applied stream (`sha, identity,
changed lines, path, epoch`) that every later step reads. *Cost:* minutes.

```sh
EX=( . ); for p in "${GIT_EXCLUDE[@]}"; do [ "$p" = ':(exclude)**/migrations/**' ] || EX+=( "$p" ); done   # §2's set, minus migrations (§3)
git rev-parse --is-shallow-repository; git log --max-parents=0 --format='%H %ad' --date=short  # a. shallow ⇒ §7 cap; real start
git log --since="$SINCE" -M90% -C --diff-filter=R --name-status --format='%H' | grep -E '^R[0-9]' | sort -u > "$W/renames.tsv"   # b.
test -f .mailmap; git shortlog -sne --since="$SINCE" HEAD | head -50    # c. HEAD is mandatory: with no revision range shortlog reads STDIN
git log --since="$SINCE" --format='%aE%x09%aN' HEAD | sort -u |         # one id per person, keyed by BOTH email and name — §11 needs both
 awk -F'\t' '{if(!($1 in id)) id[$1]=sprintf("A%02d",++n); if(!($1 in s)){print $1"\t"id[$1]; s[$1]=1}
   if(!($2 in s)){print $2"\t"id[$1]; s[$2]=1}}' > "$W/authors.map"
test -f .git-blame-ignore-revs && grep -vE '^\s*(#|$)' .git-blame-ignore-revs                                        # d. signal 1
git log --no-merges --since="$SINCE" --format='%H %s' HEAD |     # signal 2, anchored on the SUBJECT — see the note below
 grep -iE '^[0-9a-f]+ (chore|style|format|lint|prettier|black|gofmt|rustfmt|rubocop|eslint)'
git log --no-merges --since="$SINCE" --numstat --format='C %H' -- "${EX[@]}" |    # sha files ins del, for §6 T7–T9 and signal 3
 awk '$1=="C"{if(c)print c,nf,i,d; c=$2; nf=i=d=0; next} NF==3&&$1!="-"{nf++; i+=$1; d+=$2} END{if(c)print c,nf,i,d}' > "$W/sizes.txt"
awk '$2>=50 && ($3+$4)>0 && (($3-$4)<0?($4-$3):($3-$4))/($3+$4)<0.1 {print $1}' "$W/sizes.txt"                        # signal 3
: > "$W/mechanical.txt"   # ← e. after review, one sha per line: the survivors of signals 1–3, plus every commit whose %aE matches BOT_AUTHORS
git log --no-merges --no-renames --since="$SINCE" --numstat --format='C %H %aE %at' -- "${EX[@]}" |   # f. the normalised stream
 awk -v M="$W/authors.map" -v D="$W/mechanical.txt" 'BEGIN{while((getline l<M)>0){split(l,m,"\t"); id[m[1]]=m[2]} while((getline r<D)>0) x[r]=1}
  $1=="C"&&NF>=3{s=($2 in x); c=$2; a=(($3 in id)?id[$3]:"A00"); t=$NF; next}   # %at is last: an empty %aE cannot shift it
  !s&&NF==3&&$1!="-"{print c"\t"a"\t"$1+$2"\t"$3"\t"t}' > "$W/hist.tsv"
```

Signal 2 must anchor on the subject: `--grep` matches any body line and over-matches a conventional-commit history by roughly a third, and a commit excluded here leaves every metric. `%aE`/`%aN` apply
`.mailmap`. Signals 2 and 3 give **candidates, not verdicts** (§10.2). `--no-renames` keeps the numstat columns parseable — identities merge from `$W/renames.tsv`; paths with spaces need `-z`.

**2. Churn, then hotspot rank = churn × complexity.** *Produces* `$W/churn.tsv` (revisions, changed lines, path), its directory rollup, `$W/cx.tsv` (complexity, path) from whichever proxy of §5 is
installed, and `$W/hotspots.tsv` in the seven columns of §8. *Cost:* one full-tree pass.

```sh
awk -F'\t' '{rev[$4]++; ch[$4]+=$3} END{for(f in rev) printf "%d\t%d\t%s\n",rev[f],ch[f],f}' "$W/hist.tsv" | sort -k2,2nr > "$W/churn.tsv"
awk -F'\t' '{split($3,p,"/"); d=(p[2]==""?p[1]:p[1]"/"p[2]); r[d]+=$1; c[d]+=$2}
 END{for(k in r) printf "%d\t%d\t%s\n",r[k],c[k],k}' "$W/churn.tsv" | sort -k2,2nr          # the directory rollup
git ls-files -- "${EX[@]}" | while IFS= read -r f; do      # last-resort proxy; §5 has scc and lizard, which write the same two columns
  awk -v f="$f" '{n=match($0,/[^ \t]/); if(n>0){s+=n-1;c++}} END{if(c) printf "%d\t%s\n",int(c*(s/c)),f}' "$f"
done > "$W/cx.tsv"
awk -F'\t' 'function mod(p,  s,n){n=split(p,s,"/"); return (n<2?s[1]:s[1]"/"s[2])}
 NR==FNR{cx[$2]=$1; next} {rev[$3]=$1; ch[$3]=$2; if($1>mr)mr=$1}   # max complexity is taken below, over the JOIN — an excluded file cannot set it
 END{for(f in rev){c=(f in cx?cx[f]:0); if(c>mx)mx=c}
  for(f in rev){c=(f in cx?cx[f]:0); printf "%.4f\t%s\t%s\t%d\t%d\t%d\n",(mr?rev[f]/mr:0)*(mx?c/mx:0),f,mod(f),rev[f],ch[f],c}}' \
 "$W/cx.tsv" "$W/churn.tsv" | sort -k1,1nr | awk -F'\t' '{printf "%d\t%s\t%s\t%s\t%s\t%s\t%s\n",NR,$2,$3,$4,$5,$6,$1}' > "$W/hotspots.tsv"
```

`HotspotScore = (revisions / max_revisions) × (complexity / max_complexity)`, min-max normalised over the surviving file set by the join above; a file with no complexity row scores 0.

**3. Temporal coupling.** *Produces* `$W/coupling.tsv` in the nine columns of §8 and its module-pair rollup, the finding unit of §6 T3. *Cost:* quadratic in files per commit.

```sh
awk -F'\t' 'function mod(p,  s,n){n=split(p,s,"/"); return (n<2?s[1]:s[1]"/"s[2])}
 function flush(  i,j,a,b,t){if(n>1&&n<=30) for(i=1;i<n;i++) for(j=i+1;j<=n;j++){a=f[i];b=f[j]; if(a>b){t=a;a=b;b=t} p[a"\t"b]++}
   for(i=1;i<=n;i++) delete f[i]; n=0}
 $1!=c{flush(); c=$1} {f[++n]=$4; rev[$4]++}     # the n<=30 degree guard stops one wide commit manufacturing thousands of spurious pairs
 END{flush(); for(k in p){split(k,q,"\t"); a=q[1]; b=q[2]; d=(rev[a]<rev[b]?rev[a]:rev[b]); pc=100*p[k]/d
  if(pc>=60) printf "%s\t%s\t%s\t%s\t%d\t%d\t%d\t%d\t%s\n",a,mod(a),b,mod(b),p[k],rev[a],rev[b],int(pc),(mod(a)==mod(b)?"same":"cross")}}' \
 "$W/hist.tsv" | sort -k9,9 -k5,5nr > "$W/coupling.tsv"       # every pair at or above 60% is kept — nothing is ever filtered out
awk -F'\t' '$9=="cross"{k=$2" <-> "$4; n[k]++; s[k]+=$5; if($5>=5) g[k]++}      # the shared-revision count sets severity in §6 T3
 END{for(k in n) printf "%d\t%d\t%d\t%s\n",s[k],n[k],g[k]+0,k}' "$W/coupling.tsv" | sort -k1,1nr
```

`coupling% = shared_revisions / min(revisions_a, revisions_b)`; state it in *Методология*. Substitute `MODULE_MAP`'s lookup for `mod()` when one was supplied, here and in steps 2 and 4.

**4. Bus factor by module.** *Produces* `$W/ownership.tsv`, `$W/recency.tsv`, `$W/blame.tsv` and the module map of §8. *Cost:* seconds, plus minutes for the blame cross-check over the top `$N`.

```sh
awk -F'\t' '{own[$4"\t"$2]+=$3; tot[$4]+=$3} END{for(k in own){split(k,p,"\t")
 printf "%.1f\t%s\t%s\n",100*own[k]/tot[p[1]],p[2],p[1]}}' "$W/hist.tsv" | sort -rn > "$W/ownership.tsv"        # share %, identity, path
awk -F'\t' 'function mod(p,  s,n){n=split(p,s,"/"); return (n<2?s[1]:s[1]"/"s[2])}      # newest epoch per module and per identity
 {m=mod($4); if($5>lm[m])lm[m]=$5; if($5>li[$2])li[$2]=$5} END{for(k in lm) printf "M\t%s\t%s\n",k,lm[k]; for(k in li) printf "I\t%s\t%s\n",k,li[k]}' "$W/hist.tsv" > "$W/recency.tsv"
IGN=""; test -f .git-blame-ignore-revs && IGN="--ignore-revs-file=.git-blame-ignore-revs"
cut -f2 "$W/hotspots.tsv" | head -"$N" | while IFS= read -r f; do printf '%s\t' "$f"
  git blame --line-porcelain -w -M -C $IGN -- "$f" | awk -v M="$W/authors.map" 'BEGIN{while((getline l<M)>0){split(l,m,"\t"); id[m[1]]=m[2]}}
   /^author-mail /{e=$2; gsub(/[<>]/,"",e); c[(e in id)?id[e]:"A00"]++} END{for(a in c) printf "%s=%d ",a,c[a]; print ""}'
done > "$W/blame.tsv"
```

`--line-porcelain` wraps `author-mail` in angle brackets, so the awk strips them before the `$W/authors.map` lookup: without that every identity misses the map and a raw email reaches the terminal, which §11
forbids. Sum `$W/ownership.tsv` per module for T5's bus factor; `$W/recency.tsv` dates the §8 map's `last change` and T5's two age tests; blame answers who wrote the lines still standing.

**5. Commit rhythm profile.** *Produces* the median commit size and the giant, revert and fix-fix **shares**, with the workflow shape that qualifies them. *Cost:* seconds.

```sh
awk '{print $3+$4}' "$W/sizes.txt" | sort -n | awk '{a[NR]=$1} END{print "median",(NR%2?a[(NR+1)/2]:(a[NR/2]+a[NR/2+1])/2)}'
awk -v G="${GIANT_COMMIT_LINES:-400}" -v F="${GIANT_COMMIT_FILES:-30}" '{t=$3+$4} t>G||$2>F{g++} END{printf "giants %d/%d (%.1f%%)\n",g,NR,(NR?100*g/NR:0)}' "$W/sizes.txt"
R=$(git log --no-merges --since="$SINCE" -i --grep='This reverts commit' --format=%H | wc -l | tr -d ' ')
awk -v r="$R" 'END{printf "reverts %d/%d (%.1f%%)\n",r,NR,(NR?100*r/NR:0)}' "$W/sizes.txt"
git log --no-merges --since="$SINCE" --format='%H %s' HEAD |
 grep -iE '^[0-9a-f]+ (fix|hotfix|bugfix)' | cut -d' ' -f1 > "$W/fixes.txt"    # subject-anchored, as signal 2 — and T10's DENOMINATOR
FIXN=$(wc -l < "$W/fixes.txt" | tr -d ' ')
git log --no-merges --since="$SINCE" --format='F %H %at' --name-only -- "${EX[@]}" |
 awk -v F="$W/fixes.txt" -v N="$FIXN" 'BEGIN{while((getline l<F)>0) fx[l]=1} $1=="F"{k=($2 in fx); c=$2; t=$3; next}
  k&&NF{if(($0 in last) && last[$0]-t<=604800) refix[c]=1; last[$0]=t}
  END{n=0; for(j in refix)n++; printf "fix-fix %d/%d (%.1f%%)\n",n,N,(N?100*n/N:0)}'
git log --since="$SINCE" --merges --format='%H' | wc -l    # 0 merges + "(#123)" subjects ⇒ squash workflow
```

A **fix-fix** is a fix-type commit touching a file another fix-type commit touched within seven days. The subtraction order is load-bearing: the log is newest-first, so `last[$0]` holds the newer
timestamp and `t-last[$0]` makes the window vacuous — every repeat qualifies however far apart, inflating the count by about half. Reverse it only with `--reverse` on the `git log`.

## 5. Tools

| Tool | What it measures here | Invocation | Fallback when absent |
|---|---|---|---|
| `git` (`log`, `blame`, `shortlog`) | every metric in §4 | as written above; `git shortlog -sne --since="$SINCE" HEAD` — the revision range is mandatory (step 1c) — and the bracket-stripping, map-joined `blame` pipeline of step 4 | `git log` needs none, it is the fallback; without `blame`, the change-based ownership pass alone, and record the loss; without `shortlog`, `git log --format='%aE' HEAD \| sort \| uniq -c` |
| `scc` + `jq` | complexity factor of the rank | `scc --by-file --format json . > "$W/scc.json"`, then `jq -r '.[].Files[] \| [.Complexity, .Location] \| @tsv' "$W/scc.json" > "$W/cx.tsv"` — no exclusion list of its own: step 2's join keeps only the paths `$W/churn.tsv` already carries | `lizard`, then the indentation proxy of step 2 |
| `lizard` | per-function CCN summed per file | `lizard --csv . > "$W/lizard.csv"`, then sum the CCN column per file into `$W/cx.tsv`, taking the column positions from `lizard --csv \| head -1` rather than assuming them | the indentation proxy of step 2 |
| `code-maat` | coupling, ownership, entity effort — an accelerator | `git log --since="$SINCE" --numstat --date=short --no-renames --pretty=format:'--%h--%ad--%aE' > "$W/maat.log"` — `%aE`, never `%aN`, so its author column is a key `$W/authors.map` matches — then `java -jar code-maat-standalone.jar -l "$W/maat.log" -c git2 -a coupling --min-revs 5 --min-shared-revs 3 --min-coupling 60` | step 3's pipeline, which is the definition of record |
| `git-of-theseus` | code survival and cohort ageing, for the trend narrative | `git-of-theseus-analyze . --outdir "$W/theseus"` (confirm flags with `--help`; the outdir must sit outside the repository) | `git log --diff-filter=A --format='%ad' --date=format:'%Y-%m' \| sort \| uniq -c` for a coarse creation-cohort curve |
| `git-quick-stats` | quick cross-check of the distributions | `git-quick-stats --detailed-git-stats` (confirm the flag with `--help`; its output carries **names**, mapped through the name keys of `$W/authors.map` before quoting) | the §4 pipelines, which already produce every number it shows |
| CodeScene | hotspots, coupling, knowledge maps, where already licensed | verify `cs --version` and confirm the subcommand set with `cs --help` before running anything | §4 in full; verify any CodeScene number against it, and its hosted tier is forbidden (§11) |

Everything below `git` is an accelerator: `git`, `awk` and the shell complete the audit alone. Acquisition follows `report-contract.md` §9, to which this audit adds nothing; an absent tool takes its fallback.

## 6. Analysis rules and thresholds

| # | Condition | Threshold | Severity | Origin |
|---|---|---|---|---|
| T1 | Hotspots are recorded unconditionally | top **10** by `HotspotScore` | **S4**, as the appendix table; it becomes a finding only by also crossing T2, T3 or T5 | requirements |
| T2 | Hotspot with disproportionate complexity | in the top 10 **and** complexity ≥ **2×** the repository median | **S2** | derived |
| T3 | Cross-module temporal coupling | ≥ **60%** coupling, the files in different modules — every such pair is reported, none filtered out; the finding unit is the **module pair**, its file pairs the evidence | **S2**; **S3** at `confidence: probable` when no constituent pair reaches **5** shared revisions, since one shared revision out of one cannot separate coupling from coincidence; **S4** when both files are generated from one source | derived |
| T4 | Same-module coupling | the same numbers, one module | **S4**, matrix only, never promoted | derived |
| T5 | Single knowledge holder — the family's definition of bus factor 1 (§3) | one identity > **70%** of a module's changed lines over `HISTORY_WINDOW` | **S1** in `CRITICAL_MODULES`, **S2** otherwise; **S3** when the module took under **200** changed lines in the window or `$W/recency.tsv` puts its last change over 12 months back; one further row, never above **S1**, when that identity's newest commit in `$W/recency.tsv` is over 90 days old | requirements |
| T6 | Risk concentration (the §9 score) | RC ≥ **60%** | **S3**; **S2** at RC ≥ **80%**; not filed at all when T2 or T5 already cover the same files | derived |
| T7 | Giant commits | share above `GIANT_COMMIT_LINES` or `GIANT_COMMIT_FILES` > **15%** | **S3**; **S2** above **30%**; suppressed on a squash-merge repository (§10.4) | derived |
| T8 | Median commit size | > **250** changed lines | **S3**, suppressed with T7 on a squash-merge repository | derived |
| T9 | Revert share | **2–5%** of commits | **S3**; **S2** above **5%** | derived |
| T10 | Fix-fix share | **5–10%** of the fix-type commits `$W/fixes.txt` counts | **S3**; **S2** above **10%** | derived |
| T11 | Mechanical churn dominates | excluded revisions carry ≥ **20%** of window churn | **S4**, plus a mandatory *Границы достоверности* entry, plus an **S3** recommendation to create `.git-blame-ignore-revs` where such revisions exist and the file does not | derived |

`report-contract.md` §5's reachability and position rules apply once on top of this table; for T3 either module being critical is enough, and T5, which states both positions itself, is never raised twice.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

- **Sampling unit:** the file. The `N` targeted reads are the top `N` of `$W/hotspots.tsv` by `HotspotScore`; modules enter through their files.
- **Control sample `C`:** drawn from files with ≥ 3 revisions outside the top `N` — a file with one revision cannot test the ranking.
- **Coupling cut:** file the top **20** module pairs of step 3's rollup by summed shared revisions; `$W/coupling.tsv` reaches *Приложения* whole and the report states how many pairs went unfiled.
- **Audit-specific early stop:** the contract's control-sample stop, additionally requiring at least **50** non-mechanical commits and a span of at least **90 days** before any finding from T6–T10
  may be filed; below either number, report structure and bus factor only, at `confidence: low`.
- **Confidence cap:** a shallow clone caps `confidence` at `medium` whatever the sample size — the window may be truncated invisibly.

## 8. Report additions

| Addition | Where it goes | Shape |
|---|---|---|
| Ranked hotspot table | full table in §7 *Приложения*; the top 10 quoted in §5 *Детальные находки* as the header of the hotspot findings | `$W/hotspots.tsv`: `rank, path, module, revisions, changed lines, complexity (proxy named), HotspotScore` |
| Temporal-coupling matrix | §7 *Приложения*, cross-module rows first | `$W/coupling.tsv`: `file A, module A, file B, module B, shared revisions, revisions A, revisions B, coupling %, cross-module` |
| Bus-factor map by module | a compact table in §5 *Детальные находки* beside the ownership findings; per-file ownership in §7 *Приложения* | `module, files, changed lines, top-identity share %, bus factor, last change, critical` — the date column from `$W/recency.tsv`; identities as `A01…An`, never names |
| Excluded mechanical revisions | §7 *Приложения* | `$W/sizes.txt` joined to step 1d: `sha, files, insertions, deletions, signal matched, excluded or kept after review` |
| Commit rhythm profile | §7 *Приложения* | median, p90 and maximum commit size; giant, revert and fix-fix counts and shares; merge versus squash workflow |

## 9. Score

**Risk concentration** — the share of change absorbed by the smallest part of the codebase, in **percent**, over `$W/churn.tsv` (after `EXCLUDE_PATHS` and `MECHANICAL_REVS`):

```sh
awk -F'\t' '{n++; v[n]=$2; t+=$2} END{k=int(0.05*n)+((0.05*n)>int(0.05*n)); if(k<1)k=1
  for(i=1;i<=k;i++) s+=v[i]; printf "RC %.1f%% (top %d of %d files)\n",100*s/t,k,n}' "$W/churn.tsv"
```

`RC = 100 × (changed lines in the top 5% of files by churn) / (changed lines in all files)`, the 5% being `ceil(0.05 × files_changed_at_least_once)`. Bands: under 30% change is diffuse; 30–50% ordinary; 50–70%
a small set of files absorbs most of the work; above 70% it has a single point of change and every delivery queues behind it. Justify by naming the top-5% file count, its modules, and whether those files also
carry bus factor 1 — concentration plus one knowledge holder is a different risk.

## 10. Failure modes of this audit

1. **A property of the code becomes a judgement of a person.** Bus factor is computed from authorship, and one careless sentence turns it into "developer X is a risk". *Countermeasure:* pseudonymise in step 1c
   before any aggregation; a sentence whose meaning changes when the identity becomes `A03` does not ship.
2. **Mass refactoring inflates churn, and the hotspot list becomes the list of files someone once reformatted.** *Countermeasure:* step 1d is mandatory; verify the churn top 20 by reading each candidate's
   diffstat before excluding it, record which survived, and match on the subject, never the whole message — a false positive below the top 20 is dropped unseen.
3. **Identity breaks twice over.** A renamed file looks young, so a refactored module leaves the ranking just when it deserves attention; and one person on two emails halves the share, so a bus factor of 1
   reads as 2. *Countermeasures:* step 1b's rename map with `git log --follow` per top-N file, and step 1c's `.mailmap`/`shortlog` review, merging duplicates before step 1f.
4. **Squash merges make the commit profile measure pull requests**, shifting median size, giant share and fix-fix rate by an order of magnitude. *Countermeasure:* detect the workflow in step 5, state it in
   *Методология*, and suppress T7–T8 of §6 rather than file a finding about a number that means something else.
5. **The window's edges and the bots decide the numbers.** A window opened after a rewrite shows a calm codebase; a bot can be a module's dominant identity. *Countermeasures:* plot the monthly commit count
   (`git log --since="$SINCE" --date=format:'%Y-%m' --format=%ad | sort | uniq -c`), name any discontinuity in *Границы достоверности*, recompute after it, and exclude `BOT_AUTHORS` in step 1e with its count.
6. **A silently empty pipeline reads as a healthy repository.** A mis-quoted pathspec, a `shortlog` with no range, an unset loop variable: each exits 0 with no output, and the metric arrives as a zero.
   *Countermeasure:* assert after step 1 that `$W/hist.tsv`, `$W/sizes.txt` and `$W/churn.tsv` are non-empty and of the order of the commit count — a zero is a broken command.

## 11. Audit-specific prohibitions

- **Never publish an identity.** No name, email, handle or per-author total in the report, the appendices, the register or the chat, including inside pasted tool output. `git shortlog`, `git-quick-stats` and
  `code-maat` emit identities, so `$W/authors.map` is keyed by email **and** by name (step 1c), `code-maat`'s log uses `%aE`, and `git blame`'s bracketed `author-mail` is stripped in step 4. Safe alternative:
  the ids `A01…An`, the mapping left in `WORK_DIR`.
- **Never rewrite, relocate or re-check-out history to make the analysis easier:** no `git filter-branch`, `filter-repo`, `rebase`, `commit`, `gc`, `repack`, `prune`, `reflog expire`, `checkout`, `switch`,
  `restore`, `stash`, `bisect`, no branch creation, and no `git config` write (`blame.ignoreRevsFile` mutates the project). Safe alternatives: `-M`, `-C`, `--follow` and `RENAME_MAP` for identity;
  `--ignore-revs-file=` on the command line; `git show <rev>:<path>` to read without moving `HEAD`.
- **Never extend history over the network:** no `git fetch`, `pull` or `fetch --unshallow` — they move refs in the audited repository. Safe alternative: record the shallow clone in *Границы достоверности* and
  ask the user for a full clone when the window matters.
- **Never write tool output inside the repository.** `code-maat`, `git-of-theseus` and every scratch file go to `WORK_DIR` (§2): a file left in the tree contaminates the churn signal later audits read.
- **Never send the log off the machine.** Commit messages carry ticket ids and customer detail; hosted services, CodeScene's cloud tier included, are excluded, and only a local instance may run.

## 12. Dependencies

**Input — A-01**, as a parameter value: a path to the finished report, or its values copied into `MODULE_MAP`, `CRITICAL_MODULES` and `EXCLUDE_PATHS`, with its single-author components as knowledge-holder
candidates for T5 to confirm or refute (§3). Without it the three derive from §2, and *Границы достоверности* records that the module decomposition is the auditor's.

**Output** — three artefacts, in four handoffs, each passed as a parameter value: the ranked hotspot list to **A-05**; that list plus the bus-factor map to **A-07**; the cross-module coupling pairs to **A-09**,
to test against the declared architecture; and the bus-factor map to **A-20**. `HOTSPOTS` is a ranking **of files** by `HotspotScore` over `HISTORY_WINDOW`, folded to modules by `MODULE_MAP`: a consumer that
needs modules aggregates this ranking and says so, and one deriving its own from churn alone labels it churn-only, not this population.

## 13. Nearest marvin command

`/marvin:refactor-audit` computes churn × file-size hotspots into a register under `.marvin/refactor/`; `/marvin:refactor-smells` scans one path or diff for smells into that same register format and computes no
churn at all. The boundary: the refactor family produces an actionable remediation register scoped to what to change next; A-04 produces measured distributions and trends over a declared window, plus the
coupling matrix, bus-factor map and commit profile neither of them computes. Use `refactor-audit` as an accelerator when its register is fresh, verifying its numbers against §4 before quoting any.
