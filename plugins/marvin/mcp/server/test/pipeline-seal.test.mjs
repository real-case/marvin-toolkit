import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
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

function git(dir, ...args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  const r = spawnSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args],
    { cwd: dir, env, encoding: "utf8" },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function gitInit(dir) {
  const r = git(dir, "init", "-q");
  assert.equal(r.status, 0, r.stderr);
  for (const [key, value] of [
    ["core.autocrlf", "false"],
    ["core.safecrlf", "false"],
  ]) {
    assert.equal(git(dir, "config", key, value).status, 0);
  }
}

/** What the gate does with a sealed path: read its blob at HEAD. Null when git cannot find it. */
function committedBlob(dir, path) {
  const r = git(dir, "cat-file", "blob", `HEAD:${path}`);
  return r.status === 0 ? r.stdout : null;
}

const NFC = "caf\u00e9";
const NFD = "cafe\u0301";
const LISTED = "not listed by git under this exact spelling";

function worktreeWith(files) {
  const wt = tmp();
  gitInit(wt);
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

test("a template in which {file} is not one shell word is refused", () => {
  for (const template of [
    "cat <<EOF\n{file}\nEOF",
    "cat <<'EOF' >/dev/null\n{file}\nEOF",
    "npx vitest run # {file}",
    "npx vitest run {file} # all of them",
    "echo `{file}`",
    "echo $({file})",
    "echo $(echo {file})",
    "npx vitest run\nnpx vitest run {file}",
    "npx vitest run {file}\r",
  ]) {
    assert.throws(
      () => s.formatTestOne(template, "a.test.ts"),
      /backtick|must not contain/,
      template,
    );
  }
  const probe = join(tmp(), "pwned");
  assert.throws(() => s.formatTestOne(`cat <<EOF\n{file}\nEOF`, `$(touch ${probe}).test.ts`));
  assert.equal(existsSync(probe), false);
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
  gitInit(wt);
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
  gitInit(wt);
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

test("a path segment starting with a dash would be read as a runner option", () => {
  const wt = worktreeWith([
    "--foo.test.mjs",
    "dir/-x.test.ts",
    "-d/a.test.ts",
    "ok-dir/a-b.test.ts",
  ]);
  const calls = [];
  for (const path of ["--foo.test.mjs", "dir/-x.test.ts", "-d/a.test.ts"]) {
    const v = seal(wt, [authored(path)], { run: scripted({}, calls) });
    assert.equal(v.ok, false, path);
    assert.equal(v.reasons.length, 1, path);
    assert.equal(
      v.reasons[0],
      `${path}: a path segment starting with "-" would be read as a runner option`,
    );
  }
  assert.deepEqual(calls, [], "the runner never sees the path");
  assert.equal(seal(wt, [authored("ok-dir/a-b.test.ts")]).ok, true);
});

test("a vacuous test hidden behind a leading dash is not sealed by a real runner", () => {
  const wt = tmp();
  gitInit(wt);
  writeFileSync(
    join(wt, "--foo.test.mjs"),
    'import { test } from "node:test";\ntest("vacuous", () => {});\n',
  );
  const v = seal(wt, [authored("--foo.test.mjs")], {
    testOne: "node --test {file}",
    run: g.shellRunner,
    timeoutMs: 20000,
  });
  assert.equal(v.ok, false);
  assert.deepEqual(v.sealed, []);
  assert.match(v.reasons[0], /starting with "-"/);
});

test("the single-test command must not be able to select another test file", () => {
  const calls = [];
  const wt = worktreeWith([
    "a.test.ts",
    "ba.test.ts",
    "src/c.test.ts",
    "lib/src/c.test.ts",
    "d.test.ts",
    "d.test.tsx",
    "e.test.ts",
    "e.test.ts.bak",
    "f.test.ts",
    "g.test.ts",
  ]);
  const one = (path, tests = [authored(path)]) => seal(wt, tests, { run: scripted({}, calls) });
  assert.deepEqual(one("a.test.ts").reasons, [
    "a.test.ts: the single-test command may also select ba.test.ts",
  ]);
  assert.deepEqual(one("src/c.test.ts").reasons, [
    "src/c.test.ts: the single-test command may also select lib/src/c.test.ts",
  ]);
  assert.match(one("d.test.ts").reasons[0], /d\.test\.ts: .* may also select d\.test\.tsx/);
  assert.deepEqual(calls, [], "no test runs while another file could be selected with it");
  assert.equal(one("e.test.ts").ok, true, "a file that is not a test path cannot be selected");
  assert.equal(one("f.test.ts").ok, true);
  assert.equal(one("lib/src/c.test.ts").ok, true, "the longer path is the one nothing contains");
  const both = one("a.test.ts", [authored("a.test.ts"), authored("ba.test.ts", ["AC2"])]);
  assert.equal(both.ok, false);
  assert.equal(both.reasons.length, 1, "only the contained path is refused");
  assert.match(both.reasons[0], /^a\.test\.ts: .* may also select ba\.test\.ts$/);
});

test("a file a red run creates is counted when the runs are over", () => {
  const wt = worktreeWith(["a.test.ts"]);
  const creates = (command, cwd) => {
    writeFileSync(join(cwd, "ba.test.ts"), "// appeared during the run");
    return { code: 1, output: "AssertionError", ms: 1 };
  };
  const v = seal(wt, [authored("a.test.ts")], { run: creates });
  assert.equal(v.ok, false);
  assert.deepEqual(v.sealed, []);
  assert.equal(
    v.reasons[0],
    "a.test.ts: after the red runs, the single-test command may also select ba.test.ts",
  );
});

const SELECTS = (path, other) => `${path}: the single-test command may also select ${other}`;

/** A worktree holding `files`, then `extra`, which may add what git does not list. */
function boxWith(files, extra = () => {}) {
  const wt = worktreeWith(files);
  extra(wt);
  return wt;
}
const put = (wt, rel, body = "// x") => {
  mkdirSync(dirname(join(wt, rel)), { recursive: true });
  writeFileSync(join(wt, rel), body);
};

test("a sibling the runner would glob is counted whether or not git lists it", () => {
  const verdict = (extra) =>
    seal(
      boxWith(["a.test.ts", ".gitignore"], (wt) => {
        writeFileSync(join(wt, ".gitignore"), "coverage/\nignored/\n");
        extra(wt);
      }),
      [authored("a.test.ts")],
    );
  assert.equal(verdict(() => {}).ok, true, "control: nothing beside it");
  assert.deepEqual(verdict((wt) => put(wt, "coverage/xa.test.ts")).reasons, [
    SELECTS("a.test.ts", "coverage/xa.test.ts"),
  ]);
  assert.deepEqual(verdict((wt) => put(wt, "ignored/ba.test.ts")).reasons, [
    SELECTS("a.test.ts", "ignored/ba.test.ts"),
  ]);
  assert.deepEqual(verdict((wt) => put(wt, "xa.test.ts")).reasons, [
    SELECTS("a.test.ts", "xa.test.ts"),
  ]);
  assert.equal(verdict((wt) => put(wt, "coverage/zzz.test.ts")).ok, true, "an unrelated sibling");
});

test("a failing test inside a nested repository can still be selected", () => {
  const nested = (wt) => {
    mkdirSync(join(wt, "vendor"));
    gitInit(join(wt, "vendor"));
    put(wt, "vendor/xa.test.ts");
    put(wt, "vendor/deep/xb.test.ts");
  };
  const wt = boxWith(["a.test.ts", "b.test.ts"], nested);
  assert.deepEqual(seal(wt, [authored("a.test.ts")]).reasons, [
    SELECTS("a.test.ts", "vendor/xa.test.ts"),
  ]);
  assert.deepEqual(seal(wt, [authored("b.test.ts")]).reasons, [
    SELECTS("b.test.ts", "vendor/deep/xb.test.ts"),
  ]);
  assert.equal(seal(worktreeWith(["a.test.ts"]), [authored("a.test.ts")]).ok, true, "control");
});

test("only .git entries and node_modules directories are not searched for siblings", () => {
  const wt = boxWith(["a.test.ts", "x.test.js"], (w) => {
    put(w, "node_modules/x.test.js");
    put(w, "pkg/node_modules/deep/xa.test.ts");
    put(w, ".git/hooks/xa.test.ts");
    put(w, "vendor/.git", "gitdir: ../elsewhere");
    put(w, "vendor/inner/.git/hooks/xa.test.ts");
    put(w, "vendor/inner/.git/objects/xb.test.ts");
    put(w, "vendor/node_modules/xa.test.ts");
  });
  assert.equal(seal(wt, [authored("a.test.ts")]).ok, true);
  assert.equal(seal(wt, [authored("x.test.js")]).ok, true);
  put(wt, "src/node_modules_x/xa.test.ts");
  assert.equal(seal(wt, [authored("a.test.ts")]).ok, false, "a directory merely named like it");
  const dotDir = boxWith(["a.test.ts"], (w) => put(w, ".hidden/xa.test.ts"));
  assert.deepEqual(seal(dotDir, [authored("a.test.ts")]).reasons, [
    SELECTS("a.test.ts", ".hidden/xa.test.ts"),
  ]);
});

test("a candidate that jest would read as a regular expression is refused beside a match", () => {
  const cases = [
    ["a.b.test.js", "a_b.test.js"],
    ["[id]/p.test.js", "i/p.test.js"],
    ["a+b.test.js", "aab.test.js"],
    ["x(y).test.js", "xy.test.js"],
    ["a|b.test.js", "b.test.js"],
  ];
  for (const [candidate, sibling] of cases) {
    const alone = seal(worktreeWith([candidate]), [authored(candidate)]);
    assert.equal(alone.ok, true, `${candidate} alone: ${alone.reasons.join("; ")}`);
    const v = seal(worktreeWith([candidate, sibling]), [authored(candidate)]);
    assert.deepEqual(v.reasons, [SELECTS(candidate, sibling)], candidate);
    const unrelated = seal(worktreeWith([candidate, "zzz.test.js"]), [authored(candidate)]);
    assert.equal(unrelated.ok, true, `${candidate} beside an unrelated file`);
  }
});

test("a candidate that is not a regular expression matches every sibling", () => {
  for (const candidate of ["a(b.test.js", "a[b.test.js", "(?<.test.js", "a{2,1}.test.js"]) {
    const alone = seal(worktreeWith([candidate]), [authored(candidate)]);
    assert.equal(alone.ok, true, `${candidate} alone: ${alone.reasons.join("; ")}`);
    const v = seal(worktreeWith([candidate, "zzz.test.js"]), [authored(candidate)]);
    assert.deepEqual(v.reasons, [SELECTS(candidate, "zzz.test.js")], candidate);
  }
});

test("a candidate that node --test would read as a glob is refused beside a match", () => {
  const cases = [
    ["[id]/p.test.mjs", "i/p.test.mjs"],
    ["a*.test.mjs", "abc.test.mjs"],
    ["a*.test.mjs", "a/b/c.test.mjs"],
    ["a?.test.mjs", "ab.test.mjs"],
    ["x{a,b}.test.mjs", "xa.test.mjs"],
    ["d*/x{a,b}.test.mjs", "d1/2/xa.test.mjs"],
    ["x{a,b}.test.mjs", "xb.test.mjs"],
    ["r[!a].test.mjs", "rb.test.mjs"],
    ["r[a-c].test.mjs", "rb.test.mjs"],
  ];
  for (const [candidate, sibling] of cases) {
    const alone = seal(worktreeWith([candidate]), [authored(candidate)]);
    assert.equal(alone.ok, true, `${candidate} alone: ${alone.reasons.join("; ")}`);
    const v = seal(worktreeWith([candidate, sibling]), [authored(candidate)]);
    assert.deepEqual(v.reasons, [SELECTS(candidate, sibling)], `${candidate} beside ${sibling}`);
  }
  for (const candidate of [
    "+(a|b).test.mjs",
    "@(a).test.mjs",
    "!(a).test.mjs",
    "?(a).test.mjs",
    "*(a).test.mjs",
    "[[:alpha:]].test.mjs",
    "x{1..3}.test.mjs",
  ]) {
    const v = seal(worktreeWith([candidate, "zzz.test.mjs"]), [authored(candidate)]);
    assert.deepEqual(
      v.reasons,
      [SELECTS(candidate, "zzz.test.mjs")],
      `${candidate} (not modelled, so it matches all)`,
    );
  }
});

test("a path with plain punctuation is not mistaken for a pattern that selects its neighbours", () => {
  const files = [
    "src/app/(dashboard)/projects/p.test.tsx",
    "src/app/(dashboard)/projects/q.test.tsx",
    "src/app/(dashboard)/[id]/page.test.tsx",
    "src/app/(auth)/login.test.tsx",
  ];
  const wt = worktreeWith(files);
  for (const f of files) {
    const v = seal(wt, [authored(f)]);
    assert.deepEqual(
      v.reasons.filter((r) => /may also select/.test(r)),
      [],
      f,
    );
  }
});

test("the built-in test shapes count as siblings even when the pattern is narrower", () => {
  const narrow = { testPathPattern: "\\.test\\.ts$" };
  const spec = boxWith(["a.test.ts"], (wt) => put(wt, "xa.test.tsx"));
  assert.deepEqual(seal(spec, [authored("a.test.ts")], narrow).reasons, [
    SELECTS("a.test.ts", "xa.test.tsx"),
  ]);
  const specShape = boxWith(["a.spec.ts"], (wt) => put(wt, "xa.spec.tsx"));
  assert.deepEqual(
    seal(specShape, [authored("a.spec.ts")], { testPathPattern: "\\.spec\\.ts$" }).reasons,
    [SELECTS("a.spec.ts", "xa.spec.tsx")],
  );
  const underscores = boxWith(["a.test.ts"], (wt) => put(wt, "src/__tests__/a.test.ts.snap"));
  assert.deepEqual(seal(underscores, [authored("a.test.ts")], narrow).reasons, [
    SELECTS("a.test.ts", "src/__tests__/a.test.ts.snap"),
  ]);
  const top = boxWith(["a.test.ts"], (wt) => put(wt, "__tests__/helper-a.test.ts.txt"));
  assert.deepEqual(seal(top, [authored("a.test.ts")], narrow).reasons, [
    SELECTS("a.test.ts", "__tests__/helper-a.test.ts.txt"),
  ]);
  const plain = boxWith(["a.test.ts"], (wt) => put(wt, "src/a.test.ts.snap"));
  assert.equal(seal(plain, [authored("a.test.ts")], narrow).ok, true, "a snapshot is not a test");
});

test("the file itself is not its own sibling, whatever name the disk gives it", () => {
  const wt = worktreeWith(["a.test.ts"]);
  linkSync(join(wt, "a.test.ts"), join(wt, "hard.ts"));
  assert.equal(seal(wt, [authored("a.test.ts")]).ok, true);
  const other = tmp();
  gitInit(other);
  writeFileSync(join(other, `${NFD}.test.ts`), "// decomposed on disk");
  const listed = git(other, "ls-files", "-z", "--others", "--exclude-standard").stdout.split(
    "\0",
  )[0];
  const v = seal(other, [authored(listed)]);
  assert.equal(v.ok, true, v.reasons.join("; "));
});

test(
  "a directory the worktree walk cannot read is a reason, not a quiet pass",
  {
    skip: typeof process.getuid === "function" && process.getuid() === 0,
  },
  () => {
    const wt = worktreeWith(["a.test.ts"]);
    mkdirSync(join(wt, "locked"));
    chmodSync(join(wt, "locked"), 0);
    try {
      const v = seal(wt, [authored("a.test.ts")]);
      assert.equal(v.ok, false);
      assert.match(
        v.reasons[0],
        /^a\.test\.ts: cannot tell what the single-test command may also select \(.*locked/,
      );
    } finally {
      chmodSync(join(wt, "locked"), 0o755);
    }
  },
);

test("a sibling a red run plants where git does not look is counted when the runs are over", () => {
  const wt = worktreeWith(["a.test.ts", ".gitignore"]);
  writeFileSync(join(wt, ".gitignore"), "coverage/\n");
  const plants = (command, cwd) => {
    put(cwd, "coverage/xa.test.ts");
    return { code: 1, output: "AssertionError", ms: 1 };
  };
  const v = seal(wt, [authored("a.test.ts")], { run: plants });
  assert.equal(v.ok, false);
  assert.deepEqual(v.sealed, []);
  assert.equal(
    v.reasons[0],
    "a.test.ts: after the red runs, the single-test command may also select coverage/xa.test.ts",
  );
});

test("the content git would commit is the content that gets sealed", () => {
  const wt = worktreeWith([".gitattributes"]);
  writeFileSync(join(wt, ".gitattributes"), "* text=auto\n");
  const body =
    'import { test } from "node:test";\r\ntest("x", () => { throw new Error("red"); });\r\n';
  writeFileSync(join(wt, "a.test.mjs"), body);
  writeFileSync(join(wt, "b.test.mjs"), body.replaceAll("\r\n", "\n"));
  const crlf = seal(wt, [authored("a.test.mjs")]);
  assert.equal(crlf.ok, false);
  assert.deepEqual(crlf.reasons, [
    "a.test.mjs: git would rewrite this file on commit (eol/filter attributes); write it in its committed form",
  ]);
  const lf = seal(wt, [authored("b.test.mjs")]);
  assert.equal(lf.ok, true, lf.reasons.join("; "));
  git(wt, "add", "-A");
  assert.equal(git(wt, "commit", "-qm", "tests").status, 0);
  assert.equal(
    createHash("sha256").update(committedBlob(wt, "b.test.mjs")).digest("hex"),
    lf.sealed[0].sha256,
    "the gate's blob is what was sealed",
  );
  assert.notEqual(
    createHash("sha256").update(committedBlob(wt, "a.test.mjs")).digest("hex"),
    createHash("sha256").update(body).digest("hex"),
    "the reproducer is real: the committed CRLF file differs from the disk bytes",
  );
});

test("a conversion git fails on is a rewrite too", () => {
  const wt = worktreeWith(["a.test.mjs", ".gitattributes"]);
  writeFileSync(join(wt, ".gitattributes"), "a.test.mjs filter=broken\n");
  git(wt, "config", "filter.broken.clean", "false");
  git(wt, "config", "filter.broken.required", "true");
  const probe = git(wt, "hash-object", "--path=a.test.mjs", "--", "a.test.mjs");
  assert.notEqual(probe.status, 0, "the setup makes git fail on the file");
  assert.deepEqual(seal(wt, [authored("a.test.mjs")]).reasons, [
    "a.test.mjs: git would rewrite this file on commit (eol/filter attributes); write it in its committed form",
  ]);
});

test("a clean filter on a path is a rewrite too, and a file with no attributes is not", () => {
  const wt = worktreeWith(["a.test.ts", "b.test.ts", ".gitattributes"]);
  writeFileSync(join(wt, ".gitattributes"), "b.test.ts filter=shout\n");
  git(wt, "config", "filter.shout.clean", "tr a-z A-Z");
  assert.equal(seal(wt, [authored("a.test.ts")]).ok, true);
  assert.match(
    seal(wt, [authored("b.test.ts")]).reasons[0],
    /^b\.test\.ts: git would rewrite this file on commit/,
  );
});

test("a red run that adds an eol attribute is refused when the runs are over", () => {
  const wt = worktreeWith(["a.test.mjs"]);
  writeFileSync(join(wt, "a.test.mjs"), "// crlf\r\n");
  const attributes = (command, cwd) => {
    writeFileSync(join(cwd, ".gitattributes"), "* text=auto eol=lf\n");
    return { code: 1, output: "AssertionError", ms: 1 };
  };
  const v = seal(wt, [authored("a.test.mjs")], { run: attributes });
  assert.equal(v.ok, false);
  assert.match(
    v.reasons[0],
    /^a\.test\.mjs: after the red runs, git would rewrite this file on commit/,
  );
});

test("a path git does not list is refused, whatever the file system says", () => {
  const calls = [];
  const wt = worktreeWith(["a.test.ts", "ignored/b.test.ts", "forced/c.test.ts", "sub/keep.txt"]);
  writeFileSync(join(wt, ".gitignore"), "ignored/\nforced/\n");
  git(wt, "add", "-f", "forced/c.test.ts");
  gitInit(join(wt, "sub"));
  writeFileSync(join(wt, "sub", "d.test.ts"), "// inside a nested repository");
  const one = (path) => seal(wt, [authored(path)], { run: scripted({}, calls) });
  assert.deepEqual(one("ignored/b.test.ts").reasons, [`ignored/b.test.ts: ${LISTED}`]);
  assert.deepEqual(one("sub/d.test.ts").reasons, [`sub/d.test.ts: ${LISTED}`]);
  assert.deepEqual(calls, [], "nothing runs for a file the gate could never find");
  assert.equal(one("forced/c.test.ts").ok, true, "a tracked file is listed even if it is ignored");
  assert.equal(one("a.test.ts").ok, true);
});

test("a case-variant spelling is not the spelling git lists", () => {
  const wt = worktreeWith(["Foo.test.ts", "src/Bar.test.ts"]);
  for (const variant of ["foo.test.ts", "FOO.test.ts", "SRC/Bar.test.ts", "src/bar.test.ts"]) {
    const v = seal(wt, [authored(variant)]);
    assert.equal(v.ok, false, variant);
    assert.match(
      v.reasons[0],
      new RegExp(`^${variant.replace(".", "\\.")}: (${LISTED}|does not exist)$`),
    );
  }
  assert.equal(seal(wt, [authored("Foo.test.ts")]).ok, true);
  assert.equal(seal(wt, [authored("src/Bar.test.ts")], { run: scripted({}) }).ok, true);
});

test("seal and git agree on one spelling of a name that has two Unicode forms", () => {
  const wt = tmp();
  gitInit(wt);
  writeFileSync(join(wt, `${NFD}.test.ts`), "// created decomposed");
  const listed = git(wt, "ls-files", "-z", "--others", "--exclude-standard").stdout.split("\0")[0];
  assert.ok(listed === `${NFC}.test.ts` || listed === `${NFD}.test.ts`, "git lists one of the two");
  const other = listed === `${NFC}.test.ts` ? `${NFD}.test.ts` : `${NFC}.test.ts`;
  const refused = seal(wt, [authored(other)]);
  assert.equal(refused.ok, false, "the spelling git does not list");
  assert.match(refused.reasons[0], new RegExp(`: (${LISTED}|does not exist)$`));
  const accepted = seal(wt, [authored(listed)]);
  assert.equal(accepted.ok, true, accepted.reasons.join("; "));
  git(wt, "add", "-A");
  assert.equal(git(wt, "commit", "-qm", "tests").status, 0);
  assert.equal(committedBlob(wt, accepted.sealed[0].path), "// created decomposed");
});

test("a sibling that differs only in case or Unicode form is still a file the filter may select", () => {
  const wt = worktreeWith(["a.test.ts", "xA.test.ts", `${NFC}.test.ts`]);
  git(wt, "config", "core.precomposeunicode", "false");
  writeFileSync(join(wt, `x${NFD}.test.ts`), "// decomposed sibling");
  assert.ok(
    git(wt, "ls-files", "-z", "--others", "--exclude-standard").stdout.includes(`x${NFD}.test.ts`),
    "git lists the sibling decomposed, as it is on disk",
  );
  const case_ = seal(wt, [authored("a.test.ts")]);
  assert.match(
    case_.reasons[0],
    /^a\.test\.ts: the single-test command may also select xA\.test\.ts$/,
  );
  const form = seal(wt, [authored(`${NFC}.test.ts`)]);
  assert.equal(form.ok, false);
  assert.match(form.reasons[0], /may also select x.*\.test\.ts$/);
});

test("every sealed path is one the gate finds as a committed blob", () => {
  const paths = [
    "a.test.ts",
    "dir (x)/[id]/b.spec.mjs",
    "it's here.test.ts",
    "ünï/çx.test.ts",
    `${NFC}-nfc.test.ts`,
    "日本語/テスト.test.ts",
    "emoji-\u{1F600}.test.ts",
  ];
  const wt = worktreeWith(paths);
  const v = seal(
    wt,
    paths.map((p) => authored(p)),
  );
  assert.equal(v.ok, true, v.reasons.join("; "));
  git(wt, "add", "-A");
  assert.equal(git(wt, "commit", "-qm", "tests").status, 0);
  for (const s of v.sealed) {
    const blob = committedBlob(wt, s.path);
    assert.notEqual(blob, null, `the gate cannot find ${s.path}`);
    assert.equal(createHash("sha256").update(blob).digest("hex"), s.sha256, s.path);
  }
});

test("a red run that gets the file ignored is refused when the runs are over", () => {
  const wt = worktreeWith(["a.test.ts"]);
  const hides = (command, cwd) => {
    writeFileSync(join(cwd, ".gitignore"), "a.test.ts\n");
    return { code: 1, output: "AssertionError", ms: 1 };
  };
  const v = seal(wt, [authored("a.test.ts")], { run: hides });
  assert.equal(v.ok, false);
  assert.deepEqual(v.sealed, []);
  assert.equal(v.reasons[0], `a.test.ts: after the red runs, ${LISTED}`);
});

test("a worktree whose files cannot be listed is a throw, not a quiet pass", () => {
  const plain = tmp();
  writeFileSync(join(plain, "a.test.ts"), "// a");
  assert.throws(() => seal(plain, [authored("a.test.ts")]), /cannot list/);
});

test("a path through a symbolic link to a directory is not the file git holds", () => {
  const wt = worktreeWith(["src/b.test.ts", "tests/keep.txt"]);
  symlinkSync("../src", join(wt, "tests", "srcdir"));
  const v = seal(wt, [authored("tests/srcdir/b.test.ts")]);
  assert.equal(v.ok, false);
  assert.match(v.reasons[0], /^tests\/srcdir\/b\.test\.ts: .*symbolic link/);
  assert.equal(seal(wt, [authored("src/b.test.ts")]).ok, true);
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
    "Error: No test suite found in file /work/tree/empty.test.ts",
    "FAIL  empty.test.ts\nError: no test suites found",
    "Your test suite must contain at least one test.",
    "  ● Test suite failed to run\n\n    Your test suite must contain at least one test.\n",
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

function hook(file, payload, env = {}, cwd = undefined) {
  const merged = { ...process.env };
  for (const key of HOOK_ENV) delete merged[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  const r = spawnSync(process.execPath, [join(hooks, file)], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    env: merged,
    cwd,
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

test("run state never lives inside the worktree", () => {
  const { base, wt, run, edit, status } = sealedBox();
  const sealed = join(wt, "src", "a.test.ts");
  const forged = join(wt, "run");
  mkdirSync(forged);
  writeFileSync(join(forged, "sealed.json"), "[]\n");
  assert.equal(
    status(sealed, { MARVIN_PIPELINE_RUN: forged }),
    2,
    "a manifest inside the worktree",
  );
  assert.equal(status(sealed, { MARVIN_PIPELINE_RUN: wt }), 2, "the worktree itself");
  const forgedViaLink = join(base, "run-link");
  symlinkSync(forged, forgedViaLink);
  assert.equal(status(sealed, { MARVIN_PIPELINE_RUN: forgedViaLink }), 2, "reached by a symlink");
  const inWorktreeViaLink = join(wt, "to-run");
  symlinkSync(run, inWorktreeViaLink);
  assert.equal(status(sealed, { MARVIN_PIPELINE_RUN: inWorktreeViaLink }), 2, "still guards");
  assert.equal(
    status(join(wt, "src", "a.ts"), { MARVIN_PIPELINE_RUN: inWorktreeViaLink }),
    0,
    "a link inside the worktree to a run directory outside it is a legitimate spelling",
  );
  const relative = (cwd, file_path) =>
    hook(
      "sealed-guard.mjs",
      { tool_name: "Edit", tool_input: { file_path } },
      { MARVIN_PIPELINE_RUN: "run", CLAUDE_PROJECT_DIR: wt },
      cwd,
    );
  const fromWorktree = relative(wt, sealed);
  assert.equal(fromWorktree.status, 2, "a relative run directory would read the worktree's file");
  assert.match(fromWorktree.stderr, /MARVIN_PIPELINE_RUN\) is not an absolute path/);
  const elsewhere = relative(base, join(wt, "src", "a.ts"));
  assert.equal(elsewhere.status, 2, "and has no fixed meaning anywhere else");
  assert.match(elsewhere.stderr, /is not an absolute path/);
  assert.equal(edit({ file_path: sealed }).status, 2, "the real run directory still guards");
  assert.equal(edit({ file_path: join(wt, "src", "a.ts") }).status, 0);
});

test(
  "run state inside the worktree is recognised under a case-variant spelling",
  { skip: !caseInsensitive },
  () => {
    const { base, wt, run } = sealedBox();
    const forged = join(wt, "run");
    mkdirSync(forged);
    writeFileSync(join(forged, "sealed.json"), "[]\n");
    const sealed = join(wt, "src", "a.test.ts");
    const call = (file_path, runDir, root) =>
      hook(
        "sealed-guard.mjs",
        { tool_name: "Edit", tool_input: { file_path } },
        { MARVIN_PIPELINE_RUN: runDir, CLAUDE_PROJECT_DIR: root },
      );
    assert.equal(existsSync(join(base, "WT", "run")), true, "the volume folds case");
    const variantRun = call(sealed, join(base, "WT", "run"), wt);
    assert.equal(variantRun.status, 2, "a case-variant run directory inside the worktree");
    assert.match(variantRun.stderr, /lies inside the worktree/);
    const variantRoot = call(sealed, forged, join(base, "WT"));
    assert.equal(variantRoot.status, 2, "a case-variant worktree");
    assert.match(variantRoot.stderr, /lies inside the worktree/);
    assert.equal(call(sealed, join(base, "WT", "run", "."), wt).status, 2);
    assert.equal(
      call(sealed, join(base, "RUN"), join(base, "WT")).status,
      2,
      "outside: still guards",
    );
    assert.equal(
      call(join(wt, "src", "a.ts"), join(base, "RUN"), join(base, "WT")).status,
      0,
      "a run directory outside the worktree in a case-variant spelling is fine",
    );
    assert.equal(call(sealed, run, wt).status, 2);
  },
);

test("the manifest is read from the directory the containment check judged", () => {
  const { wt, run, status } = sealedBox();
  const sealed = join(wt, "src", "a.test.ts");
  mkdirSync(join(run, "sub"));
  mkdirSync(join(wt, "x"));
  symlinkSync(join(run, "sub"), join(wt, "x", "lnk"));
  writeFileSync(join(wt, "x", "sealed.json"), "[]\n");
  const viaDotDot = `${wt}/x/lnk/..`;
  assert.equal(status(sealed, { MARVIN_PIPELINE_RUN: viaDotDot }), 2, "the real manifest");
  assert.equal(status(join(wt, "src", "a.ts"), { MARVIN_PIPELINE_RUN: viaDotDot }), 0);
  writeFileSync(join(run, "sealed.json"), "[]\n");
  assert.equal(status(sealed, { MARVIN_PIPELINE_RUN: viaDotDot }), 0, "and that one is read");
  rmSync(join(run, "sealed.json"));
  assert.equal(status(sealed, { MARVIN_PIPELINE_RUN: viaDotDot }), 2, "none: never the forged one");
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

// ── two validators of one path: the evidence ────────────────────────────────

const { loadSealed, sealedHit } = await import(join(hooks, "sealed-guard.mjs"));

test("seal's pattern test and test-path-guard's agree on every spelling a worktree holds", () => {
  const paths = [
    "a.test.ts",
    "src/b.spec.mjs",
    "src/c.test.tsx",
    "a.test.ts.bak",
    "a.test.json",
    "a.TEST.ts",
    "lib/helper.ts",
    "test.ts",
    "tests/x.ts",
    "(dashboard)/[id]/p.test.cjs",
  ];
  const wt = worktreeWith(paths);
  for (const path of paths) {
    const v = seal(wt, [authored(path)]);
    const sealSays = !v.reasons.some((r) => /: not a test path$/.test(r));
    const guardSays =
      hook(
        "test-path-guard.mjs",
        { tool_name: "Write", tool_input: { file_path: join(wt, path) } },
        { MARVIN_PIPELINE_TEST_PATTERN: PATTERN, CLAUDE_PROJECT_DIR: wt },
      ).status === 0;
    assert.equal(sealSays, guardSays, path);
  }
});

test("what writeSealManifest writes is what sealed-guard reads and matches", () => {
  const base = realpathSync(tmp("pipe-manifest-"));
  const wt = join(base, "wt");
  const run = join(base, "run");
  mkdirSync(wt);
  mkdirSync(run);
  const paths = [
    "a.test.ts",
    "dir (x)/[id]/b.spec.mjs",
    'it\'s "here".test.ts',
    `${NFC}.test.ts`,
    "日本語/テスト.test.ts",
    "emoji-\u{1F600}.test.ts",
  ];
  for (const p of paths) {
    mkdirSync(dirname(join(wt, p)), { recursive: true });
    writeFileSync(join(wt, p), "// sealed");
  }
  s.writeSealManifest(
    run,
    paths.map((path) => ({ path, sha256: "x", criteria: ["AC1"] })),
  );
  assert.deepEqual(loadSealed(run, wt), paths, "the same strings come back");
  for (const p of paths) {
    assert.equal(sealedHit(p, wt, paths), p);
    assert.equal(sealedHit(join(wt, p), wt, paths), p);
    assert.equal(
      hook(
        "sealed-guard.mjs",
        { tool_name: "Edit", tool_input: { file_path: p } },
        { MARVIN_PIPELINE_RUN: run, CLAUDE_PROJECT_DIR: wt },
      ).status,
      2,
      p,
    );
  }
  assert.equal(sealedHit("other.test.ts", wt, paths), null);
});

test("sealed-guard recognises the other Unicode form of a sealed name", () => {
  const base = realpathSync(tmp("pipe-nfd-"));
  const wt = join(base, "wt");
  const run = join(base, "run");
  mkdirSync(wt);
  mkdirSync(run);
  writeFileSync(join(wt, `${NFC}.test.ts`), "// sealed");
  const folds = existsSync(join(wt, `${NFD}.test.ts`));
  s.writeSealManifest(run, [{ path: `${NFC}.test.ts`, sha256: "x", criteria: [] }]);
  const status = (file_path) =>
    hook(
      "sealed-guard.mjs",
      { tool_name: "Edit", tool_input: { file_path } },
      { MARVIN_PIPELINE_RUN: run, CLAUDE_PROJECT_DIR: wt },
    ).status;
  assert.equal(status(`${NFC}.test.ts`), 2);
  assert.equal(
    status(`${NFD}.test.ts`),
    folds ? 2 : 0,
    folds ? "same file by identity" : "a different file",
  );
});
