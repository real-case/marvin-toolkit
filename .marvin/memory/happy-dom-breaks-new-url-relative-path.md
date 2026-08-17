---
id: happy-dom-breaks-new-url-relative-path
type: gotcha
title: happy-dom breaks new URL() relative path resolution in vitest
created: 2026-07-20
tags: vitest, happy-dom, widgets, testing, node-path
source: "report-export-template (PR #133)"
---

In the widgets workspace's vitest (environment: happy-dom), `fileURLToPath(new URL("../../x", import.meta.url))` resolves wrongly — it produced ".../src/theme/undefined" — because happy-dom overrides the global URL. The symptom is nasty: the test passes when run standalone and fails only under the workspace runner, so it looks like a flake. Use pure node:path math instead, which no DOM polyfill can affect: `join(dirname(fileURLToPath(import.meta.url)), "..", "..", "x")`. Found while implementing export-template.test.ts (spec report-export-template, PR #133). Rescued by hand into the main store on 2026-07-20 — it had been captured only in the feat/report-export worktree, and `.marvin/` was gitignored at the time, so it would have been lost with that worktree. That gap is what prompted un-ignoring `.marvin/memory/`; lessons now travel through git as ADR-0021 always specified.
