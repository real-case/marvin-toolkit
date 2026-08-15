import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import type { ReportEnvelope, ReportFinding } from "@marvin-toolkit/mcp-shared/contracts";
import { SEC_FIX_GENERATED_BY, type TriageStateValue } from "./reports.js";

/**
 * Finding triage: the baseline store and the reconciliation pass (ADR-0038).
 *
 * `lib/reports.ts` computes a finding's identity at assembly and stops there —
 * it never reads the baseline, never touches a configured path and gains no
 * sibling import, so `buildReportList` stays a pure function of the filesystem.
 * Everything stateful lives here instead, one directed edge away
 * (`triage.ts` → `reports.ts`, never the reverse), which is also what lets the
 * reconciliation be tested against a synthetic envelope list with no `.marvin/`
 * tree seeded at all.
 *
 * The baseline shape is deliberately NOT a contract: no widget ever receives
 * it. The only contract-side type this file touches is `TriageState`, which
 * types a field the widget does read.
 */

/** One remembered fingerprint. `present` is what makes `regressed` expressible. */
export interface BaselineEntry {
  fingerprint: string;
  firstSeen: string;
  lastSeen: string;
  present: boolean;
}

/** The file name under the configured report directory. */
export const BASELINE_FILENAME = "triage.json";

/**
 * The written shape. `version` has a declared reader rather than a decorative
 * one: {@link readBaseline} accepts 1 and reads anything else — a future 2, a
 * missing field, a corrupt file — as an EMPTY baseline, and
 * {@link writeBaseline} always stamps 1. A version bump is therefore a
 * deliberate reset of triage history, never a parse error.
 */
const BASELINE_VERSION = 1;

/**
 * One entry as written. The two stamps are validated as the CONTRACT's
 * datetime, not merely as non-empty text, because `reconcile` copies
 * `firstSeen` straight onto a finding and `ReportFinding.firstSeen` is declared
 * `z.string().datetime()`. Accepted as free text, a hand-edited or corrupted
 * `"firstSeen": "yesterday"` reached `structuredContent` unchallenged — nothing
 * re-validates the payload on the way out and the widget casts rather than
 * parses — so the tool answered with a payload that fails its own published
 * schema. Tightened here, the bad stamp fails its entry, the entry fails the
 * file, and the file reads as an EMPTY baseline: the same zero-state doctrine
 * {@link readBaseline} already applies to every other way of being corrupt, now
 * covering one more. Nothing this file writes can trip it — every stamp it
 * produces is a `Date#toISOString()` value, either the clock's or a report's
 * own `generatedAt`.
 */
const BaselineEntrySchema = z.object({
  fingerprint: z.string().min(1),
  firstSeen: z.string().datetime(),
  lastSeen: z.string().datetime(),
  present: z.boolean(),
});

const BaselineFileSchema = z.object({
  version: z.literal(BASELINE_VERSION),
  updatedAt: z.string().optional(),
  findings: z.array(BaselineEntrySchema),
});

/**
 * Read the stored baseline. A missing, unreadable, symlinked, schema-invalid or
 * unrecognised-`version` file reads as an EMPTY baseline — the zero-state
 * doctrine `readMdFiles` already follows — never a throw.
 *
 * The file sits in the project tree, so anything with filesystem access can
 * write it. A hostile baseline can make findings look `new` or `persisting`; it
 * cannot crash the tool, cannot suppress a finding (states annotate rows, they
 * never filter them), cannot escape the file, because fingerprints are only
 * ever compared and never used to build a path, and cannot smuggle a value into
 * the published contract, because every field it can reach is validated in the
 * shape the contract declares — see {@link BaselineEntrySchema} for the
 * timestamps, the one pair that is copied onto a finding verbatim.
 */
export function readBaseline(path: string): BaselineEntry[] {
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    // Symlinks are skipped for the same reason `readMdFiles` skips them: a
    // planted link under .marvin must not pull out-of-tree content in.
    if (lstatSync(path).isSymbolicLink()) return [];
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }

  const parsed = BaselineFileSchema.safeParse(json);
  return parsed.success ? parsed.data.findings : [];
}

// ── the live set ─────────────────────────────────────────────────────────────

/** Findings-bodied envelopes are the only ones that can carry an identity. */
function findingsOf(envelope: ReportEnvelope): ReportFinding[] | null {
  const body = envelope.body as { findings?: ReportFinding[] };
  return Array.isArray(body.findings) ? body.findings : null;
}

/** `NNN-(audit|smells)-<slug>.md` → its sequence number, kind and slug. */
function registerKey(envelope: ReportEnvelope): { seq: number; key: string } | null {
  const m = /^(\d+)-(audit|smells)-(.+)\.md$/.exec(basename(envelope.path));
  return m ? { seq: Number(m[1]), key: `${m[2]}\0${m[3]}` } : null;
}

/** Newest-first, tie-broken by id — the order `buildReportList` already emits. */
function newestFirst(envelopes: ReportEnvelope[]): ReportEnvelope[] {
  return [...envelopes].sort(
    (a, b) => b.generatedAt.localeCompare(a.generatedAt) || a.id.localeCompare(b.id),
  );
}

/**
 * Which envelopes count as current state — the point where the two report
 * lifecycles are reconciled with each other.
 *
 * A `fix` record is excluded outright, whatever its filename. Its findings
 * describe vulnerabilities that were CLOSED — the skill states it in those words
 * — so they are not a claim about what is wrong now, and `sec-fix` writes one
 * accumulating `fix-<slug>.md` per vulnerability rather than overwriting a fixed
 * name. Counted as live, every fixed vulnerability would report `new` once and
 * `persisting` forever, `resolved` could never fire for it, and the roll-up
 * would keep printing a closed critical at its original severity. The exclusion
 * is by KIND, not by filename sequence: no re-run of `sec-fix` supersedes an
 * earlier fix record, so newest-per-slug scoping would not help. This is the
 * live-set counterpart of the same judgement `lib/state.ts` makes for the
 * dashboard's Security area (`NON_POSTURE_KINDS`); `gate` needs no exclusion
 * here, because `gate-report.md` is one overwritten file whose findings are
 * genuinely still open.
 *
 * Every other security envelope counts: those scanners write FIXED filenames,
 * so a re-run overwrites and the report IS current state. The refactor registers
 * do the opposite — `NNN-<kind>-<slug>.md` on one monotonic sequence, every one
 * of which gets an envelope — so the directory is a history and only the
 * HIGHEST-numbered register per `(kind, slug)` is live, tie-broken by
 * `generatedAt`. Without that scoping a finding fixed after `001-audit-core.md`
 * still sits in `001-audit-core.md`, reports `persisting` forever and never
 * `resolved`, and one re-audit puts the identical fingerprint in two envelopes
 * of a single pass.
 *
 * Findings in a superseded register, and in every fix record, are left
 * unreconciled rather than relabelled — "absent means not reconciled" is the
 * honest third answer.
 */
function liveEnvelopeIds(envelopes: ReportEnvelope[]): Set<string> {
  const live = new Set<string>();
  const bestRegister = new Map<string, { id: string; seq: number; generatedAt: string }>();

  for (const envelope of envelopes) {
    if (findingsOf(envelope) === null) continue;
    // The envelope keeps the report kind only in `generatedBy`, so that is the
    // seam; the constant is exported from the assembly that writes it.
    if (envelope.generatedBy === SEC_FIX_GENERATED_BY) continue;
    if (envelope.group === "refactor") {
      const reg = registerKey(envelope);
      if (!reg) continue; // a findings body under a foreign name — not a register
      const held = bestRegister.get(reg.key);
      const wins =
        !held ||
        reg.seq > held.seq ||
        (reg.seq === held.seq && envelope.generatedAt > held.generatedAt);
      if (wins) {
        bestRegister.set(reg.key, {
          id: envelope.id,
          seq: reg.seq,
          generatedAt: envelope.generatedAt,
        });
      }
      continue;
    }
    live.add(envelope.id);
  }

  for (const held of bestRegister.values()) live.add(held.id);
  return live;
}

/**
 * The live fingerprint set. Within it a fingerprint is carried ONCE — first
 * occurrence in newest-first envelope order winning — so the baseline never
 * holds two rows for one identity.
 */
export function liveFingerprints(envelopes: ReportEnvelope[]): Set<string> {
  return new Set(liveEntries(envelopes).map((e) => e.fingerprint));
}

/** The deduplicated live findings, newest-first, with the envelope that carried them. */
function liveEntries(envelopes: ReportEnvelope[]): { fingerprint: string; generatedAt: string }[] {
  const live = liveEnvelopeIds(envelopes);
  const seen = new Set<string>();
  const out: { fingerprint: string; generatedAt: string }[] = [];
  for (const envelope of newestFirst(envelopes)) {
    if (!live.has(envelope.id)) continue;
    for (const finding of findingsOf(envelope) ?? []) {
      if (seen.has(finding.fingerprint)) continue;
      seen.add(finding.fingerprint);
      out.push({ fingerprint: finding.fingerprint, generatedAt: envelope.generatedAt });
    }
  }
  return out;
}

/**
 * The earliest instant a finding can honestly be attested to: the report's own
 * `generatedAt`, because a report generated nine days ago did not first exist
 * at the moment it was read. A file whose mtime is ahead of the clock cannot
 * claim more than the present, so it clamps to `now`.
 */
function attestedAt(generatedAt: string, now: number): string {
  const stamp = Date.parse(generatedAt);
  return Number.isFinite(stamp) && stamp <= now ? generatedAt : new Date(now).toISOString();
}

// ── reconciliation ───────────────────────────────────────────────────────────

export interface Reconciliation {
  envelopes: ReportEnvelope[];
  /** Baseline fingerprints that were present and are no longer in the live set. */
  resolved: BaselineEntry[];
}

/**
 * Annotate the live envelopes' findings with `state`/`firstSeen` and report the
 * resolved roll-up. Read-only: nothing here writes.
 *
 * Absent from the baseline → `new`; present with `present: true` →
 * `persisting`; present with `present: false` → `regressed`, a fingerprint that
 * had gone and came back. A baseline fingerprint that was present and is now
 * gone is `resolved`, and appears in the roll-up ONLY — never as a
 * `ReportFinding.state`, because there is no row left to carry it.
 */
export function reconcile(
  envelopes: ReportEnvelope[],
  baseline: BaselineEntry[],
  now: number,
): Reconciliation {
  const remembered = new Map(baseline.map((e) => [e.fingerprint, e]));
  const live = liveEnvelopeIds(envelopes);
  const liveSet = new Set(liveEntries(envelopes).map((e) => e.fingerprint));

  const annotated = envelopes.map((envelope) => {
    const findings = findingsOf(envelope);
    if (findings === null || !live.has(envelope.id)) return envelope;
    return {
      ...envelope,
      body: {
        ...(envelope.body as object),
        findings: findings.map((finding) => {
          const known = remembered.get(finding.fingerprint);
          const state: TriageStateValue = !known
            ? "new"
            : known.present
              ? "persisting"
              : "regressed";
          return {
            ...finding,
            state,
            firstSeen: known ? known.firstSeen : attestedAt(envelope.generatedAt, now),
          };
        }),
      },
    } as ReportEnvelope;
  });

  const resolved = baseline.filter((e) => e.present && !liveSet.has(e.fingerprint));
  return { envelopes: annotated, resolved };
}

/**
 * The NEXT baseline — the entry producer, and the only reason `regressed` is
 * reachable at all.
 *
 * It does NOT derive entries from the live set alone. A baseline fingerprint
 * absent from the live set is RETAINED with `present: false`, its original
 * `firstSeen` preserved and its `lastSeen` left at the last value it actually
 * had. Drop that retention and a reappearance classifies as `new`, `regressed`
 * becomes dead code, and a reconciliation test over hand-built data keeps
 * passing while the system can never produce the state.
 */
export function nextBaseline(
  envelopes: ReportEnvelope[],
  baseline: BaselineEntry[],
  now: number,
): BaselineEntry[] {
  const live = new Map(liveEntries(envelopes).map((e) => [e.fingerprint, e]));
  const stamp = new Date(now).toISOString();

  // Baseline order first, so the file's diff stays readable across snapshots.
  const out: BaselineEntry[] = baseline.map((entry) =>
    live.has(entry.fingerprint)
      ? { ...entry, lastSeen: stamp, present: true }
      : { ...entry, present: false },
  );

  const known = new Set(baseline.map((e) => e.fingerprint));
  for (const entry of live.values()) {
    if (known.has(entry.fingerprint)) continue;
    const firstSeen = attestedAt(entry.generatedAt, now);
    out.push({ fingerprint: entry.fingerprint, firstSeen, lastSeen: firstSeen, present: true });
  }
  return out;
}

// ── the write side (the one writing path in the whole tool) ──────────────────

/**
 * Create the report directory if missing and drop a self-ignoring `.gitignore`
 * (`*`) inside it — copied from `ensureUsageDir` (`lib/usage.ts`), including the
 * part that matters: the `.gitignore` is written only when ABSENT, so a host
 * that has customised it is left alone.
 */
export function ensureTriageDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const gitignore = join(dir, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, "*\n");
}

/** Write the baseline, always stamping the current version. */
export function writeBaseline(path: string, entries: BaselineEntry[], now: number): void {
  const payload = {
    version: BASELINE_VERSION,
    updatedAt: new Date(now).toISOString(),
    findings: entries,
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}
