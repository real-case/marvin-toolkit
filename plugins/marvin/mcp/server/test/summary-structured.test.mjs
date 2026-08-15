import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { callTool } from "./_driver.mjs";

const BRANCH = "feat/demo";
const PR_URL = "https://github.com/acme/widget/pull/7";

const SPEC = [
  "---",
  "slug: demo",
  "type: feature",
  "status: shipped",
  'created: "2026-06-20T09:00:00Z"',
  "tracker: OSI-9",
  "---",
  "",
  "# Demo feature",
  "",
  "## Goal",
  "Demonstrate the task-summary aggregator.",
  "",
  "```yaml spec-contract",
  "files:",
  "  - id: F1",
  "    path: src/demo.ts",
  "    action: new",
  "    satisfies: [AC1]",
  "criteria:",
  "  - id: AC1",
  "    statement: It does the thing",
  "    implemented_by: [F1]",
  "    oracle:",
  "      kind: test",
  "      ref: test/demo.test.ts::does the thing",
  "  - id: AC2",
  "    statement: It is documented",
  "    implemented_by: [F1]",
  "    oracle:",
  "      kind: prose-review",
  "```",
  "",
  "```yaml host-bindings",
  "decision_record:",
  "  path: docs/adr/0099-demo.md",
  "```",
  "",
].join("\n");

const VERIFICATION = [
  "# Verification Report",
  "",
  "**Verdict:** PASS",
  "",
  "```json verify-result",
  JSON.stringify({
    verdict: "PASS",
    gates: [{ name: "test", status: "pass", code: 0, durationMs: 5 }],
  }),
  "```",
  "",
].join("\n");

const BOARD_TASK = [
  "---",
  'id: "001"',
  "type: feature",
  "status: review",
  "title: Demo feature",
  `branch: ${BRANCH}`,
  `pr: ${PR_URL}`,
  'created: "2026-06-20T09:00:00.000Z"',
  'updated: "2026-06-20T09:00:00.000Z"',
  "---",
  "",
  "Body.",
  "",
].join("\n");

const LESSON = [
  "---",
  "id: demo-gotcha",
  "type: gotcha",
  "title: Demo gotcha",
  'created: "2026-06-20"',
  "tags: demo",
  "source: demo",
  "---",
  "",
  "Watch out for the demo gotcha.",
  "",
].join("\n");

/** A git repo on BRANCH with a base `dev` commit + one work commit. */
function seedRepo() {
  const repo = mkdtempSync(join(tmpdir(), "marvin-summary-"));
  const g = (...args) => execFileSync("git", args, { cwd: repo });
  g("init", "-q");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "Test");
  g("checkout", "-q", "-b", "dev");
  writeFileSync(join(repo, "README.md"), "# demo\n");
  g("add", "-A");
  g("commit", "-q", "-m", "chore: init");
  g("checkout", "-q", "-b", BRANCH);
  writeFileSync(join(repo, "src-demo.txt"), "work\n");
  g("add", "-A");
  g("commit", "-q", "-m", "feat: implement the demo");

  // .marvin/ working dir (resolved from CLAUDE_PROJECT_DIR by loadEnv)
  const taskDir = join(repo, ".marvin", "task");
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(join(taskDir, "001-demo.md"), SPEC);
  writeFileSync(join(taskDir, "verification.md"), VERIFICATION);
  mkdirSync(join(repo, ".marvin", "track"), { recursive: true });
  writeFileSync(join(repo, ".marvin", "track", "001--demo.md"), BOARD_TASK);
  mkdirSync(join(repo, ".marvin", "memory"), { recursive: true });
  writeFileSync(join(repo, ".marvin", "memory", "demo-gotcha.md"), LESSON);
  writeFileSync(
    join(repo, ".marvin", "config.json"),
    JSON.stringify({
      base_branch: "dev",
      tracker_url_template: "https://tracker.example/{tracker_id}",
    }),
  );
  return repo;
}

function callSummary(repo, args) {
  return callTool("summary", args, { env: { CLAUDE_PROJECT_DIR: repo } });
}

test("summary aggregates a spec into a TaskSummary structuredContent", async () => {
  const repo = seedRepo();
  try {
    const result = await callSummary(repo, { slug: "demo" });

    const text = result.content.map((c) => c.text).join("\n");
    assert.match(text, /# Task summary — Demo feature/);

    const s = result.structuredContent;
    assert.ok(s, "structuredContent present");
    assert.equal(s.slug, "demo");
    assert.equal(s.title, "Demo feature");
    assert.equal(s.status, "shipped");

    // acceptance — a gate-level PASS is NOT a per-criterion proof (ADR-0036).
    // Until 0.15.0 AC1 read `pass` here: a green suite promoted every
    // test/command criterion, with no per-criterion evidence of any kind. There
    // is no journal for this spec, so both criteria are `unknown`.
    assert.equal(s.acceptance.length, 2);
    const ac1 = s.acceptance.find((a) => a.id === "AC1");
    const ac2 = s.acceptance.find((a) => a.id === "AC2");
    assert.equal(ac1.oracle_kind, "test");
    assert.equal(ac1.outcome, "unknown", "a PASS verdict alone proves nothing about AC1");
    assert.equal(ac2.oracle_kind, "prose-review");
    assert.equal(ac2.outcome, "unknown", "prose-review is never auto-passed");

    // gates from the verify-result block
    assert.deepEqual(
      s.gates.map((g) => [g.name, g.status]),
      [["test", "pass"]],
    );

    // commits on the branch vs base
    assert.ok(s.commits.length >= 1);
    assert.ok(s.commits.some((c) => /implement the demo/.test(c.subject)));

    // lessons filtered by slug
    assert.ok(s.lessons.some((l) => l.title === "Demo gotcha"));

    // links assembled from artifacts
    const byKind = Object.fromEntries(s.links.map((l) => [l.kind, l]));
    assert.equal(byKind.spec.ref, "demo");
    assert.equal(byKind.branch.label, BRANCH);
    assert.equal(byKind.pr.url, PR_URL);
    assert.equal(byKind.tracker.url, "https://tracker.example/OSI-9");
    assert.equal(byKind.adr.ref, "docs/adr/0099-demo.md");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── per-spec runs: the summary must join against ITS OWN run (ADR-0035) ─────

/** A verify-result artifact with the given verdict and gates. */
function verificationWith(verdict, gates) {
  return [
    "# Verification Report",
    "",
    `**Verdict:** ${verdict}`,
    "",
    "```json verify-result",
    JSON.stringify({ verdict, gates }),
    "```",
    "",
  ].join("\n");
}

test("summary joins against the per-spec run and falls back to the global artifact", async () => {
  const repo = seedRepo();
  const taskDir = join(repo, ".marvin", "task");
  try {
    // The global artifact belongs to a DIFFERENT spec's run — a red FAIL that
    // has nothing to do with `demo`. This is the defect the per-spec run closes:
    // before it, task-summary presented that foreign run as this task's own.
    writeFileSync(
      join(taskDir, "verification.md"),
      verificationWith("FAIL", [{ name: "test", status: "fail", code: 1 }]),
    );
    mkdirSync(join(taskDir, "runs"), { recursive: true });
    writeFileSync(
      join(taskDir, "runs", "demo.md"),
      verificationWith("PASS", [{ name: "test", status: "pass", code: 0 }]),
    );

    const own = await callSummary(repo, { slug: "demo" });
    const ownText = own.content.map((c) => c.text).join("\n");
    assert.deepEqual(
      own.structuredContent.gates.map((g) => [g.name, g.status]),
      [["test", "pass"]],
      "the gate join comes from this spec's run, not the newest run in the project",
    );
    assert.equal(
      own.structuredContent.acceptance.find((a) => a.id === "AC1").outcome,
      "unknown",
      "the acceptance join no longer reads the verdict at all — a PASS run is not an AC proof",
    );
    // The slug resolves by the spec's frontmatter `slug` — the same rule
    // task-verify passes as specSlug, so writer and reader cannot disagree.
    assert.match(ownText, /`\.marvin\/task\/runs\/demo\.md`/, "the text names the file it read");

    // The slug is the FRONTMATTER slug, not the filename's — a spec whose file
    // was renamed still resolves to the run its own frontmatter names, which is
    // the rule /marvin:task-verify passes as specSlug.
    writeFileSync(
      join(taskDir, "002-a-different-filename.md"),
      SPEC.replace("slug: demo", "slug: canonical-demo"),
    );
    writeFileSync(
      join(taskDir, "runs", "canonical-demo.md"),
      verificationWith("PASS WITH WARNINGS", [{ name: "lint", status: "pass", code: 0 }]),
    );
    const renamed = await callSummary(repo, {}); // no slug → the newest spec
    assert.equal(renamed.structuredContent.slug, "canonical-demo");
    assert.deepEqual(
      renamed.structuredContent.gates.map((g) => g.name),
      ["lint"],
      "joined against runs/<frontmatter-slug>.md, not runs/<filename-slug>.md",
    );
    assert.match(
      renamed.content.map((c) => c.text).join("\n"),
      /`\.marvin\/task\/runs\/canonical-demo\.md`/,
    );
    rmSync(join(taskDir, "002-a-different-filename.md"), { force: true });

    // With no per-spec run present, the global artifact is used exactly as before.
    rmSync(join(taskDir, "runs"), { recursive: true, force: true });
    const fallback = await callSummary(repo, { slug: "demo" });
    assert.deepEqual(
      fallback.structuredContent.gates.map((g) => [g.name, g.status]),
      [["test", "fail"]],
    );
    assert.match(
      fallback.content.map((c) => c.text).join("\n"),
      /`\.marvin\/task\/verification\.md`/,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a not-run gate reaches the summary as skip under the unchanged GateOutcome schema", async () => {
  const repo = seedRepo();
  try {
    writeFileSync(
      join(repo, ".marvin", "task", "verification.md"),
      verificationWith("PASS WITH WARNINGS", [
        { name: "test", status: "pass", code: 0 },
        { name: "lint", status: "not-run", code: null },
      ]),
    );
    const result = await callSummary(repo, { slug: "demo" });
    const gates = Object.fromEntries(result.structuredContent.gates.map((g) => [g.name, g.status]));
    // `skip` is the member the contract, the widget and its committed fixtures
    // already support — mapping to `fail` would show a red gate for a tool
    // nobody installed, and extending the enum would cost nine baselines.
    assert.deepEqual(gates, { test: "pass", lint: "skip" });

    const { GateOutcome } = await import("@marvin-toolkit/mcp-shared/contracts");
    for (const g of result.structuredContent.gates) {
      assert.ok(GateOutcome.safeParse(g).success, `${g.name} validates unedited: ${g.status}`);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("summary names the verification state rather than interpolating a missing verdict", async () => {
  const repo = seedRepo();
  const artifact = join(repo, ".marvin", "task", "verification.md");
  const label = async () => {
    const result = await callSummary(repo, { slug: "demo" });
    const m = result.content
      .map((c) => c.text)
      .join("\n")
      // The state, without the trailing "(`path`)" the header now also carries —
      // naming the artifact read is orthogonal to naming the state (ADR-0035).
      .match(/\*\*Verification:\*\* (.+?)(?: \(`|$)/m);
    assert.ok(m, "the header line carries a verification state");
    return m[1];
  };
  try {
    writeFileSync(artifact, "# Verification\n\nProse only.\n");
    assert.equal(await label(), "not run", "no block reads the same as no artifact");

    writeFileSync(artifact, "# V\n\n```json verify-result\n{not json\n```\n");
    assert.equal(await label(), "unreadable");

    // A block with gates but no verdict: this is the case that used to print
    // the literal word `undefined`, via an unchecked cast.
    writeFileSync(artifact, '# V\n\n```json verify-result\n{"gates":[]}\n```\n');
    assert.equal(await label(), "recorded, no verdict");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── the acceptance join: recorded runs, not the gate verdict (ADR-0036) ─────

/**
 * The demo spec's REAL seal, computed here from the block by an independent
 * reimplementation of `contractHash` — sha256 of the trimmed block text, first
 * 16 hex — rather than imported from `storage/spec.ts`.
 *
 * It has to be the real hash: the summary recomputes the digest and joins on
 * that, so an arbitrary stamp joins against nothing. Recomputing it here instead
 * of importing the production function keeps the two sides independent — if
 * either normalises its input differently, this fixture stops matching and every
 * join test below fails, which is the point. Nothing else in this file compiles
 * TypeScript, and adding an `importTs` call would put an esbuild bundle on the
 * critical path of a suite that runs beside a wall-clock assertion.
 */
const SEALED_SHA = createHash("sha256")
  .update(/```[^\n`]*spec-contract[^\n`]*\n([\s\S]*?)\n```/.exec(SPEC)[1].trim())
  .digest("hex")
  .slice(0, 16);

/** `seedRepo`'s spec, re-stamped with its `contract_sha` so the journal has a
 * key to join on. */
function sealDemoSpec(repo, sha = SEALED_SHA) {
  writeFileSync(
    join(repo, ".marvin", "task", "001-demo.md"),
    SPEC.replace("status: shipped", `status: shipped\ncontract_sha: ${sha}`),
  );
}

/** Append `oracle-run` blocks to the demo spec's journal, in order. */
function journal(repo, entries) {
  const runsDir = join(repo, ".marvin", "task", "runs");
  mkdirSync(runsDir, { recursive: true });
  const blocks = entries
    .map((e) =>
      [
        "```json oracle-run",
        JSON.stringify({
          slug: "demo",
          contract_sha: SEALED_SHA,
          criterion: "AC1",
          expect: "pass",
          status: "pass",
          command: "sh t.sh",
          source: "oracle.run",
          code: 0,
          signal: null,
          test_file: "test/demo.test.ts",
          test_sha: "1111111111111111",
          head_sha: "abcdef1",
          ran_at: "2026-08-13T10:00:00.000Z",
          ...e,
        }),
        "```",
        "",
      ].join("\n"),
    )
    .join("\n");
  writeFileSync(join(runsDir, "demo.oracles.md"), `# Oracle runs — demo\n\n${blocks}`);
}

const ac1Of = (result) => result.structuredContent.acceptance.find((a) => a.id === "AC1").outcome;

test("a gate-level PASS no longer makes a criterion pass and a recorded run does", async () => {
  const repo = seedRepo();
  try {
    sealDemoSpec(repo);

    // 1. No journal, PASS verdict, `kind: test` oracle — the exact shape that
    //    reported `pass` before this change, with nothing behind it.
    assert.equal(ac1Of(await callSummary(repo, { slug: "demo" })), "unknown");

    // 2. A recorded green: the one thing that earns a `pass`.
    journal(repo, [{}]);
    assert.equal(ac1Of(await callSummary(repo, { slug: "demo" })), "pass");

    // 3. A red-only journal. The test failed before the fix, which says nothing
    //    about whether the criterion now holds — an implementation abandoned
    //    after step 6B looks exactly like this.
    journal(repo, [{ expect: "fail", status: "fail", code: 1 }]);
    assert.equal(ac1Of(await callSummary(repo, { slug: "demo" })), "unknown");

    // 4. A green-phase run that exited non-zero: a recorded FAIL, and the first
    //    per-criterion `fail` this tool has ever been able to state.
    journal(repo, [{ status: "fail", code: 1 }]);
    assert.equal(ac1Of(await callSummary(repo, { slug: "demo" })), "fail");

    // 5. `not-run` — an unresolved command, a signal kill, a launch failure.
    journal(repo, [{ status: "not-run", code: null, command: null, source: null }]);
    assert.equal(ac1Of(await callSummary(repo, { slug: "demo" })), "unknown");

    // 6. The newest entry decides: red, then green.
    journal(repo, [{ expect: "fail", status: "fail", code: 1 }, {}]);
    assert.equal(ac1Of(await callSummary(repo, { slug: "demo" })), "pass");

    // 7. A journal recorded under a superseded contract changes nothing. The
    //    seal is the join key: the AC1 that run proved is not the AC1 in force.
    journal(repo, [{ contract_sha: "0000000000000000" }]);
    assert.equal(ac1Of(await callSummary(repo, { slug: "demo" })), "unknown");

    // 8. An UNSEALED spec has no key at all, so a journal cannot be read against
    //    it — otherwise every unsealed spec would share one proof namespace.
    journal(repo, [{}]);
    writeFileSync(join(repo, ".marvin", "task", "001-demo.md"), SPEC); // no contract_sha
    assert.equal(ac1Of(await callSummary(repo, { slug: "demo" })), "unknown");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a spec amended after sealing joins nothing — the stamp alone is not the key", async () => {
  const repo = seedRepo();
  try {
    sealDemoSpec(repo);
    journal(repo, [{}]);
    assert.equal(ac1Of(await callSummary(repo, { slug: "demo" })), "pass");

    // Amend the sealed block and do NOT re-stamp. The frontmatter still carries
    // the digest the journal was written against, so a join on the stamp as
    // written still matches — and reports the old run's `pass` beside a
    // statement that has since changed. Re-sealing is the case the stamp handles
    // on its own; this is the other half, and it is the one a human reads.
    writeFileSync(
      join(repo, ".marvin", "task", "001-demo.md"),
      SPEC.replace("status: shipped", `status: shipped\ncontract_sha: ${SEALED_SHA}`).replace(
        "statement: It does the thing",
        "statement: It does something else entirely",
      ),
    );
    const amended = await callSummary(repo, { slug: "demo" });
    assert.equal(ac1Of(amended), "unknown");
    assert.match(
      amended.content.map((c) => c.text).join("\n"),
      /EDITED SINCE IT WAS SEALED/,
      "every criterion going unknown at once must say why, or it reads as the feature being broken",
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("every emitted acceptance outcome is one of the three AcOutcome values", async () => {
  const repo = seedRepo();
  try {
    sealDemoSpec(repo);
    journal(repo, [{}]);
    const result = await callSummary(repo, { slug: "demo" });
    const { AcOutcome } = await import("@marvin-toolkit/mcp-shared/contracts");
    for (const ac of result.structuredContent.acceptance) {
      assert.ok(
        ["pass", "fail", "unknown"].includes(ac.outcome),
        `${ac.id} emitted ${ac.outcome} — a fourth value is a shared-contract change (C2) the widget cannot style`,
      );
      assert.ok(
        AcOutcome.safeParse(ac).success,
        `${ac.id} validates against the unedited contract`,
      );
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

/**
 * The artifact-location split this package decides (ADR-0037): a spec is a
 * project document and follows `spec.dir`, while everything marvin GENERATES
 * about a run stays `.marvin/`-pinned (ADR-0007). One test proves both halves —
 * the spec is resolved from `docs/rfcs/`, and its verification still comes from
 * `.marvin/task/verification.md`, which did not move with it.
 */
test("a host-adaptive spec still joins the .marvin-pinned verification", async () => {
  const repo = seedRepo();
  try {
    // Move the spec out of .marvin/task/ entirely and declare where it went.
    rmSync(join(repo, ".marvin", "task", "001-demo.md"));
    const rfcs = join(repo, "docs", "rfcs");
    mkdirSync(rfcs, { recursive: true });
    writeFileSync(join(rfcs, "0001-demo.md"), SPEC);
    writeFileSync(
      join(repo, ".marvin", "config.json"),
      JSON.stringify({ base_branch: "dev", spec: { dir: "docs/rfcs" } }),
    );

    for (const args of [{ slug: "demo" }, {}]) {
      const result = await callSummary(repo, args);
      const s = result.structuredContent;
      assert.ok(s, `structuredContent present for ${JSON.stringify(args)}`);
      assert.equal(s.slug, "demo", "the spec resolved from the configured directory");
      assert.equal(s.title, "Demo feature");
      assert.deepEqual(
        s.gates.map((g) => [g.name, g.status]),
        [["test", "pass"]],
        "the verification artifact did not follow the spec out of .marvin/",
      );
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

/**
 * A caller-supplied `projectRoot` reads THAT project's config.
 *
 * The tool's own `projectRoot` argument makes cross-project calls a supported
 * shape, and `ServerEnv` is resolved once at startup — so a config loaded from
 * the environment describes the project the server was spawned for, not the one
 * being summarised. The leak is not merely a missing answer: both trees here
 * declare a `spec.dir`, so the spawning project's setting picks a DIFFERENT,
 * real file out of the target's tree and summarises it with full confidence.
 *
 * No slug is passed, because that is the path where the directory alone decides
 * which spec is the answer.
 */
test("a foreign projectRoot is summarised through its own config, not the server's", async () => {
  const home = seedRepo();
  const target = seedRepo();
  try {
    // The target keeps its spec somewhere only its OWN config names.
    rmSync(join(target, ".marvin", "task", "001-demo.md"));
    const product = join(target, "product", "specs");
    mkdirSync(product, { recursive: true });
    writeFileSync(join(product, "001-demo.md"), SPEC);
    writeFileSync(
      join(target, ".marvin", "config.json"),
      JSON.stringify({ base_branch: "dev", spec: { dir: "product/specs" } }),
    );

    // A decoy sitting exactly where the SPAWNING project's config points. It is
    // in the target's tree, so a leaked `spec.dir` resolves it and answers.
    const rfcs = join(target, "docs", "rfcs");
    mkdirSync(rfcs, { recursive: true });
    writeFileSync(join(rfcs, "001-decoy.md"), SPEC.replace("slug: demo", "slug: decoy"));
    writeFileSync(
      join(home, ".marvin", "config.json"),
      JSON.stringify({ base_branch: "dev", spec: { dir: "docs/rfcs" } }),
    );

    const result = await callTool(
      "summary",
      { projectRoot: target },
      { env: { CLAUDE_PROJECT_DIR: home } },
    );
    const s = result.structuredContent;
    assert.ok(s, "structuredContent present");
    assert.equal(
      s.slug,
      "demo",
      "the target's own spec.dir decided; the server's project config leaked in",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});

// ── critique receipts reach the summary as links (ADR-0039) ─────────────────

/** A receipt for `slug`, written by `critic`, with the given axis verdicts. */
function receipt(critic, slug, compliance, quality) {
  return [
    `# ${critic === "marvin-tm-spec-critic" ? "Spec" : "Diff"} Critique: ${slug}`,
    "",
    "Prose.",
    "",
    "```json critic-verdict",
    JSON.stringify({
      critic,
      subject: slug,
      judged_at: "2026-08-15T09:30:00.000Z",
      compliance: { verdict: compliance, blockers: 0, warnings: 0 },
      quality: { verdict: quality, blockers: 0, warnings: 1 },
    }),
    "```",
    "",
  ].join("\n");
}

const critiqueLinks = (s) =>
  s.links.filter((l) => l.kind === "external" && (l.ref ?? "").includes(".marvin/critique/"));

test("the task summary links a critique receipt when one exists", async () => {
  const repo = seedRepo();
  try {
    // Baseline first: with no receipt the links array is exactly what it is
    // today. This is what keeps the feature from silently altering every
    // existing summary.
    const before = (await callSummary(repo, { slug: "demo" })).structuredContent;
    assert.deepEqual(critiqueLinks(before), [], "precondition: no receipt, no critique link");
    const baselineKinds = before.links.map((l) => l.kind);

    const dir = join(repo, ".marvin", "critique");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "001-demo.md"),
      receipt("marvin-tm-diff-critic", "demo", "PASS", "PASS WITH WARNINGS"),
    );

    const s = (await callSummary(repo, { slug: "demo" })).structuredContent;
    const links = critiqueLinks(s);
    assert.equal(links.length, 1);
    // The label names the producing critic AND both axis verdicts; the ref is
    // the receipt path, so the summary reaches the file itself.
    assert.equal(links[0].label, "diff critic — compliance PASS · quality PASS WITH WARNINGS");
    assert.equal(links[0].ref, ".marvin/critique/001-demo.md");
    // Every other link is unchanged — the receipt is added, nothing is replaced.
    assert.deepEqual(
      s.links.slice(0, baselineKinds.length).map((l) => l.kind),
      baselineKinds,
    );

    // A receipt for another spec is not this spec's receipt.
    writeFileSync(
      join(dir, "002-other.md"),
      receipt("marvin-tm-spec-critic", "unrelated", "PASS", "PASS"),
    );
    assert.equal(
      critiqueLinks((await callSummary(repo, { slug: "demo" })).structuredContent).length,
      1,
      "the lookup keys on subject, not on being in the directory",
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("two receipts for one spec render one link per critic, told apart by the label", async () => {
  const repo = seedRepo();
  try {
    const dir = join(repo, ".marvin", "critique");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "001-demo.md"),
      receipt("marvin-tm-spec-critic", "demo", "PASS", "PASS"),
    );
    writeFileSync(
      join(dir, "002-demo.md"),
      receipt("marvin-tm-diff-critic", "demo", "PASS", "PASS"),
    );

    const links = critiqueLinks((await callSummary(repo, { slug: "demo" })).structuredContent);
    assert.equal(links.length, 2, "one link per critic");

    // The widget renders these as two ghost buttons. With identical axis values
    // the critic prefix is the ONLY thing that tells the reader which gate
    // produced which — the reason the critic is in the label and not only in
    // the file.
    const labels = links.map((l) => l.label).sort();
    assert.deepEqual(labels, [
      "diff critic — compliance PASS · quality PASS",
      "spec critic — compliance PASS · quality PASS",
    ]);
    assert.notEqual(labels[0], labels[1]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

/**
 * The receipts follow the ROOT BEING SUMMARISED, like every other read here.
 *
 * `ServerEnv` is resolved once at startup, so a receipt directory taken from the
 * environment names the project the server was spawned for — while the `ref` is
 * built with `relative(projectRoot, …)`. Under `summary { projectRoot: <other
 * tree> }` that pairing listed the SERVER's receipts and stamped them with a
 * `../../…` path escaping the root the ref claims to be relative to.
 *
 * Both trees hold a receipt for the slug `demo`, which is the arrangement that
 * makes the wrong answer look right: the lookup keys on `subject`, so a slug two
 * projects share is all it takes. The verdicts differ, so the label alone says
 * which tree answered.
 */
test("critique receipts are read from the summarised project, not the server's own", async () => {
  const home = seedRepo();
  const target = seedRepo();
  try {
    const homeDir = join(home, ".marvin", "critique");
    mkdirSync(homeDir, { recursive: true });
    writeFileSync(
      join(homeDir, "001-demo.md"),
      receipt("marvin-tm-spec-critic", "demo", "PASS", "PASS"),
    );

    const targetDir = join(target, ".marvin", "critique");
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(
      join(targetDir, "007-demo.md"),
      receipt("marvin-tm-diff-critic", "demo", "BLOCK", "PASS WITH WARNINGS"),
    );

    const result = await callTool(
      "summary",
      { projectRoot: target, slug: "demo" },
      { env: { CLAUDE_PROJECT_DIR: home } },
    );
    const links = critiqueLinks(result.structuredContent);
    assert.equal(links.length, 1, "one receipt — the target's, and only the target's");
    assert.equal(
      links[0].label,
      "diff critic — compliance BLOCK · quality PASS WITH WARNINGS",
      "the spawning project's receipt is not this project's review record",
    );
    assert.equal(
      links[0].ref,
      ".marvin/critique/007-demo.md",
      "the ref resolves inside the root it is relative to",
    );
    assert.ok(!links[0].ref.startsWith(".."), "and does not escape it");
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});
