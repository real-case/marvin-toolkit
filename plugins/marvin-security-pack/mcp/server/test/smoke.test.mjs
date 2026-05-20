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
    }, 5000);
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

test("marvin-sec server initialize", async () => {
  const msg = await initializeOnce();
  assert.equal(msg.result.serverInfo.name, "marvin-sec");
});
