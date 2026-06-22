import { join } from "node:path";

/**
 * Resolved environment for the tasks server. Reads the standard MCP
 * variables once at startup and exposes a single shape the rest of the
 * server consumes.
 */
export interface ServerEnv {
  /** Project root, from CLAUDE_PROJECT_DIR or process.cwd(). */
  projectDir: string;
  /** Directory where kanban task `.md` files live (default `.marvin/kanban`). */
  tasksDir: string;
  /** Path to optional `.marvin/config.json`. */
  configPath: string;
  /** Directory where lessons-learned `.md` files live (default `.marvin/memory`). */
  memoryDir: string;
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const projectDir = env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const tasksDir = env.MARVIN_TASKS_DIR ?? join(projectDir, ".marvin", "kanban");
  const configPath = env.MARVIN_TASKS_CONFIG ?? join(projectDir, ".marvin", "config.json");
  const memoryDir = env.MARVIN_MEMORY_DIR ?? join(projectDir, ".marvin", "memory");
  return { projectDir, tasksDir, configPath, memoryDir };
}
