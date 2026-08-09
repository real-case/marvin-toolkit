---
id: a-committable-dist-server-js-cannot-be
type: gotcha
title: A committable dist/server.js cannot be built in a worktree — build it in
  the main checkout and copy it back
created: 2026-08-09
tags: worktree, dist, verify-dist, build, delivery, node_modules, tsup
source: single-source-human-run-flag
---

Measured 2026-08-08. A git worktree under `.claude/worktrees/` cannot produce a `dist/server.js` that passes `verify-dist`, and adding the missing `node_modules/@marvin-toolkit/*` workspace symlinks does NOT fix it.

Why: the worktree has a top-level `node_modules` but no `@marvin-toolkit/` entry, so those specifiers resolve by walking up to the MAIN checkout. esbuild bakes the resolved depth into every module-path comment — `../../../../../../../` (7) from a worktree versus `../../../../` (4) from the main checkout. That is ~730 of the ~785 changed bundle lines. Creating the symlinks by hand DID fix the depth to 4, but the bundle still differed: the worktree's own top-level `node_modules` was installed separately from the main checkout's, so inlined dependency bytes differ. Proven by elimination — the `mcp-shared` `dist/` files were byte-identical between the two trees.

Proof the environment itself is fine: build the main checkout to a temp dir (`npx tsup --out-dir $(mktemp -d)`) and hash-compare against `git show HEAD:…/dist/server.js`. It matched exactly. This check is non-destructive — it never touches the committed `dist/`, unlike `scripts/verify-dist.mjs`, which REBUILDS IN PLACE and leaves `dist/server.js` dirty (and reports a false failure inside a worktree).

Working procedure, verified end to end:
1. Commit everything in the worktree (bundle bytes will be wrong for now).
2. In the main checkout: `git stash push -- <its dirty files>`, then `git checkout --detach <the worktree commit sha>` — allowed even though the worktree holds that branch.
3. `npm run build -w @marvin-toolkit/mcp-shared && npm run build -w @marvin-toolkit/server`.
4. `cp` the resulting `dist/server.js` into the worktree.
5. In main: `git checkout -- …/dist/server.js`, `git checkout <original branch>`, `git stash pop`.
6. In the worktree: `git add …/dist/server.js && git commit --amend --no-edit`.
7. Prove it without rebuilding: `git diff <pre-amend> <amended> --stat` must list ONLY `dist/server.js`; the source is then identical to the tree that produced the verified hash.

Safe because `.prettierignore` has `**/dist/` and `eslint.config.mjs` ignores `**/dist/**`, so the lint-staged pre-commit hook cannot reformat the bundle and break byte-identity — verify this if either config changes. Related: [[dist-staleness-lint-staged-trap]].
