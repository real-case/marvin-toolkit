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
Phase 5 was split in two — the widget embeds (5a) are implemented, and the terminal recordings
(5b) remain. What else remains is the machine-facing surface and measurement (Phase 6) and the
deploy pipeline (Phase 7).

Phase 5 was split because its two halves are different kinds of work. Embedding the widgets is
browser engineering that can be specified and verified end to end; recording the terminal
sessions is media production that needs someone to actually drive the tool and capture it. Holding
the embeds behind the recordings would have blocked a mergeable slice on an unscheduled one.

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
| 5b · Terminal recordings | Not started | Split out of Phase 5; asciinema casts not yet produced |
| 6 · Agent surface and SEO | Not started | Can run in parallel with Phase 5 |
| 7 · Deploy pipeline | Not started | Can run in parallel with Phase 5 |
| 8 · Launch | Gated | One gate met, one in review — see Launch gates |

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
| Content pipeline | `packages/site/scripts/gen-catalog.mjs` | Emits `src/data/catalog.json` — 51 commands, seven groups, counts and version, all derived from plugin sources |
| Five pages | `packages/site/src/pages/` | `/`, `/commands`, `/pipeline`, `/toolbox`, `/quickstart` |
| Command search island | `packages/site/src/components/CommandCatalog.tsx` | Client-side fuzzy search, group chips, URL-reflected filter state |
| Copy-to-clipboard | `packages/site/src/layouts/Base.astro` | One delegated handler serving every command snippet site-wide |
| Demo-asset pipeline | `packages/site/scripts/gen-widget-demos.mjs` | Copies the nine committed widget documents and emits each widget's own fixture as JSON — build outputs, never versioned |
| MCP Apps host | `packages/site/src/lib/widget-host.ts` | ~150 lines speaking the `ui/*` wire protocol over `postMessage`; no SDK in the site bundle |
| Widget demo islands | `packages/site/src/components/WidgetDemo.tsx` | `<WidgetDemo>` (lazy, Home) and `<WidgetCanvas>` (picker + Live/Screenshot, Toolbox), theme-synced into the frame |
| End-to-end suite | `packages/site/e2e/` | 38 Playwright tests across eight specs |

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
| Report export (PDF + Markdown) | **In review** | The template-only feature is implemented on `feat/report-export` (spec `report-export-template`, superseding the original server-side spec) and open as PR #133 into `dev`; it lands with plugin version 0.9.0 |

Neither gate blocks Phases 5 through 7, which can proceed regardless.

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

## What is not yet done

- No terminal recordings. The hero and the four pipeline stages still show poster placeholders
  rather than asciinema `.cast` files. This is Phase 5b.
- No `llms.txt`, no per-page OpenGraph images, no sitemap or robots directives, and no
  analytics events.
- No Vercel project, no domain configuration, and no preview deployments.

## Next action

Author and implement Phase 5b: the asciinema recordings for the hero and the four pipeline
stages, poster-first and never autoplaying. That is the last of the plan's media work.

Phases 6 and 7 depend only on Phase 3 and can run alongside it — worth starting the Vercel
project early so preview deployments cover the remaining work.

## Change log

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
