---
name: marvin-eject
description: Copy Marvin pack artifacts (skills, commands, agents) from the installed plugin into the project's local .claude/ directory so they can be committed, customised, and versioned alongside the codebase. Supports per-artifact and whole-pack granularity. Re-running on the same target overwrites existing files — this is also the update mechanism. Tracks origin via header comment and .claude/.marvin-eject.json manifest. Skips MCP servers (printed as a hint instead). Use when the user says "eject", "scaffold marvin into project", "copy plugin skills into .claude/", "/mn.eject", "update ejected skills", or wants to fork a Marvin pack into the project repo.
disable-model-invocation: true
---

Scaffold (or update) Marvin pack artifacts into `<project>/.claude/`. Follow the full workflow below.

## Argument parsing

`$ARGUMENTS` shape: `<target> [--only <kinds>]`.

- `<target>` is one of:
  - `<pack>` — whole pack
  - `<pack>/skills/<name>` — single skill (folder)
  - `<pack>/commands/<name>` — single command (file, no `.md` suffix in arg)
  - `<pack>/agents/<name>` — single agent (file, no `.md` suffix in arg)
- `--only <kinds>` — only valid with whole-pack target. Comma-separated subset of `skills`, `commands`, `agents`.

`<pack>` must be one of the three Marvin packs: `marvin-core-pack`, `marvin-security-pack`, `marvin-taskmaster-pack`. Reject anything else with a clear error.

If `$ARGUMENTS` is empty: ask the user which pack and which artifacts to eject — do not guess.

## Workflow

### 1. Resolve the pack source

The pack source root must be located in one of two modes:

**Dev mode** — if CWD looks like the marvin-toolkit repo itself (has `.claude-plugin/marketplace.json` whose `name` field is `"marvin-toolkit"`), use `./plugins/<pack>`.

**Installed mode** — otherwise, locate the installed pack:

```bash
find ~/.claude/plugins -type d -name '<pack>' -path '*marvin-toolkit*' 2>/dev/null | head -1
```

If neither resolves, abort with a helpful error: "Pack `<pack>` not found. Install it first: `/plugin install <pack>@marvin-toolkit`".

Read `<pack-root>/.claude-plugin/plugin.json` to get the pack's `version` — it will be embedded in the header comment and manifest.

### 2. Build the artifact list

Based on `<target>` and `--only`, enumerate source paths and target paths:

| Target spec                          | Source                                  | Destination                              |
| ------------------------------------ | --------------------------------------- | ---------------------------------------- |
| `<pack>` (whole)                     | `<pack-root>/{commands,skills,agents}/` | `.claude/{commands,skills,agents}/`      |
| `<pack>/skills/<name>`               | `<pack-root>/skills/<name>/` (folder)   | `.claude/skills/<name>/`                 |
| `<pack>/commands/<name>`             | `<pack-root>/commands/<name>.md`        | `.claude/commands/<name>.md`             |
| `<pack>/agents/<name>`               | `<pack-root>/agents/<name>.md`          | `.claude/agents/<name>.md`               |

Skill folders may contain nested files (not only `SKILL.md`) — copy the entire folder recursively.

If a source path doesn't exist, abort with `<pack>/<artifact>` not found.

`.mcp.json` is **never** copied. If the pack has a non-empty `.mcp.json`, remember its contents to print as a hint in the final report (Step 7).

### 3. Confirm with the user

Present a summary:
- Which pack + version is being ejected.
- List of files to be created vs. overwritten (check existence in `.claude/` before confirming).
- Note that overwrites are full replacements — any local edits to those files will be lost.
- If applicable: note that pack's `.mcp.json` will not be touched.

Ask: **Proceed**, **Cancel**. Do not start writing until explicit "yes".

### 4. Copy files with header injection

For every `.md` file, inject a header comment recording the source. Behaviour depends on whether the file has YAML frontmatter:

**With frontmatter** — insert header on a blank line directly after the closing `---`:

```markdown
---
name: ...
description: ...
---

<!-- marvin-eject: source=<pack>@<version> ejected-at=<YYYY-MM-DD> -->

...rest of file...
```

**Without frontmatter** — insert header at the very top of the file, followed by a blank line.

If a header for the same `<pack>` already exists in the destination file (e.g. previous eject), replace that header line in-place rather than stacking duplicates. Match by the literal prefix `<!-- marvin-eject: source=<pack>@`.

Use today's date for `ejected-at` in `YYYY-MM-DD` format.

For non-`.md` files inside skill folders (e.g. shell scripts, JSON, templates): copy as-is, no header. The manifest still records them.

### 5. Update the manifest

Read `.claude/.marvin-eject.json` if it exists; otherwise initialise:

```json
{ "version": 1, "ejected": [] }
```

For each ejected artifact, upsert an entry keyed by `(source, artifact)`:

```json
{
  "source": "<pack>",
  "sourceVersion": "<version-from-plugin.json>",
  "ejectedAt": "<YYYY-MM-DD>",
  "artifact": "skills/<name>" | "commands/<name>" | "agents/<name>",
  "files": [".claude/skills/<name>/SKILL.md", "..."]
}
```

If the same `(source, artifact)` is already present, replace it (update version, date, file list). Never append a duplicate.

Write the file with two-space indentation and a trailing newline.

### 6. (Skipped) MCP servers

Do not modify `.mcp.json` in either pack or project. Just remember the pack's MCP config for the report.

### 7. Report

Print a concise summary:

```
Ejected <pack>@<version> into .claude/

Created (N):
  - .claude/skills/mn.commit/SKILL.md
  - .claude/commands/mn.commit.md
  ...

Overwritten (M):
  - ...

Manifest: .claude/.marvin-eject.json (N entries total)
```

If the pack has MCP servers, append:

```
Note: <pack> ships MCP servers (<name1>, <name2>) which were NOT ejected.
If you want them, copy the relevant entries from <pack-root>/.mcp.json
into your project's .mcp.json manually.
```

Tell the user they can re-run the same command later to update files when the pack is upgraded.

## Rules

- **Pure overwrite.** Never attempt 3-way merge or skip-on-modified. The header + manifest exist so users can `git diff` and `git revert` themselves if they had local edits.
- **Marvin packs only.** Reject `<pack>` values not in the three known names. Eject is intentionally not a generic plugin-copy tool.
- **Atomicity is best-effort.** If a copy fails mid-run, report which files were already written; do NOT roll back. Manifest still gets written for what succeeded.
- **No MCP merging.** Project `.mcp.json` is sacred — only the user edits it.
- **Header line is single-source-of-truth for origin.** Format: `<!-- marvin-eject: source=<pack>@<version> ejected-at=<YYYY-MM-DD> -->`. Tooling (future `--status` flag) will rely on this exact prefix.
- **Manifest is single-source-of-truth for inventory.** Don't ship a `--status` command that scans the filesystem; future versions will read the manifest.

## Examples

```
$ /mn.eject marvin-core-pack/skills/mn.commit

About to eject marvin-core-pack@0.1.0-alpha.2 into .claude/
  Skill: skills/mn.commit/

Will create:
  .claude/skills/mn.commit/SKILL.md

Manifest will be created at .claude/.marvin-eject.json
Proceed? [y/N]
```

```
$ /mn.eject marvin-core-pack/skills/mn.commit   # second run, after pack upgraded to alpha.3

About to eject marvin-core-pack@0.1.0-alpha.3 into .claude/
  Skill: skills/mn.commit/

Will overwrite (1):
  .claude/skills/mn.commit/SKILL.md  (currently @0.1.0-alpha.2)

Any local edits to that file will be lost.
Proceed? [y/N]
```

```
$ /mn.eject marvin-core-pack --only skills

About to eject marvin-core-pack@0.1.0-alpha.2 into .claude/
  10 skills (commands and agents skipped due to --only)

Will create (10):
  .claude/skills/mn.adr/SKILL.md
  .claude/skills/mn.changelog/SKILL.md
  ...

Note: marvin-core-pack ships MCP servers (context7, gitmcp) which were NOT ejected.
Proceed? [y/N]
```
