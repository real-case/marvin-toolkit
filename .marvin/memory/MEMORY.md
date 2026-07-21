# Marvin lessons

Project memory — lessons learned during task execution and debugging, captured by the
`lessons` MCP tool and shared with the team via git. One line per lesson; the body lives
in the linked file. Recalled at task intake.
- [Adding a workspace needs sync-version + lint-manifests file-list edits, not just the packages/* glob](adding-a-workspace-needs-sync-version.md) — convention · 2026-07-19 · workspace, monorepo, ci, eslint, prettier, node-version, astro, sync-version, website
- [Site command catalog derives from shared help-content, read via in-memory TS transpile](site-command-catalog-derives-from.md) — convention · 2026-07-19 · website, astro, codegen, help-content, typescript, drift-guard, content-pipeline
- [Porting a hi-fi HTML mockup to an Astro page — three overflow/format traps](porting-a-hi-fi-html-mockup-to-an-astro.md) — gotcha · 2026-07-19 · astro, website, css, prettier, responsive, playwright, grid-overflow, mockup-port
- [verify tool false-fails server tests — MARVIN_TASKS_DIR and _CONFIG both leak from the server process](verify-tool-false-fails-server-tests.md) — process · 2026-07-19 · verify, task-verify, mcp, env-leak, monorepo, testing, ci, gotcha
- [The inner-pages mockup only draws the blueprint grid on the Pipeline pane — the other panes are plain](the-inner-pages-mockup-only-draws-the.md) — gotcha · 2026-07-19 · astro, website, css, mockup-port, blueprint, design-fidelity
- [Preact skips prop updates on hydrated DOM — seed island state after mount, not in useState](preact-skips-prop-updates-on-hydrated.md) — gotcha · 2026-07-20 · astro, preact, hydration, island, ssr, url-state, website, e2e
- [lint-staged commits the index, not your edits — re-stage after any post-staging fix](lint-staged-commits-the-index-not-your.md) — pitfall · 2026-07-20 · git, lint-staged, husky, pre-commit, workflow, task-implement, delivery
- [happy-dom breaks new URL() relative path resolution in vitest](happy-dom-breaks-new-url-relative-path.md) — gotcha · 2026-07-20
- [The committed widget HTML can be framed and driven by a ~150-line hand-rolled postMessage host](the-committed-widget-html-can-be-framed.md) — convention · 2026-07-20 · mcp-apps, widgets, ext-apps, postmessage, iframe, website, astro, theme, protocol
- [A running astro dev server hijacks the site e2e and its dev toolbar breaks strict-mode locators](a-running-astro-dev-server-hijacks-the.md) — gotcha · 2026-07-20 · playwright, astro, e2e, site, dev-server, testing, false-failure
- [Asciicast v2 and asciinema-player fail silently in four separate ways](asciicast-v2-and-asciinema-player-fail.md) — gotcha · 2026-07-21 · asciicast, asciinema, website, generator, terminal, silent-failure, testing
- [Keeping a heavy vendor lib out of an Astro island needs a new-script-request assertion](keeping-a-heavy-vendor-lib-out-of-an.md) — convention · 2026-07-21 · astro, preact, island, lazy-loading, vite, payload, website, e2e, playwright
- [A tsc invocation that names files on the command line silently discards tsconfig.json](a-tsc-invocation-that-names-files-on.md) — gotcha · 2026-07-21 · typescript, tsc, tsconfig, astro, site, ci, silent-failure, type-checking
- [document.fonts.check() returns true for fonts that were never registered](document-fonts-check-returns-true-for.md) — gotcha · 2026-07-21 · fonts, chromium, playwright, silent-failure, og-images, website, verification
