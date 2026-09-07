# A-13 — Фронтенд-архитектура

> **Audit question.** Does the client scale, or does every new feature add entropy?

## 1. Role and task

You audit the client half of the product — state, server access, rendering, components, styles, routing, forms — and close one question: whether the next
ten features cost what the last ten cost. Every judgement is a counted consequence; a library or pattern preference is preference under
`report-contract.md` §5. A run leaves the four registers of §8, three of which A-15 and A-21 take as parameter values.

**Skipped when the project has no client** (`audit-index.md`): `git ls-files -- '*.tsx' '*.jsx' '*.vue' '*.svelte' '*.html'` and
`rg -l -e '"(react|preact|vue|svelte|solid-js|@angular/core|lit)"' -g 'package.json'` both empty means no report, not an empty one.

## 2. Audit-specific parameters

On top of the ten in `report-contract.md` §2. The run completes with all five empty.

| Parameter | Meaning | Derivation when unset |
|---|---|---|
| `CLIENT_ROOT` | the paths holding the client tree, held as a **shell array** — a monorepo has several and every consumer below expands `"${CLIENT_ROOT[@]}"` | the shallowest directories containing the component files found above, minus `SCOPE_EXCLUDE`; in a monorepo, every workspace whose manifest depends on a UI framework (`jq -r '.workspaces[]?' package.json`) |
| `FRONTEND_STACK` | framework and major, build tool, language | `jq -r '(.dependencies // {}) + (.devDependencies // {}) \| to_entries[] \| "\(.key)@\(.value)"' package.json`, the lockfile for the resolved major, and `git ls-files \| rg -e '(^\|/)(vite\|next\|nuxt\|svelte\|astro\|webpack)\.config\.' -e '(^\|/)angular\.json$'` — a listing filtered by `rg`, never a bare `ls <glob>`, which aborts the whole command under `zsh` the moment one pattern has no match. Recorded as *выведено, не задано* |
| `RENDERING_MODE` | CSR / SSR / SSG / streaming / islands, and where the boundary sits | derived in step 3 from framework config and its markers; when the tree shows two modes, record both and which routes use each, never one label |
| `DESIGN_SYSTEM` | the token source and the component library meant to be authoritative; the token source resolves to the `TOKEN_SRC` / `TOKEN_EX` glob **arrays** of §4 | the UI-library dependencies above plus `git ls-files \| rg -i -e 'tokens\|theme\|design-system\|tailwind\.config'`. With nothing authoritative the value is `none`, T3 is measured against whatever token set exists, and that emptiness is itself the finding |
| `CORE_ENTITIES` | the entities whose sources of truth are counted for the score | the most frequent server-cache keys and domain type names from step 1, top 10 by call-site count. Ask the user only when the repository names no entity recognisably and the score would rest on invented nouns; with no answer use the top 10 and label it an estimate |

## 3. Scope

**In scope.** The seven subjects of §4, measured as its protocol defines them: state in every store; the server-access layer, its caching, races and
loading/error system; rendering, the client/server boundary and hydration; components (reuse, duplication, props, size, dead code); styles against the
tokens; routing (guards, unknown paths, splitting); forms validated on both sides.

**Out of scope.** Latency, byte budgets, any millisecond judgement → A-15, which takes the route table; this audit reports counts and structure only.
Screen readers, contrast, focus order, keyboard operability → A-21, which takes the component catalogue. The client's dependency graph and rules →
A-09; prop and API-model type correctness → A-06; duplication outside `CLIENT_ROOT` → A-05, recomputed here over `CLIENT_ROOT`; handler shape and
versioning → A-11; exploitability of guards and client-only validation → A-14, which gets the row; UI dependency currency and licences → A-03; client
failures in telemetry → A-16. **Component file length under `CLIENT_ROOT` stays here** (T10, its own 400/800 bands): A-05 excludes the client tree from
its file-length rows, so one file cannot cross two audits' bands at once.

## 4. Collection protocol

Seven ordered steps: aggregates over 100% of `CLIENT_ROOT` first, then targeted reading of the ranked top `N` (§7). Patterns are the React/Vue/Svelte/Angular
families; substitute `FRONTEND_STACK`'s equivalents and record that in *Методология*, deriving it **before** step 1 — §10 item 7 is the cost of a wrong one.
Paste `report-contract.md` §2's canonical `RG_EXCLUDE` and `EXCLUDE_RE` once per session, verbatim and never re-encoded; the block below adds only this audit's
own, and every `rg` and `git` census below carries them by name. **An include glob is written before the exclusion arrays**: ripgrep resolves a path by the LAST
`-g` that matches it, so a trailing `-g '*.{ts,tsx}'` re-admits the whole of `dist/` — measured on ripgrep 15.1.0, not assumed. Git listings filter through
`EXCLUDE_RE`, never a `:(exclude)` pathspec: on git 2.50.1 an exclude beside a multi-segment path like `packages/web` left one listing unfiltered, another empty.
```sh
RG_EXCLUDE+=( -g '!**/.next/**' -g '!**/storybook-static/**' -g '!**/coverage/**' ) ; EXCLUDE_RE=$EXCLUDE_RE'|(^|/)(\.next|storybook-static|coverage)/'   # this audit's ADDITIONS: client build output
CLIENT_ROOT=( packages/web packages/admin )   # §2; one element in a single-package repo, every element passed to every tool below
TOKEN_SRC=( -g '**/tokens.*' -g '**/theme/**' -g '**/tailwind.config.*' ) ; TOKEN_EX=( -g '!**/tokens.*' -g '!**/theme/**' -g '!**/tailwind.config.*' )   # what DESIGN_SYSTEM resolves to, as includes and as exclusions
cfiles() { git ls-files -- "${CLIENT_ROOT[@]}" | rg -v -e "$EXCLUDE_RE" ; }   # the tracked, contract-filtered client files; every git census below reads it
```

**1. State: every storage mechanism, and the same datum held in more than one.** Produces the **state map** (one row per
`CORE_ENTITIES` entity × mechanism, each cell carrying its writer's `path:line`) and the per-entity source-of-truth count feeding T1
and §9. One census **per mechanism family**, in the state map's column order: a merged run names neither mechanism nor writer.
```sh
rg -n --no-heading -g '*.{ts,tsx,js,jsx,vue,svelte}' "${RG_EXCLUDE[@]}" -e 'useQuery|useMutation|useSWR|useFetch|useAsyncData|createApi|urql' "${CLIENT_ROOT[@]}"   # серверный кэш
rg -n --no-heading -g '*.{ts,tsx,js,jsx,vue,svelte}' "${RG_EXCLUDE[@]}" -e 'configureStore|createSlice|createContext|defineStore|writable\(|atom\(|makeAutoObservable|signal\(' "${CLIENT_ROOT[@]}"   # глобальное
rg -n --no-heading -g '*.{ts,tsx,js,jsx,vue,svelte}' "${RG_EXCLUDE[@]}" -e 'useState|useReducer|\bref\(|reactive\(|\$state' "${CLIENT_ROOT[@]}"   # локальное
rg -n --no-heading -g '*.{ts,tsx,js,jsx,vue,svelte}' "${RG_EXCLUDE[@]}" -e 'useSearchParams|URLSearchParams|router\.query|\$route\.query|useParams' "${CLIENT_ROOT[@]}"   # URL
rg -n --no-heading -g '*.{ts,tsx,js,jsx,vue,svelte}' "${RG_EXCLUDE[@]}" -e 'localStorage|sessionStorage|indexedDB|document\.cookie' "${CLIENT_ROOT[@]}"   # storage
rg -o --no-filename -g '*.{ts,tsx,js,jsx}' "${RG_EXCLUDE[@]}" -e 'queryKey: *\[[^\]]*\]' "${CLIENT_ROOT[@]}" | sort | uniq -c | sort -rn | head -30
```

**2. Server access: one layer or scattered calls; caching and invalidation; races and cancellation; loading and errors as a system.** Produces the
**layer ratio** (the share of call sites inside the access layer), an invalidation table per cache key, the flows where a superseded response overwrites
a newer one (T6), the share of call sites with no error branch (T7), and the **inventory of loading- and error-presentation approaches** (T17): a
boundary, an inline branch, a toast and a router `errorElement` are four systems for one job.
```sh
rg -c -g '*.{ts,tsx,js,jsx,vue,svelte}' "${RG_EXCLUDE[@]}" -e '\bfetch\(|axios\.|\$fetch\(|XMLHttpRequest|\bky\.|\bgot\(' "${CLIENT_ROOT[@]}" | sort -t: -k2 -rn
rg -n "${RG_EXCLUDE[@]}" -e 'apiClient|httpClient|createApi|baseQuery|interceptors\.' -e 'staleTime|gcTime|invalidateQueries|revalidatePath|revalidateTag|refetch\(|mutate\(' -e 'AbortController|AbortSignal|cancelToken|takeLatest|switchMap|debounce' "${CLIENT_ROOT[@]}"
rg -o --no-filename -g '*.{ts,tsx,js,jsx,vue,svelte}' "${RG_EXCLUDE[@]}" -e 'ErrorBoundary|errorElement|useErrorBoundary|onErrorCaptured' -e 'toast\.error|notification\.error|setError\(|serverError' -e '<Suspense|isLoading|isPending|<Skeleton|Spinner' "${CLIENT_ROOT[@]}" | sort | uniq -c | sort -rn
```

**3. Rendering: where it runs, the client/server boundary, hydration, request waterfalls.** Produces the rendering map per route, the boundary-marker count, the
client-only globals reachable on a server path (T9), the sequential dependent fetches (T8) and the **hydration cell** of the route table (T18) — a render-body
value that cannot agree between the two renders. Command 2 says which routes the cell applies to; a command-4 hit inside an effect is not a mismatch, and is read before it is filed.
```sh
rg -c -g '*.{ts,tsx,js,jsx}' "${RG_EXCLUDE[@]}" -e "^['\"]use (client|server)['\"]" "${CLIENT_ROOT[@]}"
rg -l "${RG_EXCLUDE[@]}" -e 'getServerSideProps|getStaticProps|generateStaticParams|renderToString|renderToPipeableStream|hydrateRoot|createSSRApp|ssr: *(true|false)|prerender' "${CLIENT_ROOT[@]}"
rg -n -g '*.{ts,tsx,js,jsx,vue,svelte}' "${RG_EXCLUDE[@]}" -g '!**/*.{test,spec}.*' -e '\bwindow\.|\bdocument\.|localStorage|navigator\.' "${CLIENT_ROOT[@]}"
rg -n -g '*.{ts,tsx,js,jsx,vue,svelte}' "${RG_EXCLUDE[@]}" -e 'Date\.now\(|new Date\(|Math\.random\(|toLocaleString|toLocaleDateString|crypto\.randomUUID' "${CLIENT_ROOT[@]}"
rg -U -n -g '*.{ts,tsx,js,jsx,vue,svelte}' "${RG_EXCLUDE[@]}" -e 'await [^\n]{0,120}\n[^\n]{0,160}await ' "${CLIENT_ROOT[@]}"
```

**4. Components: reuse share, duplicate implementations of one entity, prop depth, largest files, dead code.** Produces the
**duplicate-component catalogue** from the primitive-name grep below; the top 30 by size; the in-degree §9 turns into the reuse index; the prop-forwarding
chains, read from `rg -n -A 30 -e 'interface [A-Z][A-Za-z]*Props' <file>` and traced with `rg -n -w '<prop>'`; and the **dead-code list** of §8 from `knip` (T19), rows confirmed by reading.
```sh
git ls-files -z -- "${CLIENT_ROOT[@]}" | rg --null-data -v -e "$EXCLUDE_RE" | rg --null-data '\.(tsx|jsx|vue|svelte)$' | xargs -0 wc -l | grep -v ' total$' | sort -rn | head -30
cfiles | rg '\.(tsx|jsx|vue|svelte)$' | sed 's#.*/##; s/\.[^.]*$//' | sort | uniq -d
cfiles | rg '\.(tsx|jsx|vue|svelte)$' | rg -i -e '(button|modal|dialog|input|select|dropdown|card|table|toast|spinner)'
npx --no-install madge --extensions ts,tsx,js,jsx,vue --json "${CLIENT_ROOT[@]}" > "$OUTPUT_DIR/graph.json" && jq -r 'to_entries[] | .value[]' "$OUTPUT_DIR/graph.json" | sort | uniq -c | sort -rn | head -40
npx --no-install knip --reporter json --no-progress > "$OUTPUT_DIR/knip.json"
```

**5. Styles: the design system against arbitrary values.** Produces unique-colour and unique-spacing counts taken **outside the token source** — `TOKEN_EX` holds
it as exclusions, and its declarations are the token set, not violations of it — token **declarations** and token **uses** as two separate numbers, and the
**off-token share** T3 reads: off-token occurrences over off-token occurrences plus `var()`/`theme.*` uses. `TOKEN_SRC` is an include and leads its command,
`TOKEN_EX` an exclusion and trails one. With `DESIGN_SYSTEM = none`, drop `"${TOKEN_EX[@]}"` and give command 3 `-g '*.{css,scss}'` instead.
```sh
rg -o --no-filename -g '*.{css,scss,less,ts,tsx,js,jsx,vue,svelte}' "${RG_EXCLUDE[@]}" "${TOKEN_EX[@]}" -g '!**/*.svg' -e '#[0-9a-fA-F]{3,8}\b' -e 'rgba?\([^)]*\)' -e 'hsla?\([^)]*\)' "${CLIENT_ROOT[@]}" | tr 'A-F' 'a-f' | sort | uniq -c | sort -rn
rg -o --no-filename -g '*.{css,scss,less,ts,tsx,js,jsx,vue,svelte}' "${RG_EXCLUDE[@]}" "${TOKEN_EX[@]}" -e '\b[0-9]+(\.[0-9]+)?(px|rem|em)\b' "${CLIENT_ROOT[@]}" | sort | uniq -c | sort -rn
rg -o --no-filename "${TOKEN_SRC[@]}" "${RG_EXCLUDE[@]}" -e '^ *--[a-zA-Z0-9-]+ *:' "${CLIENT_ROOT[@]}" | sort -u | wc -l
rg -o --no-filename -g '*.{css,scss,ts,tsx,js,jsx,vue,svelte}' "${RG_EXCLUDE[@]}" -e 'var\(--[a-zA-Z0-9-]+\)' -e 'theme\.[a-zA-Z.]+' "${CLIENT_ROOT[@]}" | sort | uniq -c | sort -rn
```

**6. Routing: organisation, guards, unknown paths, per-route code splitting.** Produces the **route table** — file, lazy yes/no, chunk and size, guard, 404, hydration
— sizes from an existing build artefact only (§11). Its second command covers both route conventions: a filename the framework reserves (`page`, `route`, `+page`,
`+layout`) and, under `pages/` or `routes/`, any name at all — `index` sits in the directory branch alone, since `tsx?` makes the x optional and as a reserved name
it listed every `index.ts` barrel as a route and dropped every `index.tsx` from `C_total`. Both measured; §9 excludes the same two trees for the same reason.
```sh
rg -l "${RG_EXCLUDE[@]}" -e 'createBrowserRouter|<Routes>|<Route |RouterModule|createRouter|routes *[:=] *\[' "${CLIENT_ROOT[@]}"
cfiles | rg -e '/(page|route|layout|\+page|\+layout)\.(tsx?|jsx?|vue|svelte)$' -e '(^|/)(pages|routes)/[^_].*\.(tsx?|jsx?|vue|svelte)$' | rg -v -e '\.(test|spec|stories)\.'
rg -n "${RG_EXCLUDE[@]}" -e 'React\.lazy\(|\blazy\(|\bimport\(|defineAsyncComponent|loadChildren|dynamic\(' -e 'path="\*"' -e 'path: .\*.' -e 'NotFound|not-?found|404' -e 'ProtectedRoute|RequireAuth|AuthGuard|canActivate|beforeEnter|middleware' "${CLIENT_ROOT[@]}"
```

**7. Forms: one approach or several, validation on both sides, behaviour on a failed submit.** Produces one row per form — approach,
client validation, the server check it pairs with, what the user sees on failure. Read every handler `rg -n -B 3 -A 12 -e
'onSubmit|handleSubmit|@submit|ngSubmit'` returns: a rejection with no `catch` is a silent failure, not an error state.
```sh
rg -l "${RG_EXCLUDE[@]}" -e 'react-hook-form|formik|final-form|@tanstack/react-form|vee-validate|FormGroup|FormBuilder|superForm|<form' "${CLIENT_ROOT[@]}"
rg -n "${RG_EXCLUDE[@]}" -e '\bzod\b|\byup\b|\bjoi\b|valibot|superstruct|\bajv\b|class-validator|resolver:' -e 'setError|serverError|toast\.error' "${CLIENT_ROOT[@]}"
```

## 5. Tools

| Tool | Measures here | Invocation | Fallback when absent |
|---|---|---|---|
| `git` + POSIX | the client file population, sizes, basename collisions | `git ls-files -z -- "${CLIENT_ROOT[@]}" \| rg --null-data -v -e "$EXCLUDE_RE" \| rg --null-data '\.(tsx\|jsx\|vue\|svelte)$' \| xargs -0 wc -l` | none — this is the floor |
| `ripgrep` | every census of steps 1–7 | `rg -n --no-heading -g '*.{ts,tsx,vue,svelte}' "${RG_EXCLUDE[@]}" -e '<pattern>' "${CLIENT_ROOT[@]}"` — include glob first, per §4 | `git grep -n -E '<pattern>' -- "${CLIENT_ROOT[@]}"`, else `grep -RnIE '<pattern>' "${CLIENT_ROOT[@]}"`, either one filtered through the contract's `EXCLUDE_RE` |
| `jq` | manifests, workspaces, build manifests | `jq -r '(.dependencies // {}) \| keys[]' package.json` | `sed -n '/"dependencies"/,/}/p' package.json` |
| `madge` | import graph, in-degree for §9's reuse index, orphans | `npx --no-install madge --extensions ts,tsx,js,jsx,vue --json "${CLIENT_ROOT[@]}"`; `--circular` for cycles inside the client. A version that refuses more than one entry runs once per root, and the graphs merge by repository-relative path with in-degree summed and a duplicate edge counted once | the contract's §9 on-demand form, `npx --yes madge@8.0.0 …`; then A-09's `edges-files.tsv` when supplied; else per component file `rg -l -w "<basename>" -g '*.{ts,tsx,js,jsx,vue,svelte}' "${RG_EXCLUDE[@]}" \| grep -vxF "<file>" \| wc -l`, which is in-degree by name. **The fallback is mandatory, not absence-triggered, whenever the graph misses the tree's dominant extension** — madge parses no `.svelte` at all — because a tool that exits 0 over an empty graph yields `R = 0/0` rather than a degradation: treat that graph as an absent tool and record the substitution in *Методология* |
| `knip` | step 4's dead-code list (§8): dead components, unused exports, unused UI dependencies, feeding T19 | `npx --no-install knip --reporter json --no-progress > "$OUTPUT_DIR/knip.json"` | `npx --yes knip@6.34.0 …`; else `npx --no-install madge --orphans --extensions ts,tsx,vue "${CLIENT_ROOT[@]}"`, else the in-degree count above, whose zero rows are candidates to confirm by reading; with none of them, the dead-code list is `не установлено` and T19 is not filed |
| Bundle analyser | per-chunk and per-route weight from an **existing** artefact | `npx --no-install source-map-explorer 'dist/assets/*.js' --json > "$OUTPUT_DIR/bundle.json"` | `npx --yes source-map-explorer@2.5.3 …`; else `find dist .next/static -name '*.js' -exec wc -c {} + 2>/dev/null \| grep -v ' total$' \| sort -rn \| head -20`, plus `jq -r '.pages \| to_entries[] \| "\(.key)\t\(.value \| length)"' .next/build-manifest.json` or `jq -r 'to_entries[] \| "\(.key)\t\(.value.file)"' dist/.vite/manifest.json`. With no artefact, size is `не установлено` and T4 rests on step 6's markers |
| Duplicate-component search | implementations of one UI primitive | `npx --no-install jscpd --min-lines 15 --min-tokens 60 --reporters json --output "$OUTPUT_DIR/jscpd" "${CLIENT_ROOT[@]}"` | `npx --yes jscpd@5.1.2 …`; else the basename grouping and primitive-name grep of step 4, then reading each candidate: two files named `Button.tsx` are a lead, not a finding |
| Colour / spacing literal grep | the off-token share of T3 | the step-5 pipelines | `grep -REo --include='*.css' --include='*.tsx' '#[0-9a-fA-F]{6}' "${CLIENT_ROOT[@]}" \| grep -vE "$EXCLUDE_RE" \| cut -d: -f2- \| sort \| uniq -c \| sort -rn` — `-o` without `-h`, so the path stays on the line the filter reads |

## 6. Analysis rules and thresholds

A finding is filed **per entity, per primitive, per route or per form**, never per call site; call sites are its evidence. The four `requirements` rows
are fixed; an unestablished cell is `не установлено`, a `confidence` reduction named in *Границы достоверности*, not a crossing. T2's rule is §10 item 3.
**This audit's ceiling is S2** — client structure is not by itself an exploit, a data loss or an outage, and the two rows that could become one go to
A-14 (T12, T15).

| # | Condition | Threshold | Severity | Origin |
|---|---|---|---|---|
| T1 | One entity held in more than one independently written source of truth | ≥ 2 mechanisms, each with a writer | S2 | requirements |
| T2 | Implementations of one UI primitive (button, modal, input, table…) | > 3 | S2 | requirements |
| T3 | Style values outside the token set (step 5, token sources excluded), over off-token occurrences + `var()`/`theme.*` uses | > 20% | S3 | requirements |
| T4 | No route-level code splitting: every route in the entry chunk | 0 lazy routes with ≥ 5 routes | S2 | requirements |
| T5 | Data call sites outside the single access layer | > 20% of call sites | S2 | derived |
| T6 | Flow where a superseded response can overwrite a newer one — user-typed input, no cancellation, no ordering guard | ≥ 1 flow | S2 | derived |
| T7 | Data call sites with no error branch reaching the user | > 30% | S2 | derived |
| T8 | Sequential dependent fetches before first meaningful render | ≥ 3 on a critical route; ≥ 3 elsewhere | S2 / S3 | derived |
| T9 | SSR or SSG in `RENDERING_MODE` and a client-only global reached on the server path outside an effect or guard | ≥ 1 | S2 | derived |
| T10 | Single component file length | > 800 lines; 400–800 lines | S2 / S3 | derived |
| T11 | Prop forwarded through intermediate components that never read it | ≥ 4 levels | S3 | derived |
| T12 | Route whose data requires authentication and whose guard is client-only or absent — the structure only, exploitability being A-14's call | ≥ 1 | S3 | derived |
| T13 | No handling of unknown paths: no catch-all route, no 404 view | 0 | S3 | derived |
| T14 | Distinct form approaches inside one product area | ≥ 2 | S3 | derived |
| T15 | Write path whose input validation exists only on the client; the row is handed to A-14 | ≥ 1 | S2 | derived |
| T16 | Form whose failed submit leaves no user-visible error state (rejection swallowed or only logged) | ≥ 1 | S2 | derived |
| T17 | Distinct loading- or error-presentation approaches for data call sites inside one product area (boundary, inline branch, toast, router `errorElement`, none) — T7 counts absence, this row inconsistency | ≥ 2 | S3 | derived |
| T18 | SSR or SSG in `RENDERING_MODE` and a render body whose value cannot agree between the two renders — clock, random, locale format, storage read — outside an effect, recorded in the route table's hydration cell | ≥ 1 | S2 | derived |
| T19 | Dead client modules (no importer in the graph, not a route entry, not a public export), and UI dependencies declared with no import site | > 5% of `C_total`; ≥ 1 dependency | S3 / S4 | derived |

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

| Aspect | This audit |
|---|---|
| Sampling unit | the **route (screen)** — where rendering, splitting, fetching, guards and forms all become observable at once. Components are read with the route they serve, plus the top `N/3` shared components by in-degree |
| Top-`N` ranking | in order: on a `BUSINESS_CONTEXT` critical flow; entry, authentication and checkout routes; most data-fetching call sites; largest chunk where sizes exist; most changed in 90 days (`git log --since='90 days ago' --name-only --pretty=format: -- "${CLIENT_ROOT[@]}" \| sed '/^$/d' \| rg -v -e "$EXCLUDE_RE" \| sort \| uniq -c \| sort -rn \| head -30` — `--pretty=format:` emits a blank line per commit, and without the `sed` the empty string outranks every file) |
| Control sample `C` | routes with no finding yet, admin and settings screens included: that is where a second form approach and an unguarded route usually sit |
| Early stop | the contract's control-sample stop, additionally requiring that every `CORE_ENTITIES` row of the state map carry a writer `path:line` and every top-`N` route have its splitting, guard, 404 and form cells filled. An unfilled cell is never a reason to stop |

## 8. Report additions

All four are registers whose rows are the evidence §5's findings cite by id, so all four go **inside §7 *Приложения***; none belongs
in §5 *Детальные находки*, whose shape the contract fixes. The first three are what §12 hands on.

| Addition | Where | One row per | Columns |
|---|---|---|---|
| **Карта состояния приложения** | §7 *Приложения* | entity × mechanism | сущность \| механизм (серверный кэш / глобальное / локальное / URL / storage) \| где пишется (`path:line`) \| где читается \| инвалидация \| источник истины (да/нет) \| ids находок. A cell with no evidence carries `не установлено`; blank is not permitted |
| **Каталог дублирующихся компонентов** | §7 *Приложения* | UI primitive, ordered by implementation count | примитив \| число реализаций \| файлы \| расхождения (пропсы, стили, поведение) \| общая базовая библиотека \| ids находок |
| **Таблица маршрутов с размером чанка** | §7 *Приложения* | route | маршрут \| файл \| ленивая загрузка (да/нет) \| чанк \| размер, КБ \| защита маршрута \| поведение на неизвестном пути \| запросов до первого рендера \| гидратация (риск / нет / не применимо) \| ids находок. Размер is `не установлено` when no build artefact existed, and the report says so instead of estimating; гидратация is `не применимо` on a CSR-only route and carries the T18 `path:line` when it is a risk |
| **Список мёртвого клиентского кода** | §7 *Приложения* | dead module, export or dependency | путь \| вид (компонент / экспорт / UI-зависимость) \| in-degree \| источник (`knip` / граф / имя) \| подтверждено чтением (да/нет) \| ids находок. A row that no reading confirmed stays in the register as a candidate and is never filed as a finding |

## 9. Score

Two numbers, reported together in §2 *Итоговая оценка*, never averaged into one. **Индекс переиспользования компонентов** `R = C_reused / C_total`, unit:
a percentage with its raw fraction. `C_total` is the component files under `CLIENT_ROOT` minus routes, stories, tests and generated files; `C_reused`
those imported by ≥ 2 modules **outside their own directory** — a comparison step 4's in-degree does not make, so both operands are produced by command:
```sh
cfiles | rg '\.(tsx|jsx|vue|svelte)$' | rg -v -e '/(page|route|layout|\+page|\+layout)\.' -e '(^|/)(pages|routes)/' -e '\.(stories|story|test|spec)\.' -e '(^|/)(__generated__|\.storybook)/' | wc -l
jq -r 'to_entries[] | .key as $i | .value[] | select(sub("/[^/]*$";"") != ($i | sub("/[^/]*$";"")))' "$OUTPUT_DIR/graph.json" | sort | uniq -c | awk '$1 >= 2' | wc -l
```
With no usable graph (§5) `C_reused` is the plain name-based in-degree and the report says so. **Число источников истины на одну сущность** `S`, unit: a
count per entity, given as the median and maximum over `CORE_ENTITIES` and naming the entity holding the maximum; a mechanism counts only when something
writes it independently (§10 item 2). Emit as `Переиспользование: C_reused/C_total (NN%); источников истины на сущность: медиана M, максимум K (<entity>)`.
The justification names the worst primitive, the worst entity and the structural cause their rows share.

## 10. Failure modes of this audit

The requirements name one dominant risk — taste substituted for measurement. Each row is a way it becomes a false result.

| # | How this audit produces a false result | Countermeasure |
|---|---|---|
| 1 | A library or pattern preference is filed as a defect ("Redux where a lighter store would do"), and the client is reported as entropic on the auditor's taste | every finding cites a number from the fixed list — sources of truth, implementations, off-token share, chunk count or size, call sites outside the layer, forwarding levels, fetches before render — with the command in `evidence`; a claim carrying none of them is preference under `report-contract.md` §5 |
| 2 | A deliberate cache is counted as a second source of truth, inflating T1 and the score | a mechanism counts only if some path writes it independently, so a read-through cache with one writer and a stated invalidation is one source; the state map's per-cell writer keeps the judgement visible |
| 3 | Implementations of one primitive are miscounted — `Button` beside `IconButton`, or a thin wrapper counted as independent of the library primitive it wraps — and T2 fires on a project that has one button | T2 needs an overlapping rendered role and prop contract: record the prop diff and drop the row when it explains the split, and resolve each candidate's imports so wrappers over one primitive collapse into a single row naming it |
| 4 | The off-token share is inflated by noise — vendored CSS, generated themes, SVG `fill`, base64 data, and above all **the token source itself**, whose declarations are literals by construction — so T3 fires hardest on the project with the best token discipline | apply `SCOPE_EXCLUDE`, drop `*.svg` and vendored stylesheets, keep `"${TOKEN_EX[@]}"` on every literal census of step 5, count normalised unique values, and report values and occurrences as two numbers |
| 5 | Code splitting is judged from source on a framework that splits by default (Next.js, Nuxt, SvelteKit, Angular route modules), so T4 fires on a correctly split application | confirm T4 against the build manifest; with no artefact file it only when the router statically imports every route component, and say the check was static |
| 6 | The report drifts into performance numbers — latency, TTI, byte budgets — which this audit never measured | report counts, structure and, where an artefact exists, raw sizes; delete every millisecond claim and hand the route table to A-15 |
| 7 | One stack's patterns are run over another's tree (`useState` grepped in a Vue or Angular project), and an empty census is read as an absent mechanism | derive `FRONTEND_STACK` before step 1, list substituted patterns in *Методология*, and treat a census returning zero on a populated tree as a pattern error until a read proves otherwise |
| 8 | Framework-convention files — route and layout entries, `error`/`loading` modules, generated clients, story files — are reported dead because nothing imports them by name, and T19 fires on a healthy tree | `knip` with the project's own config is the primary source; a zero in-degree is a candidate, not a finding, and every route entry and framework-reserved filename is excluded before the share is computed. The register's «подтверждено чтением» column is what separates the two |

## 11. Audit-specific prohibitions

Beyond `report-contract.md` §9. Each row's alternative is what the protocol uses instead.

| Prohibited | Safe alternative |
|---|---|
| **Do not build the project to obtain chunk sizes** — no `npm run build`, `next build`, `vite build`, `ng build`: they write into the tree and can overwrite an artefact the team relies on | measure an existing `dist/`, `.next/` or Storybook build as found, deleting and regenerating nothing (`node_modules/.cache` included); with none, record `не установлено` and lower `confidence` |
| **Do not start or drive the application** — no `npm run dev`, no Playwright, Cypress or Storybook run, no headless session that logs in, submits a form or fires a mutation | read behaviour from the handlers (steps 2 and 7); re-render cost belongs to A-15, and no threshold here rests on a live session |
| **Do not exercise forms or write flows** to test validation or error handling — one submitted form against a shared environment is real data the audit created | read the submit handler and its error branch (step 7), and file what the code does |
| **Do not normalise the client before measuring it** — no `prettier --write`, `eslint --fix`, `ng update` or codemod, not even on a scratch branch: they rewrite the very distributions this audit counts (off-token literals, file lengths, duplicate implementations), and the report would then describe a tree that never shipped | measure the tree at `COMMIT_SHA` as found, and normalise inside the pipeline instead — `tr 'A-F' 'a-f'`, `sort -u`, `sed` — where it changes the count and not the repository |
| **Do not let a tool write beside the sources it read** — `madge`, `jscpd`, `knip` and the bundle analyser default to the working directory, and their output is not part of the client | redirect every one to an explicit path under `OUTPUT_DIR`, as each invocation in §4 and §5 does; that directory is the audit's whole write surface, wherever the contract's default puts it |
| **Do not paste UI screenshots or storage dumps holding real user data** into the report | the state map records mechanisms and `path:line`, never captured values |

## 12. Dependencies

**Input** — `A05_REPORT`, `A06_REPORT`, `A09_REPORT` as paths or copied values per the contract's execution model, never as remembered context; none blocking.

| From | What it supplies | When absent |
|---|---|---|
| **A-05** | the client cohort of the metric tables, duplication register and cross-module clone list: they rank component size and pre-filter T2 candidates | step 4 recomputes them over `CLIENT_ROOT` |
| **A-06** | the boundary map and unvalidated-input list, naming the client-side validation with no server counterpart (T15) | step 7 pairs forms to handlers by reading, and files the pairing `probable` |
| **A-09** | `edges-files.tsv`, `edges-modules.tsv` and `rules.tsv` for the client tree: §9's in-degree comes from them, and `F-A09-<NN>` ids are what these findings list in `blocked_by` | `madge` or the name-based count rebuilds the in-degree and the report records the substitution |

**Output**, per `audit-index.md`: the route table to **A-15**, the frontend map that seeds its `KEY_PAGES`; that table with the state map and the
duplicate-component catalogue to **A-21** as `A13_REPORT` — four button implementations are four keyboard contracts. Hand over the path or the values.

## 13. Nearest marvin command

`audit-index.md`'s command table carries no row for A-13. `/marvin:refactor-smells` over `CLIENT_ROOT` overlaps steps 4 and 5, `/marvin:refactor-audit`
step 4's graph work, where A-13 produces measured distributions against fixed thresholds and a score. Either may accelerate a step; its output is evidence.
