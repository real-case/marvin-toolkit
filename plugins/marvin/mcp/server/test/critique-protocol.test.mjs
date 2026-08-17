import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callTool } from "./_driver.mjs";
import { importTs } from "./_tsload.mjs";

/**
 * The critic protocol as a machine-checked artifact (ADR-0039).
 *
 * Two halves. The first reads the two agent bodies and the four pipeline call
 * sites as prose — the pattern `spec-templates.test.mjs` established for a
 * server test reaching plugin files by relative path — and asserts that the
 * receipt protocol they describe is the one the shipped parser accepts. The
 * shipped `critic-verdict` examples are validated with `parseCritiqueBlock`
 * itself, so an example that does not parse is a red test rather than a receipt
 * every copy of which is invalid.
 *
 * **The call-site ordering check is a line-ordering PROXY, and is stated as
 * one.** In `task-implement` the diff critic runs `run_in_background`, so a
 * receipt written at dispatch records a verdict that does not exist yet. This
 * file cannot execute the skill; it asserts instead that the first
 * `.marvin/critique/` instruction appears below both the dispatch line and the
 * merge-point line. That is weaker than proving the ordering and it catches the
 * one error that produces a receipt recording nothing.
 *
 * The second half is behavioural: the delivery gate must not move when a
 * BLOCK receipt is present. **The fixture is chosen so the gate would otherwise
 * ALLOW** — a bare tmpdir short-circuits on the missing artifact and returns the
 * same BLOCK either way, which would "prove" the no-veto property without ever
 * reaching code that could violate it. Asserting `decision === "ALLOW"` beside
 * the byte-identity is what keeps the byte-identity honest.
 */

const here = dirname(fileURLToPath(import.meta.url));
// test → server → mcp → marvin
const PLUGIN = join(here, "..", "..", "..");
const AGENTS = join(PLUGIN, "agents");
const SKILLS = join(PLUGIN, "skills");

const { parseCritiqueBlock } = await importTs("src/lib/reports.ts");

const readText = (path) => readFileSync(path, "utf8");

test("both critics ship a schema-valid receipt example and keep the Phase 1 vocabulary", () => {
  const critics = [
    { file: join(AGENTS, "marvin-tm-diff-critic.md"), name: "marvin-tm-diff-critic" },
    { file: join(AGENTS, "marvin-tm-spec-critic.md"), name: "marvin-tm-spec-critic" },
  ];

  for (const { file, name } of critics) {
    const body = readText(file);

    // The example is validated by the SHIPPED parser: an example that does not
    // parse makes every receipt written by copying it invalid.
    const parse = parseCritiqueBlock(body);
    assert.equal(parse.kind, "ok", `${name}: critic-verdict example does not parse`);
    // Named for its own file, so the two examples cannot be copy-pasted without
    // being corrected.
    assert.equal(parse.critique.critic, name, `${name}: the example names the wrong critic`);
    assert.equal(typeof parse.critique.subject, "string");

    // Both axes are present and stated in the template, not only in the block.
    assert.match(body, /^\*\*Compliance:\*\* /m, `${name}: no Compliance axis line`);
    assert.match(body, /^\*\*Quality:\*\* /m, `${name}: no Quality axis line`);

    // Phase 1's carrier and vocabulary, which this package must not drop: four
    // call sites read the single Verdict line, and the five-value vocabulary is
    // what they route on.
    assert.match(body, /^\*\*Verdict:\*\* /m, `${name}: the Verdict roll-up line is gone`);
    assert.ok(body.includes("NEEDS_CONTEXT"), `${name}: NEEDS_CONTEXT dropped`);
    assert.ok(body.includes("UNABLE"), `${name}: UNABLE dropped`);

    // The roll-up ordering is stated where the critic can act on it. Newlines
    // are collapsed first: the prose is hard-wrapped, so the phrase legitimately
    // straddles a line break.
    assert.ok(
      body.replace(/\s+/g, " ").includes("`BLOCK` > `UNABLE` > `PASS WITH WARNINGS` > `PASS`"),
      `${name}: the roll-up ordering is not stated`,
    );
  }

  // The sentence this whole package is built around.
  const specCritic = readText(join(AGENTS, "marvin-tm-spec-critic.md"));
  assert.ok(specCritic.includes("not a veto"), "the spec critic's no-veto statement is gone");
});

test("the four call sites write the receipt, and task-implement writes it after the join", () => {
  const taskStart = readText(join(SKILLS, "task-start", "SKILL.md"));
  const taskImplement = readText(join(SKILLS, "task-implement", "SKILL.md"));
  const taskDeliver = readText(join(SKILLS, "task-deliver", "SKILL.md"));

  // Each of the four call sites instructs a write. Split each skill at its
  // second critic step so the two halves are asserted independently — one
  // mention in Step 8F must not satisfy Step 8B.
  const splitAt = (text, marker, label) => {
    const at = text.indexOf(marker);
    assert.ok(at > 0, `${label}: could not find ${marker}`);
    return [text.slice(0, at), text.slice(at)];
  };

  const [start8F, start8B] = splitAt(taskStart, "### Step 8B", "task-start");
  assert.ok(start8F.includes(".marvin/critique/"), "task-start 8F does not write a receipt");
  assert.ok(start8B.includes(".marvin/critique/"), "task-start 8B does not write a receipt");

  const [impl6F, impl9B] = splitAt(taskImplement, "### Step 9B", "task-implement");
  assert.ok(impl6F.includes(".marvin/critique/"), "task-implement 6F does not write a receipt");
  assert.ok(impl9B.includes(".marvin/critique/"), "task-implement 9B does not write a receipt");

  // task-deliver names the receipt on BOTH critic lines — the PR body template
  // and the rendering rule above it.
  const deliverLines = taskDeliver
    .split("\n")
    .filter((l) => l.includes("**Spec critic:**") || l.includes("**Diff critic:**"));
  assert.equal(deliverLines.length, 2, "expected exactly the two PR-template critic lines");
  for (const line of deliverLines) {
    assert.ok(line.includes(".marvin/critique/"), `receipt missing from: ${line}`);
  }

  // The ordering proxy (see the file header): the first receipt instruction in
  // task-implement sits below the background dispatch AND below the merge point.
  const dispatch = taskImplement.indexOf("run_in_background");
  const mergePoint = taskImplement.indexOf("**Merge point.**");
  const firstReceipt = taskImplement.indexOf(".marvin/critique/");
  assert.ok(dispatch > 0 && mergePoint > 0, "the 6F dispatch/merge-point anchors moved");
  assert.ok(
    firstReceipt > dispatch,
    "task-implement instructs the receipt at or before dispatch, where no verdict exists yet",
  );
  assert.ok(firstReceipt > mergePoint, "task-implement instructs the receipt before the join");
});

// ── the no-veto property, asserted where a receipt could have changed it ─────

const PASSING_VERIFICATION = [
  "# Verification Report",
  "",
  "**Verdict:** PASS",
  "",
  "```json verify-result",
  // A gate that RAN, so `noEvidenceRefusal` does not fire, and NO `provenance`,
  // so staleness is `unknown` and the freshness branch cannot block either. This
  // is the fixture `verify.test.mjs` already proves the gate ALLOWs.
  JSON.stringify({ verdict: "PASS", gates: [{ name: "test", status: "pass" }] }),
  "```",
  "",
].join("\n");

const BLOCKING_RECEIPT = [
  "# Diff Critique: feat/demo",
  "",
  "## Blockers",
  "",
  "- **[coverage]** AC1 has no implementing change",
  "",
  "```json critic-verdict",
  JSON.stringify({
    critic: "marvin-tm-diff-critic",
    subject: "demo",
    judged_at: "2026-08-15T09:30:00.000Z",
    compliance: { verdict: "BLOCK", blockers: 1, warnings: 0 },
    quality: { verdict: "UNABLE", blockers: 0, warnings: 0 },
    inability: {
      blocker: "the quality pass could not read two touched files",
      attempted: "read both paths named in the diff",
      recommendation: "re-dispatch with the files readable",
    },
  }),
  "```",
  "",
].join("\n");

/** Drive the live stdio server and return the parsed `deliver-gate` block. */
async function callGate(projectRoot) {
  const result = await callTool("verify", { action: "gate", projectRoot, write: false });
  const text = result.content.map((c) => c.text).join("\n");
  const m = text.match(/```json deliver-gate\n([\s\S]*?)\n```/);
  assert.ok(m, `no deliver-gate block in output:\n${text}`);
  return { raw: m[1], parsed: JSON.parse(m[1]) };
}

test("a receipt never moves the delivery gate", async () => {
  // ONE project root for both runs: the block embeds `artifactPath`, so two
  // roots would never be byte-identical for a reason that has nothing to do
  // with receipts.
  const root = mkdtempSync(join(tmpdir(), "marvin-critique-gate-"));
  try {
    mkdirSync(join(root, ".marvin", "task"), { recursive: true });
    writeFileSync(join(root, ".marvin", "task", "verification.md"), PASSING_VERIFICATION);

    const critiqueDir = join(root, ".marvin", "critique");
    mkdirSync(critiqueDir, { recursive: true });
    writeFileSync(join(critiqueDir, "001-demo.md"), BLOCKING_RECEIPT);
    const withReceipt = await callGate(root);

    rmSync(critiqueDir, { recursive: true, force: true });
    const withoutReceipt = await callGate(root);

    // The second assertion keeps the first honest: if the fixture ever stops
    // reaching the code a receipt could affect, this goes red instead of
    // passing vacuously on a short-circuit BLOCK.
    assert.equal(withReceipt.parsed.decision, "ALLOW", "the fixture must be one the gate ALLOWs");
    assert.equal(withoutReceipt.parsed.decision, "ALLOW");

    assert.equal(
      withReceipt.raw,
      withoutReceipt.raw,
      "a BLOCK receipt changed the delivery gate — the receipt became a veto",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
