# Premium landing-page techniques 2025–2026 — research for marvin-toolkit.dev

**Status:** research report v1.0 · 2026-07-17 · supports the approved "Large friendly
letters" direction ([website-requirements.md](website-requirements.md), Decisions log #10–12);
it does not reopen it.
**Visual companion:** [Premium page patterns, re-drawn](https://claude.ai/code/artifact/aa54e215-1f91-41ef-8360-ce80669ba7c7)
(private artifact; original schematic re-creations — grid skeletons, accent-budget map,
motion storyboard, verdict board). All illustrations in both documents are original
schematics; no copyrighted screenshots are embedded — sources are linked instead.

## Method

Three independent evidence legs, all run 2026-07-17:

1. **Computed-style browser audits** (first-party, highest confidence): linear.app,
   stripe.com, vercel.com, raycast.com, plus astro.build as the stack reference —
   live pages, `getComputedStyle` extraction of container widths, fonts, CTA colors,
   keyframe/reduced-motion/scroll-driven rule counts, media inventory.
2. **Served-HTML audits** (first-party): resend.com, clerk.com, liveblocks.io, warp.dev,
   zed.dev, family.co, amie.so, notion.com/product/calendar — full markup analysis
   (font files, color tokens, class censuses, video elements, CTA inventory). Facts from
   this leg distinguish observed markup from inferred runtime behavior.
3. **Adversarially verified web sweep** (secondary): 103-agent research harness; 25 claims
   put through 3-vote verification — 15 confirmed, 10 refuted. Notably, **every secondary
   "teardown" claim about individual exemplar sites failed verification** (exact palettes,
   container widths, social-proof inventories from blog teardowns were all wrong against
   the live pages). Per-site statements below therefore come exclusively from legs 1–2;
   the sweep supplies sector-level trends and galleries only.

A caution inherited from the sweep: the sector-norm source (Evil Martians' study of 100+
devtool pages) is qualitative — treat "most/half" as directional, not measured.

## Executive summary

**Restraint is the premium signal, and the approved direction already implements it.**
The strongest single observation across twelve live flagships: premium developer-tool
pages keep brand color *out of the buttons* (Linear, Vercel, Raycast, Zed all ship
monochrome CTAs), run one accent hue with tint washes, hold classic contained layouts
(1200–1450 px), and place motion *inside* product demos rather than on the page chrome.
Sector studies corroborate: centered max-width layouts and avoidance of flashy
interaction are near-universal in devtool landing design
([Evil Martians, 2025-07-08](https://evilmartians.com/chronicles/we-studied-100-devtool-landing-pages-here-is-what-actually-works-in-2025)).

Three strategic conclusions:

1. **Light-canonical is a differentiator, not a compromise.** Dark is the crowded devtool
   default (84 of Saaspo's dark-mode collection skew developer/AI products; the dark
   "Linear aesthetic" is documented as saturated to interchangeability —
   [LogRocket, upd. 2025-06-07](https://blog.logrocket.com/ux-design/linear-design/)).
   Warp — a terminal company — ships light-first. One caution attaches: "purple accents on
   dark" is named as part of the saturated cliché, so marvin's violet must live primarily
   on the light canvas, which the approved system already mandates.
2. **The still page is defensible engineering, not austerity.** Scroll animation is the
   single most common gallery style tag (88 on
   [Saaspo](https://saaspo.com/style/scroll-animations)), yet the premium cohort
   demonstrates the opposite; the compositor-thread budget
   ([web.dev](https://web.dev/articles/optimize-vitals-lighthouse),
   [Chrome Lighthouse](https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations))
   is the citeable defense of "one orchestrated moment" for a Lighthouse ≥ 95 target.
3. **A 2026 layer the requirements don't cover yet: agent-native marketing.** Resend and
   Liveblocks serve llms.txt-style homepages to non-browser fetchers; Clerk ships a
   "Build with agents" hero CTA; Liveblocks offers "Install with AI". For a toolkit whose
   product *is* MCP tooling, an agent-readable site door is on-brand and nearly free.

## Axis 1 — Color accents

### Accent-count census (first-party, 2026-07-17)

| Site | Default theme | Accent hues in marketing chrome | CTA color discipline |
|---|---|---|---|
| Linear | dark `#08090a` | 1, nearly invisible (indigo `#5E6AD2` on a skip-link; hero CTAs are white pills) | monochrome |
| Stripe | light | 1 (blurple `#533AFD`) + gradient-mesh artwork | brand-filled — the exception |
| Vercel | light `#fafafa` | 0 (black/white chrome) | monochrome |
| Raycast | dark `#07080a` | glow accents only; buttons light-gray | monochrome |
| Resend | dark `#000` | 0 — grayscale metal/glass materials | glass/white |
| Clerk | light, full dark parity | 2 (legacy violet `#6C47FF` → cyan `#5DE3FF`, as blurred glow) | neutral |
| Liveblocks | dark | ~1 (token-hidden; white-alpha glows) | neutral |
| Warp | light | 1 (lavender `#c7aeff` family, hover states) | neutral + accent hover |
| Zed | system dual | 1 (blue, with `blue-50/100` tint fills) | neutral + kbd chips |
| Family | light only | 4–5 candy accents on white | ink |
| Amie | light | 1 (orange `#ff9d00`) | neutral |
| Notion Calendar | light only | 1 (blue `#097fe8` with a full semantic tint layer) | neutral |

Findings:

- **Single-accent discipline is the norm at the premium end** — 9 of 12 run zero-to-one
  chromatic accents in the page chrome. Multi-accent (Family) is a deliberate
  consumer-candy positioning, not the devtool register.
- **The monochrome-CTA move.** The restraint signature is spending *zero* accent on
  buttons: Linear's hero has no colored CTA at all — the product window is the call to
  action. For marvin: the violet `--acfill` button should appear **exactly once per
  viewport** (the install CTA); all secondary actions are zinc surfaces or hairline
  ghosts. This is stricter than the tokens require and costs nothing.
- **Tint washes are how the accent works day-to-day.** Stripe's `#E2E4FF` chips, Zed's
  `bg-blue-50/100` fills, Notion Calendar's `blue-100/200` accent surfaces, Clerk's
  `[#64E5FF]/20` glows — all match marvin's existing `--acbg` (accent at 9–13% alpha).
  No new mechanism needed; the research confirms the token is the industry pattern.
- **Semantic vs brand separation is visible at the top end.** Linear keeps status colors
  (yellow star, orange in-progress) *inside the product screenshot*, never in marketing
  chrome; Notion Calendar namespaces campaign palettes away from the brand token layer.
  Marvin's rule — semantic red/orange/amber/green/blue only inside widget content —
  matches the best practice exactly.
- **Gradients have become lighting.** Resend runs 321 gradients that are all grayscale
  glass shine; Clerk's brand gradient exists as a blurred glow shipped at `opacity:0`
  awaiting interaction; Liveblocks' only gradients are pointer-tracking radial
  spotlights; Warp's whole page contains one gradient. The 2021 decorative rainbow mesh
  survives only at Stripe (WebGL canvas, an enterprise-budget signature). Verdict for
  2025–26: **flat with tint washes is current; decorative gradients are dated outside
  hero-art budgets.**
- **Dark-first is crowded, light-first differentiates** — see executive summary. Clerk
  and Zed demonstrate the full-parity dual-theme pattern marvin has committed to
  (`prefers-color-scheme` + forced attribute, identical to the widget tokens contract).

## Axis 2 — Layout grid structure

### Measured container register (computed styles)

```
 960          1204   1266  1280       1364        1448
──┼────────────┼──────┼─────┼──────────┼───────────┼────▶
 old grid   Raycast Stripe Astro     Linear      Vercel
                       └─ 818px nested text measure
            ▲                    ▲
            └── marvin content ──┘
                1200px shell · ≤72ch text · ~1360px media moments
```

- **The old 960/1140 grids are gone.** Every audited flagship sits between 1204 and
  1448 px. Recommendation for marvin: **~1200 px content shell** (consistent with the
  widget aesthetic), **≤72ch nested text measure** (Stripe nests 818 px text inside its
  1266 px shell — the two-tier pattern worth copying verbatim), and a single **~1360 px
  media tier** for the hero pair.
- **Centered, contained, stacked is near-universal** ("Almost all pages use a centered
  layout with a max-width container… A few go wide, stretching edge to edge" —
  [Evil Martians](https://evilmartians.com/chronicles/we-studied-100-devtool-landing-pages-here-is-what-actually-works-in-2025)).
  Going wide is therefore the highest-leverage *deliberate* break available: marvin gets
  one, the hero terminal ⇄ widget pair overflowing the shell. Precedent: Linear's hero
  is a left-aligned headline with the app window bleeding off the fold — the product
  literally breaks the frame.
- **Section cadence:** 8–13 stacked sections on every audited homepage (Linear 8,
  Vercel 10, Resend ~11, Stripe 13). Marvin's Home plan (hero, counts, workflow loop,
  day-one, `.marvin/` tree + memory, widget teaser, call-it-your-way, credibility,
  footer) lands at 9 — inside the register.
- **Bento is a minority pattern with documented fatigue** (29 of Saaspo's style tags vs
  88 scroll-animation; listed among trends creatives are "so over" in 2026 per the
  verified sweep's Creative Boom citation). None of the twelve audited pages is
  bento-led; Zed's "Built with ultimate care" grid is the closest, and it reads as a
  micro-feature index, not layout theater. Marvin's story is a linear workflow —
  stacked sections tell it; the Toolbox widget gallery stays a calm uniform card grid.
- **Grid breaks observed in the wild:** Linear's fold-bleeding hero window; Resend's
  oversized gradient-serif type over section boundaries; Raycast's floating detached
  pill nav; Zed's blueprint ornament — persistent side rails, 45°-rotated corner
  diamonds, tick-ruled dividers that make the page read as an annotated technical
  drawing. Zed's move is the one worth translating (see recommendations): it signals
  *drafting-table precision*, which is marvin's own story ("deterministic rails").

### The marvin hero skeleton (recommended composition)

```
┌────────────────────────────────────────────────────────────┐
│ nav (hairline border, no fill)                             │
├────────────────────────────────────────────────────────────┤
│                                                            │
│   Marvin.                          ┌─ terminal ─┬─ widget ─┐
│   AI-assisted development          │ $ /marvin: │ ▩ help   │
│   [without panic]  ← accent word   │ help       │  widget  │
│                                    │ …lines…    │  rows…   │
│   ┌ install ──────────┐ [copy]     │            │          │
│   └───────────────────┘            └────────────┴──────────┘
│   [Install CTA·violet] [GitHub·ghost]        ⇄ parity      │
│                                                            │
│   ← 1200px text column →     ← media pair may reach 1360 → │
└────────────────────────────────────────────────────────────┘
```

## Axis 3 — Animations

### What the twelve actually ship (first-party)

| Signal | Measured |
|---|---|
| Autoplaying hero product video | **0 of 12** (Resend's four loops are small decorative 3D-material clips, not product walkthroughs) |
| Click-to-play demos w/ posters | Zed (~11 videos, zero `autoplay` attributes), Notion Calendar (one Vimeo hero demo), Warp (one announcement video) |
| Keyframe rules | Linear 532 · Vercel 78 · Raycast 64 · Astro **2** |
| CSS scroll-driven animation rules | Vercel 4 · Raycast 5 · others 0 |
| `prefers-reduced-motion` rules | Vercel 16 · Astro 4 · Linear 1 · Raycast **0** |
| Pointer/hover systems | Liveblocks pointer-tracked radial glows; Clerk glow layers at `opacity:0` |

- **The "one hero moment" is real practice, not marvin's invention.** Notion Calendar is
  the purest case: a two-word headline, one orchestrated demo video, everything else
  static. Zed's demos wait for a click. The sector study's second universal rule:
  "Most pages avoid flashy interactions" ([Evil Martians](https://evilmartians.com/chronicles/we-studied-100-devtool-landing-pages-here-is-what-actually-works-in-2025)).
  Meanwhile scroll-animation is the #1 gallery tag (88 on Saaspo) — galleries reward
  motion, premium products don't ship it. Marvin sides with the products.
- **The engineering defense of the still page:** non-composited animations run on the
  main thread and jank on low-end devices; only `transform`/`opacity` composit, and
  only when CSS-driven — JS/rAF-driven transforms stay on the main thread
  ([web.dev](https://web.dev/articles/optimize-vitals-lighthouse),
  [Lighthouse audit](https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations)).
  Hero rules that follow: the terminal pane is the LCP element, so it renders as static
  HTML and never fades in; the orchestration animates opacity/transform only, via CSS;
  under `prefers-reduced-motion` the page loads directly into the settled frame
  (the token stylesheet's transition-kill already establishes the convention).
- **Reduced-motion practice in the wild is inconsistent** (16 rules at Vercel, zero at
  Raycast) — honoring it fully is still a differentiating craft signal, not table stakes.
- **Hero archetypes.** The sector taxonomy (animated product UI / static UI /
  switchable UI / live embed / code snippet / abstract) marks code-snippet heroes as the
  convention for CLI/SDK products and live embeds as a "power move… only realistic for
  narrow-scope tools". Marvin's terminal ⇄ widget parity hero combines the two credible
  archetypes for a CLI toolkit; the nine *live* widget embeds correctly live on the
  dedicated Toolbox page rather than in the hero.
- **Terminal recordings:** none of the twelve uses asciinema on the homepage (Zed uses
  screen-capture video; Warp uses screenshots). Marvin's asciinema choice for the
  Pipeline tour is differentiated *and* lighter than video — ship it poster-first with
  play-on-click/in-view, matching the zero-autoplay norm.

Motion storyboard (3 static frames with timings) — see the
[companion artifact](https://claude.ai/code/artifact/aa54e215-1f91-41ef-8360-ce80669ba7c7),
section 03.

## Axis 4 — Functionality

- **Copy-to-install.** Warp ships real `$`-prefixed commands (`brew install --cask warp`,
  `winget install Warp.Warp`); Astro's `npm create astro@latest` carries a copy button;
  Resend exposes copy-to-clipboard on code and an SDK/language tab switcher. Clerk and
  Zed ship none (components/download positioning). Marvin's two-command install with
  copy buttons (FR-2, FR-4) matches the convention; package-manager tabs are unnecessary
  (one canonical install path — a simplicity advantage worth keeping visible).
- **Theme toggles: zero of twelve marketing homepages show one** (they live in docs/apps).
  Marvin ships one anyway (FR-1) — a *conscious divergence* justified by the
  terminal ⇄ widget parity story: the toggle demonstrates the widgets' dual-theme
  contract live. Keep it in the nav, understated.
- **Command-palette (Cmd+K): zero of twelve.** The catalogued pattern is smaller and
  better: **single-key kbd chips** — Zed's hero CTAs carry keycap hints (D / C), Warp's
  nav Download carries `kbd D`. Marvin's adaptation: a `/` keycap on the Commands-page
  search field (focus shortcut inside the existing search island — no new JS island).
- **Interactive demos.** Liveblocks embeds a working multiplayer app as its hero
  (its product *is* the embed); Clerk renders its real auth components with annotated
  states; Resend's SDK switcher demos code + `HTTP 200` responses. This validates
  marvin's Toolbox as a live-embed page — and the taxonomy's "narrow-scope" caution
  validates keeping Home to a *teaser* of three widgets (FR-9), not nine.
- **Social proof splits into strategies** (all first-party):
  - *None at all* — Notion Calendar: zero logos, zero testimonials; confidence through
    subtraction (platform-brand budget required, but it proves absence can read premium).
  - *Practitioner names* — Zed: José Valim, Dan Abramov, Mike Bostock; credibility via
    who, not how many.
  - *Native-format quotes* — Family (16 verbatim tweets), Amie (tweets + a real email),
    Clerk (Stripe/Vercel CEOs *alongside* raw community tweets).
  - *Verifiable receipts* — Warp: 63k GitHub-star chip, Fortune-500 count-ups, SOC 2,
    and a logo wall where every logo links to evidence (case study, livestream).
  - Adjacent guidance: stars are meaningful at 1,000+; a near-zero count is anti-proof
    (verified sweep). Marvin at launch: the generated counts strip (51 · 13 · 10 · 9)
    is the own-numbers substitute, and Warp's *evidence-link* pattern adapts as claims
    that link to their artifacts (spec file, `verification.md`, ADR corpus) — receipts
    marvin actually has. No stars (Decision #4), no invented testimonials.
- **CTA cadence.** Primary CTA ×2 (Zed, Family, Notion Calendar) to ×4–5 (Resend, Clerk,
  Warp, Amie), always paired with exactly one lower-commitment ghost ("Documentation",
  "Explore …", "Contact sales"). Marvin: Home runs Install (violet) + GitHub (ghost) in
  the hero, repeated at the footer band — ×2–3 total; subpages ×1–2.
- **The agent-native layer (2026).** Resend and Liveblocks serve llms.txt-style
  homepages to agent fetchers; Liveblocks' second hero CTA is "Install with AI"
  (`npx skills add liveblocks/skills`); Clerk's hero offers "Build with agents" and
  lists an MCP server as a product feature; Resend's banner announces Remote MCP. For
  marvin — an MCP server product for an agentic IDE — serving `llms.txt` plus an
  agent-oriented install path is the single most on-brand emerging convention available.
- **Consent UX.** Stripe, Vercel and Notion carry cookie banners; marvin's cookieless
  Vercel Analytics (FR-22) means the first paint is never interrupted — a small,
  free premium differentiator the copy can quietly own.

## Pattern catalog

| # | Pattern | Seen at (first-party) | Why it reads premium | Cost |
|---|---|---|---|---|
| 1 | Monochrome secondary CTAs; accent fill once | Linear, Vercel, Raycast, Zed | Restraint = confidence; the page doesn't beg | none |
| 2 | Accent tint wash (≈10% alpha) as the working accent | Stripe, Zed, Notion Cal, Clerk | Color presence without shouting | none (token exists) |
| 3 | Two-tier container (wide shell, narrow text measure) | Stripe 1266/818; Vercel | Editorial readability inside product scale | trivial CSS |
| 4 | One deliberate grid break (hero media overflow) | Linear; sector taxonomy | Contained page + one wide moment = intent | low |
| 5 | Blueprint/schematic ornament (hairline grids, ticks, corner nodes) | Zed (rails, diamonds); Vercel Geist Grid ([geist](https://vercel.com/geist/grid), [setproduct](https://www.setproduct.com/blog/complete-guide-to-blueprint-grid-design)) | Drafting-table precision; craft at texture level | low, pure CSS |
| 6 | Display face reserved for headings over system body | Astro (Obviously + system-ui), Zed (Plex Serif), Resend (Domaine) | 3–4-face systems with one characterful voice | already approved |
| 7 | Mono micro-label/eyebrow system | Warp (ALL-CAPS eyebrows), Resend (625 mono labels), Zed (kbd chips) | Technical texture; speaks developer natively | none |
| 8 | Demo-as-hero (product window / code + switchable UI) | Linear, Clerk, Liveblocks, Resend | The product proves itself; no stock art | medium (the hero build) |
| 9 | Poster-first, click-to-play demo motion | Zed, Notion Calendar | Respect for attention + LCP | low |
| 10 | kbd single-key affordances | Zed (D/C/S), Warp (D) | Developer-respect flourish | tiny |
| 11 | Own-numbers proof instead of stars/logos | Warp stats register; counts-strip precedent | Verifiable > borrowed credibility | none (FR-5 exists) |
| 12 | Evidence-linked claims | Warp's proof-annotated logo wall | Social proof as data, not decoration | low |
| 13 | Native-format testimonials (tweets/emails), later | Family, Amie, Clerk | Authenticity over polish | n/a at launch |
| 14 | Agent-native door (llms.txt, agent-install CTA) | Resend, Liveblocks, Clerk | 2026 fluency; meets agents where they fetch | low |
| 15 | Accent-as-lighting (glow washes) | Clerk, Raycast, Liveblocks | Depth without decoration | medium; JS variants rejected |

## Recommendations

### (a) Techniques that strengthen the approved direction

All of these fit zero-new-colors, minimal JS, Lighthouse ≥ 95, and no-modals:

1. **Enforce the accent budget** — violet fill exactly once per viewport; all other
   buttons zinc/ghost; `--acbg` tint is the everyday accent (patterns 1–2). This is the
   single highest-value takeaway and it costs nothing.
2. **Blueprint-grid texture** on the hero and one or two section grounds: zinc hairlines
   at ≤6% alpha on a 8px-multiple pitch (pattern 5; the companion artifact's own
   background demonstrates it). Pure CSS `linear-gradient` background — zero JS, zero
   new colors, negligible paint cost.
3. **Two-tier container**: 1200px shell / ≤72ch text / ~1360px hero-media tier
   (pattern 3, measured register 1204–1448).
4. **One grid break**: the terminal ⇄ widget pair overflows the shell (pattern 4) — the
   page's only full-width gesture, which is exactly why it lands.
5. **Poster-first asciinema** on Pipeline/Quickstart: poster frame, play on
   click/in-view, settled frame under reduced motion (pattern 9 + compositor rules).
6. **Mono eyebrow discipline** everywhere a section starts, `$`-prefixed copyable
   commands (pattern 7 — already in the design language; this confirms and extends it).
7. **Counts strip as the launch-time social proof** (pattern 11) + **evidence-linked
   claims** (pattern 12): each Home claim links to the artifact that proves it (a spec
   file, `verification.md`, the ADR index). Uniquely available to marvin — the artifacts
   are the product.
8. **kbd `/` affordance** on the Commands search (pattern 10) — inside the existing
   search island, no new JS.
9. **Agent-native door** (pattern 14): serve `llms.txt`; document the agent-install
   path. On-brand for an MCP product; trivial in Astro.
10. **Schematic ornament** for the `.marvin/` tree and pipeline stages (pattern 5,
    Zed translation): tick-ruled connectors, corner nodes — the "deterministic rails"
    story drawn literally, in `--bd` zinc.

### (b) Conventions deliberately skipped — and the defense

| Skipped convention | Who does it | Why skipping is defensible |
|---|---|---|
| Dark-first / dark-only | Linear, Raycast, Resend, Liveblocks + the bulk of the sector | The saturated devtool default ([LogRocket](https://blog.logrocket.com/ux-design/linear-design/), [Saaspo dark-mode census](https://saaspo.com/style/dark-mode)); violet-on-dark specifically reads Linear-clone. Light-canonical with full dark parity keeps the differentiation *and* the parity story. |
| WebGL / canvas hero | Stripe | Enterprise-budget signature; breaks Lighthouse ≥ 95 and the islands budget. The terminal pair is marvin's hero moment — cheaper and more on-message. |
| Scroll-triggered animation everywhere | The gallery mainstream ([88 tags](https://saaspo.com/style/scroll-animations)) | Premium products measurably don't ship it; compositor-thread budget ([web.dev](https://web.dev/articles/optimize-vitals-lighthouse)) protects the perf target; stillness *is* the differentiation. |
| Bento-styled layout | Apple-derived mainstream; 29 Saaspo tags | Minority pattern with documented tastemaker fatigue; marvin's narrative is sequential (a workflow), not modular. Toolbox stays a uniform card grid. |
| Pointer-tracking glows / hover spotlights | Liveblocks, Clerk | Per-element JS listeners for decoration exceed the islands budget; contradicts the still-page stance. |
| Glassmorphism + 3D material renders | Resend | Requires a 3D asset pipeline; luxury-material tone fights "large friendly letters". |
| Gradient-filled display type | Resend, Stripe | Violates zero-new-colors; the accent word ("without panic") stays flat violet by decision. |
| GitHub star badge | Warp (63k) | Stars measure attention, not adoption; below ~1k they are anti-proof (verified sweep). Already Decision #4; now citeable. Revisit post-launch. |
| Cmd+K site palette | nobody audited ships one | Zero precedent among twelve premium pages; a search field with a `/` keycap covers the need at ~0 cost. |
| Custom body webfont | Inter/Suisse/Söhne licensing tier | System stack loads nothing, shifts nothing; Astro's own site proves display-over-system reads premium. Bricolage stays the only loaded face (subset, self-hosted). |
| Testimonial walls at launch | Resend (40), Clerk, Family | Fabricating early social proof reads hollow; Notion Calendar proves zero-proof confidence. Adopt native-format quotes only when real ones exist. |
| Cookie banner | Stripe, Vercel, Notion | Not applicable by architecture (cookieless analytics) — keep it that way and let the clean first paint speak. |

## Adopt / Adapt / Reject — mapped to the five pages

Priorities: **P1** = v1 must, **P2** = v1 should, **P3** = post-launch.

| Verdict | Pattern | Priority | Home | Commands | Pipeline | Toolbox | Quickstart |
|---|---|---|:-:|:-:|:-:|:-:|:-:|
| **Adopt** | Accent budget (one violet fill/viewport, tints elsewhere) | P1 | ● | ● | ● | ● | ● |
| **Adopt** | Two-tier container 1200/72ch/1360 | P1 | ● | ● | ● | ● | ● |
| **Adopt** | Blueprint-grid section texture | P1 | ● | | ● | | |
| **Adopt** | Mono eyebrows + `$` copyable commands | P1 | ● | ● | ● | ● | ● |
| **Adopt** | Poster-first asciinema (no autoplay) | P1 | | | ● | | ● |
| **Adopt** | Counts strip = own-numbers proof | P1 | ● | | | | |
| **Adopt** | llms.txt + agent-install path | P2 | ○ | | | | ○ |
| **Adapt** | One grid break: hero pair overflow | P1 | ● | | | | |
| **Adapt** | Schematic ornament (ticks, nodes) on tree + stages | P2 | ○ | | ○ | | |
| **Adapt** | kbd `/` focus on catalog search | P2 | | ○ | | | |
| **Adapt** | Evidence-linked claims → artifacts | P2 | ○ | | | ○ | |
| **Adapt** | Static violet tint wash behind hero media (lighting, not glow) | P3 | ○ | | | | |
| **Adapt** | Native-format practitioner quotes | P3 | ○ | | | | |
| **Reject** | Dark-first · WebGL hero · scroll-anim-everywhere · bento styling · pointer glows · glassmorphism · gradient type · star badge · Cmd+K palette · custom body font · launch testimonials | — | — | — | — | — | — |

Page-specific notes:

- **Home** carries nearly every adopted pattern; its section cadence (9) sits inside the
  measured 8–13 register. The hero follows the Linear lesson: the product demo *is* the
  call to action, with the one violet install button beside it.
- **Commands** is functionally closest to a docs surface: two-tier container, group
  filter chips in `--acbg` tint (active state), the `/` keycap, URL-reflected state
  (FR-14) — no decorative patterns needed; restraint carries it.
- **Pipeline** is the blueprint page: schematic ornament + grid texture + four
  poster-first asciinema recordings; the lessons loop closes with tick-ruled connectors.
- **Toolbox** is the "power move" page the taxonomy licenses: nine live embeds inline
  (no modals, FR-16), theme-toggle divergence justified here by the parity story.
- **Quickstart** copies Warp's install anatomy (`$` prompt, copy button, no PM tabs) and
  ends on the first `task-start` — one page, two commands, zero ceremony.

## Sources

**First-party audits (2026-07-17):** linear.app · stripe.com · vercel.com · raycast.com ·
astro.build (computed styles) · resend.com · clerk.com · liveblocks.io · warp.dev ·
zed.dev · family.co · amie.so · notion.com/product/calendar (served HTML).

**Verified secondary:**
[Evil Martians — We studied 100+ devtool landing pages (2025-07-08)](https://evilmartians.com/chronicles/we-studied-100-devtool-landing-pages-here-is-what-actually-works-in-2025) ·
[web.dev — Optimize CWV with Lighthouse](https://web.dev/articles/optimize-vitals-lighthouse) ·
[Chrome Lighthouse — non-composited animations](https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations) ·
[LogRocket — The Linear design trend (upd. 2025-06-07)](https://blog.logrocket.com/ux-design/linear-design/) ·
[Saaspo style census: dark mode](https://saaspo.com/style/dark-mode) / [scroll animations](https://saaspo.com/style/scroll-animations) ·
[Setproduct — Blueprint grid design (2026-04-21)](https://www.setproduct.com/blog/complete-guide-to-blueprint-grid-design) ·
[Vercel Geist — Grid component](https://vercel.com/geist/grid) ·
[rauno.me — Vercel craft notes](https://rauno.me/craft/vercel) ·
[Studio Meyer — 2026 trends reality check](https://studiomeyer.io/en/blog/webdesign-trends-2026-reality-check).

**Gallery sweeps (current standouts):**
[Godly](https://godly.design/sites) (Neon, Mastra, LlamaIndex, Browserbase, Greptile…) ·
[Saaspo developer-tools collection](https://saaspo.com/industry/developer-tools-saas-websites-inspiration) (Supabase, PostHog, Tailscale, Unkey, Firecrawl…) ·
[Lapa Ninja dev-tools](https://www.lapa.ninja/category/development-tools/) (Cursor, PlanetScale, Speakeasy, **Charm** — "We make the command line glamorous" — the single most on-point reference for premium CLI branding).

Secondary teardown claims about individual exemplars were adversarially refuted during
the sweep and are **not** used anywhere in this report; every per-site fact above traces
to the first-party audits.
