---
name: migration-planning
description: Plan a migration or large-scale refactor with explicit dependency analysis, phased steps, risk inventory, rollback strategy, and verification checkpoints. Use when the user says "plan the migration", "migration strategy", "refactor plan", "upgrade plan", "rollout plan", "break this change into steps", or before touching cross-cutting code (framework upgrades, database swaps, API versioning, monorepo splits, module renames). Produces a markdown plan the user can review before execution.
disable-model-invocation: true
---

Help plan a migration or major refactoring effort.

## When to use

- Upgrading a framework or language version
- Migrating from one service/library to another
- Large-scale refactoring across the codebase
- Database schema migrations
- API versioning transitions

## Steps

### Phase 1: Impact analysis
1. Understand what's being migrated (ask the user if not clear)
2. Map all affected files and modules:
   - Use Grep to find all usages of the thing being migrated
   - Trace dependencies to understand the blast radius
3. Identify external dependencies (other services, APIs, databases)
4. Check test coverage of affected areas

### Phase 2: Create the plan

```markdown
# Migration Plan: {Title}

## Overview
- **From**: {current state}
- **To**: {target state}
- **Estimated scope**: {N files, M modules}
- **Risk level**: {Low / Medium / High}

## Impact analysis
- Files affected: {list}
- Dependencies affected: {list}
- External systems affected: {list}
- Test coverage: {percentage or assessment}

## Prerequisites
- [ ] {thing that must be done before starting}

## Migration steps
1. **{Step name}** — {description}
   - Files: {affected files}
   - Risk: {Low/Medium/High}
   - Reversible: {Yes/No}

2. **{Step name}** — {description}
   ...

## Breaking changes
- {list of breaking changes and how to handle them}

## Rollback strategy
- {how to revert if something goes wrong}
- {at what point rollback is no longer possible}

## Testing strategy
- [ ] Unit tests pass after each step
- [ ] Integration tests pass after migration
- [ ] Manual verification of {critical paths}

## Timeline estimate
- Step 1: ~{time}
- Step 2: ~{time}
- Total: ~{time}
```

### Phase 3: Review
- Present the plan to the user
- Highlight the highest-risk steps
- Suggest whether to do it incrementally or all-at-once (big bang)

## Guidelines

- Always prefer incremental migration over big-bang when possible
- Each step should be independently deployable and reversible
- Never skip the rollback strategy — it's the most important part
- Flag any step that's irreversible (e.g., destructive database migrations)
- Consider feature flags for gradual rollout
- If the migration is large, suggest breaking it into multiple PRs
