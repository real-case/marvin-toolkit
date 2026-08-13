import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type {
  AuditReport as AuditReportContract,
  ChecksSummary,
  ReportEnvelope,
  ReportFinding,
  ReportGroup,
} from "@marvin-toolkit/mcp-shared/contracts";

/**
 * Report-envelope assembly for the `report` tool (docs/design/reports-widget.md).
 * Scans the four `.marvin/` families and maps every generated document into the
 * shared `ReportEnvelope` contract — security scans through the existing
 * `audit-report` block parsing (extracted here from `storage/security.ts` so the
 * two tools share one parser), refactor registers/plans, task specs +
 * `verification.md`, and handoffs through thin best-effort parsers.
 *
 * It is also the home of the two typed-block codecs the rest of the server
 * shares: `audit-report` (written by the `sec-*` skills, read by `audit` and
 * `report`) and `verify-result` (written by `verify`, read back by its own
 * delivery gate, by `summary`, and by `report`). Both live here for the same
 * reason — the readers must not each re-derive the format from a copied regex.
 *
 * This module is deliberately self-contained (node builtins + zod + type-only
 * contract imports, no sibling imports) so its pure parsers can be unit-tested
 * directly against tmp-dir fixtures without a server build.
 */

// ── the audit-report block parser (shared with storage/security.ts) ──────────

/**
 * Runtime mirror of the `AuditReport` contract (`contracts/audit.ts`). The
 * contract type is imported type-only; the zod schema is re-declared so the
 * server never takes a runtime dependency on the contracts package (the
 * `storage/schema.ts` split). The two must stay in lockstep field-for-field.
 */
const Severity = z.enum(["critical", "high", "medium", "low", "info"]);
type SeverityValue = z.infer<typeof Severity>;

const AuditKind = z.enum([
  "scan",
  "secrets",
  "deps",
  "iac",
  "ci",
  "threat-model",
  "compliance",
  "pentest",
]);

const LinkRefSchema = z.object({
  kind: z.enum(["pr", "tracker", "adr", "spec", "branch", "commit", "external"]),
  label: z.string().min(1),
  url: z.string().url().optional(),
  ref: z.string().optional(),
});

const FindingSchema = z.object({
  id: z.string(),
  severity: Severity,
  title: z.string().min(1),
  category: z.string(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  evidence: z.string().optional(),
  remediation: z.string().optional(),
  links: z.array(LinkRefSchema).optional(),
});

/** Runtime mirror of the `AuditReport` contract (`contracts/audit.ts`). */
export const AuditReportSchema = z.object({
  kind: AuditKind,
  scanned_at: z.string().datetime(),
  target: z.string().optional(),
  summary: z.record(Severity, z.number().int().nonnegative()),
  findings: z.array(FindingSchema),
});

export type AuditBlockParse =
  | { kind: "ok"; report: AuditReportContract }
  | { kind: "none" }
  | { kind: "invalid"; reason: string };

/**
 * Classify one `sec-*` report's Tier-2 block (ADR-0024 #7): `ok` with the typed
 * report, `none` when the file carries no ` ```json audit-report ` block (a
 * valid legacy prose report), `invalid` when a block is present but broken.
 */
export function parseAuditBlock(raw: string): AuditBlockParse {
  const m = raw.match(/```json audit-report\n([\s\S]*?)\n```/);
  if (!m) return { kind: "none" };

  let json: unknown;
  try {
    json = JSON.parse(m[1]!);
  } catch {
    return { kind: "invalid", reason: "audit-report block is not valid JSON" };
  }

  const parsed = AuditReportSchema.safeParse(json);
  if (!parsed.success) {
    return { kind: "invalid", reason: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  return { kind: "ok", report: parsed.data as AuditReportContract };
}

// ── the verify-result block: one writer, three readers ──────────────────────

/**
 * The machine-readable block `verify` appends to its output and persists in
 * `.marvin/task/verification.md` (ADR-0002), read back by the delivery gate
 * (ADR-0012), the `summary` aggregator (ADR-0024 #3) and the `report` scan.
 *
 * The tag is declared once and the fence pattern is derived from it, so the
 * writer and the readers cannot disagree about what they are looking for.
 */
export const VERIFY_BLOCK_TAG = "verify-result";
const VERIFY_BLOCK_RE = new RegExp("```json " + VERIFY_BLOCK_TAG + "\\n([\\s\\S]*?)\\n```");

/**
 * One gate entry. `status` is `pass | fail | error` as `verify` writes it, but
 * stays a free-form string on read: the readers classify it themselves, and an
 * unknown status must not invalidate a whole run's artifact.
 */
const VerifyGateSchema = z.object({
  name: z.string(),
  status: z.string().optional(),
  code: z.number().nullable().optional().catch(null),
  durationMs: z.number().optional().catch(undefined),
});
export type VerifyGate = z.infer<typeof VerifyGateSchema>;

/**
 * Runtime mirror of the `Provenance` contract (`contracts/provenance.ts`),
 * declared locally for the same reason `AuditReportSchema` is: this module takes
 * no runtime dependency on the contracts package. The two must stay in lockstep
 * field-for-field — a double edit whenever the contract changes, and the price
 * of keeping these parsers unit-testable without a server build.
 */
const ProvenanceSchema = z.object({
  head_sha: z.string().nullable(),
  branch: z.string().nullable(),
  dirty: z.boolean().nullable(),
  worktree_digest: z.string().nullable(),
  generated_at: z.string(),
});

/**
 * Exactly two things make a block unreadable: it is not JSON, or it is not a
 * JSON object. Every *field* degrades on its own (`.catch`) instead of
 * invalidating the block, because the three readers consume different subsets —
 * the delivery gate reads only `verdict`, `report` reads only `gates` — and one
 * reader's garbage must not deny another reader the field it came for. The gate
 * decision on a half-corrupt artifact therefore stays what it has always been.
 *
 * `gates` is parsed as an unknown array and filtered entry-by-entry below: a
 * single malformed entry drops that entry, it does not discard the run.
 */
const VerifyResultSchema = z.object({
  verdict: z.string().optional().catch(undefined),
  gates: z.array(z.unknown()).optional().catch(undefined),
  detectedStacks: z.array(z.string()).optional().catch(undefined),
  warnings: z.array(z.string()).optional().catch(undefined),
  wallClockMs: z.number().optional().catch(undefined),
  sumOfGatesMs: z.number().optional().catch(undefined),
  artifactPath: z.string().nullable().optional().catch(null),
  // Optional on read so every artifact written before ADR-0035 still parses, and
  // `.catch(undefined)` like every other member so a corrupt provenance degrades
  // alone — a freshness field must never cost a reader the verdict it came for.
  provenance: ProvenanceSchema.optional().catch(undefined),
});

/** The block's payload. `verdict` is optional on read only — see {@link formatVerifyBlock}. */
export interface VerifyResult extends Omit<z.infer<typeof VerifyResultSchema>, "gates"> {
  gates: VerifyGate[];
}

/** What a writer must supply: a run always computes a verdict. */
export type VerifyResultWrite = VerifyResult & { verdict: string };

/**
 * `none` — no block at all (prose-only artifact, or a run that wrote none);
 * `invalid` — a block is present but unreadable, with a reason fit for a user;
 * `ok` — a usable payload. `gatesDeclared` reports whether the block itself
 * carried a `gates` array, which the always-an-array `result` would otherwise
 * hide: the `report` scan requires one (a verdict-only block is not a check
 * list), while `summary` tolerates its absence. Additive fields belong on
 * `result`.
 */
export type VerifyBlockParse =
  | { kind: "none" }
  | { kind: "invalid"; reason: string }
  | { kind: "ok"; result: VerifyResult; gatesDeclared: boolean };

/** Classify the `verify-result` block of one artifact. */
export function parseVerifyBlock(raw: string): VerifyBlockParse {
  const m = raw.match(VERIFY_BLOCK_RE);
  if (!m) return { kind: "none" };

  let json: unknown;
  try {
    json = JSON.parse(m[1]!);
  } catch {
    return { kind: "invalid", reason: `${VERIFY_BLOCK_TAG} block is not valid JSON` };
  }

  const parsed = VerifyResultSchema.safeParse(json);
  if (!parsed.success) {
    const reason = parsed.error.issues.map((i) => i.message).join("; ");
    return { kind: "invalid", reason: `${VERIFY_BLOCK_TAG} block is malformed: ${reason}` };
  }

  const { gates, ...rest } = parsed.data;
  return {
    kind: "ok",
    result: { ...rest, gates: (gates ?? []).flatMap(coerceGate) },
    gatesDeclared: Array.isArray((json as { gates?: unknown }).gates),
  };
}

/** Keep a gate entry only if it is at least a named object; drop it otherwise. */
function coerceGate(entry: unknown): VerifyGate[] {
  const parsed = VerifyGateSchema.safeParse(entry);
  return parsed.success ? [parsed.data] : [];
}

/**
 * Render the block a `verify` run appends to its report. The field order is
 * fixed here rather than taken from the caller's object literal, so the
 * artifact's shape is a property of this module and not of its call site.
 */
export function formatVerifyBlock(result: VerifyResultWrite): string {
  const payload = {
    verdict: result.verdict,
    gates: result.gates,
    detectedStacks: result.detectedStacks,
    warnings: result.warnings,
    wallClockMs: result.wallClockMs,
    sumOfGatesMs: result.sumOfGatesMs,
    artifactPath: result.artifactPath,
    // Appended last on purpose: every artifact written before ADR-0035 keeps a
    // byte-identical prefix, which keeps a `verification.md` diff readable.
    provenance: result.provenance,
  };
  return "```json " + VERIFY_BLOCK_TAG + "\n" + JSON.stringify(payload) + "\n```";
}

// ── shared plumbing ──────────────────────────────────────────────────────────

/** One skipped file, surfaced as a one-line note in the tool's text fallback. */
export interface ScanNote {
  file: string;
  reason: string;
}

export interface GroupScan {
  reports: ReportEnvelope[];
  notes: ScanNote[];
}

interface ScanOptions {
  /** Project-relative label for ids/paths, e.g. `.marvin/security`. */
  relDir?: string;
  /** Clock override for staleness math (tests). */
  now?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Freshness window for scan-type reports (design doc, rule fixed server-side). */
export const STALE_AFTER_DAYS = 7;

/**
 * Server-side staleness verdict: security and refactor reports decay after
 * {@link STALE_AFTER_DAYS}; specs, handoffs and verification never go stale —
 * their recency meaning is carried by the age display instead.
 */
export function isStale(group: ReportGroup, mtimeMs: number, nowMs: number): boolean {
  if (group !== "security" && group !== "refactor") return false;
  return nowMs - mtimeMs > STALE_AFTER_DAYS * DAY_MS;
}

interface MdFile {
  filename: string;
  raw: string;
  mtimeMs: number;
}

/** Read every `.md` in a directory; unreadable dir/file degrades to empty/skip. */
function readMdFiles(dir: string, notes: ScanNote[]): MdFile[] {
  if (!existsSync(dir)) return [];
  let filenames: string[];
  try {
    filenames = readdirSync(dir).sort();
  } catch {
    return []; // an unreadable directory counts as empty — the zero-state doctrine
  }
  const files: MdFile[] = [];
  for (const filename of filenames) {
    if (!filename.endsWith(".md")) continue;
    try {
      const path = join(dir, filename);
      // Symlinked entries are skipped outright: a planted link under .marvin
      // must not pull out-of-tree file content into structuredContent.
      if (lstatSync(path).isSymbolicLink()) continue;
      files.push({ filename, raw: readFileSync(path, "utf8"), mtimeMs: statSync(path).mtimeMs });
    } catch {
      notes.push({ file: filename, reason: "file could not be read" });
    }
  }
  return files;
}

/** First `# ` heading of a markdown body, or null. */
function firstHeading(text: string): string | null {
  const m = text.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1]! : null;
}

/** Minimal frontmatter split (mirrors `storage/frontmatter.ts` semantics). */
function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  if (!text.startsWith("---\n")) return { frontmatter: "", body: text };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: "", body: text };
  const after = text.slice(end + 4);
  return {
    frontmatter: text.slice(4, end),
    body: after.startsWith("\n") ? after.slice(1) : after,
  };
}

/** A flat `key: value` scalar out of a frontmatter block, best-effort. */
function frontmatterValue(frontmatter: string, key: string): string | null {
  const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  if (!m) return null;
  return m[1]!.replace(/^["']|["']$/g, "") || null;
}

/** Filename → fallback title: strip the `NNN-` prefix and `.md`, keep the slug. */
function slugTitle(filename: string): string {
  return filename.replace(/\.md$/, "").replace(/^\d+-/, "");
}

/** Sum the four chip severities over a finding list (info stays body-only). */
function findingCounts(findings: ReportFinding[]): {
  critical: number;
  high: number;
  medium: number;
  low: number;
} {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (f.severity !== "info") counts[f.severity] += 1;
  }
  return counts;
}

function checksSummary(checks: { status: "pass" | "fail" | "pending" }[]): ChecksSummary {
  return {
    kind: "checks",
    done: checks.filter((c) => c.status === "pass").length,
    total: checks.length,
    failed: checks.filter((c) => c.status === "fail").length,
  };
}

// ── security: .marvin/security/*.md via the audit-report block ──────────────

const SEC_TITLES: Record<z.infer<typeof AuditKind>, string> = {
  scan: "Security scan",
  secrets: "Secrets scan",
  deps: "Dependency audit",
  iac: "IaC review",
  ci: "CI/CD audit",
  "threat-model": "Threat model",
  compliance: "Compliance check",
  pentest: "Pentest checklist",
};

export function scanSecurityReports(dir: string, opts: ScanOptions = {}): GroupScan {
  const relDir = opts.relDir ?? ".marvin/security";
  const now = opts.now ?? Date.now();
  const notes: ScanNote[] = [];
  const reports: ReportEnvelope[] = [];

  for (const file of readMdFiles(dir, notes)) {
    const parsed = parseAuditBlock(file.raw);
    if (parsed.kind === "none") continue; // legacy prose report — not malformed
    if (parsed.kind === "invalid") {
      notes.push({ file: file.filename, reason: parsed.reason });
      continue;
    }

    const report = parsed.report;
    const command = `sec-${report.kind}`;
    const findings: ReportFinding[] = report.findings.map((f) => ({
      ...f,
      fixCommand: `/marvin:sec-fix ${report.kind} ${f.id}`,
    }));
    const path = `${relDir}/${file.filename}`;
    reports.push({
      id: path,
      group: "security",
      kind: "findings",
      title: SEC_TITLES[report.kind],
      path,
      generatedBy: command,
      generatedAt: new Date(file.mtimeMs).toISOString(),
      stale: isStale("security", file.mtimeMs, now),
      summary: { kind: "findings", counts: findingCounts(findings) },
      body: { findings },
      links: [],
      rerunCommand: `/marvin:${command}`,
    });
  }
  return { reports, notes };
}

// ── refactor: NNN-(audit|smells)-*.md registers, NNN-plan-*.md as checks ────

const EFFORT_MAP: Record<string, "S" | "M" | "L"> = {
  trivial: "S",
  small: "S",
  medium: "M",
  large: "L",
};

/**
 * Best-effort parse of an ADR-0029 findings-register table: rows shaped
 * `| F<n> | title | severity | effort | evidence | direction |`. Rows whose
 * severity is not in the shared vocabulary are dropped, not fatal.
 */
export function parseRegisterFindings(raw: string): ReportFinding[] {
  const findings: ReportFinding[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^\|\s*(F\d+)\s*\|(.*)\|\s*$/);
    if (!m) continue;
    // Split on unescaped pipes only: markdown writes a literal "|" inside a
    // cell as "\|" (routine in evidence carrying union types or "||"), so a
    // bare split would shift every column after it. Unescape once split.
    const cells = m[2]!.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
    if (cells.length < 5) continue;
    const [title, severityRaw, effortRaw, evidenceRaw, direction] = cells as [
      string,
      string,
      string,
      string,
      string,
    ];
    const severity = Severity.safeParse(severityRaw.toLowerCase());
    if (!severity.success || !title) continue;

    const evidence = evidenceRaw.replace(/`/g, "").trim();
    const loc = evidence.match(/([\w./-]+\.[A-Za-z]+)(?::(\d+))?/);
    const line_ = loc?.[2] ? Number(loc[2]) : undefined;
    const effort = EFFORT_MAP[effortRaw.toLowerCase()];
    findings.push({
      id: m[1]!,
      severity: severity.data as SeverityValue,
      title,
      ...(loc?.[1] ? { file: loc[1] } : {}),
      ...(line_ && line_ > 0 ? { line: line_ } : {}),
      ...(evidence ? { evidence } : {}),
      ...(effort ? { effort } : {}),
      ...(direction ? { direction } : {}),
    });
  }
  return findings;
}

/**
 * Best-effort parse of a refactor plan's steps: `### Step N — <title> [status]`
 * headings, `[pending]`-born, flipped to `[done <date>]` / `[blocked]` by
 * refactor-apply. Missing marker reads as pending.
 */
export function parsePlanChecks(
  raw: string,
): { name: string; status: "pass" | "fail" | "pending"; note?: string }[] {
  const checks: { name: string; status: "pass" | "fail" | "pending"; note?: string }[] = [];
  const re = /^###\s+Step\s+\d+\s+—\s+(.+?)(?:\s+\[([^\]]+)\])?\s*$/gm;
  for (const m of raw.matchAll(re)) {
    const marker = (m[2] ?? "pending").trim().toLowerCase();
    const status = marker.startsWith("done")
      ? "pass"
      : marker.startsWith("blocked")
        ? "fail"
        : "pending";
    const note = marker.startsWith("done") && marker.length > 4 ? marker.slice(5) : undefined;
    checks.push({ name: m[1]!.trim(), status, ...(note ? { note } : {}) });
  }
  return checks;
}

export function scanRefactorReports(dir: string, opts: ScanOptions = {}): GroupScan {
  const relDir = opts.relDir ?? ".marvin/refactor";
  const now = opts.now ?? Date.now();
  const notes: ScanNote[] = [];
  const reports: ReportEnvelope[] = [];

  for (const file of readMdFiles(dir, notes)) {
    const register = /^\d+-(audit|smells)-.*\.md$/.exec(file.filename);
    const plan = /^\d+-plan-.*\.md$/.test(file.filename);
    if (!register && !plan) continue; // foreign file — not a report artifact

    const path = `${relDir}/${file.filename}`;
    const heading = firstHeading(file.raw);
    const common = {
      id: path,
      group: "refactor" as const,
      path,
      generatedAt: new Date(file.mtimeMs).toISOString(),
      stale: isStale("refactor", file.mtimeMs, now),
      links: [],
    };

    if (register) {
      const findings = parseRegisterFindings(file.raw);
      if (!heading && findings.length === 0) {
        notes.push({ file: file.filename, reason: "no heading or findings register found" });
        continue;
      }
      const command = `refactor-${register[1]}`;
      reports.push({
        ...common,
        kind: "findings",
        title: heading ?? slugTitle(file.filename),
        generatedBy: command,
        summary: { kind: "findings", counts: findingCounts(findings) },
        body: { findings },
        rerunCommand: `/marvin:${command}`,
      });
    } else {
      const checks = parsePlanChecks(file.raw);
      if (!heading && checks.length === 0) {
        notes.push({ file: file.filename, reason: "no heading or plan steps found" });
        continue;
      }
      reports.push({
        ...common,
        kind: "checks",
        title: heading ?? slugTitle(file.filename),
        generatedBy: "refactor-plan",
        summary: checksSummary(checks),
        body: { checks },
        rerunCommand: "/marvin:refactor-plan",
      });
    }
  }
  return { reports, notes };
}

// ── task: specs as documents, verification.md as checks ─────────────────────

/**
 * The `verify-result` block as a check list. Null means "this file is not a
 * usable verification report" — no block, an unreadable one, or one that never
 * declared `gates`. That last case is the reason this reader consults
 * `gatesDeclared`: the shared schema defaults `gates` to `[]` so `summary` can
 * keep reading a verdict-only block, but a verdict alone is not a check list
 * and must stay skipped here, exactly as before the parser was unified.
 */
export function parseVerificationChecks(
  raw: string,
): { name: string; status: "pass" | "fail" | "pending"; note?: string }[] | null {
  const parse = parseVerifyBlock(raw);
  if (parse.kind !== "ok" || !parse.gatesDeclared) return null;
  return parse.result.gates.map((g) => {
    // `not-run` is a gate whose binary was absent, so nothing ran (ADR-0035);
    // `skip` is honoured but never written by verify. Neither is a failure, and
    // both land on `pending` — the check vocabulary's "no result" member.
    const status =
      g.status === "pass"
        ? "pass"
        : g.status === "skip" || g.status === "not-run"
          ? "pending"
          : "fail";
    const note =
      status === "fail" ? (g.status === "error" ? "errored" : `exit ${g.code ?? "?"}`) : undefined;
    return {
      name: g.name,
      status: status as "pass" | "fail" | "pending",
      ...(note ? { note } : {}),
    };
  });
}

export function scanTaskReports(dir: string, opts: ScanOptions = {}): GroupScan {
  const relDir = opts.relDir ?? ".marvin/task";
  const now = opts.now ?? Date.now();
  const notes: ScanNote[] = [];
  const reports: ReportEnvelope[] = [];

  for (const file of readMdFiles(dir, notes)) {
    const path = `${relDir}/${file.filename}`;
    const common = {
      id: path,
      group: "task" as const,
      path,
      generatedAt: new Date(file.mtimeMs).toISOString(),
      stale: isStale("task", file.mtimeMs, now),
      links: [],
    };

    if (file.filename === "verification.md") {
      const checks = parseVerificationChecks(file.raw);
      if (checks === null) {
        notes.push({ file: file.filename, reason: "no machine-readable verify-result block" });
        continue;
      }
      reports.push({
        ...common,
        kind: "checks",
        title: "Verification",
        generatedBy: "task-verify",
        summary: checksSummary(checks),
        body: { checks },
        rerunCommand: "/marvin:task-verify",
      });
    } else {
      const { frontmatter, body } = splitFrontmatter(file.raw);
      const title =
        firstHeading(body) ?? frontmatterValue(frontmatter, "title") ?? slugTitle(file.filename);
      reports.push({
        ...common,
        kind: "document",
        title,
        generatedBy: "task-start",
        summary: { kind: "document", tag: "spec" },
        body: { markdown: body },
        rerunCommand: "/marvin:task-start",
      });
    }
  }
  return { reports, notes };
}

// ── handoff: .marvin/handoff/*.md as documents ──────────────────────────────

export function scanHandoffReports(dir: string, opts: ScanOptions = {}): GroupScan {
  const relDir = opts.relDir ?? ".marvin/handoff";
  const now = opts.now ?? Date.now();
  const notes: ScanNote[] = [];
  const reports: ReportEnvelope[] = [];

  for (const file of readMdFiles(dir, notes)) {
    const path = `${relDir}/${file.filename}`;
    const { frontmatter, body } = splitFrontmatter(file.raw);
    const title =
      firstHeading(body) ?? frontmatterValue(frontmatter, "objective") ?? slugTitle(file.filename);
    reports.push({
      id: path,
      group: "handoff",
      kind: "document",
      title,
      path,
      generatedBy: "handoff",
      generatedAt: new Date(file.mtimeMs).toISOString(),
      stale: isStale("handoff", file.mtimeMs, now),
      summary: { kind: "document", tag: "handoff" },
      body: { markdown: body },
      links: [],
      rerunCommand: "/marvin:handoff",
    });
  }
  return { reports, notes };
}

// ── the merged list ──────────────────────────────────────────────────────────

export interface ReportDirs {
  security: string;
  refactor: string;
  task: string;
  handoff: string;
}

/**
 * Scan all four groups and merge newest-first (by `generatedAt`, tie-broken by
 * id for determinism). Missing directories mean empty groups, never a throw.
 */
export function buildReportList(
  dirs: ReportDirs,
  opts: { now?: number } = {},
): { reports: ReportEnvelope[]; notes: ScanNote[] } {
  const now = opts.now ?? Date.now();
  const scans = [
    scanSecurityReports(dirs.security, { now }),
    scanRefactorReports(dirs.refactor, { now }),
    scanTaskReports(dirs.task, { now }),
    scanHandoffReports(dirs.handoff, { now }),
  ];
  const reports = scans
    .flatMap((s) => s.reports)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt) || a.id.localeCompare(b.id));
  return { reports, notes: scans.flatMap((s) => s.notes) };
}
