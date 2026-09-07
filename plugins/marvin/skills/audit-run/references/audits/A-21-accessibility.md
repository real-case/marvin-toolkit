# A-21 — Доступность

> **Audit question.** Can a user with impairments complete the product's key scenarios end to end?

## 1. Role and task

You audit the interface against `A11Y_TARGET` along seven surfaces — semantics, keyboard, screen readers, contrast, forms, dynamic content, motion — and answer one
question: can a person who cannot use a mouse, see the screen or perceive colour still finish the flows the product exists for? The unit of judgement is the **flow**,
not the rule: forty clean axe rules and one unreachable submit button is a failure. A run leaves the §8 matrix in *Приложения*. **No user interface, no audit**
(`audit-index.md`): establish it with the two commands below — both carrying `report-contract.md` §2's exclusion arrays, without which a committed bundle answers the
existence question for the product — and write nothing when both come back empty.
```sh
git ls-files -- '*.html' '*.tsx' '*.jsx' '*.vue' '*.svelte' '*.astro' '*.erb' '*.twig' "${GIT_EXCLUDE[@]}" | head
rg -l "${RG_EXCLUDE[@]}" -e '"(react|preact|vue|svelte|solid-js|@angular/core|lit|htmx\.org|alpinejs)"' -g 'package.json'
```

## 2. Audit-specific parameters

On top of the ten in `report-contract.md` §2. The run completes with all seven empty, at lower `confidence`.

| Parameter | Meaning | Derivation when unset |
|---|---|---|
| `A13_REPORT` | path to A-13's finished report — the source of the `CRITICAL_FLOWS` candidates, of `CLIENT_ROOT` and of §7's component population | none, and never blocking. Absent, each derivation below runs on its own and §12's substitution is recorded |
| `A11Y_TARGET` | the conformance level judged against; also the source of step 1's scanner arguments and of §9's `V` | the first command below, over docs, CI and lint config — take the level any hit names. With nothing found use **WCAG 2.2 AA**, recorded as *выведено, не задано* |
| `CRITICAL_FLOWS` | the scenarios that must be completable — the population, and the score's denominator. The same set A-07 and A-12 audit under this name | `A13_REPORT`'s route table restricted to its critical rows; else `BUSINESS_CONTEXT`; else the entry route, the authentication route and the routes with the most submit handlers, top 5 (`quick`) / 8 (`standard`) / 15 (`deep`). **Ask the user**: the score is a share of these, so the denominator is load-bearing. With no answer use the derived list, labelled an estimate |
| `LEGAL_REQUIREMENT` | the regime that applies (EN 301 549 / EAA, ADA & Section 508, ГОСТ Р 52872, none stated) | the second command below. With nothing found the value is `не установлено` and no finding is promoted on legal grounds (§6) |
| `PREVIEW_URL` | URL(s) of a running instance the user already runs and **explicitly offers**, one per flow entry point | none. **Unset, step 1 does not run at all** — it has no static form: it goes to `tools_unavailable`, the automated-violation register is `не установлено`, and §8's count line reads `автоматически: 0`. Steps 2–8 keep their static form, `confidence` is at most `medium`, and *Границы достоверности* names all of it. The audit never starts the application to obtain one (§11) |
| `CLIENT_ROOT` | the paths holding templates, components and stylesheets — A-13's parameter of the same name and the same meaning, held as A-13 declares it, a **shell array** a monorepo fills with several roots and every census of §4 expands | `A13_REPORT`'s `CLIENT_ROOT`; else the shallowest directories containing the files found above, minus `SCOPE_EXCLUDE`. An empty array means the whole tree |
| `ASSISTIVE_STACK` | the screen reader × browser pair actually used | the auditor's platform: macOS → VoiceOver + Safari, Windows → NVDA + Firefox, Linux → Orca + Firefox. With none available the matrix's screen-reader column is `не проверено` throughout and every announcement finding is `probable` (§10 row 2) |

These two are commands, not cells: ripgrep's alternation is a bare `|`, which no table cell survives, and `\|` there is an escaped literal pipe — the Rust regex crate has no BRE alternation — so the escaped form would match nothing, silently. Every include glob here is `**/`-prefixed for the reason `report-contract.md` §2 gives about the exclusion set — a glob with a `/` matches the path relative to the search root, so `-g 'docs/**'` never reaches `packages/*/docs/` — and `--hidden` is what reaches `.github/`, which ripgrep skips by default, so without it the CI third of the derivation silently never runs.
```sh
rg -i -l "${RG_EXCLUDE[@]}" --hidden -e 'wcag|a11y|accessibility' -g '**/docs/**' -g '**/.github/**' -g '*eslintrc*' -g 'eslint.config.*' -g 'README*' .
rg -i -l "${RG_EXCLUDE[@]}" -e 'accessibility statement|vpat|en 301 549|section 508|доступност' -g 'README*' -g '**/docs/**' -g '**/legal/**' .
```

## 3. Scope

**In scope.** Seven surfaces, over `CRITICAL_FLOWS` and every screen they traverse. **Semantics**: heading outline, landmarks, list markup, elements whose tag contradicts
their behaviour, and the text alternative of every image and icon on the path. **Keyboard**: reachability, traversal order against the visual one, focus visibility,
traps, `Esc`. **Screen-reader output**: the accessible name, role and state of every control on a flow, and whether a change is announced. **Contrast**: text, non-text
and the focus indicator, in rest, hover and focus. **Forms**: label mechanism, error mechanism, focus behaviour on a failed submit, signalling by more than colour.
**Dynamic content**: live regions, politeness, focus moves. **Motion**: `prefers-reduced-motion`, autoplay, vestibular-risk amplitude. Markup, stylesheets and component source under `CLIENT_ROOT` are always in scope; a rendered page only where `PREVIEW_URL` is offered.

**Out of scope.** A full certification audit and any statement of conformance — nothing in this family produces one. Component duplication, state, routing and bundles
→ A-13, whose catalogue arrives here as input; animation and render cost → A-15; prop types → A-06; exploitability → A-14; interface copy → A-20; consent dialogues and
their data handling → A-22, here only their operability. Native mobile accessibility (UIKit, Jetpack Compose) is covered by **nothing** here — say so if the product is one.

## 4. Collection protocol

Eight steps in this order. Step 1 is deliberately first, deliberately insufficient, and the only one that does not run at all without `PREVIEW_URL`; steps 2–8 carry the
answer and each is static by construction. Patterns are HTML/JSX/Vue/Svelte; substitute the stack's equivalents and say so in *Методология*. **Every census below yields
candidates only** — attributes arrive through prop spreads and directives, so a finding is filed once the rendered DOM or the component's own source confirms it, never
on a library's accessibility claim, and a census returning zero on a populated tree is a pattern error until a read proves otherwise. Every census scans through `rgx`:
the contract's `RG_EXCLUDE` — committed build output is a UI population's largest false positive, and this audit adds no exclusion of its own — over `CLIENT_ROOT`, or over the whole tree when that array is empty. A second `rg` on the right of a pipe filters text already in hand and needs neither.
```sh
UI='*.{html,tsx,jsx,vue,svelte,astro}'; rgx() { rg "${RG_EXCLUDE[@]}" "$@" "${CLIENT_ROOT[@]:-.}"; }
```

**1. Automated pass over every `PREVIEW_URL`.** Produces the **automated-violation register** — page × rule id × criterion tag × impact × node count — plus the real tool
versions. Both engines are scoped to `A11Y_TARGET`, so best-practice rules never seed `V`; one file per URL, `mkdir -p` first because Lighthouse's `--output-path` and the
shell redirect both fail on a missing directory — axe alone creates its `--dir`. Findings are labelled `автоматически` (§8), a clean result is not an answer (§10 row 1), and an unset `PREVIEW_URL` skips the step rather than substituting it.
```sh
mkdir -p "$OUTPUT_DIR"; case "$A11Y_TARGET" in *AAA*) PA=WCAG2AAA; TAGS=wcag2a,wcag2aa,wcag2aaa,wcag21a,wcag21aa ;; *\ A|WCAG2A) PA=WCAG2A; TAGS=wcag2a,wcag21a ;; *) PA=WCAG2AA; TAGS=wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa ;; esac
for u in $PREVIEW_URL; do n=$(printf '%s' "$u" | tr -c 'A-Za-z0-9' '-')
  npx --yes @axe-core/cli@4.13.0 "$u" --tags "$TAGS" --save "axe-$n.json" --dir "$OUTPUT_DIR"   # --save is a filename, --dir the path
  npx --yes pa11y@10.0.0 --standard "$PA" --reporter json "$u" > "$OUTPUT_DIR/pa11y-$n.json"
  npx --yes lighthouse@13.4.1 "$u" --only-categories=accessibility --output=json --output-path="$OUTPUT_DIR/lh-$n.json" --chrome-flags="--headless"
done
jq -r '[.. | objects | select(has("violations"))][] | .url as $u | .violations[] | "\($u)\t\(.impact)\t\(.id)\t\(.tags | join(","))\t\(.nodes | length)"' "$OUTPUT_DIR"/axe-*.json
jq -r 'input_filename as $f | .[] | "\($f)\t\(.code)\t\(.selector)"' "$OUTPUT_DIR"/pa11y-*.json; jq -r 'input_filename as $f | .audits | to_entries[] | select(.value.score != null and .value.score < 1) | "\($f)\t\(.key)"' "$OUTPUT_DIR"/lh-*.json
```

**2. Keyboard walk of every `CRITICAL_FLOWS` scenario, end to end, pointer unused.** The mandatory step, the one `K` comes from. Produces one row per scenario step —
reachable, order sane, focus visible, trap, `Esc` closes — using only `Tab`, `Shift+Tab`, `Enter`, `Space`, arrows, `Esc`, `Home`/`End`. Record **the key tried** at each
step and mark a scenario incomplete rather than reaching for the mouse: a step with no key recorded did not happen by keyboard, and one click to open a menu voids the row.
```js
[...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].map(e => [e.tagName, e.getAttribute('tabindex'), (e.innerText || e.name || '').slice(0, 40)])
```
```sh
rgx -n -i -e 'tab-?index=["{ ]*[1-9]' -g "$UI"
rgx -n -e 'outline: *(none|0)' -e ':focus-visible' -e ':focus\b' -e 'Escape|keyCode === 27' -e 'aria-modal|inert\b|focus-?trap|returnFocus' -g '*.{css,scss,less,ts,tsx,js,jsx,vue,svelte}'
```

**3. Semantics.** Produces the **heading outline per page**, the landmark inventory, the **list-markup census** and the census of elements whose tag does not match their behaviour.
Command 3 finds lists rebuilt from repeated `div` siblings, which announce no item count (T19); command 4 is both halves of button-versus-link — an `<a>` no key reaches, and a navigating `<button>` (T20).
```sh
rgx -o -n -e '<h[1-6]\b' -e 'role="heading"' -e '<(main|nav|header|footer|aside)\b' -e 'role="(main|navigation|banner|contentinfo|search)"' -e '<html[^>]*lang=' -g "$UI"
rgx -n -e '<(div|span|li|td|i)\b[^>]*(onClick|onclick|@click|on:click|v-on:click|ng-click)' -g "$UI"
rgx -n -e '<(ul|ol|dl)\b' -e 'role="(list|listitem)"' -g "$UI"; rgx -n -A 2 -e '\.map\(' -e 'v-for=' -e '\{#each' -g "$UI" | rg -e '<(div|span)\b'
rgx -n -e '<a\b' -g "$UI" | rg -v -e 'href="[^#]' -e 'to='; rgx -n -A 2 -e '<button\b' -g "$UI" | rg -e 'router\.(push|navigate)|location\.(href|assign)|history\.push'
```

**4. Forms.** Produces one row per field — label mechanism, error mechanism, focus behaviour on a failed submit, whether failure is signalled by more than colour. Each matched submit handler is read in full: a rejected submit that only sets a red border is T11.
```sh
rgx -n -e '<(input|select|textarea)\b' -g "$UI" | rg -v -e 'aria-label' -e 'type="hidden"'; rgx -n -e '<label\b' -g "$UI" | rg -v -e 'for=' -e 'htmlFor='
rgx -n -e 'aria-invalid' -e 'aria-describedby' -e 'aria-errormessage' -g "$UI"; rgx -n -A 6 -e '\.(error|invalid|is-invalid|has-error)\b' -g '*.{css,scss,less}'
rgx -n -B 2 -A 12 -e 'onSubmit|handleSubmit|@submit|ngSubmit' -e '\.focus\(\)|scrollIntoView' -g '*.{ts,tsx,js,jsx,vue,svelte}'
```

**5. Dynamic content.** Produces the **asynchronous-surface table**: what changes without a page load, whether a live region covers it, its politeness, whether the change
is announced. With `PREVIEW_URL`, trigger each surface from the keyboard and record what the `ASSISTIVE_STACK` screen reader said, verbatim and only if heard (§10 row 2).
```sh
rgx -n -e 'aria-live' -e 'role="(alert|status|log|progressbar)"' -e 'aria-busy' -g "$UI"; rgx -c -e 'isLoading|isPending|isFetching|Spinner|Skeleton|toast|Snackbar' -g '*.{ts,tsx,js,jsx,vue,svelte}'
```

**6. Contrast.** Produces the **contrast table** — element, state, foreground, background, computed ratio, required ratio, verdict — over body text, secondary text,
placeholders, and button and link states in **rest, hover and focus**, plus the focus indicator against its own background and the adjacent surface. The composited pair
is measured, never a source token (§10 row 3). **Hover is measured by hand:** axe reports the resting pair only, so command 1 also harvests hover and focus declarations,
and the calculator normalises that harvest — 3-digit shorthand expanded by doubling each nibble, 8-digit truncated to its opaque triple, anything else refused by name rather than by traceback. **Alpha is not composited:** a translucent pair is measured only after its composited colours are read off the rendered page.
```sh
rgx -o --no-filename -e '#[0-9a-fA-F]{3,8}\b' -e 'rgba?\([^)]*\)' -g '*.{css,scss,less,ts,tsx,vue,svelte}' | tr 'A-F' 'a-f' | sort | uniq -c | sort -rn | head -40; rgx -n -A 3 -e ':hover' -e ':focus-visible' -g '*.{css,scss,less}' | rg -e 'color|background|border|outline'
jq -r '[.. | objects | select(has("violations"))][] | .url as $u | .violations[] | select(.id == "color-contrast") | .nodes[] | "\($u)\t\(.target[0])\t\(.failureSummary)"' "$OUTPUT_DIR"/axe-*.json
python3 -c "import sys;n=lambda h:(lambda s:''.join(c*2 for c in s) if len(s)==3 else s[:6] if len(s) in (6,8) else sys.exit('A-21: not a 3/6/8-digit hex colour: '+h))(h.lstrip('#').lower());f=lambda c:c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4;L=lambda x:.2126*f(int(x[0:2],16)/255)+.7152*f(int(x[2:4],16)/255)+.0722*f(int(x[4:6],16)/255);a,b=L(n(sys.argv[1])),L(n(sys.argv[2]));print(round((max(a,b)+.05)/(min(a,b)+.05),2))" '#767676' '#ffffff'
```

**7. Images and icons.** Produces the **image inventory**: source, classification (informative / decorative / functional), alternative present, alternative adequate.
Classification comes first — the same empty `alt` is correct on a spacer and a defect on a product photo — and presence is not quality: `alt="image"` and `alt="IMG_2043.png"` pass every rule engine.
```sh
rgx -n -e '<img\b' -g "$UI" | rg -v 'alt='; rgx -n -e '<svg\b' -g "$UI" | rg -v -e 'aria-hidden' -e 'role=' -e 'aria-label'
rgx -o --no-filename -e 'alt="[^"]*"' -g "$UI" | sort | uniq -c | sort -rn | head -30
```

**8. Motion.** Produces the **animation inventory**: what animates, its trigger, its amplitude, and whether a `prefers-reduced-motion` branch reduces or removes it. Autoplaying media and parallax are listed separately — the T14 vestibular rows.
```sh
rgx -c -e '@keyframes|animation:|animation-name|transition:' -g '*.{css,scss,less}'; rgx -n 'prefers-reduced-motion' -g '*.{css,scss,less,ts,tsx,js,jsx,vue,svelte}'
rgx -l -e 'framer-motion|gsap|animejs|react-spring|lottie|@vueuse/motion|svelte/motion|autoplay|autoPlay' -g "$UI"
```

## 5. Tools

Every row degrades to its fallback and the run continues; the three scanners follow `report-contract.md` §9's acquisition policy, and step 1's pins are the versions this spec was written against.

| Tool | Measures here | Invocation | Fallback when absent |
|---|---|---|---|
| `git` + POSIX + `ripgrep` | the UI file population and every static census of steps 2–8 | `git ls-files -- '*.html' '*.tsx' '*.vue' "${GIT_EXCLUDE[@]}" \| wc -l`; `rgx -n --no-heading -e '<pattern>' -g "$UI"` | for `rg`, `git grep -n -E '<pattern>'`, else `grep -RnIE '<pattern>' .` with the contract's `EXCLUDE_RE` filtering the result; for `git ls-files`, none — this is the floor |
| `axe-core` (`@axe-core/cli`) | rule violations at `A11Y_TARGET` on a rendered page, composited resting contrast included | step 1's loop. `--save` takes a **bare filename** joined onto `--dir`, the only path argument resolved absolutely and created; a path inside `--save` throws `ENOENT` or writes a bogus tree into the repository | the axe browser extension run by the user, its exported JSON read as evidence; else `pa11y` over the same URL. With no `PREVIEW_URL` no engine runs and step 1 is skipped, not substituted |
| Lighthouse / `pa11y` | the accessibility category and its per-audit failures; a second engine (HTML_CodeSniffer) over a URL or a built `file://` page | step 1's loop; Lighthouse writes through `--output-path` under the created `OUTPUT_DIR`, and pa11y's `--standard` is derived from `A11Y_TARGET`, never pinned | the Lighthouse panel in the user's own Chrome DevTools, JSON exported by the user; `npx --yes pa11y-ci@4.1.1 --sitemap "$PREVIEW_URL/sitemap.xml"` for many pages; else axe alone, and the report says one engine ran |
| Manual keyboard walk | T1, T2, T6–T9, T19, T20 — the flow-level answer | no binary: `Tab` / `Shift+Tab` / `Enter` / `Space` / arrows / `Esc`, plus step 2's console line | **none.** Without it the audit has no answer: `confidence: low`, and `K` in §9 is `не установлено` |
| Screen reader | the announcement column of the §8 matrix | `ASSISTIVE_STACK`: VoiceOver `Cmd+F5`, NVDA, or Orca `Super+Alt+S` | the accessible-name chain read from markup (`aria-labelledby` → `aria-label` → `<label>` → content → `title`) plus the browser's accessibility-tree pane; every such row is `probable`, never `confirmed` |
| `jq` + `python3` | parsing the scanners' JSON; the contrast ratio for a pair, including the **hover** and focus pairs no engine measures | `jq -r '.[] \| .code' "$OUTPUT_DIR"/pa11y-*.json`; step 6's calculator | read the JSON directly; axe's `color-contrast` nodes, resting state only. With neither, the cell is `не установлено` and T3/T5 are not filed from guesswork |

## 6. Analysis rules and thresholds

A finding is filed **per flow, per field, per component or per criterion** — never per DOM node; nodes are its evidence. «Key flow» below means a member of `CRITICAL_FLOWS`, and the contract's reachability and position rules apply once on top of the row's severity.

| # | Condition | Threshold | Severity | SC | Origin |
|---|---|---|---|---|---|
| T1 | A `CRITICAL_FLOWS` scenario cannot be completed with the keyboard alone | ≥ 1 step blocked | S1 | 2.1.1 | requirements |
| T2 | Focus trap: focus enters a region and `Tab`/`Shift+Tab`/`Esc` cannot leave it | ≥ 1 | S1 | 2.1.2 | requirements |
| T3 | Contrast on body text below the level's minimum | < 4.5:1 (< 3:1 at ≥ 24px, or ≥ 18.66px bold) | S2 | 1.4.3 | requirements |
| T4 | Form field with no programmatic label (no `<label for>`, `aria-label`, `aria-labelledby`) | ≥ 1 field | S2 | 1.3.1, 3.3.2 | requirements |
| T5 | Non-text contrast: control border, icon, focus indicator **or hover state** against its background | < 3:1 | S2 | 1.4.11 | derived |
| T6 | Focus indicator suppressed and not replaced (`outline: none`, no `:focus`/`:focus-visible` style) | ≥ 1 interactive selector | S2 | 2.4.7 | derived |
| T7 | Modal or overlay that `Esc` does not close, or that does not return focus to its opener | ≥ 1 | S2 | 2.1.2, 2.4.3 | derived |
| T8 | Interactive `div`/`span` with a click handler and no role, no `tabindex`, no key handler | ≥ 1 on a key flow; ≥ 3 elsewhere | S2 / S3 | 2.1.1, 4.1.2 | derived |
| T9 | Asynchronous change with no live region and no focus move — results, validation, toast, error | ≥ 1 on a key flow | S2 | 4.1.3 | derived |
| T10 | Error message not tied to its field (`aria-describedby` / `aria-errormessage` absent) | ≥ 1 | S2 | 3.3.1 | derived |
| T11 | Failed state signalled by colour alone — no text, no icon, no `aria-invalid` | ≥ 1 | S2 | 1.4.1, 3.3.1 | derived |
| T12 | Focus not moved to the first invalid field or to an error summary after a failed submit | ≥ 1 form | S3 | 3.3.1 | derived |
| T13 | Informative image with absent or empty `alt`; decorative image with a descriptive `alt` or not hidden | ≥ 1 / ≥ 3 | S2 / S3 | 1.1.1 | derived |
| T14 | Animation with no `prefers-reduced-motion` branch; vestibular-risk motion (parallax, large-scale, autoplay > 5 s with no pause) | ≥ 1 / ≥ 1 | S3 / S2 | 2.3.3, 2.2.2 | derived |
| T15 | Heading structure: no `h1` on a key page, or a skipped level | ≥ 1 page | S3 | 1.3.1 | derived |
| T16 | No landmarks and no skip link on a page with ≥ 20 links before the main content | ≥ 1 page | S3 | 2.4.1 | derived |
| T17 | Positive `tabindex` overriding DOM order | ≥ 1 | S3 | 2.4.3 | derived |
| T18 | Page language not declared (`<html lang>`) | ≥ 1 page | S3 | 3.1.1 | derived |
| T19 | List rebuilt from repeated `div`/`span` siblings — no `<ul>`/`<ol>`/`<dl>`, no `role="list"`, so no item count is announced | ≥ 1 on a key flow | S3 | 1.3.1 | derived |
| T20 | Tag and behaviour inverted: `<a>` with no `href` (or `href="#"`) carrying a click handler, unreachable by `Tab` and inert to `Enter`; or `<button>` performing navigation | ≥ 1 on a key flow; ≥ 3 elsewhere | S2 / S3 | 2.1.1, 4.1.2 | derived |

**The `SC` column is what makes `V` computable.** Every filed finding carries the criterion of its row in `evidence`; an automated finding takes it from the tool instead
— axe's `wcag131`/`wcag412` rule tags, or pa11y's htmlcs code, whose `Guideline1_3.1_3_1` segment names it. A criterion that cannot be established is `не установлено` and
is excluded from `V`. **No shipped engine covers the WCAG 2.2 additions** — pa11y's HTML_CodeSniffer stops at 2.1, axe implements only part of the `wcag22aa` tag — so
those criteria are judged by hand in steps 2–8, never inferred from a green scanner; *Границы достоверности* states both gaps.

**Two overrides.** With `LEGAL_REQUIREMENT` naming a regime, a violated criterion that regime enumerates rises one row on the contract's position rule and the evidence
names the regime; with it unset, nothing is promoted on legal grounds. An **accessibility overlay** promising remediation at runtime never closes a finding and never
lowers a severity: file the underlying defect, and the overlay itself as an `S3` row, since it adds a keyboard surface of its own.

## 7. Budget and stopping

Deltas from `report-contract.md` §8 only.

- **Sampling unit: the key scenario (flow)**, walked end to end. Screens, components and fields are read as part of the flow that reaches them, plus the top `⌈N/3⌉`
  shared components by reuse from A-13's catalogue — four button implementations are four independent keyboard and focus contracts.
- **Top-`N` ranking**, in order: `CRITICAL_FLOWS` as given; then authentication, registration, payment and any flow `BUSINESS_CONTEXT` calls critical; then flows with the
  most form fields; then the entry route and the global navigation. The public marketing route ranks last: easiest to reach, least important, the classic wrong answer.
- **Control sample `C`**, drawn in the same unit from outside the top `N` — control flows first, and when that population is exhausted single screens standing in at one
  screen = one unit, which `coverage` states — weighted to error and empty states, modals, date pickers and settings. **Early stop:** the contract's control-sample stop, additionally requiring every `CRITICAL_FLOWS` row of this spec's own §8 matrix filled from observation. **Never stop because step 1 came back clean.**

## 8. Report additions

1. **Матрица «сценарий × клавиатура × скринридер × контраст»** — goes **inside §7 *Приложения***: a register whose rows the §5 findings cite by id, one row per
   `CRITICAL_FLOWS` scenario. Columns: сценарий | точка входа (`path` или URL) | клавиатура (полностью / частично / нет + шаг, на котором прервано) | скринридер
   (объявлено / частично / не проверено + `ASSISTIVE_STACK`) | контраст (минимальный коэффициент на пути сценария + элемент и его состояние) | ловушки фокуса | ids
   находок. An unobserved cell carries `не установлено` or `не проверено`; blank is forbidden, because a blank cell reads as a pass. The scanner JSON, the contrast table, the semantics censuses and the image and animation inventories sit in §7 beside it.
2. **Разделение находок на автоматически обнаруженные и найденные вручную** — goes **inside §5 *Детальные находки***: a count line at the head of the section
   (`автоматически: N`, `вручную: M`, `N` = 0 whenever step 1 did not run), and one added prose line per finding — `**Источник обнаружения:** автоматически (<tool>@<version>) | вручную (шаг <n>)`. The machine register of §6 is **not** extended; the split stays recoverable from `evidence`.

## 9. Score

Two numbers, reported together in §2 *Итоговая оценка*, never averaged into one. **Доля сценариев, полностью выполнимых с клавиатуры** `K = flows_keyboard_complete /
flows_total`, a percentage with its raw fraction: a scenario counts in the numerator only when every step is reachable, operable, in a traversal order matching the visual
one, with a visible focus indicator, no trap and every overlay dismissible, pointer unused throughout — one failing step drops the whole scenario, as the user gets no
partial credit either.

**Число нарушений целевого уровня** `V`, a count of the **distinct success criteria** of `A11Y_TARGET` appearing in the `SC` column of the filed findings — the criterion
of the crossed threshold row for a manual finding, the one the tool named for an automated one (§6). Each counts once however many instances it has, the instance count
reported beside it; a criterion outside `A11Y_TARGET`, and one recorded `не установлено`, are excluded and named in *Границы достоверности*. Emit as `Клавиатура:
flows_keyboard_complete/flows_total (NN%); нарушений <A11Y_TARGET>: V критериев (I инстансов)`, and justify by naming the scenario that fails earliest, the criterion with
the most instances, and the one structural cause most rows share.

## 10. Failure modes of this audit

The requirements name one dominant risk for A-21 — a clean automated run read as an answer; it is row 1. Each row is a way this audit produces a confidently false report.

| # | How this audit produces a false result | Countermeasure |
|---|---|---|
| 1 | «Нарушений не найдено» concluded from step 1. Rule engines detect a **minority** of real barriers: they cannot judge a traversal order, whether an `alt` describes the image, whether a flow can be finished, or whether an announcement is comprehensible | **binding:** no report may state that the interface conforms, or that no violations exist, on step 1 alone. Where only step 1 ran, `confidence` is `low`, `K` is `не установлено`, and *Границы достоверности* says the keyboard walk did not happen; every §8 matrix cell without a manual observation is `не установлено`, never «нарушений нет» |
| 2 | Screen-reader output invented — writing what VoiceOver "would announce" is fabricated evidence, and invisible to the reader | record only announcements actually heard, quoted; with no screen reader the column is `не проверено` and the finding rests on the markup name chain at `probable` |
| 3 | Contrast judged from source tokens, from a screenshot, or in the resting state only — a token pair that never composes on screen, text over a gradient, a resampled screenshot and an untested hover all give a wrong answer | measure the composited pair from the rendered page in each state step 6 names; over an image or gradient record `не установлено` and file the missing scrim as its own row |
| 4 | The denominator taken on trust. `K` is a share of `CRITICAL_FLOWS`, so a derived or quietly shortened list sets the score: dropping the one flow that defeated the walk reports a better number than including it | ask for the list (§2); with no answer label `K` an estimate, give the derivation in *Методология*, and keep every flow that could not be finished in the denominator |
| 5 | `V` counted in instances. Forty nodes failing one criterion are one violation of the target level, not forty; counting nodes inflates `V` and hides which criteria were never reached | `V` counts distinct `SC` values (§9), the instance count is reported beside it, and the two are never summed |
| 6 | An overlay read as remediation. A widget promising runtime fixes leaves the defect in place and adds a keyboard surface of its own | §6's second override: file the defect, file the overlay as its own `S3` row, lower nothing |
| 7 | A WCAG 2.2 criterion inferred from a green scanner. No shipped engine covers the 2.2 additions in full (§6), so silence about 2.4.11, 2.5.7, 2.5.8 or 3.3.7 is the engine's gap, not a pass | judge those criteria by hand in steps 2–8, and name the engine gap in *Границы достоверности* beside the tool versions |

## 11. Audit-specific prohibitions

Beyond `report-contract.md` §9. Each row's alternative is what the protocol uses instead.

| Prohibited | Safe alternative |
|---|---|
| **Do not start or build the application** — no `npm run dev`, `npm run build` or equivalent: they write caches into the audited tree | the dynamic steps run against `PREVIEW_URL`, or they do not run at all |
| **Do not complete an irreversible step during the keyboard walk**, and do not create an account or type credentials to reach a gated flow: no payment submitted, no entity deleted, no message sent | stop at the last reversible action of each flow; ask for a disposable test account on a non-production environment, and with none the flow is `не установлено` and stays in the denominator |
| **Do not let a scanner write into the audited tree** — no `.pa11yci` written, and no report left at a writer's own default: axe's `--dir` defaults to the working directory and Lighthouse's `--output-path` to the invocation directory, while pa11y writes no file at all and streams JSON to stdout, which lands in the tree the moment it is redirected without a path | step 1's writers each take an explicit destination under `OUTPUT_DIR` — `--dir`, `--output-path`, a redirect — created by that step's own `mkdir -p` |
| **Do not change the user's operating-system accessibility settings** to test reduced motion, contrast themes or zoom, do not leave a screen reader running, and do not paste screenshots or DOM dumps from an authenticated session into the report — they carry real user data | per-session browser emulation, or the static media-query check of step 8; the matrix records selectors, paths and ratios, never captured content |

## 12. Dependencies

**Input**, as parameter values per the contract's execution model, never as remembered context, and not blocking. **A-13**, arriving as `A13_REPORT` → its route table
becomes the `CRITICAL_FLOWS` candidate list, its `CLIENT_ROOT` is this audit's parameter of the same name, its duplicate-component catalogue is the top-`⌈N/3⌉` population
of §7 (each duplicate carries its own keyboard, focus and naming contract), and its state map names the asynchronous surfaces step 5 must find a live region for. Absent,
§1's census and §2's derivations rebuild all three, `CRITICAL_FLOWS` is derived and labelled an estimate, and *Границы достоверности* records the substitution at `medium`
or below. **Output: none** — `audit-index.md` gives A-21 A-13 on input and nothing on the hands-to side, and no other audit's input column names A-21.

## 13. Nearest marvin command

`audit-index.md`'s command table carries no row for A-21, and no shipped marvin command audits accessibility: `/marvin:sec-scan` and the `refactor-*` family judge other
properties of the same files. The nearest neighbour is A-13's accelerator, `/marvin:refactor-smells` over `CLIENT_ROOT`, which enumerates §7's component population faster than a fresh census; its output is evidence to verify against the markup, never a section to paste.
