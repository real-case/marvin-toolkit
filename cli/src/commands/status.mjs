// `marvinx status [--source <path>] [--offline] [--json] [--target <name>]`
//
// Reads the adapter's manifest, resolves each pack against the configured
// source, and prints a table of installed-vs-latest. Manifest path comes
// from the adapter — this file is adapter-agnostic.

import { existsSync } from "node:fs";
import path from "node:path";

import { readManifest, readPackManifest } from "../lib/eject-core.mjs";
import { resolveSource } from "../source-resolver.mjs";
import { getAdapter, DEFAULT_TARGET } from "../adapters/index.mjs";

export async function status(opts) {
  const cwd = opts.cwd ?? process.cwd();
  const projectRoot = opts.projectRoot ?? cwd;
  const adapter = getAdapter(opts.adapter ?? DEFAULT_TARGET);
  const manifestPath = path.join(projectRoot, adapter.manifestPath());
  if (!existsSync(manifestPath)) {
    if (opts.json) process.stdout.write(JSON.stringify({ entries: [], note: "no manifest" }) + "\n");
    else process.stdout.write("no marvin manifest in this project (run `marvinx init` first)\n");
    return 0;
  }

  const manifest = await readManifest(projectRoot, adapter);
  const entries = manifest.ejected ?? [];
  const packLatest = new Map();

  for (const e of entries) {
    if (packLatest.has(e.source)) continue;
    try {
      const r = await resolveSource(e.source, { source: opts.source, cwd, offline: opts.offline });
      const pm = await readPackManifest(r.path);
      packLatest.set(e.source, { latest: pm.version, sourceKind: r.source });
    } catch (err) {
      packLatest.set(e.source, { latest: null, error: err.message });
    }
  }

  const rows = entries.map((e) => {
    const latest = packLatest.get(e.source);
    const upToDate = latest?.latest && e.sourceVersion === latest.latest;
    return {
      pack: e.source,
      artifact: e.artifact,
      installed: e.sourceVersion,
      latest: latest?.latest ?? "unknown",
      sourceKind: latest?.sourceKind ?? "unresolved",
      upToDate,
    };
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify({ target: adapter.name, entries: rows }, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(formatTable(rows) + "\n");
  return 0;
}

function formatTable(rows) {
  if (rows.length === 0) return "(no ejected artifacts)";
  const cols = [
    { key: "pack", header: "PACK" },
    { key: "artifact", header: "ARTIFACT" },
    { key: "installed", header: "INSTALLED" },
    { key: "latest", header: "LATEST" },
    { key: "sourceKind", header: "VIA" },
    { key: "status", header: "STATUS" },
  ];
  const data = rows.map((r) => ({ ...r, status: r.upToDate === true ? "ok" : r.upToDate === false ? "OUTDATED" : "?" }));
  const widths = cols.map((c) => Math.max(c.header.length, ...data.map((r) => String(r[c.key] ?? "").length)));
  const fmt = (vals) => vals.map((v, i) => String(v).padEnd(widths[i])).join("  ");
  const lines = [fmt(cols.map((c) => c.header))];
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of data) lines.push(fmt(cols.map((c) => r[c.key] ?? "")));
  return lines.join("\n");
}
