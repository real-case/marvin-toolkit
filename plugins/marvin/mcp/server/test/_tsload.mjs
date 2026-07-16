import { mkdirSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

/**
 * Test-side loader for server TypeScript modules that are not reachable
 * through the committed `dist/server.js` bundle (which only exposes the stdio
 * surface). Bundles one `src/` entry with esbuild — a declared devDependency
 * of this workspace, the same compiler tsup drives for the real build —
 * keeping npm packages external, and imports the result. Output lands under
 * `node_modules/.cache/marvin-ts-test/` so bare imports (zod,
 * `@marvin-toolkit/*`) still resolve from the repo's own tree and nothing
 * pollutes the worktree. One stable directory with hash-named bundles is
 * reused across runs (no per-run accumulation); each build writes to a
 * pid-suffixed temp file and lands via atomic rename, so concurrent test
 * processes compiling the same entry never observe a torn bundle.
 */

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, "..");
const outDir = join(serverRoot, "..", "..", "..", "..", "node_modules", ".cache", "marvin-ts-test");

/** Compile `src/<relPath>` and import the resulting ESM module. */
export async function importTs(relPath) {
  mkdirSync(outDir, { recursive: true });
  const entry = join(serverRoot, relPath);
  const hash = createHash("sha1").update(entry).digest("hex").slice(0, 12);
  const outfile = join(outDir, `${basename(relPath).replace(/\.ts$/, "")}-${hash}.mjs`);
  const tmpfile = `${outfile}.${process.pid}.tmp`;
  await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    packages: "external",
    outfile: tmpfile,
    logLevel: "silent",
  });
  renameSync(tmpfile, outfile);
  return import(pathToFileURL(outfile).href);
}
