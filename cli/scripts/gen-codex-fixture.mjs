#!/usr/bin/env node
// Regenerates cli/test/fixtures/codex/marvin-core-pack/ by ejecting the live
// pack with a fixed `today` so the test diff is deterministic. Run this after
// bumping marvin-core-pack's version, or after intentional changes to the
// codex adapter's render output.
//
//   node cli/scripts/gen-codex-fixture.mjs

import { promises as fs } from "node:fs";
import path from "node:path";
import url from "node:url";

import { run as runEject } from "../src/lib/eject-core.mjs";
import codexAdapter from "../src/adapters/codex.mjs";

const FIXED_TODAY = "2026-05-08";

async function main() {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const cliRoot = path.resolve(here, "..");
  const repoRoot = path.resolve(cliRoot, "..");
  const fixtureRoot = path.join(cliRoot, "test", "fixtures", "codex", "marvin-core-pack");

  // Wipe stale fixture to catch deletions/renames.
  await fs.rm(fixtureRoot, { recursive: true, force: true });
  await fs.mkdir(fixtureRoot, { recursive: true });

  const code = await runEject(
    ["marvin-core-pack", "--source", repoRoot, "--apply"],
    { cwd: fixtureRoot, projectRoot: fixtureRoot, adapter: codexAdapter, today: FIXED_TODAY,
      stdout: { write: () => {} } },
  );
  if (code !== 0) {
    process.stderr.write(`gen-codex-fixture: eject failed with exit ${code}\n`);
    process.exit(1);
  }

  console.log(`fixture regenerated at ${path.relative(repoRoot, fixtureRoot)} (today=${FIXED_TODAY})`);
  console.log("commit the result; CI diffs against this tree.");
}

main().catch((err) => { console.error(err); process.exit(1); });
