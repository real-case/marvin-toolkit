// Resolves a pack-root directory using the CLI's 5-step priority chain.
// Returns an absolute path. Throws if nothing matches.
//
//   1. opts.source           explicit --source flag
//   2. MARVIN_SOURCE          env override
//   3. local clone walk-up    .claude-plugin/marketplace.json with name=marvin-toolkit
//   4. GitHub tarball         downloaded + cached under ~/.cache/marvinx/
//   5. installed              ~/.claude/plugins/<…>/<packName>/
//
// `opts.offline=true` skips step 4 (useful for tests + offline use).

import { resolveLocal, resolveExplicit } from "./sources/local.mjs";
import { resolveInstalled } from "./sources/installed.mjs";
import { resolveTarball } from "./sources/tarball.mjs";

export async function resolveSource(packName, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const tried = [];

  if (opts.source) {
    const r = await resolveExplicit(opts.source, packName);
    if (r) return { path: r, source: "explicit" };
    tried.push(`--source ${opts.source} (not a marvin-toolkit pack root)`);
  }

  if (process.env.MARVIN_SOURCE) {
    const r = await resolveExplicit(process.env.MARVIN_SOURCE, packName);
    if (r) return { path: r, source: "MARVIN_SOURCE" };
    tried.push(`MARVIN_SOURCE=${process.env.MARVIN_SOURCE} (not a marvin-toolkit pack root)`);
  }

  const local = await resolveLocal(packName, cwd);
  if (local) return { path: local, source: "local" };
  tried.push("local clone (no marvin-toolkit repo found in cwd ancestors)");

  if (!opts.offline) {
    try {
      const tar = await resolveTarball(packName, opts);
      return { path: tar, source: "tarball" };
    } catch (err) {
      tried.push(`tarball (${err.message})`);
    }
  } else {
    tried.push("tarball (skipped: --offline)");
  }

  const installed = await resolveInstalled(packName);
  if (installed) return { path: installed, source: "installed" };
  tried.push("installed (~/.claude/plugins not found or pack not present)");

  const err = new Error(
    `Could not resolve pack "${packName}". Tried:\n  - ${tried.join("\n  - ")}\n` +
    `Hint: pass --source <path> to a local clone, or set MARVIN_SOURCE.`
  );
  err.code = "ESOURCE";
  throw err;
}
