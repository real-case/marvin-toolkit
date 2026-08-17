---
id: adding-a-workspace-needs-sync-version
type: convention
title: Adding a workspace needs sync-version + lint-manifests file-list edits,
  not just the packages/* glob
created: 2026-07-19
tags: workspace, monorepo, ci, eslint, prettier, node-version, astro,
  sync-version, website
source: website-scaffold
---

Adding a new npm workspace to marvin-toolkit takes more than the `packages/*` glob. `scripts/sync-version.mjs` (PACKAGE_FILES) and `scripts/lint-manifests.mjs` (lockedVersionFiles) hardcode the workspace list, so a new package.json silently drifts from the one-version invariant unless added to BOTH. A browser workspace also needs an `eslint.config.mjs` files-block (browser globals + JSX) and, to lint/format `.astro`, `prettier-plugin-astro` — add it by EDITING the existing `.prettierrc.json` (it wins Prettier's config resolution; a new `prettier.config.*` is silently ignored and the format gate falsely passes). If the framework's Node floor exceeds the repo's CI matrix (Astro 7 needs Node >=22.12 vs the Node-20 leg), guard its build to no-op below the floor (numeric version compare, not lexical) and gate its e2e to the higher leg.
