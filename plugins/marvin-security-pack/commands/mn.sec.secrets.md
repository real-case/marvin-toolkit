---
description: Deep scan for leaked secrets, credentials, and API keys across code, config, and git history.
---

# Secret Scan

Scan the codebase for hardcoded secrets, leaked credentials, and insecure secret management patterns.

## Arguments

- `$ARGUMENTS` — Optional: specific files, directories, or focus areas to scan (e.g. "src/config" or "git history only")

## Instructions

**Read `skills/mn.sec.secrets/SKILL.md`** and follow its full workflow (Phases 1–4).

Pass `$ARGUMENTS` to scope the scan if provided.

## Examples

| Command                          | Behavior                                              |
| -------------------------------- | ----------------------------------------------------- |
| `/mn.sec.secrets`                | Full secret scan: code, git history, and config audit |
| `/mn.sec.secrets src/config`     | Scan only the config directory                        |
| `/mn.sec.secrets git history`    | Focus on secrets leaked in git history                |
