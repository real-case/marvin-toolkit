// `marvin list [--source <path>] [--offline] [--json]`
//
// Lists all artifacts in all known marvin packs, resolved from the
// configured source.

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

import { KNOWN_PACKS, readPackManifest } from "../lib/eject-core.mjs";
import { resolveSource } from "../source-resolver.mjs";

export async function list(opts) {
  const cwd = opts.cwd ?? process.cwd();
  const out = [];

  for (const packName of KNOWN_PACKS) {
    let resolved;
    try {
      resolved = await resolveSource(packName, { source: opts.source, cwd, offline: opts.offline });
    } catch (err) {
      out.push({ pack: packName, error: err.message });
      continue;
    }
    const pm = await readPackManifest(resolved.path);
    out.push({
      pack: packName,
      version: pm.version,
      via: resolved.source,
      artifacts: await listArtifacts(resolved.path),
    });
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return 0;
  }

  for (const entry of out) {
    if (entry.error) {
      process.stdout.write(`${entry.pack}: <unresolved> (${entry.error})\n\n`);
      continue;
    }
    process.stdout.write(`${entry.pack}@${entry.version}  (via ${entry.via})\n`);
    for (const kind of ["skills", "commands", "agents"]) {
      const items = entry.artifacts[kind] ?? [];
      if (items.length === 0) continue;
      process.stdout.write(`  ${kind} (${items.length}): ${items.join(", ")}\n`);
    }
    process.stdout.write("\n");
  }
  return 0;
}

async function listArtifacts(packRoot) {
  const out = { skills: [], commands: [], agents: [] };
  for (const [kind, expectsDir] of [["skills", true], ["commands", false], ["agents", false]]) {
    const dir = path.join(packRoot, kind);
    if (!existsSync(dir)) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (expectsDir && e.isDirectory()) out[kind].push(e.name);
      else if (!expectsDir && e.isFile() && e.name.endsWith(".md")) out[kind].push(e.name.replace(/\.md$/, ""));
    }
    out[kind].sort();
  }
  return out;
}
