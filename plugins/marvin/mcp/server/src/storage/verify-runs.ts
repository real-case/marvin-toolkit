import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * The verification-run journal (ADR-0043, WP4 of `docs/proposals/task-metrics.md`)
 * — the third `runs/` sibling, beside the oracle journal (ADR-0036) and the
 * progress journal.
 *
 * Every verification run OVERWRITES `runs/<slug>.md`, so only the final attempt
 * survives and nothing can recover how many attempts preceded it. That is the one
 * record the pipeline destroyed by design, and the two metrics that need it —
 * time to the first green full run (T3) and runs before the first PASS (R4) —
 * were unrecoverable. This journal is append-only: one entry per run, and one
 * per delivery-gate decision, because `verify action: "gate"` persisted nothing
 * at all and the freshness waivers it grants (Q5) had no other source.
 *
 * It mirrors `storage/progress.ts` line for line in shape — a tag constant, a
 * fence regex derived from it, one zod schema, a path function, an append that
 * never reads the file back, and a read that drops an unparseable block rather
 * than the file. Node builtins and zod only, so it is unit-testable through
 * `_tsload.mjs` without a server build.
 *
 * Both writers in `tools/verify.ts` are FAIL-OPEN: a journal write that throws
 * is swallowed, so this file can never change a verdict or a delivery decision.
 * The journal is evidence for the metrics roll-up, never an input to a gate.
 */

/** The typed-block tag, matching `oracle-run` / `spec-progress` / `verify-result`. */
export const VERIFY_RUN_TAG = "verify-run";
const VERIFY_RUN_RE = new RegExp("```json " + VERIFY_RUN_TAG + "\\n([\\s\\S]*?)\\n```", "g");

/** One gate of a recorded run — the subset of `verify-result`'s gate entry the roll-up reads. */
const JournalGate = z.object({
  name: z.string().min(1),
  status: z.string().min(1),
  durationMs: z.number(),
});

/**
 * `kind: "run"` — one verification run that wrote a per-spec artifact.
 *
 * `only` is recorded on purpose: the fix-cycle protocol re-runs one gate at a
 * time, and R4 counts runs before the first green FULL run, which is decidable
 * only if a targeted retry is distinguishable from a full pass. Null means the
 * whole plan ran.
 */
const RunEntrySchema = z.object({
  /** The spec's validated kebab-case slug — also this journal's filename. */
  slug: z.string().min(1),
  kind: z.literal("run"),
  /** ISO 8601, stamped by the tool. */
  at: z.string(),
  /** `PASS` | `PASS WITH WARNINGS` | `FAIL`, as the run computed it. */
  verdict: z.string().min(1),
  mode: z.string().min(1),
  execution: z.string().min(1),
  /** The gate subset a targeted retry asked for, or null for a full run. */
  only: z.array(z.string()).nullable(),
  gates: z.array(JournalGate),
  wallClockMs: z.number(),
  sumOfGatesMs: z.number(),
  /** The commit the run proved, from the run's own provenance; null outside git. */
  head_sha: z.string().nullable(),
});
export type VerifyRunRecord = z.infer<typeof RunEntrySchema>;

/**
 * `kind: "gate"` — one delivery-gate decision for a resolved slug, recorded
 * whatever the decision was: a BLOCK for a missing artifact is a decision worth
 * counting too. `allowStale` beside `staleness` is what makes a freshness waiver
 * (Q5) a query rather than a transcript read.
 */
const GateEntrySchema = z.object({
  slug: z.string().min(1),
  kind: z.literal("gate"),
  at: z.string(),
  decision: z.enum(["ALLOW", "BLOCK"]),
  /** The verdict the gate read off the artifact, null when it found none. */
  verdict: z.string().nullable(),
  staleness: z.enum(["fresh", "stale", "unknown"]),
  allowStale: z.boolean(),
  red_green: z.enum(["proven", "missing", "unknown"]),
  /** The artifact the gate judged, project-relative. */
  artifact: z.string().min(1),
});
export type VerifyGateRecord = z.infer<typeof GateEntrySchema>;

/** One schema, two entry kinds under one tag, discriminated on `kind`. */
export const VerifyRunEntrySchema = z.discriminatedUnion("kind", [RunEntrySchema, GateEntrySchema]);
export type VerifyRunEntry = z.infer<typeof VerifyRunEntrySchema>;

/**
 * `<runsDir>/<slug>.verify.md` — a SIBLING of the per-spec run, the oracle
 * journal and the progress journal, and NEVER at the top level of the spec
 * directory, where the non-recursive enumerators would read it as a spec.
 */
export function verifyJournalPath(runsDir: string, slug: string): string {
  return join(runsDir, `${slug}.verify.md`);
}

/**
 * Append one entry, creating the directory and the file's one-time header as
 * needed. Never reads the file back to write it — the append-only property is
 * what makes a torn write cost one entry instead of the record.
 */
export function recordVerifyRun(runsDir: string, entry: VerifyRunEntry): void {
  mkdirSync(runsDir, { recursive: true });
  const path = verifyJournalPath(runsDir, entry.slug);
  const header = existsSync(path)
    ? ""
    : `# Verification runs — ${entry.slug}\n\nAppend-only. One \`${VERIFY_RUN_TAG}\` block per run or delivery-gate decision.\n\n`;
  const block = `\`\`\`json ${VERIFY_RUN_TAG}\n${JSON.stringify(entry)}\n\`\`\`\n\n`;
  appendFileSync(path, `${header}${block}`, "utf8");
}

/**
 * Every readable entry for a spec, oldest first.
 *
 * A missing directory and a missing file are both an EMPTY ARRAY, never a
 * throw: every spec verified before this journal existed has none, and the
 * roll-up must report that as an absent source rather than crash on it.
 *
 * A block that does not parse is DROPPED and the file is not. One interrupted
 * append must not discard the runs recorded around it.
 */
export function readVerifyRuns(runsDir: string, slug: string): VerifyRunEntry[] {
  const path = verifyJournalPath(runsDir, slug);
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: VerifyRunEntry[] = [];
  for (const m of raw.matchAll(VERIFY_RUN_RE)) {
    let json: unknown;
    try {
      json = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    const parsed = VerifyRunEntrySchema.safeParse(json);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * A green FULL run: every gate ran (no `only` subset) and the verdict delivers.
 * The predicate T3 and R4 are defined against — declared here, beside the
 * schema, so the roll-up and its tests cannot disagree about what "green" and
 * "full" mean.
 */
export function isGreenFullRun(entry: VerifyRunEntry): entry is VerifyRunRecord {
  return (
    entry.kind === "run" &&
    entry.only === null &&
    (entry.verdict === "PASS" || entry.verdict === "PASS WITH WARNINGS")
  );
}
