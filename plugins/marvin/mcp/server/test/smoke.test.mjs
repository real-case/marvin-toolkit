import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "server.js");

async function initializeOnce() {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout; partial=${JSON.stringify(buf)}`));
    }, 15000);
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const lineEnd = buf.indexOf("\n");
      if (lineEnd === -1) return;
      clearTimeout(timer);
      try {
        const msg = JSON.parse(buf.slice(0, lineEnd));
        child.kill();
        resolve(msg);
      } catch (err) {
        child.kill();
        reject(err);
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", reject);
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

test("marvin server initialize", async () => {
  const msg = await initializeOnce();
  assert.equal(msg.result.serverInfo.name, "marvin");
});

async function listTools() {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let initialized = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout; partial=${JSON.stringify(buf)}`));
    }, 15000);
    const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
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
        if (msg.id === 1 && !initialized) {
          initialized = true;
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          resolve(msg);
        }
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", reject);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "ci-smoke", version: "0" },
      },
    });
  });
}

test("tools/list enumerates the verify and spec tools", async () => {
  const msg = await listTools();
  const names = (msg.result.tools ?? []).map((t) => t.name);
  assert.ok(names.includes("verify"), `expected 'verify' in tools/list, got: ${names.join(", ")}`);
  assert.ok(names.includes("spec"), `expected 'spec' in tools/list, got: ${names.join(", ")}`);
});
