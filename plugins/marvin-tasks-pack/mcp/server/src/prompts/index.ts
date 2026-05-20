import type { PromptDef } from "@marvin-toolkit/mcp-shared";

/**
 * Thin prompt wrappers. Each prompt just instructs the model to call
 * the matching tool with the right pre-fills. Bodies are inline because
 * each one is one sentence — putting them in `.md` files would be more
 * file-system noise than signal.
 */
function callTool(tool: string, args: Record<string, string> = {}): string {
  const pairs = Object.entries(args).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  const argText = pairs.length > 0 ? ` with ${pairs.join(", ")}` : "";
  return `Invoke the \`${tool}\` MCP tool from the \`marvin-tasks\` server${argText}. Use the user's choices from the elicitation form to fill any other fields. Do not add preamble — just call the tool.`;
}

export const PROMPTS: PromptDef[] = [
  {
    name: "menu",
    description: "Marvin tasks main menu",
    body: callTool("task"),
  },
  {
    name: "bug",
    description: "Create a bug task",
    body: callTool("task", { action: "create", type: "bug" }),
  },
  {
    name: "feature",
    description: "Create a feature task",
    body: callTool("task", { action: "create", type: "feature" }),
  },
  {
    name: "chore",
    description: "Create a chore task",
    body: callTool("task", { action: "create", type: "chore" }),
  },
  {
    name: "spike",
    description: "Create a spike task",
    body: callTool("task", { action: "create", type: "spike" }),
  },
  {
    name: "start",
    description: "Pick a todo task, branch off, and mark it WIP",
    body: callTool("task", { action: "start" }),
  },
  {
    name: "review",
    description: "Move current task to review",
    body: callTool("task", { action: "review" }),
  },
  {
    name: "done",
    description: "Mark current task done",
    body: callTool("task", { action: "done" }),
  },
  {
    name: "list",
    description: "List all tasks grouped by status",
    body: callTool("task", { action: "list" }),
  },
  {
    name: "status",
    description: "Current branch + WIP tasks",
    body: callTool("task", { action: "status" }),
  },
  {
    name: "help",
    description: "Marvin tasks dashboard and prompt list",
    body: callTool("help"),
  },
  {
    name: "commit",
    description: "Commit with current task context",
    body: callTool("git", { action: "commit" }),
  },
  {
    name: "create-pr",
    description: "Create a PR for the current task",
    body: callTool("git", { action: "create-pr" }),
  },
];
