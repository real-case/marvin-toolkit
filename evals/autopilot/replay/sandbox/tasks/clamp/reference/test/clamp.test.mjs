import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp } from "../src/math.mjs";

test("clamp keeps a value inside the range", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(0, 0, 10), 0);
  assert.equal(clamp(10, 0, 10), 10);
});

test("clamp bounds a value outside the range", () => {
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(42, 0, 10), 10);
  assert.equal(clamp(7, 7, 7), 7);
});

test("clamp throws a RangeError when lo > hi", () => {
  assert.throws(() => clamp(1, 10, 0), RangeError);
});
