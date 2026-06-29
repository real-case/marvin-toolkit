import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, defineTool } from "../dist/index.js";

/**
 * Drive a built pack server from a real MCP client over an in-memory transport.
 * Proves the ADR-0024 contract widening — tool `_meta`, result
 * `structuredContent`, and `ui://` resources — actually reaches the wire.
 */
async function connect(bundle) {
  const server = await buildServer({
    name: "test",
    version: "0.0.0",
    promptsDir: "/unused",
    build: () => bundle,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const widgetTool = defineTool({
  name: "board",
  description: "List the board",
  inputSchema: z.object({}),
  meta: { ui: { resourceUri: "ui://test/board" } },
  handler: async () => ({
    content: [{ type: "text", text: "2 todo" }],
    structuredContent: { tasks: [], counts: { todo: 2 } },
  }),
});

const textTool = defineTool({
  name: "plain",
  description: "Text only",
  inputSchema: z.object({}),
  handler: async () => ({ content: [{ type: "text", text: "hi" }] }),
});

test("tool _meta.ui.resourceUri is advertised in the tool listing", async () => {
  const client = await connect({ prompts: [], tools: [widgetTool] });
  const { tools } = await client.listTools();
  const board = tools.find((t) => t.name === "board");
  assert.ok(board, "board tool present");
  assert.deepEqual(board._meta?.ui, { resourceUri: "ui://test/board" });
});

test("structuredContent is forwarded on the call result", async () => {
  const client = await connect({ prompts: [], tools: [widgetTool] });
  const res = await client.callTool({ name: "board", arguments: {} });
  assert.deepEqual(res.structuredContent, { tasks: [], counts: { todo: 2 } });
  assert.equal(res.content[0].text, "2 todo");
});

test("a text-only tool carries no structuredContent and no _meta (unchanged surface)", async () => {
  const client = await connect({ prompts: [], tools: [textTool] });
  const { tools } = await client.listTools();
  const plain = tools.find((t) => t.name === "plain");
  assert.equal(plain._meta?.ui, undefined);
  const res = await client.callTool({ name: "plain", arguments: {} });
  assert.equal(res.structuredContent, undefined);
  assert.equal(res.content[0].text, "hi");
});

test("a ui:// resource is registered and served as text/html", async () => {
  const client = await connect({
    prompts: [],
    tools: [widgetTool],
    resources: [{ name: "board-ui", uri: "ui://test/board", read: () => "<html>board</html>" }],
  });
  const { resources } = await client.listResources();
  assert.ok(resources.some((r) => r.uri === "ui://test/board"));
  const read = await client.readResource({ uri: "ui://test/board" });
  assert.equal(read.contents[0].text, "<html>board</html>");
  assert.equal(read.contents[0].mimeType, "text/html");
});

test("with no resources the server does not advertise the resources capability", async () => {
  const client = await connect({ prompts: [], tools: [textTool] });
  assert.equal(client.getServerCapabilities()?.resources, undefined);
});
