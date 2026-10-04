#!/usr/bin/env node
/**
 * sealed-guard — an executor does not edit the acceptance tests it is judged by.
 *
 * The engine seals the test-author's tests and records their repo-relative paths in
 * `<MARVIN_PIPELINE_RUN>/sealed.json`. This guard is wired into executor sessions only, so a
 * missing run directory, an unreadable or malformed manifest, an unknown worktree and an edit
 * that names no file are all misconfigurations, and every one denies: a guard that cannot
 * tell what is sealed must not let the edit through.
 *
 * A target is sealed when it resolves to the same PHYSICAL path as a sealed file, and also
 * when it exists and is the same file (device and inode). The second test is what catches
 * what no spelling comparison can: `SRC/A.TEST.TS` on a case-insensitive volume, a hard link
 * to the sealed file, and a symlink that leads to it.
 *
 * Writes through Bash (`sed -i`, `cp`, `git checkout --`) are out of this guard's reach; the
 * gate stage hashes the sealed files as committed and fails any change.
 */
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { isMain, readPayload } from "../../hooks/lib/hook-io.mjs";
import { denyPipeline, pipelineMain } from "./lib/deny.mjs";
import { physicalPath } from "./lib/paths.mjs";

/**
 * The sealed paths recorded for this run. Throws unless the manifest is a JSON array of
 * non-empty strings; an empty array is a valid manifest that seals nothing.
 *
 * @param {string | undefined} runDir The MARVIN_PIPELINE_RUN value.
 * @returns {string[]}
 */
export function loadSealed(runDir) {
  if (typeof runDir !== "string" || runDir === "") {
    throw new Error("the run's state directory (MARVIN_PIPELINE_RUN) is unknown");
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(runDir, "sealed.json"), "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`sealed.json cannot be read (${reason})`, { cause: error });
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string" || entry === "")) {
    throw new Error("sealed.json is not an array of paths");
  }
  return parsed;
}

/**
 * `{dev, ino}` of the file at `path` (symlinks followed), or null when nothing is there.
 * Any other error propagates, which the caller turns into a denial.
 *
 * @param {string} path
 * @returns {{dev: bigint, ino: bigint} | null}
 */
function identity(path) {
  try {
    const { dev, ino } = statSync(path, { bigint: true });
    return { dev, ino };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

/**
 * The sealed path an edit of `target` would change, or null. `..` is judged both as the
 * kernel applies it and as a lexical normaliser would, and either reading hitting a sealed
 * file is a hit.
 *
 * @param {string} target The tool's `file_path` or `notebook_path`, absolute or relative to `root`.
 * @param {string} root The worktree (`CLAUDE_PROJECT_DIR`), absolute.
 * @param {readonly string[]} sealed Repo-relative sealed paths.
 * @returns {string | null}
 */
export function sealedHit(target, root, sealed) {
  const written = isAbsolute(target) ? target : `${root}/${target}`;
  const candidates = [...new Set([written, resolve(root, target)])].map((p) => physicalPath(p));
  const same = candidates.map(identity).filter((id) => id !== null);
  for (const entry of sealed) {
    const sealedPath = physicalPath(resolve(root, entry));
    if (candidates.includes(sealedPath)) return entry;
    const id = identity(sealedPath);
    if (id !== null && same.some((s) => s.dev === id.dev && s.ino === id.ino)) return entry;
  }
  return null;
}

if (isMain(import.meta.url)) {
  pipelineMain("sealed-guard", () => {
    const input = readPayload()?.tool_input ?? {};
    const targets = [input.file_path, input.notebook_path].filter((t) => t !== undefined);
    if (targets.length === 0 || targets.some((t) => typeof t !== "string" || t === "")) {
      return denyPipeline("sealed-guard", [
        "the edit names no file.",
        "Without a target the guard cannot tell whether it is sealed.",
      ]);
    }
    const root = process.env.CLAUDE_PROJECT_DIR;
    if (typeof root !== "string" || !isAbsolute(root)) {
      return denyPipeline("sealed-guard", ["the run's worktree (CLAUDE_PROJECT_DIR) is unknown."]);
    }
    const sealed = loadSealed(process.env.MARVIN_PIPELINE_RUN);
    for (const target of targets) {
      const hit = sealedHit(target, root, sealed);
      if (hit !== null) {
        return denyPipeline("sealed-guard", [
          `${hit} is a sealed acceptance test.`,
          "If it is wrong, finish with status needs_input and fill `dispute`; do not edit it.",
        ]);
      }
    }
    return 0;
  });
}
