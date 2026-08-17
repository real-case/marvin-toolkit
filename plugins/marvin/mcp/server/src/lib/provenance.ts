import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Provenance } from "@marvin-toolkit/mcp-shared/contracts";
import {
  currentBranch,
  diffAgainstHead,
  hashObjects,
  headSha,
  untrackedFiles,
  worktreeRoot,
} from "./git.js";

/**
 * Evidence provenance and the freshness classifier (ADR-0035).
 *
 * A verification proves something about *a* code state. This module records
 * which one, so the delivery gate can refuse a proof that no longer describes
 * the working tree. It is deliberately kept out of `tools/verify.ts` — the tool
 * is already the largest file in the server, and this is exactly the pure
 * computation `lib/` exists to hold and unit-test without a server build.
 *
 * Fail-open is the invariant, not an error path: every git read degrades to
 * `null`, every null degrades to `unknown`, and `unknown` always ALLOWs. A
 * broken or absent git must never make a project undeliverable.
 */

/**
 * marvin's own working directory is excluded by an explicit git pathspec rather
 * than by trusting `.gitignore`: a project that commits `.marvin/task/` would
 * otherwise fold the run file the verification is about to write into that same
 * run's digest, making every run stale on the next read.
 */
const DIGEST_EXCLUDE = [".marvin"];

/**
 * A bound that exists in total, not per file. Past it the digest returns null →
 * `unknown` → ALLOW, the same direction every other degradation takes. No real
 * verification run dirties five thousand paths; a run that does gets an honest
 * "not checked" instead of an answer computed from a truncated read.
 */
const MAX_DIGEST_PATHS = 5000;

/** `path → status`, where `?` marks an untracked path. */
type ChangedPaths = Map<string, string>;

/**
 * Read (1) the tracked changes against HEAD and (2) the untracked paths, both
 * with `.marvin/` excluded. Null when either read fails.
 */
function readChangedPaths(root: string): ChangedPaths | null {
  const diff = diffAgainstHead(root, {
    format: "name-status",
    exclude: DIGEST_EXCLUDE,
    nul: true,
  });
  if (diff === null) return null;
  const untracked = untrackedFiles(root, { exclude: DIGEST_EXCLUDE });
  if (untracked === null) return null;

  const paths: ChangedPaths = new Map();
  // `--name-status -z` emits `status\0path\0` pairs; `--no-renames` guarantees
  // every row is a single path, so a flat pairwise walk is the whole grammar.
  const fields = diff.split("\0").filter((s) => s.length > 0);
  for (let i = 0; i + 1 < fields.length; i += 2) {
    paths.set(fields[i + 1]!, fields[i]!);
  }
  for (const p of untracked) if (!paths.has(p)) paths.set(p, "?");
  return paths;
}

/**
 * 16 hex over a structural path list — one sorted line per path carrying its
 * status and git's content id for the working-tree bytes, or the literal `D`
 * for a path that is gone.
 *
 * Two measured traps are closed by that choice rather than by a larger buffer.
 * Hashing patch text is O(patch bytes) and dies on Node's 1 MiB `spawnSync`
 * default — a 5.5 MB diff exists in this repository's own history — which would
 * blind the guard on exactly the large refactors where stale evidence costs
 * most. Hashing `--numstat` plus the `--raw` blob ids is correctly O(files) but
 * carries no content: `--raw` reports the destination blob of a worktree
 * modification as all-zeros, so two different edits to the same line are
 * byte-identical on both reads. `hash-object` hashes the actual bytes.
 */
function digestFrom(paths: ChangedPaths, root: string): string | null {
  if (paths.size > MAX_DIGEST_PATHS) return null;
  const sorted = [...paths.keys()].sort();
  // `--stdin-paths` is newline-delimited and cannot express a path containing
  // one. Rather than mis-hash such a tree, decline to answer for it.
  if (sorted.some((p) => p.includes("\n"))) return null;

  const present = sorted.filter((p) => existsSync(join(root, p)));
  const ids = hashObjects(present, root);
  if (ids === null) return null;
  const idByPath = new Map(present.map((p, i) => [p, ids[i]!]));

  const lines = sorted.map((p) => `${p}\0${paths.get(p)}\0${idByPath.get(p) ?? "D"}`);
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
}

/** The digest alone. Null outside a worktree or on any failed git read. */
export function worktreeDigest(cwd: string): string | null {
  const root = worktreeRoot(cwd);
  if (!root) return null;
  const paths = readChangedPaths(root);
  return paths === null ? null : digestFrom(paths, root);
}

/**
 * Everything a verification records about the tree it ran on. Null when `cwd` is
 * not inside a git worktree, so a non-git project simply carries no provenance
 * and its delivery gate stays a pure file read.
 *
 * Every subsequent read runs at the resolved root, so every path in the digest
 * is root-relative regardless of where the tool was invoked. `branch` and
 * `dirty` participate in no decision — they are quoted back to the human in the
 * gate's reason on a stale BLOCK, which is what makes a refusal actionable.
 */
export function collectProvenance(cwd: string): Provenance | null {
  const root = worktreeRoot(cwd);
  if (!root) return null;
  const paths = readChangedPaths(root);
  return {
    head_sha: headSha(root),
    branch: currentBranch(root),
    dirty: paths === null ? null : paths.size > 0,
    worktree_digest: paths === null ? null : digestFrom(paths, root),
    generated_at: new Date().toISOString(),
  };
}

export type Staleness = "fresh" | "stale" | "unknown";

/**
 * Compare a recorded provenance against the current tree.
 *
 * The null rule is stated over **both** decisive fields on **both** sides
 * deliberately: a rule written only over `worktree_digest` would let a null
 * `head_sha` beside a matching digest read as `stale` and BLOCK, contradicting
 * the fail-open invariant. Missing provenance is always `unknown` and always
 * ALLOWs — an old artifact and a non-git project must never become
 * undeliverable.
 */
export function classifyStaleness(
  recorded: Provenance | undefined,
  current: Provenance | null,
): Staleness {
  if (!recorded || !current) return "unknown";
  if (!recorded.worktree_digest || !current.worktree_digest) return "unknown";
  if (!recorded.head_sha || !current.head_sha) return "unknown";
  return recorded.worktree_digest === current.worktree_digest &&
    recorded.head_sha === current.head_sha
    ? "fresh"
    : "stale";
}
