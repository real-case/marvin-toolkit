#!/usr/bin/env node
// Dev driver: call one tool on the marvin MCP server over stdio and print the
// result (text fallback + structuredContent). For ad-hoc manual testing without
// a rich MCP host — the same JSON-RPC conversation the e2e tests drive.
//
// Usage:
//   node scripts/mcp-call.mjs <tool> [jsonArgs]      # call a tool
//   node scripts/mcp-call.mjs --list                 # enumerate registered tools
//
// Options:
//   --accept '<json>'   reply to every elicitation/create with this content
//                       (drives interactive tools, e.g. `task` create / `git` commit).
//                       Without it, elicitations are cancelled.
//
// Point storage at fixtures with the server's env vars, e.g.
//   MARVIN_HANDOFF_DIR=/tmp/h node scripts/mcp-call.mjs handoff '{"action":"list"}'
//   MARVIN_TASKS_DIR=.marvin/kanban node scripts/mcp-call.mjs task '{"action":"list"}'

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(
  new URL("../plugins/marvin/mcp/server/dist/server.js", import.meta.url),
);

function die(msg) {
  console.error(`mcp-call: ${msg}`);
  process.exit(1);
}

if (!existsSync(SERVER)) {
  die(`server bundle not found at ${SERVER} — run \`npm run build\` first.`);
}

// ── parse argv ───────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let accept = null;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--accept") {
    accept = argv[++i];
  } else {
    positional.push(argv[i]);
  }
}
const listMode = positional[0] === "--list";
const toolName = listMode ? null : positional[0];
const toolArgs = positional[1] ?? "{}";

if (!listMode && !toolName) {
  die("usage: node scripts/mcp-call.mjs <tool> [jsonArgs] | --list");
}

let parsedArgs = {};
let parsedAccept;
try {
  if (!listMode) parsedArgs = JSON.parse(toolArgs);
  if (accept != null) parsedAccept = JSON.parse(accept);
} catch (err) {
  die(`invalid JSON: ${err.message}`);
}

// ── drive the server ─────────────────────────────────────────────────────
const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");

const timer = setTimeout(() => {
  child.kill();
  die("timeout waiting for the server (tool may be awaiting elicitation — try --accept).");
}, 15000);

let buf = "";
child.stdout.on("data", (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});
child.on("error", (err) => die(err.message));

function handle(msg) {
  // Server-initiated elicitation: accept with the provided content, else cancel.
  if (msg.method === "elicitation/create" && msg.id != null) {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: parsedAccept ? { action: "accept", content: parsedAccept } : { action: "cancel" },
    });
    return;
  }

  if (msg.id === 1) {
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send(
      listMode
        ? { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
        : {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: toolName, arguments: parsedArgs },
          },
    );
    return;
  }

  if (msg.id === 2) {
    clearTimeout(timer);
    child.kill();
    if (msg.error) die(`server error: ${JSON.stringify(msg.error)}`);
    if (listMode) printTools(msg.result);
    else printCall(msg.result);
    process.exit(msg.result?.isError ? 1 : 0);
  }
}

function printTools(result) {
  const tools = result?.tools ?? [];
  console.log(`Registered tools (${tools.length}):\n`);
  for (const t of tools) console.log(`- ${t.name} — ${t.description ?? ""}`);
}

function printCall(result) {
  console.log("───── text (terminal fallback) ─────");
  console.log((result.content ?? []).map((c) => c.text ?? "").join("\n"));
  if (result.structuredContent !== undefined) {
    console.log("\n───── structuredContent (widget payload) ─────");
    console.log(JSON.stringify(result.structuredContent, null, 2));
  }
  if (result.isError) console.log("\n⚠ tool reported isError");
}

// Kick off the JSON-RPC conversation; `handle` drives the rest.
send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    // Advertise elicitation so interactive tools (task create, git commit) run;
    // handle() answers each elicitation/create via --accept (or cancels).
    capabilities: { elicitation: {} },
    clientInfo: { name: "mcp-call", version: "0" },
  },
});
