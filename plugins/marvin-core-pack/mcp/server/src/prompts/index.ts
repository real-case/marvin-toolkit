import type { PromptDef } from "@marvin-toolkit/mcp-shared";

/**
 * Prompts for marvin-core-pack. Body source: each prompt points to a
 * SKILL.md under `plugins/marvin-core-pack/skills/`. The skill file is
 * the single source of truth — Claude Code auto-discovers it through
 * its own `description` frontmatter, while this MCP server exposes a
 * slash entry to the same content.
 */
export const PROMPTS: PromptDef[] = [
  {
    name: "commit",
    description:
      "Safe git commit workflow — inspects repo state, stages intentionally, detects sensitive files, drafts a Conventional Commits message, confirms with the user, and handles pre-commit hook failures cleanly.",
    skill: "mn.commit",
  },
  {
    name: "pr",
    description:
      "Create a pull request with structured description, verification checklist, and issue linking.",
    skill: "mn.pr",
  },
  {
    name: "review",
    description:
      "Thorough code review covering bugs, logic errors, security issues, performance, readability, and style conformance. Findings grouped by severity with suggested fixes.",
    skill: "mn.review",
  },
  {
    name: "debug",
    description:
      "Systematic root-cause debugging — guides hypothesis-driven analysis, evidence gathering, and minimal reproductions instead of guessing.",
    skill: "mn.debug",
  },
  {
    name: "adr",
    description:
      "Create a structured Architecture Decision Record (ADR) capturing context, alternatives considered, the decision, and consequences in MADR / Nygard format.",
    skill: "mn.adr",
  },
  {
    name: "changelog",
    description:
      "Generate a changelog from git commit history between tags, date ranges, or arbitrary refs.",
    skill: "mn.changelog",
  },
  {
    name: "readme",
    description:
      "Generate or update README.md based on actual codebase analysis.",
    skill: "mn.readme",
  },
  {
    name: "migration-plan",
    description:
      "Plan a migration or large-scale refactor with explicit dependency analysis, phased steps, risk inventory, rollback strategy, and verification checkpoints.",
    skill: "mn.migration-plan",
  },
  {
    name: "explaining-code",
    description:
      "Explain selected code, architecture decisions, or system behavior.",
    skill: "mn.explaining-code",
  },
  {
    name: "docs-search",
    description:
      "Search and retrieve relevant documentation from the codebase and external sources — ADRs, READMEs, runbooks, configs.",
    skill: "mn.docs-search",
  },
];
