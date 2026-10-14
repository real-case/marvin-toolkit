# A-09 — Границы модулей и граф зависимостей

> **Audit question.** Does the actual dependency structure match the declared architecture?

## 1. Role and task

An architecture auditor reconstructs the real import graph, restates the architecture's rules in a form a machine can evaluate, and measures the drift
between them. The report's `audit_name` is `Границы модулей и граф зависимостей`. A run also leaves the edge lists and metrics tables every number is
recomputable from, plus a **draft rule configuration for CI** — the artefact that turns a finding into a check preventing its return.

## 2. Audit-specific parameters

Fragments below assume `OUT="{{OUTPUT_DIR}}"`, `SRC="{{SCOPE_INCLUDE}}"` (`.` when unset), and the exclusion set of `report-contract.md` §2 in the
shape each fragment needs: `RG_EXCLUDE` for a ripgrep census, `GIT_EXCLUDE` for a git pathspec, `EXCLUDE_RE` for a path list already in hand. This
audit adds nothing to that set, and applies it before every derivation, count and fold: generated clients, vendored trees and committed bundles
invent cycles and fan-in that no authored file contains. The run completes with all seven unset, at lower `confidence`, each derivation listed under "выведено, не задано".

| Parameter | Meaning | Derivation when unset |
|---|---|---|
| `DECLARED_ARCHITECTURE` | documents and configs stating layers and the rules between them | three probes, plus any ADR corpus. Prose: `rg -l -i --hidden "${RG_EXCLUDE[@]}" -g 'README*' -g 'ARCHITECTURE*' -g 'CONTRIBUTING*' -g '**/docs/**' -e 'architecture' -e 'layer' -e 'boundar' . 2>/dev/null`. Machine, by content: `rg -l --hidden "${RG_EXCLUDE[@]}" -e 'dependency-cruiser' -e 'importlinter' -e 'no-restricted-paths' -e 'enforce-module-boundaries' -e 'ArchUnit' .`. Machine, by name, since such a config need not name its own tool: `rg --files --hidden "${RG_EXCLUDE[@]}" -g '.dependency-cruiser*' -g '.importlinter' -g '.eslintrc*' -g 'eslint.config.*'`. Both flags are load-bearing. File patterns go to ripgrep as `-g` and never to the shell: a bare `ARCHITECTURE*` matching nothing errors under bash and aborts the whole command under zsh. `--hidden` is where these configs live — `.dependency-cruiser.cjs`, `.importlinter`, `.eslintrc.*`, `.github/workflows/*` — and without it the probe returns empty on a repository that has them, fabricating the "architecture nowhere described" finding out of a missing flag. Found nothing: leave it empty — step 3 files the absence and derives rules. Never ask the user to invent an architecture, nor supply one from the auditor's taste |
| `MODULE_MAP` | file path → module, and module → layer | the workspace definition where one exists (`workspaces` in `package.json`, `pnpm-workspace.yaml`, `go.work`, Maven `<modules>`, Nx `project.json`, `pyproject.toml` packages); else fold each path to its first `MODULE_DEPTH` segments. Record the fold rule in *Методология*. Both A-04 inputs arrive at file granularity and are folded here, so A-04's own two-segment module fold never sets this audit's module unit |
| `MODULE_DEPTH` | segments that make a module in that fold; **read by the step-1 fold**, which takes it from the environment as `${MODULE_DEPTH:-2}` | `2` when the root has ≥ 3 immediate subdirectories, else `1`. The count is taken over the root itself, so run it inside `SCOPE_INCLUDE` when that is a subdirectory: `git -C "$SRC" ls-files -- . "${GIT_EXCLUDE[@]}" \| awk -F/ 'NF>1{print $1}' \| sort -u \| wc -l`, compared against 3 |
| `HOTSPOTS` | A-04's ranking of **files** by churn × size over its `HISTORY_WINDOW` (18 months by default), aggregated to modules here by `MODULE_MAP`; promotes god-module findings | derive with the contract's `GIT_EXCLUDE` already in the shell: `git log --no-merges --since='18 months ago' --name-only --pretty=format: -- . "${GIT_EXCLUDE[@]}" \| sed '/^$/d' \| sort \| uniq -c \| sort -rn \| head -50`, joined to file length from `git ls-files -- . "${GIT_EXCLUDE[@]}" \| xargs wc -l`. Label it in the report **churn only over 18 months, not A-04's churn × complexity rank and not the same population**, and drop `confidence` one step. Without that exclusion a committed bundle outranks every real module and promotes a god-module finding over generated code |
| `TEMPORAL_COUPLING` | A-04's co-changing file pairs | derived in step 6 by the rule stated there |
| `COMPONENT_REGISTER` | A-01's component list | the top-level directories of `SCOPE_INCLUDE` after §2's exclusions. It bounds **which directories enter the fold** and defines no unit of its own: the module unit, everywhere in this spec, is a row of `edges-modules.tsv` at `MODULE_DEPTH` |
| `CODE_METRICS` | A-05's per-file size and complexity, for ranking god modules | file count and total lines per module: `git ls-files -z -- . "${GIT_EXCLUDE[@]}" \| xargs -0 wc -l` folded by `MODULE_MAP` |

## 3. Scope

### In scope

The import graph at file and module level; cycles at both; the rules the declared architecture states and whether each is machine-evaluated; layer
leaks; coupling metrics (fan-in/out, instability, god modules); hidden coupling seen only in co-change; and whether a CI check exists and blocks.

### Out of scope

| Excluded | Covered by |
|---|---|
| Code quality inside a module — complexity, duplication, dead code, unit sizes | A-05; query shape, N+1 included, is A-15's alone and is filed on no row here |
| Whether the type system enforces the boundary (`any` at seams, structural leaks); contract shape across a service boundary | A-06; A-11 |
| Frontend-internal layering — state, routing, component duplication | A-13, which takes this audit's graph as input |
| Runtime coupling leaving no import edge — HTTP calls, queues, shared tables | A-12 for failure behaviour, A-10 for shared schema. A-09 records the blind spot in *Границы достоверности* and never calls a module pair independent on graph evidence alone |
| Bundle size and load-time cost of the graph; security of the pipeline running the check; module ownership and knowledge concentration | A-15; A-17, since A-09 asks only whether the check exists and blocks; A-04 (bus factor) and A-20 |

## 4. Collection protocol

Seven steps in this order. Everything is written under `$OUT`, never into the repository.

**1. Build the graph at file and module level.** Produces `import-lines.txt`, `specifiers.tsv`, the resolution triple `edges-files.tsv` /
`edges-external.tsv` / `unresolved.txt`, then `edges-modules.tsv`.

```sh
mkdir -p "$OUT"
rg -n --no-heading "${RG_EXCLUDE[@]}" -e '^\s*(import|from|use|#include)\s' -e 'require\(' "$SRC" > "$OUT/import-lines.txt"
awk -F: -v q="'" '{ if (match($0, "[\"" q "<][^\"" q "<>]+[\"" q ">]")) print $1 "\t" $2 "\t" substr($0, RSTART+1, RLENGTH-2) }' "$OUT/import-lines.txt" > "$OUT/specifiers.tsv"
```

The **resolution pass** is the one part no fixed command performs: it reads the project's own alias configuration — `compilerOptions.paths`, a bundler
`resolve.alias`, package roots in `setup.cfg` or `pyproject.toml`, the module path in `go.mod`. Classify each row of `specifiers.tsv`: resolving
inside the repository → `edges-files.tsv` (`source file`, `target file`, `source line`); to a third-party package → `edges-external.tsv`; neither →
`unresolved.txt`. Record the **resolution rate** = resolved / (resolved + unresolved), which the report must carry. Cost: resolution, not extraction,
is the expensive part; a §5 tool replaces the whole step.

```sh
awk -F'\t' -v d="${MODULE_DEPTH:-2}" 'BEGIN{OFS="\t"} {n=split($1,a,"/"); s=a[1]; for(i=2;i<=d&&i<=n-1;i++) s=s"/"a[i]; m=split($2,b,"/"); t=b[1]; for(i=2;i<=d&&i<=m-1;i++) t=t"/"b[i]; if (s!=t) print s,t}' "$OUT/edges-files.tsv" | sort -u > "$OUT/edges-modules.tsv"
```

**2. Enumerate every elementary cycle, with length and members.** Rooting each search at the cycle's smallest member yields every cycle exactly once;
an edge-dropping pass prints one cycle per edge it removes and loses every other cycle running through that edge, so §6's S2 count and its ordering
would both be wrong and the under-count invisible. `lim` bounds a tangled graph, and when it is reached the count is reported as `≥ lim`, never
invented. Produces `cycles-modules.txt`, rows `<length> <members>` longest first; rerun on `edges-files.tsv` for `cycles-files.txt`, never merging the
two levels.

```sh
python3 - "$OUT/edges-modules.tsv" 2000 > "$OUT/cycles-modules.txt" <<'PY'
import sys, collections; sys.setrecursionlimit(10000); g = collections.defaultdict(set)
for L in open(sys.argv[1], encoding="utf-8"):
    a, _, b = L.rstrip("\n").partition("\t")
    if b: g[a].add(b); g[b]
lim = int(sys.argv[2]); rank = {n: i for i, n in enumerate(sorted(g))}; out = []
def walk(s, v, path, on):
    for w in sorted(g[v]):
        if len(out) >= lim or rank[w] < rank[s]: continue
        if w == s and len(path) > 1: out.append(list(path))
        elif w not in on: on.add(w); path.append(w); walk(s, w, path, on); path.pop(); on.remove(w)
for s in sorted(g, key=rank.get): walk(s, s, [s], {s})
for c in sorted(out, key=lambda c: (-len(c), c)): print(len(c), " ".join(c))
if len(out) >= lim: sys.stderr.write("limit %d reached; report the count as >= %d\n" % (lim, lim))
PY
```

**3. State the rules, check each mechanically, write the CI draft.** From `DECLARED_ARCHITECTURE` write one row per rule into `rules.tsv`, carrying
§8's draft columns plus the rule's `doc:line` and whether its command runs in CI. Evaluate each against `edges-modules.tsv` — an `awk -F'\t'` match on
the two globs suffices without a rule tool — into `violations.tsv`: rule id, offending `file:line`, source and target module. **If no architecture is
documented anywhere, file that as a finding** at the §6 severity and derive the rules from the observed structure — the layers `MODULE_MAP` implies,
the directions already dominating the edge counts — marking each `confidence: hypothesis`. This step also writes the single rule artefact
`$OUT/A-09-rules-draft.<ext>` (§8), in the syntax of the tool the project already has; §5's rule-validation invocations run **after** it, against that
file. Produces `rules.tsv`, `violations.tsv`, that draft, and §9's `R_total` / `R_ci`. Cost: the largest step; most targeted reading goes here.

**4. Find layer leaks.** Three probes over step 1's folded edges, substituting the project's own layer names for the illustrative ones. The layer is
matched as any **path segment** of the row, never as the start of it: at `MODULE_DEPTH` 2 the modules are `src/ui` and `src/domain`, an anchored `^ui`
matches neither, and `edges-external.tsv` is file-level besides — a silent false clean. Appends to `leaks.tsv`, each row tagged with its leak kind and
confirmed by opening the offending file before it becomes a finding. Cost: minutes per row.

```sh
: > "$OUT/leaks.tsv"
awk -F'\t' 'function seg(x,re,  n,a,i){n=split(x,a,"/"); for(i=1;i<=n;i++) if(a[i] ~ re) return 1; return 0} seg($1,"^(ui|web|app|pages|components)$") && $2 ~ /(repositor|dao|db|orm|prisma|sqlalchemy|entit|migration|data|persistence|storage)/ {print "ui-to-data\t"$0}' "$OUT/edges-modules.tsv" >> "$OUT/leaks.tsv"
awk -F'\t' 'function seg(x,re,  n,a,i){n=split(x,a,"/"); for(i=1;i<=n;i++) if(a[i] ~ re) return 1; return 0} seg($1,"^(domain|core|entities|model)$") {print "domain-to-framework\t"$0}' "$OUT/edges-external.tsv" >> "$OUT/leaks.tsv"
awk -F'\t' 'function seg(x,re,  n,a,i){n=split(x,a,"/"); for(i=1;i<=n;i++) if(a[i] ~ re) return 1; return 0} seg($1,"^(shared|common|lib|utils|kernel)$") && !seg($2,"^(shared|common|lib|utils|kernel)$") {print "shared-to-feature\t"$0}' "$OUT/edges-modules.tsv" >> "$OUT/leaks.tsv"
```

**5. Coupling metrics.** Fan-in, fan-out and instability `I = Ce / (Ca + Ce)` per module into `metrics.tsv`, which with the §6 threshold yields the
god-module candidate list, ranked by `CODE_METRICS` where supplied; plus `modules.dot` for §5's renderer. Cost: seconds.

```sh
awk -F'\t' '{o[$1]++;i[$2]++;n[$1];n[$2]} END{for(m in n) printf "%s\t%d\t%d\t%.2f\n",m,i[m],o[m],(i[m]+o[m]?o[m]/(i[m]+o[m]):0)}' "$OUT/edges-modules.tsv" | sort -k2,2nr > "$OUT/metrics.tsv"
{ echo 'digraph G {'; awk -F'\t' '{printf "  \"%s\" -> \"%s\";\n",$1,$2}' "$OUT/edges-modules.tsv"; echo '}'; } > "$OUT/modules.dot"
```

**6. Cross with temporal coupling.** Use `TEMPORAL_COUPLING` when A-04 supplied it; otherwise derive it from `git log --no-merges --since='18 months
ago' --pretty=format:%H --name-only` by grouping file names under each SHA, dropping names matching `EXCLUDE_RE`, discarding commits touching over 30
files as mechanical, computing `joint / min(changes_a, changes_b)` per **file pair**, keeping pairs with ≥ 5 joint changes, and recording the script
in *Приложения*. Then subtract the graph: a pair above the §6 ratio with **no** edge either way is hidden coupling through data or convention, and
goes to `hidden-coupling.tsv` in §8's shape — **including pairs whose two files sit in one module**, tested against `edges-files.tsv` rather than
`edges-modules.tsv`, because §6 grades the two populations separately and dropping the same-module pairs would discard half of what this step
measures. Cost: minutes, bounded by the history window, not by repo size.

**7. Check for automatic enforcement in CI.** Named paths and hidden ones both, so `.github/` workflows are not skipped. Decide per hit whether it
**blocks**: a step carrying `continue-on-error: true`, `allow_failure` or `|| true` does not. Produces `ci-checks.tsv` in §8's shape. Cost: minutes.

```sh
rg -n -i --hidden "${RG_EXCLUDE[@]}" -g '.github/**' -g '.circleci/**' -g '.gitlab-ci.yml' -g 'Jenkinsfile' -g 'azure-pipelines.yml' -g 'Makefile' -g 'package.json' -g '.pre-commit-config.yaml' -e 'depcruise|dependency-cruiser|lint-imports|import-linter|madge|enforce-module-boundaries|no-restricted-paths|archunit' . 2>/dev/null
```

## 5. Tools

Accelerators only. Every tool here is acquired under `report-contract.md` §9's policy; the fallback column is what runs when it cannot be.

| Tool | What it measures | Invocation | Fallback |
|---|---|---|---|
| `dependency-cruiser` | JS/TS graph and rule validation | **only where §2's probes found a `.dependency-cruiser.*` in the project** — that file *is* `DECLARED_ARCHITECTURE`, and the graph run inherits its rules: `npx --no-install depcruise --config <that file> "$SRC" --output-type json > "$OUT/dc-graph.json"`, or `npx --yes --package=dependency-cruiser@18.2.0 depcruise …` under §9; rule validation only **after step 3**, as `--config "$OUT/A-09-rules-draft.cjs" --output-type err`. With no project config the run exits 1 without `--config`, and with `--no-config` exits 0 having cruised 0 TS modules — the extensions come from the config §11 forbids writing — so **a graph of 0 modules is an absent tool**, not an empty one | `madge`, then step 1's `rg` extractor |
| `madge` | JS/TS cycles and orphans | `npx --no-install madge --extensions ts,tsx,js,jsx --circular --json "$SRC" > "$OUT/madge-circular.json"`, or `npx --yes madge@8.0.0 …` under §9 — A-13's pinned version, and pinning the same one is what keeps a machine with no project copy from handing this audit and A-13 different edges for the same tree; whole graph with `--json`, orphans with `--orphans` | `dependency-cruiser`, then steps 1–2 |
| Nx workspace config | monorepo project graph and tag rules | **read, never run.** `nx graph` writes `.nx/cache` and `.nx/workspace-data` into the audited tree and starts a daemon whatever `--file=` points at, so the accelerator is unavailable under §11 — read `nx.json` (tag rules, `targetDefaults`, `namedInputs`), each `project.json`, and the root `workspaces` list | step 1's generic `MODULE_DEPTH` fold, when there is no `nx.json` or it declares no projects |
| `import-linter` | Python layer contracts | **after step 3**: `lint-imports --config "$OUT/A-09-rules-draft.ini"`, in the project's existing environment | `rg` on `^\s*(import\|from)\s` plus the step 4 probes |
| ArchUnit and analogues (`ArchUnitNET`, `Konsist`, `Deptrac`); `jdeps` | JVM/.NET/PHP layer rules written as tests; JVM package deps from build output that **already exists** | **read, never run**: `rg -n -e 'layeredArchitecture\(\)' -e 'noClasses\(\)' -e 'classes\(\)\.that' -g '*.java' -g '*.kt' -g '*.cs' .` — what it finds *is* `DECLARED_ARCHITECTURE`; `jdeps -summary <existing-artefact>.jar` when a built jar is already on disk | grep `^package` / `^import` declarations and fold by `MODULE_MAP` |
| `go list` | Go package graph | `go list -mod=readonly -f '{{.ImportPath}} {{join .Imports " "}}' ./...`; module level with `go mod graph` | `rg -n '^\s*"' -g '*.go'` inside import blocks |
| `ripgrep`, `awk`, `tsort`, `python3` | the universal fallback: extraction, fold, metrics, cycles | steps 1, 2, 4, 5, 6 | `grep -REn` when ripgrep is absent; `cut -f1,2 "$OUT/edges-modules.tsv" \| tr '\t' ' ' \| tsort` reports loop members on stderr when python3 is absent, and the cycle *count* is then reported as unknown rather than invented |
| `dot` (graphviz) | rendering the module graph | `dot -Tsvg "$OUT/modules.dot" -o "$OUT/modules.svg"`, over the file step 5 wrote | the Mermaid `flowchart LR` block of §8; no binary needed |

## 6. Analysis rules and thresholds

| Condition | Threshold | Severity | Origin |
|---|---|---|---|
| Cycle among rows of `edges-modules.tsv` | ≥ 1 elementary cycle of ≥ 2 modules | **S2** per cycle, longest first | requirements |
| Edge denied by a stated rule (layer violation) | ≥ 1 violating edge | **S2**, one finding per rule violated, not per edge | requirements |
| No automatic boundary check in CI | 0 blocking checks | **S2** | requirements |
| Boundary check present but non-blocking | ≥ 1 non-blocking check | **S2**; counts as absent in §9's `R_ci` | derived |
| God-module candidate | module fan-in > 30 | **S3**; → **S2** when it also sits on a cycle, carries a violation, or appears in `HOTSPOTS` | derived |
| Architecture nowhere described | 0 documents and 0 rule configs | **S3**; → **S2** when the derived rules already show ≥ 1 violation or ≥ 1 module cycle | derived |
| Cycle among files inside one module | ≥ 1 | **S3**, aggregated to one finding per module | derived |
| Hidden coupling across modules: co-change with no edge | ratio ≥ 0.60, ≥ 5 joint changes, modules differ | **S3**; → **S2** when the pair spans a declared layer boundary | derived |
| Hidden coupling inside one module: co-changing file pair with no edge in `edges-files.tsv` | ratio ≥ 0.60, ≥ 5 joint changes, same module | **S4**, aggregated to one finding per module | derived |
| Unstable module others depend on | `I > 0.7` and fan-in ≥ 5 | **S4** metric row; → **S3** only when that module also carries a rule violation | derived |

Three rules sit above every row. A violation whose only reachable source is a test, story, fixture or script file counts in `V_test`, not `V` (§9).
A *derived* rule cannot exceed **S3**: an undeclared rule is a hypothesis about intent until the team confirms it. A cycle is the exception — a
property of the graph, needing no rule. Unresolved import specifiers are not a finding on any row: above 5% of the extracted specifiers they cap the
report's `confidence` at `medium`, above 20% at `low`.

**This audit's ceiling is S2.** No row reaches S1 or S0: a boundary defect makes change slow and regressions likely, and the incident, breach or
data-loss consequences that would justify a higher row are filed by the audits that own those paths, on their own evidence.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

The sampling unit is the **module** as `MODULE_MAP` defines it. The graph is an aggregate over 100% of in-scope files and is never sampled; sampling
governs only the targeted reading that confirms findings. Rank the top `N` by: longest cycles, most violating edges, highest fan-in, presence in
`HOTSPOTS`. Draw the control sample `C` from modules with no cycle and no violation — it answers whether they are genuinely clean or whether the
extractor missed their edges. `coverage` is recorded at module granularity with the file count it covers. Audit-specific early stop: the contract's
control-sample stop, additionally requiring a resolution rate at or above 95% — an incomplete graph makes a clean result unfalsifiable.

## 8. Report additions

| Addition | Where | Shape |
|---|---|---|
| Module graph | §7 *Приложения* | a Mermaid `flowchart LR` at module level, edges on a cycle or violating a rule annotated `R-<n>`, plus `edges-modules.tsv` verbatim. Above 40 modules render only modules on a cycle or carrying a violation, and state how many were elided |
| Rule-violation table with the offending file | §5 *Детальные находки*, full list in §7 | under each rule's finding: rule id, statement, machine form, violating-edge count, and the ten worst offenders as `file:line → target module`. Past 20 violations the full table moves to *Приложения*, the finding naming the count and pointing there |
| Draft machine-checkable rule set for CI | §7 *Приложения*, and as `{{OUTPUT_DIR}}/A-09-rules-draft.<ext>`, written by step 3 | per rule: id, statement, machine form, evaluating tool, exact command, the pipeline step to add, and whether adopting it fails the build today. Written in the syntax of the tool the project already has |
| Cycle inventory | §7 | level (module/file), length, members, the cheapest edge to break, and the `lim` value when step 2 reached it |
| Coupling metrics | §7 | module, fan-in, fan-out, instability, files, god-module flag |
| Hidden-coupling pairs | §7 | ratio, joint changes, both files, both modules, `same module: yes/no`, `edge: yes/no` |
| CI check inventory | §7 | check, `file:line`, tool, rules covered, blocking yes/no |

## 9. Score

*Итоговая оценка* reports two numbers as a pair, never one without the other. **V — rule violations**, unit: violating import edges deduplicated on
`(source file, target module)`, with test-, fixture- and script-sourced edges counted separately as `V_test`, outside `V`. **E — machine-checked rule
share**, `E = R_ci / R_total`, where `R_total` is every rule in `rules.tsv` (declared plus derived) and `R_ci` the subset evaluated by a check that
runs in CI **and fails the pipeline**; a non-blocking check contributes 0. Unit: a fraction, with both counts and a percentage.

Headline form: `V = 47 violating edges across 6 of 9 rules; V_test = 12; E = 2/9 machine-checked (22%)`. Justify it by naming the largest contributor
to `V`, whether the rules were declared or derived, and the `E` the §8 draft would produce if adopted. Where the architecture was undocumented, add
that `E`'s denominator is the derived set: a derived `E = 100%` is no compliance claim, only a statement that the code agrees with rules nobody wrote
down.

## 10. Failure modes of this audit

| How this audit produces a false result | Countermeasure |
|---|---|
| Rules stated as prose no tool can evaluate ("the UI must not touch the database"): the report reads as complete, nothing prevents the next violation, and `V` cannot be recomputed | every `rules.tsv` row carries a machine form and the command evaluating it; a rule resisting both is filed **S4** as human-reviewed, and still counted in `R_total` so it depresses `E` |
| No CI draft, so the finding never becomes a defence and the violation returns next quarter | the §8 draft is a release condition of this audit; without it, report `E` and say plainly that no path to raising it was delivered |
| An incomplete graph makes a dirty layer look clean: dynamic imports, DI containers, reflection, string-keyed registries and unresolved aliases all hide edges | publish the resolution rate, apply the §6 confidence cap, and never call a layer clean without naming that rate in the same sentence |
| A probe that cannot match reports a clean layer: a pattern anchored to the start of a folded module name, a shell glob that matched no file, a hidden config never searched | the segment match of step 4, and ripgrep `-g` patterns with `--hidden` in §2 and step 7; before reporting zero leaks, confirm each probe returns rows on one known-bad edge |
| Barrel files fabricate edges — `A → index → C` reads as a direct `A → C`, inflating violations and fan-in | resolve re-exports to their origin before folding; where tooling cannot, flag barrel-mediated edges and keep them out of `V` unless the file was opened |
| A file-level mutual import inside one package is reported as a broken boundary | the two levels are computed and reported separately, and §6's S2 cycle row is written against `edges-modules.tsv` at `MODULE_DEPTH`, the one module unit this spec uses |
| The auditor's preferred architecture is substituted for the project's — hexagonal, clean, feature-sliced are choices, not standards | every rule cites its `doc:line`; uncited rules are derived, capped at S3, registered `confidence: hypothesis` |
| Generated clients, protobuf output and vendored trees invent cycles and giant fan-in; test and tooling code, which legitimately crosses layers, inflates the count into alarm | apply §2's exclusion set before building the graph **and inside every parameter derivation**, stating the filter beside every metric; and split `V` from `V_test` per §9 |

## 11. Audit-specific prohibitions

- **Do not add or edit a boundary-rule configuration in the project** — no `.dependency-cruiser.cjs`, `.importlinter`, `setup.cfg` section, ESLint
  change or ArchUnit test; the draft stays in `{{OUTPUT_DIR}}`.
- **Do not build, test, or execute project code to feed a tool** — no `tsc`, `mvn package`, `gradle build`, `nx build`, `go build -o` (they write into
  `dist/`, `target/`, `build/`), and no import-time tracing, `python -c "import app"`, DI boot or dev server, whose side effects open connections,
  write files and in some projects run migrations. `jdeps` reads only an artefact already on disk, ArchUnit rules are read as source.
- **Do not run a graph tool that caches into the workspace.** `madge --image`, `dot -o` and every redirect point inside `{{OUTPUT_DIR}}`, which is
  enough for them. `nx graph` has no such setting: it writes `.nx/cache` and `.nx/workspace-data` and starts a daemon whatever `--file=` points at, so
  it is not run here at all and §5 reads the workspace config instead. `nx reset` and deleting `.nx/`, `node_modules/.cache` or `__pycache__` are
  mutations — read what is there and note its staleness.
- **Do not read a boundary exemption as permission.** An `.eslintrc` override or a `dependency-cruiser` `allowed` entry excusing a directory is
  evidence about the architecture the project actually practises; an exemption carrying no rationale is itself a finding.

## 12. Dependencies

**Input**, all as parameter values per the contract's execution model, never as remembered context: **A-01** → `COMPONENT_REGISTER`, `SCOPE_INCLUDE`,
`SCOPE_EXCLUDE` (which directories enter the fold); **A-04** → `HOTSPOTS` and `TEMPORAL_COUPLING` (the ranking that promotes god modules in §6, and
step 6's co-change input); **A-05** → `CODE_METRICS` (for ranking god-module candidates). A missing input is derived by §2's rules under
`audit-index.md`'s never-block rule. **Output** — the graph and rules, consumed by **A-13**: `edges-modules.tsv` and `edges-files.tsv` restricted to
the client tree, `rules.tsv`, `metrics.tsv`, and the `F-A09-<NN>` ids A-13's frontend findings may list in `blocked_by`.

## 13. Nearest marvin command

`/marvin:refactor-audit` covers adjacent ground: it maps architecture and reports dependency tangles as a remediation register under
`.marvin/refactor/`. The boundary is what the graph is measured against — `refactor-audit` ranks tangles by remediation value, while A-09 checks the
graph against the architecture the project **declared**, scores how much of it a machine enforces, and drafts the rule configuration that closes the
gap. Its register may accelerate the tangle list; every row taken from it is re-derived from `edges-modules.tsv` before becoming evidence here.
