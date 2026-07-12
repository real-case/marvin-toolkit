import type { HelpState } from "@marvin-toolkit/mcp-shared/contracts";
import {
  COMMAND_BLURBS,
  COMMAND_DETAILS,
  COMMAND_EXAMPLES,
  COMMAND_PROMPTS,
  GROUP_BLURBS,
} from "@marvin-toolkit/mcp-shared/help-content";

/**
 * A representative full HelpState (ADR-0024) shared by the tests and the story —
 * the `telegram-publications` project from the approved mockup: every command
 * group and all 57 commands, a mix of lit/dim MCP servers, and a non-trivial
 * artifact count. All values are fixed literals (no Date.now()) so the story and
 * snapshots stay deterministic.
 *
 * The command *content* — group blurbs, per-command blurbs, descriptions,
 * direct-call examples, and prose phrases — is imported from the shared
 * `help-content` module the `help` tool itself ships, so this preview renders
 * exactly what production renders and can never drift. Only the mock's *shape* is
 * local: which commands exist and their group / human-run flag (the
 * `[group, name, human]` roster below), plus the surrounding project/git/server
 * context.
 */
const COMMANDS: Array<[string, string, boolean]> = [
  ["core", "commit", false],
  ["core", "debug", false],
  ["core", "adr", false],
  ["core", "changelog", false],
  ["core", "readme", false],
  ["core", "migration-plan", false],
  ["core", "explain", false],
  ["core", "docs-search", false],
  ["core", "handoff", false],
  ["core", "handoff-list", false],
  ["core", "lessons", false],
  ["core", "help", false],
  ["core", "dashboard", false],
  ["adr", "adr-review", false],
  ["adr", "adr-accept", true],
  ["adr", "adr-audit", false],
  ["adr", "adr-coverage", false],
  ["adr", "adr-supersede", true],
  ["adr", "adr-sync", true],
  ["pr", "pr-create", false],
  ["pr", "pr-review", false],
  ["pr", "pr-resolve", false],
  ["pr", "pr-merge", false],
  ["task", "task-start", false],
  ["task", "task-implement", false],
  ["task", "task-verify", false],
  ["task", "task-deliver", false],
  ["task", "task-summary", false],
  ["sec", "sec-scan", false],
  ["sec", "sec-secrets", false],
  ["sec", "sec-deps", false],
  ["sec", "sec-gate", false],
  ["sec", "sec-threat-model", false],
  ["sec", "sec-iac", false],
  ["sec", "sec-ci", false],
  ["sec", "sec-fix", false],
  ["sec", "sec-compliance", false],
  ["sec", "sec-pentest", false],
  ["sec", "sec-report", false],
  ["refactor", "refactor-audit", false],
  ["refactor", "refactor-smells", false],
  ["refactor", "refactor-plan", false],
  ["refactor", "refactor-apply", false],
  ["kanban", "kanban-menu", false],
  ["kanban", "kanban-bug", false],
  ["kanban", "kanban-feature", false],
  ["kanban", "kanban-chore", false],
  ["kanban", "kanban-spike", false],
  ["kanban", "kanban-start", false],
  ["kanban", "kanban-review", false],
  ["kanban", "kanban-done", false],
  ["kanban", "kanban-list", false],
  ["kanban", "kanban-show", false],
  ["kanban", "kanban-tracker", false],
  ["kanban", "kanban-status", false],
  ["kanban", "kanban-config", false],
  ["kanban", "kanban-help", false],
];

/** Group keys in first-appearance (board) order, derived from the roster. */
const GROUP_ORDER = [...new Set(COMMANDS.map(([group]) => group))];

export const helpFixture: HelpState = {
  version: "0.1.0",
  slogan: "Claude Code toolset for AI development without panic",
  project: "telegram-publications",
  git: {
    branch: "task/telegram-publications-ingestion",
    base_branch: "main",
    has_git: true,
    has_gh: true,
  },
  statuses: [
    { key: "todo", role: "todo", count: 0 },
    { key: "wip", role: "wip", count: 0 },
    { key: "review", role: "review", count: 0 },
    { key: "done", role: "done", count: 0 },
    { key: "blocked", role: "blocked", count: 0 },
  ],
  artifacts: { specs: 40, handoffs: 0, audits: 0, lessons: 0 },
  servers: [
    { name: "marvin", enabled: true },
    { name: "context7", enabled: true },
    { name: "gitmcp", enabled: true },
    { name: "playwright", enabled: false },
    { name: "telegram", enabled: true },
    { name: "postgres", enabled: true },
    { name: "github", enabled: true },
    { name: "sentry", enabled: false },
    { name: "filesystem", enabled: true },
    { name: "obsidian", enabled: false },
    { name: "chrome-devtools", enabled: true },
    { name: "fetch", enabled: false },
  ],
  groups: GROUP_ORDER.map((group) => ({ group, blurb: GROUP_BLURBS[group] ?? "" })),
  commands: COMMANDS.map(([group, name, human]) => ({
    group,
    name,
    blurb: COMMAND_BLURBS[name] ?? "",
    description: COMMAND_DETAILS[name] ?? "",
    ...(COMMAND_EXAMPLES[name] ? { example: COMMAND_EXAMPLES[name] } : {}),
    phrases: [...(COMMAND_PROMPTS[name] ?? [])],
    human,
  })),
};

/**
 * No MCP servers configured — the host project carries no `.mcp.json`, so the
 * servers section shows the italic "none configured" note. Smallest delta over
 * the base fixture: only `servers` changes.
 */
export const noServersHelpFixture: HelpState = {
  ...helpFixture,
  servers: [],
};

/**
 * No board statuses configured — `.marvin/config.json` has an empty `statuses`
 * vocabulary (ADR-0026), so the kanban summary row degrades to its
 * "no statuses configured" note. Smallest delta: only `statuses` changes.
 */
export const noStatusesHelpFixture: HelpState = {
  ...helpFixture,
  statuses: [],
};

/**
 * Not inside a git repository — `branch` is null (and the has-flags honest), so
 * the git summary row shows "not in a git repo". Smallest delta: only `git`
 * changes; `base_branch` keeps the config default the tool would still report.
 */
export const noGitHelpFixture: HelpState = {
  ...helpFixture,
  git: { branch: null, base_branch: "main", has_git: false, has_gh: false },
};
