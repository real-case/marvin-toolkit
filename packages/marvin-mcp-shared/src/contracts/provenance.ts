import { z } from "zod";

/**
 * Evidence provenance (ADR-0035) — the code state a `verify` run proved.
 *
 * Recorded in the `verify-result` block so the delivery gate can compare the
 * tree the evidence was produced on against the tree that is about to ship.
 * Every git-derived field is nullable because collection deliberately fails
 * open: a broken, absent or unreadable git must degrade the freshness verdict
 * to `unknown` (which always ALLOWs), never make a project undeliverable.
 * `generated_at` is the one non-null field — it comes from the clock, not
 * from git.
 */
export const Provenance = z.object({
  /** `git rev-parse HEAD` at collection time. */
  head_sha: z.string().nullable(),
  /** The checked-out branch; recorded for the human, decides nothing. */
  branch: z.string().nullable(),
  /** Whether any tracked or untracked path outside `.marvin/` differed from HEAD. */
  dirty: z.boolean().nullable(),
  /**
   * 16 hex of a sha256 over a structural path list — one line per changed or
   * untracked path, carrying its status and git's content id for the
   * working-tree bytes. Never patch text: the input is O(paths changed), so it
   * cannot outgrow a pipe buffer, and it still moves on an edit that leaves the
   * line counts identical.
   */
  worktree_digest: z.string().nullable(),
  /** ISO-8601 collection timestamp. */
  generated_at: z.string(),
});
export type Provenance = z.infer<typeof Provenance>;
