import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, unlinkSync } from "node:fs";
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

test("a main-checkout snapshot catches a child writing outside its worktree (S10)", () => {
  const repo = repoWithOrigin();
  const before = wt.snapshotTree(repo);
  writeFileSync(join(repo, "leak.txt"), "x");
  assert.deepEqual(wt.diffSnapshots(before, wt.snapshotTree(repo)), ["?? leak.txt"]);
});

test("snapshot content hashing detects overwrites, reverts, deletions on a dirty tree", () => {
  const repo = repoWithOrigin({ "b.txt": "b\n" });
  const b = join(repo, "b.txt");
  writeFileSync(b, "modified\n");
  const before = wt.snapshotTree(repo);
  writeFileSync(b, "different\n");
  const after1 = wt.snapshotTree(repo);
  const diff1 = wt.diffSnapshots(before, after1);
  assert.ok(diff1.some((d) => d.includes("(content changed)")));
  sh(repo, "checkout", "--", "b.txt");
  const after2 = wt.snapshotTree(repo);
  const diff2 = wt.diffSnapshots(before, after2);
  assert.ok(diff2.some((d) => d.includes("removed  M b.txt")));
});

test("snapshot detects untracked file deletion and content changes", () => {
  const repo = repoWithOrigin();
  const u = join(repo, "u.txt");
  writeFileSync(u, "untracked\n");
  const before = wt.snapshotTree(repo);
  unlinkSync(u);
  const after = wt.snapshotTree(repo);
  const diff = wt.diffSnapshots(before, after);
  assert.ok(diff.some((d) => d.includes("removed ?? u.txt")));
});

test("snapshot detects HEAD movement", () => {
  const repo = repoWithOrigin();
  const before = wt.snapshotTree(repo);
  writeFileSync(join(repo, "c.txt"), "commit\n");
  sh(repo, "add", ".");
  sh(repo, "commit", "-m", "second");
  const after = wt.snapshotTree(repo);
  const diff = wt.diffSnapshots(before, after);
  assert.ok(diff.some((d) => d.startsWith("HEAD")));
});

test("tree snapshot detects new untracked files", () => {
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
