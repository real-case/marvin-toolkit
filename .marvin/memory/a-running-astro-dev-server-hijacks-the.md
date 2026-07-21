---
id: a-running-astro-dev-server-hijacks-the
type: gotcha
title: A running astro dev server hijacks the site e2e and its dev toolbar
  breaks strict-mode locators
created: 2026-07-20
tags: playwright, astro, e2e, site, dev-server, testing, false-failure
source: website-widget-embeds
---

`packages/site/playwright.config.ts` sets `webServer.reuseExistingServer: !process.env.CI`, so ANY process already listening on 4321 is reused instead of `astro preview`. If that process is `astro dev` (e.g. started via `.claude/launch.json` / preview_start for browser verification), the Astro DEV TOOLBAR is injected into every page — and it ships its own `<h1>` elements ("No islands detected.", "Audit", "Settings"). Every `page.locator("h1")` assertion then dies with `strict mode violation: resolved to 5 elements`. The symptom is maximally misleading: the failures land on pages your change never touched (pipeline.spec.ts, quickstart.spec.ts), which reads like a global regression, and they appear only in a full-suite run. Fix: `lsof -ti:4321 | xargs kill -9` (or preview_stop) before running the e2e, so Playwright starts its own `astro preview` against the built dist. Two related traps from the same session: (1) run playwright from `packages/site`, NOT the repo root — from the root it picks up no config, so `baseURL` is unset and every `page.goto("/")` fails with "Cannot navigate to invalid URL", and it writes artifacts to a root `test-results/` that is NOT gitignored (only `packages/site/test-results/` is), which then shows up as scope creep in the `spec` tool's scope gate; (2) the in-app Browser pane cannot verify `client:visible` islands at all — its viewport reports 0×0 with `document.visibilityState: "hidden"`, so IntersectionObserver never fires and islands never hydrate. Use Playwright for anything involving island hydration or iframes; it is also the deliverable.
