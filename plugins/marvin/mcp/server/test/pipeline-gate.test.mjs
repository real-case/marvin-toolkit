import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  claims,
  defaultChecks,
  g,
  gateStage,
  protectedDefaults,
  runWorktree,
} from "./_gate-fixture.mjs";
import { sh } from "./_pipeline-git.mjs";

const pipelineDir = fileURLToPath(new URL("../../../pipeline/", import.meta.url));
const { DEFAULT_PROTECTED } = await import(
  join(pipelineDir, "hooks", "worktree-boundary-guard.mjs")
);
const scripted = (codes) => {
  let i = 0;
  return () => ({ code: codes[i++] ?? 0, output: "out\nerror: boom", ms: 5 });
};

test("a gate that fails twice fails; a gate that passes on the re-run is flaky", () => {
  assert.equal(
    g.runGates([{ name: "test", command: "x" }], "/", scripted([1, 1]), 1000)[0].result,
    "fail",
  );
  assert.equal(
    g.runGates([{ name: "test", command: "x" }], "/", scripted([1, 0]), 1000)[0].result,
    "flaky",
  );
  assert.equal(
    g.runGates([{ name: "test", command: "x" }], "/", scripted([0]), 1000)[0].result,
    "pass",
  );
});

test("gates run one after another and a failing tail prefers the error lines", () => {
  const order = [];
  const run = (command) => {
    order.push(command);
    return {
      code: command === "b" ? 1 : 0,
      output: `noise\n${"x\n".repeat(60)}FAILED: nope\nmore`,
      ms: 1,
    };
  };
  const out = g.runGates(
    [
      { name: "a", command: "a" },
      { name: "b", command: "b" },
    ],
    "/",
    run,
    1000,
  );
  assert.deepEqual(order, ["a", "b", "b"]);
  assert.deepEqual(
    out.map((r) => r.result),
    ["pass", "fail"],
  );
  assert.equal(out[1].tail, "FAILED: nope");
});

test("the shell runner reports the exit code, the output and a timeout as 124", () => {
  const ok = g.shellRunner("echo hi; echo oops >&2; exit 3", tmpdir(), 5000);
  assert.equal(ok.code, 3);
  assert.match(ok.output, /hi/);
  assert.match(ok.output, /oops/);
  assert.equal(g.shellRunner("sleep 5", tmpdir(), 100).code, 124);
});

test("an acceptance oracle gets no flaky re-run: its first failure is a fail", () => {
  let runs = 0;
  const run = () => ({ code: ++runs === 1 ? 1 : 0, output: "error: boom", ms: 1 });
  const [oracle] = g.runGates([{ name: "oracle:AC1", command: "x", retry: false }], "/", run, 1000);
  assert.equal(oracle.result, "fail");
  assert.equal(runs, 1);
  runs = 0;
  const [plain] = g.runGates([{ name: "test", command: "x" }], "/", run, 1000);
  assert.equal(plain.result, "flaky");
  assert.equal(runs, 2);
});

const survivors = (marker) =>
  spawnSync("pgrep", ["-f", marker], { encoding: "utf8" }).stdout.trim();
const marker = () => `31.${Math.floor(Math.random() * 1e9)}`;

test("a timeout kills the whole process tree and says so in the output", () => {
  const m = marker();
  const started = Date.now();
  const out = g.shellRunner(`sleep ${m} & sleep ${m} & wait`, tmpdir(), 300);
  assert.equal(out.code, 124);
  assert.match(out.output, /timed out after 300ms/);
  assert.ok(Date.now() - started < 8000);
  assert.equal(survivors(`sleep ${m}`), "");
});

test("a timeout also ends a command that ignores TERM", () => {
  const m = marker();
  const out = g.shellRunner(`trap '' TERM; sleep ${m} & wait`, tmpdir(), 300);
  assert.equal(out.code, 124);
  assert.equal(survivors(`sleep ${m}`), "");
});

test("the shell runner hands the command over unmangled and keeps its exit code", () => {
  const out = g.shellRunner(`printf '%s|%s' "q'uote" '$HOME'; exit 7`, tmpdir(), 5000);
  assert.equal(out.code, 7);
  assert.equal(out.output, "q'uote|$HOME");
});

test("added lines carry their new-file line numbers", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -3,0 +4,2 @@",
    "+const x = 1;",
    "+debugger;",
  ].join("\n");
  assert.deepEqual(g.addedLines(diff), [
    { file: "src/a.ts", line: 4, text: "const x = 1;" },
    { file: "src/a.ts", line: 5, text: "debugger;" },
  ]);
});

test("added lines span files and hunks, and a deletion adds nothing", () => {
  const diff = [
    "diff --git a/a.ts b/a.ts",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "@@ -9,0 +10 @@",
    "+tail",
    "diff --git a/gone.ts b/gone.ts",
    "deleted file mode 100644",
    "--- a/gone.ts",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-x",
    "-y",
    "diff --git a/my file.ts b/my file.ts",
    "--- a/my file.ts\t",
    "+++ b/my file.ts\t",
    "@@ -0,0 +1 @@",
    "+spaced",
  ].join("\n");
  assert.deepEqual(g.addedLines(diff), [
    { file: "a.ts", line: 1, text: "new" },
    { file: "a.ts", line: 10, text: "tail" },
    { file: "my file.ts", line: 1, text: "spaced" },
  ]);
});

test("an added line that looks like a file header cannot redirect the lines after it", () => {
  const diff = [
    "diff --git a/src/a.test.ts b/src/a.test.ts",
    "--- a/src/a.test.ts",
    "+++ b/src/a.test.ts",
    "@@ -0,0 +1,3 @@",
    "+++ b/elsewhere.ts",
    "+-- a/other.ts",
    "+it.only('x');",
  ].join("\n");
  assert.deepEqual(g.addedLines(diff), [
    { file: "src/a.test.ts", line: 1, text: "++ b/elsewhere.ts" },
    { file: "src/a.test.ts", line: 2, text: "-- a/other.ts" },
    { file: "src/a.test.ts", line: 3, text: "it.only('x');" },
  ]);
});

test("quoted patch headers are decoded, escapes and UTF-8 octal included", () => {
  const diff = [
    'diff --git "a/src/a\\"b.test.ts" "b/src/a\\"b.test.ts"',
    '--- "a/src/a\\"b.test.ts"',
    '+++ "b/src/a\\"b.test.ts"',
    "@@ -0,0 +1 @@",
    "+it.only('x');",
    'diff --git "a/src/caf\\303\\251.ts" "b/src/caf\\303\\251.ts"',
    '+++ "b/src/caf\\303\\251\\t\\\\x.ts"',
    "@@ -0,0 +1 @@",
    "+debugger;",
  ].join("\n");
  assert.deepEqual(g.addedLines(diff), [
    { file: 'src/a"b.test.ts', line: 1, text: "it.only('x');" },
    { file: "src/caf\u00e9\t\\x.ts", line: 1, text: "debugger;" },
  ]);
  assert.equal(g.cUnquote('"b/plain.ts"'), "b/plain.ts");
  assert.equal(g.cUnquote("unquoted"), "unquoted");
});

test("a raw astral character inside a quoted header round-trips, alone or beside octal escapes", () => {
  assert.equal(g.cUnquote('"b/src/\u{1F600}\\t.ts"'), "b/src/\u{1F600}\t.ts");
  assert.equal(g.cUnquote('"\u{1F600}\\360\\237\\230\\200"'), "\u{1F600}\u{1F600}");
  const diff = [
    'diff --git "a/src/\u{1F600}\\t.ts" "b/src/\u{1F600}\\t.ts"',
    '+++ "b/src/\u{1F600}\\t.ts"',
    "@@ -0,0 +1 @@",
    "+debugger;",
  ].join("\n");
  assert.deepEqual(g.addedLines(diff), [
    { file: "src/\u{1F600}\t.ts", line: 1, text: "debugger;" },
  ]);
});

test("checks respect path and exclude patterns", () => {
  const lines = [
    { file: "src/a.test.ts", line: 1, text: "it.only('x')" },
    { file: "src/a.ts", line: 1, text: "it.only('x')" },
  ];
  const hits = g.scanChecks(lines, [
    {
      id: "only",
      pattern: "\\.only\\(",
      path_pattern: "\\.test\\.ts$",
      message: "m",
      severity: "blocker",
    },
  ]);
  assert.deepEqual(
    hits.map((h) => h.file),
    ["src/a.test.ts"],
  );
  const skipped = g.scanChecks(lines, [
    { id: "only", pattern: "\\.only\\(", exclude_pattern: "\\.test\\.ts$", message: "m" },
  ]);
  assert.deepEqual(
    skipped.map((h) => [h.file, h.severity, h.category]),
    [["src/a.ts", "major", "convention"]],
  );
});

test("the shipped default checks flag focused tests, skipped tests and debugger statements", () => {
  const lines = [
    { file: "src/a.test.ts", line: 1, text: "it.only('x', () => {})" },
    { file: "src/a.ts", line: 2, text: "it.only('not a test file')" },
    { file: "src/a.spec.mjs", line: 3, text: "describe.skip('y', () => {})" },
    { file: "src/b.ts", line: 4, text: "  debugger;" },
    { file: "src/c.ts", line: 5, text: "const debuggerName = 1;" },
  ];
  assert.deepEqual(
    g.scanChecks(lines, defaultChecks).map((h) => [h.id, h.file, h.severity, h.category]),
    [
      ["only", "src/a.test.ts", "blocker", "test-quality"],
      ["skip", "src/a.spec.mjs", "major", "test-quality"],
      ["debugger", "src/b.ts", "major", "convention"],
    ],
  );
});

test("undeclared files exclude the contract, sealed tests and exempt paths", () => {
  assert.deepEqual(
    g.undeclaredFiles(
      ["src/a.ts", "src/b.ts", "specs/1-x.md", "src/a.test.ts"],
      ["src/a.ts", "src/a.test.ts"],
      "^specs/",
    ),
    ["src/b.ts"],
  );
  assert.deepEqual(g.undeclaredFiles(["x", "x"], [], null), ["x"]);
});

test("changed protected paths are matched case-insensitively and listed once", () => {
  assert.deepEqual(
    g.protectedChanges(
      [
        ".husky/pre-commit",
        "src/a.ts",
        ".Husky/pre-push",
        ".husky/pre-commit",
        ".claude/settings.local.json",
      ],
      protectedDefaults,
    ),
    [".husky/pre-commit", ".Husky/pre-push", ".claude/settings.local.json"],
  );
  assert.throws(() => g.protectedChanges([".husky/pre-commit"], []), /non-empty array/);
});

test("the gate stage's default protected list is the one the boundary hook enforces", () => {
  assert.deepEqual(protectedDefaults, DEFAULT_PROTECTED);
  assert.ok(protectedDefaults.length > 0);
});

test("the boundary hook denies every edit when the shared protected list is unusable", async () => {
  const plugin = realpathSync(mkdtempSync(join(tmpdir(), "pipe-plugin-")));
  const pluginSrc = join(pipelineDir, "..");
  cpSync(join(pluginSrc, "hooks", "lib"), join(plugin, "hooks", "lib"), { recursive: true });
  cpSync(pipelineDir, join(plugin, "pipeline"), { recursive: true });
  const list = join(plugin, "pipeline", "protected.default.json");
  const wt = realpathSync(mkdtempSync(join(tmpdir(), "pipe-wt-")));
  const edit = (rel) =>
    spawnSync(
      process.execPath,
      [join(plugin, "pipeline", "hooks", "worktree-boundary-guard.mjs")],
      {
        input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(wt, rel) } }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: wt },
        encoding: "utf8",
      },
    );
  assert.equal(edit("src/a.ts").status, 0);
  assert.equal(edit(".husky/pre-commit").status, 2);
  const hook = join(plugin, "pipeline", "hooks", "worktree-boundary-guard.mjs");
  let load = 0;
  const loaded = () => import(`${pathToFileURL(hook).href}?load=${(load += 1)}`);
  assert.deepEqual((await loaded()).DEFAULT_PROTECTED, protectedDefaults);
  for (const broken of ["[]", "{}", '["^ok", 7]', "not json", '["["]']) {
    writeFileSync(list, broken);
    const denied = edit("src/a.ts");
    assert.equal(denied.status, 2, broken);
    assert.match(denied.stderr, /BLOCKED/, broken);
    const mod = await loaded();
    assert.equal(mod.DEFAULT_PROTECTED, null, broken);
    assert.throws(() => mod.protectedPatterns(undefined), /protected\.default\.json is unusable/);
  }
  rmSync(list);
  assert.equal(edit("src/a.ts").status, 2);
  assert.equal((await loaded()).DEFAULT_PROTECTED, null);
});

test("a modified sealed file is caught by its hash", () => {
  const wt = mkdtempSync(join(tmpdir(), "pipe-"));
  writeFileSync(join(wt, "a.test.ts"), "x");
  const sealed = [
    { path: "a.test.ts", sha256: g.sha256File(join(wt, "a.test.ts")), criteria: ["AC1"] },
  ];
  assert.deepEqual(g.checkSealed(wt, sealed), [{ path: "a.test.ts", ok: true }]);
  writeFileSync(join(wt, "a.test.ts"), "y");
  assert.deepEqual(g.checkSealed(wt, sealed), [{ path: "a.test.ts", ok: false }]);
});

test("a removed sealed file, or one replaced by a directory, is not intact", () => {
  const wt = mkdtempSync(join(tmpdir(), "pipe-"));
  writeFileSync(join(wt, "a.test.ts"), "x");
  const sha256 = g.sha256File(join(wt, "a.test.ts"));
  const sealed = [
    { path: "gone.test.ts", sha256, criteria: [] },
    { path: "dir.test.ts", sha256, criteria: [] },
  ];
  mkdirSync(join(wt, "dir.test.ts"));
  assert.deepEqual(g.checkSealed(wt, sealed), [
    { path: "gone.test.ts", ok: false },
    { path: "dir.test.ts", ok: false },
  ]);
});

const empty = {
  gates: [],
  undeclared: [],
  protected: [],
  protectedSources: {},
  protectedPatterns: protectedDefaults,
  checks: [],
  sealed: [],
  blockers: [],
};

test("a report passes only when nothing blocks, and flaky becomes a minor finding", () => {
  const parts = {
    ...empty,
    gates: [{ name: "test", result: "flaky", ms: 1, tail: "t" }],
    sealed: [{ path: "a.test.ts", ok: true }],
  };
  const report = g.buildReport(parts);
  assert.equal(report.passed, true);
  assert.deepEqual(
    g.reportFindings(report).map((f) => [f.severity, f.category]),
    [["minor", "gate"]],
  );
  const broken = g.buildReport({ ...parts, sealed: [{ path: "a.test.ts", ok: false }] });
  assert.equal(broken.passed, false);
  assert.equal(g.reportFindings(broken).find((f) => f.file === "a.test.ts").severity, "blocker");
});

test("a failed gate, an undeclared file and a non-minor check each fail the report", () => {
  const base = empty;
  const hit = (severity) => ({
    id: "c",
    file: "a.ts",
    line: 1,
    text: "t",
    message: "m",
    severity,
    category: "convention",
  });
  assert.equal(g.buildReport(base).passed, true);
  assert.equal(
    g.buildReport({ ...base, gates: [{ name: "lint", result: "fail", ms: 1, tail: "t" }] }).passed,
    false,
  );
  assert.equal(g.buildReport({ ...base, undeclared: ["x.ts"] }).passed, false);
  assert.equal(g.buildReport({ ...base, checks: [hit("major")] }).passed, false);
  assert.equal(g.buildReport({ ...base, checks: [hit("minor")] }).passed, true);
});

test("a protected changed path fails the report and is a scope blocker", () => {
  const report = g.buildReport({ ...empty, protected: [".husky/pre-commit"] });
  assert.equal(report.passed, false);
  const findings = g.reportFindings(report);
  assert.equal(findings.length, 1);
  assert.deepEqual(
    [findings[0].severity, findings[0].category, findings[0].file, findings[0].claim],
    ["blocker", "scope", ".husky/pre-commit", ".husky/pre-commit is a protected path"],
  );
});

test("a protected finding names where it was seen and the patterns it was judged against", () => {
  const report = g.buildReport({
    ...empty,
    protected: [".a", ".b", ".c"],
    protectedSources: {
      ".a": ["committed diff"],
      ".b": ["protected snapshot", "committed diff"],
      ".c": ["post-gate snapshot"],
    },
    protectedPatterns: ["^\\.a$", "^\\.b$"],
  });
  const findings = g.reportFindings(report);
  assert.deepEqual(
    findings.map((f) => [f.file, f.claim, f.evidence]),
    [
      [".a", ".a is a protected path", "committed diff"],
      [".b", ".b is a protected path", "protected snapshot, committed diff"],
      [".c", "protected path .c changed during gates", "post-gate snapshot"],
    ],
  );
  assert.equal(findings[0].expected, "no changes to protected paths (patterns: ^\\.a$, ^\\.b$)");
});

test("an engine blocker fails the report and becomes a blocker finding", () => {
  const report = g.buildReport({
    ...empty,
    blockers: [
      { category: "scope", claim: "HEAD moved during gates", evidence: "a -> b", expected: "e" },
      { category: "gate", claim: "c", file: "x.ts", evidence: "ev", expected: "ex" },
    ],
  });
  assert.equal(report.passed, false);
  assert.deepEqual(
    g.reportFindings(report).map((f) => [f.id, f.severity, f.category, f.file, f.claim]),
    [
      ["B-1", "blocker", "scope", undefined, "HEAD moved during gates"],
      ["B-2", "blocker", "gate", "x.ts", "c"],
    ],
  );
});

test("finding ids are unique across a report with every kind of finding", () => {
  const report = g.buildReport({
    ...empty,
    gates: [
      { name: "test", result: "fail", ms: 1, tail: "t" },
      { name: "lint", result: "flaky", ms: 1, tail: "t" },
    ],
    undeclared: ["a.ts", "b.ts"],
    protected: [".mcp.json", ".husky/x"],
    blockers: [{ category: "scope", claim: "c", evidence: "e", expected: "x" }],
    checks: [
      {
        id: "debugger",
        file: "a.ts",
        line: 1,
        text: "debugger;",
        message: "m",
        severity: "major",
        category: "convention",
      },
    ],
    sealed: [{ path: "a.test.ts", ok: false }],
  });
  const ids = g.reportFindings(report).map((f) => f.id);
  assert.equal(ids.length, 9);
  assert.equal(new Set(ids).size, ids.length);
});

test("the gate stage finds a committed debugger statement and an undeclared file", () => {
  const w = runWorktree();
  w.write("src/a.ts", "const x = 1;\ndebugger;\n");
  w.commit();
  const report = gateStage(w);
  assert.equal(report.passed, false);
  assert.deepEqual(report.undeclared, ["src/a.ts"]);
  assert.deepEqual(report.protected, []);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(
    report.checks.map((c) => [c.id, c.file, c.line]),
    [["debugger", "src/a.ts", 2]],
  );
  assert.deepEqual(
    report.gates.map((x) => [x.name, x.result]),
    [["true", "pass"]],
  );
});

test("the gate stage passes a declared, clean, committed change", () => {
  const w = runWorktree();
  w.write("src/a.ts", "const x = 1;\n");
  w.commit();
  const report = gateStage(w, { contractFiles: ["src/a.ts"] });
  assert.equal(report.passed, true);
  assert.deepEqual(g.reportFindings(report), []);
});

test("the gate stage finds committed protected paths with awkward names", () => {
  const w = runWorktree();
  w.write(".husky/pré-commit", "echo ok\n");
  w.write('.husky/odd"name', "echo ok\n");
  w.write(".mcp.json", "{}\n");
  w.write("src/a.ts", "1\n");
  w.write("src/café.ts", "debugger;\n");
  w.commit();
  const report = gateStage(w, { contractFiles: ["src/a.ts", "src/café.ts"] });
  assert.equal(report.passed, false);
  assert.deepEqual(
    report.checks.map((c) => [c.id, c.file]),
    [["debugger", "src/café.ts"]],
  );
  const protectedPaths = ['.husky/odd"name', ".husky/pré-commit", ".mcp.json"];
  assert.deepEqual(report.protected, protectedPaths);
  assert.deepEqual(report.undeclared, protectedPaths);
  assert.deepEqual(report.blockers, []);
  const blockers = g
    .reportFindings(report)
    .filter((f) => f.category === "scope" && f.severity === "blocker");
  assert.deepEqual(
    blockers.map((f) => f.file),
    protectedPaths,
  );
});

test("a path with a quote in its name is attributed to the right file by the check scan", () => {
  const w = runWorktree();
  w.write('src/a"b.test.ts', "it.only('x');\nconst y = 1;\n");
  w.commit();
  const report = gateStage(w, { contractFiles: ['src/a"b.test.ts'] });
  assert.deepEqual(
    report.checks.map((c) => [c.id, c.file, c.line, c.severity]),
    [["only", 'src/a"b.test.ts', 1, "blocker"]],
  );
  assert.deepEqual(report.blockers, []);
});

test("the gate stage runs oracles as gates, never re-runs one, and fails a changed sealed test", () => {
  const w = runWorktree();
  w.write("src/a.test.ts", "x\n");
  w.commit();
  const sealed = [
    {
      path: "src/a.test.ts",
      sha256: g.sha256File(join(w.path, "src/a.test.ts")),
      criteria: ["AC1"],
    },
  ];
  const flaky = "test -f .once || { touch .once; exit 1; }";
  const report = gateStage(w, {
    gates: [
      { name: "true", command: "true" },
      { name: "flaky", command: flaky },
    ],
    oracles: [
      { criterion: "AC1", command: "true", reason: null },
      { criterion: "AC2", command: "exit 1", reason: null },
      { criterion: "AC3", command: "test -f .twice || { touch .twice; exit 1; }", reason: null },
    ],
    sealed,
    contractFiles: [],
  });
  assert.deepEqual(
    report.gates.map((x) => [x.name, x.result]),
    [
      ["true", "pass"],
      ["flaky", "flaky"],
      ["oracle:AC1", "pass"],
      ["oracle:AC2", "fail"],
      ["oracle:AC3", "fail"],
    ],
  );
  assert.deepEqual(report.sealed, [{ path: "src/a.test.ts", ok: true }]);
  assert.equal(report.passed, false);
});

test("a criterion with no runnable oracle is a gate blocker that names the reason", () => {
  const w = runWorktree();
  const report = gateStage(w, {
    oracles: [
      { criterion: "AC1", command: "true", reason: null },
      { criterion: "AC2", command: null, reason: "no-single-test-command" },
    ],
  });
  assert.equal(report.passed, false);
  assert.deepEqual(claims(report), [
    "criterion AC2 has no runnable oracle: no-single-test-command",
  ]);
  assert.deepEqual(
    report.gates.map((x) => x.name),
    ["true", "oracle:AC1"],
  );
  assert.equal(g.reportFindings(report)[0].category, "gate");
});

test("a gate stage with a clean tree and a gate that leaves an untracked artefact still passes", () => {
  const w = runWorktree();
  w.write("src/a.ts", "const x = 1;\n");
  w.commit();
  const report = gateStage(w, {
    contractFiles: ["src/a.ts"],
    gates: [{ name: "build", command: "mkdir -p coverage && echo x > coverage/lcov.info" }],
  });
  assert.equal(report.passed, true, JSON.stringify(report));
});

test("the gate stage refuses inputs that would make it protect or compare against nothing", () => {
  const w = runWorktree();
  const bad = (over, message) => assert.throws(() => gateStage(w, over), message);
  bad({ protectedPatterns: [] }, /non-empty array/);
  bad({ protectedPatterns: [7] }, /only strings/);
  bad({ protectedPatterns: ["["] }, /regular expression|Invalid/i);
  bad({ baseSha: "dev" }, /40-hex/);
  bad({ baseSha: "0".repeat(40) }, /./);
  bad({ gitDir: "relative/.git" }, /absolute/);
  bad({ worktree: "relative" }, /absolute/);
  bad({ protectedBaseline: null }, /protectedBaseline/);
  bad({ protectedBaseline: { ".husky/x": 7 } }, /protectedBaseline/);
});

test("sealed and contract paths must be canonical repo-relative POSIX paths", () => {
  const w = runWorktree();
  const sealed = (path) => [{ path, sha256: "0".repeat(64), criteria: [] }];
  for (const path of [
    "./specs/a.test.mjs",
    "/abs/a.test.mjs",
    "src//a.test.mjs",
    "src/./a.test.mjs",
    "src/../a.test.mjs",
    "../a.test.mjs",
    "src\\a.test.mjs",
    "src/a.test.mjs/",
    "",
    "src/a\u0000b",
    "src/a\nb",
  ]) {
    assert.throws(
      () => gateStage(w, { sealed: sealed(path) }),
      /not canonical/,
      JSON.stringify(path),
    );
    assert.throws(
      () => gateStage(w, { contractFiles: [path] }),
      /not canonical/,
      JSON.stringify(path),
    );
  }
  assert.throws(() => gateStage(w, { contractFiles: [7] }), /not canonical/);
  const ok = gateStage(w, {
    sealed: sealed("src/a.test.mjs"),
    contractFiles: ["src/a.ts", ".husky/x"],
  });
  assert.deepEqual(ok.sealed, [{ path: "src/a.test.mjs", ok: false }]);
});

test("the stage reads the committed HEAD against the recorded base, not origin/<base>", () => {
  const w = runWorktree();
  w.write("src/a.ts", "debugger;\n");
  w.commit();
  sh(w.path, "update-ref", "refs/remotes/origin/dev", "HEAD");
  const report = gateStage(w);
  assert.deepEqual(
    report.checks.map((c) => c.id),
    ["debugger"],
  );
  assert.deepEqual(report.undeclared, ["src/a.ts"]);
});

test("a file marked -diff in a committed .gitattributes (a lockfile) is scanned, with no false parse blocker", () => {
  const w = runWorktree();
  w.write(".gitattributes", "package-lock.json -diff\n");
  w.write("package-lock.json", '{ "a": 1 }\ndebugger;\n');
  w.commit();
  const report = gateStage(w, { contractFiles: [".gitattributes", "package-lock.json"] });
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(
    report.checks.map((c) => [c.id, c.file, c.line]),
    [["debugger", "package-lock.json", 2]],
  );
});
