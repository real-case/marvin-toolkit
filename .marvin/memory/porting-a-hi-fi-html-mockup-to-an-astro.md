---
id: porting-a-hi-fi-html-mockup-to-an-astro
type: gotcha
title: Porting a hi-fi HTML mockup to an Astro page — three overflow/format traps
created: 2026-07-19
tags: astro, website, css, prettier, responsive, playwright, grid-overflow,
  mockup-port
source: website-home-page
---

Porting the marvin website mockups (docs/design/mockups/*.html) to Astro pages hit three traps worth pre-empting on the sibling Phase-3 slices (Pipeline/Quickstart port the same source). (1) Prettier (prettier-plugin-astro) REFLOWS a `white-space:pre` block if it is a `<div>` — it reindented and collapsed the aligned `.marvin/` ASCII tree, and was also non-idempotent on the file. Fix: use `<pre>` (Prettier preserves `<pre>` content verbatim); it is also semantically correct. (2) At 360px the page overflowed by ~1245px because CSS grid tracks default to `min-width:auto` and won't shrink below a child's intrinsic width — a `white-space:nowrap` mono command (~360px) forced its track wide. Fix: `min-width:0` on grid children (`.herogrid>*`, `.twocol>*`, `.cards3>*`, `.wt3>*`) + `width:100%` on the flex command row so the inner `.code` (min-width:0, overflow:hidden, ellipsis) truncates; and a deliberate negative-margin "grid break" needs `overflow-x:clip` on its section + a trigger high enough that the free margin actually exists (raised 1300→1320px; the 1300-1312 band overflowed a few px, untested by a 1440 sample). (3) A Playwright e2e must read catalog.json via `fs.readFileSync`, NOT `import catalog from "...json"` — Node 24 ESM requires an import attribute (`with {type:"json"}`) and errors otherwise; fs-read matches the repo's node:test convention. Verify narrow-viewport overflow with a per-width `documentElement.scrollWidth - innerWidth <= 1` check across 360/768/1440 plus any grid-break boundary.
