import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callTool } from "./_driver.mjs";

/**
 * The metrics-record guarantee (ADR-0044), asserted at both code anchors.
 *
 * The record used to be created lazily on the first append, and every append was
 * an instruction in a SKILL.md — so a session that skipped the call left no
 * record and nothing failed. Two gates the pipeline MUST call now write it: the
 * seal gate creates it, the delivery gate rolls it up on ALLOW.
 *
 * Three of the assertions below are DISCRIMINATING rather than merely
 * asserting — each is built so the plausible wrong implementation produces a
 * different value:
 *
 * - the reuse test puts the existing record under a name the spec basename
 *   would never produce, so resolving from the basename alone mints a second
 *   file instead of returning the same one;
 * - the BLOCK test uses a root whose gate would otherwise ALLOW, so a roll-up
 *   placed on every decision is caught rather than passing vacuously;
 * - the byte-identity test compares two calls that provably differ in what they
 *   wrote to disk, so a count or a timestamp leaking into the answer goes red.
 */

const here = dirname(fileURLToPath(import.meta.url));
// test → server → mcp → marvin
const PLUGIN = join(here, "..", "..", "..");
const SERVER_SRC = join(here, "..", "src");

const textOf = (r) => r.content.map((c) => c.text).join("\n");
const blockOf = (text, tag) => {
  const m = text.match(new RegExp("```json " + tag + "\\n([\\s\\S]*?)\\n```"));
  assert.ok(m, `no ${tag} block in:\n${text}`);
  return m[1];
};
const metricsDir = (root) => join(root, ".marvin", "metrics");
const recordsIn = (root) =>
  existsSync(metricsDir(root)) ? readdirSync(metricsDir(root)).sort() : [];
const terminalBlocks = (root, file) =>
  (readFileSync(join(metricsDir(root), file), "utf8").match(/```json task-metrics/g) ?? []).length;

/** A sealed, executable spec — the shape the seal gate PASSes. */
function specText({ slug = "demo-slug", status = "ready", withSlug = true } = {}) {
  const contract = [
    "```yaml spec-contract",
    "files:",
    "  - id: F1",
    "    path: src/a.ts",
    "    action: edit",
    "    satisfies: [AC1]",
    "criteria:",
    "  - id: AC1",
    "    statement: it works",
    "    implemented_by: [F1]",
    '    oracle: { kind: command, ref: "true" }',
    "```",
  ].join("\n");
  return [
    "---",
    ...(withSlug ? [`slug: ${slug}`] : []),
    "type: feature",
    `status: ${status}`,
    "created: 2026-09-04",
    // The hash of the block below, so the seal reports `intact` rather than
    // TAMPERED — computed by the tool itself on the first run and pinned here is
    // unnecessary: an UNSEALED spec answers PASS WITH WARNINGS, which is a
    // non-FAIL verdict and therefore still writes. Leaving it unsealed keeps the
    // fixture honest about the in-flight case the `empty` bucket exists for.
    "---",
    "",
    "# Demo",
    "",
    contract,
    "",
  ].join("\n");
}

/** A tmp project holding one spec file at the given name. */
function project({ specName = "007-demo-slug.md", spec = specText() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "marvin-metrics-record-"));
  mkdirSync(join(dir, ".marvin", "task", "runs"), { recursive: true });
  if (specName) writeFileSync(join(dir, ".marvin", "task", specName), spec);
  return dir;
}

const seal = (root, args) => callTool("spec", { action: "seal", projectRoot: root, ...args });

// ── the seal anchor ─────────────────────────────────────────────────────────

test("seal creates the record for a spec that has none", async () => {
  const root = project();
  try {
    assert.deepEqual(recordsIn(root), [], "precondition: no record yet");

    const r = await seal(root, { specPath: ".marvin/task/007-demo-slug.md" });
    assert.notEqual(r.isError, true, textOf(r));

    assert.deepEqual(
      recordsIn(root),
      ["007-demo-slug.md"],
      "the record is named after the spec's own file (ADR-0043 §1)",
    );
    const body = readFileSync(join(metricsDir(root), "007-demo-slug.md"), "utf8");
    assert.match(body, /^# Metrics — demo-slug/, "the header names the slug");
    // Header ONLY. A synthetic placeholder event would move a started-but-
    // abandoned run into `events_only`, which means "recorded something real".
    assert.ok(!body.includes("```json metric-event"), "no event was invented");
    assert.ok(!body.includes("```json task-metrics"), "no terminal block was invented");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("seal reuses an existing record and the path rule has one implementation", async () => {
  // DISCRIMINATING: the record sits under the UNNUMBERED name while the spec is
  // numbered, so an implementation that resolves from the spec basename alone
  // creates `007-demo-slug.md` beside it and the assertion below goes red.
  const root = project();
  try {
    mkdirSync(metricsDir(root), { recursive: true });
    writeFileSync(
      join(metricsDir(root), "demo-slug.md"),
      "# Metrics — demo-slug\n\n```json metric-event\n{}\n```\n\n",
    );

    const r = await seal(root, { specPath: ".marvin/task/007-demo-slug.md" });
    assert.notEqual(r.isError, true, textOf(r));

    assert.deepEqual(recordsIn(root), ["demo-slug.md"], "a slug must never get two record files");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // The other half of the same rule: a leftover private copy in the tool that
  // used to own it is invisible to every behavioural assertion above.
  const tool = readFileSync(join(SERVER_SRC, "tools", "metrics.ts"), "utf8");
  assert.ok(
    !/function recordPathFor\b/.test(tool),
    "tools/metrics.ts still declares its own recordPathFor — the path rule has two implementations",
  );
  assert.match(
    tool,
    /from "\.\.\/lib\/metrics-record\.js"/,
    "tools/metrics.ts does not import the shared writer",
  );
});

test("the seal write is refused five ways and never changes the verdict", async () => {
  // 1. an unwritable metrics directory — `.marvin/metrics` exists as a FILE
  const unwritable = project();
  // 2. no usable slug — no frontmatter `slug`, and a filename that is not kebab-case
  const noSlug = project({
    specName: "Demo_Spec.md",
    spec: specText({ withSlug: false }),
  });
  // 3. a spec whose lifecycle is over
  const shipped = project({ spec: specText({ status: "shipped" }) });
  // 4 & 5. inline content, alone and beside a path
  const inline = project();

  try {
    mkdirSync(join(unwritable, ".marvin"), { recursive: true });
    writeFileSync(metricsDir(unwritable), "not a directory\n");
    const a = await seal(unwritable, { specPath: ".marvin/task/007-demo-slug.md" });
    assert.notEqual(a.isError, true, "an unwritable record turned the seal gate red");
    assert.match(textOf(a), /\*\*Verdict:\*\* PASS WITH WARNINGS/);

    const b = await seal(noSlug, { specPath: ".marvin/task/Demo_Spec.md" });
    assert.notEqual(b.isError, true, textOf(b));
    assert.deepEqual(recordsIn(noSlug), [], "an unusable slug must write nothing at all");

    const c = await seal(shipped, { specPath: ".marvin/task/007-demo-slug.md" });
    assert.equal(c.isError, true, "a shipped spec must still FAIL the seal");
    assert.deepEqual(recordsIn(shipped), [], "a FAIL verdict must mint no record");

    const d = await seal(inline, { specContent: specText() });
    assert.notEqual(d.isError, true, textOf(d));
    assert.deepEqual(recordsIn(inline), [], "inline content names no spec on disk");

    // Both keys together: `runSpec` reads the INLINE fragment while `specPath`
    // stays truthy, so a guard written as `if (input.specPath)` would name a
    // record after a file it never opened.
    const e = await seal(inline, {
      specContent: specText(),
      specPath: ".marvin/task/007-demo-slug.md",
    });
    assert.notEqual(e.isError, true, textOf(e));
    assert.deepEqual(recordsIn(inline), [], "the condition is on which input was USED");
  } finally {
    for (const d of [unwritable, noSlug, shipped, inline]) {
      rmSync(d, { recursive: true, force: true });
    }
  }
});

test("a date-named spec with no frontmatter slug writes no record", async () => {
  // `slugOfRecord` strips one leading `<digits>-`, which is the spec-number
  // convention — a date-named file loses only its year and yields `09-04-thing`:
  // kebab-case, so SLUG_RE accepts it, and WRONG. A record under that name is
  // joined by nothing, and the roll-up would later mint a second file under the
  // real slug — the two-files defect the shared path rule exists to prevent.
  const root = project({
    specName: "2026-09-04-thing.md",
    spec: specText({ withSlug: false }),
  });
  try {
    const r = await seal(root, { specPath: ".marvin/task/2026-09-04-thing.md" });
    assert.notEqual(r.isError, true, textOf(r));
    assert.deepEqual(recordsIn(root), [], "a numeric-leading fallback slug must be refused");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── the delivery-gate anchor ────────────────────────────────────────────────

const PASSING_VERIFICATION = [
  "# Verification Report",
  "",
  "**Verdict:** PASS",
  "",
  "```json verify-result",
  // A gate that RAN, so the no-evidence refusal does not fire, and NO
  // `provenance`, so staleness is `unknown`. The absence is load-bearing for the
  // byte-identity test below: with provenance the gate recomputes staleness
  // against the working tree, and this test's own writes would move it.
  JSON.stringify({ verdict: "PASS", gates: [{ name: "test", status: "pass" }] }),
  "```",
  "",
].join("\n");

function delivered(spec = specText()) {
  const root = project({ spec });
  writeFileSync(join(root, ".marvin", "task", "verification.md"), PASSING_VERIFICATION);
  return root;
}

const gate = (root, args = {}) =>
  callTool("verify", { action: "gate", projectRoot: root, write: false, ...args });

test("the delivery gate rolls up on ALLOW and names the record", async () => {
  const root = delivered();
  try {
    const r = await gate(root, { specSlug: "demo-slug" });
    const text = textOf(r);
    assert.equal(JSON.parse(blockOf(text, "deliver-gate")).decision, "ALLOW", text);

    assert.deepEqual(recordsIn(root), ["007-demo-slug.md"]);
    assert.equal(terminalBlocks(root, "007-demo-slug.md"), 1, "exactly one terminal block");
    assert.match(
      text,
      /\*\*Metrics:\*\* `\.marvin\/metrics\/007-demo-slug\.md`/,
      "the answer must name the record, or a host project is never told it is ignored",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a blocked delivery and a slugless gate write no terminal block", async () => {
  // DISCRIMINATING: this root's gate ALLOWs with a slug (the test above proves
  // it), so the BLOCK below is produced by removing the artifact alone — a
  // roll-up placed on every decision is caught here rather than passing
  // vacuously on a root that could never have written anything.
  const blocked = delivered();
  rmSync(join(blocked, ".marvin", "task", "verification.md"));
  const slugless = delivered();
  try {
    const b = await gate(blocked, { specSlug: "demo-slug" });
    assert.equal(JSON.parse(blockOf(textOf(b), "deliver-gate")).decision, "BLOCK");
    assert.deepEqual(
      recordsIn(blocked),
      [],
      "a refused delivery must not count as one — `rolled_up` is what coverage reads as shipped",
    );

    const s = await gate(slugless);
    assert.equal(JSON.parse(blockOf(textOf(s), "deliver-gate")).decision, "ALLOW");
    assert.deepEqual(recordsIn(slugless), [], "no slug names no record");
    assert.ok(!textOf(s).includes("**Metrics:**"), "no record, so no line about one");
  } finally {
    for (const d of [blocked, slugless]) rmSync(d, { recursive: true, force: true });
  }
});

test("the roll-up leaks no count into the deliver-gate block", async () => {
  const root = delivered();
  try {
    const first = blockOf(textOf(await gate(root, { specSlug: "demo-slug" })), "deliver-gate");
    const second = blockOf(textOf(await gate(root, { specSlug: "demo-slug" })), "deliver-gate");

    // The two calls provably differ in what they wrote, which is what makes the
    // equality below meaningful rather than trivially true.
    assert.equal(terminalBlocks(root, "007-demo-slug.md"), 2, "the second call appended a block");
    assert.equal(
      first,
      second,
      "a record path, a block count or a timestamp reached the gate's machine-readable block",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── the pipeline prose ──────────────────────────────────────────────────────

test("task-deliver relays the roll-up and the executor still performs its own", () => {
  const deliver = readFileSync(join(PLUGIN, "skills", "task-deliver", "SKILL.md"), "utf8");
  const executor = readFileSync(join(PLUGIN, "agents", "marvin-tm-executor.md"), "utf8");

  // task-deliver passes through the delivery gate, which now writes the block.
  assert.ok(
    !/action: "rollup"/.test(deliver),
    "task-deliver still instructs a roll-up call — every delivery would append two terminal blocks",
  );
  assert.match(
    deliver,
    /delivery gate/i,
    "task-deliver must say where the record it relays came from",
  );

  // The executor never calls the delivery gate: it runs verify in `mode: feature`
  // and opens its own PR, so its own call is the ONLY writer of a headless run's
  // terminal block. Removing it would leave that pipeline unmeasured.
  assert.match(
    executor,
    /action: "rollup"/,
    "the executor lost its roll-up — the headless path never reaches the delivery gate",
  );
  assert.match(
    executor,
    /never calls the delivery gate/i,
    "the executor must state WHY it keeps a call task-deliver no longer makes",
  );
});
