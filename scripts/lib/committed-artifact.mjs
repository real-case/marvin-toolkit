// Baseline resolution shared by the committed-artifact drift guards
// (verify-dist.mjs, verify-widgets.mjs).
//
// A guard that rebuilds an artifact *in place* cannot read its "committed"
// baseline from the working tree: any earlier step that ran a build has already
// overwritten the file, so the comparison silently degrades to rebuild-vs-rebuild
// and can never fail. CI does exactly that — "Build all workspaces" runs before
// both guard steps in validate-plugins.yml — which is how a server bundle built
// inside a git worktree reached `dev` with esbuild's module-path comments baked to
// the wrong depth, past two green guard steps.
//
// git is the only source of the committed bytes that no build step can rewrite,
// so the baseline is read from there and the working tree is used for diagnostics
// only.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";

/** Repo-relative, forward-slash path — the form `git show <ref>:<path>` expects. */
export function gitPath(repoRoot, absPath) {
  return relative(repoRoot, absPath).split(sep).join("/");
}

/**
 * Bytes of `absPath` as committed at `ref`.
 *
 * Returns `{ bytes: null, reason }` when git cannot supply them, which is a
 * legitimate state rather than an error: the path may not be in the tree at that
 * ref (an artifact committed for the first time), or there may be no repository
 * at all (a tarball export). Callers fall back to the working-tree copy and say
 * so.
 */
export function readCommittedBytes(repoRoot, absPath, ref = "HEAD") {
  const spec = `${ref}:${gitPath(repoRoot, absPath)}`;
  try {
    const bytes = execFileSync("git", ["show", spec], {
      cwd: repoRoot,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { bytes, reason: null };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : "";
    return { bytes: null, reason: stderr || err.message };
  }
}

export function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function hashFile(path) {
  return hashBytes(readFileSync(path));
}

/**
 * Classify a rebuild against the committed baseline.
 *
 * `worktreeBefore` is the artifact as it stood before this process rebuilt it. It
 * never decides the verdict — in CI a prior build step has already made it equal
 * to the fresh build — but it separates the two ways a guard fails, which need
 * different fixes:
 *
 *   drift          the fresh build matches neither the commit nor what was on
 *                  disk: the artifact was built from different sources, in a
 *                  different tree, or by hand.
 *   uncommitted    the working tree already held this exact build; only the
 *                  commit is behind, so the fix is to stage it.
 */
export function classifyRebuild({ baseline, worktreeBefore, rebuilt }) {
  if (baseline === rebuilt) return { ok: true, kind: "in-sync" };
  if (worktreeBefore === rebuilt) return { ok: false, kind: "uncommitted" };
  return { ok: false, kind: "drift" };
}
