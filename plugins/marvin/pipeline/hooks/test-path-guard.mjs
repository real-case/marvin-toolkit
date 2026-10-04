#!/usr/bin/env node
/**
 * test-path-guard — the test-author writes test files and nothing else.
 *
 * `MARVIN_PIPELINE_TEST_PATTERN` is a JavaScript regular expression over the worktree-relative
 * POSIX path. The target is resolved to the physical path it would open, so a symlink named
 * `x.test.ts` that leads to a source file is judged as the source file, and one that leads out
 * of the worktree is outside. The guard is wired into test-author sessions only: an unset or
 * empty or non-compiling pattern, an unknown worktree and an edit that names no file are
 * misconfigurations, and every one denies. (The protected paths are `worktree-boundary-guard`'s.)
 */
import { isAbsolute, resolve } from "node:path";
import { isMain, readPayload } from "../../hooks/lib/hook-io.mjs";
import { denyPipeline, pipelineMain } from "./lib/deny.mjs";
import { physicalPath, relativeInside } from "./lib/paths.mjs";

/**
 * Why the test-author may not write `target`, or null. `..` is judged both as the kernel
 * applies it and as a lexical normaliser would, and the target must be an allowed test path
 * under both.
 *
 * @param {unknown} target The tool's `file_path` or `notebook_path`.
 * @param {unknown} root The worktree (`CLAUDE_PROJECT_DIR`).
 * @param {RegExp} pattern The test-path pattern, compiled without flags.
 * @returns {string | null}
 */
export function testPathViolation(target, root, pattern) {
  if (typeof target !== "string" || target === "") return "the write names no file";
  if (typeof root !== "string" || !isAbsolute(root)) {
    return "the run's worktree (CLAUDE_PROJECT_DIR) is unknown";
  }
  const realRoot = physicalPath(resolve(root));
  const written = isAbsolute(target) ? target : `${root}/${target}`;
  for (const candidate of new Set([written, resolve(root, target)])) {
    const rel = relativeInside(physicalPath(candidate), realRoot);
    if (rel === null) return `${target} is outside this run's worktree (${root})`;
    if (rel === "") return `${target} is the worktree itself, not a file in it`;
    if (!pattern.test(rel)) return `the test-author writes test files only; ${rel} is not one`;
  }
  return null;
}

if (isMain(import.meta.url)) {
  pipelineMain("test-path-guard", () => {
    const source = process.env.MARVIN_PIPELINE_TEST_PATTERN;
    if (typeof source !== "string" || source === "") {
      return denyPipeline("test-path-guard", [
        "the run's test pattern (MARVIN_PIPELINE_TEST_PATTERN) is unknown.",
      ]);
    }
    let pattern;
    try {
      pattern = new RegExp(source);
    } catch {
      return denyPipeline("test-path-guard", [
        "the run's test pattern (MARVIN_PIPELINE_TEST_PATTERN) is not a valid regular expression.",
      ]);
    }
    const input = readPayload()?.tool_input ?? {};
    const targets = [input.file_path, input.notebook_path].filter((t) => t !== undefined);
    const root = process.env.CLAUDE_PROJECT_DIR;
    const why =
      targets.length === 0
        ? "the write names no file"
        : targets.map((t) => testPathViolation(t, root, pattern)).find((w) => w !== null);
    return why
      ? denyPipeline("test-path-guard", [
          `${why}.`,
          "Write only test files: a path that matches the run's test pattern, inside the worktree.",
        ])
      : 0;
  });
}
