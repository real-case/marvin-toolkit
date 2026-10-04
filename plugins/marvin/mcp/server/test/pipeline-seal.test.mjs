import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importTs } from "./_tsload.mjs";

const s = await importTs("src/pipeline/seal.ts");
const g = await importTs("src/pipeline/gate.ts");
const hooks = fileURLToPath(new URL("../../../pipeline/hooks/", import.meta.url));
const PATTERN = "\\.(test|spec)\\.[cm]?[jt]sx?$";

const scratch = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix = "pipe-seal-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function worktreeWith(files) {
  const wt = tmp();
  for (const f of files) {
    mkdirSync(dirname(join(wt, f)), { recursive: true });
    writeFileSync(join(wt, f), `// ${f}`);
  }
  return wt;
}

const RED = { code: 1, output: "AssertionError: expected 1 to equal 2" };
const scripted =
  (by = {}, calls = []) =>
  (command, cwd, timeoutMs) => {
    calls.push({ command, cwd, timeoutMs });
    const hit = Object.keys(by).find((p) => command.includes(p));
    return { ms: 1, ...(hit === undefined ? RED : by[hit]) };
  };

const seal = (wt, tests, over = {}) =>
  s.sealAuthoredTests({
    worktree: wt,
    tests,
    testPathPattern: PATTERN,
    testOne: "npx vitest run {file}",
    run: scripted(),
    timeoutMs: 1000,
    ...over,
  });
const authored = (path, criteria = ["AC1"]) => ({ path, criteria });

// ── the brief's cases ───────────────────────────────────────────────────────

test("red tests are sealed with their hashes", () => {
  const wt = worktreeWith(["a.test.ts"]);
  const v = seal(wt, [authored("a.test.ts")], { run: scripted({ "a.test.ts": RED }) });
  assert.equal(v.ok, true);
  assert.deepEqual(v.reasons, []);
  assert.equal(v.sealed.length, 1);
  assert.equal(v.sealed[0].path, "a.test.ts");
  assert.deepEqual(v.sealed[0].criteria, ["AC1"]);
  assert.equal(
    v.sealed[0].sha256,
    createHash("sha256")
      .update(readFileSync(join(wt, "a.test.ts")))
      .digest("hex"),
  );
});

test("a test that passes before implementation proves nothing", () => {
  const wt = worktreeWith(["a.test.ts"]);
  const v = seal(wt, [authored("a.test.ts")], {
    run: scripted({ "a.test.ts": { code: 0, output: "" } }),
  });
  assert.equal(v.ok, false);
  assert.match(v.reasons[0], /passes before implementation/);
  assert.deepEqual(v.sealed, []);
});

test("non-test, absolute and escaping paths are rejected; an empty set is rejected", () => {
  const wt = worktreeWith(["src.ts"]);
  const calls = [];
  const v = seal(
    wt,
    [authored("src.ts", []), authored("/etc/a.test.ts", []), authored("../a.test.ts", [])],
    { run: scripted({}, calls) },
  );
  assert.equal(v.ok, false);
  assert.equal(v.reasons.length, 3);
  assert.deepEqual(calls, [], "no command runs for a path that failed validation");
  const empty = seal(wt, []);
  assert.equal(empty.ok, false);
  assert.match(empty.reasons[0], /no tests were authored/);
});

// ── formatTestOne ───────────────────────────────────────────────────────────

test("the single-test template must name the file, and the engine quotes the path", () => {
  assert.equal(s.formatTestOne("npx vitest run {file}", "a.test.ts"), "npx vitest run 'a.test.ts'");
  assert.equal(s.formatTestOne("a {file} b {file}", "x.test.ts"), "a 'x.test.ts' b 'x.test.ts'");
  assert.equal(s.formatTestOne("run --file={file}", "x.test.ts"), "run --file='x.test.ts'");
  assert.throws(() => s.formatTestOne("npx vitest run", "a.test.ts"), /must contain/);
});

test("only {file} is a placeholder of the seal stage", () => {
  for (const template of [
    "npx vitest run {path}",
    "npx vitest run {file} {path}",
    "npx vitest run {file} -t {name}",
    "npx vitest run {file} {ref}",
    "npx vitest run {name}",
    "npx vitest run {ref}",
  ]) {
    assert.throws(() => s.formatTestOne(template, "a.test.ts"), /must (not )?contain/, template);
  }
  assert.throws(() => s.formatTestOne("npx vitest run {file} -t {name}", "a.test.ts"), /\{name\}/);
});

test("a placeholder that is already quoted is refused; one beside a closed quote is not", () => {
  for (const template of [
    "npx vitest run '{file}'",
    'npx vitest run "{file}"',
    "sh -c 'vitest {file}'",
    `sh -c "vitest {file}"`,
    "vitest \\{file}",
    "echo 'a' '{file}'",
  ]) {
    assert.throws(() => s.formatTestOne(template, "a.test.ts"), /quote/, template);
  }
  assert.equal(
    s.formatTestOne("sh -c 'echo hi' x {file}", "a.test.ts"),
    "sh -c 'echo hi' x 'a.test.ts'",
  );
  assert.equal(
    s.formatTestOne("FOO='a b' npx vitest --reporter=\"dot\" {file}", "a.test.ts"),
    "FOO='a b' npx vitest --reporter=\"dot\" 'a.test.ts'",
  );
});

const NASTY = [
  "$(touch pwned).test.ts",
  "`touch pwned`.test.ts",
  "a b.test.ts",
  "(dashboard)/[id]/a.test.ts",
  "it's.test.ts",
  "'; touch pwned; '.test.ts",
  "a;touch pwned;.test.ts",
  "$&.test.ts",
  "$'.test.ts",
  "x$`y.test.ts",
  "$1$$.test.ts",
  "*.test.ts",
  "~/a.test.ts",
  "{file}.test.ts",
  "a\nb.test.ts",
  "ünï/ça.test.ts",
];

test("a hostile path reaches the shell as one literal argument", () => {
  const dir = tmp();
  for (const path of NASTY) {
    const command = s.formatTestOne("printf '<%s>' {file}", path);
    const plain = spawnSync("/bin/sh", ["-c", command], { cwd: dir, encoding: "utf8" });
    assert.equal(plain.stdout, `<${path}>`, JSON.stringify(path));
    const viaRunner = g.shellRunner(command, dir, 10000);
    assert.equal(viaRunner.code, 0, JSON.stringify(path));
    assert.equal(viaRunner.output, `<${path}>`, JSON.stringify(path));
    assert.equal(existsSync(join(dir, "pwned")), false, `${JSON.stringify(path)} ran a command`);
  }
});

// ── sealAuthoredTests: path validation ──────────────────────────────────────

test("a non-canonical path is a reason, never a throw", () => {
  const wt = worktreeWith(["a.test.ts"]);
  const calls = [];
  for (const path of [
    "",
    ".",
    "..",
    "./a.test.ts",
    "a//b.test.ts",
    "a/./b.test.ts",
    "a/../a.test.ts",
    "a/b/../../a.test.ts",
    "/abs/a.test.ts",
    "a\\b.test.ts",
    "a/b.test.ts/",
    "a\nb.test.ts",
    "a\0b.test.ts",
    "a\tb.test.ts",
    "a\u007fb.test.ts",
    null,
    undefined,
    7,
  ]) {
    const v = seal(wt, [authored(path)], { run: scripted({}, calls) });
    assert.equal(v.ok, false, JSON.stringify(path));
    assert.equal(v.reasons.length, 1, JSON.stringify(path));
    assert.match(v.reasons[0], /canonical/, JSON.stringify(path));
    assert.doesNotMatch(v.reasons[0], /\n./, "a path never injects a line into a reason");
  }
  assert.deepEqual(calls, []);
});

test("a path listed twice is refused", () => {
  const wt = worktreeWith(["a.test.ts"]);
  const v = seal(wt, [authored("a.test.ts"), authored("a.test.ts", ["AC2"])]);
  assert.equal(v.ok, false);
  assert.equal(v.reasons.length, 1);
  assert.match(v.reasons[0], /a\.test\.ts: listed more than once/);
});

test("the path must match the test pattern, and a bad pattern or template throws", () => {
  const wt = worktreeWith(["a.test.ts", "lib/helper.ts"]);
  const v = seal(wt, [authored("lib/helper.ts")]);
  assert.match(v.reasons[0], /lib\/helper\.ts: not a test path/);
  assert.throws(() => seal(wt, [authored("a.test.ts")], { testPathPattern: "(" }), /pattern/i);
  assert.throws(() => seal(wt, [authored("a.test.ts")], { testPathPattern: "" }), /pattern/i);
  assert.throws(() => seal(wt, [], { testOne: "npx vitest run" }), /must contain/);
  for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => seal(wt, [authored("a.test.ts")], { timeoutMs }), /timeout/i);
  }
  assert.throws(() => seal("relative/dir", [authored("a.test.ts")]), /absolute/);
});

test("the file must exist, be regular, and live inside the worktree", () => {
  const base = tmp();
  const wt = join(base, "wt");
  const outside = join(base, "outside");
  mkdirSync(join(wt, "src", "dir.test.ts"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(wt, "src", "real.test.ts"), "// real");
  writeFileSync(join(outside, "x.test.ts"), "// outside");
  symlinkSync("real.test.ts", join(wt, "src", "link.test.ts"));
  symlinkSync("../../outside/x.test.ts", join(wt, "src", "escape.test.ts"));
  symlinkSync("../outside", join(wt, "outdir"));
  symlinkSync("missing.test.ts", join(wt, "src", "dangling.test.ts"));
  const calls = [];
  const reasonFor = (path) => {
    const v = seal(wt, [authored(path)], { run: scripted({}, calls) });
    assert.equal(v.ok, false, path);
    assert.equal(v.reasons.length, 1, path);
    return v.reasons[0];
  };
  assert.match(reasonFor("src/missing.test.ts"), /does not exist/);
  assert.match(reasonFor("nodir/a.test.ts"), /does not exist/);
  assert.match(reasonFor("src/real.test.ts/child.test.ts"), /does not exist|cannot be inspected/);
  assert.match(reasonFor("src/dir.test.ts"), /directory/);
  assert.match(reasonFor("src/link.test.ts"), /symbolic link/);
  assert.match(reasonFor("src/escape.test.ts"), /symbolic link/);
  assert.match(reasonFor("src/dangling.test.ts"), /symbolic link/);
  assert.match(reasonFor("outdir/x.test.ts"), /outside the worktree/);
  assert.deepEqual(calls, []);
  assert.equal(seal(wt, [authored("src/real.test.ts")]).ok, true);
});

test("a worktree reached through an alias is the same worktree", () => {
  const base = tmp();
  const wt = join(base, "wt");
  mkdirSync(wt);
  writeFileSync(join(wt, "a.test.ts"), "// a");
  const alias = join(base, "alias");
  symlinkSync(wt, alias);
  assert.equal(seal(alias, [authored("a.test.ts")]).ok, true);
  assert.equal(seal(realpathSync(wt), [authored("a.test.ts")]).ok, true);
});

test("every test must map to a criterion", () => {
  const wt = worktreeWith(["a.test.ts"]);
  for (const criteria of [[], [""], ["  "], [1], undefined, "AC1", null]) {
    const v = seal(wt, [{ path: "a.test.ts", criteria }]);
    assert.equal(v.ok, false, JSON.stringify(criteria));
    assert.match(v.reasons[0], /a\.test\.ts: maps to no acceptance criterion/);
  }
});

// ── sealAuthoredTests: the red check ────────────────────────────────────────

test("the red check counts only a real failure", () => {
  const wt = worktreeWith(["a.test.ts"]);
  const verdict = (result) =>
    seal(wt, [authored("a.test.ts")], { run: () => ({ ms: 1, ...result }) });
  for (const result of [
    RED,
    { code: 2, output: "" },
    { code: 1, output: "FAIL a.test.ts > adds\nAssertionError" },
  ]) {
    assert.equal(verdict(result).ok, true, JSON.stringify(result));
  }
  for (const code of [124, 126, 127]) {
    const v = verdict({ code, output: "" });
    assert.equal(v.ok, false);
    assert.match(
      v.reasons[0],
      new RegExp(`a\\.test\\.ts: test command did not run \\(exit ${code}\\)`),
    );
  }
  const timedOut = verdict({ code: 1, output: "error: timed out after 5000ms\n" });
  assert.match(timedOut.reasons[0], /did not run \(exit 1\)/);
  for (const code of [Number.NaN, -1, 1.5, null, undefined, "1"]) {
    const v = verdict({ code, output: "AssertionError" });
    assert.equal(v.ok, false, String(code));
    assert.match(v.reasons[0], /did not run/);
  }
  const passing = verdict({ code: 0, output: "" });
  assert.match(
    passing.reasons[0],
    /a\.test\.ts: passes before implementation, so it proves nothing/,
  );
  const noTests = verdict({ code: 0, output: "No tests found" });
  assert.match(noTests.reasons[0], /passes before implementation/);
});

test("a runner that finds no test in the file does not count as red", () => {
  const wt = worktreeWith(["a.test.ts"]);
  for (const output of [
    "No test files found, exiting with code 1",
    "Error: No test found in suite a",
    "No tests found, exiting with code 1",
    "no tests found",
    "FAIL  Error: no test files found",
    "No tests found\n",
  ]) {
    const v = seal(wt, [authored("a.test.ts")], { run: () => ({ code: 1, output, ms: 1 }) });
    assert.equal(v.ok, false, output);
    assert.match(v.reasons[0], /a\.test\.ts: the runner found no test in it/, output);
  }
  for (const output of ["1 test failed", "testing: no testsuite"]) {
    assert.equal(
      seal(wt, [authored("a.test.ts")], { run: () => ({ code: 1, output, ms: 1 }) }).ok,
      true,
    );
  }
});

test("a runner that throws is a reason", () => {
  const wt = worktreeWith(["a.test.ts"]);
  const v = seal(wt, [authored("a.test.ts")], {
    run: () => {
      throw new Error("spawn failed");
    },
  });
  assert.equal(v.ok, false);
  assert.match(v.reasons[0], /a\.test\.ts: test command did not run \(spawn failed\)/);
});

test("the red check runs the quoted command in the worktree with the timeout", () => {
  const wt = worktreeWith(["a.test.ts", "dir (x)/b.test.ts"]);
  const calls = [];
  const v = seal(wt, [authored("a.test.ts"), authored("dir (x)/b.test.ts", ["AC2"])], {
    run: scripted({}, calls),
    timeoutMs: 4321,
  });
  assert.equal(v.ok, true);
  assert.deepEqual(calls, [
    { command: "npx vitest run 'a.test.ts'", cwd: wt, timeoutMs: 4321 },
    { command: "npx vitest run 'dir (x)/b.test.ts'", cwd: wt, timeoutMs: 4321 },
  ]);
  assert.deepEqual(
    v.sealed.map((x) => [x.path, x.criteria]),
    [
      ["a.test.ts", ["AC1"]],
      ["dir (x)/b.test.ts", ["AC2"]],
    ],
  );
});

test("one failing test seals nothing, and every reason is reported", () => {
  const wt = worktreeWith(["a.test.ts", "b.test.ts", "c.test.ts"]);
  const v = seal(wt, [authored("a.test.ts"), authored("b.test.ts"), authored("c.test.ts")], {
    run: scripted({
      "a.test.ts": RED,
      "b.test.ts": { code: 0, output: "" },
      "c.test.ts": { code: 127, output: "" },
    }),
  });
  assert.equal(v.ok, false);
  assert.deepEqual(v.sealed, []);
  assert.equal(v.reasons.length, 2);
  assert.match(v.reasons[0], /b\.test\.ts: passes before/);
  assert.match(v.reasons[1], /c\.test\.ts: test command did not run/);
});

test("a red run that changes a candidate is not what gets sealed", () => {
  const rewrite = worktreeWith(["a.test.ts"]);
  const rewrites = (command, cwd) => {
    writeFileSync(join(cwd, "a.test.ts"), "// rewritten to pass");
    return { code: 1, output: "", ms: 1 };
  };
  const v = seal(rewrite, [authored("a.test.ts")], { run: rewrites });
  assert.equal(v.ok, false);
  assert.match(v.reasons[0], /a\.test\.ts: changed while its red run executed/);

  const other = worktreeWith(["a.test.ts", "b.test.ts"]);
  const touchesNeighbour = (command, cwd) => {
    if (command.includes("'a.test.ts'")) writeFileSync(join(cwd, "b.test.ts"), "// tampered");
    return { code: 1, output: "", ms: 1 };
  };
  const w = seal(other, [authored("a.test.ts"), authored("b.test.ts")], { run: touchesNeighbour });
  assert.equal(w.ok, false);
  assert.equal(w.reasons.length, 1);
  assert.match(w.reasons[0], /b\.test\.ts: changed while/);
  assert.deepEqual(w.sealed, []);

  const swapped = worktreeWith(["a.test.ts", "real.ts"]);
  const swaps = (command, cwd) => {
    rmSync(join(cwd, "a.test.ts"));
    symlinkSync("real.ts", join(cwd, "a.test.ts"));
    writeFileSync(join(cwd, "real.ts"), "// a.test.ts");
    return { code: 1, output: "", ms: 1 };
  };
  const x = seal(swapped, [authored("a.test.ts")], { run: swaps });
  assert.equal(x.ok, false);
  assert.match(x.reasons[0], /a\.test\.ts: after its red run, it is a symbolic link/);
});

// ── writeSealManifest ───────────────────────────────────────────────────────

test("the manifest holds the sealed paths and nothing else", () => {
  const run = tmp();
  const sealed = [
    { path: "src/a.test.ts", sha256: "x", criteria: ["AC1"] },
    { path: "b.test.ts", sha256: "y", criteria: ["AC2"] },
  ];
  s.writeSealManifest(run, sealed);
  assert.equal(readFileSync(join(run, "sealed.json"), "utf8"), '["src/a.test.ts","b.test.ts"]\n');
  s.writeSealManifest(run, sealed.slice(0, 1));
  assert.deepEqual(JSON.parse(readFileSync(join(run, "sealed.json"), "utf8")), ["src/a.test.ts"]);
  assert.deepEqual(readdirSync(run), ["sealed.json"], "no temporary file is left behind");
});

test("a non-canonical path never reaches the manifest", () => {
  const run = tmp();
  for (const path of ["/abs/a.test.ts", "./a.test.ts", "a/../a.test.ts", "a\\b.test.ts", ""]) {
    assert.throws(
      () => s.writeSealManifest(run, [{ path, sha256: "x", criteria: [] }]),
      /not canonical/,
      path,
    );
  }
  assert.deepEqual(readdirSync(run), []);
});

// ── the guards ──────────────────────────────────────────────────────────────

const HOOK_ENV = ["MARVIN_PIPELINE_RUN", "MARVIN_PIPELINE_TEST_PATTERN", "CLAUDE_PROJECT_DIR"];

function hook(file, payload, env = {}) {
  const merged = { ...process.env };
  for (const key of HOOK_ENV) delete merged[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  const r = spawnSync(process.execPath, [join(hooks, file)], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    env: merged,
    encoding: "utf8",
  });
  return { status: r.status, stderr: r.stderr };
}

const caseInsensitive = (() => {
  const dir = tmp("pipe-case-");
  writeFileSync(join(dir, "Probe"), "");
  return existsSync(join(dir, "probe"));
})();

function sealedBox() {
  const base = realpathSync(tmp("pipe-sealed-"));
  const wt = join(base, "wt");
  const run = join(base, "run");
  mkdirSync(join(wt, "src", "deep"), { recursive: true });
  mkdirSync(run);
  writeFileSync(join(wt, "src", "a.test.ts"), "// sealed");
  writeFileSync(join(wt, "src", "a.ts"), "// impl");
  s.writeSealManifest(run, [{ path: "src/a.test.ts", sha256: "x", criteria: ["AC1"] }]);
  const edit = (tool_input, over = {}, tool_name = "Edit") =>
    hook(
      "sealed-guard.mjs",
      { tool_name, tool_input },
      { MARVIN_PIPELINE_RUN: run, CLAUDE_PROJECT_DIR: wt, ...over },
    );
  return { base, wt, run, edit, status: (file_path, over) => edit({ file_path }, over).status };
}

test("sealed-guard denies edits to sealed paths only", () => {
  const run = tmp();
  s.writeSealManifest(run, [{ path: "src/a.test.ts", sha256: "x", criteria: [] }]);
  const call = (file_path) =>
    hook(
      "sealed-guard.mjs",
      { tool_name: "Edit", tool_input: { file_path } },
      { MARVIN_PIPELINE_RUN: run, CLAUDE_PROJECT_DIR: "/wt" },
    ).status;
  assert.equal(call("/wt/src/a.test.ts"), 2);
  assert.equal(call("src/a.test.ts"), 2);
  assert.equal(call("/wt/src/a.ts"), 0);
});

test("sealed-guard resolves every spelling of a sealed path", () => {
  const { wt, status } = sealedBox();
  const sealed = join(wt, "src", "a.test.ts");
  for (const spelling of [
    sealed,
    "src/a.test.ts",
    "./src/a.test.ts",
    "src//a.test.ts",
    "src/x/../a.test.ts",
    "src/deep/../a.test.ts",
    `${wt}/src/deep/../a.test.ts`,
    `${wt}//src/./a.test.ts`,
  ]) {
    assert.equal(status(spelling), 2, spelling);
  }
  for (const other of [
    join(wt, "src", "a.ts"),
    "src/a.ts",
    "src/a.test.tsx",
    "src/deep/a.test.ts",
    "a.test.ts",
    join(wt, "src", "fresh.test.ts"),
  ]) {
    assert.equal(status(other), 0, other);
  }
});

test("sealed-guard reads `..` as the kernel does and as a lexical normaliser does", () => {
  const { wt, status } = sealedBox();
  mkdirSync(join(wt, "other", "inner"), { recursive: true });
  symlinkSync("../other", join(wt, "src", "toother"));
  symlinkSync("../../src/deep", join(wt, "other", "inner", "todeep"));
  assert.equal(status("src/toother/../a.test.ts"), 2, "lexically src/a.test.ts");
  assert.equal(status("other/inner/todeep/../a.test.ts"), 2, "by the kernel src/a.test.ts");
  assert.equal(status("src/toother/../a.ts"), 0);
  assert.equal(status("other/inner/todeep/../a.ts"), 0);
});

test("sealed-guard recognises the same file by identity, not spelling", () => {
  const { wt, status } = sealedBox();
  linkSync(join(wt, "src", "a.test.ts"), join(wt, "src", "hard.ts"));
  symlinkSync("a.test.ts", join(wt, "src", "soft.ts"));
  symlinkSync("src", join(wt, "srcalias"));
  symlinkSync(join(wt, "src", "a.test.ts"), join(wt, "abs-soft.ts"));
  symlinkSync("soft.ts", join(wt, "src", "chain.ts"));
  assert.equal(status("src/hard.ts"), 2, "a hard link to the sealed file");
  assert.equal(status("src/soft.ts"), 2, "a symlink to the sealed file");
  assert.equal(status(join(wt, "src", "soft.ts")), 2);
  assert.equal(status("abs-soft.ts"), 2, "an absolute symlink");
  assert.equal(status("src/chain.ts"), 2, "a chain of symlinks");
  assert.equal(status("srcalias/a.test.ts"), 2, "a symlinked directory");
  assert.equal(status(join(wt, "srcalias", "a.ts")), 0);
  assert.equal(status("src/a.ts"), 0);
});

test(
  "sealed-guard recognises an upper-cased alias on a case-insensitive volume",
  { skip: !caseInsensitive },
  () => {
    const { wt, status } = sealedBox();
    assert.equal(status("SRC/A.TEST.TS"), 2);
    assert.equal(status(join(wt, "Src", "a.TEST.ts")), 2);
    assert.equal(status("SRC/A.TS"), 0);
  },
);

test("sealed-guard compares by real path when the worktree is reached through an alias", () => {
  const { base, wt, run } = sealedBox();
  const alias = join(base, "wt-alias");
  symlinkSync(wt, alias);
  const status = (root, file_path) =>
    hook(
      "sealed-guard.mjs",
      { tool_name: "Write", tool_input: { file_path } },
      { MARVIN_PIPELINE_RUN: run, CLAUDE_PROJECT_DIR: root },
    ).status;
  assert.equal(status(alias, join(wt, "src", "a.test.ts")), 2);
  assert.equal(status(wt, join(alias, "src", "a.test.ts")), 2);
  assert.equal(status(alias, "src/a.test.ts"), 2);
  assert.equal(status(alias, join(alias, "src", "a.ts")), 0);
});

test("sealed-guard reads MultiEdit and NotebookEdit payloads", () => {
  const { wt, edit } = sealedBox();
  const sealed = join(wt, "src", "a.test.ts");
  assert.equal(edit({ file_path: sealed, edits: [] }, {}, "MultiEdit").status, 2);
  assert.equal(edit({ file_path: join(wt, "src", "a.ts"), edits: [] }, {}, "MultiEdit").status, 0);
  assert.equal(edit({ notebook_path: sealed }, {}, "NotebookEdit").status, 2);
  assert.equal(edit({ notebook_path: join(wt, "n.ipynb") }, {}, "NotebookEdit").status, 0);
  assert.equal(edit({ file_path: join(wt, "src", "a.ts"), notebook_path: sealed }).status, 2);
  assert.equal(edit({ file_path: sealed, notebook_path: join(wt, "n.ipynb") }).status, 2);
});

test("sealed-guard guards every path of a larger manifest and allows an empty one", () => {
  const { wt, run, status } = sealedBox();
  mkdirSync(join(wt, "pkg", "(dashboard)", "[id]"), { recursive: true });
  writeFileSync(join(wt, "pkg", "(dashboard)", "[id]", "p.test.tsx"), "// p");
  s.writeSealManifest(run, [
    { path: "src/a.test.ts", sha256: "x", criteria: [] },
    { path: "pkg/(dashboard)/[id]/p.test.tsx", sha256: "y", criteria: [] },
  ]);
  assert.equal(status("src/a.test.ts"), 2);
  assert.equal(status("pkg/(dashboard)/[id]/p.test.tsx"), 2);
  assert.equal(status(join(wt, "pkg", "(dashboard)", "[id]", "q.test.tsx")), 0);
  writeFileSync(join(run, "sealed.json"), "[]\n");
  assert.equal(status("src/a.test.ts"), 0, "nothing sealed, nothing to protect");
});

test("sealed-guard fails closed on every misconfiguration", () => {
  const { wt, run, edit, status } = sealedBox();
  const target = join(wt, "src", "a.ts");
  assert.equal(status(target), 0);
  assert.equal(status(target, { MARVIN_PIPELINE_RUN: undefined }), 2, "no run directory");
  assert.equal(status(target, { MARVIN_PIPELINE_RUN: "" }), 2);
  assert.equal(status(target, { MARVIN_PIPELINE_RUN: join(run, "nope") }), 2, "no manifest");
  assert.equal(status(target, { CLAUDE_PROJECT_DIR: undefined }), 2, "no worktree");
  assert.equal(status(target, { CLAUDE_PROJECT_DIR: "" }), 2);
  assert.equal(status(target, { CLAUDE_PROJECT_DIR: "wt" }), 2, "a relative worktree");
  for (const body of [
    "",
    "not json",
    "{",
    "{}",
    "null",
    '"src/a.test.ts"',
    '{"src/a.test.ts":true}',
    '["src/a.test.ts", 1]',
    '["src/a.test.ts", null]',
    '[""]',
    "[[]]",
  ]) {
    writeFileSync(join(run, "sealed.json"), body);
    assert.equal(status(target), 2, `manifest ${JSON.stringify(body)}`);
  }
  writeFileSync(join(run, "sealed.json"), '["src/a.test.ts"]');
  assert.equal(status(target), 0);
  assert.equal(edit({}).status, 2, "no path in the payload");
  assert.equal(edit({ file_path: "" }).status, 2);
  assert.equal(edit({ file_path: 7 }).status, 2);
  assert.equal(edit({ file_path: ["src/a.ts"] }).status, 2);
  assert.equal(edit({ file_path: target, notebook_path: 7 }).status, 2);
  assert.equal(edit({ file_path: `${target}\0x` }).status, 2, "a path the kernel cannot open");
  for (const payload of ["", "not json", "[]", "null", '"x"']) {
    const r = hook("sealed-guard.mjs", payload, {
      MARVIN_PIPELINE_RUN: run,
      CLAUDE_PROJECT_DIR: wt,
    });
    assert.equal(r.status, 2, `payload ${payload}`);
  }
  assert.equal(
    hook(
      "sealed-guard.mjs",
      { tool_name: "Edit" },
      { MARVIN_PIPELINE_RUN: run, CLAUDE_PROJECT_DIR: wt },
    ).status,
    2,
  );
});

test("sealed-guard denies with the pipeline contract and never mentions the kill switch", () => {
  const { wt, edit } = sealedBox();
  const denial = edit({ file_path: join(wt, "src", "a.test.ts") });
  assert.equal(denial.status, 2);
  assert.match(denial.stderr, /^marvin:pipeline:sealed-guard: BLOCKED - /);
  assert.match(denial.stderr, /src\/a\.test\.ts is a sealed acceptance test/);
  assert.match(denial.stderr, /needs_input/);
  assert.match(denial.stderr, /dispute/);
  assert.doesNotMatch(denial.stderr, /disable|MARVIN_HOOKS_DISABLED|hooks\.enabled/i);
  const broken = hook(
    "sealed-guard.mjs",
    { tool_name: "Edit", tool_input: { file_path: "x" } },
    { CLAUDE_PROJECT_DIR: wt },
  );
  assert.match(broken.stderr, /^marvin:pipeline:sealed-guard: BLOCKED - /);
  assert.doesNotMatch(broken.stderr, /disable|MARVIN_HOOKS_DISABLED|hooks\.enabled/i);
});

function authorBox() {
  const base = realpathSync(tmp("pipe-author-"));
  const wt = join(base, "wt");
  const outside = join(base, "outside");
  mkdirSync(join(wt, "src"), { recursive: true });
  mkdirSync(join(wt, "tests"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(wt, "src", "real.ts"), "// real");
  writeFileSync(join(outside, "x.test.ts"), "// outside");
  writeFileSync(join(outside, "x.ts"), "// outside");
  symlinkSync("../outside", join(wt, "outdir"));
  symlinkSync("../../outside/x.test.ts", join(wt, "src", "escape.test.ts"));
  symlinkSync("../../outside/missing.test.ts", join(wt, "src", "dangling.test.ts"));
  symlinkSync("real.ts", join(wt, "src", "disguised.test.ts"));
  symlinkSync("../src", join(wt, "tests", "srcdir"));
  mkdirSync(join(wt, "deep", "inner"), { recursive: true });
  symlinkSync("deep/inner", join(wt, "lnk"));
  symlinkSync("../../outside", join(wt, "tests", "lnkout"));
  const status = (file_path, over = {}, tool_name = "Write", extra = {}) =>
    hook(
      "test-path-guard.mjs",
      { tool_name, tool_input: { file_path, ...extra } },
      { MARVIN_PIPELINE_TEST_PATTERN: PATTERN, CLAUDE_PROJECT_DIR: wt, ...over },
    ).status;
  return { base, wt, outside, status };
}

test("test-path-guard lets the test-author write test files only", () => {
  const call = (file_path) =>
    hook(
      "test-path-guard.mjs",
      { tool_name: "Write", tool_input: { file_path } },
      { MARVIN_PIPELINE_TEST_PATTERN: PATTERN, CLAUDE_PROJECT_DIR: "/wt" },
    ).status;
  assert.equal(call("/wt/src/a.test.tsx"), 0);
  assert.equal(call("/wt/src/a.tsx"), 2);
});

test("test-path-guard judges the worktree-relative path", () => {
  const { wt, status } = authorBox();
  assert.equal(status(join(wt, "src", "a.test.ts")), 0);
  assert.equal(status("src/a.spec.mjs"), 0);
  assert.equal(status("src/a.ts"), 2);
  assert.equal(status("src/a.test.ts.bak"), 2);
  assert.equal(status("src/a.test.json"), 2);
  assert.equal(status(join(wt, "src", "fresh", "deep", "b.test.ts")), 0);
  const anchored = { MARVIN_PIPELINE_TEST_PATTERN: "^tests/.*\\.test\\.ts$" };
  assert.equal(status(join(wt, "tests", "a.test.ts"), anchored), 0);
  assert.equal(status(join(wt, "src", "tests", "a.test.ts"), anchored), 2);
  assert.equal(status("src/a.test.ts", anchored), 2);
});

test("test-path-guard denies a target outside the worktree", () => {
  const { base, wt, outside, status } = authorBox();
  assert.equal(status("../outside.test.ts"), 2);
  assert.equal(status("src/../../outside.test.ts"), 2);
  assert.equal(status(join(outside, "x.test.ts")), 2);
  assert.equal(status(join(base, "other.test.ts")), 2);
  assert.equal(status("/etc/a.test.ts"), 2);
  assert.equal(status(wt), 2);
  assert.equal(status(`${wt}/src/../../outside/x.test.ts`), 2);
  assert.equal(status(`${wt}/src/../../wt/src/a.test.ts`), 0, "back in through the front door");
  assert.equal(status("lnk/../../x.test.ts"), 2, "inside by the kernel, outside lexically");
  assert.equal(status("tests/lnkout/../b.test.ts"), 2, "outside by the kernel, inside lexically");
  assert.equal(status("lnk/../y.test.ts"), 0);
});

test("test-path-guard follows symlinks to where the write would land", () => {
  const { wt, status } = authorBox();
  assert.equal(status(join(wt, "outdir", "x.test.ts")), 2, "a symlinked directory out");
  assert.equal(status("outdir/new.test.ts"), 2);
  assert.equal(status(join(wt, "src", "escape.test.ts")), 2, "a symlinked file out");
  assert.equal(status("src/dangling.test.ts"), 2, "a dangling link out");
  assert.equal(status("src/disguised.test.ts"), 2, "a test-named link to a source file");
  assert.equal(status("tests/srcdir/real.ts"), 2, "a directory link inside the worktree");
  assert.equal(status("tests/srcdir/b.test.ts"), 0);
});

test("test-path-guard reads MultiEdit and NotebookEdit payloads", () => {
  const { wt, status } = authorBox();
  assert.equal(status(join(wt, "src", "a.test.ts"), {}, "MultiEdit", { edits: [] }), 0);
  assert.equal(status(join(wt, "src", "a.ts"), {}, "MultiEdit", { edits: [] }), 2);
  const notebook = (notebook_path, extra = {}) =>
    hook(
      "test-path-guard.mjs",
      { tool_name: "NotebookEdit", tool_input: { notebook_path, ...extra } },
      { MARVIN_PIPELINE_TEST_PATTERN: PATTERN, CLAUDE_PROJECT_DIR: wt },
    ).status;
  assert.equal(notebook(join(wt, "src", "a.test.js")), 0);
  assert.equal(notebook(join(wt, "src", "n.ipynb")), 2);
  assert.equal(notebook(join(wt, "src", "a.test.js"), { file_path: join(wt, "src", "a.ts") }), 2);
  assert.equal(notebook(join(wt, "src", "a.ts"), { file_path: join(wt, "src", "a.test.ts") }), 2);
});

test("test-path-guard fails closed on every misconfiguration", () => {
  const { wt, status } = authorBox();
  const target = join(wt, "src", "a.test.ts");
  assert.equal(status(target), 0);
  assert.equal(status(target, { MARVIN_PIPELINE_TEST_PATTERN: undefined }), 2, "no pattern");
  assert.equal(status(target, { MARVIN_PIPELINE_TEST_PATTERN: "" }), 2, "an empty pattern");
  assert.equal(status(target, { MARVIN_PIPELINE_TEST_PATTERN: "(" }), 2, "a pattern that fails");
  assert.equal(status(target, { MARVIN_PIPELINE_TEST_PATTERN: "[a-" }), 2);
  assert.equal(status(target, { CLAUDE_PROJECT_DIR: undefined }), 2, "no worktree");
  assert.equal(status(target, { CLAUDE_PROJECT_DIR: "" }), 2);
  assert.equal(status(target, { CLAUDE_PROJECT_DIR: "wt" }), 2, "a relative worktree");
  const call = (tool_input, env = {}) =>
    hook(
      "test-path-guard.mjs",
      { tool_name: "Write", tool_input },
      { MARVIN_PIPELINE_TEST_PATTERN: PATTERN, CLAUDE_PROJECT_DIR: wt, ...env },
    ).status;
  assert.equal(call({}), 2, "no path in the payload");
  assert.equal(call({ file_path: "" }), 2);
  assert.equal(call({ file_path: 7 }), 2);
  assert.equal(call({ file_path: [target] }), 2);
  assert.equal(call({ file_path: `${target}\0x` }), 2, "a path the kernel cannot open");
  for (const payload of ["", "not json", "[]", "null"]) {
    const r = hook("test-path-guard.mjs", payload, {
      MARVIN_PIPELINE_TEST_PATTERN: PATTERN,
      CLAUDE_PROJECT_DIR: wt,
    });
    assert.equal(r.status, 2, `payload ${payload}`);
  }
});

test("test-path-guard denies with the pipeline contract and never mentions the kill switch", () => {
  const { wt } = authorBox();
  const denial = hook(
    "test-path-guard.mjs",
    { tool_name: "Write", tool_input: { file_path: join(wt, "src", "real.ts") } },
    { MARVIN_PIPELINE_TEST_PATTERN: PATTERN, CLAUDE_PROJECT_DIR: wt },
  );
  assert.equal(denial.status, 2);
  assert.match(denial.stderr, /^marvin:pipeline:test-path-guard: BLOCKED - /);
  assert.match(denial.stderr, /test files only/);
  assert.match(denial.stderr, /src\/real\.ts/);
  assert.doesNotMatch(denial.stderr, /disable|MARVIN_HOOKS_DISABLED|hooks\.enabled/i);
});
