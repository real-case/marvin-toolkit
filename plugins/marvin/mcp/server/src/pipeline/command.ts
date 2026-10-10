import { isAbsolute } from "node:path";
import type { Assignment, Role } from "./run-store.js";

export interface ChildLaunchSpec {
  role: Role;
  name: string;
  cwd: string;
  runDir: string;
  orchestratorName: string;
  base: string;
  assignment: Assignment;
  prompt: string;
  settingsPath: string;
  systemPromptPath: string;
  schema: string;
  resumeSessionId?: string;
  allowedTools?: readonly string[];
  testPathPattern?: string;
  pluginDir: string;
  branch: string | null;
}

export interface ChildCommand {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
}

export const READ_ONLY_ROLES: ReadonlySet<Role> = new Set<Role>(["verifier", "retro"]);

export const WRITING_ROLES: ReadonlySet<Role> = new Set<Role>([
  "planner",
  "test-author",
  "executor",
]);

export const READ_ONLY_DISALLOWED_TOOLS = [
  "Edit",
  "Write",
  "NotebookEdit",
  "MultiEdit",
  "Bash(git push:*)",
] as const;

export const READ_BASE_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "SendMessage",
  "ListAgents",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git status:*)",
  "Bash(git ls-files:*)",
  "Bash(git merge-base:*)",
  "Bash(git rev-parse:*)",
  "Bash(gh pr view:*)",
  "Bash(gh pr diff:*)",
] as const;

/** Throws unless `prefix` can stand in a `Bash(<prefix>:*)` allowlist entry. */
export function validatePrefix(prefix: string): void {
  if (prefix !== prefix.trim()) {
    throw new Error(`invalid allowlist prefix: ${prefix}`);
  }
  if (prefix.length === 0) {
    throw new Error(`invalid allowlist prefix: ${prefix}`);
  }
  if (/[(),[*\n]/.test(prefix)) {
    throw new Error(`invalid allowlist prefix: ${prefix}`);
  }
}

export function readOnlyAllowedTools(probePrefixes: readonly string[]): string[] {
  probePrefixes.forEach((p) => validatePrefix(p));
  return [...READ_BASE_TOOLS, ...probePrefixes.map((p) => `Bash(${p}:*)`)];
}

export const WRITING_BASE_TOOLS = [
  "mcp__plugin_marvin_marvin",
  "SendMessage",
  "ListAgents",
] as const;

export function writingAllowedTools(commandPrefixes: readonly string[]): string[] {
  commandPrefixes.forEach((p) => validatePrefix(p));
  return [...WRITING_BASE_TOOLS, ...commandPrefixes.map((p) => `Bash(${p}:*)`)];
}

export type ModelFamily = "opus" | "sonnet" | "haiku";

const MODEL_ALIAS = /^(opus|sonnet|haiku)$/;
const MODEL_FULL_ID = /^claude-(opus|sonnet|haiku)-[0-9a-z.-]+$/;

/**
 * The one model rule the pipeline enforces: Fable is refused first, in any case, then the
 * model must be an `opus|sonnet|haiku` alias or a full `claude-<family>-…` id. The child
 * command and the rubric loader both go through it, so a model that cannot launch is
 * rejected when the rubric loads rather than when a child starts.
 */
export function modelFamily(model: string): ModelFamily {
  if (/fable/i.test(model)) throw new Error(`Fable is not allowed (user rule): ${model}`);
  const family = MODEL_ALIAS.exec(model)?.[1] ?? MODEL_FULL_ID.exec(model)?.[1];
  if (!family) throw new Error(`model not allowed: ${model}`);
  return family as ModelFamily;
}

/**
 * The marvin MCP server as a writing child sees it. `--strict-mcp-config` keeps the user's and
 * the project's MCP servers out of a child, and it keeps the plugin's own servers out too: a
 * child launched with it and no `--mcp-config` has no MCP server at all, so the planner cannot
 * reach `spec` and the executor cannot reach `verify` (measured with Claude Code 2.1.286 in the
 * live sandbox run, 2026-10-10). The server is therefore handed back explicitly, under the name
 * that yields the plugin's tool names (`mcp__plugin_marvin_marvin__*`), so allowlists, guards and
 * skill prose stay as they are. Its environment is the plugin's `.mcp.json` resolved for the
 * child's project, which is its worktree.
 */
export const MARVIN_MCP_SERVER = "plugin_marvin_marvin";

export function marvinMcpConfig(pluginDir: string, projectDir: string): string {
  return JSON.stringify({
    mcpServers: {
      [MARVIN_MCP_SERVER]: {
        command: "node",
        args: [`${pluginDir}/mcp/server/dist/server.js`],
        env: {
          MARVIN_TASKS_DIR: `${projectDir}/.marvin/track`,
          MARVIN_TASKS_CONFIG: `${projectDir}/.marvin/config.json`,
        },
      },
    },
  });
}

/**
 * Lets a writing child read marvin's own files. A skill's prose names its references by plugin
 * path, the plugin sits outside the child's worktree, and with prompts off a read outside the cwd
 * is denied: the live sandbox planner could not open `skills/task-start/SKILL.md` and wrote a spec
 * without a contract. A leading `//` makes the rule's path absolute.
 */
export function pluginReadRule(pluginDir: string): string {
  if (/[()\n]/.test(pluginDir))
    throw new Error(`pluginDir cannot stand in a permission rule: ${pluginDir}`);
  return `Read(/${pluginDir}/**)`;
}

export function buildChildCommand(s: ChildLaunchSpec): ChildCommand {
  // Validate role (F3: fail-closed role handling)
  if (!READ_ONLY_ROLES.has(s.role) && !WRITING_ROLES.has(s.role)) {
    throw new Error(`unknown role: ${s.role}`);
  }

  // Validate and require allowedTools early (before argv construction)
  if (!s.allowedTools?.length) throw new Error(`${s.role} needs an explicit allowedTools list`);

  // Validate read-only role allowlists (F3)
  if (READ_ONLY_ROLES.has(s.role)) {
    for (const entry of s.allowedTools) {
      if (
        entry.startsWith("mcp__") ||
        entry === "Edit" ||
        entry === "Write" ||
        entry === "MultiEdit" ||
        entry === "NotebookEdit"
      ) {
        throw new Error(`read-only role ${s.role} cannot be granted ${entry}`);
      }
    }
  }

  if (typeof s.pluginDir !== "string" || !isAbsolute(s.pluginDir)) {
    throw new Error(`${s.role} needs an absolute pluginDir (marvin's plugin root)`);
  }

  modelFamily(s.assignment.model);

  const argv = [
    "claude",
    "-p",
    s.prompt,
    "-n",
    s.name,
    "--model",
    s.assignment.model,
    "--effort",
    s.assignment.effort,
    "--permission-prompts",
    "none",
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    // Read-only roles get no MCP server: none of their allowlists names one (spike S2).
    ...(WRITING_ROLES.has(s.role) ? ["--mcp-config", marvinMcpConfig(s.pluginDir, s.cwd)] : []),
    "--plugin-dir",
    s.pluginDir,
    "--output-format",
    "stream-json",
    "--verbose",
    "--settings",
    s.settingsPath,
    "--append-system-prompt-file",
    s.systemPromptPath,
    "--json-schema",
    s.schema,
  ];

  if (READ_ONLY_ROLES.has(s.role)) {
    argv.push(
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      ...s.allowedTools,
      "--disallowedTools",
      ...READ_ONLY_DISALLOWED_TOOLS,
    );
  } else {
    argv.push(
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      ...s.allowedTools,
      pluginReadRule(s.pluginDir),
    );
  }

  if (s.resumeSessionId) argv.push("--resume", s.resumeSessionId);

  const env: Record<string, string> = {
    MARVIN_PIPELINE: "1",
    MARVIN_PIPELINE_RUN: s.runDir,
    MARVIN_PIPELINE_ROLE: s.role,
    MARVIN_PIPELINE_CHILD: s.name,
    MARVIN_PIPELINE_ORCH: s.orchestratorName,
    MARVIN_PIPELINE_BASE: s.base,
    MARVIN_PIPELINE_BRANCH: s.branch ?? "",
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
    BASH_DEFAULT_TIMEOUT_MS: "600000",
    BASH_MAX_TIMEOUT_MS: "1800000",
    HUSKY: "0",
  };
  if (s.role === "verifier") env.CI = "true";
  if (s.testPathPattern) env.MARVIN_PIPELINE_TEST_PATTERN = s.testPathPattern;
  return { argv, env, cwd: s.cwd };
}
