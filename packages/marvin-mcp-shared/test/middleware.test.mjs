import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../dist/index.js";

// The `onInvoke` middleware seam (ADR-0030) tested in isolation from any
// concrete logger: one in-memory client/server pair, a hook that records the
// events it receives. Confirms the hook fires once per prompt-get and per
// tool-call with the right `{ kind, name }`, that dispatch results are
// unchanged, and that a throwing hook is swallowed (fail-open at the boundary).

/** Wire an in-memory client to a server built with the given options. */
async function connect(opts) {
  const server = await buildServer(opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

/** A minimal bundle: one inline prompt + one echo tool. */
function bundle() {
  return {
    prompts: [{ name: "greet", description: "greet", body: "hello" }],
    tools: [
      {
        name: "echo",
        description: "echo back",
        inputSchema: z.object({ msg: z.string().optional() }),
        handler: async (input) => ({
          content: [{ type: "text", text: `echo:${input.msg ?? ""}` }],
        }),
      },
    ],
  };
}

const baseOpts = (extra) => ({
  name: "test",
  version: "0.0.0",
  promptsDir: "/nonexistent",
  build: () => bundle(),
  ...extra,
});

test("onInvoke fires once per prompt-get and once per tool-call with kind+name", async () => {
  const events = [];
  const { client } = await connect(baseOpts({ onInvoke: (e) => events.push(e) }));

  const prompt = await client.getPrompt({ name: "greet", arguments: {} });
  const tool = await client.callTool({ name: "echo", arguments: { msg: "hi" } });

  // dispatch results are exactly as they would be without the hook
  assert.equal(prompt.messages[0].content.text, "hello");
  assert.equal(tool.content[0].text, "echo:hi");

  assert.deepEqual(events, [
    { kind: "prompt", name: "greet" },
    { kind: "tool", name: "echo" },
  ]);
});

test("the event fires from inside the handler — protocol-rejected calls do not log", async () => {
  // The MCP SDK validates arguments against the tool's JSON Schema *before* the
  // registered handler runs, so a schema-invalid call is refused at the protocol
  // layer and never reaches dispatch — nothing to observe. A call that *does*
  // reach the handler emits exactly one event, even when the handler itself
  // reports an application-level error. `fussy` requires `msg`; omitting it is
  // rejected by the SDK, while passing it reaches the handler which then errors.
  const events = [];
  const { client } = await connect({
    ...baseOpts({ onInvoke: (e) => events.push(e) }),
    build: () => ({
      prompts: [],
      tools: [
        {
          name: "fussy",
          description: "needs msg, then errors",
          inputSchema: z.object({ msg: z.string() }),
          handler: async () => ({ isError: true, content: [{ type: "text", text: "nope" }] }),
        },
      ],
    }),
  });

  // schema-invalid (missing required msg): the SDK rejects it at the protocol
  // layer and returns an error result without ever calling the handler — no event
  const refused = await client.callTool({ name: "fussy", arguments: {} });
  assert.ok(refused.isError, "schema-invalid call returns an error result");
  assert.deepEqual(events, [], "protocol-rejected call logged nothing");

  // reaches the handler (which returns an error result): one event
  const res = await client.callTool({ name: "fussy", arguments: { msg: "x" } });
  assert.ok(res.isError, "handler reported an application error");
  assert.deepEqual(events, [{ kind: "tool", name: "fussy" }], "handler dispatch logged once");
});

test("a throwing onInvoke is swallowed — dispatch still succeeds", async () => {
  const { client } = await connect(
    baseOpts({
      onInvoke: () => {
        throw new Error("boom");
      },
    }),
  );

  const prompt = await client.getPrompt({ name: "greet", arguments: {} });
  const tool = await client.callTool({ name: "echo", arguments: { msg: "x" } });
  assert.equal(prompt.messages[0].content.text, "hello");
  assert.equal(tool.content[0].text, "echo:x");
  assert.ok(!tool.isError, "tool call succeeded despite the throwing hook");
});

test("a rejected promise from onInvoke is swallowed — dispatch still succeeds", async () => {
  const { client } = await connect(
    baseOpts({
      // returns a rejecting thenable; notify() must attach a no-op handler
      onInvoke: () => Promise.reject(new Error("async boom")),
    }),
  );
  const tool = await client.callTool({ name: "echo", arguments: { msg: "y" } });
  assert.equal(tool.content[0].text, "echo:y");
  assert.ok(!tool.isError);
});

test("without onInvoke, dispatch is unaffected (the hook is optional)", async () => {
  const { client } = await connect(baseOpts({}));
  const prompt = await client.getPrompt({ name: "greet", arguments: {} });
  const tool = await client.callTool({ name: "echo", arguments: { msg: "z" } });
  assert.equal(prompt.messages[0].content.text, "hello");
  assert.equal(tool.content[0].text, "echo:z");
});
