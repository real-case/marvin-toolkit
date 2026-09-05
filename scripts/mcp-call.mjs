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
//   --timeout <ms>      budget for the whole exchange. Beats
//                       MARVIN_MCP_CALL_TIMEOUT_MS; default 900000 (15 minutes).
//
// Point storage at fixtures with the server's env vars, e.g.
//   MARVIN_HANDOFF_DIR=/tmp/h node scripts/mcp-call.mjs handoff '{"action":"list"}'
//   MARVIN_TASKS_DIR=.marvin/track node scripts/mcp-call.mjs task '{"action":"list"}'

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
let timeoutArg;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--accept") {
    accept = argv[++i];
  } else if (argv[i] === "--timeout") {
    timeoutArg = argv[++i];
    if (timeoutArg === undefined) die("--timeout requires a value in milliseconds.");
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

// ── timeout budget ───────────────────────────────────────────────────
/**
 * The default is 15 MINUTES, not the 15 seconds this driver shipped with, because
 * the tool it most needs to drive is `verify`: `action: "run"` shells out to the
 * project's real quality gates — the whole test suite, lint, type-check, build —
 * and takes minutes. A 15s budget made the documented way to exercise a freshly
 * built bundle (CLAUDE.md, "Manually driving a tool") unable to call that tool at
 * all, which matters because a connected plugin server holds the bundle from
 * session start, so this driver is the only way to test a server change in-session.
 *
 * A budget that generous is only safe because a crashed server no longer waits it
 * out: the `exit` handler below reports that immediately. What is left for the
 * timeout to catch is a server that starts and then never answers.
 */
const DEFAULT_TIMEOUT_MS = 900_000;

/**
 * `--timeout` beats `MARVIN_MCP_CALL_TIMEOUT_MS` beats the default — the same
 * one-knob shape as `test/_driver.mjs`'s `MARVIN_TEST_TIMEOUT_MS`, with the flag
 * added because a value chosen per invocation is what an ad-hoc driver wants.
 *
 * Unlike that driver's `Number(env) || DEFAULT`, a malformed value is fatal rather
 * than silently the default: someone who asks for a short budget and gets 15
 * minutes learns about it by waiting 15 minutes.
 */
function positiveMs(raw, source) {
  if (raw == null || raw === "") return null;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) {
    die(`${source} must be a positive number of milliseconds — got "${raw}".`);
  }
  return ms;
}

const timeoutMs =
  positiveMs(timeoutArg, "--timeout") ??
  positiveMs(process.env.MARVIN_MCP_CALL_TIMEOUT_MS, "MARVIN_MCP_CALL_TIMEOUT_MS") ??
  DEFAULT_TIMEOUT_MS;

// ── drive the server ─────────────────────────────────────────────────────
const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");

// This driver answers every `elicitation/create` itself (accept, or cancel), so an
// unanswered elicitation cannot be what a timeout means here — which is what the
// message used to assert. A slow tool and a stuck server are the real causes.
const timer = setTimeout(() => {
  child.kill();
  die(
    `timed out after ${timeoutMs}ms waiting for the server. If the tool is simply slow — ` +
      `\`verify\` runs the project's real gates — raise the budget with ` +
      `--timeout <ms> or MARVIN_MCP_CALL_TIMEOUT_MS.`,
  );
}, timeoutMs);

let buf = "";
// Decode through the stream's own StringDecoder, never per chunk: this driver prints
// whole `structuredContent` payloads, and a character split across two pipe reads
// would decode to U+FFFD on both sides of the boundary. Same defect as
// bin/widget-preview.mjs and test/_driver.mjs.
child.stdout.setEncoding("utf8");
child.stdout.on("data", (d) => {
  buf += d;
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

// A server that crashes on startup (a broken bundle, an unresolved import) used to
// be indistinguishable from a slow one: nothing observed the exit, so the driver sat
// on the whole budget and then blamed a timeout. `answered` keeps this quiet on the
// normal path, where `handle` kills the child once the result is printed.
let answered = false;
child.on("exit", (code, signal) => {
  if (answered) return;
  clearTimeout(timer);
  die(`server exited before answering (code ${code}, signal ${signal}) — see its stderr above.`);
});

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
    answered = true;
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
