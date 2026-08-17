/**
 * Rebuild ONE widget on every source change — the local plugin development loop.
 *
 * `vite-plugin-singlefile` forces rollup's `output.inlineDynamicImports`, which
 * rejects multiple inputs, so the package `build` script runs one `vite build`
 * per widget directory. A watch cannot be that same loop: the first `--watch`
 * never exits and the rest would never start. This script therefore takes a
 * single widget name and passes it to `vite build --watch` through the `WIDGET`
 * env var that `vite.config.ts` already reads.
 *
 *   npm run build:watch -w @marvin-toolkit/widgets -- dashboard
 *   WIDGET=dashboard npm run build:watch -w @marvin-toolkit/widgets
 *
 * Output lands in the committed `plugins/marvin/widgets/<name>.html`, which the
 * server reads from packRoot per request (ADR-0008) — so a rich MCP host picks
 * the rebuilt document up on its next `resources/read`, with no server rebuild.
 * Commit the regenerated HTML: `scripts/verify-widgets.mjs` guards it by hash.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Enumerate from disk rather than duplicating vite.config.ts's WIDGETS list —
// a widget added there is a directory here, so the two cannot drift.
const available = readdirSync(resolve(pkgRoot, "src", "widgets"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const widget = process.argv[2] ?? process.env.WIDGET;

if (!widget || !available.includes(widget)) {
  const problem = widget ? `Unknown widget "${widget}".` : "No widget name given.";
  console.error(`${problem}\nWatch one of: ${available.join(", ")}`);
  process.exit(1);
}

// npm puts both the workspace and the root `node_modules/.bin` on PATH, but
// resolving the hoisted binary keeps a direct `node scripts/watch.mjs` working too.
const hoisted = resolve(pkgRoot, "..", "..", "node_modules", ".bin", "vite");
const vite = existsSync(hoisted) ? hoisted : "vite";

console.error(`Watching ${widget} → plugins/marvin/widgets/${widget}.html`);

const child = spawn(vite, ["build", "--watch"], {
  cwd: pkgRoot,
  env: { ...process.env, WIDGET: widget },
  stdio: "inherit",
});

child.on("error", (err) => {
  console.error(`Failed to start vite: ${err.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
