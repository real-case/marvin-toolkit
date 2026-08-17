---
id: site-command-catalog-derives-from
type: convention
title: Site command catalog derives from shared help-content, read via in-memory
  TS transpile
created: 2026-07-19
tags: website, astro, codegen, help-content, typescript, drift-guard,
  content-pipeline
source: website-content-pipeline
---

The @marvin-toolkit/site content pipeline (packages/site/scripts/gen-catalog.mjs) generates its command catalog + counts from plugin sources at build time: command identity/order from PROMPTS (plugins/marvin/mcp/server/src/prompts/index.ts) and ALL curated prose (blurbs, descriptions, trigger phrases, group blurbs) from @marvin-toolkit/mcp-shared/src/help-content.ts — the SAME coverage-guarded source the help tool + widget use, so the site catalog and the embedded help widget can't disagree (not SKILL.md frontmatter, despite FR-20's literal wording). Why: only 37/51 commands have a SKILL.md and prose-parsing is fragile; help-content covers all 51 with >=3 phrases each. How: it reads the two pure-data .ts files by transpiling them in memory (ts.transpileModule -> base64 data: URL import) — Node-flag-free (both have only a type-only/no import) and fail-loud if a runtime import is ever added. Phase 3+ pages import the typed catalog from packages/site/src/data/catalog.ts (never re-parse plugin sources or hand-maintain counts); catalog.json is Prettier-ignored (dodges the lint-staged churn trap) and byte-guarded + counts/identity-guarded by test/catalog.test.mjs on both CI legs.
