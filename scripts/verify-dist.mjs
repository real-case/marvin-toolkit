#!/usr/bin/env node
// Guard: every pack MCP server has a built dist/server.js, and rebuilding
// produces an identical bundle. Used in CI to catch stale dist commits.
//
// The baseline is read from git, not from the working tree: this script rebuilds
// in place, and so does the "Build all workspaces" step that runs before it in CI,
// which would otherwise leave it comparing a fresh build against itself. See
// scripts/lib/committed-artifact.mjs.

import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyRebuild,
  gitPath,
  hashBytes,
  hashFile,
  readCommittedBytes,
} from "./lib/committed-artifact.mjs";

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

// Every bundle a pack's server build emits: the MCP server and, beside it, the autopilot
// pipeline's `marvin-pipe` CLI. One build produces both, so each is checked against that build.
const BUNDLES = ["server.js", "marvin-pipe.js"];

for (const pack of packs) {
  const serverDir = join(pluginsDir, pack, "mcp", "server");
  const bundles = BUNDLES.map((name) => {
    const distFile = join(serverDir, "dist", name);
    return { name, distFile, rel: gitPath(repoRoot, distFile) };
  });

  const missing = bundles.filter((b) => !existsSync(b.distFile));
  if (missing.length > 0) {
    for (const b of missing) {
      console.error(`FAIL [${pack}]: dist/${b.name} missing — run npm run build`);
    }
    failures += missing.length;
    continue;
  }

  for (const b of bundles) {
    // Diagnostics only — in CI a prior build step has already overwritten this.
    b.worktreeBefore = hashFile(b.distFile);
    const { bytes: committedBytes, reason } = readCommittedBytes(repoRoot, b.distFile);
    if (!committedBytes) {
      console.warn(
        `NOTE [${pack}]: ${b.rel} is not readable at HEAD (${reason}) — ` +
          "falling back to the working-tree copy as the baseline",
      );
    }
    b.baseline = committedBytes ? hashBytes(committedBytes) : b.worktreeBefore;
  }

  try {
    execSync("npm run build --silent", { cwd: serverDir, stdio: "inherit" });
  } catch (err) {
    console.error(`FAIL [${pack}]: build failed: ${err.message}`);
    failures += 1;
    continue;
  }

  for (const b of bundles) {
    const rebuilt = hashFile(b.distFile);
    const { ok, kind } = classifyRebuild({
      baseline: b.baseline,
      worktreeBefore: b.worktreeBefore,
      rebuilt,
    });
    if (ok) {
      console.log(`OK   [${pack}]: dist/${b.name} in sync`);
      continue;
    }

    failures += 1;
    const detail =
      kind === "uncommitted"
        ? `  the working tree already holds this exact build — only the commit is behind.\n` +
          `  fix: git add ${b.rel}`
        : `  fix: cd ${serverDir} && npm run build && git add dist/\n` +
          `  if the bundle only differs in module-path comments, it was built outside the\n` +
          `  main checkout (a git worktree resolves node_modules further up) — rebuild there.`;
    console.error(
      `FAIL [${pack}]: committed dist/${b.name} differs from fresh build.\n` +
        `  committed (HEAD): ${b.baseline}\n` +
        `  rebuilt:          ${rebuilt}\n` +
        detail,
    );
  }
}

if (failures > 0) {
  console.error(`\nverify-dist: ${failures} failure(s) across ${packs.length} pack(s)`);
  process.exit(1);
}
console.log(`\nverify-dist: all ${packs.length} pack(s) in sync`);
