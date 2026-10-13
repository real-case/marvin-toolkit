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
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { importTs } from "./_tsload.mjs";
import { runWorktree } from "./_gate-fixture.mjs";
import { repoWithOrigin, sh } from "./_pipeline-git.mjs";

const s = await importTs("src/pipeline/seal.ts");
const g = await importTs("src/pipeline/gate.ts");
const wtm = await importTs("src/pipeline/worktree.ts");
const { resolveOracleCommand } = await importTs("src/storage/oracles.ts");
const hooks = fileURLToPath(new URL("../../../pipeline/hooks/", import.meta.url));
const PATTERN = "\\.(test|spec)\\.[cm]?[jt]sx?$";

/** The entry script of a runner the server package resolves, or null when it resolves none. */
function binOf(name) {
  try {
    const manifest = createRequire(import.meta.url).resolve(`${name}/package.json`);
    const { bin } = JSON.parse(readFileSync(manifest, "utf8"));
    return join(dirname(manifest), typeof bin === "string" ? bin : bin[name]);
  } catch {
    return null;
  }
}
const shellWord = (word) => `'${word.replaceAll("'", "'\\''")}'`;

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

// ── one gates.test_one, two readers ─────────────────────────────────────────

/** Paths a Next.js app and a careless author produce, none of which the oracle screen refuses. */
const ROUTE_PATHS = [
  "src/app/(dashboard)/page.test.ts",
  "src/app/(dashboard)/users/[id]/page.test.tsx",
  "src/app/my dir/a b.test.ts",
  "src/$HOME/$x.test.ts",
  "src/it's/a.test.ts",
  "src/app/(group)/[...slug]/it's $x (2).test.ts",
];

const oracleFor = (ref) => ({
  id: "AC1",
  statement: "it works",
  implemented_by: ["F1"],
  oracle: { kind: "test", ref },
});

const printed = (command, cwd) => {
  const r = spawnSync("/bin/sh", ["-c", command], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `${command}\n${r.stderr}`);
  return r.stdout;
};

test("one unquoted test_one serves the seal stage and the oracle resolver alike", () => {
  const dir = tmp();
  for (const path of ROUTE_PATHS) {
    const template = "printf '<%s>' {file}";
    const sealed = s.formatTestOne(template, path);
    const resolved = resolveOracleCommand(oracleFor(`${path}::renders`), {
      testOne: template,
      projectRoot: dir,
    });
    assert.equal(resolved.source, "config.test_one", path);
    assert.equal(resolved.command, sealed, `both readers build one command for ${path}`);
    assert.equal(printed(sealed, dir), `<${path}>`, path);
    assert.equal(g.shellRunner(sealed, dir, 10000).output, `<${path}>`, path);
  }
  assert.equal(
    s.formatTestOne("npx vitest run {file}", ROUTE_PATHS[0]),
    "npx vitest run 'src/app/(dashboard)/page.test.ts'",
  );
});

test("the oracle resolver keeps every placeholder literal in every quoting context", () => {
  const dir = tmp();
  // A backtick, `$(` and the other metacharacters are refused as unsafe-ref before any of this.
  const name = 'renders it\'s $HOME (ok) "quoted" [id] a\\b';
  for (const path of ROUTE_PATHS) {
    for (const template of [
      "printf '<%s|%s>' {file} {name}",
      'printf \'<%s|%s>\' "{file}" "{name}"',
      "printf '<%s|%s>' '{file}' '{name}'",
      "printf '<%s|%s>' --x={file} -t{name}",
    ]) {
      const resolved = resolveOracleCommand(oracleFor(`${path}::${name}`), {
        testOne: template,
        projectRoot: dir,
      });
      const expected = template.startsWith("printf '<%s|%s>' --x=")
        ? `<--x=${path}|-t${name}>`
        : `<${path}|${name}>`;
      assert.equal(printed(resolved.command, dir), expected, `${template} with ${path}`);
    }
    const whole = resolveOracleCommand(oracleFor(`${path}::${name}`), {
      testOne: "printf '<%s>' {ref}",
      projectRoot: dir,
    });
    assert.equal(printed(whole.command, dir), `<${path}::${name}>`, path);
  }
});

test("the seal stage still refuses {name} and a quoted {file}", () => {
  assert.throws(() => s.formatTestOne("npx vitest run {file} -t {name}", "a.test.ts"), /\{name\}/);
  assert.throws(() => s.formatTestOne('npx vitest run "{file}"', "a.test.ts"), /quote/);
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
  assert.deepEqual(seal(wt, [authored("src/real.test.ts")]).reasons, [
    "outdir: symlinked directory points outside the worktree",
  ]);
  rmSync(join(wt, "outdir"));
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

test("a path too long to check safely is refused before any pattern is built from it", () => {
  const wt = worktreeWith(["a.test.ts"]);
  const calls = [];
  /** A canonical test path of exactly `n` characters, in segments of 100. */
  const longPath = (n) => {
    const tail = "x.test.ts";
    let dirs = "";
    while (dirs.length + 100 + tail.length <= n) dirs += `${"d".repeat(99)}/`;
    return `${dirs}${"x".repeat(n - dirs.length - tail.length)}${tail}`;
  };
  for (const n of [1025, 5000]) {
    const path = longPath(n);
    assert.equal(path.length, n);
    const v = seal(wt, [authored(path)], { run: scripted({}, calls) });
    assert.deepEqual(v.reasons, [
      `${path.slice(0, 64)}…: path is too long to check safely (${n} chars)`,
    ]);
  }
  assert.deepEqual(calls, []);
  const limit = seal(wt, [authored(longPath(1024))]);
  assert.equal(limit.reasons.length, 1);
  assert.doesNotMatch(limit.reasons[0], /too long/, "1024 characters are checked as usual");
  assert.match(limit.reasons[0], /does not exist|cannot be inspected/);
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

const REWRITE_REASON =
  "git would rewrite this file on commit (eol/filter attributes); write it in its committed form";
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

test("a nested .git or node_modules directory is walked, and node's glob can enter it", () => {
  const cases = [
    ["d/.gi[t]/a.test.mjs", "d/.git/a.test.mjs"],
    ["d/.gi?/a.test.mjs", "d/.git/a.test.mjs"],
    ["d/node_module[s]/a.test.mjs", "d/node_modules/a.test.mjs"],
    ["d/node_module?/a.test.mjs", "d/node_modules/a.test.mjs"],
    ["d/.git*/a.test.mjs", "d/.git/a.test.mjs"],
  ];
  for (const [candidate, sibling] of cases) {
    const v = seal(worktreeWith([candidate, sibling]), [authored(candidate)]);
    assert.deepEqual(v.reasons, [SELECTS(candidate, sibling)], `${candidate} beside ${sibling}`);
  }
  const unmatched = boxWith(["d/.gi[t]/a.test.mjs"], (w) => put(w, "d/.gix/a.test.mjs"));
  assert.equal(
    seal(unmatched, [authored("d/.gi[t]/a.test.mjs")]).ok,
    true,
    "a class that does not match",
  );
});

test("a nested .git or node_modules directory counts for the glob reading only", () => {
  const wt = boxWith(["a.test.ts", "x.test.js"], (w) => {
    put(w, "pkg/node_modules/deep/xa.test.ts");
    put(w, "vendor/inner/.git/hooks/xa.test.ts");
    put(w, "vendor/node_modules/x.test.js");
  });
  assert.equal(seal(wt, [authored("a.test.ts")]).ok, true, "vitest and jest exclude both names");
  assert.equal(seal(wt, [authored("x.test.js")]).ok, true);
  const braced = boxWith(["x{a}.test.ts"], (w) => put(w, "pkg/node_modules/deep/q.test.ts"));
  assert.deepEqual(seal(braced, [authored("x{a}.test.ts")]).reasons, [
    SELECTS("x{a}.test.ts", "pkg/node_modules/deep/q.test.ts"),
  ]);
  const rootBraced = boxWith(["x{a}.test.ts"], (w) => {
    put(w, "node_modules/q.test.ts");
    put(w, ".git/hooks/q.test.ts");
  });
  assert.equal(
    seal(rootBraced, [authored("x{a}.test.ts")]).ok,
    true,
    "the root ones are never walked",
  );
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
    if (!candidate.includes("|")) {
      const unrelated = seal(worktreeWith([candidate, "zzz.test.js"]), [authored(candidate)]);
      assert.equal(unrelated.ok, true, `${candidate} beside an unrelated file`);
    }
  }
});

test("jest tests its regular expression against the absolute path too", () => {
  for (const [candidate, sibling] of [
    ["[/]x.test.js", "x.test.js"],
    ["q|/x.test.js", "x.test.js"],
    ["(^|/)[^/]*x.test.js", "x.test.js"],
  ]) {
    const v = seal(worktreeWith([candidate, sibling]), [authored(candidate)]);
    assert.deepEqual(v.reasons, [SELECTS(candidate, sibling)], `${candidate} beside ${sibling}`);
    const alone = seal(worktreeWith([candidate]), [authored(candidate)]);
    assert.equal(alone.ok, true, `${candidate} alone: ${alone.reasons.join("; ")}`);
  }
  const wt = worktreeWith(["[/]x.test.js", "d/x.test.js"]);
  assert.deepEqual(seal(wt, [authored("[/]x.test.js")]).reasons, [
    SELECTS("[/]x.test.js", "d/x.test.js"),
  ]);
});

test("the pattern is compiled as written, so a range keeps its case", () => {
  for (const [candidate, sibling] of [
    ["x[A-z].test.js", "x_.test.js"],
    ["x[A-z].test.mjs", "x_.test.mjs"],
    ["x[A-z].test.js", "x[.test.js"],
    ["x[A-z]+.test.js", "x_.test.js"],
  ]) {
    const v = seal(worktreeWith([candidate, sibling]), [authored(candidate)]);
    assert.deepEqual(v.reasons, [SELECTS(candidate, sibling)], `${candidate} beside ${sibling}`);
  }
});

test("a sibling whose raw name holds the candidate is selected although its folded name does not", () => {
  const wt = worktreeWith(["a.test.ts"]);
  put(wt, "a.test.ts\u0301/b.test.ts");
  const v = seal(wt, [authored("a.test.ts")]);
  assert.equal(v.ok, false);
  assert.match(
    v.reasons[0],
    /^a\.test\.ts: the single-test command may also select a\.test\.ts.\/b\.test\.ts$/,
  );
  const jest = worktreeWith(["a.test.js"]);
  put(jest, "a.test.js\u0301/b.test.js");
  assert.equal(seal(jest, [authored("a.test.js")]).ok, false);
  const control = worktreeWith(["a.test.ts"]);
  put(control, "a.test.tsz/b.test.ts");
  assert.deepEqual(seal(control, [authored("a.test.ts")]).reasons, [
    SELECTS("a.test.ts", "a.test.tsz/b.test.ts"),
  ]);
});

test("each reading is tried on the name as it is on disk and on its folded form", () => {
  const cases = [
    ["caf\u00e9+.test.js", "xcafe\u0301.test.js", "regex, folded name"],
    ["a+.test.ts", "a+.test.ts\u0301/b.test.ts", "substring, raw name"],
    ["caf\u00e9+.test.js", "xcafe\u0301+.test.js", "substring, folded name"],
    ["x[!a]?.test.ts", "xe\u0301.test.ts", "glob, raw name"],
    ["x[!a].test.ts", "xe\u0301.test.ts", "glob, folded name"],
  ];
  for (const [candidate, sibling, why] of cases) {
    const alone = seal(worktreeWith([candidate]), [authored(candidate)]);
    assert.equal(alone.ok, true, `${why}: ${candidate} alone: ${alone.reasons.join("; ")}`);
    const v = seal(worktreeWith([candidate, sibling]), [authored(candidate)]);
    assert.deepEqual(v.reasons, [SELECTS(candidate, sibling)], why);
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
    if (!candidate.includes("{")) {
      const alone = seal(worktreeWith([candidate]), [authored(candidate)]);
      assert.equal(alone.ok, true, `${candidate} alone: ${alone.reasons.join("; ")}`);
    }
    const v = seal(worktreeWith([candidate, sibling]), [authored(candidate)]);
    assert.deepEqual(v.reasons, [SELECTS(candidate, sibling)], `${candidate} beside ${sibling}`);
  }
  for (const candidate of [
    "x{},y}.test.mjs",
    "x{a}.test.mjs",
    "{a,b}/p.test.mjs",
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

test("a hard link under a selected name is a sibling, a copy is too", () => {
  for (const make of [
    (wt) => linkSync(join(wt, "a.test.ts"), join(wt, "xa.test.ts")),
    (wt) => writeFileSync(join(wt, "xa.test.ts"), readFileSync(join(wt, "a.test.ts"))),
  ]) {
    const wt = worktreeWith(["a.test.ts"]);
    make(wt);
    assert.deepEqual(seal(wt, [authored("a.test.ts")]).reasons, [
      SELECTS("a.test.ts", "xa.test.ts"),
    ]);
  }
  const wt = worktreeWith(["a.test.ts"]);
  linkSync(join(wt, "a.test.ts"), join(wt, "other.txt"));
  assert.equal(seal(wt, [authored("a.test.ts")]).ok, true, "a link nothing selects is no sibling");
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

test("a symlinked directory is followed, because vitest follows it", () => {
  const inside = boxWith(["a.test.ts"], (wt) => {
    put(wt, "real/xa.test.ts");
    symlinkSync("real", join(wt, "lnk"));
  });
  const v = seal(inside, [authored("a.test.ts")]);
  assert.equal(v.ok, false);
  assert.match(
    v.reasons[0],
    /^a\.test\.ts: the single-test command may also select (lnk|real)\/xa\.test\.ts$/,
  );
  const intoModules = boxWith(["a.test.ts"], (wt) => {
    put(wt, "node_modules/pkg/xa.test.ts");
    symlinkSync("node_modules/pkg", join(wt, "lnk"));
  });
  assert.deepEqual(seal(intoModules, [authored("a.test.ts")]).reasons, [
    SELECTS("a.test.ts", "lnk/xa.test.ts"),
  ]);
  const named = boxWith(["a.test.ts"], (wt) => {
    put(wt, "real/xa.test.ts");
    symlinkSync("real", join(wt, "lnk.test.ts"));
  });
  assert.equal(seal(named, [authored("a.test.ts")]).reasons.length, 1);
  const none = boxWith(["a.test.ts"], (wt) => put(wt, "real/zzz.txt"));
  assert.equal(seal(none, [authored("a.test.ts")]).ok, true);
});

test("a symlinked directory that points outside the worktree is a reason, and is not walked", () => {
  const base = tmp();
  const wt = join(base, "wt");
  mkdirSync(wt);
  gitInit(wt);
  writeFileSync(join(wt, "a.test.ts"), "// a");
  const outside = join(base, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "xa.test.ts"), "// outside");
  symlinkSync(outside, join(wt, "lnk"));
  mkdirSync(join(wt, "d"));
  symlinkSync("../..", join(wt, "d", "up"));
  const v = seal(wt, [authored("a.test.ts")]);
  assert.equal(v.ok, false);
  assert.deepEqual([...v.reasons].sort(), [
    "d/up: symlinked directory points outside the worktree",
    "lnk: symlinked directory points outside the worktree",
  ]);
  assert.ok(!v.reasons.some((r) => /may also select/.test(r)), "it is not walked");
});

test("an outside link in a nested node_modules or .git blocks only a glob that can enter it", () => {
  const linked = (candidate, link) => {
    const base = tmp();
    const wt = join(base, "wt");
    const outside = join(base, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "x.test.ts"), "// behind the link");
    mkdirSync(wt);
    gitInit(wt);
    put(wt, candidate);
    mkdirSync(dirname(join(wt, link)), { recursive: true });
    symlinkSync(outside, join(wt, link));
    return seal(wt, [authored(candidate)]);
  };
  const OUT = (link) => `${link}: symlinked directory points outside the worktree`;
  const dep = "packages/app/node_modules/dep";
  for (const link of [dep, "packages/web/node_modules", "vendor/lib/.git/modules"]) {
    const honest = linked("a.test.ts", link);
    assert.equal(honest.ok, true, `${link}: ${honest.reasons.join("; ")}`);
    assert.deepEqual(linked("x{a}.test.ts", link).reasons, [OUT(link)], `${link}: a brace`);
  }
  for (const candidate of ["pa*.test.ts", "packages/app/node_modules/de?/x.test.ts"]) {
    assert.deepEqual(linked(candidate, dep).reasons, [OUT(dep)], `${candidate} can enter it`);
  }
  for (const candidate of [
    "zz*.test.ts",
    "packages/app/node_modules/d?/x.test.ts",
    "packages/app/node_modules/dep.test.ts",
    "packages/app/x.test.ts",
  ]) {
    const v = linked(candidate, dep);
    assert.equal(v.ok, true, `${candidate} cannot enter it: ${v.reasons.join("; ")}`);
  }
  assert.deepEqual(
    linked("a.test.ts", "packages/app/lib").reasons,
    [OUT("packages/app/lib")],
    "anywhere else, the link blocks every candidate",
  );
});

test("an outside link a red run plants is judged when the runs are over", () => {
  const plants = (link) => {
    const base = tmp();
    const wt = join(base, "wt");
    mkdirSync(join(base, "outside"));
    mkdirSync(wt);
    gitInit(wt);
    put(wt, "a.test.ts");
    const run = (command, cwd) => {
      mkdirSync(dirname(join(cwd, link)), { recursive: true });
      symlinkSync(join(base, "outside"), join(cwd, link));
      return { code: 1, output: "AssertionError", ms: 1 };
    };
    return seal(wt, [authored("a.test.ts")], { run });
  };
  assert.deepEqual(plants("lnk").reasons, ["lnk: symlinked directory points outside the worktree"]);
  const nested = plants("packages/app/node_modules/dep");
  assert.equal(nested.ok, true, nested.reasons.join("; "));
});

test("a symlink loop does not hang the walk", () => {
  const wt = worktreeWith(["a.test.ts", "d/keep.txt"]);
  symlinkSync(".", join(wt, "loop"));
  symlinkSync("..", join(wt, "d", "up"));
  symlinkSync("../d", join(wt, "d", "self"));
  symlinkSync("missing", join(wt, "dangling"));
  assert.equal(seal(wt, [authored("a.test.ts")]).ok, true);
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

test("a conversion git only complains about while it writes the object is a rewrite", () => {
  const bom = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("// x\n", "utf16le")]);
  const noBom = Buffer.from("// x\n", "utf16le");
  const wt = worktreeWith([".gitattributes"]);
  writeFileSync(join(wt, ".gitattributes"), "*.ts working-tree-encoding=UTF-16LE\n");
  writeFileSync(join(wt, "a.test.ts"), bom);
  writeFileSync(join(wt, "b.test.ts"), noBom);
  const probe = git(wt, "hash-object", "--path=a.test.ts", "--", "a.test.ts");
  assert.match(probe.stderr, /^(error|fatal):/m, "the setup makes git complain about the BOM");
  assert.notEqual(git(wt, "add", "a.test.ts").status, 0, "and refuse to commit it");
  assert.deepEqual(seal(wt, [authored("a.test.ts")]).reasons, [`a.test.ts: ${REWRITE_REASON}`]);
  assert.deepEqual(seal(wt, [authored("b.test.ts")]).reasons, [`b.test.ts: ${REWRITE_REASON}`]);
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

const JEST_COULD_NOT_FIND = `FAIL ./a.test.ts
  ✕ finds the user

  ● finds the user

    Could not find 'user' in the directory

    > 1 | test("finds the user", () => { throw new Error("Could not find 'user' in the directory"); });
        |                                      ^

Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 total
`;

test("node's own 'Could not find' counts as no test, with the real runner too", () => {
  const wt = worktreeWith(["a.test.ts"]);
  const verdict = (output) =>
    seal(wt, [authored("a.test.ts")], { run: () => ({ code: 1, output, ms: 1 }) });
  for (const output of [
    "Could not find 'a.test.ts'\n",
    `Could not find '${join(wt, "a.test.ts")}'`,
    `Could not find '${join(realpathSync(wt), "a.test.ts")}'\n`,
    "✖ failing tests:\nCould not find 'a.test.ts'\n",
    "Could not find './a.test.ts'\n",
    "Could not find 'sub/../a.test.ts'\n",
    `Could not find '${wt}/./a.test.ts'`,
  ]) {
    assert.deepEqual(
      verdict(output).reasons,
      ["a.test.ts: the runner found no test in it"],
      output,
    );
  }
  for (const output of [
    "AssertionError: Could not find 'x' in the list",
    "  Could not find 'a.test.ts'",
    "\tCould not find 'a.test.ts'",
    "could not find 'a.test.ts'",
    "COULD NOT FIND 'a.test.ts'",
    "Could not find 'A.test.ts'",
    "Could not find 'b.test.ts'",
    "Could not find 'x{a,b}.test.mjs'\n",
    "Could not find '/work/tree/a.test.ts'",
    "Could not find 'a.test.ts' in the list",
    "Could not find 'a.test.ts', 'b.test.ts'",
    "Could not find 'user'",
    "Could not find './b.test.ts'",
    "  Could not find './a.test.ts'",
    "Could not find './A.test.ts'",
    JEST_COULD_NOT_FIND,
  ]) {
    const v = verdict(output);
    assert.equal(v.ok, true, `a failure, not node's line for this file: ${JSON.stringify(output)}`);
  }
  // A run that executes the file starts node twice (the runner, then the file in its own process),
  // a run whose candidate the runner cannot find starts it once, and starting node can take
  // seconds on a loaded machine. The budget is a ceiling on a run that ends by itself, so it is
  // the jest test's two minutes rather than a 30 s that a loaded machine overran: a run cut short
  // reports exit 124, which the seal reads as a test that did not run.
  const real = (candidate, body, testOne = "node --test {file}") => {
    const dir = tmp();
    gitInit(dir);
    writeFileSync(join(dir, candidate), body);
    const context = process.env.NODE_TEST_CONTEXT;
    delete process.env.NODE_TEST_CONTEXT;
    try {
      return seal(dir, [authored(candidate)], { testOne, run: g.shellRunner, timeoutMs: 120000 });
    } finally {
      if (context !== undefined) process.env.NODE_TEST_CONTEXT = context;
    }
  };
  const red =
    'import { test } from "node:test";\ntest("red", () => { throw new Error("red"); });\n';
  const green = 'import { test } from "node:test";\ntest("ok", () => {});\n';
  // `node --test` reads its arguments as globs from Node 21 on, so a candidate with glob
  // characters matches no file there; Node 20 takes the argument as a path and runs the file,
  // which is a genuine red run of exactly that file.
  const globbing = Number(process.versions.node.split(".")[0]) >= 21;
  const foundNothing = (v, candidate, label) =>
    globbing
      ? assert.deepEqual(v.reasons, [`${candidate}: the runner found no test in it`], label)
      : assert.equal(v.ok, true, `${label}: ${v.reasons.join("; ")}`);
  for (const candidate of ["x{a,b}.test.mjs", "x{},y}.test.mjs", "x[y].test.mjs"]) {
    foundNothing(real(candidate, red), candidate, candidate);
  }
  const genuine = real("plain.test.mjs", red);
  assert.equal(genuine.ok, true, genuine.reasons.join("; "));
  const phrased = real(
    "user.test.mjs",
    red.replace('"red"', `"Could not find 'user' in the directory"`),
  );
  assert.equal(phrased.ok, true, phrased.reasons.join("; "));
  const passing = real("ok.test.mjs", green);
  assert.match(passing.reasons[0], /passes before implementation/);
  const dotted = "node --test ./{file}";
  for (const candidate of ["x{a,b}.test.mjs", "x[y].test.mjs"]) {
    foundNothing(real(candidate, red, dotted), candidate, `./${candidate}`);
  }
  const dottedRed = real("plain.test.mjs", red, dotted);
  assert.equal(dottedRed.ok, true, dottedRed.reasons.join("; "));
  assert.match(real("ok.test.mjs", green, dotted).reasons[0], /passes before implementation/);
});

const jestBin = binOf("jest");

test(
  "a real jest failure whose message reads like node's line is an honest red test",
  { skip: jestBin === null ? "jest is not installed for the server package" : false },
  () => {
    const testOne = `${shellWord(process.execPath)} ${shellWord(jestBin)} --ci --watchman=false {file}`;
    const box = (message) => {
      const wt = tmp();
      gitInit(wt);
      put(wt, "package.json", "{}\n");
      put(
        wt,
        "a.test.js",
        `test("finds the user", () => { throw new Error(${JSON.stringify(message)}); });\n`,
      );
      return seal(wt, [authored("a.test.js")], { testOne, run: g.shellRunner, timeoutMs: 120000 });
    };
    const phrased = box("Could not find 'user' in the directory");
    assert.equal(phrased.ok, true, phrased.reasons.join("; "));
    const exact = box("Could not find 'user'");
    assert.equal(exact.ok, true, exact.reasons.join("; "));
    const control = box("user lookup failed");
    assert.equal(control.ok, true, control.reasons.join("; "));
  },
);

// ── the runner's own count of test files ────────────────────────────────────

const ESC = "\u001b";
const RAN = (path, n) => `${path}: the runner ran ${n} test files, not just this one`;
const COUNTED = {
  vitestTwo:
    " FAIL  xa.test.ts > red\n\n Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 1 passed (2)\n   Duration  85ms\n",
  vitestOne:
    " FAIL  a.test.ts > red\n\n Test Files  1 failed (1)\n      Tests  1 failed | 1 passed (2)\n",
  vitestTwoAnsi: `${ESC}[2m Test Files ${ESC}[22m ${ESC}[1m${ESC}[31m1 failed${ESC}[39m${ESC}[22m${ESC}[2m | ${ESC}[22m${ESC}[1m${ESC}[32m1 passed${ESC}[39m${ESC}[22m${ESC}[90m (2)${ESC}[39m\n`,
  vitestOneAnsi: `${ESC}[2m Test Files ${ESC}[22m ${ESC}[1m${ESC}[31m1 failed${ESC}[39m${ESC}[22m${ESC}[90m (1)${ESC}[39m\n`,
  jestTwo:
    "Test Suites: 1 failed, 1 passed, 2 total\nTests:       1 failed, 1 passed, 2 total\nSnapshots:   0 total\n",
  jestOne: "Test Suites: 1 failed, 1 total\nTests:       1 failed, 1 passed, 2 total\n",
  jestTwoAnsi: `${ESC}[1mTest Suites:${ESC}[22m ${ESC}[1m${ESC}[31m1 failed${ESC}[39m${ESC}[22m, ${ESC}[1m${ESC}[32m1 passed${ESC}[39m${ESC}[22m, 2 total\n`,
  jestOneAnsi: `${ESC}[1mTest Suites:${ESC}[22m ${ESC}[1m${ESC}[31m1 failed${ESC}[39m${ESC}[22m, 1 total\n`,
};

test("the runner's own count of test files is the primary evidence", () => {
  const wt = worktreeWith(["a.test.ts"]);
  const verdict = (output, code = 1) =>
    seal(wt, [authored("a.test.ts")], { run: () => ({ code, output, ms: 1 }) });
  for (const [output, n] of [
    [COUNTED.vitestTwo, 2],
    [COUNTED.vitestTwoAnsi, 2],
    [COUNTED.jestTwo, 2],
    [COUNTED.jestTwoAnsi, 2],
    [" Test Files  3 failed (3)\n", 3],
    ["Test Suites: 2 failed, 1 passed, 3 total\r\n", 3],
    ["Test Suites: 0 total\n", 0],
    ["stdout | a.test.ts\n Test Files  1 failed (1)\n\n Test Files  1 failed | 1 passed (2)\n", 2],
  ]) {
    assert.deepEqual(verdict(output).reasons, [RAN("a.test.ts", n)], JSON.stringify(output));
  }
  for (const output of [
    COUNTED.vitestOne,
    COUNTED.vitestOneAnsi,
    COUNTED.jestOne,
    COUNTED.jestOneAnsi,
    "AssertionError: expected 1 to equal 2",
  ]) {
    const v = verdict(output);
    assert.equal(v.ok, true, `${JSON.stringify(output)}: ${v.reasons.join("; ")}`);
  }
  assert.match(
    verdict(COUNTED.vitestTwo, 0).reasons[0],
    /passes before implementation/,
    "a passing run is refused as passing, whatever it counted",
  );
  assert.deepEqual(verdict(" Test Files  1 failed | 1 passed (2)\r\n").reasons, [
    RAN("a.test.ts", 2),
  ]);
});

test("reading the count costs time linear in the output, however many blank lines it holds", () => {
  const wt = worktreeWith(["a.test.ts"]);
  const output = ` Test Files  1 failed | 1 passed (2)\nend\n${"\n".repeat(300000)}end\n`;
  const started = Date.now();
  const v = seal(wt, [authored("a.test.ts")], { run: () => ({ code: 1, output, ms: 1 }) });
  const elapsed = Date.now() - started;
  assert.deepEqual(v.reasons, [RAN("a.test.ts", 2)]);
  assert.ok(elapsed < 10000, `took ${elapsed} ms`);
});

test("without a count line the static readings decide, and a count of 1 does not lift them", () => {
  const wt = worktreeWith(["a.test.ts", "ba.test.ts"]);
  const calls = [];
  for (const output of [
    "AssertionError: expected 1 to equal 2",
    COUNTED.vitestOne,
    COUNTED.jestOne,
  ]) {
    const v = seal(wt, [authored("a.test.ts")], {
      run: scripted({ "a.test.ts": { code: 1, output } }, calls),
    });
    assert.deepEqual(v.reasons, [SELECTS("a.test.ts", "ba.test.ts")], JSON.stringify(output));
  }
  assert.deepEqual(calls, [], "the static readings are checked before anything runs");
});

test("an escape the strip removes never spans a line, so two streams cannot join around the summary", () => {
  const wt = worktreeWith(["a.test.ts"]);
  const verdict = (output) =>
    seal(wt, [authored("a.test.ts")], { run: () => ({ code: 1, output, ms: 1 }) });
  const stdout = ` ❯ |app| data.test.ts (1 test | 1 failed)\n\n${COUNTED.vitestTwo}`;
  for (const [opener, terminator] of [
    [`${ESC}]`, "\u0007"],
    [`${ESC}]`, `${ESC}\\`],
    [`${ESC}]8;;`, "\u0007"],
    [`${ESC}P`, `${ESC}\\`],
    [`${ESC}_`, "\u0007"],
    [`${ESC}^`, `${ESC}\\`],
    [`${ESC}X`, "\u0007"],
  ]) {
    const output = `${opener}${stdout}${terminator}`;
    assert.deepEqual(verdict(output).reasons, [RAN("a.test.ts", 2)], JSON.stringify(output));
  }
  const linked = ` Test Files  ${ESC}]8;;file:///w/a.test.ts\u00071 failed${ESC}]8;;${ESC}\\ | 1 passed (2)\n`;
  assert.deepEqual(
    verdict(linked).reasons,
    [RAN("a.test.ts", 2)],
    "a one-line OSC is still stripped",
  );
  for (const [intro, terminator] of [
    ["]", "\u0007"],
    ["]", `${ESC}\\`],
    ["P", `${ESC}\\`],
    ["X", "\u0007"],
    ["^", `${ESC}\\`],
    ["_", "\u0007"],
  ]) {
    const output = ` Test Files  1 failed | 1 passed (2)${ESC}${intro}x;y${terminator}\n`;
    assert.deepEqual(verdict(output).reasons, [RAN("a.test.ts", 2)], `one-line ESC ${intro}`);
  }
  assert.deepEqual(verdict(COUNTED.vitestTwoAnsi).reasons, [RAN("a.test.ts", 2)]);
  assert.equal(verdict(COUNTED.vitestOneAnsi).ok, true);
});

const vitestBin = binOf("vitest");
const VITEST_GREEN = 'test("vacuous", () => {});\n';
const VITEST_RED = 'test("red", () => { expect(1).toBe(2); });\n';

/** A worktree whose root vitest config runs every `packages/*` directory as a project. */
function vitestProjects(files) {
  const wt = tmp();
  gitInit(wt);
  for (const [path, body] of Object.entries({
    "vitest.config.mjs": 'export default { test: { projects: ["packages/*"] } };\n',
    "packages/app/vitest.config.mjs": "export default { test: { globals: true } };\n",
    ...files,
  })) {
    put(wt, path, body);
  }
  return wt;
}

const sealWithVitest = (wt, paths) =>
  seal(
    wt,
    paths.map((p, i) => authored(p, [`AC${i + 1}`])),
    {
      testOne: `${shellWord(process.execPath)} ${shellWord(vitestBin)} run {file}`,
      run: g.shellRunner,
      timeoutMs: 120000,
    },
  );

test(
  "a real vitest under test.projects selects a plain-named sibling, and its own count gives it away",
  { skip: vitestBin === null ? "vitest is not installed for the server package" : false },
  () => {
    const honest = vitestProjects({
      "packages/app/a.test.ts": VITEST_GREEN,
      "packages/app/data.test.ts": VITEST_RED,
    });
    const v = sealWithVitest(honest, ["packages/app/a.test.ts", "packages/app/data.test.ts"]);
    assert.deepEqual(v.reasons, [RAN("packages/app/a.test.ts", 2)]);
    assert.deepEqual(v.sealed, []);
    const apart = vitestProjects({
      "packages/app/a.test.ts": VITEST_GREEN,
      "packages/app/zzz.test.ts": VITEST_RED,
    });
    assert.deepEqual(
      sealWithVitest(apart, ["packages/app/a.test.ts", "packages/app/zzz.test.ts"]).reasons,
      ["packages/app/a.test.ts: passes before implementation, so it proves nothing"],
    );
    const plain = vitestProjects({
      "packages/app/plain.test.ts": VITEST_RED,
      "packages/app/zz.test.ts": VITEST_GREEN,
    });
    const control = sealWithVitest(plain, ["packages/app/plain.test.ts"]);
    assert.equal(control.ok, true, control.reasons.join("; "));
  },
);

test(
  "a real vitest count survives an escape a test opens on stdout and closes on stderr",
  { skip: vitestBin === null ? "vitest is not installed for the server package" : false },
  () => {
    for (const terminator of ["\\u0007", "\\u001b\\\\"]) {
      const hiding = `test("vacuous", () => { process.stdout.write("\\u001b]"); process.stderr.write("${terminator}"); });\n`;
      const wt = vitestProjects({
        "packages/app/a.test.ts": hiding,
        "packages/app/data.test.ts": VITEST_RED,
      });
      const v = sealWithVitest(wt, ["packages/app/a.test.ts", "packages/app/data.test.ts"]);
      assert.deepEqual(v.reasons, [RAN("packages/app/a.test.ts", 2)], terminator);
      assert.deepEqual(v.sealed, []);
    }
  },
);

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

// ── a re-seal red-runs on the base tree (D-RESEAL) ──────────────────────────

const CALC_BASE = "export const sub = (a, b) => a - b;\n";
const CALC_DONE = `${CALC_BASE}export const add = (a, b) => a + b;\n`;
const CALC = 'import * as calc from "./calc.mjs";';
/** A node:test file: the imports in `header`, then one test per `[name, body]`. */
const nodeTest = (header, ...cases) =>
  [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    header,
    ...cases.map(([name, body]) => `test(${JSON.stringify(name)}, () => { ${body} });`),
    "",
  ].join("\n");
const ADDS = ["add adds", "assert.equal(calc.add?.(1, 2), 3);"];
const ADDS_NEGATIVES = ["add adds negatives", "assert.equal(calc.add?.(-1, -2), -3);"];
const SUBTRACTS = ["sub subtracts", "assert.equal(calc.sub(3, 1), 2);"];
const passesOnBase = (path) => `${path}: passes before implementation, so it proves nothing`;

/**
 * `sealAuthoredTests` with node's own runner, recording the directory each red run executed in.
 * The budget is the one the other real runs use: a ceiling on a run that ends by itself.
 */
function nodeSeal(worktree, tests, over = {}, cwds = []) {
  const context = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    return s.sealAuthoredTests({
      worktree,
      tests,
      testPathPattern: PATTERN,
      testOne: "node --test {file}",
      run: (command, cwd, timeoutMs) => {
        cwds.push(cwd);
        return g.shellRunner(command, cwd, timeoutMs);
      },
      timeoutMs: 120000,
      ...over,
    });
  } finally {
    if (context !== undefined) process.env.NODE_TEST_CONTEXT = context;
  }
}
const baseOf = (w) => ({ sha: w.baseSha, gitDir: w.gitDir });
const worktreeCount = (w) =>
  w
    .git("worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree ")).length;
const sha256Of = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * A run at the point of a re-seal: the test-author's `src/calc.test.mjs`, sealed red in the
 * worktree before any implementation, is committed, and the executor's `add` after it.
 */
function implementedRun() {
  const w = runWorktree({ ".gitignore": "node_modules/\n", "src/calc.mjs": CALC_BASE });
  w.write("src/calc.test.mjs", nodeTest(CALC, ADDS));
  const cwds = [];
  const first = nodeSeal(w.path, [authored("src/calc.test.mjs")], {}, cwds);
  assert.equal(first.ok, true, first.reasons.join("; "));
  assert.deepEqual(cwds, [w.path], "a first seal red-runs in the worktree itself");
  w.commit("test(calc): sealed acceptance tests");
  w.write("src/calc.mjs", CALC_DONE);
  w.commit("feat(calc): add");
  return w;
}

test("D-RESEAL: a correct revision against a correct implementation re-seals on the base tree", () => {
  const w = implementedRun();
  const count = worktreeCount(w);
  const head = w.git("rev-parse", "HEAD");
  w.write("src/calc.test.mjs", nodeTest(CALC, ADDS, ADDS_NEGATIVES));
  // Red-run in the implemented worktree, the correct revision passes and is refused.
  const inPlace = nodeSeal(w.path, [authored("src/calc.test.mjs")]);
  assert.deepEqual(inPlace.reasons, [passesOnBase("src/calc.test.mjs")]);

  const cwds = [];
  const v = nodeSeal(w.path, [authored("src/calc.test.mjs")], { base: baseOf(w) }, cwds);
  assert.equal(v.ok, true, v.reasons.join("; "));
  assert.deepEqual(v.sealed, [
    {
      path: "src/calc.test.mjs",
      criteria: ["AC1"],
      sha256: sha256Of(join(w.path, "src/calc.test.mjs")),
    },
  ]);
  assert.equal(cwds.length, 1);
  assert.ok(
    relative(w.path, cwds[0]).startsWith(".."),
    "the red run used a tree outside the run's",
  );
  assert.equal(existsSync(cwds[0]), false, "the base worktree is removed after the seal");
  assert.equal(worktreeCount(w), count);
  assert.equal(w.git("rev-parse", "HEAD"), head, "the run worktree is not touched");
  assert.equal(readFileSync(join(w.path, "src/calc.mjs"), "utf8"), CALC_DONE);
  assert.equal(w.git("status", "--porcelain"), "M src/calc.test.mjs");
});

test("D-RESEAL: a revision that passes on the base tree is refused, and the base worktree is removed", () => {
  const w = implementedRun();
  const count = worktreeCount(w);
  w.write("src/calc.test.mjs", nodeTest(CALC, SUBTRACTS));
  const cwds = [];
  const v = nodeSeal(w.path, [authored("src/calc.test.mjs")], { base: baseOf(w) }, cwds);
  assert.deepEqual([v.ok, v.reasons, v.sealed], [false, [passesOnBase("src/calc.test.mjs")], []]);
  assert.equal(cwds.length, 1);
  assert.equal(existsSync(cwds[0]), false);
  assert.equal(worktreeCount(w), count);
});

test("D-RESEAL: a revised test the base commit already holds is run in its revised form", () => {
  const w = runWorktree({
    "src/calc.mjs": CALC_BASE,
    "src/legacy.test.mjs": nodeTest(CALC, SUBTRACTS),
  });
  w.write("src/calc.mjs", CALC_DONE);
  w.commit("feat(calc): add");
  w.write("src/legacy.test.mjs", nodeTest(CALC, SUBTRACTS, ADDS));
  const v = nodeSeal(w.path, [authored("src/legacy.test.mjs")], { base: baseOf(w) });
  assert.equal(v.ok, true, v.reasons.join("; "));
  assert.deepEqual(
    v.sealed.map((x) => x.path),
    ["src/legacy.test.mjs"],
  );
});

test("D-RESEAL: a seal that throws while the base worktree exists still removes it", () => {
  const w = implementedRun();
  const count = worktreeCount(w);
  w.write("src/calc.test.mjs", nodeTest(CALC, ADDS, ADDS_NEGATIVES));
  const pointer = readFileSync(join(w.path, ".git"));
  let tree;
  // The run worktree loses its `.git` during the red run, so the listing after it throws.
  const dropsPointer = (command, cwd) => {
    tree = cwd;
    rmSync(join(w.path, ".git"));
    return RED;
  };
  try {
    assert.throws(
      () =>
        s.sealAuthoredTests({
          worktree: w.path,
          tests: [authored("src/calc.test.mjs")],
          testPathPattern: PATTERN,
          testOne: "node --test {file}",
          run: dropsPointer,
          timeoutMs: 1000,
          base: baseOf(w),
        }),
      /cannot list the worktree's files/,
    );
  } finally {
    writeFileSync(join(w.path, ".git"), pointer);
  }
  assert.ok(tree !== undefined && tree !== w.path);
  assert.equal(existsSync(tree), false);
  assert.equal(worktreeCount(w), count);
});

test(
  "D-RESEAL: a run node_modules the base tree cannot be given is a reason, not a throw that every restart replays",
  { skip: typeof process.getuid === "function" && process.getuid() === 0 },
  () => {
    const w = implementedRun();
    w.write("node_modules/@x/a/index.mjs", "export const a = 1;\n");
    const scope = join(w.path, "node_modules/@x");
    w.write("src/calc.test.mjs", nodeTest(CALC, ADDS, ADDS_NEGATIVES));
    const count = worktreeCount(w);
    const calls = [];
    let v;
    chmodSync(scope, 0);
    try {
      v = seal(w.path, [authored("src/calc.test.mjs")], {
        run: scripted({}, calls),
        base: baseOf(w),
      });
    } finally {
      chmodSync(scope, 0o755);
    }
    // Skipping what cannot be linked would leave a dependency missing in the base tree, and a
    // test failing on the missing module would be sealed as red.
    assert.deepEqual(
      [v.ok, v.reasons, v.sealed],
      [false, ["cannot prepare the base tree: node_modules/@x cannot be listed (EACCES)"], []],
    );
    assert.deepEqual(calls, [], "nothing runs");
    assert.equal(worktreeCount(w), count);
  },
);

test("D-RESEAL: the red run sees the base commit's workspace package and the run's dependencies", () => {
  const w = runWorktree({
    ".gitignore": "node_modules/\n",
    "packages/calc/package.json": '{ "name": "@w/calc", "main": "index.mjs" }\n',
    "packages/calc/index.mjs": CALC_BASE,
  });
  // What an install leaves in the run worktree: the workspace link npm writes, and a dependency.
  mkdirSync(join(w.path, "node_modules/@w"), { recursive: true });
  symlinkSync("../../packages/calc", join(w.path, "node_modules/@w/calc"));
  w.write("node_modules/two/package.json", '{ "name": "two", "main": "index.mjs" }\n');
  w.write("node_modules/two/index.mjs", "export const two = 2;\n");
  w.write("packages/calc/index.mjs", CALC_DONE);
  w.commit("feat(calc): add");
  const header = 'import * as calc from "@w/calc";\nimport { two } from "two";';
  const path = "tests/calc.test.mjs";

  // Through the workspace link, the base tree's package has no `add`: red, and sealed. Read
  // through the run worktree's own node_modules it would be the implementation, and pass.
  w.write(path, nodeTest(header, ["add adds two", "assert.equal(calc.add?.(1, two), 3);"]));
  const red = nodeSeal(w.path, [authored(path)], { base: baseOf(w) });
  assert.equal(red.ok, true, red.reasons.join("; "));
  // A test of what the base already does passes there, which takes both imports resolving.
  w.write(path, nodeTest(header, ["sub takes two", "assert.equal(calc.sub(3, two), 1);"]));
  const green = nodeSeal(w.path, [authored(path)], { base: baseOf(w) });
  assert.deepEqual(green.reasons, [passesOnBase(path)]);
});

test("D-RESEAL: which other files the command may select is judged in the base tree, where it runs", () => {
  const w = runWorktree({ "calc.mjs": CALC_BASE, "xcalc.test.mjs": "// a red test at the base\n" });
  rmSync(join(w.path, "xcalc.test.mjs"));
  w.commit("the run removed xcalc.test.mjs");
  w.write("calc.test.mjs", "// revised\n");
  const count = worktreeCount(w);
  const inRun = seal(w.path, [authored("calc.test.mjs")]);
  assert.equal(inRun.ok, true, "the run worktree has no such sibling");
  const calls = [];
  const v = seal(w.path, [authored("calc.test.mjs")], {
    run: scripted({}, calls),
    base: baseOf(w),
  });
  assert.deepEqual(v.reasons, [
    "calc.test.mjs: the single-test command may also select xcalc.test.mjs",
  ]);
  assert.deepEqual(calls, [], "nothing runs for a candidate that is refused");
  assert.equal(worktreeCount(w), count);
});

test("D-RESEAL: a path the base tree reaches through a link is refused, and nothing is written through it", () => {
  const repo = repoWithOrigin();
  const outside = tmp();
  symlinkSync(outside, join(repo, "t"));
  sh(repo, "add", "t");
  sh(repo, "commit", "-m", "t is a link at the base");
  sh(repo, "push", "origin", "HEAD:dev");
  const made = wtm.createRunWorktree({
    repoRoot: repo,
    base: "dev",
    runId: "r1",
    worktreesRoot: tmp("pipe-wts-"),
  });
  sh(made.path, "rm", "-q", "t");
  mkdirSync(join(made.path, "t"));
  writeFileSync(join(made.path, "t/a.test.mjs"), "// revised\n");
  sh(made.path, "add", "-A");
  sh(made.path, "commit", "-m", "t is a directory now");
  const v = seal(made.path, [authored("t/a.test.mjs")], {
    base: { sha: made.baseSha, gitDir: made.gitDir },
  });
  // The link is also what it is in the worktree check: a directory leading out of the tree the
  // command runs in, behind which the runner could select anything.
  assert.deepEqual(v.reasons, [
    "t/a.test.mjs: cannot be placed in the base tree (t is a symbolic link)",
    "t: symlinked directory points outside the worktree",
  ]);
  assert.deepEqual(readdirSync(outside), []);
});

test("D-RESEAL: a red run that changes the copy it runs, or the revised file, is not what gets sealed", () => {
  const w = runWorktree({ "calc.mjs": CALC_BASE });
  w.write("a.test.mjs", "// revised\n");
  const rewritesCopy = (command, cwd) => {
    writeFileSync(join(cwd, "a.test.mjs"), "// rewritten to pass\n");
    return RED;
  };
  const copy = seal(w.path, [authored("a.test.mjs")], { run: rewritesCopy, base: baseOf(w) });
  assert.deepEqual(copy.reasons, [
    "a.test.mjs: changed while its red run executed, so what ran is not what is sealed",
  ]);
  const rewritesRevision = () => {
    writeFileSync(join(w.path, "a.test.mjs"), "// rewritten to pass\n");
    return RED;
  };
  const revision = seal(w.path, [authored("a.test.mjs")], {
    run: rewritesRevision,
    base: baseOf(w),
  });
  assert.deepEqual(revision.reasons, [
    "a.test.mjs: changed while its red run executed, so what ran is not what is sealed",
  ]);
});

test("D-RESEAL: a base that is not a full commit SHA, or a relative git dir, is a misconfigured call", () => {
  const w = runWorktree();
  w.write("a.test.mjs", "// revised\n");
  const calls = [];
  for (const [base, expected] of [
    [{ sha: "HEAD", gitDir: w.gitDir }, /40-hex/],
    [{ sha: w.baseSha, gitDir: "relative/.git" }, /absolute/],
  ]) {
    assert.throws(
      () => seal(w.path, [authored("a.test.mjs")], { run: scripted({}, calls), base }),
      expected,
    );
  }
  assert.deepEqual(calls, []);
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
