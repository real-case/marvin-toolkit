// The fake test-author's work: the acceptance test for AC1, uncommitted, as the role leaves it.
// It must fail before the executor implements `clamp`, which the engine's red run checks.
import { writeFileSync } from "node:fs";

writeFileSync(
  "test/clamp.test.mjs",
  [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'import * as math from "../src/math.mjs";',
    "",
    'test("AC1: clamp bounds x to [lo, hi]", () => {',
    "  assert.equal(math.clamp(5, 0, 10), 5);",
    "  assert.equal(math.clamp(-1, 0, 10), 0);",
    "  assert.equal(math.clamp(11, 0, 10), 10);",
    "});",
    "",
  ].join("\n"),
);
