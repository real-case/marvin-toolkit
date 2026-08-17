---
id: a-worktree-with-its-own-node-modules
type: gotcha
title: A worktree with its own node_modules builds a committable dist/server.js
created: 2026-08-09
tags: worktree, dist, verify-dist, build, delivery, node_modules, tsup
source: single-source-human-run-flag
---

**Settle it in 30 seconds instead of assuming either way.** Build to a temp directory and diff against what is committed:

```shell
TMP=$(mktemp -d)
npm run build -w @marvin-toolkit/server -- --out-dir "$TMP"
diff <(git show HEAD:plugins/marvin/mcp/server/dist/server.js) "$TMP/server.js"
```

Only the lines you intended differ (your source changes, a `var VERSION = "0.12.4"` bump): build in this checkout and commit normally. Hundreds of `// ../../../../…node_modules/…` module-path comment lines differ: the bundle is not committable from here, so use the fallback procedure below.

Two details of that recipe matter. It is **non-destructive**, so it never touches the committed `dist/`; `scripts/verify-dist.mjs` is not a substitute, because it rebuilds in place and leaves `dist/server.js` dirty. And the `npm run … --` form is required: `npx tsup --out-dir "$TMP"` from the repo root exits with "No input files", because `tsup.config.ts` lives in the server workspace and the flag alone does not move the entry point.

**The rule is conditional, not absolute.** What decides it is whether the checkout you are building in has its own installed `node_modules`, not whether it is a worktree. `git worktree add` gives you a checkout with none, and that is the failing case. Once the worktree has been `npm install`-ed, neither effect below applies, so the cheapest fix for a fresh worktree is to install in it and re-run the diff.

**The failing case, measured 2026-08-08.** A worktree with no `@marvin-toolkit/` entry in `node_modules` resolves those specifiers by walking up to the main checkout. esbuild bakes the resolved depth into every module-path comment: `../../../../../../../` (7) from the worktree versus `../../../../` (4) from the main checkout, which was ~730 of the ~785 changed bundle lines. Creating the workspace symlinks by hand DID fix the depth to 4, but the bundle still differed, so hand-symlinking is not equivalent to installing. That residual difference was never isolated to a cause; a dependency tree resolved from a different lockfile state is the likely one, and it would show up in any checkout rather than being a property of worktrees. The diff catches it either way.

**The passing case, measured 2026-08-10** in `marvin-dashboard-9e53cb` during PR #178 (the 0.12.3 → 0.12.4 bump) and re-confirmed the same day in `relaxed-hopper-60a50d` at dev tip `6f9cd42`. Both worktrees carry their own top-level `node_modules` plus `node_modules/@marvin-toolkit/{mcp-shared,server,widgets,site}` symlinks resolving to their OWN packages. The committed bundle's module-path comments are at depth 4 (364 occurrences), the main-checkout depth. The temp-dir diff produced exactly one changed line in the first case (the intended `VERSION` bump) and zero in the second. The bundle was then built in the worktree and committed; `verify-dist` reported it in sync and left the tree clean.

**The build tells you before you diff.** `tsup.config.ts` warns when the checkout root has no `node_modules`, which is precisely the failing condition and is a correct signal: it fires in a fresh worktree and stays silent in an installed one (verified 2026-08-10). A build that printed that warning is not committable; a build that did not still deserves the diff, because the warning cannot see dependency-version drift.

**Fallback, for a worktree you cannot or will not install into.** Verified end to end:

1. Commit everything in the worktree (bundle bytes will be wrong for now).
2. In the main checkout: `git stash push -- <its dirty files>`, then `git checkout --detach <the worktree commit sha>`, which is allowed even though the worktree holds that branch.
3. `npm run build -w @marvin-toolkit/mcp-shared && npm run build -w @marvin-toolkit/server`.
4. `cp` the resulting `dist/server.js` into the worktree.
5. In main: `git checkout -- …/dist/server.js`, `git checkout <original branch>`, `git stash pop`.
6. In the worktree: `git add …/dist/server.js && git commit --amend --no-edit`.
7. Prove it without rebuilding: `git diff <pre-amend> <amended> --stat` must list ONLY `dist/server.js`, so the source is identical to the tree that produced the verified bundle.

Safe because `.prettierignore` has `**/dist/` and `eslint.config.mjs` ignores `**/dist/**`, so the lint-staged pre-commit hook cannot reformat the bundle and break byte-identity. Verify that if either config changes. Related: [[dist-staleness-lint-staged-trap]].
