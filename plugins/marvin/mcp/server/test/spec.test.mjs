import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { callTool } from "./_driver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// test → server → mcp → marvin → plugins → repoRoot
const repoRoot = join(here, "..", "..", "..", "..", "..");

/**
 * Drive the live stdio server: initialize, then one tools/call for `spec`,
 * and return the parsed `spec-result` JSON block from the tool output.
 */
async function callSpec(args) {
  const result = await callTool("spec", args);
  const text = result.content.map((c) => c.text).join("\n");
  const m = text.match(/```json spec-result\n([\s\S]*?)\n```/);
  assert.ok(m, `no spec-result block in output:\n${text}`);
  return { parsed: JSON.parse(m[1]), isError: result.isError, text };
}

const find = (parsed, id) => parsed.checks.find((c) => c.id === id);

// A complete, valid feature spec in the ADR-0005 spec-contract block format.
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
    satisfies: [AC2, AC3]
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
      ref: grep -q sample docs/sample-new.md
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
- Assumed the sample doc has no consumers because grep found none; correct now if wrong.

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
- Assumed empty input is the only unguarded case because the callers pass validated data otherwise.

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

// The transpose: `implemented_by` and `satisfies` are one graph stored twice,
// and each one-directional check above passes while the two disagree.
test("a criterion whose implementing file denies it blocks", async () => {
  const content = VALID_FEATURE.replace("satisfies: [AC2, AC3]", "satisfies: [AC2]");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "graph-symmetry").status, "fail");
  assert.match(find(parsed, "graph-symmetry").detail, /AC3→F1/);
  // The one-directional checks still pass: they are what this one covers for.
  assert.equal(find(parsed, "ac-traceability").status, "pass");
  assert.equal(find(parsed, "fcp-traceability"), undefined);
});

test("a file the criteria deny blocks from the other direction", async () => {
  const content = VALID_FEATURE.replace("implemented_by: [F1, F3]", "implemented_by: [F3]");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "graph-symmetry").status, "fail");
  assert.match(find(parsed, "graph-symmetry").detail, /F1→AC2/);
});

// A row that declares no backward index declares nothing to contradict — infra
// rows legitimately carry none, and requiring one would fail specs that are
// entirely consistent.
test("a file row with no satisfies is exempt from the symmetry check", async () => {
  const content = VALID_FEATURE.replace("    satisfies: [AC2, AC3]\n", "");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(find(parsed, "graph-symmetry").status, "pass");
  assert.notEqual(parsed.verdict, "FAIL");
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
  ).replace(
    "      kind: command\n      ref: grep -q sample docs/sample-new.md",
    "      kind: prose-review",
  );
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "ac-verified-real").status, "fail");
});

// ── grounding and oracle runnability ─────────────────────────────────────────

/** VALID_FEATURE with AC2's command oracle replaced by `cmd`. */
const withAc2Oracle = (cmd) =>
  VALID_FEATURE.replace("ref: grep -q sample docs/sample-new.md", `ref: ${JSON.stringify(cmd)}`);

/** VALID_FEATURE with one more line of Context prose. */
const withContext = (line) =>
  VALID_FEATURE.replace("- Sibling specs: none", `- Sibling specs: none\n- ${line}`);

test("a line citation past the end of the file blocks", async () => {
  const { parsed } = await callSpec({
    specContent: withContext("The rule lives at `CLAUDE.md:999999`."),
    projectRoot: repoRoot,
  });
  assert.equal(parsed.verdict, "FAIL");
  const check = find(parsed, "cite-lines");
  assert.equal(check.status, "fail");
  assert.match(check.detail, /CLAUDE\.md:999999 \(\d+ lines\)/);
});

test("a citation written relative to a package resolves through the tracked files", async () => {
  // `tools/spec.ts` is not a path from the root; exactly one tracked file ends with it.
  const past = await callSpec({
    specContent: withContext("See tools/spec.ts:999999 and tools/spec.ts:1-3."),
    projectRoot: repoRoot,
  });
  assert.equal(find(past.parsed, "cite-lines").status, "fail");
  assert.match(find(past.parsed, "cite-lines").detail, /tools\/spec\.ts:999999/);
  assert.doesNotMatch(find(past.parsed, "cite-lines").detail, /tools\/spec\.ts:1-3/);

  const within = await callSpec({
    specContent: withContext("See tools/spec.ts:1-3."),
    projectRoot: repoRoot,
  });
  const check = find(within.parsed, "cite-lines");
  assert.equal(check.status, "pass");
  assert.match(check.detail, /^1 line citation/);
});

test("citations the gate cannot or need not check are skipped, not reported", async () => {
  const content = withContext(
    "Unchecked: `docs/sample-new.md:50` (planned new), `index.ts:40` (ambiguous), " +
      "`other-repo/src/x.ts:9` (resolves to nothing), `.marvin/task/runs/x.md:3`.",
  ).replace("## Chosen Approach\n", "## Chosen Approach\n```\nCLAUDE.md:999999\n```\n");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "PASS", JSON.stringify(parsed.checks, null, 2));
  assert.equal(find(parsed, "cite-lines").status, "pass");
});

test("a test-name filter starting with a dash blocks, only for a test runner", async () => {
  const { parsed } = await callSpec({
    specContent: withAc2Oracle('npx vitest run test/sample.test.mjs -t "--staged refuses"'),
    projectRoot: repoRoot,
  });
  assert.equal(parsed.verdict, "FAIL");
  assert.match(find(parsed, "oracle-filter").detail, /AC2: -t "--staged refuses"/);

  // `-t` followed by a flag is ordinary outside a test runner.
  const docker = await callSpec({
    specContent: withAc2Oracle("docker run -t --rm scripts/image.Dockerfile"),
    projectRoot: repoRoot,
  });
  assert.equal(find(docker.parsed, "oracle-filter"), undefined);
});

test("an oracle naming a file that neither exists nor is planned blocks", async () => {
  const { parsed } = await callSpec({
    specContent: withAc2Oracle("node scripts/does-not-exist.mjs --check"),
    projectRoot: repoRoot,
  });
  assert.equal(parsed.verdict, "FAIL");
  const check = find(parsed, "oracle-paths");
  assert.equal(check.status, "fail");
  assert.match(check.detail, /AC2→scripts\/does-not-exist\.mjs/);

  // A planned file, a file under a `cd` target and an output path all resolve.
  const ok = await callSpec({
    specContent: withAc2Oracle(
      "node --test test/sample.test.mjs && cd plugins/marvin && node mcp/server/bin/widget-preview.mjs > out/report.txt",
    ),
    projectRoot: repoRoot,
  });
  assert.equal(find(ok.parsed, "oracle-paths").status, "pass");
});

test("a workspace-relative oracle path only warns", async () => {
  const { parsed } = await callSpec({
    specContent: withAc2Oracle("npm test -w @marvin-toolkit/server -- test/not-at-root.test.mjs"),
    projectRoot: repoRoot,
  });
  const checks = parsed.checks.filter((c) => c.id === "oracle-paths");
  assert.deepEqual(
    checks.map((c) => c.status),
    ["pass", "warn"],
  );
  assert.notEqual(parsed.verdict, "FAIL");
});

test("a whole-suite oracle warns; a narrowed or bespoke command does not", async () => {
  const { parsed } = await callSpec({
    specContent: withAc2Oracle("npm run build"),
    projectRoot: repoRoot,
  });
  assert.equal(parsed.verdict, "PASS WITH WARNINGS");
  assert.match(find(parsed, "oracle-narrow").detail, /AC2: npm run build/);

  for (const cmd of [
    "npx vitest run plugins/marvin/mcp/server/test",
    "npm test -- -t 'links the sample'",
    "grep -q sample CLAUDE.md",
    "bun run metrics --negative-check",
  ]) {
    const r = await callSpec({ specContent: withAc2Oracle(cmd), projectRoot: repoRoot });
    assert.equal(find(r.parsed, "oracle-narrow"), undefined, cmd);
  }
});

test("a real oracle with no failure line warns", async () => {
  const { parsed } = await callSpec({
    specContent: VALID_FEATURE.replace("    failure: no link\n", ""),
    projectRoot: repoRoot,
  });
  assert.equal(parsed.verdict, "PASS WITH WARNINGS");
  assert.match(find(parsed, "oracle-failure").detail, /AC2/);
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

// ── advisory content checks: assumptions + critic verdict ────────────────────

/** Swap the fixture's substantive Assumptions body for `text`. */
const withAssumptions = (text) =>
  VALID_FEATURE.replace(
    "- Assumed the sample doc has no consumers because grep found none; correct now if wrong.",
    text,
  );

/** Swap the fixture's Critic Verdict & Overrides body for `text`. */
const withCriticVerdict = (text) =>
  VALID_FEATURE.replace(
    "## Critic Verdict & Overrides\nnone",
    `## Critic Verdict & Overrides\n${text}`,
  );

test("an Assumptions section reduced to none warns without blocking", async () => {
  for (const empty of ["none", "n/a", "- none", ""]) {
    const { parsed, isError } = await callSpec({
      specContent: withAssumptions(empty),
      projectRoot: repoRoot,
    });
    assert.equal(find(parsed, "assumptions").status, "warn", `"${empty}" must warn`);
    assert.equal(parsed.verdict, "PASS WITH WARNINGS", JSON.stringify(parsed.checks, null, 2));
    assert.ok(!isError, "an advisory warning is never an error");
  }

  // Absent entirely: the same advisory warning, still never a block.
  const absent = await callSpec({
    specContent: VALID_FEATURE.replace("## Assumptions", "## Assumed Things"),
    projectRoot: repoRoot,
  });
  assert.equal(find(absent.parsed, "assumptions").status, "warn");
  assert.match(find(absent.parsed, "assumptions").detail, /missing/);
  assert.equal(absent.parsed.verdict, "PASS WITH WARNINGS");

  // Substantive assumption text passes the same check.
  const { parsed } = await callSpec({ specContent: VALID_FEATURE, projectRoot: repoRoot });
  assert.equal(find(parsed, "assumptions").status, "pass");
});

test("the critic verdict check accepts terminal verdicts and none and warns otherwise", async () => {
  const accepted = [
    ["PASS", "PASS"],
    ["PASS WITH WARNINGS — critic flagged X; override: ship anyway", "PASS WITH WARNINGS"],
    ["BLOCK — AC2 has no implementing change", "BLOCK"],
    ["UNABLE — could not read the cited files", "UNABLE"],
    ["none — critic skipped", "NONE"],
  ];
  for (const [body, reported] of accepted) {
    const { parsed } = await callSpec({
      specContent: withCriticVerdict(body),
      projectRoot: repoRoot,
    });
    const check = find(parsed, "critic-verdict");
    assert.equal(check.status, "pass", `"${body}" must pass: ${check.detail}`);
    if (reported !== "NONE") assert.match(check.detail, new RegExp(`^${reported} recorded$`));
  }

  // NEEDS_CONTEXT is strictly transient — never a recordable verdict.
  const nc = await callSpec({
    specContent: withCriticVerdict("NEEDS_CONTEXT — could not read the spec content"),
    projectRoot: repoRoot,
  });
  assert.equal(find(nc.parsed, "critic-verdict").status, "warn");
  assert.equal(nc.parsed.verdict, "PASS WITH WARNINGS");
  assert.ok(!nc.isError);
  assert.match(find(nc.parsed, "critic-verdict").detail, /transient/);
  assert.match(find(nc.parsed, "critic-verdict").detail, /never recorded/);

  // An unrecognised token warns with its own detail, quoting what it found.
  const other = await callSpec({
    specContent: withCriticVerdict("Looks fine to me"),
    projectRoot: repoRoot,
  });
  assert.equal(find(other.parsed, "critic-verdict").status, "warn");
  assert.equal(other.parsed.verdict, "PASS WITH WARNINGS");
  assert.match(find(other.parsed, "critic-verdict").detail, /unrecognised verdict/);
  assert.match(find(other.parsed, "critic-verdict").detail, /Looks fine to me/);
});

/**
 * This repository writes the critic line two ways round, and the attribution-first
 * form — `marvin-tm-spec-critic — **PASS WITH WARNINGS**` — is the majority: 17 of
 * the 24 specs under `.marvin/task/` lead with the agent name or with markdown
 * emphasis rather than with the token. A matcher anchored at column 0 warned on all
 * of them, so both forms are pinned here. The negatives are the other half of the
 * property: widening the match must not let prose that merely mentions a verdict
 * word be read as a judgement.
 */
test("the critic verdict check reads the attribution-first house style", async () => {
  const accepted = [
    ["**PASS**", "PASS"],
    [
      "`marvin-tm-spec-critic`: **PASS WITH WARNINGS** (round 1). Six findings, all addressed.",
      "PASS WITH WARNINGS",
    ],
    ["marvin-tm-spec-critic — round 1: **BLOCK** (a phantom config path)", "BLOCK"],
    ["**PASS WITH WARNINGS** on the third `marvin-tm-spec-critic` round.", "PASS WITH WARNINGS"],
    ["- **UNABLE** — could not read the cited files", "UNABLE"],
    // A round-by-round chain is reported by the verdict it opens with: the check
    // confirms a recognisable verdict is present, it does not adjudicate the chain.
    ["`marvin-tm-spec-critic`: **BLOCK (round 1) → PASS WITH WARNINGS (round 2)**.", "BLOCK"],
  ];
  for (const [body, reported] of accepted) {
    const { parsed } = await callSpec({
      specContent: withCriticVerdict(body),
      projectRoot: repoRoot,
    });
    const check = find(parsed, "critic-verdict");
    assert.equal(check.status, "pass", `"${body}" must pass: ${check.detail}`);
    assert.match(check.detail, new RegExp(`^${reported} recorded$`));
  }

  // Prose that only mentions a verdict word is not a verdict.
  for (const prose of [
    "We can pass on this one for now",
    "The reviewer will not block the merge",
    "This bypasses the critic entirely",
  ]) {
    const { parsed } = await callSpec({
      specContent: withCriticVerdict(prose),
      projectRoot: repoRoot,
    });
    const check = find(parsed, "critic-verdict");
    assert.equal(check.status, "warn", `"${prose}" must not read as a verdict: ${check.detail}`);
    assert.match(check.detail, /unrecognised verdict/);
  }
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

test("a depends_on slug resolves a numbered sibling file (NNN-<slug>.md)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-spec-dep-num-"));
  try {
    writeFileSync(join(dir, "CLAUDE.md"), "# host\n");
    mkdirSync(join(dir, "specs"), { recursive: true });
    // The sibling on disk carries the ordering prefix; depends_on names the bare slug.
    writeFileSync(
      join(dir, "specs", "007-shipped-sib.md"),
      `---\nslug: shipped-sib\ntype: feature\nstatus: shipped\ncreated: 2026-06-14\n---\n# shipped-sib\n`,
    );
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

test("a host-bindings block is accepted (advisory)", async () => {
  const hb = "```yaml host-bindings\nspec_location: specs/\ngates:\n  test: npm test\n```\n\n";
  const content = VALID_FEATURE.replace("## Data & Config", hb + "## Data & Config");
  const { parsed } = await callSpec({ specContent: content, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "PASS", JSON.stringify(parsed.checks, null, 2));
  assert.equal(find(parsed, "host-bindings").status, "pass");
});

test("the gate emits a stable contract hash that changes with the block", async () => {
  const a = (await callSpec({ specContent: VALID_FEATURE, projectRoot: repoRoot })).parsed;
  assert.ok(a.contractSha, "contractSha present on a valid spec");
  const b = (await callSpec({ specContent: VALID_FEATURE, projectRoot: repoRoot })).parsed;
  assert.equal(a.contractSha, b.contractSha, "stable for an identical block");
  // Editing the block changes the hash; editing prose outside the block does not.
  const editedBlock = VALID_FEATURE.replace("intent: document the sample", "intent: changed here");
  const c = (await callSpec({ specContent: editedBlock, projectRoot: repoRoot })).parsed;
  assert.notEqual(a.contractSha, c.contractSha, "changes when the block changes");
  const editedProse = VALID_FEATURE.replace(
    "Write a sample doc and reference it.",
    "Different prose.",
  );
  const d = (await callSpec({ specContent: editedProse, projectRoot: repoRoot })).parsed;
  assert.equal(a.contractSha, d.contractSha, "stable when only prose outside the block changes");
});

// ── contract-seal verification (mode: "seal") — the tamper gate, ADR-0010 ──

test("seal: an intact spec passes (stamped hash matches the block)", async () => {
  const sha = (await callSpec({ specContent: VALID_FEATURE, projectRoot: repoRoot })).parsed
    .contractSha;
  assert.ok(sha, "DoR mode emits the contract hash to stamp");
  const sealed = VALID_FEATURE.replace("status: ready\n", `status: ready\ncontract_sha: ${sha}\n`);
  const { parsed, isError } = await callSpec({
    specContent: sealed,
    mode: "seal",
    projectRoot: repoRoot,
  });
  assert.equal(parsed.verdict, "PASS", JSON.stringify(parsed.checks, null, 2));
  assert.equal(find(parsed, "seal").status, "pass");
  assert.ok(!isError);
});

test("seal: a block edited after sealing is reported TAMPERED (FAIL)", async () => {
  const sha = (await callSpec({ specContent: VALID_FEATURE, projectRoot: repoRoot })).parsed
    .contractSha;
  const sealed = VALID_FEATURE.replace("status: ready\n", `status: ready\ncontract_sha: ${sha}\n`);
  // Edit inside the spec-contract block after the seal was stamped.
  const tampered = sealed.replace("intent: document the sample", "intent: tampered after sealing");
  const { parsed, isError } = await callSpec({
    specContent: tampered,
    mode: "seal",
    projectRoot: repoRoot,
  });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(isError, true, "a tampered seal is flagged as an error");
  assert.equal(find(parsed, "seal").status, "fail");
  assert.match(find(parsed, "seal").detail, /TAMPERED/);
});

test("seal: an unsealed spec (no contract_sha) warns, does not fail", async () => {
  const { parsed } = await callSpec({
    specContent: VALID_FEATURE,
    mode: "seal",
    projectRoot: repoRoot,
  });
  assert.equal(parsed.verdict, "PASS WITH WARNINGS");
  assert.equal(find(parsed, "seal").status, "warn");
});

test("seal: a spec with no contract block fails the seal check", async () => {
  const noBlock = VALID_FEATURE.replace("yaml spec-contract", "yaml");
  const { parsed } = await callSpec({ specContent: noBlock, mode: "seal", projectRoot: repoRoot });
  assert.equal(parsed.verdict, "FAIL");
  assert.equal(find(parsed, "seal").status, "fail");
});

// ── scope-allowlist gate (mode: "scope") — git diff ⊆ contract.files, ADR-0011 ──

const SCOPE_SPEC = `---
slug: scope-test
type: feature
status: ready
created: 2026-06-14
---

# Scope test

\`\`\`yaml spec-contract
files:
  - id: F1
    path: src/a.ts
    action: edit
criteria:
  - id: AC1
    statement: only src/a.ts may change
    implemented_by: [F1]
    oracle:
      kind: prose-review
\`\`\`
`;

function gitScopeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "marvin-scope-"));
  const g = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "Test");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
  g("add", "-A");
  g("commit", "-qm", "base");
  return dir;
}

test("scope: a diff within the contract allowlist passes", async () => {
  const dir = gitScopeRepo();
  try {
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 2;\n"); // edit an allowed file
    const { parsed } = await callSpec({ specContent: SCOPE_SPEC, mode: "scope", projectRoot: dir });
    assert.equal(parsed.verdict, "PASS", JSON.stringify(parsed.checks, null, 2));
    assert.equal(find(parsed, "scope").status, "pass");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scope: a changed file outside the allowlist fails (scope creep)", async () => {
  const dir = gitScopeRepo();
  try {
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 2;\n");
    writeFileSync(join(dir, "src", "b.ts"), "export const b = 1;\n"); // not in the allowlist
    const { parsed, isError } = await callSpec({
      specContent: SCOPE_SPEC,
      mode: "scope",
      projectRoot: dir,
    });
    assert.equal(parsed.verdict, "FAIL");
    assert.equal(isError, true);
    assert.equal(find(parsed, "scope").status, "fail");
    assert.match(find(parsed, "scope").detail, /src\/b\.ts/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scope: an out-of-scope file declared in `allow` passes (recorded SPEC GAP)", async () => {
  const dir = gitScopeRepo();
  try {
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 2;\n");
    writeFileSync(join(dir, "src", "b.ts"), "export const b = 1;\n");
    const { parsed } = await callSpec({
      specContent: SCOPE_SPEC,
      mode: "scope",
      projectRoot: dir,
      allow: ["src/b.ts"],
    });
    assert.equal(parsed.verdict, "PASS", JSON.stringify(parsed.checks, null, 2));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The scope gate's answer is only meaningful if its inputs were understood.
// `changedFiles` is the argument callers reach for by analogy — but the changed
// set is always derived from git, so a non-strict schema dropped the key and
// returned a confident PASS/FAIL over a file set the tool never saw. Two runs
// with deliberately different lists produced byte-identical violations. The
// input is strict so that an undeclared argument is an error, not a wrong
// answer that looks right.
test("an undeclared argument is rejected, not silently ignored", async () => {
  const dir = gitScopeRepo();
  try {
    writeFileSync(join(dir, "src", "b.ts"), "export const b = 1;\n");
    await assert.rejects(
      () =>
        callSpec({
          specContent: SCOPE_SPEC,
          mode: "scope",
          projectRoot: dir,
          changedFiles: ["nowhere-near-the-real-diff.ts"],
        }),
      (err) => {
        const msg = String(err.message);
        assert.match(msg, /changedFiles/, "the error must name the rejected argument");
        // and it must tell the caller what IS accepted
        assert.match(msg, /specPath/);
        assert.match(msg, /allow/);
        assert.match(msg, /base/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every declared argument is still accepted (strictness rejects only unknowns)", async () => {
  const dir = gitScopeRepo();
  try {
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 2;\n");
    writeFileSync(join(dir, "src", "b.ts"), "export const b = 1;\n");
    const { parsed } = await callSpec({
      specContent: SCOPE_SPEC,
      mode: "scope",
      projectRoot: dir,
      allow: ["src/b.ts"],
      base: "HEAD",
    });
    assert.equal(parsed.verdict, "PASS", JSON.stringify(parsed.checks, null, 2));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scope: marvin's own .marvin/ artifacts are never scope violations", async () => {
  const dir = gitScopeRepo();
  try {
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 2;\n");
    mkdirSync(join(dir, ".marvin", "task"), { recursive: true });
    writeFileSync(join(dir, ".marvin", "task", "verification.md"), "# Verification\n");
    const { parsed } = await callSpec({ specContent: SCOPE_SPEC, mode: "scope", projectRoot: dir });
    assert.equal(parsed.verdict, "PASS", JSON.stringify(parsed.checks, null, 2));
    assert.doesNotMatch(find(parsed, "scope").detail, /verification/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── scope.exempt: by-product files the gate does not count (ADR-0045) ──────
//
// The two texts below were captured from the committed server BEFORE
// exemptions existed, on the scenario `noConfigScenario` rebuilds. Without a
// `scope.exempt` key the gate must still produce them byte for byte — the
// no-config path is not allowed to move at all.
const SCOPE_BASELINE_PASS =
  '# Spec Readiness Report\n\n**Type:** feature\n**Verdict:** PASS\n\n## Checks\n- ✅ **Scope** — all 1 in-scope changed file(s) are within the contract allowlist\n\n```json spec-result\n{"verdict":"PASS","type":"feature","contractSha":null,"checks":[{"id":"scope","status":"pass","detail":"all 1 in-scope changed file(s) are within the contract allowlist"}]}\n```';
const SCOPE_BASELINE_FAIL =
  '# Spec Readiness Report\n\n**Type:** feature\n**Verdict:** FAIL\n\n## Checks\n- ❌ **Scope** — 1 changed file(s) outside the contract allowlist (scope creep): .claude/agent-memory/critic/MEMORY.md. Either add them to the spec\'s files list (amend the spec, then re-seal), or — if intentional — re-run with allow: [...] as a recorded SPEC GAP.\n\n## Definition of Ready: BLOCKED\n\nResolve the ❌ checks above, then re-run the gate. Do not write the spec until this passes.\n\n```json spec-result\n{"verdict":"FAIL","type":"feature","contractSha":null,"checks":[{"id":"scope","status":"fail","detail":"1 changed file(s) outside the contract allowlist (scope creep): .claude/agent-memory/critic/MEMORY.md. Either add them to the spec\'s files list (amend the spec, then re-seal), or — if intentional — re-run with allow: [...] as a recorded SPEC GAP."}]}\n```';

const AGENT_MEMORY = join(".claude", "agent-memory", "critic", "MEMORY.md");

function writeScopeConfig(dir, config) {
  mkdirSync(join(dir, ".marvin"), { recursive: true });
  writeFileSync(
    join(dir, ".marvin", "config.json"),
    typeof config === "string" ? config : JSON.stringify(config),
  );
}

function writeAgentMemory(dir) {
  mkdirSync(join(dir, ".claude", "agent-memory", "critic"), { recursive: true });
  writeFileSync(join(dir, AGENT_MEMORY), "# notes\n");
}

test("scope: with no config the answer is byte-identical to the gate before exemptions", async () => {
  const dir = gitScopeRepo();
  try {
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 2;\n");
    const clean = await callSpec({ specContent: SCOPE_SPEC, action: "scope", projectRoot: dir });
    assert.equal(clean.text, SCOPE_BASELINE_PASS);

    // An agent-memory by-product with nothing configured is the scope creep it always was.
    writeAgentMemory(dir);
    const creep = await callSpec({ specContent: SCOPE_SPEC, action: "scope", projectRoot: dir });
    assert.equal(creep.text, SCOPE_BASELINE_FAIL);
    assert.equal(creep.isError, true);

    // A config file that sets other keys but no `scope` changes nothing either.
    writeScopeConfig(dir, { base_branch: "main", spec: { dir: "specs" } });
    const other = await callSpec({ specContent: SCOPE_SPEC, action: "scope", projectRoot: dir });
    assert.equal(other.text, SCOPE_BASELINE_FAIL);

    // Nor does an exemption list that matches nothing in this change set.
    writeScopeConfig(dir, { scope: { exempt: ["bun.lock"] } });
    rmSync(join(dir, ".claude"), { recursive: true, force: true });
    const unmatched = await callSpec({
      specContent: SCOPE_SPEC,
      action: "scope",
      projectRoot: dir,
    });
    assert.equal(unmatched.text, SCOPE_BASELINE_PASS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scope: a changed file matching scope.exempt passes, and the answer names it and its pattern", async () => {
  const dir = gitScopeRepo();
  try {
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 2;\n");
    writeAgentMemory(dir);
    writeFileSync(join(dir, "bun.lock"), "lock\n");
    writeScopeConfig(dir, {
      scope: { exempt: [".claude/agent-memory/**", "**/*.d.mts", "bun.lock"] },
    });
    const { parsed, isError, text } = await callSpec({
      specContent: SCOPE_SPEC,
      action: "scope",
      projectRoot: dir,
    });
    assert.equal(parsed.verdict, "PASS", JSON.stringify(parsed.checks, null, 2));
    assert.equal(isError, false);
    const detail = find(parsed, "scope").detail;
    assert.equal(
      detail,
      "all 1 in-scope changed file(s) are within the contract allowlist; 2 by-product file(s) exempted by scope.exempt — " +
        "`.claude/agent-memory/**` (1): .claude/agent-memory/critic/MEMORY.md; `bun.lock` (1): bun.lock",
    );
    assert.match(
      text,
      /exempted by scope\.exempt/,
      "the exemption is in the human-readable text too",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scope: a file matching no scope.exempt pattern still fails, and the exemptions are still named", async () => {
  const dir = gitScopeRepo();
  try {
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 2;\n");
    writeAgentMemory(dir);
    writeFileSync(join(dir, "src", "b.ts"), "export const b = 1;\n"); // real scope creep
    writeScopeConfig(dir, { scope: { exempt: [".claude/agent-memory/**"] } });
    const { parsed, isError } = await callSpec({
      specContent: SCOPE_SPEC,
      action: "scope",
      projectRoot: dir,
    });
    assert.equal(parsed.verdict, "FAIL");
    assert.equal(isError, true);
    const detail = find(parsed, "scope").detail;
    assert.match(
      detail,
      /^1 changed file\(s\) outside the contract allowlist \(scope creep\): src\/b\.ts\./,
    );
    assert.doesNotMatch(detail.split(";")[0], /agent-memory/, "the exempt file is not a violation");
    assert.match(
      detail,
      /1 by-product file\(s\) exempted by scope\.exempt — `\.claude\/agent-memory\/\*\*` \(1\)/,
    );

    // `allow` still works beside an exemption: the SPEC GAP path is unchanged.
    const allowed = await callSpec({
      specContent: SCOPE_SPEC,
      action: "scope",
      projectRoot: dir,
      allow: ["src/b.ts"],
    });
    assert.equal(allowed.parsed.verdict, "PASS", JSON.stringify(allowed.parsed.checks, null, 2));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scope: an unusable scope.exempt pattern exempts nothing and is named as a warning", async () => {
  const dir = gitScopeRepo();
  try {
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 2;\n");
    writeFileSync(join(dir, "bun.lock"), "lock\n");
    writeScopeConfig(dir, { scope: { exempt: ["/bun.lock", "**"] } });
    const { parsed } = await callSpec({
      specContent: SCOPE_SPEC,
      action: "scope",
      projectRoot: dir,
    });
    assert.equal(parsed.verdict, "FAIL", "bun.lock is still outside the allowlist");
    assert.match(find(parsed, "scope").detail, /bun\.lock/);
    const w = find(parsed, "scope-exempt");
    assert.equal(w.status, "warn");
    assert.match(w.detail, /2 scope\.exempt pattern\(s\) ignored/);
    assert.match(w.detail, /"\/bun\.lock" \(it starts with `\/`/);
    assert.match(w.detail, /"\*\*" \(it is only wildcards/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scope: a config file that cannot be applied is a warning, not a silent loss of exemptions", async () => {
  const dir = gitScopeRepo();
  try {
    writeFileSync(join(dir, "src", "a.ts"), "export const a = 2;\n");
    writeScopeConfig(dir, "{ not json");
    const { parsed } = await callSpec({
      specContent: SCOPE_SPEC,
      action: "scope",
      projectRoot: dir,
    });
    assert.equal(parsed.verdict, "PASS WITH WARNINGS", JSON.stringify(parsed.checks, null, 2));
    assert.equal(find(parsed, "scope").status, "pass");
    const w = find(parsed, "scope-config");
    assert.equal(w.status, "warn");
    assert.match(w.detail, /not valid JSON/);
    assert.match(w.detail, /no scope\.exempt pattern is in force/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the action vocabulary and the corpus reads (ADR-0037) ──────────────────
//
// `callSpec` above cannot carry these: it asserts a ```json spec-result``` block
// is present, which is exactly what a corpus read must NOT emit. These two
// helpers drive the same `callTool` and read the other block, so no existing
// mode test changes meaning.

/** Drive `spec` and return the raw result plus its text, asserting nothing. */
async function callSpecRaw(args) {
  const result = await callTool("spec", args);
  return { result, isError: result.isError, text: result.content.map((c) => c.text).join("\n") };
}

/** The ```json spec-corpus``` payload of a `next` / `list` answer. */
async function callSpecCorpus(args) {
  const { text, isError } = await callSpecRaw(args);
  const m = text.match(/```json spec-corpus\n([\s\S]*?)\n```/);
  assert.ok(m, `no spec-corpus block in output:\n${text}`);
  return { payload: JSON.parse(m[1]), isError, text };
}

/** An empty temp project root, cleaned up by the caller. */
function tempRoot() {
  return mkdtempSync(join(tmpdir(), "marvin-spec-corpus-"));
}

test("a call with neither action nor mode still runs the DoR gate", async () => {
  // The regression the `.default("dor")` removal must not cause: every shipped
  // caller passes no mode at all, and `.optional()` — not deletion — is what
  // keeps them working.
  const { parsed } = await callSpec({ specContent: VALID_FEATURE, projectRoot: repoRoot });
  assert.equal(parsed.verdict, "PASS");
  assert.ok(parsed.checks.length > 1, "the full gate ran, not a single-check path");
});

test("action supersedes mode and a conflicting pair is rejected", async () => {
  const viaMode = await callSpec({
    specContent: VALID_FEATURE,
    mode: "seal",
    projectRoot: repoRoot,
  });
  const viaAction = await callSpec({
    specContent: VALID_FEATURE,
    action: "seal",
    projectRoot: repoRoot,
  });
  assert.equal(viaAction.parsed.verdict, viaMode.parsed.verdict, "the synonym is exact");
  assert.deepEqual(
    viaAction.parsed.checks.map((c) => [c.id, c.status]),
    viaMode.parsed.checks.map((c) => [c.id, c.status]),
  );

  // An equal pair is not a conflict; a disagreeing pair is refused rather than
  // answered for either key.
  const agreeing = await callSpec({
    specContent: VALID_FEATURE,
    action: "seal",
    mode: "seal",
    projectRoot: repoRoot,
  });
  assert.equal(agreeing.parsed.verdict, viaMode.parsed.verdict);

  const { text, isError } = await callSpecRaw({
    specContent: VALID_FEATURE,
    action: "next",
    mode: "seal",
    projectRoot: repoRoot,
  });
  assert.equal(isError, true);
  assert.match(text, /action/, "the refusal names both keys");
  assert.match(text, /mode/);
  assert.doesNotMatch(text, /```json spec-(result|corpus)/, "and answers for neither");
});

test("next and list render without a verdict", async () => {
  const root = tempRoot();
  try {
    // An absent spec directory is an ANSWER, not a failure.
    const empty = await callSpecCorpus({ action: "next", projectRoot: root });
    assert.equal(empty.isError ?? false, false, "a zero-state corpus is not an error");
    assert.equal(empty.payload.next.number, 1);
    assert.equal(empty.payload.next.id, "001");
    assert.equal(empty.payload.dir.source, "default");
    assert.doesNotMatch(empty.text, /```json spec-result/, "no verdict block for a corpus read");
    assert.doesNotMatch(empty.text, /Verdict:/);

    const specs = join(root, ".marvin", "task");
    mkdirSync(specs, { recursive: true });
    const file = (slug, title) =>
      `---\nslug: ${slug}\ntype: feature\nstatus: ready\n---\n\n# ${title}\n`;
    writeFileSync(join(specs, "002-second.md"), file("second", "The second spec"));
    writeFileSync(join(specs, "010-tenth.md"), file("tenth", "The tenth spec"));

    const next = await callSpecCorpus({ action: "next", projectRoot: root, slug: "eleventh" });
    assert.equal(next.payload.next.number, 11);
    assert.equal(next.payload.next.filename, "011-eleventh.md");
    assert.equal(next.payload.next.collision, null);
    assert.equal(next.payload.dir.source, "detected");

    const collided = await callSpecCorpus({ action: "next", projectRoot: root, slug: "second" });
    assert.equal(collided.payload.next.collision.filename, "002-second.md");
    assert.match(collided.text, /supersedes/, "the collision asks the judgement question");

    const listed = await callSpecCorpus({ action: "list", projectRoot: root });
    assert.deepEqual(
      listed.payload.specs.map((s) => s.slug),
      ["tenth", "second"],
      "highest number first",
    );
    assert.equal(listed.payload.specs[0].title, "The tenth spec");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("next refuses a slug it would otherwise have to sanitise", async () => {
  const root = tempRoot();
  try {
    const { text, isError } = await callSpecRaw({
      action: "next",
      projectRoot: root,
      slug: "../escape",
    });
    assert.equal(isError, true);
    assert.match(text, /kebab-case/);
    assert.doesNotMatch(text, /```json spec-corpus/, "nothing was allocated");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("seal refuses a terminal status and is explicit about an absent one", async () => {
  const sha = (await callSpec({ specContent: VALID_FEATURE, projectRoot: repoRoot })).parsed
    .contractSha;
  const withStatus = (status) =>
    VALID_FEATURE.replace("status: ready\n", `status: ${status}\ncontract_sha: ${sha}\n`);

  for (const status of ["shipped", "superseded"]) {
    const { parsed, isError } = await callSpec({
      specContent: withStatus(status),
      action: "seal",
      projectRoot: repoRoot,
    });
    assert.equal(parsed.verdict, "FAIL", `a ${status} spec must not be executed again`);
    assert.equal(isError, true);
    const check = find(parsed, "status");
    assert.equal(check.status, "fail");
    assert.match(check.detail, new RegExp(status), "the refusal names the status");
  }

  // The states that still execute.
  for (const status of ["ready", "in-progress"]) {
    const { parsed } = await callSpec({
      specContent: withStatus(status),
      action: "seal",
      projectRoot: repoRoot,
    });
    assert.equal(parsed.verdict, "PASS", `${status} is not terminal`);
  }

  // Frontmatter with no status at all — seal is legitimately called on an inline
  // fragment, and a silent pass would report a check that never happened.
  const { parsed } = await callSpec({
    specContent: VALID_FEATURE.replace("status: ready\n", `contract_sha: ${sha}\n`),
    action: "seal",
    projectRoot: repoRoot,
  });
  assert.equal(parsed.verdict, "PASS WITH WARNINGS");
  const check = find(parsed, "status");
  assert.equal(check.status, "warn");
  assert.match(check.detail, /did not run/);

  // A status outside the vocabulary warns and echoes the value rather than
  // blocking a repository that uses its own lifecycle words.
  const exotic = await callSpec({
    specContent: withStatus("in-review"),
    action: "seal",
    projectRoot: repoRoot,
  });
  assert.equal(exotic.parsed.verdict, "PASS WITH WARNINGS");
  assert.match(find(exotic.parsed, "status").detail, /in-review/);
});

test("the spec.dir tier is read from the targeted project root", async () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, ".marvin"), { recursive: true });
    writeFileSync(
      join(root, ".marvin", "config.json"),
      JSON.stringify({ spec: { dir: "docs/rfcs" } }),
    );
    mkdirSync(join(root, "docs", "rfcs"), { recursive: true });
    writeFileSync(
      join(root, "docs", "rfcs", "0007-existing.md"),
      "---\nslug: existing\ntype: feature\nstatus: ready\n---\n\n# An existing RFC\n",
    );

    const { payload } = await callSpecCorpus({
      action: "next",
      projectRoot: root,
      slug: "new-one",
    });
    assert.deepEqual(payload.dir, { rel: "docs/rfcs", source: "config" });
    assert.equal(payload.next.width, 4, "the corpus's own width, not a hard-coded 3");
    assert.equal(payload.next.filename, "0008-new-one.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── the progress journal and the resume fork (spec resumability) ───────────
//
// These drive the COMMITTED bundle over stdio, so they mean nothing against a
// stale `dist/server.js` — which is exactly why the rebuilt bundle is part of
// the change rather than a step someone remembers.

/** The ```json spec-progress``` payload of a `progress` / `resume` answer. */
async function callSpecProgress(args) {
  const { text, isError, result } = await callSpecRaw(args);
  const m = text.match(/```json spec-progress\n([\s\S]*?)\n```/);
  assert.ok(m, `no spec-progress block in output:\n${text}`);
  return { payload: JSON.parse(m[1]), isError, text, result };
}

/** A temp project holding one spec, and the path to it. */
function specRoot(slug = "demo", filename = "030-demo.md") {
  const root = tempRoot();
  const specs = join(root, ".marvin", "task");
  mkdirSync(specs, { recursive: true });
  const path = join(specs, filename);
  writeFileSync(path, `---\nslug: ${slug}\ntype: feature\nstatus: draft\n---\n\n# A draft\n`);
  return { root, specs, path };
}

test("progress appends and resume reads it back over stdio", async () => {
  const { root, specs, path } = specRoot();
  try {
    const appended = await callSpecProgress({
      action: "progress",
      projectRoot: root,
      specPath: path,
      slug: "demo",
      source: "task-start",
      step: "1.5",
      kind: "step",
      detail: "allocated the draft",
      draftPath: ".marvin/task/030-demo.md",
    });
    assert.equal(appended.isError ?? false, false);
    assert.equal(appended.payload.entry.step, "1.5");

    // The entry survives the process boundary — a fresh session reads it back.
    const resumed = await callSpecProgress({
      action: "resume",
      projectRoot: root,
      specPath: path,
      slug: "demo",
    });
    assert.equal(resumed.payload.found, true);
    assert.equal(resumed.payload.entries.length, 1);
    assert.equal(resumed.payload.entries[0].detail, "allocated the draft");
    assert.equal(resumed.payload.path, ".marvin/task/030-demo.md");

    // The journal is a SIBLING under runs/, never at the spec directory's top
    // level — where the slugless-summary resolver, the in-flight digest and the
    // report scanner would each read it as a spec.
    assert.equal(resumed.payload.journal, join(".marvin", "task", "runs", "demo.progress.md"));
    assert.ok(existsSync(join(specs, "runs", "demo.progress.md")));
    assert.deepEqual(
      readdirSync(specs).sort(),
      ["030-demo.md", "runs"],
      "nothing new at the spec directory's top level",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resume on a spec with no journal is a loud non-error", async () => {
  const { root, path } = specRoot();
  try {
    const { payload, isError, text, result } = await callSpecProgress({
      action: "resume",
      projectRoot: root,
      specPath: path,
      slug: "demo",
    });
    assert.notEqual(isError, true, "an empty journal is an answer, not a failure");
    assert.notEqual(result.isError, true);
    assert.equal(payload.found, false);
    assert.deepEqual(payload.entries, []);
    assert.deepEqual(payload.criteria_done, []);

    // The degradation rule is stated in WORDS at the surface a human reads, not
    // only in the payload. The exact fragment is asserted rather than a
    // paraphrase: this sentence is the feature's headline safety property, and a
    // bare "no progress recorded" is read as "nothing was implemented".
    assert.match(text, /is never evidence that nothing was done/);
    assert.match(text, /verify every criterion from scratch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a slug that is not kebab-case is refused and writes nothing", async () => {
  const { root, specs, path } = specRoot();
  try {
    const { text, isError } = await callSpecRaw({
      action: "progress",
      projectRoot: root,
      specPath: path,
      slug: "../escape",
      source: "task-start",
      step: "1.5",
      kind: "step",
      detail: "should never be written",
    });
    assert.equal(isError, true);
    assert.match(text, /\.\.\/escape/, "the refusal names the slug");
    assert.match(text, /kebab-case/);
    assert.doesNotMatch(text, /```json spec-progress/, "and answers with no journal");

    // Refusing while still writing is the failure this guards: the runs/
    // directory must not exist at all, and nothing may have escaped it.
    assert.equal(existsSync(join(specs, "runs")), false, "no runs directory was created");
    assert.deepEqual(readdirSync(specs), ["030-demo.md"]);
    assert.equal(existsSync(join(root, ".marvin", "escape.progress.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every declared progress argument is accepted in one call", async () => {
  // The sibling of the scope-side strictness case: PR #186 made this input
  // schema strict, so each new field is unproved until one call passes them all
  // together and is not rejected as unknown.
  const { root, path } = specRoot();
  try {
    const { payload, isError } = await callSpecProgress({
      action: "progress",
      projectRoot: root,
      specPath: path,
      slug: "demo",
      source: "task-implement",
      step: "5F",
      kind: "criterion",
      detail: "AC4 implemented and covered",
      criterion: "AC4",
      draftPath: ".marvin/task/030-demo.md",
      contractSha: "1b0d247e9e203673",
    });
    assert.equal(isError ?? false, false);
    assert.equal(payload.entry.criterion, "AC4");
    assert.equal(payload.entry.contract_sha, "1b0d247e9e203673");

    const resumed = await callSpecProgress({
      action: "resume",
      projectRoot: root,
      specPath: path,
      slug: "demo",
    });
    assert.deepEqual(resumed.payload.criteria_done, ["AC4"]);
    assert.equal(resumed.payload.contract_sha, "1b0d247e9e203673");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the journal follows the caller's spec path, not the resolver's answer", async () => {
  // The caller-first rule: at task-start step 1.5 the directory is a user choice
  // among the host conventions, and a journal written beside a draft in a
  // different tree is a journal nobody finds.
  const root = tempRoot();
  try {
    mkdirSync(join(root, ".marvin", "task"), { recursive: true }); // what the resolver would pick
    const rfcs = join(root, "docs", "rfcs");
    mkdirSync(rfcs, { recursive: true });
    const path = join(rfcs, "0007-elsewhere.md");
    writeFileSync(path, "---\nslug: elsewhere\ntype: feature\nstatus: draft\n---\n\n# Elsewhere\n");

    const { payload } = await callSpecProgress({
      action: "progress",
      projectRoot: root,
      specPath: path,
      slug: "elsewhere",
      source: "task-start",
      step: "1.5",
      kind: "step",
      detail: "draft opened in the host's own convention",
    });
    assert.equal(payload.journal, join("docs", "rfcs", "runs", "elsewhere.progress.md"));
    assert.equal(existsSync(join(rfcs, "runs", "elsewhere.progress.md")), true);
    assert.equal(existsSync(join(root, ".marvin", "task", "runs")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("progress refuses an entry that cannot say what happened", async () => {
  const { root, specs, path } = specRoot();
  try {
    const { text, isError } = await callSpecRaw({
      action: "progress",
      projectRoot: root,
      specPath: path,
      slug: "demo",
      source: "task-start",
    });
    assert.equal(isError, true);
    assert.match(text, /step/);
    assert.match(text, /kind/);
    assert.match(text, /detail/);
    assert.equal(existsSync(join(specs, "runs")), false, "a refused entry writes nothing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
