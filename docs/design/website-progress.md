# Marvin website — progress

**Updated:** 2026-07-20
**Plan:** [website-implementation-plan.md](website-implementation-plan.md) ·
**Requirements:** [website-requirements.md](website-requirements.md) ·
**Research:** [premium-page-research.md](premium-page-research.md)

This document tracks where the website work actually stands. It is the living counterpart
to the implementation plan: the plan says what to do, this says what is done.

## Status at a glance

The site is built and behaving. Phases 0 through 4 are complete and merged to `dev`: the
workspace, the generated content pipeline, all five pages, and the client-side interactions.
Phase 5 was split in two. The widget embeds (5a) are implemented, and the terminal recordings (5b)
now play on the four pipeline stages — but **Phase 5 is not closed**: the plan also names a Home
hero recording, which is deliberately deferred (see below). Phase 6 was split the same way and for
the same reason: 6a, the machine-facing surface, is implemented; 6b, the OpenGraph imagery, is not.
What remains is 6b and the deploy pipeline (Phase 7).

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
| 5b · Terminal recordings | Complete for the pipeline tour | Four generated asciicasts play on `/pipeline`, poster-first — spec `012-website-terminal-recordings`. Phase 5 stays open on the deferred Home hero recording |
| 6a · Agent surface and SEO metadata | Complete | `llms.txt`, `sitemap.xml`, `robots.txt` and per-page canonical/OpenGraph from one page registry — spec `013-website-agent-surface-seo` |
| 6b · OpenGraph imagery | Not started | Five cards; blocked on a font-pipeline decision — see below |
| 7 · Deploy pipeline | Not started | Now also owns analytics (FR-22); can run in parallel |
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

**Both gates are met.** Launch is no longer gated on anything outside the site — what stands
between here and a public `marvin-toolkit.dev` is 6b, Phase 7, and the decision on the Home hero
recording.

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

- **No Home hero recording.** The four pipeline stages now play, but the hero still shows its
  static terminal. This is the remaining piece of Phase 5, and it is deferred deliberately rather
  than forgotten: the hero's `.term` is one half of the `.parity` pair whose whole point is "⇄ the
  same command in Claude Desktop", making it the page's single deliberate grid break and its one
  orchestrated motion moment. Turning it into a player is a design change on the site's most
  important surface — one that already had to fight overflow at that boundary — and it would
  duplicate stage 3, since the hero shows the same command. It needs a design decision before it
  becomes a spec.
- **No OpenGraph images** (Phase 6b). The metadata names no `og:image`, and `twitter:card` is
  `summary` rather than `summary_large_image`, which is the correct pairing while no image exists.
  The blocker is a font pipeline, not the cards: `@fontsource-variable` ships **woff2 only**, and
  the two standard SVG→PNG routes need TTF or OTF — satori documents woff2 as unsupported, and
  resvg's handling is version-dependent. Rendering the cards in Hanken Grotesk therefore needs a
  decision first: commit an OFL-licensed TTF for build-time use, convert the woff2, or render the
  text as paths. Raster is genuinely required — every major crawler rejects SVG for `og:image`.
- No Vercel project, no domain configuration, no preview deployments, and no analytics events
  (FR-22, now Phase 7).

## Next action

Two independent pieces remain, plus one decision.

**Phase 6b — the OpenGraph cards.** Pick the font route above, then a generator emits five
1200×630 PNGs, committed like the widget visual baselines rather than rebuilt in CI. The metadata
already has the shape waiting for them.

**Phase 7 — the deploy pipeline**, which now also carries analytics. Worth starting early so
preview deployments cover the remaining work; it is the only phase needing access outside the
repository.

**The Home hero recording** still needs a design call before it can be specced — whether the
hero's grid break and single motion moment can carry a player, or whether the parity pair stays
static. It is the last of the plan's media work and the only thing keeping Phase 5 open.

## Change log

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
