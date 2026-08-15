import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * The spec progress journal — the **pure half** of spec resumability.
 *
 * `task-start` writes nothing to disk until its last step, and
 * `task-implement` tracks its acceptance criteria in `TodoWrite`, which
 * context compaction destroys with no trace. This module is what survives
 * both: an append-only record of *where the pipeline got to*, written beside
 * the spec it belongs to and read back when a session resumes.
 *
 * It mirrors `storage/oracles.ts` deliberately — one fenced ` ```json
 * spec-progress ` block per entry, an append that never reads the file back, a
 * read that drops an unparseable block instead of the file, and every function
 * taking `runsDir` as a parameter so the module resolves nothing itself. It
 * imports node builtins and zod only, so it is unit-testable against tmp-dir
 * fixtures with no server build.
 *
 * **The safety property is the degradation rule, not the journal.** Every read
 * here degrades to an empty array, and an empty journal means "verify
 * everything from scratch" at both callers. An absent journal is never evidence
 * that nothing was done: the record can be missing for a dozen reasons that
 * have nothing to do with the work, and the resume fork's output is what a
 * human uses to decide what NOT to re-check.
 */

/** The typed-block tag, matching `oracle-run` / `audit-report` / `verify-result`. */
export const PROGRESS_TAG = "spec-progress";
const PROGRESS_RE = new RegExp("```json " + PROGRESS_TAG + "\\n([\\s\\S]*?)\\n```", "g");

const ProgressEntrySchema = z.object({
  /** The spec's validated kebab-case slug — also this journal's filename. */
  slug: z.string().min(1),
  /** Which skill wrote it: step ids collide across the two pipelines. */
  source: z.enum(["task-start", "task-implement"]),
  /** The writer's own step id — `"1.5"`, `"4F"`, `"5F"`, `"2.5"`. */
  step: z.string().min(1),
  kind: z.enum(["step", "criterion", "decision", "note", "archived"]),
  /** One line of position and choice. Never a credential, token or customer datum. */
  detail: z.string(),
  /** The acceptance-criterion id, when `kind` is `criterion`. */
  criterion: z.string().nullable().optional(),
  /** The draft/spec path, recorded once when the draft is opened. */
  path: z.string().nullable().optional(),
  /** The seal in force, when the writer knows one. */
  contract_sha: z.string().nullable().optional(),
  /** ISO 8601. */
  at: z.string(),
});
export type ProgressEntry = z.infer<typeof ProgressEntrySchema>;

/**
 * `<runsDir>/<slug>.progress.md` — a SIBLING of the per-spec verification run
 * (ADR-0035) and the oracle journal (ADR-0036), and NEVER at the top level of
 * the spec directory, where three non-recursive enumerators would read it as a
 * spec: the slugless summary target, the dashboard's in-flight digest, and the
 * report scanner.
 */
export function progressJournalPath(runsDir: string, slug: string): string {
  return join(runsDir, `${slug}.progress.md`);
}

/**
 * Append one entry, creating the directory and the file's one-time header as
 * needed. Never reads the file back to write it — the append-only property is
 * what makes a torn write cost one entry instead of the record.
 */
export function recordProgress(runsDir: string, entry: ProgressEntry): void {
  mkdirSync(runsDir, { recursive: true });
  const path = progressJournalPath(runsDir, entry.slug);
  const header = existsSync(path)
    ? ""
    : `# Progress — ${entry.slug}\n\nAppend-only. One \`${PROGRESS_TAG}\` block per entry.\n\n`;
  const block = `\`\`\`json ${PROGRESS_TAG}\n${JSON.stringify(entry)}\n\`\`\`\n\n`;
  appendFileSync(path, `${header}${block}`, "utf8");
}

/**
 * Every readable entry for a spec, oldest first.
 *
 * A missing directory and a missing file are both an EMPTY ARRAY, never a
 * throw: the resume fork's very first call is on a spec that was never
 * journalled — which is every spec authored before this journal existed — and
 * an error there would make the loud "nothing recorded, verify from scratch"
 * answer unreachable behind a crash.
 *
 * A block that does not parse is DROPPED and the file is not. One interrupted
 * append — precisely the scenario this journal exists to survive — must not
 * discard the twenty entries recorded around it.
 */
export function readProgress(runsDir: string, slug: string): ProgressEntry[] {
  const path = progressJournalPath(runsDir, slug);
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: ProgressEntry[] = [];
  for (const m of raw.matchAll(PROGRESS_RE)) {
    let json: unknown;
    try {
      json = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    const parsed = ProgressEntrySchema.safeParse(json);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export interface ResumeState {
  /** Only the entries AFTER the last `archived` boundary. */
  entries: ProgressEntry[];
  /** How many boundaries were crossed to get here. */
  archived: number;
  last: ProgressEntry | null;
  /** De-duplicated criterion ids, first occurrence first. */
  criteria_done: string[];
  path: string | null;
  contract_sha: string | null;
}

/**
 * The reducer the resume fork renders.
 *
 * **Archiving is a boundary ENTRY, never a rewrite or a delete.** The file is
 * append-only by contract and history is the thing being preserved, so "start
 * clean" is expressed by *skipping* everything up to the last `kind:
 * "archived"` entry rather than by destroying it. What was abandoned, and when,
 * stays answerable.
 *
 * Every field is computed over that live window and not over the whole file:
 * a user who explicitly discarded a run must not be shown its completed
 * criteria, its draft path or its seal as though they still counted. `archived`
 * is the one field that reports across the boundary, because "you have
 * discarded a run here before" is exactly what the window cannot say.
 */
export function resumeState(entries: ProgressEntry[]): ResumeState {
  let archived = 0;
  let start = 0;
  entries.forEach((e, i) => {
    if (e.kind === "archived") {
      archived += 1;
      start = i + 1;
    }
  });

  const live = entries.slice(start);
  const criteria_done: string[] = [];
  let path: string | null = null;
  let contract_sha: string | null = null;
  for (const e of live) {
    if (e.kind === "criterion") {
      const id = e.criterion?.trim();
      if (id && !criteria_done.includes(id)) criteria_done.push(id);
    }
    // Newest non-null wins: both are re-recorded whenever they change.
    if (e.path) path = e.path;
    if (e.contract_sha) contract_sha = e.contract_sha;
  }

  return {
    entries: live,
    archived,
    last: live.length ? live[live.length - 1]! : null,
    criteria_done,
    path,
    contract_sha,
  };
}
