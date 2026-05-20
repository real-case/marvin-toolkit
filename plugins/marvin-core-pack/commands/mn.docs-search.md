---
description: Search and synthesize project documentation. Ask a question about the codebase, architecture, or conventions.
---

# Docs Search

Find and synthesize answers from project documentation.

## Arguments

- `$ARGUMENTS` — Optional: question or topic to search for (e.g. "how does auth work" or "deployment process")

## Instructions

**Read `skills/mn.docs-search/SKILL.md`** and follow its full workflow (Phases 1–3).

Pass `$ARGUMENTS` as the search query if provided.

## Examples

| Command                                    | Behavior                                        |
| ------------------------------------------ | ----------------------------------------------- |
| `/mn.docs-search`                           | Ask what to search for                          |
| `/mn.docs-search how does auth work`        | Search docs and code for auth documentation     |
| `/mn.docs-search deployment process`        | Find and synthesize deployment documentation    |
