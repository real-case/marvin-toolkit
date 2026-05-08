---
name: marvin-eject
description: Copy Marvin pack artifacts (skills, commands, agents) from the installed plugin into the project's local .claude/ directory so they can be committed, customised, and versioned alongside the codebase. Supports per-artifact and whole-pack granularity. Re-running on the same target overwrites existing files — this is also the update mechanism. Tracks origin via header comment and .claude/.marvin-eject.json manifest. Skips MCP servers (printed as a hint instead). Use when the user says "eject", "scaffold marvin into project", "copy plugin skills into .claude/", "/mn.eject", "update ejected skills", or wants to fork a Marvin pack into the project repo.
disable-model-invocation: true
---

Scaffold (or update) Marvin pack artifacts into `<project>/.claude/`. The
real logic lives in `eject.mjs` next to this file — this skill only
parses `$ARGUMENTS`, calls the script, presents the plan, and re-invokes
on confirmation. **Do not reproduce the script's behaviour in prose.**

## Argument parsing

`$ARGUMENTS` shape: `<target> [--only <kinds>]`.

- `<target>` is one of:
  - `<pack>` — whole pack
  - `<pack>/skills/<name>` — single skill (folder)
  - `<pack>/commands/<name>` — single command (file, no `.md` suffix in arg)
  - `<pack>/agents/<name>` — single agent (file, no `.md` suffix in arg)
- `--only <kinds>` — comma-separated subset of `skills`, `commands`, `agents`. Whole-pack target only.

`<pack>` must be one of the three Marvin packs: `marvin-core-pack`,
`marvin-security-pack`, `marvin-taskmaster-pack`. The script enforces
this; do not duplicate the check here.

If `$ARGUMENTS` is empty, ask the user which pack and which artifacts
to eject — do not guess and do not call the script.

## Workflow

### 1. Locate the script

The script lives at `<this-skill-dir>/eject.mjs`. Resolve its absolute
path. In **dev mode** (the marvin-toolkit repo itself) it is at
`./plugins/marvin-core-pack/skills/mn.eject/eject.mjs`. In **installed
mode** (a user project) it is at
`~/.claude/plugins/<...>/marvin-core-pack/skills/mn.eject/eject.mjs`.

If you cannot locate it, abort with a clear error — do not improvise
a fallback.

### 2. Dry-run

Run, **without `--apply`**:

```bash
node <eject.mjs> "<target>" [--only <kinds>]
```

The script prints a JSON plan to stdout. Parse it:

- `creates` — list of files that will be newly written.
- `overwrites` — list of files that will be replaced.
- `mcpHint` — `{ servers: [...] }` if the pack ships MCP servers; `null` otherwise.

If the script exits with a non-zero code, surface its stderr verbatim
and stop.

### 3. Confirm with the user

Present a summary:

- Which pack + version is being ejected.
- Files that will be created vs overwritten (use the `creates` and `overwrites` arrays).
- Note that overwrites are full replacements — local edits will be lost.
- If `mcpHint` is non-null: note that the pack's MCP config will not be touched and list the server names.

Ask: **Proceed**, **Cancel**. Wait for explicit "yes" before continuing.

### 4. Apply

Re-run the same command with `--apply`:

```bash
node <eject.mjs> "<target>" [--only <kinds>] --apply
```

Surface the script's stdout (a JSON apply report) and stderr to the user.

If the script exits non-zero (mid-run failure), report which files
landed and which failed using the `written` and `failures` arrays from
its stdout. The script has already written a partial manifest reflecting
what succeeded; do not attempt to clean up or roll back.

### 5. Final report

Print a concise human-friendly summary built from the JSON report:

```
Ejected <pack>@<version> into .claude/

Created (N):
  - .claude/skills/mn.commit/SKILL.md
  ...

Overwritten (M):
  - ...

Manifest: .claude/.marvin-eject.json (N entries total)
```

If `mcpHint` is non-null:

```
Note: <pack> ships MCP servers (<server1>, <server2>) which were NOT ejected.
If you want them, copy the relevant entries from <pack-root>/.mcp.json
into your project's .mcp.json manually.
```

Tell the user they can re-run the same command later to update files
when the pack is upgraded.

## Rules

- **The script is the source of truth.** Do not re-implement header
  injection, manifest upsert, frontmatter detection, or overwrite
  decisions in prose. If behaviour seems wrong, fix `eject.mjs` and its
  tests — not this skill.
- **Marvin packs only.** The script enforces the allowlist; if it
  rejects a pack, surface that message verbatim.
- **No MCP merging.** Project `.mcp.json` is sacred. The script never
  touches it; neither do you.
- **No rollbacks.** Mid-run failures leave behind whatever was already
  written. Surface the script's failure list and stop.

## Examples

```
$ /mn.eject marvin-core-pack/skills/mn.commit

# Step 2 (dry-run output):
{
  "mode": "dry-run",
  "pack": "marvin-core-pack",
  "version": "0.1.0-alpha.2",
  "creates": [".claude/skills/mn.commit/SKILL.md"],
  "overwrites": [],
  "mcpHint": { "servers": ["context7", "gitmcp"] }
}

# Step 3 (you, to user):
About to eject marvin-core-pack@0.1.0-alpha.2 into .claude/

Will create (1):
  .claude/skills/mn.commit/SKILL.md

marvin-core-pack ships MCP servers (context7, gitmcp) — these will NOT be ejected.

Proceed? [y/N]
```

```
$ /mn.eject marvin-core-pack --only skills,commands

# Same shape — script returns a longer creates/overwrites list, which you summarise.
```
