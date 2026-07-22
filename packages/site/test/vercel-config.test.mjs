// vercel-config.test.mjs (spec 015, F5 → AC4) — the deploy contract, shape-guarded.
//
// vercel.json is committed JSON at the repo root, so its load-bearing fields are assertable from
// disk on both CI legs without a Vercel deployment. This turns "someone changed the output dir and
// the deploy silently serves nothing" into a build failure. Read via readFileSync + JSON.parse (not
// import) to match the repo's node:test convention and to run on the Node-20 leg with no transpile.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
// packages/site/test -> packages/site -> packages -> repo root
const vercel = JSON.parse(readFileSync(join(here, "..", "..", "..", "vercel.json"), "utf8"));

test("vercel.json builds the site workspace to packages/site/dist", () => {
  assert.equal(
    vercel.outputDirectory,
    "packages/site/dist",
    "static output must point at the site's dist, or the deploy serves nothing",
  );
  assert.match(
    vercel.buildCommand,
    /@marvin-toolkit\/site/,
    "buildCommand must target the site workspace",
  );
  assert.match(
    vercel.ignoreCommand,
    /vercel-ignore\.mjs/,
    "ignoreCommand must run the build-skip script (spec 015, F2)",
  );
});
