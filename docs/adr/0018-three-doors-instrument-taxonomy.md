# ADR 0018 — Three doors & instrument taxonomy

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-21                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0001](0001-single-plugin-consolidation.md) (one plugin, one server), [ADR-0008](0008-mcp-door-resource-resolution.md) (MCP-door resource resolution), `plugins/marvin/skills/`, `plugins/marvin/commands/`, `plugins/marvin/mcp/server/src/prompts/index.ts` |

> Records a structural convention already in effect. It was described in `CLAUDE.md` and the
> architecture overview but never captured as a decision with its trade-offs.

## Context

A Marvin command should be reachable however the user reaches for it: by describing the task
in prose (Claude Code auto-discovery), by typing a short slash command, or by the
`/marvin:<command>` MCP prompt. Supporting all three naively would mean maintaining the same
workflow prose in three places and letting them drift.

The toolkit also mixes instrument kinds — prose workflows, deterministic tools, subagents —
and which kind a given capability is is a deliberate choice with consequences (determinism,
testability, where edits land).

## Decision

**Every skill is reached through three doors over a single `SKILL.md` source of truth, and
each capability is one of a fixed set of instrument types.**

- **Three doors, one room.** For a skill-backed command, the same
  `skills/<command>/SKILL.md` is reached via (1) Claude Code auto-discovery on its frontmatter
  `description`, (2) a thin `commands/<command>.md` markdown slash wrapper, and (3) an MCP
  prompt entry that reads the skill at request time and returns its body. Editing the
  `SKILL.md` updates all three without a server rebuild — doors 2 and 3 read it at runtime,
  door 1 on next discovery. (Door 3's plugin-resource path resolution is governed by
  [ADR-0008](0008-mcp-door-resource-resolution.md).)
- **Instrument taxonomy.** Skills (prose workflow, source of truth) · markdown commands (thin
  slash wrappers) · MCP prompts (server-side registration) · MCP tools (deterministic
  TypeScript, used where determinism matters) · agents (constrained-tool subagents).
- **Kanban is tool-only by design.** The `kanban-*` group has **no** `skills/` or `commands/`
  entries; its prompts are inline `body:` wrappers that invoke the `task`/`git`/`help` tools.
  These are pure state-machine operations with no standalone workflow prose worth duplicating
  into a skill — so the three-door machinery would be empty ceremony.

## Consequences

### Positive

- One edit point per command; no triplicated prose, no drift across the three surfaces.
- Users reach commands by whichever affordance fits, all backed by identical content.
- The taxonomy gives a clear rule for *where* a new capability belongs and how it is tested.

### Negative / accepted trade-offs

- Door overlap: a markdown command and the MCP prompt can both surface for one name; accepted
  and verified in the live slash menu ([ADR-0001](0001-single-plugin-consolidation.md)).
- The runtime-read doors (2 and 3) depend on the `SKILL.md` resolving from the right plugin
  root — the failure mode [ADR-0008](0008-mcp-door-resource-resolution.md) exists to prevent.
- The kanban asymmetry (tool-only, no skill) is a deliberate exception a contributor must know
  about; it is documented here and in `CLAUDE.md`.
