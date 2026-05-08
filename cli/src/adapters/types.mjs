// JSDoc-typed contract for target adapters. Adapters render a Marvin pack
// artifact (skill, command, agent) into a target editor's project layout.
// `claudeAdapter` is the reference implementation in cli/src/lib/eject-core.mjs;
// future targets (e.g. Codex, PR-3) implement the same shape.

/**
 * @typedef {"skill" | "command" | "agent"} ArtifactKind
 *
 * @typedef {Object} Artifact
 * @property {ArtifactKind} kind
 * @property {string} name
 * @property {string} sourcePath           Absolute path to the source file or skill folder.
 * @property {Array<{from: string, relPath: string, isMarkdown: boolean, toRel?: string}>} files
 *
 * @typedef {Object} Warning
 * @property {string} reason       Human-readable explanation of why an artifact can't be rendered.
 * @property {string} [suggestion] Optional manual workaround text shown to the user.
 *
 * @typedef {Object} RenderOpts
 * @property {boolean} isMarkdown
 * @property {string}  packName
 * @property {string}  packVersion
 * @property {string}  today          UTC ISO date (YYYY-MM-DD).
 *
 * @typedef {Object} Plan
 * @property {Artifact[]} artifacts
 * @property {string}     packName
 * @property {string}     packVersion
 *
 * @typedef {Object} TargetAdapter
 * @property {string} name
 *   Stable target identifier (e.g. "claude", "codex"). Used as the `--target` flag value.
 *
 * @property {(artifact: Artifact) => Warning|null} unsupported
 *   Returns null if the adapter can render the artifact, or a Warning describing why not.
 *   Adapters should NEVER throw here — return a warning so the orchestrator can skip cleanly.
 *
 * @property {(artifact: Artifact, fileRel: string) => string} pathFor
 *   Destination path relative to the project root, using POSIX forward-slash separators.
 *   For skills, `fileRel` is the file's path within the skill folder (e.g. "SKILL.md",
 *   "scripts/foo.sh"). For commands and agents, `fileRel` may be ignored.
 *
 * @property {(artifact: Artifact, sourceContent: string, opts: RenderOpts) => string} render
 *   Returns the bytes to write at `pathFor(...)`. For non-markdown files, adapters typically
 *   return `sourceContent` unchanged. For markdown, the Claude adapter injects an origin
 *   header; other adapters may strip frontmatter, rewrite headings, etc.
 *
 * @property {() => string} manifestPath
 *   Project-root-relative path of the eject manifest (e.g. ".claude/.marvin-eject.json").
 *
 * @property {() => object} manifestSchema
 *   JSON Schema describing the manifest shape this adapter produces. Used for validation
 *   and as documentation; not read at runtime by the orchestrator.
 *
 * @property {(plan: Plan, projectRoot: string) => Promise<void>} [postWrite]
 *   Optional hook invoked after a successful apply. Use for index-file updates,
 *   config-file rewrites, or printing manual follow-up steps. The Claude adapter is a no-op.
 */

// This file intentionally has no runtime exports — it's pure documentation.
export {};
