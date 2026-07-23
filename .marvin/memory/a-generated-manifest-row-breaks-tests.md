---
id: a-generated-manifest-row-breaks-tests
type: process
title: A generated-manifest row breaks tests that ITERATE it, not just import it
  — grep both at caller discovery
created: 2026-07-23
tags: caller-discovery, generated-manifest, allowlist, spec, website, testing,
  task-start
source: website-home-hero-recording
---

When a spec adds a row to a committed generated manifest (packages/site's casts.json, catalog.json, pages.json), the callers to put in the file allowlist include not only modules that IMPORT the manifest but tests that ITERATE it — a `expect(casts.length).toBe(N)` assertion or a `for (const row of manifest)` loop that indexes DOM by each row's key. **Why it bites:** an "importers of X" grep misses these because the tests read the JSON via `fs.readFileSync(...casts.json)` (Node 24 ESM needs an import attribute for JSON imports), not an `import`, so grepping the import specifier returns nothing. On spec 016 the caller-grep declared `cast-player.spec.ts` unaffected; the spec-critic caught that it reads and loops the manifest (length-4 assert + per-row `.cast[data-stage=<key>]` lookups on /pipeline), which a fifth `hero` row breaks — and task-implement's scope gate would then refuse the fix. **How to apply:** at task-start caller discovery (and before trusting a "no callers" claim), grep the test dirs for the manifest's basename (`casts.json`) AND for iteration/count patterns, then scope such a test to the subset it owns (`manifest.filter(r => r.key !== "<new>")`) rather than letting the new row drive iteration it never rendered.
