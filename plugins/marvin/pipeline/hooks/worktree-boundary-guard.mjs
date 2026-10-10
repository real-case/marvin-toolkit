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
import { readFileSync } from "node:fs";
import { readPayload } from "../../hooks/lib/hook-io.mjs";
import { denyPipeline, isPipelineEntry, pipelineMain } from "./lib/deny.mjs";
import { worktreeViolation } from "./lib/paths.mjs";

/**
 * The default protected paths live in `pipeline/protected.default.json`, one file read by
 * this guard and by the engine's gate stage, so what a child may not write and what the
 * gate flags as changed cannot drift apart. A file that cannot be read, is not a non-empty
 * array of strings, or holds a pattern that does not compile is not an empty list: the
 * defaults are `null`, `protectedPatterns` throws, and the guard denies every edit instead of
 * quietly protecting less (nor does an importer of the constant get a list that protects
 * nothing).
 *
 * @returns {{ sources: string[] | null, error: Error | null }}
 */
function loadDefaults() {
  try {
    const parsed = JSON.parse(
      readFileSync(new URL("../protected.default.json", import.meta.url), "utf8"),
    );
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      parsed.some((p) => typeof p !== "string")
    ) {
      throw new Error("must be a non-empty JSON array of regex strings");
    }
    for (const source of parsed) new RegExp(source, "i");
    return { sources: parsed, error: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { sources: null, error: new Error(`protected.default.json is unusable (${reason})`) };
  }
}

const defaults = loadDefaults();

/**
 * JavaScript regexes over the worktree-relative POSIX path, matched case-insensitively;
 * `null` when the shared list is unusable.
 *
 * @type {string[] | null}
 */
export const DEFAULT_PROTECTED = defaults.sources;

/**
 * The protected-path regexes: the defaults plus `extra`, a JSON array of regex sources.
 * Throws on anything else, so a malformed setting denies every edit instead of quietly
 * protecting less. Case-insensitive, because the default macOS volume is.
 *
 * @param {string | undefined} extra The MARVIN_PIPELINE_PROTECTED value.
 * @returns {RegExp[]}
 */
export function protectedPatterns(extra) {
  if (DEFAULT_PROTECTED === null) throw defaults.error;
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
  return worktreeViolation(target, root, (rel) => {
    const hit = patterns.find((pattern) => pattern.test(rel));
    return hit ? `${rel} is a protected path (${hit.source})` : null;
  });
}

if (isPipelineEntry(import.meta.url)) {
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
