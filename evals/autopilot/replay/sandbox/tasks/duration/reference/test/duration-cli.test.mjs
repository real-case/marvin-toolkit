import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/duration.mjs", import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

test("the CLI prints the milliseconds of its argument", () => {
  const r = run("1m5s");
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "65000");
});

test("the CLI exits 2 on a bad duration", () => {
  assert.equal(run("soon").status, 2);
});
