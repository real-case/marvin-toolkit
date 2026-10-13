---
slug: seal-syntax-check
type: feature
status: ready
created: 2026-10-13
tracker: none
supersedes: none
stack: typescript, node
risk: medium
breaking: false
spike_required: false
contract_sha: e7063e70d23a82f3
test_command: "npm run build -w @marvin-toolkit/mcp-shared && npm run build -w @marvin-toolkit/server && npm test"
---

# The seal stage refuses JavaScript tests that do not parse

## Goal
Before sealing, the autopilot's seal stage runs `node --check` on every `.js`, `.mjs` and `.cjs`
test the test-author listed, and refuses a file that does not parse with its path and the parser's
message, instead of reading its failed red run as a genuine red test.

## Context
- Red runs, first seal and re-seal: plugins/marvin/mcp/server/src/pipeline/seal.ts:844
- A re-seal with no candidate left creates no base tree: plugins/marvin/mcp/server/src/pipeline/seal.ts:939
- Reasons reach the test-author unchanged: plugins/marvin/mcp/server/src/pipeline/runtime.ts:1636, plugins/marvin/mcp/server/src/pipeline/engine.ts:883
- Scripted runner and fixtures to reuse: plugins/marvin/mcp/server/test/pipeline-seal.test.mjs:98, re-seal ones at :1955

## Spec Contract

```yaml spec-contract
files:
  - id: F1
    path: plugins/marvin/mcp/server/src/pipeline/seal.ts
    action: edit
    intent: After a candidate's bytes are read and before any red run, run `node --check` (process.execPath, cwd the worktree, bounded by timeoutMs) on each candidate whose extension is exactly .js, .mjs or .cjs. A candidate that fails, or whose check cannot run, gets a reason and is dropped from the red runs.
    anchor: plugins/marvin/mcp/server/src/pipeline/seal.ts:825
  - id: F2
    path: plugins/marvin/mcp/server/test/pipeline-seal.test.mjs
    action: edit
    intent: Tests for AC1-AC7 via the scripted runner; expected parser lines come from running `node --check` on the same file; the parseable `.js` fixture has a top-level `return` (CommonJS only), the `.mjs` one ESM. The `seal` helper default and the D-RESEAL test's 1000 ms `timeoutMs` rise to 60000, so the new spawn is not cut short.
  - id: F3
    path: plugins/marvin/CHANGELOG.md
    action: edit
    intent: A 0.29.1 entry under Fixed describing the seal stage's syntax check; the version bump itself goes through `npm run sync-version 0.29.1`.
build_order: [F1, F2, F3]
depends_on: []
contract:
  kind: function
  signature: |
    sealAuthoredTests(o: { worktree: string; tests: readonly AuthoredTest[]; testPathPattern: string; testOne: string; run: Runner; timeoutMs: number; base?: SealBase }): SealVerdict
    "<path>: does not parse (node --check): <parser message>"
    "<path>: syntax check did not run (<detail>)"
criteria:
  - id: AC1
    statement: 'Given a listed red .mjs test with `await import()` inside a non-async callback, when sealed, then ok is false, sealed is empty, and a reason starts "<path>: does not parse (node --check): " and contains node''s SyntaxError line.'
    implemented_by: [F1, F2]
    oracle:
      kind: test
      ref: plugins/marvin/mcp/server/test/pipeline-seal.test.mjs
    failure: A seal that trusts the scripted red exit and seals the unparseable file, or refuses it without the parser's message.
  - id: AC2
    statement: Given a listed test that does not parse, when sealed, then the runner passed as `run` is never called with a command naming that file.
    implemented_by: [F1, F2]
    oracle:
      kind: test
      ref: plugins/marvin/mcp/server/test/pipeline-seal.test.mjs
    failure: A check placed after the red runs, which still executes the broken file.
  - id: AC3
    statement: Given one seal call listing an unparseable .js, an unparseable .cjs and a parseable red .mjs, then each broken file has its own does-not-parse reason and nothing is sealed.
    implemented_by: [F1, F2]
    oracle:
      kind: test
      ref: plugins/marvin/mcp/server/test/pipeline-seal.test.mjs
    failure: A check limited to .mjs, or one that stops at the first broken file.
  - id: AC4
    statement: Given red tests with extensions .ts, .tsx, .jsx and a custom-pattern .py, each with content that is not valid JavaScript, when sealed, then all are sealed with no reason.
    implemented_by: [F1, F2]
    oracle:
      kind: test
      ref: plugins/marvin/mcp/server/test/pipeline-seal.test.mjs
    failure: A check by a `.js` prefix match or a `[cm]?jsx?` pattern, which also catches .jsx.
  - id: AC5
    statement: Given parseable red .js, .mjs and .cjs tests, when sealed, then all three are sealed with their sha256 and no reason.
    implemented_by: [F1, F2]
    oracle:
      kind: test
      ref: plugins/marvin/mcp/server/test/pipeline-seal.test.mjs
    failure: A check that refuses every .js/.mjs/.cjs file, or reads node's exit 0 as a parse failure.
  - id: AC6
    statement: Given a re-seal (base given) listing an unparseable .mjs, when sealed, then it is refused with the does-not-parse reason and the runner is never called for it.
    implemented_by: [F1, F2]
    oracle:
      kind: test
      ref: plugins/marvin/mcp/server/test/pipeline-seal.test.mjs
    failure: A check wired only into the first-seal path, so a revised broken test is red-run in the base tree and sealed.
  - id: AC7
    statement: 'Given a listed .mjs test and a timeoutMs too short for node to start, when sealed, then it is not sealed and its reason starts "<path>: syntax check did not run".'
    implemented_by: [F1, F2]
    oracle:
      kind: test
      ref: plugins/marvin/mcp/server/test/pipeline-seal.test.mjs
    failure: A check that treats a killed or failed spawn as a pass and seals the unchecked file.
  - id: AC8
    statement: Given the change, when the committed server bundle is compared with a fresh build, then they match.
    implemented_by: [F1]
    oracle:
      kind: command
      ref: node scripts/verify-dist.mjs
    failure: A source change committed without rebuilding dist/marvin-pipe.js and dist/server.js.
  - id: AC9
    statement: Given the change, when the changelog is read, then a 0.29.1 entry under Fixed describes the seal stage's syntax check.
    implemented_by: [F3]
    oracle:
      kind: prose-review
    failure: The version bumped with no changelog entry, or an entry under Added for what is a fix.
```

## Chosen Approach

**Stack compliance:** NATIVE — `node:child_process` `spawnSync`, already imported by seal.ts.

- Order: F1, F2, `npm run sync-version 0.29.1`, F3, `npm run build`, `npm run gen:catalog -w
  @marvin-toolkit/site`; what the commands rewrite is `scope.exempt`.
- Trap (AC6): with F1's drop in place, a re-seal whose every file is refused creates no base tree.
- Trap (AC5): check the file where it lies in the worktree. A `.js` file's module type comes from the
  nearest `package.json`, and a copy elsewhere can parse differently.
- Trap (AC1): the parser message is stderr's `SyntaxError: …` line, not its code frame, stack or
  version footer.
- Existing seal and runtime fixtures write only valid JavaScript; only F2's timeout default changes.
- Rejected: the check through `o.run` — the existing scripted runners answer an unknown command with
  a red exit, and the shell runner depends on `node` on PATH.
- Rejected: an in-process `vm` parse — ESM needs `--experimental-vm-modules`.

## Non-goals
- Checking TypeScript, JSX, Python or any other file type, by any tool.
- Changing the engine, runtime or test-author role prompt (reasons already reach the test-author).
- Detecting JavaScript that parses but fails to load (a missing import, a runtime error).

## Assumptions
- Path C: one coherent spec, the seal stage's syntax check for JavaScript test files.
- Assumed the feature flow (a new check, approach fixed by the task text, so no variant question),
  shipped as a patch 0.29.1 under Fixed because it closes a defect seen in a run
  (`merge_obligations` in .marvin/config.json); correct now if wrong.
- Assumed `process.execPath` rather than `node` on PATH, so the check does not depend on the shell
  environment; correct now if wrong.
- Assumed a JavaScript file in a JSX or Flow dialect under `.js` is refused, because the task names
  `.js` explicitly; correct now if wrong.
- Assumed `gates.test_one` (`node scripts/test-one.mjs {file}`) runs every `kind: test` oracle,
  from .marvin/config.json.

## Open Questions
none

## Critic Verdict & Overrides
PASS WITH WARNINGS — receipts 001 (BLOCK, fixed), 002; its two listed warnings folded into F2, the two unlisted ones accepted unseen.
