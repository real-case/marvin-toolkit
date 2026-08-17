---
id: test-storybook-u-never-rewrites-a
type: gotcha
title: test-storybook -u never rewrites a PASSING baseline, so a sub-threshold
  visual change silently keeps the old image
created: 2026-08-09
tags: widgets, storybook, visual-regression, jest-image-snapshot, baselines,
  threshold, darwin
source: single-source-human-run-flag
---

Measured 2026-08-08. `npm run test-storybook:update -w @marvin-toolkit/widgets` only rewrites baselines whose diff EXCEEDS `failureThreshold` (100 pixels, `.storybook/test-runner.ts`). A real visual change under that budget leaves the committed PNG depicting the OLD UI, and `-u` reports success while doing nothing.

Concretely: correcting one `[group, name, human]` row in `help/fixture.ts` changed six stories. Only `widgets-help--group-detail-open` moved (the detail view also gains a whole legend row, blowing the budget). The other five — `fixture`, `fixture-dark`, `no-servers`, `no-statuses`, `not-git-repo` — gained only an 11x11 SVG worth ~28 antialiased pixels each and were left untouched, so a first `-u` pass reported "1 snapshot updated" and looked complete.

Two consequences worth knowing. The visual gate then proves the change on one story out of six, and each untouched baseline permanently burns ~28% of its jitter budget against a threshold whose own comment reasons about staying below a single changed digit.

Fix: `rm` the affected PNGs first, then run `-u`. jest-image-snapshot writes a MISSING baseline unconditionally, which is the only way to force-refresh a passing one. Verified: 5 written, then a plain `test-storybook` run green at 102/102.

Also note three stories derive from the base fixture by spreading it (`fixture.ts` — `noServersHelpFixture` and friends do not override `commands`), so a one-row fixture edit reaches more stories than the story list suggests. Count what RENDERS the row, not what the diff shows. Baselines are darwin-only and CI skips the comparison on ubuntu by design, so nothing catches a missed baseline in CI.
