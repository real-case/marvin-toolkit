import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
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
    "branch should have no upstream",
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

test("a main-checkout snapshot catches a child writing outside its worktree (S10)", () => {
  const repo = repoWithOrigin();
  const before = wt.snapshotTree(repo);
  writeFileSync(join(repo, "leak.txt"), "x");
  assert.deepEqual(wt.diffSnapshots(before, wt.snapshotTree(repo)), ["?? leak.txt"]);
});

test("a tree snapshot notices any write, tracked or not", () => {
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
