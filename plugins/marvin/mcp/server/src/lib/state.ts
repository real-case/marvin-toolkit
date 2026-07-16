import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DashboardState } from "@marvin-toolkit/mcp-shared/contracts";
import { readAllTasks } from "../storage/tasks.js";
import { roleOfStatus, type Config, type StatusRole } from "../storage/schema.js";
import { currentBranch, hasGh, hasGit, inGitRepo } from "./git.js";
import { PROMPTS } from "../prompts/index.js";
import type { ServerEnv } from "./env.js";

/**
 * Shared project-state computation (ADR-0024 → ADR-0030). The `help` tool has
 * always computed the board counters, git availability, artifact counts, and
 * the registry-derived command groups for its `DashboardState` payload; the
 * `dashboard` tool aggregates the same state into the whole-toolbox report, so
 * the computation lives here once instead of being copy-pasted.
 */

export interface BoardCounts {
  /** Per-status counts over the configured set — every key present, even at 0. */
  counts: Record<string, number>;
  /** The closed per-role roll-up (ADR-0026). */
  roleCounts: Record<StatusRole, number>;
  /** Board files the tolerant reader could not parse. */
  malformed: number;
}

/** Board counters over the configured status set (ADR-0026). */
export function boardCounts(env: ServerEnv, config: Config): BoardCounts {
  const { tasks, malformed } = readAllTasks(env.tasksDir, config);
  const counts: Record<string, number> = {};
  for (const s of config.statuses) counts[s.key] = 0;
  const roleCounts: Record<StatusRole, number> = {
    todo: 0,
    wip: 0,
    review: 0,
    done: 0,
    blocked: 0,
  };
  for (const t of tasks) {
    counts[t.frontmatter.status] = (counts[t.frontmatter.status] ?? 0) + 1;
    roleCounts[roleOfStatus(config, t.frontmatter.status)] += 1;
  }
  return { counts, roleCounts, malformed: malformed.length };
}

/** git / gh availability and the current branch (null outside a repo). */
export function gitState(projectDir: string): DashboardState["git"] {
  return {
    has_git: hasGit(),
    has_gh: hasGh(),
    branch: inGitRepo(projectDir) ? currentBranch(projectDir) : null,
  };
}

const GROUP_PREFIXES = ["adr", "pr", "task", "sec", "refactor", "track"];
export const GROUP_ORDER = ["core", "adr", "pr", "task", "sec", "refactor", "track"];

/**
 * Group of a prompt by its `<group>-<command>` prefix; bare names are "core" —
 * including a bare name that *equals* a prefix (the `/marvin:adr` create
 * singleton is a core tool; the `adr-*` lifecycle around it is the group).
 */
export function groupOf(name: string): string {
  const prefix = name.split("-")[0] ?? "";
  return prefix !== name && GROUP_PREFIXES.includes(prefix) ? prefix : "core";
}

/** Command counts per group, derived from the prompt registry (ADR-0024). */
export function commandGroups(): DashboardState["command_groups"] {
  return GROUP_ORDER.map((group) => ({
    group,
    count: PROMPTS.filter((p) => groupOf(p.name) === group).length,
  })).filter((g) => g.count > 0);
}

/** Count the `.md` artifacts under each `.marvin/` subdir for the dashboard. */
export function artifactCounts(env: ServerEnv): DashboardState["artifacts"] {
  const marvin = join(env.projectDir, ".marvin");
  return {
    specs: countMarkdown(join(marvin, "task"), ["verification.md"]),
    handoffs: countMarkdown(join(marvin, "handoff")),
    audits: countMarkdown(join(marvin, "security")),
    lessons: countMarkdown(env.memoryDir, ["MEMORY.md"]),
  };
}

/** `.md` files in a directory, minus exclusions; a missing dir counts 0. */
export function countMarkdown(dir: string, exclude: string[] = []): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md") && !exclude.includes(f)).length;
  } catch {
    return 0;
  }
}
