// Regression tests for the committed-artifact drift guards.
//
// The defect these cover: both guards rebuild their artifact in place, and CI runs
// "Build all workspaces" before either of them, so a baseline read from the working
// tree was already the fresh build. The comparison was rebuild-vs-rebuild and could
// not fail — a server bundle built inside a git worktree reached `dev` past two
// green guard steps. Every test below asserts the baseline survives exactly that:
// a working-tree file overwritten before the guard looks at it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifyRebuild,
  gitPath,
  hashBytes,
  readCommittedBytes,
} from "../scripts/lib/committed-artifact.mjs";

const COMMITTED = "committed artifact bytes\n";
const OVERWRITTEN = "what a build step left behind\n";

/** A throwaway repository with one committed file at `dist/artifact.js`. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "marvin-guard-"));
  const run = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  run("init", "--quiet");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test");
  run("config", "commit.gpgsign", "false");
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist", "artifact.js"), COMMITTED);
  run("add", "dist/artifact.js");
  run("commit", "--quiet", "--no-verify", "-m", "commit the artifact");
  return { root, file: join(root, "dist", "artifact.js") };
}

test("the baseline comes from the commit, not from a working tree a build overwrote", () => {
  const { root, file } = makeRepo();
  try {
    // Exactly what "Build all workspaces" does before the guard runs in CI.
    writeFileSync(file, OVERWRITTEN);

    const { bytes, reason } = readCommittedBytes(root, file);
    assert.equal(reason, null);
    assert.equal(bytes.toString(), COMMITTED, "must read HEAD, not the overwritten file");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a stale commit is caught even though the working tree matches the rebuild", () => {
  const { root, file } = makeRepo();
  try {
    // The CI shape: the build step already wrote the fresh bundle over the stale
    // committed one, so worktreeBefore === rebuilt. The old guard compared those
    // two and reported success.
    writeFileSync(file, OVERWRITTEN);
    const rebuilt = hashBytes(Buffer.from(OVERWRITTEN));
    const { bytes } = readCommittedBytes(root, file);

    const verdict = classifyRebuild({
      baseline: hashBytes(bytes),
      worktreeBefore: rebuilt,
      rebuilt,
    });
    assert.equal(verdict.ok, false, "a stale committed artifact must fail the guard");
    assert.equal(verdict.kind, "uncommitted");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an artifact built from a different tree is reported as drift, not as unstaged", () => {
  const verdict = classifyRebuild({
    baseline: "aaa",
    worktreeBefore: "bbb",
    rebuilt: "ccc",
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.kind, "drift");
});

test("a reproducible artifact passes", () => {
  const verdict = classifyRebuild({
    baseline: "aaa",
    worktreeBefore: "aaa",
    rebuilt: "aaa",
  });
  assert.deepEqual(verdict, { ok: true, kind: "in-sync" });
});

test("a path absent at HEAD reports why instead of throwing", () => {
  const { root } = makeRepo();
  try {
    const { bytes, reason } = readCommittedBytes(root, join(root, "dist", "never-committed.js"));
    assert.equal(bytes, null);
    assert.match(reason, /never-committed\.js/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no repository reports why instead of throwing", () => {
  const root = mkdtempSync(join(tmpdir(), "marvin-norepo-"));
  try {
    writeFileSync(join(root, "artifact.js"), COMMITTED);
    const { bytes, reason } = readCommittedBytes(root, join(root, "artifact.js"));
    assert.equal(bytes, null);
    assert.ok(reason.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gitPath produces the repo-relative, forward-slash form git show expects", () => {
  assert.equal(
    gitPath("/repo", "/repo/plugins/marvin/mcp/server/dist/server.js"),
    "plugins/marvin/mcp/server/dist/server.js",
  );
});
