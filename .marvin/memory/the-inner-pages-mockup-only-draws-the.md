---
id: the-inner-pages-mockup-only-draws-the
type: gotcha
title: The inner-pages mockup only draws the blueprint grid on the Pipeline pane
  — the other panes are plain
created: 2026-07-19
tags: astro, website, css, mockup-port, blueprint, design-fidelity
source: website-quickstart-page
---

In docs/design/mockups/inner-pages.html only the Pipeline pane carries the `.blueprint` grid texture (line 233); the Commands (197), Toolbox (327), and Quickstart (404) panes are plain `.wrap` with no grid. The Quickstart slice (spec 008) still shipped the page-local 40px blueprint anyway — deliberately, for site-wide consistency with Home + Pipeline — so a spec that says "blueprint matching the mockup" is imprecise for those panes and the diff-critic will flag the divergence. When authoring the final Commands + Toolbox slice, decide the blueprint per page as an explicit design call (consistency with Home/Pipeline vs literal mockup-pane fidelity) and have a human confirm it, rather than copying "matching the mockup". See [[porting-a-hi-fi-html-mockup-to-an-astro]].
