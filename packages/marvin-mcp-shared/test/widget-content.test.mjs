import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, defineTool } from "../dist/index.js";

/**
 * The oracle for the ADR-0041 capability gate in `registerTool`. Drives a built
 * pack server from a real MCP client over an in-memory transport, so the
 * capability read happens where it happens in production — inside the dispatch
 * closure, after initialize, never at registration time.
 *
 * Every expectation below is written out explicitly rather than compared against
 * a handler's own return value: `registerTool` rebuilds each content item as
 * `{type, text}` and omits a falsy `structuredContent` (`src/server.ts`), so
 * "unchanged" means "unchanged after that normalisation", and an assertion
 * phrased against the handler would overstate what it proves.
 */
async function connect(capabilities) {
  const server = await buildServer({
    name: "test",
    version: "0.0.0",
    promptsDir: "/unused",
    build: () => ({ prompts: [], tools: TOOLS }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** What a client that renders MCP Apps widgets advertises at initialize. */
const ADVERTISING = {
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } },
};

const PANEL = ["# Board", "", "- [ ] one", "- [x] two"].join("\n");
const PAYLOAD = { tasks: [], counts: { todo: 2 } };

const widgetTool = defineTool({
  name: "board",
  description: "List the board",
  inputSchema: z.object({ shape: z.string().optional() }),
  meta: { ui: { resourceUri: "ui://test/board" } },
  handler: async ({ shape }) => {
    // One tool drives the three widget-bound cases: the normal result, an error
    // result, and a result carrying no payload at all.
    if (shape === "error") {
      return {
        isError: true,
        content: [{ type: "text", text: PANEL }],
        structuredContent: PAYLOAD,
      };
    }
    if (shape === "no-payload") {
      return { content: [{ type: "text", text: PANEL }] };
    }
    return { content: [{ type: "text", text: PANEL }], structuredContent: PAYLOAD };
  },
});

const collidingTool = defineTool({
  name: "colliding",
  description: "Owns a _rendered key of its own",
  inputSchema: z.object({}),
  meta: { ui: { resourceUri: "ui://test/colliding" } },
  handler: async () => ({
    content: [{ type: "text", text: PANEL }],
    structuredContent: { _rendered: "mine", tasks: [] },
  }),
});

const textTool = defineTool({
  name: "plain",
  description: "Text only",
  inputSchema: z.object({}),
  handler: async () => ({ content: [{ type: "text", text: PANEL }] }),
});

/**
 * The discriminating half of AC5. A text-only tool that returns NO payload is
 * also stopped by the no-payload guard, so on its own it keeps passing with the
 * widget-binding guard deleted — measured. This one carries a payload, leaving
 * the absent `meta.ui.resourceUri` as the only reason it is not digested.
 */
const textToolWithPayload = defineTool({
  name: "plain-structured",
  description: "Text only, but returns a payload",
  inputSchema: z.object({}),
  handler: async () => ({
    content: [{ type: "text", text: PANEL }],
    structuredContent: PAYLOAD,
  }),
});

const TOOLS = [widgetTool, collidingTool, textTool, textToolWithPayload];

test("advertising client receives the digest and the rendered flag", async () => {
  const client = await connect(ADVERTISING);
  const res = await client.callTool({ name: "board", arguments: {} });

  // Asserted character-for-character, never by substring: wording this line is a
  // decision, and letting it drift silently is not.
  assert.deepEqual(res.content, [
    {
      type: "text",
      text:
        "Rendered as the board widget (ui://test/board). " +
        "The user can see it; do not reproduce it here.",
    },
  ]);

  // The payload half is the operative one — the model reads `structuredContent`
  // and not `content` — so AC1 asserts both halves or proves nothing.
  assert.deepEqual(res.structuredContent, {
    _rendered: {
      widget: "board",
      uri: "ui://test/board",
      note: "The user is already seeing this rendered as a widget. Do not reproduce it.",
    },
    tasks: [],
    counts: { todo: 2 },
  });
});

test("non-advertising client receives the panel unchanged", async () => {
  const client = await connect({});
  const res = await client.callTool({ name: "board", arguments: {} });

  assert.deepEqual(res.content, [{ type: "text", text: PANEL }]);
  assert.deepEqual(res.structuredContent, { tasks: [], counts: { todo: 2 } });
  assert.equal("_rendered" in res.structuredContent, false);
});

test("an error result is never digested", async () => {
  const client = await connect(ADVERTISING);
  const res = await client.callTool({ name: "board", arguments: { shape: "error" } });

  assert.equal(res.isError, true);
  assert.deepEqual(res.content, [{ type: "text", text: PANEL }]);
  assert.deepEqual(res.structuredContent, { tasks: [], counts: { todo: 2 } });
});

test("a result without structuredContent is never digested", async () => {
  const client = await connect(ADVERTISING);
  const res = await client.callTool({ name: "board", arguments: { shape: "no-payload" } });

  assert.deepEqual(res.content, [{ type: "text", text: PANEL }]);
  // No payload is fabricated to carry the flag.
  assert.equal(res.structuredContent, undefined);
});

test("text-only tools are untouched", async () => {
  const client = await connect(ADVERTISING);

  const res = await client.callTool({ name: "plain", arguments: {} });
  assert.deepEqual(res.content, [{ type: "text", text: PANEL }]);
  assert.equal(res.structuredContent, undefined);

  // Same criterion, isolating the widget-binding guard: this tool clears every
  // other condition and is spared only because it binds no widget.
  const structured = await client.callTool({ name: "plain-structured", arguments: {} });
  assert.deepEqual(structured.content, [{ type: "text", text: PANEL }]);
  assert.deepEqual(structured.structuredContent, { tasks: [], counts: { todo: 2 } });
  assert.equal("_rendered" in structured.structuredContent, false);
});

test("a colliding _rendered key declines the whole rule", async () => {
  const client = await connect(ADVERTISING);
  const res = await client.callTool({ name: "colliding", arguments: {} });

  // Declined as a unit: the caller's value survives AND the panel is still there.
  assert.deepEqual(res.structuredContent, { _rendered: "mine", tasks: [] });
  assert.deepEqual(res.content, [{ type: "text", text: PANEL }]);
});
