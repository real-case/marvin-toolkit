// Installed-pack source resolver: scans ~/.claude/plugins for a directory
// named <packName> whose path contains "marvin-toolkit". Returns the
// absolute pack-root path, or null if not found.

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export async function resolveInstalled(packName) {
  const root = path.join(os.homedir(), ".claude", "plugins");
  if (!existsSync(root)) return null;
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.name === packName && full.includes("marvin-toolkit") && await isPackRoot(full, packName)) return full;
      if (depth < 4) queue.push({ dir: full, depth: depth + 1 });
    }
  }
  return null;
}

async function isPackRoot(dir, packName) {
  try {
    const m = JSON.parse(await fs.readFile(path.join(dir, ".claude-plugin", "plugin.json"), "utf8"));
    return m.name === packName;
  } catch { return false; }
}
