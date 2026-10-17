import { test } from "node:test";
import assert from "node:assert/strict";
import { totals } from "../src/report.mjs";

test("totals sums a column whose rows hold quoted fields", () => {
  const csv = 'item,amount\n"pen, blue",2\n"ink ""black""","3"\n';
  assert.equal(totals(csv, "amount"), 5);
});
