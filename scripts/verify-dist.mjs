#!/usr/bin/env node
// Guard: every pack MCP server has a built dist/server.js, and rebuilding
// produces an identical bundle. Used in CI to catch stale dist commits.

import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginsDir = join(repoRoot, "plugins");

const packs = readdirSync(pluginsDir).filter((name) => {
  const serverPkg = join(pluginsDir, name, "mcp", "server", "package.json");
  return existsSync(serverPkg);
});

if (packs.length === 0) {
  console.log("verify-dist: no packs with mcp/server found — nothing to check");
  process.exit(0);
}

let failures = 0;

for (const pack of packs) {
  const serverDir = join(pluginsDir, pack, "mcp", "server");
  const distFile = join(serverDir, "dist", "server.js");

  if (!existsSync(distFile)) {
    console.error(`FAIL [${pack}]: dist/server.js missing — run npm run build`);
    failures += 1;
    continue;
  }

  const committedHash = hashFile(distFile);
  try {
    execSync("npm run build --silent", { cwd: serverDir, stdio: "inherit" });
  } catch (err) {
    console.error(`FAIL [${pack}]: build failed: ${err.message}`);
    failures += 1;
    continue;
  }
  const rebuiltHash = hashFile(distFile);

  if (committedHash !== rebuiltHash) {
    console.error(
      `FAIL [${pack}]: committed dist/server.js differs from fresh build.\n` +
        `  committed: ${committedHash}\n` +
        `  rebuilt:   ${rebuiltHash}\n` +
        `  fix: cd ${serverDir} && npm run build && git add dist/`,
    );
    failures += 1;
  } else {
    console.log(`OK   [${pack}]: dist/server.js in sync`);
  }
}

if (failures > 0) {
  console.error(`\nverify-dist: ${failures} pack(s) out of sync`);
  process.exit(1);
}
console.log(`\nverify-dist: all ${packs.length} pack(s) in sync`);

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
