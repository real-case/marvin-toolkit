# Target adapter contract

A **target adapter** renders a Marvin pack artifact (skill, command, or agent) into a specific editor's project layout. The orchestrator in [`eject-core.mjs`](../plugins/marvin-core-pack/skills/mn.eject/eject-core.mjs) is target-agnostic: it asks the adapter where files go, what their content should look like, and where to write the manifest.

The reference implementation is `claudeAdapter` (in `eject-core.mjs`). The interface is documented as JSDoc in [`cli/src/adapters/types.mjs`](../cli/src/adapters/types.mjs). New targets implement the same shape and register themselves in [`cli/src/adapters/index.mjs`](../cli/src/adapters/index.mjs).

## Method-by-method

### `name: string`
Stable target identifier surfaced as the `--target` flag value. Lowercase, no spaces. Examples: `"claude"`, `"codex"`, `"cursor"`.

### `unsupported(artifact) → null | Warning`
Called once per artifact during planning. Return `null` if the adapter can render it. Return `{ reason, suggestion? }` to skip it and surface a user-facing warning. **Never throw** — the orchestrator will not catch.

The Claude adapter returns `null` for everything because Claude Code is the source format. The Codex adapter (PR-3) returns warnings for `agent` artifacts because Codex CLI has no first-class subagent concept.

### `pathFor(artifact, fileRel) → string`
Returns the destination path **relative to the project root**, using **POSIX forward-slashes**. For skills, `fileRel` is the file's path within the skill folder (e.g. `"SKILL.md"`, `"scripts/dispatch.sh"`). For commands and agents the artifact owns a single file and `fileRel` may be ignored.

```js
// Claude:
pathFor({kind: "skill", name: "mn.commit"}, "SKILL.md")
  // → ".claude/skills/mn.commit/SKILL.md"
pathFor({kind: "command", name: "mn.pr"}, _)
  // → ".claude/commands/mn.pr.md"
```

### `render(artifact, sourceContent, opts) → string`
Returns the bytes to write at `pathFor(...)`. `opts` carries `{ isMarkdown, packName, packVersion, today }`. Adapters must:

- Pass non-markdown files through unchanged (or strip if explicitly desired).
- Inject/replace exactly **one** origin marker per markdown file. Re-running must produce byte-identical output (idempotency, not stacking).

The Claude adapter delegates to `injectHeader()`, which preserves frontmatter and inserts a `<!-- marvin-eject: source=… -->` HTML comment.

### `manifestPath() → string`
Project-root-relative path of the eject inventory (e.g. `".claude/.marvin-eject.json"`). Each target writes its own manifest at its own path so multi-target projects don't collide.

### `manifestSchema() → object`
Returns a JSON Schema describing the manifest shape this adapter produces. Used as documentation; not enforced at runtime.

### `postWrite?(plan, projectRoot) → Promise<void>`
Optional hook invoked after a successful apply. Use for index-file updates, config-file rewrites, or printing manual follow-up steps. The Claude adapter is a no-op; future adapters may rewrite TOML configs or update editor settings.

## Adding a new adapter — worked example

Below: ~80 lines for a hypothetical "Cursor" target that drops skills as Markdown prompts under `.cursor/prompts/`, treats agents as unsupported, and writes its own manifest under `.cursor/.marvin-eject.json`.

```js
// cli/src/adapters/cursor.mjs
import { injectHeader } from "../lib/eject-core.mjs";

const cursorAdapter = {
  name: "cursor",

  unsupported(artifact) {
    if (artifact.kind === "agent") {
      return {
        reason: "Cursor has no first-class subagent concept",
        suggestion: "Inline the agent's instructions into a relevant skill's prompt manually.",
      };
    }
    return null;
  },

  pathFor(artifact, fileRel) {
    switch (artifact.kind) {
      case "skill": {
        // Flatten skill folder: only SKILL.md ships, as a flat prompt file.
        if (fileRel !== "SKILL.md") return null;  // skip non-SKILL files
        return `.cursor/prompts/${artifact.name}.md`;
      }
      case "command": return `.cursor/prompts/${artifact.name}.md`;
      default: throw new Error(`cursorAdapter: unknown kind "${artifact.kind}"`);
    }
  },

  render(artifact, sourceContent, opts) {
    if (!opts.isMarkdown) return sourceContent;
    // Strip frontmatter (Cursor doesn't read it) but keep the origin comment.
    const stripped = stripFrontmatter(sourceContent);
    return injectHeader(stripped, opts.packName, opts.packVersion, opts.today);
  },

  manifestPath() { return ".cursor/.marvin-eject.json"; },

  manifestSchema() {
    return {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      required: ["version", "ejected"],
      properties: {
        version: { const: 1 },
        ejected: { type: "array" },
      },
    };
  },

  async postWrite(plan, projectRoot) {
    // Print a one-liner pointing the user at the cursor docs.
    process.stdout.write(
      `note: Cursor reads prompts from .cursor/prompts/. ` +
      `Reload the editor or run "Cursor: Reload Prompts" to pick up changes.\n`
    );
  },
};

function stripFrontmatter(content) {
  if (!content.startsWith("---\n")) return content;
  const close = content.indexOf("\n---\n", 4);
  if (close === -1) return content;
  return content.slice(close + 5).replace(/^\n+/, "");
}

export default cursorAdapter;
```

Then in `cli/src/adapters/index.mjs`:

```js
import cursorAdapter from "./cursor.mjs";
REGISTRY.set("cursor", cursorAdapter);
```

Ship a fixture (`cli/test/fixtures/cursor/`) and a small test that runs `marvin init <pack> --target=cursor` and diffs against the fixture. Done.

## What adapters must NOT do

- **Mutate shared state.** No global side effects, no writes outside `projectRoot`. The orchestrator owns the filesystem boundary.
- **Read the manifest.** That's `readManifest()` in eject-core. Adapters only declare *where* the manifest lives via `manifestPath()`.
- **Throw from `unsupported`.** Always return a Warning so the orchestrator can skip cleanly and report.
- **Cache state across calls.** The same adapter instance is reused across many invocations within a single CLI run. Pure functions only.

## Boundary enforcement

Two CI checks guard the adapter boundary:

1. `grep '\.claude/\|\.codex/\|\.cursor/' cli/src/commands/*.mjs` must return no hits — command files are adapter-agnostic.
2. `grep 'from ".*adapters/(claude|codex|cursor)\.mjs"' cli/src/commands/*.mjs` must return no hits — direct imports of an adapter implementation are forbidden; commands consult `getAdapter(name)` from the registry instead.

Both run in `.github/workflows/validate-plugins.yml`.
