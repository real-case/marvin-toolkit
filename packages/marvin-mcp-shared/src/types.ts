import type { z } from "zod";

/**
 * Definition of a single MCP prompt exposed by a pack server.
 *
 * The body is supplied either as inline text or as a `.md` filename
 * relative to the server's `src/prompts/` directory. At registration
 * time the loader resolves the filename to its content.
 */
export interface PromptDef {
  /** Slash-command suffix. e.g. `commit` → `/marvin:commit` */
  name: string;
  /** Short, human-facing description shown in the slash menu */
  description: string;
  /**
   * Optional positional-style arguments. Each becomes a string field on
   * the prompt's `arguments` schema; the user fills them via the slash
   * UI before the prompt is rendered.
   */
  arguments?: PromptArgumentDef[];
  /** Inline markdown body. Mutually exclusive with `skill` and `bodyFile`. */
  body?: string;
  /**
   * Name of a skill directory under `<packRoot>/skills/<skill>/SKILL.md`.
   * Body is read at request time and its YAML frontmatter is stripped.
   * This is the preferred path: SKILL.md stays the single source of
   * truth, and Claude Code can auto-discover the skill from its own
   * `description` frontmatter while the MCP prompt offers a slash entry
   * to the same content. Mutually exclusive with `body` and `bodyFile`.
   */
  skill?: string;
  /**
   * Filename (relative to the server's `src/prompts/` directory)
   * whose content is the prompt body. Used for inline prompt files
   * that have no frontmatter and no equivalent skill — e.g. thin
   * tool-wrapper prompts in the kanban group. Mutually exclusive
   * with `body` and `skill`.
   */
  bodyFile?: string;
}

export interface PromptArgumentDef {
  name: string;
  description: string;
  required?: boolean;
}

/**
 * Definition of a deterministic tool exposed by a pack server.
 *
 * Tools complement prompts. A prompt instructs the LLM with markdown;
 * a tool runs deterministic TypeScript (git ops, file CRUD, validation).
 *
 * Generic parameter only narrows the handler-side type. The runtime
 * always calls `inputSchema.safeParse`, so unknown shapes are caught at
 * call time.
 */
export interface ToolDef<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TInput;
  handler: (input: z.infer<TInput>) => Promise<ToolResult>;
}

/**
 * Helper for building a tool with full input-type inference, while the
 * caller can keep the result in a heterogeneous array via the
 * `AnyToolDef` alias.
 */
export type AnyToolDef = ToolDef<z.ZodTypeAny>;

export function defineTool<TInput extends z.ZodTypeAny>(def: ToolDef<TInput>): AnyToolDef {
  return def as unknown as AnyToolDef;
}

export interface ToolResult {
  /** Structured content returned to the model. */
  content: Array<{ type: "text"; text: string }>;
  /** Optional flag — true if the tool call failed at the application level. */
  isError?: boolean;
}
