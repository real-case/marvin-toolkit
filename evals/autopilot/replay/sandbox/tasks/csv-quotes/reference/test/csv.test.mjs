import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/csv.mjs";

test("unquoted fields parse as before", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n"), [
    ["a", "b"],
    ["1", "2"],
  ]);
  assert.deepEqual(parseCsv("x,,z"), [["x", "", "z"]]);
});

test("a quoted field may hold commas, newlines and doubled quotes", () => {
  assert.deepEqual(parseCsv('name,quote\n"Smith, J.","He said ""hi""\nthen left"\n'), [
    ["name", "quote"],
    ["Smith, J.", 'He said "hi"\nthen left'],
  ]);
});

test("an unterminated quoted field is a SyntaxError", () => {
  assert.throws(() => parseCsv('a,"b\n'), SyntaxError);
});
