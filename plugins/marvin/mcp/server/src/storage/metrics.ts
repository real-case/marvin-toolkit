import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import type { MetricEvent, TaskMetrics } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * The task-metrics record (ADR-0043) — one file per spec under
 * `.marvin/metrics/`, holding live ` ```json metric-event ` blocks appended
 * during the run and terminal ` ```json task-metrics ` blocks derived at
 * delivery, of which the LAST is authoritative.
 *
 * It follows `storage/progress.ts` in shape: tag constants, fence regexes
 * derived from them, an append that never reads the file back and writes the
 * one-time header on first use, reads that degrade to empty on a missing
 * directory or file and drop an unparseable block rather than the file. Node
 * builtins and zod only, so it is unit-testable through `_tsload.mjs` without a
 * server build.
 *
 * **The record is named after the spec's own file** (ADR-0043 §1):
 * `<NNN>-<slug>.md` reuses the spec's number, and a spec that lives unnumbered
 * in a host directory gets `<slug>.md`. Nothing is allocated, so two parallel
 * branches cannot mint the same number, and both directions of the join are a
 * filename lookup — `findRecord` resolves a slug without knowing its number,
 * exactly as `resolveSpecBySlug` does for the spec.
 */

/** The two block tags (ADR-0043 §2), chosen to differ by more than one letter. */
export const METRIC_EVENT_TAG = "metric-event";
export const TASK_METRICS_TAG = "task-metrics";

const fence = (tag: string) => new RegExp("```json " + tag + "\\n([\\s\\S]*?)\\n```", "g");
const EVENT_RE = fence(METRIC_EVENT_TAG);
const TERMINAL_RE = fence(TASK_METRICS_TAG);

// ── runtime mirror of `contracts/metrics.ts` ─────────────────────────────────
//
// The contracts package is imported type-only throughout the server (the
// `_tsload.mjs` unit tests compile with `packages: "external"`, so a value import
// would resolve to an uncommitted `dist/contracts/index.js` and make every
// storage test depend on a shared-package build — the reason `lib/reports.ts`
// mirrors `CritiqueSchema` and `ProvenanceSchema`). The event vocabulary below
// therefore mirrors the contract field for field; `test/metrics.test.mjs`
// compiles the contract source through the same loader and asserts the two
// agree, so the mirror cannot drift silently.

/** The kebab-case rule every slug in the pipeline obeys. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const METRIC_EVENT_KINDS = [
  "fix-round",
  "spec-gap",
  "open-item",
  "critic-dispatch",
  "critic-verdict",
  "gate-call",
] as const;
export type MetricEventKind = (typeof METRIC_EVENT_KINDS)[number];

export const METRIC_EVENT_SOURCES = [
  "task-start",
  "task-implement",
  "task-deliver",
  "marvin-tm-executor",
] as const;
export const FIX_LOOPS = ["verify-gate", "critic", "red-green"] as const;
export const OPEN_ITEM_CLASSIFICATIONS = ["deferred", "blocked"] as const;
export const METRIC_CRITICS = ["marvin-tm-spec-critic", "marvin-tm-diff-critic"] as const;
export const METRIC_GATES = ["dor"] as const;
/** A `critic-verdict` records one of these — the receipt's terminal vocabulary. */
export const TERMINAL_VERDICTS = ["PASS", "PASS WITH WARNINGS", "BLOCK", "UNABLE"] as const;
/** A `gate-call` records one of these — the DoR gate's own three values. */
export const DOR_VERDICTS = ["PASS", "PASS WITH WARNINGS", "FAIL"] as const;

/** The fields each kind REQUIRES beyond the common ones — one table, read by the refinement and by the tool's error text. */
export const REQUIRED_EVENT_FIELDS: Record<MetricEventKind, readonly string[]> = {
  "fix-round": ["loop", "round"],
  "spec-gap": ["detail"],
  "open-item": ["classification", "detail"],
  "critic-dispatch": ["critic", "pass"],
  "critic-verdict": ["critic", "pass", "verdict", "blockers", "warnings"],
  "gate-call": ["gate", "call", "verdict"],
};

const MetricEventShape = z.object({
  slug: z.string().min(1).regex(SLUG_RE, "slug must be kebab-case"),
  source: z.enum(METRIC_EVENT_SOURCES),
  step: z.string().min(1),
  kind: z.enum(METRIC_EVENT_KINDS),
  contract_sha: z.string().nullable().optional(),
  at: z.string().datetime(),
  detail: z.string().min(1).optional(),
  loop: z.enum(FIX_LOOPS).optional(),
  round: z.number().int().positive().optional(),
  classification: z.enum(OPEN_ITEM_CLASSIFICATIONS).optional(),
  critic: z.enum(METRIC_CRITICS).optional(),
  pass: z.number().int().positive().optional(),
  verdict: z.string().min(1).optional(),
  blockers: z.number().int().nonnegative().optional(),
  warnings: z.number().int().nonnegative().optional(),
  gate: z.enum(METRIC_GATES).optional(),
  call: z.number().int().positive().optional(),
});

/**
 * One live entry, fail-closed per kind: an event missing one of its kind's
 * fields does not validate, so a half-written block is never counted as a
 * whole one (ADR-0043 §2).
 */
export const MetricEventSchema = MetricEventShape.superRefine((value, ctx) => {
  for (const field of REQUIRED_EVENT_FIELDS[value.kind]) {
    const v = (value as Record<string, unknown>)[field];
    if (v === undefined || v === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `a ${value.kind} event requires ${field}`,
      });
    }
  }
  if (value.kind === "critic-verdict" && value.verdict !== undefined) {
    if (!(TERMINAL_VERDICTS as readonly string[]).includes(value.verdict)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verdict"],
        message: `a critic-verdict records a terminal verdict: ${TERMINAL_VERDICTS.join(" | ")}`,
      });
    }
  }
  if (value.kind === "gate-call" && value.verdict !== undefined) {
    if (!(DOR_VERDICTS as readonly string[]).includes(value.verdict)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verdict"],
        message: `a gate-call records the gate's verdict: ${DOR_VERDICTS.join(" | ")}`,
      });
    }
  }
});

/**
 * The terminal block on READ. The writer is the roll-up in this same process,
 * typed against the `TaskMetrics` contract, so the reader checks the envelope —
 * the identity, the four sections, the notes — and passes the sections through.
 * A block that lacks the envelope is dropped like any other unparseable block.
 */
const TaskMetricsEnvelope = z
  .object({
    slug: z.string().min(1),
    rolled_up_at: z.string().min(1),
    base_branch: z.string().min(1),
    sources: z.record(z.string(), z.enum(["present", "absent"])),
    time: z.object({}).passthrough(),
    quality: z.object({}).passthrough(),
    rework: z.object({}).passthrough(),
    notes: z.array(z.string()),
  })
  .passthrough();

// ── paths ────────────────────────────────────────────────────────────────────

/** `<dir>/<specBasename>.md` — the spec's own basename, number included. */
export function metricsRecordPath(dir: string, specBasename: string): string {
  return join(dir, `${specBasename}.md`);
}

/** The basename a metrics record shares with its spec: the spec's filename without `.md`. */
export function recordBasenameForSpec(specPath: string): string {
  return basename(specPath).replace(/\.md$/, "");
}

/** The slug a record's basename carries: the `<NNN>-` prefix stripped. */
export function slugOfRecord(filename: string): string {
  return basename(filename).replace(/\.md$/, "").replace(/^\d+-/, "");
}

/**
 * Resolve a record from its slug alone — an exact `<slug>.md` first, else the
 * first `<digits>-<slug>.md` — so a reader never needs the spec's number to find
 * it. Null when the directory or the record does not exist.
 */
export function findRecord(dir: string, slug: string): string | null {
  if (!existsSync(dir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return null;
  }
  const exact = `${slug}.md`;
  const numbered = new RegExp(`^\\d+-${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.md$`);
  let fallback: string | null = null;
  for (const entry of entries) {
    if (entry === exact) return join(dir, entry);
    if (!fallback && numbered.test(entry)) fallback = join(dir, entry);
  }
  return fallback;
}

// ── writes ───────────────────────────────────────────────────────────────────

function header(slug: string): string {
  return (
    `# Metrics — ${slug}\n\n` +
    `Append-only. One \`${METRIC_EVENT_TAG}\` block per live event; one \`${TASK_METRICS_TAG}\` ` +
    `block per delivery, the last authoritative (ADR-0043).\n\n`
  );
}

function append(path: string, slug: string, tag: string, payload: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const head = existsSync(path) ? "" : header(slug);
  appendFileSync(path, `${head}\`\`\`json ${tag}\n${JSON.stringify(payload)}\n\`\`\`\n\n`, "utf8");
}

/** Append one live event. Never reads the file back to write it. */
export function appendMetricEvent(path: string, event: MetricEvent): void {
  append(path, event.slug, METRIC_EVENT_TAG, event);
}

/** Append one terminal block. A second delivery appends a second block; readers take the last. */
export function appendTaskMetrics(path: string, block: TaskMetrics): void {
  append(path, block.slug, TASK_METRICS_TAG, block);
}

// ── reads ────────────────────────────────────────────────────────────────────

export interface MetricsRecord {
  /** Every readable live event, oldest first. */
  events: MetricEvent[];
  /** Every readable terminal block, oldest first — the last is authoritative. */
  terminal: TaskMetrics[];
}

/**
 * Read one record file. A missing or unreadable file is an EMPTY record, never a
 * throw, and a block that does not parse is DROPPED while its neighbours survive.
 */
export function readRecord(path: string): MetricsRecord {
  const empty: MetricsRecord = { events: [], terminal: [] };
  if (!existsSync(path)) return empty;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return empty;
  }
  const events: MetricEvent[] = [];
  for (const m of raw.matchAll(EVENT_RE)) {
    const json = parseJson(m[1]!);
    if (json === undefined) continue;
    const parsed = MetricEventSchema.safeParse(json);
    if (parsed.success) events.push(parsed.data as MetricEvent);
  }
  const terminal: TaskMetrics[] = [];
  for (const m of raw.matchAll(TERMINAL_RE)) {
    const json = parseJson(m[1]!);
    if (json === undefined) continue;
    const parsed = TaskMetricsEnvelope.safeParse(json);
    if (parsed.success) terminal.push(parsed.data as unknown as TaskMetrics);
  }
  return { events, terminal };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Every readable live event for a slug, oldest first; `[]` when there is no record. */
export function readMetricEvents(dir: string, slug: string): MetricEvent[] {
  const path = findRecord(dir, slug);
  return path ? readRecord(path).events : [];
}

/** The LAST terminal block for a slug, or null when none has been derived. */
export function readTaskMetrics(dir: string, slug: string): TaskMetrics | null {
  const path = findRecord(dir, slug);
  if (!path) return null;
  const { terminal } = readRecord(path);
  return terminal.length ? terminal[terminal.length - 1]! : null;
}

/** Every record under the directory — filename, slug and its contents — for the series aggregation. */
export function listRecords(
  dir: string,
): Array<{ path: string; filename: string; slug: string } & MetricsRecord> {
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith(".md"))
    .map((filename) => {
      const path = join(dir, filename);
      return { path, filename, slug: slugOfRecord(filename), ...readRecord(path) };
    });
}
