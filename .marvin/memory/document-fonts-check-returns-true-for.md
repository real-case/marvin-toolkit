---
id: document-fonts-check-returns-true-for
type: gotcha
title: document.fonts.check() returns true for fonts that were never registered
created: 2026-07-21
tags: fonts, chromium, playwright, silent-failure, og-images, website, verification
source: website-og-images
---

When verifying that a headless-Chromium render actually used a custom font (OG cards, screenshot generators, visual baselines), `document.fonts.check()` is the obvious API and it is the wrong one. Measured in `@playwright/test` 1.61.1's chromium, on a page with ZERO registered faces:

```
document.fonts.size                                        -> 0
document.fonts.check('800 29px "BogusFamilyNameXYZ"')      -> true
document.fonts.check('800 29px "Hanken Grotesk Variable"')  -> true
```

So `check()` cannot detect the two failures that actually happen: a typo'd `font-family` in the template, or an `@font-face` rule that went missing. It reports success against a page with no fonts at all.

It is misleading rather than simply weak, because it DOES catch the failure you are most likely to test by hand: a malformed `data:` URI registers a face with `status: "error"` and `check()` correctly returns `false`. So a manual probe of the "broken font file" case passes, you conclude the guard works, and it silently fails on the case you ship.

**Use `FontFace.status`** — `[...document.fonts].some(f => f.family === X && f.status === "loaded")` — which is false in both modes. Two follow-on traps, both real:

1. **Do not build the status map by iterating `document.fonts`.** In the never-registered case that set is empty, so you get `{}`, and an `assertFontsLoaded(statuses)` that throws on "any entry not loaded" throws nothing. Build the map from the EXPECTED family list, defaulting to `"missing"` when no FontFace exists.
2. **`status === "loaded"` proves a face loaded, not that the template used it.** Asymmetric typo: `@font-face` declares family `A` (loads fine), template's `font-family` says `B`. The lookup finds `A: loaded`, every guard is green, the render is in Helvetica. Single-source the family name across the `@font-face` declaration, the `font-family`, and the status lookup.

The strongest signal, if you need certainty, is a text-width measurement against a deliberately bogus family — `measureText` in the real face vs a family that cannot exist. Equal widths mean fallback. Measured 390.5px vs 371.6px for Hanken Grotesk 800 at 76px on "Commands".

Why this matters beyond fonts: a fallback-rendered image LOOKS like a finished image, and if the artifact is a committed binary, code review cannot catch it. The guard is the only thing standing between a font regression and shipping it.
