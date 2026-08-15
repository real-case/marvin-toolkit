import { join } from "node:path";

/**
 * Resolved environment for the tasks server. Reads the standard MCP
 * variables once at startup and exposes a single shape the rest of the
 * server consumes.
 */
export interface ServerEnv {
  /** Project root, from CLAUDE_PROJECT_DIR or process.cwd(). */
  projectDir: string;
  /** Directory where board task `.md` files live (default `.marvin/track`). */
  tasksDir: string;
  /** Path to optional `.marvin/config.json`. */
  configPath: string;
  /** Directory where lessons-learned `.md` files live (default `.marvin/memory`). */
  memoryDir: string;
  /** Directory where handoff `.md` documents live (default `.marvin/handoff`). */
  handoffDir: string;
  /** Directory where `sec-*` scanners write their reports (default `.marvin/security`). */
  securityDir: string;
  /**
   * Directory where the local usage log lives (default `.marvin/usage`,
   * ADR-0030). Holds `events.jsonl` (+ rotated generations) and a self-written
   * `.gitignore` = `*`. The dashboard reads `<projectDir>/.marvin/usage/` by
   * convention, so the default here is kept in lockstep with that path; the
   * `MARVIN_USAGE_DIR` override exists for test isolation.
   */
  usageDir: string;
}

/**
 * The config file that governs a call's OWN project root.
 *
 * `ServerEnv` is resolved once at startup from the process environment, so
 * `env.configPath` describes the project the server was spawned for. A tool that
 * accepts a `projectRoot` argument can be pointed at a different tree, and
 * reading the startup config there applies one project's settings — `spec.dir`,
 * `base_branch`, the gate table — to another project's files. So: the startup
 * path while the root is unchanged, which is what keeps the
 * `MARVIN_TASKS_CONFIG` override authoritative for the normal case; the target
 * tree's own `.marvin/config.json` otherwise.
 *
 * `tools/spec.ts` carries a private twin of this rule (`specConfigPath`); fold
 * it in here when that file is next touched.
 */
export function projectConfigPath(env: ServerEnv, projectRoot: string): string {
  return projectRoot === env.projectDir
    ? env.configPath
    : join(projectRoot, ".marvin", "config.json");
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const projectDir = env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const tasksDir = env.MARVIN_TASKS_DIR ?? join(projectDir, ".marvin", "track");
  const configPath = env.MARVIN_TASKS_CONFIG ?? join(projectDir, ".marvin", "config.json");
  const memoryDir = env.MARVIN_MEMORY_DIR ?? join(projectDir, ".marvin", "memory");
  const handoffDir = env.MARVIN_HANDOFF_DIR ?? join(projectDir, ".marvin", "handoff");
  const securityDir = env.MARVIN_SECURITY_DIR ?? join(projectDir, ".marvin", "security");
  const usageDir = env.MARVIN_USAGE_DIR ?? join(projectDir, ".marvin", "usage");
  return { projectDir, tasksDir, configPath, memoryDir, handoffDir, securityDir, usageDir };
}
