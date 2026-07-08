#!/usr/bin/env node
// Single source of truth for the repo version.
//
//   node scripts/sync-version.mjs          read plugins/marvin/.claude-plugin/plugin.json
//                                          and propagate that version everywhere
//   node scripts/sync-version.mjs 0.2.0    set 0.2.0 everywhere, plugin.json included
//
// Propagates the version to every workspace package.json and the marketplace plugin
// entry. The marketplace `metadata.version` is deliberately left alone — it tracks the
// manifest schema, not the plugin (see CLAUDE.md "Version bumping"). The server's runtime
// version is injected from its package.json at build time (tsup.config.ts), so rebuild
// dist/ afterwards. lint-manifests.mjs enforces this invariant in CI.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const abs = (rel) => join(repoRoot, rel);

const PLUGIN_JSON = "plugins/marvin/.claude-plugin/plugin.json";
const MARKETPLACE = ".claude-plugin/marketplace.json";
// package.json files whose top-level "version" tracks the plugin version.
const PACKAGE_FILES = [
  PLUGIN_JSON,
  "package.json",
  "packages/marvin-mcp-shared/package.json",
  "packages/marvin-widgets/package.json",
  "plugins/marvin/mcp/server/package.json",
];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function writeIfChanged(path, raw, next) {
  if (next === raw) return false;
  writeFileSync(path, next);
  return true;
}

// Replace the first top-level `"version": "..."` value, preserving all other formatting.
// The package version is the first "version" key in each of these files; dependency
// ranges use their own keys ("zod": "..."), so they are never matched.
function setTopLevelVersion(rel, version) {
  const path = abs(rel);
  const raw = readFileSync(path, "utf8");
  return writeIfChanged(path, raw, raw.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`));
}

// Marketplace: update the plugin ENTRY version (the first "version" after "plugins"),
// never metadata.version, which sits before it. Assumes the single-plugin layout.
function setMarketplaceEntryVersion(version) {
  const path = abs(MARKETPLACE);
  const raw = readFileSync(path, "utf8");
  const idx = raw.indexOf('"plugins"');
  if (idx === -1) throw new Error(`${MARKETPLACE}: no "plugins" array found`);
  const head = raw.slice(0, idx);
  const tail = raw.slice(idx).replace(/("version":\s*)"[^"]*"/, `$1"${version}"`);
  return writeIfChanged(path, raw, head + tail);
}

const arg = process.argv[2];
if (arg && !SEMVER.test(arg)) {
  console.error(`sync-version: "${arg}" is not valid semver (e.g. 0.2.0 or 1.0.0-rc.1)`);
  process.exit(1);
}

const version = arg ?? JSON.parse(readFileSync(abs(PLUGIN_JSON), "utf8")).version;

const changed = [];
for (const rel of PACKAGE_FILES) {
  if (setTopLevelVersion(rel, version)) changed.push(rel);
}
if (setMarketplaceEntryVersion(version)) changed.push(`${MARKETPLACE} (plugin entry)`);

console.log(`sync-version: version = ${version}`);
if (changed.length === 0) {
  console.log("  already in sync — nothing changed");
} else {
  for (const rel of changed) console.log(`  updated ${rel}`);
  console.log("\nNow rebuild so dist/ picks up the version:");
  console.log("  npm run build && node scripts/verify-dist.mjs");
}
