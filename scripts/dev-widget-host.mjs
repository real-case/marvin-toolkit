#!/usr/bin/env node
/*
 * Point the Claude desktop application at THIS checkout so its own MCP client
 * connects the marvin server — the only client in the loop that implements the
 * MCP Apps `ui://` extension, so it is the only one that renders the widget
 * family in chat (ADR-0024, ADR-0034).
 *
 * The plugin server the Claude Code CLI spawns has no MCP Apps support, and the
 * local plugin symlink resolves to the main checkout, not to a worktree — so a
 * feature branch's widgets are unreachable both ways. This script closes both
 * gaps: it rebuilds the three artefact workspaces of the checkout it is run
 * from, then rewrites one key of `claude_desktop_config.json` to that checkout.
 *
 *   npm run dev:widget-host                 # rebuild + point at this checkout
 *   npm run dev:widget-host -- --no-build   # re-point only
 *   npm run dev:widget-host -- --print      # show the entry, write nothing
 *   npm run dev:widget-host -- --name marvin-branch
 *
 * Only `mcpServers.<name>` is touched; every other key in the file survives the
 * read-modify-write. The desktop application must be restarted afterwards: the
 * server process is spawned once per connection, so a changed path applies to
 * the next spawn. A changed widget document does NOT need a restart — the `ui://`
 * resource is read from disk per request (ADR-0008), so `build:watch` is live.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = join(root, "plugins", "marvin", "mcp", "server", "dist", "server.js");

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const name = valueOf("--name") ?? "marvin-dev";

/**
 * The desktop application is launched by the window server, so it inherits the
 * system PATH — not the shell's. A version-manager shim (nvm, fnm, volta) lives
 * outside that PATH and pins a version that can be uninstalled underneath the
 * entry, so an absolute path to a stable interpreter is preferred over both a
 * bare `node` and `process.execPath`.
 */
function resolveNodeBinary() {
  const managed = /\/(\.nvm|\.fnm|\.volta|\.asdf|n\/versions)\//;
  const stable = ["/opt/homebrew/bin/node", "/usr/local/bin/node"].filter((p) => existsSync(p));
  if (!managed.test(process.execPath)) return process.execPath;
  if (stable.length > 0) return stable[0];
  console.warn(
    `! ${process.execPath} is version-manager managed and no stable node was found.\n` +
      "  The entry will use it anyway; re-run this script after switching node versions.",
  );
  return process.execPath;
}

function desktopConfigPath() {
  if (process.env.CLAUDE_DESKTOP_CONFIG) return process.env.CLAUDE_DESKTOP_CONFIG;
  if (process.platform !== "darwin") {
    console.error(
      "! Only the macOS config location is known to this script.\n" +
        "  Set CLAUDE_DESKTOP_CONFIG to the claude_desktop_config.json path and re-run.",
    );
    process.exit(1);
  }
  return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
}

const entry = {
  command: resolveNodeBinary(),
  args: [serverEntry],
  // One variable is enough: the server derives .marvin/track, /memory, /handoff,
  // /security and /usage from it (see mcp/server/src/lib/env.ts).
  env: { CLAUDE_PROJECT_DIR: root },
};

if (has("--print")) {
  console.log(JSON.stringify({ [name]: entry }, null, 2));
  process.exit(0);
}

if (!has("--no-build")) {
  // Dependency order, same as `dev:plugin`: the widgets bundle imports the
  // shared contracts, and the server bundle inlines the shared library.
  for (const workspace of [
    "@marvin-toolkit/mcp-shared",
    "@marvin-toolkit/widgets",
    "@marvin-toolkit/server",
  ]) {
    console.log(`> building ${workspace}`);
    execFileSync("npm", ["run", "build", "-w", workspace], { cwd: root, stdio: "inherit" });
  }
}

if (!existsSync(serverEntry)) {
  console.error(`! ${serverEntry} is missing — run without --no-build.`);
  process.exit(1);
}

const configPath = desktopConfigPath();
if (!existsSync(configPath)) {
  console.error(`! ${configPath} does not exist. Open the desktop application once, then re-run.`);
  process.exit(1);
}

const raw = readFileSync(configPath, "utf8");
let config;
try {
  config = JSON.parse(raw);
} catch (err) {
  console.error(`! ${configPath} is not valid JSON — refusing to overwrite it.\n  ${err.message}`);
  process.exit(1);
}

copyFileSync(configPath, `${configPath}.marvin-backup`);
config.mcpServers = { ...config.mcpServers, [name]: entry };
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(`\n✓ mcpServers.${name} -> ${root}`);
console.log(`  node:   ${entry.command}`);
console.log(`  config: ${configPath} (previous copy kept as .marvin-backup)`);
console.log("\nRestart the Claude desktop application to reconnect the server.");
console.log("Keep the artefacts current with:");
console.log("  npm run dev:watch  # whole tree; a server rebuild still needs a restart");
console.log(
  "  npm run build:watch -w @marvin-toolkit/widgets -- <widget>  # one widget, no restart",
);
