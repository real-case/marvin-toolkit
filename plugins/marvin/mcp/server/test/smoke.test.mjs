import { test } from "node:test";
import assert from "node:assert/strict";
import { connect, listTools } from "./_driver.mjs";

const PROTOCOL_VERSION = "2025-03-26";

async function initializeOnce() {
  const session = connect();
  try {
    return await session.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "ci-smoke", version: "0" },
    });
  } finally {
    session.close();
  }
}

test("marvin server initialize", async () => {
  const result = await initializeOnce();
  assert.equal(result.serverInfo.name, "marvin");
});

test("tools/list enumerates the verify and spec tools", async () => {
  const result = await listTools();
  const names = (result.tools ?? []).map((t) => t.name);
  assert.ok(names.includes("verify"), `expected 'verify' in tools/list, got: ${names.join(", ")}`);
  assert.ok(names.includes("spec"), `expected 'spec' in tools/list, got: ${names.join(", ")}`);
});
