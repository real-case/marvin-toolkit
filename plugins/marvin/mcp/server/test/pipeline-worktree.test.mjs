import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { importTs } from "./_tsload.mjs";
import { repoWithOrigin, sh } from "./_pipeline-git.mjs";

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
