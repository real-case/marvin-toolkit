---
name: changelog
description: Generate a changelog from git commit history between tags, date ranges, or arbitrary refs. Use this skill whenever the user mentions "changelog", "release notes", "what changed", "what's new", "diff between versions", "release summary", or asks to summarize git history for a release. Also triggers for requests like "prepare release notes", "generate CHANGELOG.md", or "summarize commits since last tag".
---

# Changelog Generator

Generate a structured, user-facing changelog from git commit history.

## Step 1: Determine the commit range

Run these commands to understand the repo state:

```bash
# Available tags (most recent first)
git tag --sort=-version:refname | head -20

# Current branch
git rev-parse --abbrev-ref HEAD

# Total commit count on current branch
git rev-list --count HEAD
```

Then determine the range based on user input:

| User says | Range to use |
|---|---|
| Specific tags: "v1.0 to v1.1" | `v1.0..v1.1` |
| "Since last release" | `$(git describe --tags --abbrev=0)..HEAD` |
| Date range: "last 2 weeks" | `--since="2 weeks ago"` |
| "All unreleased changes" | `<latest-tag>..HEAD` |
| No tags exist at all | Ask user for a date range, or use `--since="1 month ago"` as default |

If the range contains **more than 200 commits**, warn the user and suggest narrowing the range or generating a high-level summary instead of per-commit entries.

## Step 2: Collect and analyze commits

```bash
# Detailed log with hash, subject, body, and author
git log <range> --no-merges --format="---commit---%n%H%n%s%n%b%n---%an" 

# If the project uses PR-based workflow, also check merge commits for PR context
git log <range> --merges --format="%s" | head -20
```

Extract PR/issue numbers from commit subjects — common patterns: `(#123)`, `[#123]`, `fixes #123`, `closes #123`, `PROJ-456`.

If the project has **scoped conventional commits** (e.g. `feat(api):`, `fix(ui):`), note the scopes — they may map to sub-sections or packages in a monorepo.

## Step 3: Categorize

Map commits to changelog categories. Use conventional commit prefixes when present; otherwise infer from the commit message content.

| Category | Conventional prefix | Content signals |
|---|---|---|
| Added | `feat:` | "add", "introduce", "new", "implement", "support" |
| Changed | `refactor:`, `perf:`, `improve:` | "update", "modify", "change", "replace", "migrate", "rename" |
| Fixed | `fix:`, `bugfix:` | "fix", "resolve", "correct", "patch", "handle" |
| Security | `security:` | "vulnerability", "CVE", "auth", "XSS", "injection", "sanitize" |
| Deprecated | `deprecate:` | "deprecate", "sunset", "end of life" |
| Removed | — | "remove", "delete", "drop support" |
| Infrastructure | `ci:`, `build:`, `chore:`, `deps:` | "CI", "Docker", "pipeline", "bump", "upgrade dependency" |

**Grouping rules:**
- Merge multiple commits that address the same feature or fix into ONE changelog entry. For example, "feat: add user search" + "fix: search input focus" + "refactor: extract search hook" = one "Added" entry about user search.
- Skip commits that are purely internal with no user-facing impact: formatting, linting, typo fixes in code comments, merge conflict resolutions.
- `docs:` commits — include only if they represent user-facing documentation changes (README, API docs). Skip internal dev docs updates.

## Step 4: Write changelog entries

Each entry should describe **what changed for the user**, not what the developer did internally.

**Transformation examples:**

```
Commit: "refactor: extract useAuth hook from LoginPage component"
Bad:    "Extracted useAuth hook from LoginPage"
Good:   "Improved authentication flow reliability"

Commit: "feat(api): add GET /users/:id/preferences endpoint"  
Bad:    "Added GET /users/:id/preferences endpoint"
Good:   "Users can now view and manage their preferences"

Commit: "fix: prevent race condition in WebSocket reconnection logic"
Bad:    "Fixed race condition in WebSocket reconnection"
Good:   "Fixed intermittent disconnection issues in real-time updates"

Commit: "perf: add Redis caching layer for dashboard queries"
Bad:    "Added Redis caching for dashboard"
Good:   "Dashboard loading times significantly improved"
```

For developer-facing projects (libraries, CLIs, APIs), keep entries more technical — the "user" IS a developer:

```
Commit: "feat: add retry option to fetch wrapper"
Good:   "Added `retry` option to `createFetch()` with configurable backoff (#142)"
```

## Step 5: Assemble and output

### Default format: Keep a Changelog (Markdown)

```markdown
## [1.2.0] - 2026-04-11

### Added
- Users can now export reports as PDF with custom headers (#187)
- Added dark mode support across all dashboard views (#192)

### Changed
- Redesigned the settings page for better navigation (#183)

### Fixed
- Fixed file upload failing silently for files over 10MB (#178)
- Resolved incorrect timezone display in event scheduler (#181)

### Infrastructure
- Upgraded to Node.js 22 LTS (#190)
```

### Alternative formats (if the user requests)

**GitHub Release** — same content but without the `## [version]` header (GitHub adds it). Include a one-line summary at the top.

**Slack summary** — concise, emoji-prefixed, no markdown headers:
```
🚀 *v1.2.0 Released*
✨ PDF export with custom headers
✨ Dark mode for dashboards  
🔧 Settings page redesign
🐛 Fixed large file upload failures
🐛 Fixed timezone display in scheduler
```

## Guidelines

- Always ask for confirmation before writing to CHANGELOG.md or creating a new file.
- If CHANGELOG.md exists, prepend the new entry after the top-level heading. Preserve all existing content.
- If the project uses a different changelog filename (HISTORY.md, CHANGES.md, NEWS.md), respect it.
- For monorepos with scoped commits, ask the user if they want one unified changelog or per-package changelogs.
- When version number is unknown, use `[Unreleased]` as placeholder and note it.
- Include a `[version]: compare-url` link at the bottom if the repo is on GitHub/GitLab:
  ```
  [1.2.0]: https://github.com/user/repo/compare/v1.1.0...v1.2.0
  ```