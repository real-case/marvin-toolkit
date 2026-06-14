import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "server.js");
// test → server → mcp → marvin → plugins → repoRoot
const repoRoot = join(here, "..", "..", "..", "..", "..");

/**
 * Drive the live stdio server: initialize, then one tools/call for `spec`,
 * and return the parsed `spec-result` JSON block from the tool output.
 */
function callSpec(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let initialized = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout; partial=${JSON.stringify(buf)}`));
    }, 15000);

    const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");

    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1 && !initialized) {
          initialized = true;
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "spec", arguments: args },
          });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          try {
            const text = msg.result.content.map((c) => c.text).join("\n");
            const m = text.match(/```json spec-result\n([\s\S]*?)\n```/);
            assert.ok(m, `no spec-result block in output:\n${text}`);
            resolve({ parsed: JSON.parse(m[1]), isError: msg.result.isError, text });
          } catch (err) {
            reject(err);
          }
        }
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", reject);

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "spec-test", version: "0" },
      },
    });
  });
}

const find = (parsed, id) => parsed.checks.find((c) => c.id === id);

// A complete, valid feature spec. `CLAUDE.md` is an `edit` path that exists at
// repoRoot; `docs/sample-new.md` is a `new` path that does not.
const VALID_FEATURE = `---
slug: sample-valid-spec
type: feature
status: ready
created: 2026-06-13
tracker: none
supersedes: none
stack: typescript
risk: low
test_command: "npm test"
---

# Sample Valid Spec

## Goal
Add a sample to prove the spec gate passes.

## Context
- Related patterns: existing tools
- Sibling specs: none

## File Change Plan

| Path | Action | Intent | Anchor |
|------|--------|--------|--------|
| CLAUDE.md | edit | document the sample | — |
| docs/sample-new.md | new | the sample doc | — |

## Interface / Contract
N/A

## Data & Config
N/A

## Chosen Approach
Write a sample doc and reference it.

## Why this over alternatives
- Variant 2 (rejected): heavier, no benefit.

## Acceptance Criteria

| ID | Criterion | verified_by | Failure path |
|----|-----------|-------------|--------------|
| AC-1 | Sample doc exists | test/sample.test.mjs::exists | file missing |
| AC-2 | It is linked from the index | test/sample.test.mjs::linked | no link |
| AC-3 | Build still passes | npm run build | build breaks |

## Test Plan
- Harness: node --test, npm test
- Test locations: test/
- Fixtures / setup: none

## Non-goals
- No runtime behavior change.

## Assumptions
none

## Open Questions
none

## Security / NFR
N/A — docs only.

## Critic Verdict & Overrides
none

## Design Notes
Sample.

## Future Considerations
- none
`;

const VALID_BUGFIX = `---
slug: sample-valid-bugfix
type: bugfix
status: ready
created: 2026-06-13
tracker: none
supersedes: none
stack: typescript
severity: high
test_command: "npm test"
---

# Sample bug

## Problem
It throws on empty input.

## Expected Behavior
It returns an empty result.

## Reproduction Steps
1. call with ""
2. observe throw

**Frequency:** always

## Root Cause Analysis
- Affected code: src/x.ts:10
- Cause: missing guard
- Impact scope: empty-input callers

## Severity & Impact
High — all empty-input callers crash.

## File Change Plan

| Path | Action | Intent | Anchor |
|------|--------|--------|--------|
| CLAUDE.md | edit | guard empty input | — |
| test/x.test.mjs | new | regression test | — |

## Fix Approach
Add an early return for empty input.

## Acceptance Criteria

| ID | Criterion | verified_by | Failure path |
|----|-----------|-------------|--------------|
| AC-1 | Empty input returns empty | test/x.test.mjs::empty | throws |
| AC-2 | Regression test fails pre-fix, passes after | test/x.test.mjs::empty | passes pre-fix |

## Regression Test Specification
**Test type:** unit
**Test location:** test/x.test.mjs
**What test verifies:** empty input returns empty
**Test must fail before fix:** yes (mandatory)

## Non-goals
- No API change.

## Assumptions
none

## Open Questions
none

## Critic Verdict & Overrides
none

## Design Notes
none
`;

test("a complete feature spec passes the DoR gate", async () => {
  const { parsed, isError } = await callSpec({ specContent: VALID_FEATURE, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "PASS", JSON.stringify(parsed.checks, null, 2));
  assert.ok(!isError, "a PASS verdict must not be flagged as an error");
});

test("a complete bugfix spec passes the DoR gate", async () => {
  const { parsed } = await callSpec({ specContent: VALID_BUGFIX, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "PASS", JSON.stringify(parsed.checks, null, 2));
});

test("empty verified_by and an open question both block", async () => {
  const content = VALID_FEATURE.replace(
    "| AC-2 | It is linked from the index | test/sample.test.mjs::linked | no link |",
    "| AC-2 | It is linked from the index |  | no link |",
  ).replace("## Open Questions\nnone", "## Open Questions\n- Should we also handle X?");
  const { parsed, isError } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(isError, true);
  assert.equal(find(parsed, "ac-verified-by").status, "fail");
  assert.equal(find(parsed, "open-questions").status, "fail");
});

test("a File Change Plan edit target that does not exist blocks", async () => {
  const content = VALID_FEATURE.replace(
    "| CLAUDE.md | edit | document the sample | — |",
    "| does/not/exist.ts | edit | document the sample | — |",
  );
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "fcp-paths").status, "fail");
});

test("a leftover template placeholder blocks", async () => {
  const content = VALID_FEATURE.replace(
    "Add a sample to prove the spec gate passes.",
    "Add a {sample} to prove the spec gate passes.",
  );
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "placeholders").status, "fail");
});

test("a spec with no frontmatter blocks on core fields", async () => {
  const { parsed } = await callSpec({
    specContent: "# No frontmatter\n\njust prose",
    projectRoot: repoRoot,
  });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "fm-core").status, "fail");
});

test("missing input is reported, not crashed", async () => {
  const { parsed } = await callSpec({ projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "input").status, "fail");
});
