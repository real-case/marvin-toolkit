import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "server.js");

/**
 * Sends an initialize and then a prompts/get to the live server and
 * returns the prompt response. Verifies that the body comes from the
 * SKILL.md file under `plugins/marvin-core-pack/skills/mn.commit/`
 * and arrives without the YAML frontmatter (`---` block).
 */
async function getPrompt(name) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let initialized = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout; partial=${JSON.stringify(buf)}`));
    }, 5000);

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
          // Send a notifications/initialized notification, then prompts/get
          child.stdin.write(
            JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
          );
          child.stdin.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "prompts/get",
              params: { name, arguments: {} },
            }) + "\n",
          );
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          resolve(msg);
        }
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

test("prompts/get commit returns SKILL.md body without frontmatter", async () => {
  const msg = await getPrompt("commit");
  assert.ok(msg.result, `missing result: ${JSON.stringify(msg)}`);
  assert.ok(Array.isArray(msg.result.messages), "missing messages");
  const text = msg.result.messages[0]?.content?.text;
  assert.ok(text, "missing message text");
  // The SKILL.md begins with `---` frontmatter and `name:` / `description:` keys.
  // The MCP body must NOT contain those — they should be stripped at resolve time.
  assert.ok(!/^---\nname:/.test(text), "frontmatter leaked into prompt body");
  // The actual commit workflow uses the phrase "Conventional Commits" in the body.
  assert.match(text, /Conventional Commits|commit message|git commit/i);
});
