import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { importTs } from "./_tsload.mjs";
import { repoWithOrigin, sh } from "./_pipeline-git.mjs";
import { runWorktree } from "./_gate-fixture.mjs";

const wt = await importTs("src/pipeline/worktree.ts");

const worktreesRoot = () => mkdtempSync(join(tmpdir(), "pipe-wts-"));

test("the run worktree branches from origin/<base> outside the repository tree (D18)", () => {
  const repo = repoWithOrigin();
  const root = worktreesRoot();
  const { path, branch } = wt.createRunWorktree({
    repoRoot: repo,
    base: "dev",
    runId: "r1",
    worktreesRoot: root,
  });
  assert.equal(branch, "autopilot/r1");
  assert.equal(path, join(root, basename(repo), "r1"));
  assert.ok(!path.startsWith(repo));
  assert.equal(sh(path, "rev-parse", "HEAD"), sh(repo, "rev-parse", "origin/dev"));
  assert.throws(
    () =>
      wt.createRunWorktree({
        repoRoot: repo,
        base: "dev",
        runId: "r1",
        worktreesRoot: root,
      }),
    /exists/,
  );
  assert.throws(
    () => sh(path, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"),
    /no upstream/,
  );
});

test("the run worktree records the base commit and its private git dir for the gate", () => {
  const repo = repoWithOrigin();
  const made = wt.createRunWorktree({
    repoRoot: repo,
    base: "dev",
    runId: "r3",
    worktreesRoot: worktreesRoot(),
  });
  assert.match(made.baseSha, /^[0-9a-f]{40}$/);
  assert.equal(made.baseSha, sh(repo, "rev-parse", "origin/dev"));
  assert.equal(sh(made.path, "rev-parse", "HEAD"), made.baseSha);
  assert.equal(made.gitDir, sh(made.path, "rev-parse", "--absolute-git-dir"));
  const pointer = /^gitdir: (.+)$/m.exec(readFileSync(join(made.path, ".git"), "utf8"))?.[1];
  assert.equal(realpathSync(made.gitDir), realpathSync(pointer));
  assert.ok(made.gitDir.startsWith(join(realpathSync(repo), ".git", "worktrees")));
});

test("a planted refs/tags/origin/<base> cannot shadow the remote-tracking base", () => {
  const repo = repoWithOrigin();
  const real = sh(repo, "rev-parse", "origin/dev");
  writeFileSync(join(repo, "poison.txt"), "poisoned\n");
  sh(repo, "add", ".");
  sh(repo, "commit", "-m", "poisoned base");
  const poisoned = sh(repo, "rev-parse", "HEAD");
  sh(repo, "tag", "origin/dev", poisoned);
  assert.equal(sh(repo, "rev-parse", "origin/dev"), poisoned, "the bare name resolves to the tag");
  const made = wt.createRunWorktree({
    repoRoot: repo,
    base: "dev",
    runId: "r4",
    worktreesRoot: worktreesRoot(),
  });
  assert.equal(made.baseSha, real);
  assert.equal(sh(made.path, "rev-parse", "HEAD"), real);
});

test("branch names follow the template and renaming refuses a taken name", () => {
  assert.equal(
    wt.branchName("feature/{tracker}--{slug}", {
      tracker: "OSI-TBD",
      slug: "tags-filter",
    }),
    "feature/OSI-TBD--tags-filter",
  );
  const repo = repoWithOrigin();
  const { path } = wt.createRunWorktree({
    repoRoot: repo,
    base: "dev",
    runId: "r2",
    worktreesRoot: worktreesRoot(),
  });
  assert.throws(() => wt.renameRunBranch(path, "dev"), /already exists on origin/);
  wt.renameRunBranch(path, "feature/OSI-TBD--x");
  assert.equal(sh(path, "branch", "--show-current"), "feature/OSI-TBD--x");
});

test("exact branch name lookup distinguishes other/feat-x from feat-x", () => {
  const repo = repoWithOrigin();
  sh(repo, "branch", "other/feat-x");
  sh(repo, "push", "origin", "other/feat-x");
  const { path } = wt.createRunWorktree({
    repoRoot: repo,
    base: "dev",
    runId: "r3",
    worktreesRoot: worktreesRoot(),
  });
  assert.throws(() => wt.renameRunBranch(path, "other/feat-x"), /already exists on origin/);
  wt.renameRunBranch(path, "feat-x");
  assert.equal(sh(path, "branch", "--show-current"), "feat-x");
});

test("snapshot detects new untracked file", () => {
  const repo = repoWithOrigin();
  const { path } = wt.createRunWorktree({
    repoRoot: repo,
    base: "dev",
    runId: "r4",
    worktreesRoot: worktreesRoot(),
  });
  const before = wt.snapshotTree(path);
  assert.deepEqual(wt.diffSnapshots(before, wt.snapshotTree(path)), []);
  writeFileSync(join(path, "new.txt"), "x");
  assert.deepEqual(wt.diffSnapshots(before, wt.snapshotTree(path)), ["?? new.txt"]);
});

test("snapshot detects main checkout leak (S10)", () => {
  const repo = repoWithOrigin();
  const before = wt.snapshotTree(repo);
  writeFileSync(join(repo, "leak.txt"), "x");
  assert.deepEqual(wt.diffSnapshots(before, wt.snapshotTree(repo)), ["?? leak.txt"]);
});

test("snapshot detects overwrite of already-modified file", () => {
  const repo = repoWithOrigin({ "b.txt": "b\n" });
  const b = join(repo, "b.txt");
  writeFileSync(b, "modified\n");
  const before = wt.snapshotTree(repo);
  writeFileSync(b, "different\n");
  const after = wt.snapshotTree(repo);
  const diff = wt.diffSnapshots(before, after);
  assert.deepEqual(diff, [" M b.txt (content changed)"]);
});

test("snapshot detects revert via git checkout", () => {
  const repo = repoWithOrigin({ "b.txt": "b\n" });
  const b = join(repo, "b.txt");
  writeFileSync(b, "modified\n");
  const before = wt.snapshotTree(repo);
  sh(repo, "checkout", "--", "b.txt");
  const after = wt.snapshotTree(repo);
  const diff = wt.diffSnapshots(before, after);
  assert.deepEqual(diff, ["removed  M b.txt"]);
});

test("snapshot detects untracked file deletion", () => {
  const repo = repoWithOrigin();
  const u = join(repo, "u.txt");
  writeFileSync(u, "untracked\n");
  const before = wt.snapshotTree(repo);
  unlinkSync(u);
  const after = wt.snapshotTree(repo);
  const diff = wt.diffSnapshots(before, after);
  assert.deepEqual(diff, ["removed ?? u.txt"]);
});

test("snapshot detects HEAD movement", () => {
  const repo = repoWithOrigin();
  const before = wt.snapshotTree(repo);
  writeFileSync(join(repo, "c.txt"), "commit\n");
  sh(repo, "add", ".");
  sh(repo, "commit", "-m", "second");
  const after = wt.snapshotTree(repo);
  const diff = wt.diffSnapshots(before, after);
  assert.equal(diff.length, 1);
  assert.match(diff[0], /^HEAD [a-f0-9]{40} -> [a-f0-9]{40}$/);
});

test("snapshot detects git mv rename", () => {
  const repo = repoWithOrigin();
  const old = join(repo, "old.txt");
  writeFileSync(old, "content\n");
  sh(repo, "add", "old.txt");
  sh(repo, "commit", "-m", "add old");
  const before = wt.snapshotTree(repo);
  sh(repo, "mv", "old.txt", "new.txt");
  const after = wt.snapshotTree(repo);
  const diff = wt.diffSnapshots(before, after);
  assert.deepEqual(diff, ["R  new.txt"]);
});

test("snapshot detects colon in path", () => {
  const repo = repoWithOrigin();
  const colonPath = join(repo, "a:b.txt");
  writeFileSync(colonPath, "first\n");
  const before = wt.snapshotTree(repo);
  writeFileSync(colonPath, "second\n");
  const after = wt.snapshotTree(repo);
  const diff = wt.diffSnapshots(before, after);
  assert.deepEqual(diff, ["?? a:b.txt (content changed)"]);
});

test("snapshot detects staging changes (XY codes matter)", () => {
  const repo = repoWithOrigin({ "b.txt": "b\n" });
  const b = join(repo, "b.txt");
  writeFileSync(b, "modified\n");
  const before = wt.snapshotTree(repo);
  sh(repo, "add", "b.txt");
  const after = wt.snapshotTree(repo);
  const diff = wt.diffSnapshots(before, after);
  assert.deepEqual(diff, ["M  b.txt", "removed  M b.txt"]);
});

test("snapshot detects add of new untracked file", () => {
  const repo = repoWithOrigin();
  const n = join(repo, "n.txt");
  writeFileSync(n, "new\n");
  const before = wt.snapshotTree(repo);
  sh(repo, "add", "n.txt");
  const after = wt.snapshotTree(repo);
  const diff = wt.diffSnapshots(before, after);
  assert.deepEqual(diff, ["A  n.txt", "removed ?? n.txt"]);
});

test("the snapshot of a worktree ignores replace refs written into the common git dir", () => {
  const repo = repoWithOrigin();
  const { path } = wt.createRunWorktree({
    repoRoot: repo,
    base: "dev",
    runId: "r9",
    worktreesRoot: worktreesRoot(),
  });
  const before = wt.snapshotTree(path);
  const emptyTree = execFileSync("git", ["mktree"], {
    cwd: path,
    input: "",
    encoding: "utf8",
  }).trim();
  const head = sh(path, "rev-parse", "HEAD");
  const hollow = sh(path, "commit-tree", emptyTree, "-m", "hollow");
  sh(path, "replace", head, hollow);
  assert.notEqual(
    sh(path, "status", "--porcelain"),
    "",
    "an ordinary git is fooled by the replace ref",
  );
  assert.deepEqual(wt.diffSnapshots(before, wt.snapshotTree(path)), []);
});

// ── the temporary base worktree a re-seal red-runs in (D-RESEAL) ─────────────────

/** The worktrees git has registered for the run's repository, the main checkout included. */
const registered = (w) =>
  w
    .git("worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => basename(line.slice("worktree ".length)));
const baseTreeOf = (w) => ({ worktree: w.path, gitDir: w.gitDir, commit: w.baseSha });

test("D-RESEAL: the base worktree is the base commit, detached, outside the run, and gone after", () => {
  const w = runWorktree({ ".gitignore": "node_modules/\n", "a.txt": "base\n" });
  w.write("a.txt", "implemented\n");
  w.commit("implement");
  const head = w.git("rev-parse", "HEAD");
  const before = registered(w);
  let seen;
  const out = wt.withBaseWorktree(baseTreeOf(w), (tree) => {
    seen = tree;
    assert.ok(!realpathSync(tree).startsWith(realpathSync(w.path)));
    assert.ok(!realpathSync(tree).startsWith(realpathSync(w.repo)));
    assert.equal(readFileSync(join(tree, "a.txt"), "utf8"), "base\n");
    assert.equal(sh(tree, "rev-parse", "HEAD"), w.baseSha);
    assert.equal(sh(tree, "branch", "--show-current"), "", "detached: no branch is created");
    assert.ok(registered(w).includes(basename(tree)));
    return 42;
  });
  assert.equal(out, 42);
  assert.equal(existsSync(seen), false);
  assert.deepEqual(registered(w), before);
  assert.equal(w.git("rev-parse", "HEAD"), head, "the run worktree is not touched");
  assert.equal(w.git("status", "--porcelain"), "");
});

test("D-RESEAL: the base worktree is removed when the work throws, even after it broke its .git", () => {
  const w = runWorktree({ "a.txt": "base\n" });
  const before = registered(w);
  let thrown;
  assert.throws(
    () =>
      wt.withBaseWorktree(baseTreeOf(w), (tree) => {
        thrown = tree;
        throw new Error("boom");
      }),
    /boom/,
  );
  assert.equal(existsSync(thrown), false);
  assert.deepEqual(registered(w), before);

  // Test code runs in the base worktree and can rewrite its `.git`, after which git refuses to
  // remove it ("validation failed"). It is removed all the same, and only it.
  let broken;
  assert.throws(
    () =>
      wt.withBaseWorktree(baseTreeOf(w), (tree) => {
        broken = tree;
        writeFileSync(join(tree, ".git"), `gitdir: ${w.gitDir}\n`);
        writeFileSync(join(tree, "junk.txt"), "x\n");
        throw new Error("broke it");
      }),
    /broke it/,
  );
  assert.equal(existsSync(broken), false);
  assert.deepEqual(registered(w), before);
  assert.equal(w.git("status", "--porcelain"), "");
  assert.equal(w.git("rev-parse", "HEAD"), w.baseSha);
});

test("D-RESEAL: a base commit that is not a full SHA, or relative paths, are refused before anything is made", () => {
  const w = runWorktree();
  const before = registered(w);
  const never = () => assert.fail("the work must not run");
  for (const [o, expected] of [
    [{ ...baseTreeOf(w), commit: "HEAD" }, /40-hex/],
    [{ ...baseTreeOf(w), commit: w.baseSha.toUpperCase() }, /40-hex/],
    [{ ...baseTreeOf(w), gitDir: "relative/.git" }, /absolute/],
    [{ ...baseTreeOf(w), worktree: "relative" }, /absolute/],
  ]) {
    assert.throws(() => wt.withBaseWorktree(o, never), expected);
  }
  assert.throws(() => wt.withBaseWorktree({ ...baseTreeOf(w), commit: "0".repeat(40) }, never));
  assert.deepEqual(registered(w), before);
});

test("D-RESEAL: the base worktree gets the run's node_modules by link, and a workspace link stays inside it", () => {
  const w = runWorktree({
    ".gitignore": "node_modules/\n",
    "packages/pkg/index.mjs": "export const v = 'base';\n",
  });
  w.write("packages/pkg/index.mjs", "export const v = 'implemented';\n");
  w.write("packages/fresh/index.mjs", "export const v = 'new';\n");
  w.commit("implement");
  // What an install leaves in the run worktree: a dependency, a scoped one, a workspace link
  // (relative, as npm writes it), an absolute link into the worktree, a `.bin`, nested ones.
  w.write("node_modules/dep/index.mjs", "export const dep = 1;\n");
  w.write("node_modules/@w/scoped/index.mjs", "export const scoped = 1;\n");
  symlinkSync("../../packages/pkg", join(w.path, "node_modules/@w/pkg"));
  symlinkSync(join(w.path, "packages/pkg"), join(w.path, "node_modules/abs-pkg"));
  mkdirSync(join(w.path, "node_modules/.bin"));
  symlinkSync("../dep/index.mjs", join(w.path, "node_modules/.bin/dep"));
  w.write("packages/pkg/node_modules/inner/index.mjs", "export const inner = 1;\n");
  w.write("packages/fresh/node_modules/other/index.mjs", "export const other = 1;\n");
  // Tool caches the runners keep in node_modules. Vite 6 and later also bundle the config into
  // `.vite-temp` and import it from there, so its bare imports resolve from that node_modules.
  w.write("node_modules/.vite/vitest/results.json", "{}\n");
  w.write("node_modules/.vitest/results.json", "{}\n");
  w.write("node_modules/.cache/babel/x.json", "{}\n");
  w.write("node_modules/.vite-temp/vitest.config.ts.timestamp-1-ab.mjs", "export default {};\n");
  const runModules = readdirSync(join(w.path, "node_modules")).sort();
  const caches = [".cache", ".vite", ".vite-temp", ".vitest"];

  wt.withBaseWorktree(baseTreeOf(w), (tree) => {
    const nm = join(tree, "node_modules");
    assert.ok(lstatSync(nm).isDirectory(), "node_modules is a directory of links, not one link");
    assert.deepEqual(
      readdirSync(nm).sort(),
      runModules.filter((name) => !caches.includes(name)),
      "a red run in the base tree keeps its tool caches there, out of the run's node_modules",
    );
    mkdirSync(join(nm, ".vite"));
    writeFileSync(join(nm, ".vite/results.json"), "base\n");
    mkdirSync(join(nm, ".vite-temp"));
    writeFileSync(join(nm, ".vite-temp/vitest.config.ts.timestamp-2-cd.mjs"), "base\n");
    const real = (rel) => realpathSync(join(w.path, rel));
    assert.equal(realpathSync(join(nm, "dep")), real("node_modules/dep"));
    assert.ok(lstatSync(join(nm, "@w")).isDirectory(), "a scope is mirrored, not linked");
    assert.equal(realpathSync(join(nm, "@w/scoped")), real("node_modules/@w/scoped"));
    // The workspace package resolves to the base commit's code, never the implemented one.
    assert.equal(readlinkSync(join(nm, "@w/pkg")), "../../packages/pkg");
    assert.equal(readFileSync(join(nm, "@w/pkg/index.mjs"), "utf8"), "export const v = 'base';\n");
    assert.equal(readFileSync(join(nm, "abs-pkg/index.mjs"), "utf8"), "export const v = 'base';\n");
    assert.equal(readFileSync(join(nm, ".bin/dep"), "utf8"), "export const dep = 1;\n");
    assert.equal(
      realpathSync(join(tree, "packages/pkg/node_modules/inner")),
      real("packages/pkg/node_modules/inner"),
    );
    assert.equal(existsSync(join(tree, "packages/fresh")), false, "the run added that package");
    assert.equal(sh(tree, "status", "--porcelain"), "", "the links are ignored like node_modules");
  });
  assert.deepEqual(readdirSync(join(w.path, "node_modules")).sort(), runModules);
  assert.deepEqual(readdirSync(join(w.path, "node_modules/.vite")), ["vitest"]);
  assert.deepEqual(readdirSync(join(w.path, "node_modules/.vite-temp")), [
    "vitest.config.ts.timestamp-1-ab.mjs",
  ]);
  assert.equal(readlinkSync(join(w.path, "node_modules/@w/pkg")), "../../packages/pkg");
  assert.equal(
    readFileSync(join(w.path, "node_modules/dep/index.mjs"), "utf8"),
    "export const dep = 1;\n",
  );
  assert.equal(w.git("status", "--porcelain"), "");
});

test(
  "D-RESEAL: a node_modules entry the base tree cannot be given is a BaseTreeError, before the work runs",
  { skip: typeof process.getuid === "function" && process.getuid() === 0 },
  () => {
    // A child with Bash, the executor for one, can leave the run worktree in this state.
    const w = runWorktree({ ".gitignore": "node_modules/\n" });
    w.write("node_modules/@x/a/index.mjs", "export const a = 1;\n");
    const scope = join(w.path, "node_modules/@x");
    const before = registered(w);
    chmodSync(scope, 0);
    try {
      assert.throws(
        () => wt.withBaseWorktree(baseTreeOf(w), () => assert.fail("the work must not run")),
        (error) =>
          error instanceof wt.BaseTreeError &&
          error.message === "node_modules/@x cannot be listed (EACCES)",
      );
    } finally {
      chmodSync(scope, 0o755);
    }
    assert.deepEqual(registered(w), before);
    assert.deepEqual(readdirSync(dirname(w.path)), [basename(w.path)], "nothing is left beside it");
  },
);

const TSLOAD = new URL("./_tsload.mjs", import.meta.url).href;

/**
 * An engine killed inside `withBaseWorktree`: a child process makes the base worktree, breaks its
 * `.git` the way test code can when `breakGit` is set, prints the tree's path and SIGKILLs itself,
 * so that no `finally` and no exit handler runs.
 */
function killedInside(w, breakGit = false) {
  const code = [
    'import { writeFileSync, writeSync } from "node:fs";',
    'import { join } from "node:path";',
    `const { importTs } = await import(${JSON.stringify(TSLOAD)});`,
    'const wt = await importTs("src/pipeline/worktree.ts");',
    "wt.withBaseWorktree(JSON.parse(process.argv[1]), (tree) => {",
    '  if (process.argv[2] === "break") writeFileSync(join(tree, ".git"), "gitdir: /nowhere\\n");',
    "  writeSync(1, tree);",
    '  process.kill(process.pid, "SIGKILL");',
    "});",
  ].join("\n");
  // Without the test runner's context, which would make the child a test file reporting to it.
  const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
  const r = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", code, JSON.stringify(baseTreeOf(w)), breakGit ? "break" : "keep"],
    { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.equal(r.signal, "SIGKILL", r.stderr);
  return r.stdout;
}

test("D-RESEAL: what an engine killed inside a base worktree left, even with its .git broken, the next one clears", () => {
  const w = runWorktree({ "a.txt": "base\n" });
  const before = registered(w);
  // What a killed engine leaves: its tree on disk and registered in the run's repository.
  const kept = killedInside(w);
  assert.ok(existsSync(kept));
  assert.deepEqual(registered(w).sort(), [...before, basename(kept)].sort());
  // The next engine clears it before it makes its own, and is killed after breaking that one's .git.
  const broken = killedInside(w, true);
  assert.deepEqual([existsSync(kept), existsSync(broken)], [false, true]);
  assert.deepEqual(registered(w).sort(), [...before, basename(broken)].sort());
  let seen;
  wt.withBaseWorktree(baseTreeOf(w), (tree) => {
    seen = tree;
    assert.deepEqual(registered(w).sort(), [...before, basename(tree)].sort());
    assert.equal(readFileSync(join(tree, "a.txt"), "utf8"), "base\n");
  });
  assert.deepEqual([existsSync(kept), existsSync(broken), existsSync(seen)], [false, false, false]);
  assert.deepEqual(registered(w), before);
  assert.deepEqual(readdirSync(dirname(w.path)), [basename(w.path)]);
});

test("D-RESEAL: clearing what a killed engine left never follows a link out of the base trees' directory", () => {
  const w = runWorktree({ "a.txt": "base\n" });
  let holder;
  wt.withBaseWorktree(baseTreeOf(w), (tree) => {
    holder = dirname(tree);
  });
  // The base trees have a directory of their own beside the run worktree, where a restarted
  // engine finds what a killed one left without guessing.
  assert.equal(dirname(holder), dirname(w.path));
  assert.notEqual(holder, w.path);

  // Another linked worktree of the same repository, with work in it, behind a planted link.
  const other = join(mkdtempSync(join(tmpdir(), "pipe-other-")), "other");
  w.git("worktree", "add", "--detach", other, w.baseSha);
  writeFileSync(join(other, "work.txt"), "uncommitted\n");
  mkdirSync(holder, { recursive: true });
  symlinkSync(other, join(holder, "t-planted"));
  const before = registered(w);
  wt.withBaseWorktree(baseTreeOf(w), () => {});
  assert.deepEqual(registered(w), before);
  assert.equal(readFileSync(join(other, "work.txt"), "utf8"), "uncommitted\n");
  assert.equal(existsSync(join(holder, "t-planted")), false, "the link itself is cleared");

  // The directory itself replaced by a link: what it points at is left alone.
  const elsewhere = mkdtempSync(join(tmpdir(), "pipe-elsewhere-"));
  writeFileSync(join(elsewhere, "keep.txt"), "keep\n");
  mkdirSync(join(elsewhere, "t-leftover"));
  rmSync(holder, { recursive: true, force: true });
  symlinkSync(elsewhere, holder);
  wt.withBaseWorktree(baseTreeOf(w), (tree) => {
    assert.equal(lstatSync(dirname(tree)).isSymbolicLink(), false);
  });
  assert.deepEqual(readdirSync(elsewhere).sort(), ["keep.txt", "t-leftover"]);
  assert.deepEqual(registered(w), before);
});

test(
  "D-RESEAL: a directory for the base trees that cannot hold one is a BaseTreeError, before the work runs",
  { skip: typeof process.getuid === "function" && process.getuid() === 0 },
  () => {
    const w = runWorktree({ "a.txt": "base\n" });
    let holder;
    wt.withBaseWorktree(baseTreeOf(w), (tree) => {
      holder = dirname(tree);
    });
    mkdirSync(holder);
    chmodSync(holder, 0o500);
    const before = registered(w);
    try {
      assert.throws(
        () => wt.withBaseWorktree(baseTreeOf(w), () => assert.fail("the work must not run")),
        (error) =>
          error instanceof wt.BaseTreeError &&
          error.message === `${holder} cannot hold a base tree (EACCES)`,
      );
    } finally {
      chmodSync(holder, 0o755);
    }
    assert.deepEqual(registered(w), before);
  },
);
