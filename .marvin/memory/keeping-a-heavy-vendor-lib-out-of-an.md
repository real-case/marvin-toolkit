---
id: keeping-a-heavy-vendor-lib-out-of-an
type: convention
title: Keeping a heavy vendor lib out of an Astro island needs a
  new-script-request assertion
created: 2026-07-21
tags: astro, preact, island, lazy-loading, vite, payload, website, e2e, playwright
source: website-terminal-recordings
---

When a `client:visible` island owns a heavy third-party lib, `await import()` inside the activation handler genuinely works — measured on `/pipeline`: the island chunk stays 1.7 KB while asciinema-player lands in its own 186 KB chunk, fetched only on press. But the OBVIOUS e2e ("no .cast and no vendor stylesheet at load") does not protect it. Moving the import back to module top level folds the whole payload into the island's own chunk — which, for an above-the-fold island, `client:visible` fetches at page load — while the data file and the stylesheet stay lazy and that test stays green. The assertion that actually guards the budget: record every request, snapshot `scripts.length` after `waitForLoadState("networkidle")`, activate, then assert at least one NEW `resourceType() === "script"` request. You cannot name the chunk — Vite derives chunk names from the entry module's filename, so the player emitted as an unstable `_astro/dist.<hash>.js`. For a vendor STYLESHEET, prefer copying it into `public/` from the generator and injecting a `<link>` at activation over a dynamic CSS import: Astro hoists an island's imported CSS into the page head (measured on WidgetDemo.css), how it treats a dynamic CSS import is unverified, and the `public/` route gives a stable unhashed URL the e2e can assert on. Do not skip the stylesheet as "just styling" if it positions layout — see [[asciicast-v2-and-asciinema-player-fail]]. Two smaller traps: `toHaveCount(1)` is satisfiable while the element is still `hidden`, and `boundingBox()` does NOT retry, so `await expect(el).toBeVisible()` must come first or the measurement rides on Preact's microtask scheduling; and a per-width responsive loop that calls `page.goto` inside itself destroys anything activated before it, so activate INSIDE the loop.
