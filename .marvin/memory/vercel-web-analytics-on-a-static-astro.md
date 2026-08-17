---
id: vercel-web-analytics-on-a-static-astro
type: convention
title: "Vercel Web Analytics on a static Astro site: the package component, not
  the adapter — and how to test it"
created: 2026-07-22
tags: vercel, analytics, astro, static, website, e2e, testing, track, window-va
source: website-deploy-analytics
---

Adding Vercel Web Analytics to the static `@marvin-toolkit/site` does NOT need `@astrojs/vercel` (which would take over the Node-guarded build/output and the committed-artifact model). Use `<Analytics/>` from `@vercel/analytics/astro` in the layout `<head>` — it upgrades a `<vercel-analytics>` custom element that calls `inject()` client-side, so it works on `output: "static"` with no adapter; `astro build` compiles it fine. Fire custom events with `track()` from a **processed** module `<script>` (NOT `is:inline`, which cannot import). Distinguish which surface fired: mark rows with a data attribute the delegated listener reads (`.command[data-va-event]` → install rows fire `install_copy`; any `a[href*="github.com"]` → `github_click`).

TESTING (verified against v2.0.1 source, `node_modules/@vercel/analytics/dist/index.mjs`): `inject()`'s `initQueue()` sets `window.va` to push its raw arg array onto `window.vaq`, so `track("x")` appends `["event", {name:"x", options}]` — a clean array (NOT an `arguments` object), plus a `["pageview",...]` the component emits. Assert by reading `window.vaq`, filtering `e[0]==="event"`, reading `e[1].name`. On any non-Vercel origin the collector `/_vercel/insights/script.js` 404s (a `console.log`, not a console error, so it trips no e2e guard) and leaves the queue stub in place — which is exactly what makes events observable under `astro preview`; measurement itself only works once Web Analytics is enabled on the Vercel project (a dashboard step). For an outbound GitHub link, cancel navigation with a capture-phase `preventDefault()` in `page.addInitScript` so the bubble analytics listener still fires. Neither `<Analytics/>` nor the events `<script>` is an `astro-island`, so `astro-island`-count-0 guards on static pages still hold. See [[a-running-astro-dev-server-hijacks-the]] for the port-4321 e2e harness trap.
