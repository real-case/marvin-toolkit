# ADR 0010 — MCP-door plugin-resource resolution

| Field         | Value                                                                                                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                                                                                                                                                                                                                          |
| Date          | 2026-06-14                                                                                                                                                                                                                                                       |
| Supersedes    | —                                                                                                                                                                                                                                                               |
| Superseded by | —                                                                                                                                                                                                                                                               |
| Related       | `docs/adr/0003-single-plugin-consolidation.md` (three doors), `packages/marvin-mcp-shared/src/server.ts`, `packages/marvin-mcp-shared/src/prompts.ts`, `plugins/marvin/skills/sec-scan/`, `plugins/marvin/skills/task-start/`, `plugins/marvin/skills/sec-compliance/` |

## Context

A marvin skill is reachable through **three doors** (ADR-0003): Claude Code auto-discovery, the
markdown command wrapper, and the MCP prompt (`/marvin:<cmd>`). All three lead to the same
`SKILL.md` prose.

Some skills tell the model to read a **plugin resource** by a plugin-relative path — e.g.
`task-start` read its spec templates from `skills/task-start/*-spec-template.md`, and
`sec-compliance` reads its control list from `skills/sec-compliance/asvs-4.0-checklist.md`.

Through doors 1 and 2 the skill is loaded *from the plugin*, so a bare `skills/...` path resolves
against the plugin root. Through door 3 it does not: the server (`resolvePromptBody`) returns the
`SKILL.md` body **verbatim**, and the model's working directory is the *user's* project — an
installed plugin lives outside that project, so the path cannot resolve. The failure is **silent**:
the model improvises the resource (a spec template, a compliance checklist) from memory, producing
drift instead of an error.

This bug class surfaced three times: `sec-scan` (delegating to sibling scanners), `task-start`
(its own templates), and `sec-compliance` (its ASVS checklist).

## Decision

**Two complementary rules.**

1. **The MCP door resolves `skills/...` paths.** When the server returns a prompt body that
   references a `skills/...` path, it prepends a one-line provenance note giving the absolute plugin
   root (`withPluginResourceContext` in `marvin-mcp-shared`). The model then reads the resource from
   `<pluginRoot>/skills/...`. This is a **door-3-only** safety net — doors 1/2 already resolve such
   paths natively, and their prose is untouched, so there is no regression. It is **general**: every
   current and future `skills/...` reference is covered by one change.

2. **Prefer the pattern that fits the resource** (the path reference is the floor, not the goal):
   - **Sibling skill** → invoke it by command (`/marvin:<skill>`), name-resolved through every door;
     keep `(see skills/<skill>/SKILL.md)` only as a pointer. (`sec-scan`, alpha.14.)
   - **A skill's own small scaffolding** (a fill-in template) → inline it into `SKILL.md`; the skill
     stays self-contained and the floor never matters. (`task-start` templates, alpha.15.)
   - **Bulky shared reference data** (read by the skill *and* its command wrapper) → reference it by
     `skills/...` path and rely on rule 1. (`sec-compliance` ASVS checklist, alpha.16.)

## Consequences

- A bare `skills/...` resource read no longer fails silently through the MCP door.
- The fix is centralized in the shared server; packs need no per-skill change for new references.
- The preamble adds a short note to MCP prompt bodies that reference `skills/...` — and only those
  (gated on the body actually containing such a path).
- `serverInfo.version` (the hardcoded `VERSION` in the server entry) was found lagging and resynced
  to the plugin version as part of this change.

## Alternatives considered

- **Rewrite `skills/...` → absolute paths in the body.** Rejected — a regex over prose over-matches
  (code samples, the literal word "skills/").
- **A `${CLAUDE_PLUGIN_ROOT}` placeholder in the prose.** Rejected — changing the prose risks
  regressing doors 1/2 (whose native resolution of bare paths is the current working behavior) and
  depends on whether Claude Code interpolates the variable in each door.
- **Inline every resource.** Rejected for bulky shared reference data (e.g. the 222-line ASVS
  checklist, also read by the command wrapper) — it would bloat the verbatim-returned body on every
  invocation.
