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
   * Directory where critic receipts live (default `.marvin/critique`,
   * ADR-0039) — `<NNN>-<slug>.md`, written by the calling session at the four
   * pipeline critic call sites and read by `report` and `summary`.
   *
   * No self-written `.gitignore`, unlike `.marvin/usage`, `.marvin/preview` and
   * `.marvin/export`: those are local or derived, while receipts are review
   * records with the same shareability as `.marvin/handoff/` and
   * `.marvin/security/`, neither of which self-ignores. This repository's own
   * `.gitignore` already hides them, which is a project choice and not a
   * property of the directory. `MARVIN_CRITIQUE_DIR` overrides it, chiefly for
   * test isolation.
   */
  critiqueDir: string;
  /**
   * Directory where the local usage log lives (default `.marvin/usage`,
   * ADR-0030). Holds `events.jsonl` (+ rotated generations) and a self-written
   * `.gitignore` = `*`. The dashboard reads `<projectDir>/.marvin/usage/` by
   * convention, so the default here is kept in lockstep with that path; the
   * `MARVIN_USAGE_DIR` override exists for test isolation.
   */
  usageDir: string;
  /**
   * Directory holding the `report` tool's OWN triage baseline (default
   * `.marvin/report`, ADR-0038) — `triage.json` plus a self-written
   * `.gitignore` = `*`, created lazily and only on the `snapshot: true` path.
   *
   * The name is a hazard worth stating: `.marvin/report/` is NOT one of the
   * five group directories the tool scans (`security`, `refactor`, `task`,
   * `handoff`, `critique`), so it reads to a maintainer as a further report
   * group and is not one. It is server state, and it must never appear in the
   * viewer that owns it. `MARVIN_REPORT_DIR` overrides it, chiefly for test
   * isolation.
   */
  reportDir: string;
  /**
   * Directory where the task-metrics records live (default `.marvin/metrics`,
   * ADR-0043) — one `<NNN>-<slug>.md` per spec, named after the spec's own
   * file, written by the `metrics` tool. COMMITTED by design: the repository's
   * `.gitignore` negates it, and a host project is asked to do the same. No
   * self-written `.gitignore`, for the reason `critiqueDir` gives: this is a
   * shared record, and ignoring it is a project's choice, not a property of the
   * directory. `MARVIN_METRICS_DIR` overrides it, chiefly for test isolation.
   */
  metricsDir: string;
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

/**
 * The same rule as {@link projectConfigPath}, for any startup-resolved directory:
 * the startup value while the root is unchanged — which keeps the `MARVIN_*_DIR`
 * overrides authoritative for the normal case and for the test isolation they
 * exist for — and the target tree's own `.marvin/<name>` otherwise. `summary`
 * applies it to receipts; the `metrics` tool applies it to receipts and records.
 */
export function projectScopedDir(
  env: ServerEnv,
  projectRoot: string,
  startupDir: string,
  name: string,
): string {
  return projectRoot === env.projectDir ? startupDir : join(projectRoot, ".marvin", name);
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const projectDir = env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const tasksDir = env.MARVIN_TASKS_DIR ?? join(projectDir, ".marvin", "track");
  const configPath = env.MARVIN_TASKS_CONFIG ?? join(projectDir, ".marvin", "config.json");
  const memoryDir = env.MARVIN_MEMORY_DIR ?? join(projectDir, ".marvin", "memory");
  const handoffDir = env.MARVIN_HANDOFF_DIR ?? join(projectDir, ".marvin", "handoff");
  const securityDir = env.MARVIN_SECURITY_DIR ?? join(projectDir, ".marvin", "security");
  const critiqueDir = env.MARVIN_CRITIQUE_DIR ?? join(projectDir, ".marvin", "critique");
  const usageDir = env.MARVIN_USAGE_DIR ?? join(projectDir, ".marvin", "usage");
  const reportDir = env.MARVIN_REPORT_DIR ?? join(projectDir, ".marvin", "report");
  const metricsDir = env.MARVIN_METRICS_DIR ?? join(projectDir, ".marvin", "metrics");
  return {
    projectDir,
    tasksDir,
    configPath,
    memoryDir,
    handoffDir,
    securityDir,
    critiqueDir,
    usageDir,
    reportDir,
    metricsDir,
  };
}
