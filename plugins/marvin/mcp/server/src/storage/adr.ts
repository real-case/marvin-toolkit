/**
 * ADR corpus persistence (ADR-0027).
 *
 * Resolves where a project keeps its decision records (config → detection →
 * default), parses both header styles found in the wild — marvin's table style
 * (`| Status | **Accepted** … |`) and the MADR/Nygard heading style
 * (`## Status`) — into one record shape, and performs the surgical header
 * mutations (`accept` stamp, supersede link flips) that must never touch a
 * record's prose. Files the tolerant parser cannot read are surfaced through a
 * malformed channel (the kanban precedent), never silently dropped and never
 * fatal to the rest of the corpus.
 *
 * The record shape mirrors the `AdrRecord` contract in
 * `marvin-mcp-shared/contracts`; the vocabulary is duplicated here on purpose
 * so the contract stays importable type-only by the tool layer.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, posix, relative, sep } from "node:path";
import type { AdrConfig } from "./schema.js";

/** Closed status vocabulary (ADR-0027). */
export const ADR_STATUSES = [
  "proposed",
  "accepted",
  "deprecated",
  "superseded",
  "rejected",
] as const;
export type AdrStatus = (typeof ADR_STATUSES)[number];

export type AdrHeaderStyle = "table" | "heading";

export interface AdrRecordData {
  number: number;
  slug: string;
  title: string;
  status: AdrStatus;
  /** YYYY-MM-DD, or null when the record carries no parseable date. */
  date: string | null;
  supersedes: number[];
  superseded_by: number[];
  /** Project-root-relative path, POSIX separators (stable across hosts). */
  path: string;
  /** Bare filename inside the corpus directory. */
  filename: string;
  /** Which header style the parser matched — drives the mutation shape. */
  style: AdrHeaderStyle;
}

export type AdrMalformedKind = "missing-title" | "missing-status" | "invalid-status";

export interface MalformedAdr {
  filename: string;
  /** Filename number when the NNNN- prefix was still parseable. */
  number: number | null;
  kind: AdrMalformedKind;
  reason: string;
}

export interface AdrCorpus {
  records: AdrRecordData[];
  malformed: MalformedAdr[];
}

// ── directory resolution ──────────────────────────────────────────────────

export type AdrDirSource = "config" | "detected" | "default";

export interface AdrDirResolution {
  /** Absolute corpus directory. */
  abs: string;
  /** Project-root-relative form (POSIX separators) used in output and payloads. */
  rel: string;
  source: AdrDirSource;
}

const DETECTION_CANDIDATES = ["docs/adr", "docs/decisions", "adr"] as const;
const DEFAULT_DIR = "docs/adr";

/**
 * Resolve the corpus directory (ADR-0027, the ADR-0005 host-adaptive pattern):
 * config `adr.dir` wins when set; otherwise the first existing conventional
 * location; otherwise `docs/adr/`. The directory is not required to exist —
 * read paths treat a missing dir as an empty corpus, and mutating actions
 * fail closed with the resolved path in the message.
 */
export function resolveAdrDir(projectDir: string, adrConfig?: AdrConfig): AdrDirResolution {
  if (adrConfig?.dir) {
    const abs = isAbsolute(adrConfig.dir) ? adrConfig.dir : join(projectDir, adrConfig.dir);
    return { abs, rel: toPosix(relative(projectDir, abs)) || adrConfig.dir, source: "config" };
  }
  for (const rel of DETECTION_CANDIDATES) {
    const abs = join(projectDir, rel);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      return { abs, rel, source: "detected" };
    }
  }
  return { abs: join(projectDir, DEFAULT_DIR), rel: DEFAULT_DIR, source: "default" };
}

function toPosix(p: string): string {
  return p.split(sep).join(posix.sep);
}

// ── parsing ───────────────────────────────────────────────────────────────

/** `NNNN-<slug>.md` — 3..5 digits tolerated; marvin's own corpus uses 4. */
const FILENAME_RE = /^(\d{3,5})-(.+)\.md$/;

/** `ADR-0007`, `ADR 0007`, `ADR0007` → 7. Used for links and dangling-ref lint. */
const ADR_REF_RE = /\bADR[-\s]?(\d{3,5})\b/gi;

const ISO_DATE_RE = /\d{4}-\d{2}-\d{2}/;

export type ParsedAdrFile =
  { ok: true; record: AdrRecordData } | { ok: false; malformed: MalformedAdr };

/**
 * Parse one record from raw markdown. Tolerates decoration around the status
 * value (`**Accepted** (sign-off note)`, `Superseded by ADR-0031`) but maps it
 * onto the closed vocabulary fail-closed: a status outside the five values is
 * a malformed file with an explicit reason, not a guess.
 */
export function parseAdrFile(raw: string, filename: string, relPath: string): ParsedAdrFile {
  const nameMatch = filename.match(FILENAME_RE);
  const number = nameMatch ? Number(nameMatch[1]) : null;
  const slug = nameMatch?.[2] ?? "";
  const fail = (kind: AdrMalformedKind, reason: string): ParsedAdrFile => ({
    ok: false,
    malformed: { filename, number, kind, reason },
  });
  if (!nameMatch || number === null) {
    // Callers only pass NNNN-*.md names; belt-and-braces for direct use.
    return fail("missing-title", `filename does not match NNNN-<slug>.md`);
  }

  const title = extractTitle(raw);
  if (!title) return fail("missing-title", "no `# <title>` heading found");

  const statusSource = extractStatusSource(raw);
  if (!statusSource) {
    return fail(
      "missing-status",
      "no status header found (neither a `| Status | … |` table row nor a `## Status` section)",
    );
  }

  const status = normalizeStatus(statusSource.text);
  if (!status) {
    return fail(
      "invalid-status",
      `status "${compact(statusSource.text)}" is not in the vocabulary (${ADR_STATUSES.join(" | ")})`,
    );
  }

  const links = extractLinks(raw, statusSource);
  return {
    ok: true,
    record: {
      number,
      slug,
      title,
      status,
      date: extractDate(raw, statusSource.style),
      supersedes: links.supersedes,
      superseded_by: links.supersededBy,
      path: relPath,
      filename,
      style: statusSource.style,
    },
  };
}

/** First `# ` heading, with any `ADR NNNN —` / `ADR-NNNN:` prefix stripped. */
function extractTitle(raw: string): string | null {
  const match = raw.match(/^#\s+(.+?)\s*$/m);
  if (!match?.[1]) return null;
  const stripped = match[1].replace(/^ADR[-\s]?\d+\s*[—–:-]\s*/i, "").trim();
  return stripped || match[1];
}

interface StatusSource {
  style: AdrHeaderStyle;
  /** The raw status text — a table cell or the `## Status` section body. */
  text: string;
}

function extractStatusSource(raw: string): StatusSource | null {
  const cell = tableCell(raw, "Status");
  if (cell !== null) return { style: "table", text: cell };
  const section = headingSection(raw, "Status");
  if (section !== null) return { style: "heading", text: section };
  return null;
}

/** The value cell of a `| <field> | <value> |` header-table row. */
function tableCell(raw: string, field: string): string | null {
  const match = raw.match(tableRowRe(field));
  return match?.[1] !== undefined ? match[1].trim() : null;
}

/**
 * A `| <field> | <value> |` row. Trailing whitespace is spaces/tabs only —
 * `\s*$` would swallow the newline (and the blank line after the table),
 * corrupting replacements and insert positions.
 */
function tableRowRe(field: string): RegExp {
  return new RegExp(`^\\|\\s*${field}\\s*\\|(.*)\\|[ \\t]*$`, "im");
}

/** Body of a `## <name>` section (up to the next heading), trimmed. */
function headingSection(raw: string, name: string): string | null {
  const re = new RegExp(`^##\\s+${name}\\s*$\\n([\\s\\S]*?)(?=^#{1,2}\\s|\\n*$(?![\\s\\S]))`, "im");
  const match = raw.match(re);
  return match?.[1] !== undefined ? match[1].trim() : null;
}

/**
 * Map decorated status text onto the closed vocabulary: markdown emphasis is
 * stripped, then the text must *start with* one of the five values
 * (`Superseded by ADR-0031 …` → `superseded`).
 */
function normalizeStatus(text: string): AdrStatus | null {
  const plain = text.replace(/[*_]/g, "").trim().toLowerCase();
  for (const status of ADR_STATUSES) {
    if (plain.startsWith(status)) return status;
  }
  return null;
}

function extractDate(raw: string, style: AdrHeaderStyle): string | null {
  const source = style === "table" ? tableCell(raw, "Date") : headingSection(raw, "Date");
  const match = source?.match(ISO_DATE_RE);
  return match ? match[0] : null;
}

/** Every `ADR-NNNN`-style reference in a text, deduplicated, in order. */
export function adrRefs(text: string): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(ADR_REF_RE)) {
    const n = Number(match[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function extractLinks(
  raw: string,
  statusSource: StatusSource,
): { supersedes: number[]; supersededBy: number[] } {
  if (statusSource.style === "table") {
    return {
      supersedes: adrRefs(tableCell(raw, "Supersedes") ?? ""),
      // The status cell itself may carry the pointer (`**Superseded** by [ADR-0031](…)`).
      supersededBy: adrRefs(
        `${tableCell(raw, "Superseded by") ?? ""} ${refsIfSuperseded(statusSource.text)}`,
      ),
    };
  }
  // Heading style: links live as lines inside the Status section
  // (`Supersedes ADR-0002`, `Superseded by ADR-0031`).
  const supersedes: number[] = [];
  const supersededBy: number[] = [];
  for (const line of statusSource.text.split("\n")) {
    if (/superseded\s+by/i.test(line)) supersededBy.push(...adrRefs(line));
    else if (/supersedes/i.test(line)) supersedes.push(...adrRefs(line));
  }
  return { supersedes: dedupe(supersedes), supersededBy: dedupe(supersededBy) };
}

function refsIfSuperseded(statusText: string): string {
  return /superseded/i.test(statusText) ? statusText : "";
}

function dedupe(numbers: number[]): number[] {
  return [...new Set(numbers)];
}

function compact(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}…` : oneLine;
}

// ── corpus read ───────────────────────────────────────────────────────────

/**
 * Read every `NNNN-*.md` record under the corpus directory. Non-record files
 * (README.md, templates) are skipped silently; a record file the parser cannot
 * read lands in `malformed` with a per-file reason. A missing directory is an
 * empty corpus. Records sort by number.
 */
export function readAdrCorpus(dir: AdrDirResolution): AdrCorpus {
  if (!existsSync(dir.abs)) return { records: [], malformed: [] };

  const records: AdrRecordData[] = [];
  const malformed: MalformedAdr[] = [];
  for (const filename of readdirSync(dir.abs).sort()) {
    if (!FILENAME_RE.test(filename)) continue;
    const raw = readFileSync(join(dir.abs, filename), "utf8");
    const parsed = parseAdrFile(raw, filename, posix.join(dir.rel, filename));
    if (parsed.ok) records.push(parsed.record);
    else malformed.push(parsed.malformed);
  }
  records.sort((a, b) => a.number - b.number || a.filename.localeCompare(b.filename));
  return { records, malformed };
}

/** Highest number anywhere in the corpus (malformed files hold their numbers too) + 1. */
export function nextAdrNumber(corpus: AdrCorpus): number {
  const numbers = [
    ...corpus.records.map((r) => r.number),
    ...corpus.malformed.map((m) => m.number ?? 0),
  ];
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

/** Zero-pad to the house width (4), widening only for 10000+. */
export function formatAdrId(number: number): string {
  return String(number).padStart(4, "0");
}

// ── readiness checks (the `accept` gate + audit lint) ─────────────────────

/**
 * Drop fenced blocks and inline code spans — content inside code is
 * illustrative, not part of the decision graph, so neither the placeholder
 * lint nor the cross-reference lint may read it. Inline spans may cross soft
 * line breaks (CommonMark), so the span pattern admits newlines.
 */
export function stripCodeSpans(raw: string): string {
  return raw.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
}

/**
 * `{…}` template placeholders outside code, so JSON/TS examples never
 * false-positive (the whole house corpus is brace-clean under this rule).
 */
export function findPlaceholders(raw: string): string[] {
  return (stripCodeSpans(raw).match(/\{[^{}\n]*\}/g) ?? []).map(compact);
}

const REQUIRED_SECTIONS = ["Context", "Decision", "Consequences"] as const;

/**
 * Required-section check for the `accept` gate. Prefix match keeps it tolerant
 * of MADR variants ("Context and Problem Statement", "Decision Outcome").
 */
export function missingSections(raw: string): string[] {
  const headings = [...raw.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => (m[1] ?? "").toLowerCase());
  return REQUIRED_SECTIONS.filter(
    (name) => !headings.some((h) => h.startsWith(name.toLowerCase())),
  );
}

// ── surgical header mutations ─────────────────────────────────────────────

export type AdrMutation = { ok: true; text: string } | { ok: false; error: string };

/**
 * Stamp `accepted` + date into a record's own header style. Table style
 * rewrites the Status and Date cells; heading style rewrites the Status
 * section body (and the Date section when one exists). Prose is untouched.
 */
export function stampAccepted(raw: string, style: AdrHeaderStyle, date: string): AdrMutation {
  if (style === "table") {
    const withStatus = replaceTableCell(raw, "Status", "**Accepted**");
    if (!withStatus) return { ok: false, error: "no `| Status | … |` row to stamp" };
    return { ok: true, text: replaceTableCell(withStatus, "Date", date) ?? withStatus };
  }
  const withStatus = replaceHeadingSection(raw, "Status", "Accepted");
  if (!withStatus) return { ok: false, error: "no `## Status` section to stamp" };
  return { ok: true, text: replaceHeadingSection(withStatus, "Date", date) ?? withStatus };
}

/**
 * Flip a record to `superseded`, pointing at its successor — the only edit a
 * superseded record ever receives (ADR-0027: content is never touched). Table
 * style also fills the `Superseded by` row (inserting one under Status when
 * the table lacks it); heading style rewrites the Status section body.
 */
export function flipSuperseded(
  raw: string,
  style: AdrHeaderStyle,
  successor: { number: number; filename: string },
): AdrMutation {
  const link = `[ADR-${formatAdrId(successor.number)}](${successor.filename})`;
  if (style === "table") {
    const withStatus = replaceTableCell(raw, "Status", `**Superseded** by ${link}`);
    if (!withStatus) return { ok: false, error: "no `| Status | … |` row to flip" };
    const withLink =
      replaceTableCell(withStatus, "Superseded by", link) ??
      insertTableRowAfter(withStatus, "Status", "Superseded by", link);
    return { ok: true, text: withLink ?? withStatus };
  }
  const withStatus = replaceHeadingSection(raw, "Status", `Superseded by ${link}`);
  if (!withStatus) return { ok: false, error: "no `## Status` section to flip" };
  return { ok: true, text: withStatus };
}

/**
 * Record the `Supersedes` link on a successor. Table style fills the
 * `Supersedes` row (inserting one when missing, appending when it already
 * links elsewhere); heading style appends a `Supersedes …` line to the Status
 * section. Idempotent when the link is already present.
 */
export function linkSupersedes(
  raw: string,
  style: AdrHeaderStyle,
  predecessor: { number: number; filename: string },
): AdrMutation {
  const link = `[ADR-${formatAdrId(predecessor.number)}](${predecessor.filename})`;
  if (style === "table") {
    const cell = tableCell(raw, "Supersedes");
    if (cell !== null) {
      if (adrRefs(cell).includes(predecessor.number)) return { ok: true, text: raw };
      const value = cell === "" || cell === "—" || cell === "-" ? link : `${cell}, ${link}`;
      const text = replaceTableCell(raw, "Supersedes", value);
      return text ? { ok: true, text } : { ok: false, error: "could not rewrite Supersedes row" };
    }
    const inserted = insertTableRowAfter(raw, "Status", "Supersedes", link);
    return inserted
      ? { ok: true, text: inserted }
      : { ok: false, error: "no header table to hold the Supersedes link" };
  }
  const section = headingSection(raw, "Status");
  if (section === null) return { ok: false, error: "no `## Status` section to hold the link" };
  if (adrRefs(section).includes(predecessor.number)) return { ok: true, text: raw };
  const text = replaceHeadingSection(raw, "Status", `${section}\n\nSupersedes ${link}`);
  return text
    ? { ok: true, text }
    : { ok: false, error: "could not rewrite the `## Status` section" };
}

function replaceTableCell(raw: string, field: string, value: string): string | null {
  const re = tableRowRe(field);
  const match = raw.match(re);
  if (!match || match.index === undefined) return null;
  const prefix = match[0].slice(0, match[0].indexOf("|", 1) + 1);
  return (
    raw.slice(0, match.index) + `${prefix} ${value} |` + raw.slice(match.index + match[0].length)
  );
}

function insertTableRowAfter(
  raw: string,
  afterField: string,
  field: string,
  value: string,
): string | null {
  const match = raw.match(tableRowRe(afterField));
  if (!match || match.index === undefined) return null;
  const lineEnd = match.index + match[0].length;
  return `${raw.slice(0, lineEnd)}\n| ${field} | ${value} |${raw.slice(lineEnd)}`;
}

function replaceHeadingSection(raw: string, name: string, body: string): string | null {
  const re = new RegExp(
    `^(##\\s+${name}\\s*$\\n)([\\s\\S]*?)(?=^#{1,2}\\s|\\n*$(?![\\s\\S]))`,
    "im",
  );
  if (!re.test(raw)) return null;
  // `\s*$` may have swallowed the blank line after the heading — normalize to
  // exactly one blank line between the heading and the new body.
  return raw.replace(re, (_m, heading: string) => `${heading.trimEnd()}\n\n${body}\n\n`);
}

// ── record creation ───────────────────────────────────────────────────────

/**
 * House-format (table-style) skeleton for a supersede successor. Lands
 * `proposed` and deliberately carries `{…}` placeholders so the `accept`
 * readiness gate refuses it until the sections are actually written.
 */
export function renderAdrSkeleton(opts: {
  number: number;
  title: string;
  date: string;
  supersedes: { number: number; filename: string };
}): string {
  const old = `[ADR-${formatAdrId(opts.supersedes.number)}](${opts.supersedes.filename})`;
  return [
    `# ADR ${formatAdrId(opts.number)} — ${opts.title}`,
    "",
    "| Field         | Value |",
    "| ------------- | ----- |",
    "| Status        | **Proposed** |",
    `| Date          | ${opts.date} |`,
    `| Supersedes    | ${old} |`,
    "| Superseded by | — |",
    "| Related       | — |",
    "",
    "## Context",
    "",
    "{Why does the superseded decision no longer hold? What changed?}",
    "",
    "## Decision",
    "",
    "{State the new decision and its rationale.}",
    "",
    "## Consequences",
    "",
    "{Positive, negative, accepted trade-offs.}",
    "",
  ].join("\n");
}

/**
 * Crash-safe write (the kanban pattern): land the bytes next to the target,
 * then rename over it — readers see the old record or the new one, never a
 * torn half-write. The temp name never matches `NNNN-*.md`, so a crash
 * leftover is invisible to `readAdrCorpus`.
 */
export function writeAdrFileAtomic(path: string, data: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

// ── corpus index (managed markers) ────────────────────────────────────────

export const INDEX_START = "<!-- marvin:adr-index:start -->";
export const INDEX_END = "<!-- marvin:adr-index:end -->";

export type AdrIndexSource = "config" | "detected";

export interface AdrIndexTarget {
  abs: string;
  rel: string;
  source: AdrIndexSource;
}

/**
 * Where the managed corpus index lives: `adr.index_file` when configured,
 * else an existing `README.md` inside the corpus directory, else nowhere
 * (the `index` action skips gracefully, the audit stays silent).
 */
export function resolveIndexTarget(
  projectDir: string,
  dir: AdrDirResolution,
  adrConfig?: AdrConfig,
): AdrIndexTarget | null {
  if (adrConfig?.index_file) {
    const abs = isAbsolute(adrConfig.index_file)
      ? adrConfig.index_file
      : join(projectDir, adrConfig.index_file);
    return {
      abs,
      rel: toPosix(relative(projectDir, abs)) || adrConfig.index_file,
      source: "config",
    };
  }
  const abs = join(dir.abs, "README.md");
  if (existsSync(abs)) {
    return { abs, rel: posix.join(dir.rel, "README.md"), source: "detected" };
  }
  return null;
}

const STATUS_LABEL: Record<AdrStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  deprecated: "Deprecated",
  superseded: "Superseded",
  rejected: "Rejected",
};

/**
 * The generated block between the managed markers: one table row per record,
 * links relative to the index file's own directory.
 */
export function renderIndexBlock(
  corpus: AdrCorpus,
  dir: AdrDirResolution,
  indexAbs: string,
): string {
  const lines = ["| ADR | Title | Status | Date |", "| --- | ----- | ------ | ---- |"];
  for (const r of corpus.records) {
    const href = toPosix(relative(dirname(indexAbs), join(dir.abs, r.filename)));
    const status = r.superseded_by.length
      ? `Superseded by ${r.superseded_by.map((n) => `ADR-${formatAdrId(n)}`).join(", ")}`
      : STATUS_LABEL[r.status];
    lines.push(
      `| [${formatAdrId(r.number)}](${href}) | ${r.title} | ${status} | ${r.date ?? "—"} |`,
    );
  }
  return lines.join("\n");
}

/** The current content between the markers, or null when the file has none. */
export function readManagedBlock(text: string): string | null {
  const start = text.indexOf(INDEX_START);
  const end = text.indexOf(INDEX_END);
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start + INDEX_START.length, end).replace(/^\n+|\n+$/g, "");
}

export type IndexWrite = { action: "created" | "replaced" | "appended"; text: string };

/**
 * Splice the generated block into the index file's managed region. Markers
 * present → replace between them (hand-written prose around the block
 * survives); no markers → append the managed block; no file → a minimal new
 * document. Returns what to write plus which of the three happened.
 */
export function spliceIndex(existing: string | null, block: string): IndexWrite {
  const managed = `${INDEX_START}\n\n${block}\n\n${INDEX_END}`;
  if (existing === null) {
    return { action: "created", text: `# Architecture Decision Records\n\n${managed}\n` };
  }
  if (readManagedBlock(existing) !== null) {
    const start = existing.indexOf(INDEX_START);
    const end = existing.indexOf(INDEX_END) + INDEX_END.length;
    return { action: "replaced", text: existing.slice(0, start) + managed + existing.slice(end) };
  }
  const joiner = existing.endsWith("\n") ? "\n" : "\n\n";
  return { action: "appended", text: `${existing}${joiner}${managed}\n` };
}
