// Local-clone source resolver: walks up from cwd looking for a
// marvin-toolkit repo (`.claude-plugin/marketplace.json` with name
// "marvin-toolkit"). Returns absolute path to the pack root, or null.

import { promises as fs } from "node:fs";
import path from "node:path";

export async function resolveLocal(packName, startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    const marketplace = path.join(dir, ".claude-plugin", "marketplace.json");
    try {
      const m = JSON.parse(await fs.readFile(marketplace, "utf8"));
      if (m.name === "marvin-toolkit") {
        const candidate = path.join(dir, "plugins", packName);
        const ok = await isPackRoot(candidate, packName);
        if (ok) return candidate;
        return null;
      }
    } catch { /* keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function isPackRoot(dir, packName) {
  try {
    const m = JSON.parse(await fs.readFile(path.join(dir, ".claude-plugin", "plugin.json"), "utf8"));
    return m.name === packName;
  } catch { return false; }
}

export async function resolveExplicit(sourcePath, packName) {
  const direct = path.resolve(sourcePath);
  if (await isPackRoot(direct, packName)) return direct;
  const nested = path.join(direct, "plugins", packName);
  if (await isPackRoot(nested, packName)) return nested;
  return null;
}
