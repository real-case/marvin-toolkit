# Marvin website — progress

**Updated:** 2026-07-20
**Plan:** [website-implementation-plan.md](website-implementation-plan.md) ·
**Requirements:** [website-requirements.md](website-requirements.md) ·
**Research:** [premium-page-research.md](premium-page-research.md)

This document tracks where the website work actually stands. It is the living counterpart
to the implementation plan: the plan says what to do, this says what is done.

## Status at a glance

The site is built and behaving. Phases 0 through 6 are complete and merged to `dev`: the
workspace, the generated content pipeline, all five pages, the client-side interactions, the widget
embeds and terminal recordings, and the agent + SEO surface. **Phase 5 is now closed** — the Home
hero's static terminal became a playable `/marvin:task-start` recording (spec
`016-website-home-hero-recording`), the last media piece the plan named. What remains is only the
Phase 7 **external** deploy runbook (Vercel project, domain, DNS, event verification); its in-repo
slice is already merged.

Note the plan describes Phase 6 as "agent surface, SEO **and analytics**". The analytics half
(FR-22) has moved to Phase 7. It was never separable from the deploy work: Vercel Analytics only
reports from a Vercel deployment, so until that project exists the only provable assertion is that
a stubbed call fired — which demonstrates wiring, not measurement. It lands with the project that
receives it.

Phase 5 was split because its two halves are different kinds of work. Embedding the widgets is
browser engineering that can be specified and verified end to end; recording the terminal
sessions is media production that needs someone to actually drive the tool and capture it. Holding
the embeds behind the recordings would have blocked a mergeable slice on an unscheduled one.

**The recordings are generated, not captured.** The asciinema CLI is not installed and a capture
could not be produced from the authoring session at all — and a real capture would carry local
paths and repo state needing scrubbing before a public site, would re-break whenever command output
changed, and could not hit a duration the page states. Instead a build-time generator emits
asciicast v2 files from authored scripts, each recording where its output was reconstructed from
(a `SKILL.md` section, a tool's own report renderer, or a real artifact from this repo). This is the
same trade the widget demos already make by showing a fixture rather than a live project. Swapping
in captured casts later is a content-only change, because the page reads each duration from the
cast rather than declaring it.

Both launch gates have moved since this document was last written. The repository is now
public, which satisfies the first gate outright, and the report-export feature is implemented
and waiting in a pull request rather than unstarted.

| Phase | State | Note |
|-------|-------|------|
| 0 · Design and specification | Complete | All five pages designed at hi-fi; decisions closed |
| 1 · Workspace scaffold | Complete | `packages/site` on Astro + Preact — PR #125, `706d0f8` |
| 2 · Content pipeline | Complete | Catalog, counts and version generated from plugin sources — PR #126, `2ddc50a` |
| 3 · Static pages | Complete | Built as four slices — PRs #128–#131, through `0089f46` |
| 4 · Interactive islands | Complete | Search, copy, Toolbox toggle — PR #132, `f9dff41` |
| 5a · Widget embeds | Complete | Live demos on `/toolbox` and Home, theme-synced — spec `011-website-widget-embeds` |
| 5b · Terminal recordings | Complete | Four generated asciicasts play on `/pipeline`, poster-first (spec `012-website-terminal-recordings`); the Home hero terminal is a playable `/marvin:task-start` recording (spec `016-website-home-hero-recording`), closing Phase 5 |
| 6a · Agent surface and SEO metadata | Complete | `llms.txt`, `sitemap.xml`, `robots.txt` and per-page canonical/OpenGraph from one page registry — spec `013-website-agent-surface-seo` |
| 6b · OpenGraph imagery | Complete | Five committed 1200×630 cards from the registry; `twitter:card` flipped to `summary_large_image` — spec `014-website-og-images` |
| 7 · Deploy pipeline | In-repo slice done | `vercel.json` + build-skip + Vercel Web Analytics wired (spec `015-website-deploy-analytics`); the external Vercel project/DNS and event verification remain — see the deploy runbook below |
| 8 · Launch | Ungated | **Both launch gates are met** — see Launch gates |

## What is shipped

The design deliverables are unchanged from the design phase. The rows below them record the
code that now exists on `dev`.

| Deliverable | Where | State |
|-------------|-------|-------|
| Requirements (FR-1…24, Decisions log) | [website-requirements.md](website-requirements.md) | Done |
| Premium-page design research | [premium-page-research.md](premium-page-research.md) | Done |
| Low-fi wireframes, all five pages | Private preview artifact (v2.3) | Done |
| Style proposal, font specimen, hi-fi mockups | Private preview artifacts; ported copies at `docs/design/mockups/` | Done |
| Workspace `@marvin-toolkit/site` | `packages/site/` | Astro static build, Preact integration, ported theme tokens, self-hosted fonts |
| Content pipeline | `packages/site/scripts/gen-catalog.mjs` | Emits `src/data/catalog.json` — every command, seven groups, counts and version, all derived from plugin sources |
| Page registry | `packages/site/src/data/pages.json` + `pages.ts` | One record per route — the single source for page metadata, the sitemap URL set, and the llms.txt page list |
| Agent + SEO surface | `packages/site/src/lib/seo.ts` + three endpoints | `/llms.txt`, `/sitemap.xml`, `/robots.txt`; canonical and OpenGraph emitted from the registry by `Base.astro` |
| Five pages | `packages/site/src/pages/` | `/`, `/commands`, `/pipeline`, `/toolbox`, `/quickstart` |
| Command search island | `packages/site/src/components/CommandCatalog.tsx` | Client-side fuzzy search, group chips, URL-reflected filter state |
| Copy-to-clipboard | `packages/site/src/layouts/Base.astro` | One delegated handler serving every command snippet site-wide |
| Demo-asset pipeline | `packages/site/scripts/gen-widget-demos.mjs` | Copies the nine committed widget documents and emits each widget's own fixture as JSON — build outputs, never versioned |
| MCP Apps host | `packages/site/src/lib/widget-host.ts` | ~150 lines speaking the `ui/*` wire protocol over `postMessage`; no SDK in the site bundle |
| Widget demo islands | `packages/site/src/components/WidgetDemo.tsx` | `<WidgetDemo>` (lazy, Home) and `<WidgetCanvas>` (picker + Live/Screenshot, Toolbox), theme-synced into the frame |
| Recording pipeline | `packages/site/scripts/gen-casts.mjs` | Authored stage scripts → one asciicast v2 per stage plus the committed manifest `src/data/casts.json`; fails the build on a command absent from the catalog |
| Cast player island | `packages/site/src/components/CastPlayer.tsx` | Poster server-rendered; the player module and its vendor stylesheet both load only on press |
| End-to-end suite | `packages/site/e2e/` | 47 Playwright tests across ten specs |

## Decisions locked

The full list with rationale is the Decisions log in the requirements document. In brief:

- **Positioning.** A hybrid landing-and-reference site; success is an install-command copy
  or a GitHub visit. Tagline: "Claude Code toolset for AI-assisted development without panic."
- **Design direction.** "Large friendly letters" on the widget theme tokens verbatim — zero
  new colors. Display face Hanken Grotesk; body on the system stack; JetBrains Mono for
  commands, eyebrows, and quips. Light is canonical, dark at full parity.
- **Hero.** The wordmark is the invocation itself, `/marvin:`, with the syntax in the accent
  color; the tagline sits beneath it.
- **Stack and hosting.** Astro with Preact islands, in the `packages/site` workspace, bound
  for Vercel at `marvin-toolkit.dev`, with privacy-friendly Vercel Analytics.
- **Content pipeline source.** The catalog derives from the curated `help-content.ts` shared
  with the `help` tool, not from `SKILL.md` frontmatter (Decisions log entry 13).

## Launch gates

| Gate | State | Detail |
|------|-------|--------|
| Repository public | **Met** | `real-case/marvin-toolkit` is public, so `/plugin marketplace add real-case/marvin-toolkit` now works for visitors and the primary call to action is live rather than inert |
| Report export (PDF + Markdown) | **Met** | The template-only feature merged as PR #133 (`bedc02c`) with plugin version 0.9.0, so the Toolbox's FR-18 claim is now true |

**Both gates are met** — no external dependency still blocks launch. With 6b and the Phase 7 in-repo
slice now merged (`vercel.json`, the build-skip decision, and Vercel Web Analytics — PR #152,
`6683131`), the remaining work before a public `marvin-toolkit.dev` is operational, not code: the
Phase 7 **external** steps (create the Vercel project, enable Web Analytics, add the domain and its
DNS — the deploy runbook below) and the design decision on the Home hero recording.

## How the widget embeds work

Worth recording, because the mechanism was not obvious before it was built.

The committed widget documents are real MCP Apps views: each mounts with no test seam, so it runs
the production path, which points an ext-apps `PostMessageTransport` at `window.parent`. Framed on
the site, that parent is the page — so the page only has to answer. It does that directly, in about
150 lines, rather than importing the ext-apps SDK: that bundle is overwhelmingly zod and is exactly
what makes each widget document roughly 300 KB, so importing it would have undone the near-zero-JS
budget the static phases hold. The surface actually required is one request, two notifications, and
two request answers.

Two details are load-bearing and easy to get wrong. The tool-result notification requires a
`content` member alongside `structuredContent`; omit it and the view's schema check fails, the SDK
swallows the error, and the frame sits on "Connecting…" with nothing in the console. And the widgets
ignore the protocol's own theme channel entirely, so FR-17 is satisfied by the parent reaching into
the frame to set `data-theme` on its `.mvroot` — which is what `allow-same-origin` on the sandbox
buys, and the reason the sandbox is not stricter.

Because the site speaks the protocol by hand, the end-to-end tests assert on the widget's own
rendered DOM through `frameLocator` — specifically on fixture data that exists nowhere in the
widget's shell. That makes the suite a protocol-drift detector: if the handshake shape ever
changes, the demos fall back to their static minis and CI fails, rather than the site quietly
degrading.

## Known-wrong content in the committed mockups

`docs/design/mockups/home.html` and `inner-pages.html` print `/marvin:verify`, which is **not a
command**. `verify` is an MCP tool; the command is `/marvin:task-verify`. The mockups also print
`/marvin:task-list` and `/marvin:task-detail`, which are widget names — widgets are bound to tools
(`task`, `task-detail`, `tracker`), and tools have no slash form. The commands that actually reach
those widgets are `/marvin:track-list` and `/marvin:track-show`.

The mockups are deliberately **not corrected**. They are read-only porting references preserved
verbatim from the private design artifact — that is why `.prettierignore` excludes them — and
editing them would defeat the "verbatim" contract that makes them trustworthy as a record of what
was approved. Do not port these three strings forward. The site's own pages are correct, and
`packages/site/test/command-refs.test.mjs` fails the build if a non-existent command reaches an
`.astro`, `.tsx`, `.ts` or `.mjs` source, so a future port cannot reintroduce them silently.

## What is not yet done

- No Vercel project, no domain configuration, no preview deployments, and no analytics events
  confirmed in the dashboard (Phase 7 **external** runbook). The in-repo Phase 7 slice —
  `vercel.json`, the build-skip decision, and the wired Web Analytics events — is merged; what
  remains needs access outside the repository.

## Next action

**Phase 7 — the external deploy runbook.** Every in-repo, code-shaped piece of the website is now
merged, including the Phase 7 slice (spec `015-website-deploy-analytics`: a root `vercel.json`, the
build-skip decision, and Vercel Web Analytics with the `install_copy` / `github_click` events) and
the Home hero recording (spec `016-website-home-hero-recording`), which closed Phase 5. What remains
needs access outside the repository — creating the Vercel project, pointing it at the repo root,
enabling Web Analytics, configuring `marvin-toolkit.dev` and its DNS, and confirming the events land
in the dashboard. That runbook is below; completing it is the last thing between here and a public
`marvin-toolkit.dev`.

## Phase 7 deploy runbook (external — not in the repo)

The in-repo slice (spec `015-website-deploy-analytics`) ships the committed configuration; the steps
below need the Vercel dashboard and DNS and are done once, by hand:

1. **Create the Vercel project** from the GitHub repo. Set **Root Directory = repository root** (not
   `packages/site`) — the committed `vercel.json` lives at the root and declares an explicit
   `buildCommand` / `outputDirectory`, so Vercel builds the site workspace with no per-directory
   preset. Vercel reads `vercel.json` from the Root Directory, so the two must agree.
2. **Node version** — ensure the project runtime is Node 22.x (≥ 22.12), the Astro 7 floor. Leave the
   default install command: the build's `gen` step transpiles TypeScript with the `typescript`
   devDependency, so an `--omit=dev` install would break it.
3. **Enable Web Analytics** for the project (Analytics tab). This is what mounts `/_vercel/insights/*`;
   until it is on, the collector script 404s and no events are recorded — exactly the local behaviour
   the e2e tolerates.
4. **Ignored Build Step** — `vercel.json`'s `ignoreCommand` already runs
   `packages/site/scripts/vercel-ignore.mjs`, so no dashboard action is needed. It skips a build
   unless a change touches `packages/site/`, `packages/marvin-mcp-shared/`, `packages/marvin-widgets/`,
   or `plugins/marvin/`, and fails open (builds) on any git error.
5. **Domain** — add `marvin-toolkit.dev` and configure DNS. Production stays unpublished until the
   Phase 8 launch.
6. **Verify measurement** — after the first deploy, copy an install command and click a GitHub link on
   the live site, then confirm `install_copy` and `github_click` appear in the Analytics dashboard.
   This is the only place measurement (as opposed to wiring) can be proven.

**CSP is deferred.** No Content-Security-Policy header ships in this slice. When one is added (a
Phase 7 hardening pass, verified against the live origin — a CSP passes locally and breaks only on the
deployed site), its `script-src` must include `'wasm-unsafe-eval'` (the asciinema cast player's
inlined WebAssembly) and allow the Vercel insights script; `img-src` / `font-src` must allow `data:`
(favicon and fonts); and `frame-src` must allow the widget-embed iframes.

## Change log

- **2026-07-23** — Phase 5 closed. The Home hero's static terminal became a playable
  `/marvin:task-start` recording (spec `016-website-home-hero-recording`), poster-first like the four
  pipeline stages, with the paired widget card redrawn from the verify gates to a spec-readiness
  Definition-of-Ready view — so both halves of the terminal ⇄ widget parity now read the same command.

  **The chosen command changed the design calculus.** The static hero showed `/marvin:task-verify`,
  which is pipeline stage 3, so a verify recording would have replayed stage 3 across two pages.
  Recording `/marvin:task-start` instead makes the hero its own moment — but that command is itself
  pipeline stage 1, so the recording is authored as a deliberately DISTINCT cut: it headlines the
  *vague ask → sealed spec* transformation rather than stage 1's readiness-gate mechanics, and a guard
  (`casts.test.mjs` "the hero recording is distinct from every pipeline stage") fails the build unless
  a majority of the hero's output lines are unique to it.

  **The one genuinely new risk is the fold.** The four stage players are below it; the hero is above
  it, so `client:visible` hydrates the island at first paint. The player itself is reused unchanged
  from spec 012 — the ~330 KB (mostly an incompressible inlined WASM blob) stays behind the play
  button via a dynamic import in the activation handler — and a dedicated e2e (`hero-cast.spec.ts`)
  proves activation causes a *new* script request, so a future top-level import that folded the
  payload into the island's own chunk (which, above the fold, is effectively first paint) would fail
  rather than silently blow the budget. With this, every in-repo website phase is complete; only the
  Phase 7 external runbook remains.

- **2026-07-22** — Phase 7 in-repo slice implemented (spec `015-website-deploy-analytics`). A root
  `vercel.json` declares the static build of the site workspace and wires a committed, unit-tested
  build-skip decision (`packages/site/scripts/vercel-ignore.mjs`, diffing `$VERCEL_GIT_PREVIOUS_SHA`).
  Vercel Web Analytics is wired through the `@vercel/analytics` package — the `<Analytics/>` component
  plus one delegated `track()` listener firing `install_copy` on install-command copies and
  `github_click` on GitHub links. Analytics (FR-22) lands here rather than in Phase 6 because
  measurement only reports from a Vercel deployment; the e2e proves the wiring fires by reading the
  queued event, and the dashboard/domain steps are the runbook above. CSP stays deferred with its
  requirements recorded.

- **2026-07-21** — Phase 6b implemented. Five 1200×630 cards are generated from the page registry
  and committed, every page emits an absolute `og:image` with declared dimensions and alt text, and
  `twitter:card` moved to `summary_large_image`. Phase 6 is closed.

  **The font blocker recorded above was real but narrower than it read.** It applied only to the
  SVG-rasterizer family: satori states verbatim that woff2 is unsupported (it parses via
  `opentype.js`, which never added it), and `@resvg/resvg-js` gates woff2 behind
  `#[cfg(target_arch = "wasm32")]`, so its native Node binding has no woff2 path at all — not
  "version-dependent" but absent. Chromium, however, reads woff2 natively, and `@playwright/test`
  was already a devDependency and already renders 101 committed visual baselines in this repo. So
  the cards are screenshots of a generated HTML document, and no new dependency was needed. The TTF
  decision the entry above was waiting on never had to be made.

  **The mechanism worth carrying forward is how staleness is detected.** These are committed
  binaries and Chromium output is platform-dependent, so CI can neither regenerate nor pixel-compare
  them. Instead the manifest records what went *into* each render — the exact title and card line,
  the palette, and each font's load status — and the guards compare those strings against the
  registry and against `theme.css` parsed independently. Retitle a page or change a token without
  regenerating and the build fails with the reason; all three failure paths were verified by
  perturbing the sources and watching the guards fire.

  **`document.fonts.check()` is not a usable font signal**, which cost two review rounds to
  establish. It returns `true` against a page with **zero** registered faces, so it cannot detect a
  typo'd `font-family` or a dropped `@font-face` rule — the exact fallback the guard exists to
  prevent. It *does* catch a malformed font URI, which is what makes it treacherous: the failure you
  test by hand passes, and the one you ship does not. The generator uses `FontFace.status` instead,
  builds its status map from the *expected* family list (iterating `document.fonts` yields `{}` in
  precisely the never-registered case, so a guard over it would throw nothing), and single-sources
  each family name across the `@font-face` rule, the CSS that asks for it, and the lookup. Recorded
  in `.marvin/memory/`.

  A card rendered in a fallback face still looks like a finished card, and the artifact is binary,
  so review cannot catch it. That is the whole reason this phase carries as much guard machinery as
  it does.

- **2026-07-21** — Phase 6 split into 6a (agent surface and SEO metadata) and 6b (OpenGraph
  imagery), and 6a implemented. The site now serves `/llms.txt`, `/sitemap.xml` and `/robots.txt`,
  and every page carries a canonical link plus OpenGraph and Twitter metadata. Analytics (FR-22)
  moved to Phase 7, where the Vercel project that receives the events actually exists.

  The design decision worth carrying forward is that **one registry feeds all three consumers**.
  `src/data/pages.json` is read by `Base.astro` for metadata, by the sitemap for its URL set, and
  by llms.txt for its page list — so those three cannot disagree about which pages exist or what
  they are called. Critically, canonical, `og:url` and each sitemap `<loc>` are all built from the
  registry `path` and never from `Astro.url`: with directory build output a page resolves as both
  `/commands` and `/commands/`, so deriving one from the request and the other from the registry
  would let a single page advertise two canonical URLs while every test still passed.

  Two things were fixed that the phase did not set out to fix. The Quickstart had claimed since
  Phase 3 that the site serves `llms.txt` while nothing served it — the same class as the
  `/marvin:verify` defect PR #144 fixed, one level up, and now closed by a test that asserts the
  link resolves. And the type gate was checking far less than it appeared to: `check:catalog` named
  its files on the tsc command line, which makes tsc discard `tsconfig.json` entirely, so it ran at
  target ES5 without any of Astro's strict options. It now runs `tsc -p tsconfig.check.json` and
  covers every TypeScript module the site ships. Both are recorded in `.marvin/memory/`.

  The llms.txt command index deep-links each command to `/commands?q=<name>`, which works only
  because Phase 4 shipped URL-reflected filter state — that is what keeps the section a conformant
  markdown link list rather than bare bullets, and it means the two phases are now coupled:
  breaking the `?q=` contract would silently degrade every link in llms.txt.

- **2026-07-21** — Phase 5b implemented for the pipeline tour. The four stage posters became lazy
  player islands over generated asciicast v2 recordings, with every command, caption and duration
  now read from the generated manifest instead of typed into the page — the four hardcoded
  durations (`0:42` / `1:18` / `0:55` / `0:38`) are gone, and no stated runtime can disagree with
  the recording it labels. Two things worth carrying forward. The player's weight (~330 KB, most of
  it an inlined WebAssembly terminal emulator that minification cannot shrink, plus 19 KB of vendor
  CSS) stays entirely off the initial page: both the module and the stylesheet load inside the
  activation handler, and the e2e proves it by asserting that activation causes a *new script*
  request — without that clause a top-level import would fold the payload into the island's own
  chunk while the cast and stylesheet stayed lazy and the test stayed green. And when a CSP arrives
  in Phase 7 it must include `'wasm-unsafe-eval'` in `script-src`, or the player will fail at
  runtime on the deployed site only.
- **2026-07-20** — Fixed four references to commands that do not exist, and added a guard so the
  class cannot recur. The site printed `/marvin:verify` on the Home hero and the Pipeline stage-3
  poster (`verify` is a tool, not a command — the page was even self-inconsistent, its own heading
  reading `STAGE 3 · task-verify`), and `/marvin:task-list` / `/marvin:task-detail` on the Toolbox
  (both widget names; widgets bind to tools, which have no slash form). The new
  `test/command-refs.test.mjs` scans every `.astro`/`.tsx` source for `/marvin:<name>` and checks
  each against the generated catalog — it found the two Toolbox cases, which nobody had noticed.
- **2026-07-20** — Phase 5 split into 5a (widget embeds) and 5b (terminal recordings), and 5a
  implemented: a build-time generator for the demo assets, a hand-rolled MCP Apps host over
  `postMessage`, and the two demo islands. `/toolbox` now frames all nine committed widget
  documents behind a picker, with the Screenshot side and the failure path cloning the page's own
  static minis; Home's teaser mounts three demos lazily on scroll. The Toolbox page gained minis
  for `task-detail` and `task-summary`, which the Phase-3 shell was missing — it had seven of the
  nine. The end-to-end suite grew from 32 tests to 38 across eight specs.
- **2026-07-20** — Phase 4 merged (PR #132): the `/commands` search island with URL-reflected
  filter state, site-wide copy-to-clipboard through a single delegated handler, and the
  Toolbox Live/Screenshot toggle. FR-3 was struck from the phase because the theme toggle had
  already shipped in the Phase-1 scaffold. Both launch gates re-checked and updated: the
  repository is now public, and report export is implemented and open as PR #133.
- **2026-07-19** — Phases 1 through 3 implemented and merged: the workspace scaffold
  (PR #125), the content pipeline (PR #126, with the FR-20 source correction in PR #127), and
  the five pages built as four slices (PRs #128–#131). The hi-fi mockups were committed to
  `docs/design/mockups/` as a read-only porting reference.
- **2026-07-17** — Design phase completed. Requirements reached v2.2 with all questions
  closed; premium-page research delivered and folded in (FR-24 added, refinements recorded).
  Style approved: direction A, Hanken Grotesk, light canonical. Hero reworked to the `/marvin`
  command wordmark. Hi-fi mockups built and verified for all five pages. The plan and this
  progress tracker were created.
