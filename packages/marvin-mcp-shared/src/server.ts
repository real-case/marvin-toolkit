import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolvePromptBody, interpolateArgs } from "./prompts.js";
import type { PromptDef, ToolDef } from "./types.js";

export interface PackBundle {
  prompts: PromptDef[];
  // Tools are heterogeneous in their input zod shape; the runtime calls
  // `safeParse` so the per-tool shape can be narrow at definition time
  // without becoming a generic obligation on every consumer.
  tools?: Array<ToolDef<z.ZodTypeAny>>;
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
}

/**
 * Construct, wire, and connect an MCP server for a pack.
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
  const server = new McpServer(
    { name: opts.name, version: opts.version },
    { capabilities: { prompts: {}, tools: {} } },
  );

  const bundle = await opts.build(server);
  const ctx = { promptsDir: opts.promptsDir, packRoot: opts.packRoot };

  for (const def of bundle.prompts) {
    registerPrompt(server, def, ctx);
  }
  for (const def of bundle.tools ?? []) {
    registerTool(server, def);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function registerPrompt(
  server: McpServer,
  def: PromptDef,
  ctx: { promptsDir: string; packRoot?: string },
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
            content: { type: "text" as const, text: rendered },
          },
        ],
      };
    },
  );
}

function registerTool<TInput extends z.ZodTypeAny>(server: McpServer, def: ToolDef<TInput>): void {
  // Tool input schemas in our contract are zod ObjectS — extract their raw
  // shape so registerTool can compose the JSON Schema itself.
  const shape = def.inputSchema instanceof z.ZodObject ? def.inputSchema.shape : undefined;
  server.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: shape,
    },
    async (args: unknown) => {
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
      const result = await def.handler(parsed.data);
      return {
        isError: result.isError,
        content: result.content.map((c) => ({ type: "text" as const, text: c.text })),
      };
    },
  );
}
