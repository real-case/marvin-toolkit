# `mn.eject` — internal layout

Maintainer-facing notes. End users invoke `/mn.eject` and shouldn't need this.

## Files

| File              | Role                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| `SKILL.md`        | Thin wrapper: parses `$ARGUMENTS`, runs the script, confirms, applies. |
| `eject.mjs`       | Deterministic backend. Single ESM file, no deps. Node 20+.            |
| `eject.test.mjs`  | `node:test` suite. Covers all Phase-0 acceptance criteria.            |

## Running the script directly

```
node eject.mjs <target> [--only kinds] [--apply] [--source path]
```

| Argument          | Effect                                                                              |
| ----------------- | ----------------------------------------------------------------------------------- |
| `<target>`        | `<pack>` or `<pack>/<skills\|commands\|agents>/<name>`                              |
| `--only kinds`    | Comma-separated subset of `skills,commands,agents`. Whole-pack targets only.        |
| `--apply`         | Execute. Without it, the script emits a JSON dry-run plan to stdout and exits 0.    |
| `--source path`   | Override pack-root resolution. Used by tests and (Phase 1) by the `marvinx` CLI.    |
| `--help`, `-h`    | Print usage.                                                                        |

### Exit codes

| Code | Meaning                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| `0`  | Success. Dry-run plan emitted, or `--apply` completed cleanly.                     |
| `1`  | Runtime failure during `--apply`. Partial manifest written; failed files in stderr. |
| `2`  | Validation failure: unknown pack, malformed args, source not found.                |

### Pack-root resolution order

1. `--source <path>` (explicit override)
2. **Dev mode** — walk up from cwd looking for `.claude-plugin/marketplace.json` with `name=marvin-toolkit`, then `<repo>/plugins/<pack>`
3. **Installed mode** — search `~/.claude/plugins` for a directory named `<pack>` whose path contains `marvin-toolkit`

## Output shape

### Dry-run

```json
{
  "mode": "dry-run",
  "pack": "marvin-core-pack",
  "version": "0.1.0-alpha.2",
  "target": { "artifacts": ["skills/mn.commit"] },
  "creates": [".claude/skills/mn.commit/SKILL.md"],
  "overwrites": [],
  "mcpHint": null
}
```

### Apply

```json
{
  "mode": "apply",
  "pack": "marvin-core-pack",
  "version": "0.1.0-alpha.2",
  "written": [
    { "artifact": "skills/mn.commit", "files": [".claude/skills/mn.commit/SKILL.md"] }
  ],
  "failures": [],
  "mcpHint": { "servers": ["context7", "gitmcp"] }
}
```

`failures` is an array of `{ file, error }` for files that failed to write. `mcpHint` is informational only — the script never touches `.mcp.json`.

## Header & manifest invariants

- **Header line.** Exactly one per ejected `.md` file, of the form:
  ```
  <!-- marvin-eject: source=<pack>@<version> ejected-at=<YYYY-MM-DD> -->
  ```
  Re-running replaces it in-place; never stacks duplicates. Match key is the literal prefix `<!-- marvin-eject: source=<pack>@`.
- **Manifest.** `<project>/.claude/.marvin-eject.json`, schema version `1`. Entries are upserted on `(source, artifact)`; sorted alphabetically; trailing newline; two-space indentation.
- **`.mcp.json` is never touched.** If a pack ships one, the script surfaces an `mcpHint` for the wrapper to print.

## Tests

```bash
node --test plugins/marvin-core-pack/skills/mn.eject/eject.test.mjs
```

CI runs the same step in `.github/workflows/validate-plugins.yml`.

## Two `TODO(user)` decision points

The script has two intentional decision points, marked `TODO(user)` in source:

1. **`replaceExistingHeader(content, packName)`** — strategy choice between regex, line-scan, or AST-based replacement. Default is line-scan.
2. **`executePlan(plan, projectRoot)`** — atomicity strategy on partial failure. Default is sequential try/catch with no fail-fast, so every file gets its own chance and failures are accumulated.

Both have spec-grade docstrings explaining trade-offs. Swap if you have a better approach — tests will tell you fast.
