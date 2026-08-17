---
id: lint-staged-commits-the-index-not-your
type: pitfall
title: lint-staged commits the index, not your edits — re-stage after any
  post-staging fix
created: 2026-07-20
tags: git, lint-staged, husky, pre-commit, workflow, task-implement, delivery
source: website-interactive-islands
---

This repo's husky + lint-staged pre-commit hook stashes unstaged work ("Hiding unstaged changes to partially staged files"), runs prettier/eslint on the INDEX, commits that, then restores the stash. So if you `git add` files early — e.g. to hand a complete diff to marvin-tm-diff-critic — and then edit them again to apply the critic's findings, `git commit` silently ships the PRE-fix version and leaves every fix sitting unstaged in the working tree. It looks like a normal successful commit; nothing warns you. Always re-`git add` after any post-staging edit, and verify with `git diff HEAD --stat` before pushing — empty output means the commit matches the tree you actually tested. On spec 010 this was caught only by that check and fixed with `git commit --amend`, one step before a PR that would have contained none of the ten critic fixes. Related to [[dist-staleness-lint-staged-trap]], which is the same hook biting the committed dist/ artifact from the other direction.
