# marvinx

Tool-agnostic installer for [Marvin Toolkit](https://github.com/real-case/marvin-toolkit) plugin packs.

`marvinx` materialises a pack's skills, commands, and agents into your
project's `.claude/` directory so they can be committed, customised, and
versioned alongside your code. It reuses the same deterministic backend
as Claude Code's `/mn.eject` slash command — same files, same headers,
same manifest.

```
                       plugins/<pack>/
                ┌─────────┴─────────┐
                ▼                   ▼
        Marketplace channel    CLI channel (marvinx)
        (/plugin install)      (npx marvinx init)
                │                   │
                ▼                   ▼
          ~/.claude/            <project>/.claude/
          plugins/              (committed)
```

## Install

No install needed. Use via `npx`:

```shell
npx marvinx init marvin-core-pack
```

Or globally:

```shell
npm install -g marvinx
marvinx init marvin-core-pack
```

Requires **Node.js 20+** and `tar` in PATH (default on macOS, Linux, and GitHub Actions runners).

## Commands

```
marvinx init <target> [--only kinds] [--source <path>] [--target claude]
                      [--dry-run] [--offline]
marvinx update [--pack <name>] [--source <path>] [--offline]
marvinx status [--source <path>] [--offline] [--json]
marvinx list [--source <path>] [--offline] [--json]
```

### `marvinx init`

Materialise pack artifacts into the project's `.claude/`. Default mode is **apply** (writes files). Pass `--dry-run` to inspect the plan first.

```shell
# Whole pack
marvinx init marvin-core-pack

# Single artifact
marvinx init marvin-core-pack/skills/mn.commit
marvinx init marvin-core-pack/commands/mn.pr
marvinx init marvin-core-pack/agents/onboarding-guide

# Subset by kind (whole-pack only)
marvinx init marvin-security-pack --only skills,agents

# Inspect without writing
marvinx init marvin-core-pack --dry-run
```

### `marvinx update`

Re-eject every entry in `.claude/.marvin-eject.json` against the latest version of the source. Use after upgrading the marvin-toolkit version you depend on.

```shell
marvinx update                    # everything
marvinx update --pack marvin-core-pack  # one pack only
```

### `marvinx status`

Read the manifest and report installed-vs-latest per artifact.

```shell
marvinx status         # human table
marvinx status --json  # machine-readable
```

Output looks like:

```
PACK              ARTIFACT          INSTALLED      LATEST         VIA       STATUS
----------------  ----------------  -------------  -------------  --------  --------
marvin-core-pack  skills/mn.commit  0.1.0-alpha.2  0.1.0-alpha.3  tarball   OUTDATED
marvin-core-pack  commands/mn.pr    0.1.0-alpha.3  0.1.0-alpha.3  tarball   ok
```

### `marvinx list`

Enumerate all artifacts in all known marvin packs from the configured source.

```shell
marvinx list
marvinx list --json
```

## Source resolution

`marvinx` finds the marvin-toolkit source in this priority:

1. `--source <path>` — explicit local clone or pack root
2. `MARVIN_SOURCE` env var — same as `--source`
3. **Local clone** — walks up from cwd looking for a `marvin-toolkit` repo
4. **GitHub tarball** — downloads + caches under `~/.cache/marvinx/`
5. **Installed pack** — falls back to `~/.claude/plugins/.../marvin-toolkit/...`

Pass `--offline` to skip step 4. Useful in CI and air-gapped environments.

### Tarball overrides

| Env var         | Default                   | Effect                             |
| --------------- | ------------------------- | ---------------------------------- |
| `MARVIN_REPO`   | `real-case/marvin-toolkit`| GitHub `<owner>/<repo>` to fetch   |
| `MARVIN_REF`    | `main`                    | Branch or tag to fetch             |

Tag-like refs (`v1.2.3`, `1.2.3`) are treated as immutable and cached forever. Branch refs refresh after one hour.

## Targets

| `--target` | Status | Use |
| --- | --- | --- |
| `claude` (default) | Stable | Full pack support — skills, commands, agents, MCP hint. Writes to `.claude/`. |
| `codex` | PoC | `marvin-core-pack` only. Skills become `.codex/prompts/<name>.md`; commands and agents are skipped (with explanation); MCP config printed as TOML for manual paste. See [docs/codex-target.md](../docs/codex-target.md). |

```shell
# Claude (default)
marvinx init marvin-core-pack

# Codex
marvinx init marvin-core-pack --target=codex
```

`marvinx init marvin-taskmaster-pack --target=codex` exits with code 3 — taskmaster relies on Claude subagents.

## Manifest format

`.claude/.marvin-eject.json` is the inventory of every ejected artifact:

```json
{
  "version": 1,
  "ejected": [
    {
      "source": "marvin-core-pack",
      "sourceVersion": "0.1.0-alpha.2",
      "ejectedAt": "2026-05-08",
      "artifact": "skills/mn.commit",
      "files": [".claude/skills/mn.commit/SKILL.md"]
    }
  ]
}
```

Each ejected `.md` file gets a single header comment recording origin:

```html
<!-- marvin-eject: source=marvin-core-pack@0.1.0-alpha.2 ejected-at=2026-05-08 -->
```

`marvinx update` rewrites both the header and the manifest in-place — never stacks duplicates.

## Project layout (for contributors)

```
cli/
├─ bin/marvinx.mjs          # entry point
├─ src/
│  ├─ commands/             # init, update, status, list
│  ├─ sources/              # local, installed, tarball resolvers
│  ├─ source-resolver.mjs   # priority chain
│  ├─ lib/eject-core.mjs    # auto-synced from plugins/.../mn.eject/
│  └─ marvinx.test.mjs      # node:test suite
└─ scripts/sync-core.mjs    # plugin → cli/src/lib sync (run pre-publish)
```

The canonical `eject-core.mjs` lives in [`plugins/marvin-core-pack/skills/mn.eject/`](../plugins/marvin-core-pack/skills/mn.eject/). The CLI's `cli/src/lib/eject-core.mjs` is a generated copy with a `// AUTO-GENERATED` header; CI fails if they drift via [`cli/scripts/sync-core.mjs --check`](./scripts/sync-core.mjs).

## License

[WTFPL](../LICENSE)
