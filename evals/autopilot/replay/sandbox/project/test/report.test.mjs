import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/csv.mjs";
import { totals } from "../src/report.mjs";

test("parseCsv splits rows and fields", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("totals sums a column", () => {
  assert.equal(totals("item,amount\npen,2\nink,3\n", "amount"), 5);
  assert.throws(() => totals("item\npen\n", "amount"), RangeError);
});
