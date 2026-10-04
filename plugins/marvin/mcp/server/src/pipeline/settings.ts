import { join } from "node:path";
import type { Role } from "./run-store.js";

const EDIT_TOOLS = "Edit|Write|MultiEdit|NotebookEdit";

export function buildRoleSettings(role: Role, hooksDir: string): Record<string, unknown> {
  const hook = (file: string) => ({
    type: "command",
    command: `node "${join(hooksDir, file)}"`,
    timeout: 10,
  });
  const pre: { matcher: string; hooks: unknown[] }[] = [
    { matcher: "Bash", hooks: [hook("child-git-guard.mjs")] },
    {
      matcher: "mcp__.*marvin.*__(task|tracker|spec|adr|lessons|verify|report)$",
      hooks: [hook("child-mcp-guard.mjs")],
    },
  ];
  if (role === "verifier" || role === "retro")
    pre.push({ matcher: "Bash", hooks: [hook("readonly-guard.mjs")] });
  if (role === "planner" || role === "test-author" || role === "executor")
    pre.push({ matcher: EDIT_TOOLS, hooks: [hook("worktree-boundary-guard.mjs")] });
  if (role === "executor") pre.push({ matcher: EDIT_TOOLS, hooks: [hook("sealed-guard.mjs")] });
  if (role === "test-author")
    pre.push({ matcher: EDIT_TOOLS, hooks: [hook("test-path-guard.mjs")] });
  const post = [
    { matcher: "SendMessage", hooks: [hook("message-log.mjs")] },
    { matcher: "*", hooks: [hook("heartbeat.mjs")] },
  ];
  return { outputStyle: "default", hooks: { PreToolUse: pre, PostToolUse: post } };
}
