---
id: don-t-let-a-feature-pr-be-the-first-to
type: process
title: Don't let a feature PR be the first to track a tooling directory in a
  shared repo
created: 2026-09-03
tags: pr-review, merge-conflicts, repo-hygiene, artefacts, naming
source: "PR #350"
---

Before committing pipeline artefacts (.marvin/ receipts, lesson indexes, verification files) check whether the BASE branch already tracks that path — `git ls-tree -r --name-only origin/dev | grep '^\.marvin/'`. If it does not, every parallel branch adds the same index file with no common ancestor, so the second PR to merge hits an add/add conflict in tooling scratch paid by whoever is trying to land a feature. Cite precedent from the base branch, never from sibling unmerged branches: PR #350's critique receipt claimed "tracked by repo precedent" while dev had zero .marvin/ paths. Same rule applies to numeric filename prefixes — dev's specs/ carried no prefix, yet four open branches each invented specs/001-*; derive naming from what the base actually contains.
