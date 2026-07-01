#!/usr/bin/env node
// Command smoke-test: drive the built marvin MCP server over stdio and assert that
// EVERY command works in the terminal — the release guarantee. It:
//   1. lists prompts and confirms all canonical `/marvin:` commands are registered,
//   2. resolves (`prompts/get`) every listed prompt and asserts a non-empty body with
//      no error — this catches broken skill resolution (e.g. the MCP-door bare-path
//      trap) and is automatic for any newly added prompt,
//   3. lists tools and confirms the deterministic tool set is present.
// Exits non-zero on any failure. Run after `npm run build`.
//
//   node scripts/smoke-commands.mjs

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(
  new URL("../plugins/marvin/mcp/server/dist/server.js", import.meta.url),
);

// The canonical command surface. Adding a prompt does not require touching this list
// (every listed prompt is resolution-tested regardless); removing or renaming one of
// these trips the smoke-test on purpose.
const REQUIRED_PROMPTS = [
  // core (bare)
  "commit",
  "debug",
  "adr",
  "changelog",
  "readme",
  "migration-plan",
  "explain",
  "docs-search",
  "handoff",
  "handoff-list",
  "help",
  // pr-*
  "pr-create",
  "pr-review",
  "pr-resolve",
  "pr-merge",
  // task-*
  "task-start",
  "task-implement",
  "task-verify",
  "task-deliver",
  "task-summary",
  // sec-*
  "sec-scan",
  "sec-secrets",
  "sec-deps",
  "sec-gate",
  "sec-threat-model",
  "sec-iac",
  "sec-ci",
  "sec-fix",
  "sec-compliance",
  "sec-pentest",
  // kanban-*
  "kanban-menu",
  "kanban-bug",
  "kanban-feature",
  "kanban-chore",
  "kanban-spike",
  "kanban-start",
  "kanban-review",
  "kanban-done",
  "kanban-list",
  "kanban-status",
  "kanban-help",
  "kanban-commit",
  "kanban-create-pr",
];

const REQUIRED_TOOLS = ["task", "git", "help", "verify", "spec", "lessons", "handoff", "summary"];

function die(msg) {
  console.error(`smoke-commands: ${msg}`);
  process.exit(1);
}

if (!existsSync(SERVER)) {
  die(`server bundle not found at ${SERVER} — run \`npm run build\` first.`);
}

const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");

const timer = setTimeout(() => {
  child.kill();
  die("timeout waiting for the server.");
}, 30000);

let promptNames = null;
let toolNames = null;
let getIdx = 0;
const getResults = [];
const pending = new Map(); // request id -> prompt name

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
  if (msg.id === 1) {
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "prompts/list", params: {} });
    return;
  }
  if (msg.id === 2) {
    if (msg.error) die(`prompts/list failed: ${JSON.stringify(msg.error)}`);
    promptNames = (msg.result?.prompts ?? []).map((p) => p.name);
    send({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
    return;
  }
  if (msg.id === 3) {
    if (msg.error) die(`tools/list failed: ${JSON.stringify(msg.error)}`);
    toolNames = (msg.result?.tools ?? []).map((t) => t.name);
    getNext();
    return;
  }
  if (msg.id >= 100) {
    const name = pending.get(msg.id);
    if (msg.error) {
      getResults.push({ name, ok: false, why: JSON.stringify(msg.error).slice(0, 160) });
    } else {
      const body = (msg.result?.messages ?? []).map((m) => m.content?.text ?? "").join("");
      getResults.push({ name, ok: body.length > 0, why: body.length > 0 ? "" : "empty body" });
    }
    getNext();
  }
}

function getNext() {
  if (getIdx >= promptNames.length) {
    finish();
    return;
  }
  const name = promptNames[getIdx++];
  const id = 100 + getIdx;
  pending.set(id, name);
  send({ jsonrpc: "2.0", id, method: "prompts/get", params: { name, arguments: {} } });
}

function finish() {
  clearTimeout(timer);
  child.kill();

  const problems = [];

  const listed = new Set(promptNames);
  const missingPrompts = REQUIRED_PROMPTS.filter((n) => !listed.has(n));
  if (missingPrompts.length) problems.push(`missing prompts: ${missingPrompts.join(", ")}`);

  const unresolved = getResults.filter((r) => !r.ok);
  for (const r of unresolved) problems.push(`prompt "${r.name}" did not resolve (${r.why})`);

  const tools = new Set(toolNames);
  const missingTools = REQUIRED_TOOLS.filter((n) => !tools.has(n));
  if (missingTools.length) problems.push(`missing tools: ${missingTools.join(", ")}`);

  if (problems.length) {
    console.error("smoke-commands: FAIL");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log(
    `smoke-commands: OK — ${promptNames.length} prompts resolve, ${toolNames.length} tools registered ` +
      `(${REQUIRED_PROMPTS.length} canonical commands + ${REQUIRED_TOOLS.length} tools verified).`,
  );
  process.exit(0);
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "smoke-commands", version: "0" },
  },
});
