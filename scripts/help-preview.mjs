#!/usr/bin/env node
/*
 * Convenience preview for the `help` tool. Rebuilds the marvin server, then
 * drives `help` over stdio (via scripts/mcp-call.mjs) and prints its output —
 * the fastest way to eyeball a help.ts change without a rich MCP host.
 *
 *   npm run help:preview                    # default view
 *   npm run help:preview -- sec             # one group (shorthand)
 *   npm run help:preview -- '{"section":"sec"}'   # raw tool args
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = join(root, "plugins", "marvin", "mcp", "server");

// A bare word is treated as a group name (→ {section}); JSON is passed through.
const arg = process.argv[2];
const args = arg ? (arg.trim().startsWith("{") ? arg : JSON.stringify({ section: arg })) : "{}";

execSync("npm run build", { cwd: serverDir, stdio: "inherit" });
execSync(`node scripts/mcp-call.mjs help '${args}'`, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CLAUDE_PROJECT_DIR: root },
});
