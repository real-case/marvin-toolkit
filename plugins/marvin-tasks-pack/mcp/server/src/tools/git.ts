import { z } from "zod";
import { defineTool, elicit, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  currentBranch,
  git as runGit,
  gh as runGh,
  hasGh,
  hasGit,
  inGitRepo,
} from "../lib/git.js";
import { findTaskByBranch, readAllTasks } from "../storage/tasks.js";
import { trackerUrl } from "../storage/config.js";
import type { Config } from "../storage/schema.js";
import type { ServerEnv } from "../lib/env.js";

const GitInput = z.object({
  action: z.enum(["commit", "create-pr"]),
  message: z.string().optional(),
});
type GitInput = z.infer<typeof GitInput>;

const CommitType = z.enum([
  "feat",
  "fix",
  "chore",
  "docs",
  "refactor",
  "test",
  "style",
  "perf",
  "build",
  "ci",
]);

export function buildGitTool(
  server: McpServer,
  env: ServerEnv,
  config: Config,
): AnyToolDef {
  return defineTool({
    name: "git",
    description: "Marvin git operations tied to the current task: commit, create-pr.",
    inputSchema: GitInput,
    handler: (input) => {
      if (input.action === "commit") return runCommit(server, env, input.message);
      return runCreatePr(server, env, config);
    },
  });
}

async function runCommit(
  server: McpServer,
  env: ServerEnv,
  preMessage: string | undefined,
): Promise<ToolResult> {
  if (!hasGit()) return errOk("`git` not found on PATH.");
  if (!inGitRepo(env.projectDir)) return errOk("Not inside a git repository.");

  const { tasks } = readAllTasks(env.tasksDir);
  const branch = currentBranch(env.projectDir);
  const task = branch ? findTaskByBranch(tasks, branch) : null;

  const form = await elicit(
    server,
    "Commit",
    z.object({
      type: CommitType,
      scope: z.string().optional(),
      message: preMessage ? z.string().min(3).default(preMessage) : z.string().min(3),
      stage_all: z.enum(["yes", "no"]),
    }),
  );
  if (!form) return cancelled();

  const scope = form.scope ? `(${form.scope})` : "";
  const subject = `${form.type}${scope}: ${form.message}`;
  const refs = task
    ? `\n\nRefs: ${task.frontmatter.id}${
        task.frontmatter.tracker_id ? `, ${task.frontmatter.tracker_id}` : ""
      }`
    : "";
  const fullMessage = `${subject}${refs}`;

  if (form.stage_all === "yes") {
    const stage = runGit(["add", "-A"], env.projectDir);
    if (!stage.ok) return errOk(`git add failed: ${stage.stderr}`);
  }

  const commit = runGit(["commit", "-m", fullMessage], env.projectDir);
  if (!commit.ok) return errOk(`git commit failed: ${commit.stderr}`);

  const sha = runGit(["rev-parse", "HEAD"], env.projectDir);
  const stat = runGit(["show", "--stat", "--oneline", "HEAD"], env.projectDir);
  return ok(
    `Committed \`${sha.ok ? sha.value.slice(0, 8) : "?"}\`\n\n\`\`\`\n${stat.ok ? stat.value : ""}\n\`\`\``,
  );
}

async function runCreatePr(
  _server: McpServer,
  env: ServerEnv,
  config: Config,
): Promise<ToolResult> {
  if (!hasGit()) return errOk("`git` not found on PATH.");
  if (!inGitRepo(env.projectDir)) return errOk("Not inside a git repository.");

  const { tasks } = readAllTasks(env.tasksDir);
  const branch = currentBranch(env.projectDir);
  const task = branch ? findTaskByBranch(tasks, branch) : null;

  const title = task
    ? task.frontmatter.tracker_id
      ? `[${task.frontmatter.tracker_id}] ${task.frontmatter.title}`
      : `[${task.frontmatter.id}] ${task.frontmatter.title}`
    : `[${branch ?? "wip"}] Update`;

  const trackerLink = task ? trackerUrl(config, task.frontmatter.tracker_id) : null;
  const bodyLines: string[] = [];
  if (task) {
    bodyLines.push(`Task: \`marvin/tasks/${task.filename}\``);
    if (trackerLink) bodyLines.push(`Tracker: ${trackerLink}`);
  } else {
    bodyLines.push("_No marvin task linked to this branch._");
  }
  const body = bodyLines.join("\n");

  if (!hasGh()) {
    return ok(
      `**\`gh\` CLI not installed.** Run this manually:\n\n\`\`\`\ngh pr create --base ${config.base_branch} --title ${JSON.stringify(title)} --body ${JSON.stringify(body)}\n\`\`\``,
    );
  }

  const result = runGh(
    ["pr", "create", "--base", config.base_branch, "--title", title, "--body", body],
    env.projectDir,
  );
  if (!result.ok) return errOk(`gh pr create failed: ${result.stderr}`);
  return ok(`PR created: ${result.value.split("\n").pop() ?? result.value}`);
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function errOk(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function cancelled(): ToolResult {
  return ok("Cancelled — no changes made.");
}
