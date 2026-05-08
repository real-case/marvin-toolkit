# `--target=codex`

The Codex target lets you scaffold Marvin pack content into a project's
`.codex/prompts/` so it can be used from [Codex CLI](https://openai.com/codex/).
This is a deliberately narrow proof-of-concept — Phase 3 of the multi-target
scaffolder plan — that validates the adapter abstraction. Treat fidelity loss
as expected, not a bug.

## Pack matrix

| Pack | Status | Reason |
| --- | --- | --- |
| `marvin-core-pack` | ✅ supported | Skills are language-agnostic prompts. |
| `marvin-security-pack` | ⚠️ unvalidated | Allowed but not exercised in CI. Some skills assume Claude tool affordances. |
| `marvin-taskmaster-pack` | ❌ rejected | Pipeline depends on Claude subagents (writer/critics/executor). `marvinx init` exits with **code 3**. |

## Mappings

| Marvin concept | Codex rendering |
| --- | --- |
| Skill (`SKILL.md`) | `.codex/prompts/<name>.md`. Frontmatter stripped, origin header injected at top. |
| Skill auxiliary files (scripts, JSON, README) | **Dropped.** Codex prompts are flat single files. |
| Command (`<name>.md`) | **Skipped.** Marvin commands are thin pointers to same-named skills; the skill is shipped instead. |
| Agent (`<name>.md`) | **Skipped.** Codex CLI has no first-class subagent concept. The summary suggests inlining the agent's prompt into a skill. |
| `.mcp.json` | **Not auto-merged.** `postWrite` prints a copy-pasteable TOML snippet for `~/.codex/config.toml`. |
| Manifest | `.codex/.marvin-eject.json` (same shape as Claude, different path). |

## Usage

```shell
# Whole pack
npx marvinx init marvin-core-pack --target=codex

# Single skill
npx marvinx init marvin-core-pack/skills/mn.commit --target=codex

# Inspect first
npx marvinx init marvin-core-pack --target=codex --dry-run
```

The end-of-run JSON report includes a `skipped` array enumerating every
artifact the adapter chose not to render, with a `reason` and `suggestion`.

## Exit codes (Codex-specific)

| Code | Meaning |
| --- | --- |
| 0 | Success (or dry-run). |
| 1 | Mid-run write failure. Partial manifest reflects what landed. |
| 2 | Validation failure (unknown pack, malformed args). |
| **3** | **Pack-level refusal.** The adapter's `unsupportedPack` gate fired (e.g. `marvin-taskmaster-pack` against Codex). |

## MCP servers — the manual step

When ejecting `marvin-core-pack`, the script prints a TOML snippet describing
the pack's MCP servers. Codex doesn't auto-merge it; paste into `~/.codex/config.toml`
manually. Example output:

```toml
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]

[mcp_servers.gitmcp]
command = "..."
```

The serializer in [`cli/src/adapters/codex.mjs`](../cli/src/adapters/codex.mjs)
handles strings, numbers, booleans, arrays, and a single `env` sub-table. If
your pack adds more exotic fields, `marvinx init` will throw — open an issue.

## Manual smoke transcript

> **Note:** the transcript below is a placeholder until I run a real Codex
> CLI against the ejected output. The fixture-diff test in
> `cli/src/adapters/codex.test.mjs` already proves the *file output* is
> deterministic; what's left to verify is *prompt behaviour* under Codex.

```
$ npx marvinx init marvin-core-pack --target=codex
{
  "mode": "apply",
  "target": "codex",
  "pack": "marvin-core-pack",
  "version": "0.1.0-alpha.3",
  "written": [
    { "artifact": "skills/mn.adr",         "files": [".codex/prompts/mn.adr.md"] },
    { "artifact": "skills/mn.commit",      "files": [".codex/prompts/mn.commit.md"] },
    …11 skills total
  ],
  "skipped": [
    { "artifact": "commands/mn.commit", "reason": "Marvin commands are thin pointers …" },
    { "artifact": "agents/onboarding-guide", "reason": "Codex CLI has no first-class subagent concept" },
    …
  ]
}
note: 13 artifact(s) skipped:
  - command/mn.adr — Marvin commands are thin pointers to same-named skills
  …
note: pack ships MCP servers. Codex doesn't auto-merge them — paste the
following snippet into ~/.codex/config.toml:

[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
…
```

Once a Codex CLI session validates that `mn.commit` (for example) produces
equivalent behaviour to its Claude counterpart, fill in this section with
the actual transcript.

## Regenerating the fixture

`cli/test/fixtures/codex/marvin-core-pack/` is a snapshot used by the
fixture-diff test. After bumping `marvin-core-pack`'s version OR making
intentional changes to the Codex adapter's render output, regenerate:

```shell
node cli/scripts/gen-codex-fixture.mjs
git add cli/test/fixtures/codex/
```

CI's drift check fails if the fixture is stale.

## What this PoC validates (and doesn't)

✅ The adapter abstraction is workable: ~150 lines for a useful Codex render.
✅ The `unsupported` / `unsupportedPack` / null-`pathFor` mechanics correctly
   filter out the chunks of marvin-toolkit that don't map cleanly.
✅ `postWrite` is a clean place for "manual follow-up step" output.

❌ It does NOT validate that the resulting prompts behave equivalently in
   Codex CLI — that's a manual evaluation, captured (eventually) in the
   transcript above.
❌ It does NOT cover skill auxiliary files (scripts, JSON), which Codex
   simply doesn't model. Packs that depend on those files (e.g. anything
   using `dispatch.sh`) will need a different target or manual integration.
