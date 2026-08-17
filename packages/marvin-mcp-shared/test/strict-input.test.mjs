import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../dist/index.js";

// `registerTool` must hand the SDK the input **schema**, not its raw `.shape`.
// Given a raw shape the SDK rebuilds it with a plain, non-strict `z.object()`,
// which *strips* unknown keys before the handler ever runs — so a `.strict()`
// tool could never reject one, and an argument the tool does not declare was
// silently discarded while the caller got a confident answer computed without
// it. These tests pin the two halves of that contract: strict schemas reject,
// non-strict schemas are left exactly as they were.

async function connect(tools) {
  const server = await buildServer({
    name: "test",
    version: "0.0.0",
    promptsDir: "/nonexistent",
    build: () => ({ prompts: [], tools }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** Record what the handler actually received, so we can prove stripping. */
function probeTool(name, inputSchema, seen) {
  return {
    name,
    description: "probe",
    inputSchema,
    handler: async (input) => {
      seen.push(input);
      return { content: [{ type: "text", text: "ok" }] };
    },
  };
}

/** The SDK client surfaces a validation McpError as an isError result, not a throw. */
const errorText = (res) => res.content.map((c) => c.text).join("\n");

test("a strict tool rejects an undeclared argument instead of silently dropping it", async () => {
  const seen = [];
  const client = await connect([
    probeTool("strictTool", z.object({ mode: z.string().optional() }).strict(), seen),
  ]);

  const res = await client.callTool({
    name: "strictTool",
    arguments: { mode: "scope", bogus: ["a.ts"] },
  });

  assert.equal(res.isError, true);
  assert.match(errorText(res), /bogus/, "the error must name the offending key");
  // the handler never ran — the call failed rather than answering without `bogus`
  assert.deepEqual(seen, []);
});

test("a strict tool still accepts its declared arguments", async () => {
  const seen = [];
  const client = await connect([
    probeTool("strictTool", z.object({ mode: z.string().optional() }).strict(), seen),
  ]);

  const res = await client.callTool({ name: "strictTool", arguments: { mode: "scope" } });
  assert.equal(res.content[0].text, "ok");
  assert.deepEqual(seen, [{ mode: "scope" }]);
});

test("a strict tool's custom message is preserved through the SDK", async () => {
  const schema = z.object({ mode: z.string().optional() }).strict("only `mode` is accepted here");
  const client = await connect([probeTool("strictTool", schema, [])]);

  const res = await client.callTool({ name: "strictTool", arguments: { nope: 1 } });
  assert.equal(res.isError, true);
  assert.match(errorText(res), /only `mode` is accepted here/);
});

test("a non-strict tool is unchanged — unknown keys are still stripped, not rejected", async () => {
  const seen = [];
  const client = await connect([
    probeTool("looseTool", z.object({ mode: z.string().optional() }), seen),
  ]);

  const res = await client.callTool({
    name: "looseTool",
    arguments: { mode: "scope", extra: "ignored" },
  });
  assert.equal(res.content[0].text, "ok");
  assert.deepEqual(seen, [{ mode: "scope" }], "non-strict behaviour must be untouched");
});

test("a zero-argument tool advertises a closed schema and still dispatches", async () => {
  const seen = [];
  const client = await connect([probeTool("nullaryTool", z.object({}), seen)]);

  const list = await client.listTools();
  const nullary = list.tools.find((t) => t.name === "nullaryTool");
  assert.equal(nullary.inputSchema.type, "object");
  assert.equal(nullary.inputSchema.additionalProperties, false);

  const res = await client.callTool({ name: "nullaryTool", arguments: {} });
  assert.equal(res.content[0].text, "ok");
});
