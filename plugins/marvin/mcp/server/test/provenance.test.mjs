import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { importTs } from "./_tsload.mjs";

/**
 * Unit tests for the evidence digest and the freshness classifier
 * (`src/lib/provenance.ts`, ADR-0035). Exercised directly through `_tsload.mjs`
 * against tmp-dir git repositories — never the repository under test — so they
 * need no server build and no toolchain beyond `git`.
 *
 * Two of these fixtures are the difference between a criterion that can fail and
 * one that cannot. The digest's mechanism was chosen over two alternatives that
 * pass every small fixture and break on the changes that matter: hashing patch
 * text dies on Node's 1 MiB `spawnSync` default, and hashing `--numstat` plus the
 * `--raw` blob ids cannot see an edit that keeps the line counts identical. Both
 * traps are reproduced here, so a later "simplification" back to either fails.
 */
const { collectProvenance, worktreeDigest, classifyStaleness } =
  await importTs("src/lib/provenance.ts");

/** A tmp-dir repository with one commit. Returns its path. */
function seedRepo(prefix, files = { "a.txt": "a\nb\nc\n" }) {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  const g = (...args) => execFileSync("git", args, { cwd: repo });
  g("init", "-q");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "Test");
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(repo, name, ".."), { recursive: true });
    writeFileSync(join(repo, name), body);
  }
  g("add", "-A");
  g("commit", "-q", "-m", "init");
  return repo;
}

test("the worktree digest excludes .marvin, moves on a tracked edit, and fails open outside a repository", () => {
  const repo = seedRepo("marvin-prov-");
  try {
    const clean = worktreeDigest(repo);
    assert.match(clean, /^[0-9a-f]{16}$/, "a clean tree still has a digest");

    // .marvin/ is excluded by an explicit pathspec, not by .gitignore: the run
    // file a verification is about to write must not land in its own digest.
    mkdirSync(join(repo, ".marvin", "task", "runs"), { recursive: true });
    writeFileSync(join(repo, ".marvin", "task", "verification.md"), "# Verification\n");
    writeFileSync(join(repo, ".marvin", "task", "runs", "demo.md"), "# Verification\n");
    assert.equal(worktreeDigest(repo), clean, "writing under .marvin/ leaves the digest unchanged");

    // ... while a tracked source edit moves it.
    writeFileSync(join(repo, "a.txt"), "a\nb\nCHANGED\n");
    const edited = worktreeDigest(repo);
    assert.match(edited, /^[0-9a-f]{16}$/);
    assert.notEqual(edited, clean, "a tracked edit changes the digest");

    // ... and an untracked source file moves it too.
    writeFileSync(join(repo, "new.txt"), "brand new\n");
    assert.notEqual(worktreeDigest(repo), edited, "an untracked file changes the digest");

    // Full provenance on a real worktree.
    const prov = collectProvenance(repo);
    assert.match(prov.head_sha, /^[0-9a-f]{40}$/);
    assert.equal(typeof prov.branch, "string");
    assert.equal(prov.dirty, true);
    assert.match(prov.worktree_digest, /^[0-9a-f]{16}$/);
    assert.doesNotThrow(() => new Date(prov.generated_at).toISOString());
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }

  // Outside a git worktree: null everywhere, no throw, the run still completes.
  const plain = mkdtempSync(join(tmpdir(), "marvin-prov-nogit-"));
  try {
    assert.equal(collectProvenance(plain), null, "not a worktree — no provenance, no error");
    assert.equal(worktreeDigest(plain), null);
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
});

test("the digest survives a diff larger than the spawnSync buffer and separates two same-line-count edits", () => {
  // Half one — the buffer trap. Build a tree whose `git diff HEAD` genuinely
  // exceeds Node's 1 MiB spawnSync default, and prove it does before asserting
  // on the digest: a small fixture proves nothing here, because the rejected
  // design passed every small fixture.
  const repo = seedRepo("marvin-prov-big-", { "big.txt": "a".repeat(2 * 1024 * 1024) + "\n" });
  try {
    const clean = worktreeDigest(repo);
    writeFileSync(join(repo, "big.txt"), "b".repeat(2 * 1024 * 1024) + "\n");

    const patch = spawnSync("git", ["diff", "HEAD"], { cwd: repo, encoding: "utf8" });
    assert.ok(
      patch.error && /ENOBUFS/.test(String(patch.error.code ?? patch.error.message)),
      "fixture must exceed the 1 MiB spawnSync default — otherwise this test proves nothing",
    );

    const big = worktreeDigest(repo);
    assert.match(big, /^[0-9a-f]{16}$/, "the digest is computed, not lost to the buffer");
    assert.notEqual(big, clean, "and it moved");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }

  // Half two — the content trap. One line edited to two different values leaves
  // `--numstat` and `--raw` byte-identical (the destination blob of a worktree
  // modification is all-zeros), so a digest over those reads could not tell the
  // two trees apart. This one can.
  const repo2 = seedRepo("marvin-prov-line-", { "a.txt": "one\ntwo\n" });
  try {
    const shape = () =>
      execFileSync("git", ["diff", "HEAD", "--numstat", "--raw"], {
        cwd: repo2,
        encoding: "utf8",
      });

    writeFileSync(join(repo2, "a.txt"), "ZZZZ\ntwo\n");
    const shapeZ = shape();
    const digestZ = worktreeDigest(repo2);

    writeFileSync(join(repo2, "a.txt"), "YYYY\ntwo\n");
    const shapeY = shape();
    const digestY = worktreeDigest(repo2);

    assert.equal(shapeZ, shapeY, "the rejected input is byte-identical for both edits");
    assert.notEqual(digestZ, digestY, "the shipped digest separates them");
  } finally {
    rmSync(repo2, { recursive: true, force: true });
  }
});

test("a path git cannot express, and a tree past the path cap, decline to answer rather than guess", () => {
  const repo = seedRepo("marvin-prov-newline-");
  try {
    // `hash-object --stdin-paths` is newline-delimited, so a path containing one
    // cannot be hashed. Declining (null → unknown → ALLOW) is the fail-open
    // direction; mis-hashing it would be a confidently wrong "fresh".
    writeFileSync(join(repo, "we\nird.txt"), "x\n");
    assert.equal(worktreeDigest(repo), null, "a newline in a path degrades to null");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }

  // The one remaining unbounded dimension is the number of paths, so it carries
  // an explicit cap that degrades the same way rather than answering from a read
  // it cannot bound.
  const wide = seedRepo("marvin-prov-wide-");
  try {
    mkdirSync(join(wide, "many"), { recursive: true });
    for (let i = 0; i <= 5000; i++) writeFileSync(join(wide, "many", `f${i}.txt`), "x\n");
    assert.equal(worktreeDigest(wide), null, "past the 5,000-path cap the digest declines");
  } finally {
    rmSync(wide, { recursive: true, force: true });
  }
});

test("classifyStaleness fails open on every missing or null term", () => {
  const at = (digest, sha) => ({
    head_sha: sha,
    branch: "dev",
    dirty: true,
    worktree_digest: digest,
    generated_at: "2026-08-13T00:00:00.000Z",
  });

  assert.equal(classifyStaleness(at("d1", "s1"), at("d1", "s1")), "fresh");
  assert.equal(classifyStaleness(at("d1", "s1"), at("d2", "s1")), "stale", "digest moved");
  assert.equal(classifyStaleness(at("d1", "s1"), at("d1", "s2")), "stale", "HEAD moved");

  assert.equal(classifyStaleness(undefined, at("d1", "s1")), "unknown", "no recorded provenance");
  assert.equal(classifyStaleness(at("d1", "s1"), null), "unknown", "not a worktree now");
  assert.equal(
    classifyStaleness(at(null, "s1"), at("d1", "s1")),
    "unknown",
    "recorded digest null",
  );
  assert.equal(classifyStaleness(at("d1", "s1"), at(null, "s1")), "unknown", "current digest null");
  // The null rule is stated over BOTH fields deliberately: a matching digest
  // beside a null head_sha must not read as `stale` and BLOCK.
  assert.equal(classifyStaleness(at("d1", null), at("d1", "s1")), "unknown", "recorded sha null");
  assert.equal(classifyStaleness(at("d1", "s1"), at("d1", null)), "unknown", "current sha null");
});
