import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { importTs } from "./_tsload.mjs";

/**
 * `importersOf` (src/lib/callers.ts): the tracked, non-test files that import a file, by the
 * imports it can resolve without a build. It feeds the DoR gate's `risk-callers` warning.
 */

const c = await importTs("src/lib/callers.ts");

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "marvin-callers-"));
  const g = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  g("init", "-q", "-b", "main");
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  g("add", "-A");
  return dir;
}

test("relative JavaScript imports in every form are callers; tests and the file itself are not", () => {
  const dir = repo({
    "src/csv.mjs": "export function parseCsv() {}\n",
    "src/report.mjs": 'import { parseCsv } from "./csv.mjs";\n',
    "src/lazy.mjs": 'const m = await import("./csv.mjs");\n',
    "src/legacy.cjs": 'const { parseCsv } = require("./csv.mjs");\n',
    "src/reexport.mjs": 'export { parseCsv } from "./csv.mjs";\n',
    "lib/deep/use.ts": 'import { parseCsv } from "../../src/csv.mjs";\n',
    "test/csv.test.mjs": 'import { parseCsv } from "../src/csv.mjs";\n',
    "src/csv.spec.mjs": 'import { parseCsv } from "./csv.mjs";\n',
    "src/other.mjs": 'import { x } from "./csvx.mjs";\n// csv mentioned in prose\n',
    "README.md": 'import { parseCsv } from "./src/csv.mjs";\n',
  });
  assert.deepEqual(c.importersOf(dir, "src/csv.mjs", 10), [
    "lib/deep/use.ts",
    "src/lazy.mjs",
    "src/legacy.cjs",
    "src/reexport.mjs",
    "src/report.mjs",
  ]);
  assert.deepEqual(c.importersOf(dir, "src/csv.mjs", 2).length, 2);
});

test("a TypeScript source imported as .js, extensionless, or as a directory index is found", () => {
  const dir = repo({
    "src/a.ts": "export const a = 1;\n",
    "src/util/index.ts": "export const u = 1;\n",
    "src/b.ts": 'import { a } from "./a.js";\n',
    "src/c.ts": 'import { a } from "./a";\n',
    "src/d.ts": 'import { u } from "./util";\n',
  });
  assert.deepEqual(c.importersOf(dir, "src/a.ts"), ["src/b.ts", "src/c.ts"]);
  assert.deepEqual(c.importersOf(dir, "src/util/index.ts"), ["src/d.ts"]);
});

test("Python dotted imports are followed; package names and unresolvable imports are not", () => {
  const dir = repo({
    "app/billing/rates.py": "RATE = 1\n",
    "app/main.py": "from app.billing.rates import RATE\n",
    "app/cli.py": "import billing.rates\n",
    "app/other.py": "import ratesx\nimport requests\n",
    "tests/test_rates.py": "from app.billing.rates import RATE\n",
    "web/ui.ts": 'import { rates } from "rates";\n',
  });
  assert.deepEqual(c.importersOf(dir, "app/billing/rates.py"), ["app/cli.py", "app/main.py"]);
});

test("nothing is reported for a test file, a non-code file, or outside a git repository", () => {
  const dir = repo({
    "src/a.mjs": 'import "./b.mjs";\n',
    "src/b.mjs": "export {};\n",
    "test/b.test.mjs": "export {};\n",
    "src/test.mjs": 'import "../test/b.test.mjs";\n',
  });
  assert.deepEqual(c.importersOf(dir, "src/b.mjs"), ["src/a.mjs"]);
  assert.deepEqual(c.importersOf(dir, "test/b.test.mjs"), []);
  assert.deepEqual(c.importersOf(dir, "README.md"), []);
  assert.deepEqual(c.importersOf(mkdtempSync(join(tmpdir(), "marvin-nogit-")), "src/b.mjs"), []);
  assert.equal(c.isTestPath("pkg/foo_test.go"), true);
  assert.equal(c.isTestPath("src/contest.mjs"), false);
});
