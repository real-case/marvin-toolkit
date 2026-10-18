// The fast selection `npm run test:fast` runs (scripts/test-fast.mjs) is the whole suite minus a
// named list of slow files. These tests pin the list to the tree: every name in it is a file the
// `test` script's glob would run, the two sets partition the suite, and the two npm scripts keep
// the shape the repository's `gates.test` and CI rely on.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { SLOW, allTestFiles, fastTestFiles } from "../scripts/test-fast.mjs";

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(serverRoot, "package.json"), "utf8"));

test("every SLOW entry is a test file the suite's glob selects", () => {
  const all = allTestFiles();
  for (const f of SLOW) {
    assert.ok(all.includes(f), `${f} is named in SLOW but test/${f} does not exist`);
    assert.match(f, /\.test\.mjs$/);
  }
  assert.deepEqual([...SLOW], [...SLOW].sort(), "SLOW is kept sorted");
  assert.equal(new Set(SLOW).size, SLOW.length, "SLOW has no duplicates");
});

test("the fast set and SLOW partition the suite", () => {
  const all = allTestFiles();
  const fast = fastTestFiles();
  assert.deepEqual([...fast, ...SLOW].sort(), all);
  assert.ok(fast.includes("test-fast.test.mjs"), "this file runs in the fast set");
  assert.ok(fast.length > SLOW.length, "the fast set is the larger half");
});

test("a SLOW entry that names no file fails the selection instead of running everything", () => {
  const root = mkdtempSync(join(tmpdir(), "test-fast-"));
  mkdirSync(join(root, "test"));
  writeFileSync(join(root, "test", "quick.test.mjs"), "");
  writeFileSync(join(root, "test", SLOW[0]), "");
  assert.throws(
    () => fastTestFiles(root),
    (error) =>
      error.message.includes("do not exist") &&
      error.message.includes(SLOW[1]) &&
      !error.message.includes(SLOW[0]),
    "the error names exactly the missing entries",
  );
});

test("the npm scripts keep the shape CI and gates.test rely on", () => {
  assert.equal(
    pkg.scripts.test,
    "node --test --test-concurrency=4 test/*.test.mjs",
    "`npm test` is the whole suite: CI runs it, and the fast set never replaces it there",
  );
  assert.equal(pkg.scripts["test:fast"], "node scripts/test-fast.mjs");
});
