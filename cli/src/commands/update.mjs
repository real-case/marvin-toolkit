// `marvin update [--pack <name>] [--source <path>] [--offline] [--target <name>]`
//
// Re-ejects every entry in the adapter's manifest against the latest
// available source. With `--pack`, restricts to a single pack. Manifest
// path comes from the adapter — this file is adapter-agnostic.

import { existsSync } from "node:fs";
import path from "node:path";

import { readManifest, run as runEject } from "../lib/eject-core.mjs";
import { resolveSource } from "../source-resolver.mjs";
import { getAdapter, DEFAULT_TARGET } from "../adapters/index.mjs";

export async function update(opts) {
  const cwd = opts.cwd ?? process.cwd();
  const projectRoot = opts.projectRoot ?? cwd;
  const adapter = getAdapter(opts.adapter ?? DEFAULT_TARGET);

  const manifestRel = adapter.manifestPath();
  const manifestPath = path.join(projectRoot, manifestRel);
  if (!existsSync(manifestPath)) {
    process.stderr.write(`marvin update: no manifest at ${path.relative(cwd, manifestPath)}; run \`marvin init\` first.\n`);
    return 2;
  }

  const manifest = await readManifest(projectRoot, adapter);
  let entries = manifest.ejected ?? [];
  if (opts.pack) entries = entries.filter((e) => e.source === opts.pack);
  if (entries.length === 0) {
    process.stderr.write("marvin update: nothing to update.\n");
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
      process.stderr.write(`marvin update: ${err.message}\n`);
      return 2;
    }
  }

  let hadFailures = false;
  for (const e of entries) {
    const sourcePath = packSources.get(e.source);
    const target = `${e.source}/${e.artifact}`;
    const code = await runEject([target, "--source", sourcePath, "--apply"], { cwd, projectRoot, adapter });
    if (code !== 0) hadFailures = true;
  }
  return hadFailures ? 1 : 0;
}
