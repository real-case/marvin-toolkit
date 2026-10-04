import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { importTs } from "./_tsload.mjs";
import { repoWithOrigin, sh } from "./_pipeline-git.mjs";

const g = await importTs("src/pipeline/gate.ts");
const pipelineDir = fileURLToPath(new URL("../../../pipeline/", import.meta.url));
const { DEFAULT_PROTECTED } = await import(
  join(pipelineDir, "hooks", "worktree-boundary-guard.mjs")
);
const protectedDefaults = JSON.parse(
  readFileSync(join(pipelineDir, "protected.default.json"), "utf8"),
);
const defaultChecks = parseYaml(readFileSync(join(pipelineDir, "checks.default.yaml"), "utf8"));

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
  assert.deepEqual(g.protectedChanges([".husky/pre-commit"], []), []);
});

test("the gate stage's default protected list is the one the boundary hook enforces", () => {
  assert.deepEqual(protectedDefaults, DEFAULT_PROTECTED);
  assert.ok(protectedDefaults.length > 0);
});

test("the boundary hook denies every edit when the shared protected list is unusable", () => {
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
  for (const broken of ["[]", "{}", '["^ok", 7]', "not json", '["["]']) {
    writeFileSync(list, broken);
    const denied = edit("src/a.ts");
    assert.equal(denied.status, 2, broken);
    assert.match(denied.stderr, /BLOCKED/, broken);
  }
  rmSync(list);
  assert.equal(edit("src/a.ts").status, 2);
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

test("a report passes only when nothing blocks, and flaky becomes a minor finding", () => {
  const parts = {
    gates: [{ name: "test", result: "flaky", ms: 1, tail: "t" }],
    undeclared: [],
    protected: [],
    checks: [],
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
  const base = { gates: [], undeclared: [], protected: [], checks: [], sealed: [] };
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
  const report = g.buildReport({
    gates: [],
    undeclared: [],
    protected: [".husky/pre-commit"],
    checks: [],
    sealed: [],
  });
  assert.equal(report.passed, false);
  const findings = g.reportFindings(report);
  assert.equal(findings.length, 1);
  assert.deepEqual(
    [findings[0].severity, findings[0].category, findings[0].file, findings[0].claim],
    ["blocker", "scope", ".husky/pre-commit", ".husky/pre-commit is a protected path"],
  );
});

test("finding ids are unique across a report with every kind of finding", () => {
  const report = g.buildReport({
    gates: [
      { name: "test", result: "fail", ms: 1, tail: "t" },
      { name: "lint", result: "flaky", ms: 1, tail: "t" },
    ],
    undeclared: ["a.ts", "b.ts"],
    protected: [".mcp.json", ".husky/x"],
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
  assert.equal(ids.length, 8);
  assert.equal(new Set(ids).size, ids.length);
});

function branchWith(files) {
  const repo = repoWithOrigin();
  sh(repo, "checkout", "-b", "feature/x");
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), body);
  }
  sh(repo, "add", ".");
  sh(repo, "commit", "-m", "work");
  return repo;
}

const stage = (repo, over = {}) =>
  g.runGateStage({
    worktree: repo,
    base: "dev",
    gates: [{ name: "true", command: "true" }],
    oracles: [],
    contractFiles: [],
    sealed: [],
    checks: defaultChecks,
    exemptPattern: null,
    protectedPatterns: protectedDefaults,
    run: g.shellRunner,
    timeoutMs: 10_000,
    ...over,
  });

test("the gate stage finds a debugger statement and an undeclared file on a real branch", () => {
  const repo = branchWith({ "src/a.ts": "const x = 1;\ndebugger;\n" });
  const report = stage(repo);
  assert.equal(report.passed, false);
  assert.deepEqual(report.undeclared, ["src/a.ts"]);
  assert.deepEqual(report.protected, []);
  assert.deepEqual(
    report.checks.map((c) => [c.id, c.file, c.line]),
    [["debugger", "src/a.ts", 2]],
  );
  assert.deepEqual(
    report.gates.map((x) => [x.name, x.result]),
    [["true", "pass"]],
  );
});

test("the gate stage passes a declared, clean change", () => {
  const repo = branchWith({ "src/a.ts": "const x = 1;\n" });
  const report = stage(repo, { contractFiles: ["src/a.ts"] });
  assert.equal(report.passed, true);
  assert.deepEqual(g.reportFindings(report), []);
});

test("the gate stage sees untracked files, protected paths and awkward names", () => {
  const repo = branchWith({
    ".husky/pré-commit": "echo ok\n",
    '.husky/odd"name': "echo ok\n",
    "src/a.ts": "1\n",
    "src/café.ts": "debugger;\n",
  });
  writeFileSync(join(repo, ".mcp.json"), "{}\n");
  const report = stage(repo, { contractFiles: ["src/a.ts", "src/café.ts"] });
  assert.equal(report.passed, false);
  assert.deepEqual(
    report.checks.map((c) => [c.id, c.file]),
    [["debugger", "src/café.ts"]],
  );
  const protectedPaths = ['.husky/odd"name', ".husky/pré-commit", ".mcp.json"];
  assert.deepEqual([...report.protected].sort(), protectedPaths);
  assert.deepEqual([...report.undeclared].sort(), protectedPaths);
  const blockers = g
    .reportFindings(report)
    .filter((f) => f.category === "scope" && f.severity === "blocker");
  assert.deepEqual(blockers.map((f) => f.file).sort(), protectedPaths);
});

test("the gate stage runs oracle commands as gates and fails on a sealed test edit", () => {
  const repo = branchWith({ "src/a.test.ts": "x\n" });
  const sealed = [
    { path: "src/a.test.ts", sha256: g.sha256File(join(repo, "src/a.test.ts")), criteria: ["AC1"] },
  ];
  writeFileSync(join(repo, "src/a.test.ts"), "y\n");
  const report = stage(repo, {
    oracles: [
      { criterion: "AC1", command: "true" },
      { criterion: "AC2", command: "exit 1" },
    ],
    sealed,
    contractFiles: [],
  });
  assert.deepEqual(
    report.gates.map((x) => [x.name, x.result]),
    [
      ["true", "pass"],
      ["oracle:AC1", "pass"],
      ["oracle:AC2", "fail"],
    ],
  );
  assert.deepEqual(report.sealed, [{ path: "src/a.test.ts", ok: false }]);
  assert.equal(report.passed, false);
});
