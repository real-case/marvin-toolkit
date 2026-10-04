#!/usr/bin/env node
/**
 * worktree-boundary-guard — a writing child edits its own worktree and nothing else.
 *
 * `acceptEdits` lets a child write anywhere by absolute path, so every Edit/Write/
 * MultiEdit/NotebookEdit target is resolved to the physical path it would open and
 * compared with the physical worktree root: a symlinked directory or file pointing at
 * the main checkout is outside, and `/tmp/…` against `/private/tmp/…` is the same place.
 * `..` is judged both as the kernel applies it and as a lexical normaliser would, and a
 * target must be inside under both. Inside the worktree, the paths that steer the next
 * session — marvin's config and run state, Claude settings and hooks, husky, the MCP
 * config, `.git` — are protected, plus any regexes in MARVIN_PIPELINE_PROTECTED.
 */
import { isAbsolute, resolve } from "node:path";
import { isMain, readPayload } from "../../hooks/lib/hook-io.mjs";
import { denyPipeline, pipelineMain } from "./lib/deny.mjs";
import { physicalPath, relativeInside } from "./lib/paths.mjs";

/** JavaScript regexes over the worktree-relative POSIX path, matched case-insensitively. */
export const DEFAULT_PROTECTED = [
  String.raw`^\.marvin/config\.json$`,
  String.raw`^\.marvin/pipeline/`,
  String.raw`^\.claude/settings[^/]*\.json$`,
  String.raw`^\.claude/hooks/`,
  String.raw`^\.husky/`,
  String.raw`^\.mcp\.json$`,
  String.raw`^\.git(/|$)`,
];

/**
 * The protected-path regexes: the defaults plus `extra`, a JSON array of regex sources.
 * Throws on anything else, so a malformed setting denies every edit instead of quietly
 * protecting less. Case-insensitive, because the default macOS volume is.
 *
 * @param {string | undefined} extra The MARVIN_PIPELINE_PROTECTED value.
 * @returns {RegExp[]}
 */
export function protectedPatterns(extra) {
  const sources = [...DEFAULT_PROTECTED];
  if (extra !== undefined) {
    let parsed;
    try {
      parsed = JSON.parse(extra);
    } catch {
      throw new Error("MARVIN_PIPELINE_PROTECTED is not valid JSON");
    }
    if (!Array.isArray(parsed) || parsed.some((p) => typeof p !== "string")) {
      throw new Error("MARVIN_PIPELINE_PROTECTED must be a JSON array of regex strings");
    }
    sources.push(...parsed);
  }
  return sources.map((source) => new RegExp(source, "i"));
}

/**
 * Why a child may not edit `target`, or null.
 *
 * @param {unknown} target The tool's `file_path` or `notebook_path`.
 * @param {string | undefined} root The worktree (`CLAUDE_PROJECT_DIR`).
 * @param {RegExp[]} patterns From `protectedPatterns`.
 * @returns {string | null}
 */
export function boundaryViolation(target, root, patterns) {
  if (typeof target !== "string" || target === "") return "the edit names no file";
  if (typeof root !== "string" || !isAbsolute(root)) {
    return "the run's worktree (CLAUDE_PROJECT_DIR) is unknown";
  }
  const realRoot = physicalPath(resolve(root));
  const asWritten = isAbsolute(target) ? target : `${root}/${target}`;
  for (const candidate of [asWritten, resolve(root, target)]) {
    const rel = relativeInside(physicalPath(candidate), realRoot);
    if (rel === null) return `${target} is outside this run's worktree (${root})`;
    if (rel === "") return `${target} is the worktree itself, not a file in it`;
    const hit = patterns.find((pattern) => pattern.test(rel));
    if (hit) return `${rel} is a protected path (${hit.source})`;
  }
  return null;
}

if (isMain(import.meta.url)) {
  pipelineMain("worktree-boundary-guard", () => {
    const input = readPayload()?.tool_input ?? {};
    const targets = [input.file_path, input.notebook_path].filter((t) => t !== undefined);
    const root = process.env.CLAUDE_PROJECT_DIR;
    const patterns = protectedPatterns(process.env.MARVIN_PIPELINE_PROTECTED);
    const why =
      targets.length === 0
        ? "the edit names no file"
        : targets.map((t) => boundaryViolation(t, root, patterns)).find((w) => w !== null);
    return why
      ? denyPipeline("worktree-boundary-guard", [
          `${why}.`,
          "Edit files only inside the worktree — never the main checkout or a protected path.",
        ])
      : 0;
  });
}
