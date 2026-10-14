---
slug: scanner-gates-via-gates-extra
type: feature
status: ready
created: 2026-10-14
tracker: none
supersedes: none
stack: markdown, javascript
risk: low
breaking: false
spike_required: false
test_command: node scripts/test-one.mjs test/scanner-gate-advice.test.mjs
contract_sha: c00dc4e9d0a1fbe6
---

# Scanner gates are advised through `gates.extra`, not a chain onto `lint`

## Goal
`task-verify`, `sec-gate` and `docs/configuration.md` still tell users to chain a security scanner
onto `lint` because the four gate names are the whole set. Since 0.29.0 `gates.extra` gives a
scanner its own named gate and its own status; the advice should say so. Documentation only, no
behaviour change.

## Context
- Outdated advice: plugins/marvin/skills/task-verify/SKILL.md:51 (bullet runs to line 61).
- Same advice: plugins/marvin/skills/sec-gate/SKILL.md:227, which also claims a verify gate always fails on a missing binary.
- Same advice in the docs: docs/configuration.md:478 (`### Scanners as gates`, chain at 485–516).
- `gates.extra` reference to link to: docs/configuration.md:141.
- Extras go through the same missing-binary probe as standard gates: plugins/marvin/mcp/server/src/lib/gate-plan.ts:201 appends them to the plan that `planGates` probes (plugins/marvin/mcp/server/src/tools/verify.ts:245), so a single simple `gitleaks detect` extra with no binary is `not-run`.

## Spec Contract

```yaml spec-contract
files:
  - id: F1
    path: plugins/marvin/skills/task-verify/SKILL.md
    action: edit
    intent: Rewrite the scanner bullet to recommend a `gates.extra` entry with its own name and status, keep the accurate `not-run` and no-test-evidence caveats, and drop the "fifth key is stripped silently" and chain-onto-lint advice.
    anchor: plugins/marvin/skills/task-verify/SKILL.md:51
  - id: F2
    path: docs/configuration.md
    action: edit
    intent: Rewrite `### Scanners as gates` around a `gates.extra` example and its own status row; the chained form survives only inline, in a paragraph marked as the route before 0.29.0.
    anchor: docs/configuration.md:478
  - id: F3
    path: plugins/marvin/CHANGELOG.md
    action: edit
    intent: Add a `## [0.29.5] — <date>` entry above 0.29.4 with a Changed or Fixed bullet saying task-verify, sec-gate and docs/configuration.md now advise `gates.extra` for scanners.
    anchor: plugins/marvin/CHANGELOG.md:7
  - id: F4
    path: test/scanner-gate-advice.test.mjs
    action: new
    intent: node:test file reading the four documents from the repository root with fs; covers AC1–AC5. The scanner section of F2 is the text from `### Scanners as gates` up to the next `## ` or `### ` heading; F1 and F5 are read whole.
  - id: F5
    path: plugins/marvin/skills/sec-gate/SKILL.md
    action: edit
    intent: Rewrite the "make it a gate" bullet to recommend a `gates.extra` entry and to say that a single simple command whose binary is missing is recorded `not-run`, not failed.
    anchor: plugins/marvin/skills/sec-gate/SKILL.md:227
build_order: [F1, F5, F2, F3, F4]
depends_on: []
contract:
  kind: none
criteria:
  - id: AC1
    statement: 'Given task-verify and sec-gate SKILL.md, when read, then each contains `gates.extra` and `not-run`, and task-verify contains `"command": "gitleaks detect"`.'
    implemented_by: [F1, F5, F4]
    oracle:
      kind: test
      ref: test/scanner-gate-advice.test.mjs::skills recommend gates.extra for scanners
    failure: A rewrite that mentions `gates.extra` in passing but gives no gitleaks entry, or leaves sec-gate untouched, fails.
  - id: AC2
    statement: Given F1, F5 and the F2 scanner section, when read, then none contains "stripped silently", "is chained onto", "means chaining it onto", "chained onto an existing gate" or "does fail when its binary is missing".
    implemented_by: [F1, F2, F5, F4]
    oracle:
      kind: test
      ref: test/scanner-gate-advice.test.mjs::outdated chaining advice is gone
    failure: Leaving the old sentence beside the new advice in any of the three, so both recommendations stand, fails.
  - id: AC3
    statement: 'Given the F2 scanner section, when read, then it contains `gates.extra` or `#gatesextra`, `"extra"`, `"command": "gitleaks detect"`, `not-run`, and "its own".'
    implemented_by: [F2, F4]
    oracle:
      kind: test
      ref: test/scanner-gate-advice.test.mjs::configuration scanner section uses gates.extra
    failure: A section that keeps only the `"lint"` chain example and links `gates.extra` elsewhere fails.
  - id: AC4
    statement: Given F1 whole, F5 whole and the F2 scanner section, when each is split on /\n\s*\n/, then every block containing `&& gitleaks` also contains `0.29.0`.
    implemented_by: [F1, F2, F5, F4]
    oracle:
      kind: test
      ref: test/scanner-gate-advice.test.mjs::a surviving chain is marked as the pre-0.29.0 route
    failure: 'Keeping the old fenced `"lint": "npm run lint && gitleaks detect"` example with no version note fails.'
  - id: AC5
    statement: Given the changelog, when read, then its first release heading is `[0.29.5]` and that entry mentions `gates.extra`.
    implemented_by: [F3, F4]
    oracle:
      kind: test
      ref: test/scanner-gate-advice.test.mjs::changelog records the advice change
    failure: Appending the note to the 0.29.4 entry instead of a new patch entry fails.
  - id: AC6
    statement: Given the edited skills, when the skill linter runs, then it exits 0.
    implemented_by: [F1, F5]
    oracle:
      kind: command
      ref: node scripts/lint-skills.mjs
    failure: Breaking a SKILL.md frontmatter or a `skills/…` reference while editing fails the linter.
```

## Chosen Approach
**Stack compliance:** NATIVE — none.

- Order: F1, F5 and F2 first, then bump with `npm run sync-version 0.29.5` (the manifests it rewrites are `scope.exempt` by-products), then F3, then F4; run `npm run build` and `npm run gen:catalog -w @marvin-toolkit/site` and commit what they rewrite.
- Example for F1 and F2: `"gates": { "extra": [{ "name": "secrets", "command": "gitleaks detect" }] }`, plus one sentence that the extra gets its own `<name> Results` section and verdict row, so a lint error no longer hides whether the scan ran.
- Traps: AC4 splits on blank lines, so a pre-0.29.0 chain may survive only inline inside the paragraph that says "before 0.29.0", never as its own fenced block. The "chained form is not covered, and still fails" paragraphs (docs/configuration.md:507) must be rewritten or folded into that paragraph.
- Traps: F5 keeps its contrast with the "Don't block on missing tools" bullet above it, but a missing binary now degrades to `not-run`; the trade is that only a chain or a multi-token shell command still fails.
- Traps: "the four gate names" is still true of `gates` keys (docs/configuration.md:131); leave that section alone.
- Rejected: deleting the chain entirely — the task allows either, and one inline sentence helps users still on 0.28.x.

## Non-goals
- Any change to `verify`, the config schema or gate probing.
- Editing ADRs, proposals or old CHANGELOG entries that record the chain as history.

## Assumptions
- assumed a feature (docs change, nothing broken at runtime) because the task text asks for corrected advice; correct now if wrong.
- assumed the chained form stays as one inline sentence marked "before 0.29.0" rather than removed, because the task allows either and older installs still exist; correct now if wrong.
- assumed a patch bump to 0.29.5 with a CHANGELOG entry because a SKILL.md edit is a prompt-body tweak under `merge_obligations` in .marvin/config.json; correct now if wrong.
- assumed the test runs under `node --test` as a root `test/*.test.mjs` because `package.json` `test` and `gates.test_one` (scripts/test-one.mjs) run those; correct now if wrong.

## Open Questions
none

## Critic Verdict & Overrides
BLOCK — receipt 001; resolved without a re-dispatch (cap 1) by orchestrator answer Q1: F5 added, AC1–AC4 tightened.
