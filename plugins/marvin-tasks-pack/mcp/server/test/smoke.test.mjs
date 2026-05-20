import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "server.js");

/**
 * Talk to the server over stdio: send one initialize request, wait
 * until we read a single JSON-RPC line back, validate it, then kill.
 */
async function initializeOnce() {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout waiting for server response; partial=${JSON.stringify(buf)}`));
    }, 5000);
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const lineEnd = buf.indexOf("\n");
      if (lineEnd === -1) return;
      const line = buf.slice(0, lineEnd);
      clearTimeout(timer);
      try {
        const msg = JSON.parse(line);
        child.kill();
        resolve(msg);
      } catch (err) {
        child.kill();
        reject(err);
      }
    });
    child.stderr.on("data", () => {
      // ignore — MCP servers chatter on stderr
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "ci-smoke", version: "0" },
        },
      }) + "\n",
    );
  });
}

test("server responds to initialize with serverInfo", async () => {
  const msg = await initializeOnce();
  assert.equal(msg.jsonrpc, "2.0");
  assert.equal(msg.id, 1);
  assert.ok(msg.result, "missing result");
  assert.ok(msg.result.serverInfo, "missing serverInfo");
  assert.equal(msg.result.serverInfo.name, "marvin-tasks");
  assert.match(String(msg.result.serverInfo.version), /^\d+\.\d+\.\d+/);
});
