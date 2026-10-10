import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, parseDuration } from "../src/index.mjs";

test("parseDuration reads unit groups in order", () => {
  assert.equal(parseDuration("1h30m"), 5_400_000);
  assert.equal(parseDuration("45s"), 45_000);
  assert.equal(parseDuration("2m500ms"), 120_500);
  assert.equal(parseDuration("250ms"), 250);
});

test("parseDuration refuses anything else", () => {
  for (const bad of ["", "1x", "30m1h", "1.5h", "h", " 1h"]) {
    assert.throws(() => parseDuration(bad), TypeError, bad);
  }
});

test("formatDuration is the inverse and omits zero units", () => {
  assert.equal(formatDuration(5_400_000), "1h30m");
  assert.equal(formatDuration(120_500), "2m500ms");
  assert.equal(formatDuration(0), "0ms");
  for (const text of ["1h", "1h1m1s1ms", "59s"]) {
    assert.equal(formatDuration(parseDuration(text)), text);
  }
});
