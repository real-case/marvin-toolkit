---
id: adding-a-section-to-a-marvin-tool-also
type: gotcha
title: Adding a section to a marvin tool also means editing its prompt body —
  the file allowlist will not have it
created: 2026-07-28
tags: mcp, prompts, dashboard, help, allowlist, scope-gate, task-start, catalog
source: dashboard-tool-v2
---

`DashboardInput.section` (and the same pattern on `help`) is a free-form `z.string()`, not an enum, so the ONLY thing telling the model which section names are valid is the prose in the prompt registry (`src/prompts/index.ts`). Add a section to `SECTION_ORDER` and the new section is reachable over stdio and provable in tests, but unreachable through the `/marvin:` door the slice exists to serve — a silent half-delivery that every gate passes. Spec 018 scoped F1–F5 without it, so `/marvin:task-implement`'s scope gate refused the one-line fix until it was cleared with an explicit `allow` and recorded as a spec gap. Two things make this safe to just do: editing a prompt `body`/`description` cannot move `packages/site/src/data/catalog.json` (gen-catalog takes prose from `help-content.ts` and only name/order/count from `PROMPTS`), and it cannot move the registry count. What it does NOT cover is `COMMAND_DETAILS` in `help-content.ts`, which feeds the website and IS catalog-guarded — that one genuinely has to wait for a slice that regenerates the catalog. At task-start, put `src/prompts/index.ts` in the allowlist whenever the spec changes a tool's section/filter vocabulary. See [[site-command-catalog-derives-from]] for which source feeds which surface.
