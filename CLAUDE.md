# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this

Marvin is a Claude Code plugin marketplace. It ships curated packs of skills, commands, agents, and MCP servers covering the full development lifecycle. Each pack is a self-contained plugin that users install via the Claude Code CLI.

## Validation

```shell
# Local validation (requires claude CLI)
claude plugin validate .

# CI runs automatically on push/PR to main — validates:
# - JSON syntax of marketplace.json and all plugin.json files
# - YAML frontmatter presence and description field in all SKILL.md and agent files
# - Plugin directory structure matches marketplace.json entries
```

## Architecture

Four instrument types, in order of complexity:

**Commands** (`plugins/<pack>/commands/<name>.md`) — lightweight entry points. Each command file has YAML frontmatter with `description` and a body that points to its corresponding skill. This is what users invoke via `/mn.<name>`.

**Skills** (`plugins/<pack>/skills/<name>/SKILL.md`) — the actual logic. Multi-step workflows with phases, guidelines, examples, and edge cases. A command delegates to exactly one skill. Skills are the core of the toolkit.

**Agents** (`plugins/<pack>/agents/<name>.md`) — autonomous subagents with constrained tool access for specialized domains (onboarding, security review, spec writing).

**MCP Servers** (`plugins/<pack>/.mcp.json`) — external tool integrations bundled with a pack. Auto-started on plugin install. Currently only marvin-core-pack ships MCP servers (context7, gitmcp).

### Relationship: command → skill

Every skill has a matching command. The command file is the entry point (`/mn.commit`), the SKILL.md contains the full workflow. When adding a new skill, always create both files.

### Namespace convention

All commands use `mn.` prefix. Security pack uses `mn.sec.` sub-prefix.

## Plugin packs

Three packs in `plugins/`:

- **marvin-core-pack** (v0.1.0-alpha.1) — 10 skills, 2 agents, 2 MCP servers. Core dev workflows: commits, PRs, reviews, debugging, ADRs, changelogs, migration planning.
- **marvin-security-pack** (v0.1.0-alpha.1) — 10 skills (+1 deprecated alias `mn.security-scan`), 1 agent. OWASP audits, secret scanning, dependency checks, threat modeling, compliance.
- **marvin-taskmaster-pack** (v0.1.0-alpha.5) — 5 skills (`mn.start`, `mn.run`, `mn.verify`, `mn.deliver`, `mn.fix-pr`), 5 agents (`marvin-tm-writer`, `marvin-tm-executor`, `marvin-tm-spec-critic`, `marvin-tm-diff-critic`, `marvin-tm-review-fixer`), 1 shell script (`dispatch.sh`). Commands use the `mn.taskmaster-` prefix (e.g. `/mn.taskmaster-start`, `/mn.taskmaster-run`). Spec-driven pipeline: `/mn.taskmaster-start` (spec co-creation) → `/mn.taskmaster-run` (interactive execution) or `dispatch.sh` (headless batch) → `/mn.taskmaster-fix-pr` (PR fixes), with red-team spec and diff critics.

## Adding a new skill

1. Create `plugins/<pack>/skills/<skill-name>/SKILL.md` with YAML frontmatter containing `description`
2. Create matching `plugins/<pack>/commands/<command-name>.md` with YAML frontmatter containing `description`
3. Command body should reference the skill path and describe argument handling
4. Bump version in `plugins/<pack>/.claude-plugin/plugin.json`

## Adding a new agent

1. Create `plugins/<pack>/agents/<agent-name>.md` with YAML frontmatter containing `description`
2. Specify available tools and domain constraints in the agent body
3. Bump version in `plugins/<pack>/.claude-plugin/plugin.json`

## Adding a new pack

1. Create `plugins/<pack-name>/.claude-plugin/plugin.json` with name, description, version, author
2. Add skills, commands, and/or agents
3. Add the pack entry to `.claude-plugin/marketplace.json` plugins array
4. Optionally add `.mcp.json` in the pack root for MCP servers

## Version bumping

Bump version in the pack's `plugin.json` on every change. Follow semver:
- **Patch** (0.1.x): prompt tweaks, bug fixes
- **Minor** (0.x.0): new skills, commands, agents, or MCP servers
- **Major** (x.0.0): breaking changes, renamed commands

## Key files

- `.claude-plugin/marketplace.json` — marketplace manifest, lists all packs
- `plugins/<pack>/.claude-plugin/plugin.json` — pack manifest
- `.github/workflows/validate-plugins.yml` — CI validation pipeline
