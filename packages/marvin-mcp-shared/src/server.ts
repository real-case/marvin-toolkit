import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolvePromptBody, interpolateArgs } from "./prompts.js";
import type { InvocationEvent, PromptDef, ResourceDef, ToolDef, ToolResult } from "./types.js";

export interface PackBundle {
  prompts: PromptDef[];
  // Tools are heterogeneous in their input zod shape; the runtime calls
  // `safeParse` so the per-tool shape can be narrow at definition time
  // without becoming a generic obligation on every consumer.
  tools?: Array<ToolDef<z.ZodTypeAny>>;
  /**
   * Static resources, e.g. `ui://` widget documents (ADR-0024). Registering at
   * least one advertises the MCP `resources` capability; an empty/omitted list
   * leaves the server's surface unchanged.
   */
  resources?: ResourceDef[];
}

export interface RunPackOptions {
  /** Server name registered in `.mcp.json` (slash prefix). */
  name: string;
  /** Server version — typically mirrors the pack version. */
  version: string;
  /** Directory holding markdown prompt bodies for `bodyFile` references. */
  promptsDir: string;
  /**
   * Pack root (the directory containing `skills/`, `agents/`, `.mcp.json`).
   * Required if any prompt uses `skill: "<name>"`. Compute it with
   * `packRootFromMeta(import.meta.url)`.
   */
  packRoot?: string;
  /**
   * Factory that builds the prompts + tools, given the live McpServer.
   * Handlers can close over `server` to call `server.server.elicitInput(...)`.
   */
  build: (server: McpServer) => PackBundle | Promise<PackBundle>;
  /**
   * Optional middleware hook fired once per prompt-get and per tool-call,
   * *before* the corresponding handler runs (ADR-0030). Marvin uses it to
   * append a usage-log event; the shared library stays project-agnostic and
   * only reports `{ kind, name }`. The hook is fire-and-forget: it is invoked
   * synchronously, its return value is ignored, and any throw is swallowed —
   * dispatch, its result, and its errors are byte-for-byte unaffected whether
   * the hook is present or not. Keep the callback itself non-blocking (do not
   * return a promise the caller must await); a slow or failing hook must never
   * delay or break the request it observes.
   */
  onInvoke?: (event: InvocationEvent) => void;
}

/**
 * Construct and wire a pack server without connecting a transport. This is the
 * testable seam: callers can attach an in-memory transport and drive it from an
 * MCP client. `runPackServer` is this plus a stdio connect.
 */
export async function buildServer(opts: RunPackOptions): Promise<McpServer> {
  const server = new McpServer(
    { name: opts.name, version: opts.version },
    { capabilities: { prompts: {}, tools: {} } },
  );

  const bundle = await opts.build(server);
  const ctx = { promptsDir: opts.promptsDir, packRoot: opts.packRoot };

  for (const def of bundle.prompts) {
    registerPrompt(server, def, ctx, opts.onInvoke);
  }
  for (const def of bundle.tools ?? []) {
    registerTool(server, def, opts.onInvoke);
  }
  // Registering a resource auto-advertises the `resources` capability (MCP SDK);
  // an empty list leaves the server's advertised surface untouched.
  for (const def of bundle.resources ?? []) {
    registerResource(server, def);
  }

  return server;
}

/**
 * Construct, wire, and connect an MCP server for a pack over stdio.
 *
 *   import { runPackServer, promptsDirFromMeta } from "@marvin-toolkit/mcp-shared";
 *
 *   await runPackServer({
 *     name: "marvin",
 *     version: "1.0.0",
 *     promptsDir: promptsDirFromMeta(import.meta.url),
 *     build: (server) => buildPack(server, env),
 *   });
 */
export async function runPackServer(opts: RunPackOptions): Promise<void> {
  const server = await buildServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Fire the invocation hook and swallow everything. The hook is observability
 * only (ADR-0030): a throw or a rejected promise it returns must never surface
 * into the request path, so we call it inside try/catch and, if it hands back a
 * thenable, attach a no-op rejection handler. The dispatch continues regardless.
 */
function notify(
  onInvoke: ((event: InvocationEvent) => void) | undefined,
  event: InvocationEvent,
): void {
  if (!onInvoke) return;
  try {
    const maybe = onInvoke(event) as unknown;
    if (maybe && typeof (maybe as { then?: unknown }).then === "function") {
      (maybe as Promise<unknown>).then(undefined, () => {});
    }
  } catch {
    // usage logging is best-effort; never break the request being observed
  }
}

function registerPrompt(
  server: McpServer,
  def: PromptDef,
  ctx: { promptsDir: string; packRoot?: string },
  onInvoke?: (event: InvocationEvent) => void,
): void {
  const argsSchema: Record<string, z.ZodString | z.ZodOptional<z.ZodString>> = {};
  for (const arg of def.arguments ?? []) {
    argsSchema[arg.name] = arg.required ? z.string() : z.string().optional();
  }

  server.registerPrompt(
    def.name,
    {
      description: def.description,
      argsSchema,
    },
    (args) => {
      notify(onInvoke, { kind: "prompt", name: def.name });
      const body = resolvePromptBody(def, ctx);
      const stringArgs: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(args ?? {})) {
        stringArgs[key] = typeof value === "string" ? value : undefined;
      }
      const rendered = interpolateArgs(body, stringArgs);
      return {
        description: def.description,
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: withPluginResourceContext(rendered, ctx) },
          },
        ],
      };
    },
  );
}

/**
 * Door-3 (MCP) resource resolution. A skill body is returned to the client
 * verbatim, but the model's working directory is the *user's* project, not the
 * plugin root — so a bare `skills/...` path in the prose (a template the skill
 * fills in, a reference checklist it reads) cannot resolve, and the model
 * silently improvises from memory. Doors 1 (auto-discovery) and 2 (command
 * wrapper) load the skill from the plugin and resolve such paths natively;
 * only the MCP door lacks that context. When the body references a `skills/...`
 * path, prepend the absolute plugin root so the path resolves. No-op when
 * packRoot is unknown or the body references no such path. See ADR-0008.
 */
function withPluginResourceContext(text: string, ctx: { packRoot?: string }): string {
  if (!ctx.packRoot) return text;
  if (!/skills\/[\w.-]+/.test(text)) return text;
  return (
    `> Plugin resources: this prompt is served from a plugin installed at \`${ctx.packRoot}\`. ` +
    `Any file path written below as \`skills/…\` is relative to that plugin root — read it from ` +
    `there (e.g. \`${ctx.packRoot}/skills/…\`), not from the current working directory.\n\n${text}`
  );
}

/**
 * Capability gate for a widget-bound tool result (ADR-0041).
 *
 * On a client that advertises the MCP Apps UI extension the payload is already
 * drawn as a widget, so the markdown panel in `content` is a second rendering of
 * the same thing — the user sees one dashboard twice. This narrows ADR-0024's
 * progressive-enhancement rule from "the terminal fallback is unchanged" to
 * "unchanged for a client that does not advertise the UI extension".
 *
 * Returns `result` untouched unless **all five** facts hold:
 *
 *   1. the tool binds a widget (`meta.ui.resourceUri`, a non-empty string);
 *   2. the client advertises `extensions["io.modelcontextprotocol/ui"]`;
 *   3. the handler produced a `structuredContent`;
 *   4. the result is not an error;
 *   5. that payload has no own `_rendered` key.
 *
 * The rule is taken or declined **as a unit**. Yielding on the payload while
 * still rewriting `content` would leave a third state — the panel gone and no
 * instruction in its place — so a collision declines both halves. Condition 5
 * tests presence with `in` rather than against `undefined`: an own key holding
 * `undefined` passes a value test, and the payload spread below would then copy
 * that `undefined` straight over the injected object, producing exactly that
 * third state. The injected key is written **first** and the handler's payload
 * spread after it, so a caller's value wins even if condition 5 were relaxed.
 *
 * `isError` is never altered on any path, and the rule names no tool: it keys on
 * the MCP capability and the tool's own `_meta`, so the library stays
 * project-agnostic and a tenth widget-bound tool inherits it by construction.
 *
 * The capability read must happen **here**, inside the dispatch closure, not at
 * registration: `registerTool` runs from `buildServer`, which is before
 * `server.connect`, and `getClientCapabilities()` returns undefined until
 * initialize completes.
 */
function widgetDigest(
  server: McpServer,
  def: ToolDef<z.ZodTypeAny>,
  result: ToolResult,
): ToolResult {
  const uri = (def.meta?.ui as { resourceUri?: unknown } | undefined)?.resourceUri;
  if (typeof uri !== "string" || uri.length === 0) return result;

  // A client object without `extensions` yields false rather than throwing.
  if (server.server.getClientCapabilities()?.extensions?.["io.modelcontextprotocol/ui"] == null) {
    return result;
  }

  const payload = result.structuredContent;
  // Nothing for a widget to render: replacing the text would destroy the only
  // information the result carries (the `task` tool's create / move / link-pr).
  if (payload == null) return result;
  // An error must always reach the model in full.
  if (result.isError === true) return result;
  // Presence, not value — see above.
  if ("_rendered" in payload) return result;

  return {
    ...result,
    content: [
      {
        type: "text" as const,
        text:
          `Rendered as the ${def.name} widget (${uri}). ` +
          `The user can see it; do not reproduce it here.`,
      },
    ],
    structuredContent: {
      _rendered: {
        widget: def.name,
        uri,
        note: "The user is already seeing this rendered as a widget. Do not reproduce it.",
      },
      ...payload,
    },
  };
}

function registerTool<TInput extends z.ZodTypeAny>(
  server: McpServer,
  def: ToolDef<TInput>,
  onInvoke?: (event: InvocationEvent) => void,
): void {
  // Tool input schemas in our contract are zod objects. Pass the schema
  // **itself**, not its raw `.shape`: handed a raw shape, the SDK rebuilds it
  // with a plain `z.object()`, which is non-strict and therefore *strips*
  // unknown keys before the handler — and before our own `safeParse` below —
  // ever sees them. A `.strict()` schema could then never reject anything: an
  // argument the tool does not declare was silently discarded and the caller
  // got a confident answer computed without it. Passing the schema preserves
  // its strictness (the SDK accepts a whole schema, not only a shape), so a
  // `.strict()` tool now fails loudly on an unknown key. Non-strict schemas are
  // unaffected, and the advertised JSON Schema is identical either way.
  const inputSchema: z.ZodTypeAny | undefined =
    def.inputSchema instanceof z.ZodObject ? def.inputSchema : undefined;
  server.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema,
      // `_meta.ui.resourceUri` binds a widget to the tool for MCP Apps hosts
      // (ADR-0024); omitted by text-only tools.
      ...(def.meta ? { _meta: def.meta } : {}),
    },
    async (args: unknown) => {
      // One event per dispatch, before validation runs — a tool call was made
      // regardless of whether its arguments parse.
      notify(onInvoke, { kind: "tool", name: def.name });
      const parsed = def.inputSchema.safeParse(args ?? {});
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Invalid arguments for ${def.name}: ${parsed.error.message}`,
            },
          ],
        };
      }
      // `buildServer` iterates `Array<ToolDef<z.ZodTypeAny>>`, so that is the
      // static type at every real call site; only `registerTool`'s own generic
      // parameter narrows it here, and TInput is contravariant through
      // `handler`. Same widening `defineTool` performs, by the same route.
      const widened = def as unknown as ToolDef<z.ZodTypeAny>;
      const result = widgetDigest(server, widened, await def.handler(parsed.data));
      return {
        isError: result.isError,
        content: result.content.map((c) => ({ type: "text" as const, text: c.text })),
        // The widget payload (ADR-0024); forwarded only when the tool produced
        // one, so text-only results are byte-for-byte unchanged.
        ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
      };
    },
  );
}

/**
 * Register a static resource (ADR-0024). Used to serve `ui://` widget HTML; the
 * body is produced lazily by `def.read` at request time.
 */
function registerResource(server: McpServer, def: ResourceDef): void {
  const mimeType = def.mimeType ?? "text/html";
  server.registerResource(
    def.name,
    def.uri,
    { description: def.description, mimeType },
    async () => ({
      contents: [{ uri: def.uri, mimeType, text: await def.read() }],
    }),
  );
}
