import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importTs } from "./_tsload.mjs";

/**
 * The fork point a task's diff and commit list are measured from. A host's
 * local base branch is not updated in a worktree, so the merge base with it
 * drifts back by thousands of commits and every file the base gained since
 * then was counted as an undeclared change of the task (scope drift Q1). The
 * remote-tracking ref is what the task branch was actually cut from.
 */

const { changedFilesForScope, resolveBaseRef } = await importTs("src/lib/git.ts");
const { readCommits } = await importTs("src/tools/summary.ts");

const sh = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function commitFiles(repo, message, files) {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), body);
  }
  sh(repo, "add", "-A");
  sh(repo, "commit", "-qm", message);
}

function initRepo(root, name) {
  const repo = join(root, name);
  sh(root, "init", "-q", "-b", "staging", repo);
  sh(repo, "config", "user.email", "t@t");
  sh(repo, "config", "user.name", "t");
  sh(repo, "config", "commit.gpgsign", "false");
  commitFiles(repo, "init", { "README.md": "init\n" });
  return repo;
}

/**
 * Local `staging` stays at the clone point; `origin/staging` gains five commits
 * touching twenty files; the task branch is cut from `origin/staging` and
 * changes two files in two commits.
 */
function laggingLocalBase() {
  const root = mkdtempSync(join(tmpdir(), "base-ref-"));
  const upstream = initRepo(root, "upstream");
  const repo = join(root, "repo");
  sh(root, "clone", "-q", upstream, repo);
  sh(repo, "config", "user.email", "t@t");
  sh(repo, "config", "user.name", "t");
  sh(repo, "config", "commit.gpgsign", "false");
  for (let i = 0; i < 5; i++) {
    const files = {};
    for (let j = 0; j < 4; j++) files[`upstream/m${i}/f${j}.ts`] = `export const v = ${i}${j};\n`;
    commitFiles(upstream, `upstream ${i}`, files);
  }
  sh(repo, "fetch", "-q", "origin");
  sh(repo, "checkout", "-qb", "task", "origin/staging");
  commitFiles(repo, "task one", { "src/a.ts": "export const a = 1;\n" });
  commitFiles(repo, "task two", { "src/b.ts": "export const b = 1;\n" });
  return { root, repo };
}

test("a lagging local base: the diff and the commit list are taken from origin/<base>", () => {
  const { root, repo } = laggingLocalBase();
  try {
    assert.equal(resolveBaseRef("staging", repo), "origin/staging");
    assert.deepEqual(changedFilesForScope(repo, "staging").sort(), ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(
      readCommits(repo, "staging").map((c) => c.subject),
      ["task two", "task one"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a base that already names a remote-tracking ref is used as is", () => {
  const { root, repo } = laggingLocalBase();
  try {
    assert.equal(resolveBaseRef("origin/staging", repo), "origin/staging");
    assert.deepEqual(changedFilesForScope(repo, "origin/staging").sort(), ["src/a.ts", "src/b.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no remote: the local base branch is used, as before", () => {
  const root = mkdtempSync(join(tmpdir(), "base-ref-"));
  try {
    const repo = initRepo(root, "solo");
    sh(repo, "checkout", "-qb", "task");
    commitFiles(repo, "task one", { "src/a.ts": "export const a = 1;\n" });
    sh(repo, "checkout", "-q", "staging");
    commitFiles(repo, "base moved on", { "src/other.ts": "export const o = 1;\n" });
    sh(repo, "checkout", "-q", "task");
    commitFiles(repo, "task two", { "src/b.ts": "export const b = 1;\n" });

    assert.equal(resolveBaseRef("staging", repo), "staging");
    assert.deepEqual(changedFilesForScope(repo, "staging").sort(), ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(
      readCommits(repo, "staging").map((c) => c.subject),
      ["task two", "task one"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("HEAD and an absent base are left alone", () => {
  assert.equal(resolveBaseRef("HEAD", tmpdir()), "HEAD");
});
