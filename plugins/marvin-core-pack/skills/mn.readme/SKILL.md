---
name: generating-readme
description: Generate or update README.md based on actual codebase analysis. Use when user asks to "create README", "update README", "generate docs", "write project documentation", or when a new project needs onboarding documentation.
---

Generate or update the project's README.md based on actual codebase analysis.

## Analysis

1. Read existing README.md (if any) — preserve custom sections, note what's outdated
2. Detect tech stack from config files (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Dockerfile`, etc.)
3. Read CLAUDE.md, docs/, Makefile, docker-compose, CI configs for setup/build context
4. Identify entry points, key modules, and available commands

## Template

```markdown
# {Project Name}

{One paragraph: what it does and why it exists}

## Quick start

{Minimal steps to run locally — copy-pasteable}

## Prerequisites

{Required tools and versions}

## Installation

{Step-by-step setup}

## Usage

{Key commands, API examples, or usage patterns}

## Project structure

{High-level directory layout — only top-level and key directories}

## Development

{Test, lint, build commands}

## Configuration

{Env vars, config files, key options}
```

Drop sections that don't apply. Add project-specific sections when justified (e.g., Deployment, API Reference).

## Rules

- Every command and path must be verifiable from the codebase — never invent features or commands
- A new team member should be able to onboard from the README alone
- Keep sections concise; link to detailed docs rather than duplicating content
- When updating an existing README, show the diff and ask for confirmation before writing