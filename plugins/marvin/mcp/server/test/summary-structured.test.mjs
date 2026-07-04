import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

const KANBAN_TASK = [
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
  mkdirSync(join(repo, ".marvin", "kanban"), { recursive: true });
  writeFileSync(join(repo, ".marvin", "kanban", "001--demo.md"), KANBAN_TASK);
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

    // acceptance — conservative: test oracle on a PASS → pass; prose-review → unknown
    assert.equal(s.acceptance.length, 2);
    const ac1 = s.acceptance.find((a) => a.id === "AC1");
    const ac2 = s.acceptance.find((a) => a.id === "AC2");
    assert.equal(ac1.oracle_kind, "test");
    assert.equal(ac1.outcome, "pass");
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
