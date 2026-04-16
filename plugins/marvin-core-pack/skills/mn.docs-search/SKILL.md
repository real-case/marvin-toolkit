---
description: Search and retrieve relevant documentation from the codebase and external sources. Use whenever the user asks "where is this documented?", "how does X work?", "what's the API for Y?", needs to understand project architecture, conventions, or onboarding context, or asks about ADRs, README, changelog, API specs, or internal docs. Also triggers when the user needs to find configuration docs, migration guides, runbooks, or style guides within a project.
---

# Docs Search

Find and synthesize project documentation so the user gets answers, not a list of files.

## Core principle

**Answer the question, not just find the file.** The user needs an explanation, not a file path. Search broadly, read the relevant sources, and synthesize a clear answer with citations.

## Phase 1 — Discover documentation landscape

Before searching for specific content, understand what documentation exists in the project.

Scan for documentation entry points:
```
# Root-level docs
README.md, CLAUDE.md, CONTRIBUTING.md, CHANGELOG.md, ARCHITECTURE.md

# Documentation directories
docs/, wiki/, doc/, documentation/, guides/, .github/

# Architecture Decision Records
docs/adr/, docs/decisions/, adr/

# API specifications
openapi.yaml, openapi.json, swagger.yaml, swagger.json, api-docs/

# Config and setup documentation
.env.example, docker-compose.yml (comments), Makefile (help targets)
```

Use `Glob` patterns to find what's available:
- `**/*.md` — all markdown files
- `**/docs/**` — everything under docs directories
- `**/*.{yaml,yml,json}` — potential API specs and config

Note what's present and what's missing — this shapes both the search and the response.

## Phase 2 — Search for the answer

Use multiple search strategies in parallel, not sequentially — cast a wide net first, then narrow down.

**By content (Grep):**
- Search for the user's query terms and related synonyms across docs and source code
- Try both the concept name and its common aliases (e.g., "auth" / "authentication" / "login")
- Search in both documentation files and code comments — sometimes the best docs are inline

**By structure (Glob):**
- Look for files named after the concept: `**/auth*.md`, `**/deploy*.md`
- Check for topic-specific directories: `docs/deployment/`, `docs/api/`

**By code (for API / behavior questions):**
- Read relevant docstrings, JSDoc, GoDoc, rustdoc, or type definitions
- Check route definitions, controller files, or handler functions for API behavior
- Read test files — they often document expected behavior more accurately than prose docs

**By history (when docs seem outdated):**
- `git log --oneline -10 -- <doc-file>` — when was the doc last updated?
- `git log --oneline --all -- docs/` — recent documentation activity
- If a doc hasn't been touched in months but the related code changed recently, flag it as potentially stale

## Phase 3 — Synthesize and cite

Compose a clear answer from the sources found. Follow these rules:

1. **Lead with the answer.** Don't start with "I found these files..." — start with the information the user asked for.
2. **Cite with file paths and line numbers.** Every claim should be traceable: `src/auth/README.md:15-28`, not just "according to the docs."
3. **Flag conflicts.** If two sources disagree (e.g., README says one thing, code does another), surface both and note the discrepancy — the code is usually right.
4. **Flag gaps.** If the answer isn't fully documented, say so explicitly:
    - What's documented vs. what's missing
    - Where the missing documentation should live (suggest a specific file and section)
    - Offer to draft the missing docs if appropriate
5. **Flag staleness.** If the doc exists but looks outdated relative to the code, warn the user rather than presenting stale info as authoritative.

## Documentation type reference

Different doc types serve different purposes — search the right ones for the question being asked:

| Question type | Primary sources | Secondary sources |
|---|---|---|
| "How do I set up the project?" | README.md, CONTRIBUTING.md, .env.example | Makefile, docker-compose.yml, CI config |
| "How does X feature work?" | docs/ markdown, ARCHITECTURE.md | Source code comments, test files |
| "Why was X decided?" | ADRs (docs/adr/), PR descriptions | Git blame, commit messages |
| "What's the API contract?" | OpenAPI/Swagger specs, route definitions | Integration tests, API client code |
| "What are the coding conventions?" | CONTRIBUTING.md, .editorconfig, linter configs | CLAUDE.md, style guide files |
| "How do I deploy / operate this?" | Runbooks, ops docs, CI/CD config | Dockerfile, helm charts, infra-as-code |

## Guidelines

- **Breadth before depth.** Scan broadly first (glob + grep), then read the most relevant files in detail. Don't read every markdown file line-by-line upfront.
- **Code is documentation.** When prose docs are absent or stale, type definitions, test assertions, and well-named functions are the source of truth.
- **Don't invent answers.** If the documentation doesn't exist, say "this isn't documented" — don't guess what the behavior might be based on file names or vague comments.
- **Suggest improvements.** If the user's question reveals a gap, offer to help create or update the relevant documentation. Good docs are a side effect of good questions.