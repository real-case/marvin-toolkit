#!/usr/bin/env node
// Syncs cli/src/lib/eject-core.mjs from the canonical copy in
// plugins/marvin-core-pack/skills/mn.eject/eject-core.mjs.
//
// Why two copies: the canonical file must live INSIDE the plugin folder
// so the marketplace install (`/plugin install`) ships it with the skill;
// the CLI publishes its own subset to npm and can't reference paths
// outside its package root. Sync is one-way (plugin → cli) and CI-guarded
// against drift via `--check` mode.
//
//   node scripts/sync-core.mjs           # copy plugin → cli
//   node scripts/sync-core.mjs --check   # exit 1 if cli copy differs

import { promises as fs } from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const cliRoot = path.resolve(here, "..");
const repoRoot = path.resolve(cliRoot, "..");
const SRC = path.join(repoRoot, "plugins", "marvin-core-pack", "skills", "mn.eject", "eject-core.mjs");
const DST = path.join(cliRoot, "src", "lib", "eject-core.mjs");

const HEADER = "// AUTO-GENERATED — synced from plugins/marvin-core-pack/skills/mn.eject/eject-core.mjs\n// Do not edit directly. Run `npm run sync-core` from cli/ after changing the canonical file.\n\n";

async function main() {
  const check = process.argv.includes("--check");
  const source = await fs.readFile(SRC, "utf8");
  const expected = HEADER + source;

  if (check) {
    let actual;
    try { actual = await fs.readFile(DST, "utf8"); }
    catch { console.error(`drift: ${path.relative(repoRoot, DST)} is missing`); process.exit(1); }
    if (actual !== expected) {
      console.error(`drift: ${path.relative(repoRoot, DST)} is out of sync with ${path.relative(repoRoot, SRC)}`);
      console.error(`run \`npm run sync-core\` (from cli/) and commit the result`);
      process.exit(1);
    }
    console.log("ok: cli/src/lib/eject-core.mjs is in sync");
    return;
  }

  await fs.mkdir(path.dirname(DST), { recursive: true });
  await fs.writeFile(DST, expected);
  console.log(`synced: ${path.relative(repoRoot, SRC)} → ${path.relative(repoRoot, DST)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
