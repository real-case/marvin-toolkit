import { test } from "node:test";
import assert from "node:assert/strict";
import { add, mean } from "../src/math.mjs";

test("add sums two numbers", () => {
  assert.equal(add(2, 3), 5);
});

test("mean averages and refuses an empty array", () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.throws(() => mean([]), RangeError);
});
