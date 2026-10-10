import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/strings.mjs";

test("slugify lower-cases and joins words with one hyphen", () => {
  assert.equal(slugify("  Hello, World! "), "hello-world");
  assert.equal(slugify("Release 2.0 -- final"), "release-2-0-final");
});

test("slugify strips leading and trailing separators and keeps digits", () => {
  assert.equal(slugify("--abc123--"), "abc123");
  assert.equal(slugify("***"), "");
  assert.equal(slugify("already-a-slug"), "already-a-slug");
});
