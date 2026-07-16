import { mkdirSync, mkdtempSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * Test-side loader for server TypeScript modules that are not reachable
 * through the committed `dist/server.js` bundle (which only exposes the stdio
 * surface). Bundles one `src/` entry with esbuild — the same compiler tsup
 * drives for the real build — keeping npm packages external, and imports the
 * result. Output lands under `node_modules/.cache/` so bare imports (zod,
 * `@marvin-toolkit/*`) still resolve from the repo's own tree, and nothing
 * pollutes the worktree. Works on every CI node version (no reliance on
 * node's type stripping), and each call gets its own temp dir so concurrent
 * test files never race.
 */

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, "..");
const cacheBase = join(serverRoot, "..", "..", "..", "..", "node_modules", ".cache");

/** Compile `src/<relPath>` and import the resulting ESM module. */
export async function importTs(relPath) {
  mkdirSync(cacheBase, { recursive: true });
  const outDir = mkdtempSync(join(cacheBase, "marvin-ts-test-"));
  const outfile = join(outDir, basename(relPath).replace(/\.ts$/, ".mjs"));
  await build({
    entryPoints: [join(serverRoot, relPath)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    packages: "external",
    outfile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outfile).href);
}
