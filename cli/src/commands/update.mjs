// `marvinx update [--pack <name>] [--source <path>] [--offline]`
//
// Re-ejects every entry in `.claude/.marvin-eject.json` against the latest
// available source. With `--pack`, restricts to a single pack.

import { existsSync } from "node:fs";
import path from "node:path";

import { readManifest, run as runEject } from "../lib/eject-core.mjs";
import { resolveSource } from "../source-resolver.mjs";

export async function update(opts) {
  const cwd = opts.cwd ?? process.cwd();
  const projectRoot = opts.projectRoot ?? cwd;
  const manifestPath = path.join(projectRoot, ".claude", ".marvin-eject.json");
  if (!existsSync(manifestPath)) {
    process.stderr.write(`marvinx update: no manifest at ${path.relative(cwd, manifestPath)}; run \`marvinx init\` first.\n`);
    return 2;
  }

  const manifest = await readManifest(projectRoot);
  let entries = manifest.ejected ?? [];
  if (opts.pack) entries = entries.filter((e) => e.source === opts.pack);
  if (entries.length === 0) {
    process.stderr.write("marvinx update: nothing to update.\n");
    return 0;
  }

  // Resolve each pack ONCE (caching the source path per pack).
  const packSources = new Map();
  for (const e of entries) {
    if (packSources.has(e.source)) continue;
    try {
      const r = await resolveSource(e.source, { source: opts.source, cwd, offline: opts.offline });
      packSources.set(e.source, r.path);
    } catch (err) {
      process.stderr.write(`marvinx update: ${err.message}\n`);
      return 2;
    }
  }

  let hadFailures = false;
  for (const e of entries) {
    const sourcePath = packSources.get(e.source);
    const target = `${e.source}/${e.artifact}`;
    const code = await runEject([target, "--source", sourcePath, "--apply"], { cwd, projectRoot });
    if (code !== 0) hadFailures = true;
  }
  return hadFailures ? 1 : 0;
}
