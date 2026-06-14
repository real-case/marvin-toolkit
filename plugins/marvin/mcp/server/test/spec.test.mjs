import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

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

// A complete, valid feature spec in the ADR-0007 spec-contract block format.
// `CLAUDE.md` is an `edit` path that exists at repoRoot; the other paths are
// `new`. The test oracle `test/sample.test.mjs` is allowlisted as plan row F3.
const VALID_FEATURE = `---
slug: sample-valid-spec
type: feature
status: ready
created: 2026-06-14
tracker: none
supersedes: none
stack: typescript
risk: low
breaking: false
spike_required: false
test_command: "npm test"
---

# Sample Valid Spec

## Goal
Add a sample to prove the spec gate passes.

## Context
- Related patterns: existing tools
- Callers / reverse-deps: none
- Sibling specs: none

## Spec Contract
The authoritative contract.

\`\`\`yaml spec-contract
files:
  - id: F1
    path: CLAUDE.md
    action: edit
    intent: document the sample
    satisfies: [AC2]
  - id: F2
    path: docs/sample-new.md
    action: new
    intent: the sample doc
    satisfies: [AC1]
  - id: F3
    path: test/sample.test.mjs
    action: new
    intent: tests for the criteria
    satisfies: [AC1, AC2]
build_order: [F2, F1, F3]
contract:
  kind: none
criteria:
  - id: AC1
    statement: Given the repo, when built, then the sample doc exists
    implemented_by: [F2, F3]
    oracle:
      kind: test
      ref: test/sample.test.mjs::exists
    failure: file missing
  - id: AC2
    statement: Given the index, then it links the sample
    implemented_by: [F1, F3]
    oracle:
      kind: command
      ref: npm run build
    failure: no link
  - id: AC3
    statement: Given the change, when reviewed, then it reads cleanly
    implemented_by: [F1]
    oracle:
      kind: prose-review
    failure: unclear
\`\`\`

## Data & Config
N/A

## Chosen Approach
Write a sample doc and reference it.

## Test Plan
- Harness: node --test, npm test
- Test locations: test/
- Conventions: none

## Definition of Done
- [ ] npm test green
- [ ] lint / type-check / build green

## Non-goals
- No runtime behavior change.

## Open Questions
none

## Security / NFR
N/A — docs only.

## Why this over alternatives
- Variant 2 (rejected): heavier, no benefit.

## Assumptions
none

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
created: 2026-06-14
tracker: none
supersedes: none
stack: typescript
severity: high
spike_required: false
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
- Callers / blast radius: empty-input callers
- Impact scope: empty-input callers

## Severity & Impact
High — all empty-input callers crash.

## Spec Contract
The authoritative contract.

\`\`\`yaml spec-contract
files:
  - id: F1
    path: CLAUDE.md
    action: edit
    intent: guard empty input
    satisfies: [AC1]
  - id: F2
    path: test/x.test.mjs
    action: new
    intent: regression test
    satisfies: [AC1, AC2]
criteria:
  - id: AC1
    statement: Given empty input, when called, then returns empty
    implemented_by: [F1, F2]
    oracle:
      kind: test
      ref: test/x.test.mjs::empty
    failure: throws
  - id: AC2
    statement: The regression test fails on pre-fix code and passes after
    implemented_by: [F2]
    regression: true
    oracle:
      kind: test
      ref: test/x.test.mjs::empty
    failure: passes pre-fix
\`\`\`

## Fix Approach
Add an early return for empty input.

## Regression Test Specification
**Test type:** unit
**Test location:** test/x.test.mjs
**What test verifies:** empty input returns empty
**Test must fail before fix:** yes (mandatory)

## Definition of Done
- [ ] regression test red before fix, green after
- [ ] npm test green

## Non-goals
- No API change.

## Open Questions
none

## Assumptions
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

test("a non-prose oracle with no ref and an open question both block", async () => {
  const content = VALID_FEATURE.replace("      ref: test/sample.test.mjs::exists\n", "").replace(
    "## Open Questions\nnone",
    "## Open Questions\n- Should we also handle X?",
  );
  const { parsed, isError } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(isError, true);
  assert.equal(find(parsed, "oracle-ref").status, "fail");
  assert.equal(find(parsed, "open-questions").status, "fail");
});

test("a File Change Plan edit target that does not exist blocks", async () => {
  const content = VALID_FEATURE.replace("path: CLAUDE.md", "path: does/not/exist.ts");
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

// ── spec-contract block: schema + traceability ───────────────────────────────

test("a legacy spec with no spec-contract block fails (hard cutover)", async () => {
  const content = VALID_FEATURE.replace("yaml spec-contract", "yaml");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "spec-contract").status, "fail");
});

test("a malformed YAML block fails", async () => {
  const content = VALID_FEATURE.replace("files:", "files: ][");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "spec-contract").status, "fail");
});

test("a {placeholder} left in the block fails the schema (parses as a map)", async () => {
  const content = VALID_FEATURE.replace("path: docs/sample-new.md", "path: {path/to/file}");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "spec-contract").status, "fail");
});

test("a test oracle outside the File Change Plan blocks", async () => {
  const content = VALID_FEATURE.replace(
    "ref: test/sample.test.mjs::exists",
    "ref: test/orphan.test.mjs::exists",
  );
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "ac-test-in-plan").status, "fail");
});

test("a criterion implemented by an unknown file ID blocks", async () => {
  const content = VALID_FEATURE.replace("implemented_by: [F2, F3]", "implemented_by: [F9]");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "ac-traceability").status, "fail");
});

test("a file satisfying an unknown criterion blocks", async () => {
  const content = VALID_FEATURE.replace("satisfies: [AC1]", "satisfies: [AC9]");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "fcp-traceability").status, "fail");
});

test("all-prose-review oracles block", async () => {
  const content = VALID_FEATURE.replace(
    "      kind: test\n      ref: test/sample.test.mjs::exists",
    "      kind: prose-review",
  ).replace("      kind: command\n      ref: npm run build", "      kind: prose-review");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "ac-verified-real").status, "fail");
});

test("an empty contract signature blocks", async () => {
  const content = VALID_FEATURE.replace("contract:\n  kind: none", "contract:\n  kind: function");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "contract").status, "fail");
});

test("a bugfix without a regression criterion blocks", async () => {
  const content = VALID_BUGFIX.replace("    regression: true\n", "");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "ac-regression").status, "fail");
});

// ── off-ramp + frontmatter ───────────────────────────────────────────────────

test("spike_required: true blocks dispatch", async () => {
  const content = VALID_FEATURE.replace("spike_required: false", "spike_required: true");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "spike-required").status, "fail");
});

test("a missing Definition of Done section blocks", async () => {
  const content = VALID_FEATURE.replace("## Definition of Done", "## Implementation Notes");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "sections-required").status, "fail");
});

test("a missing breaking declaration blocks", async () => {
  const content = VALID_FEATURE.replace("breaking: false\n", "");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "fm-breaking").status, "fail");
});

// ── host-bindings + sibling dependencies (Contract B) ────────────────────────

function tempProject() {
  const dir = mkdtempSync(join(tmpdir(), "marvin-spec-dep-"));
  writeFileSync(join(dir, "CLAUDE.md"), "# host\n");
  mkdirSync(join(dir, "specs"), { recursive: true });
  const sib = (slug, status) =>
    `---\nslug: ${slug}\ntype: feature\nstatus: ${status}\ncreated: 2026-06-14\n---\n# ${slug}\n`;
  writeFileSync(join(dir, "specs", "shipped-sib.md"), sib("shipped-sib", "shipped"));
  writeFileSync(join(dir, "specs", "draft-sib.md"), sib("draft-sib", "draft"));
  return dir;
}

const withDependsOn = (slug) =>
  VALID_FEATURE.replace("criteria:", `depends_on: [${slug}]\ncriteria:`);

test("a spec depending on a shipped sibling passes", async () => {
  const dir = tempProject();
  try {
    const { parsed } = await callSpec({
      specContent: withDependsOn("shipped-sib"),
      projectRoot: dir,
    });
    assert.equal(parsed.verdict, "PASS", JSON.stringify(parsed.checks, null, 2));
    assert.equal(find(parsed, "depends-on").status, "pass");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a spec depending on a draft (unshipped) sibling blocks", async () => {
  const dir = tempProject();
  try {
    const { parsed } = await callSpec({
      specContent: withDependsOn("draft-sib"),
      projectRoot: dir,
    });
    assert.equal(parsed.verdict, "FAIL");
    assert.equal(find(parsed, "depends-on").status, "fail");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a spec depending on a missing sibling blocks", async () => {
  const dir = tempProject();
  try {
    const { parsed } = await callSpec({
      specContent: withDependsOn("ghost-sib"),
      projectRoot: dir,
    });
    assert.equal(parsed.verdict, "FAIL");
    assert.equal(find(parsed, "depends-on").status, "fail");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a host-bindings block is accepted (advisory)", async () => {
  const hb = "```yaml host-bindings\nspec_location: specs/\ngates:\n  test: npm test\n```\n\n";
  const content = VALID_FEATURE.replace("## Data & Config", hb + "## Data & Config");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "PASS", JSON.stringify(parsed.checks, null, 2));
  assert.equal(find(parsed, "host-bindings").status, "pass");
});
