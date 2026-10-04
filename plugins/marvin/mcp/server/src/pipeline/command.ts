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

function validatePrefix(prefix: string): void {
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

  // Check Fable first (F2)
  if (/fable/i.test(s.assignment.model))
    throw new Error(`Fable is not allowed (user rule): ${s.assignment.model}`);

  // Validate model allowlist (F2)
  if (
    !/^(opus|sonnet|haiku)$/.test(s.assignment.model) &&
    !/^claude-(opus|sonnet|haiku)-[0-9a-z.-]+$/.test(s.assignment.model)
  ) {
    throw new Error(`model not allowed: ${s.assignment.model}`);
  }

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
    argv.push("--permission-mode", "acceptEdits", "--allowedTools", ...s.allowedTools);
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
