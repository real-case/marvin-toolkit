import {
  HuntSeverity,
  type FindingClaim,
  type FindingLinks,
  type FindingStatus,
  type FlowMap,
  type HuntFinding,
  type HuntRun,
  type LedgerLine,
  type VerdictEntry,
} from "@marvin-toolkit/mcp-shared/contracts";
import { fingerprintFinding } from "./reports.js";

/**
 * The pure half of the bug-hunter ledger (ADR-0054): identity, the fold, the verification
 * protocol's transitions, ranking and the report. No clock and no filesystem — every timestamp
 * and run id arrives as an argument — so each rule is testable on literals and the same ledger
 * and commit always produce the same answer (NFR-04).
 */

// ── identity ──────────────────────────────────────────────────────────────

/**
 * A finding's identity across runs: ADR-0038's fingerprint over a kind that carries the check
 * and class, the primary location, the category and the title slug. Line numbers are excluded
 * for the reason ADR-0038 gives — an insertion above a finding must not mint a new identity.
 */
export function fingerprintClaim(claim: FindingClaim): string {
  const primary = claim.location.files[0]?.path ?? claim.location.route ?? claim.location.component;
  return fingerprintFinding({
    kind: `hunt:${claim.check}:${claim.class}`,
    file: primary,
    category: claim.category,
    title: claim.title,
  });
}

/**
 * `BH-` plus the first eight hex digits of the fingerprint. Derived, never allocated: a counter
 * would let two branches each mint the next number for different findings, and after the merge
 * the fold would keep only one of them. Should two fingerprints in one ledger share eight digits,
 * the id grows two digits at a time until it is unique.
 */
export function idForFingerprint(fingerprint: string, taken?: Map<string, string>): string {
  for (let n = 8; n <= fingerprint.length; n += 2) {
    const id = `BH-${fingerprint.slice(0, n)}`;
    const owner = taken?.get(id);
    if (owner === undefined || owner === fingerprint) return id;
  }
  return `BH-${fingerprint}`;
}

// ── fold ──────────────────────────────────────────────────────────────────

/** Two `finding` lines that claim one id for different fingerprints (a merged ledger, TRI-01). */
export interface IdConflict {
  id: string;
  kept: string;
  dropped: string;
}

export interface LedgerState {
  findings: Map<string, HuntFinding>;
  byFingerprint: Map<string, string>;
  /** Never resolved silently: the first line keeps the id and the conflict is reported. */
  conflicts: IdConflict[];
}

function mergeLinks(base: FindingLinks, patch: Partial<FindingLinks>): FindingLinks {
  const related = patch.related ? [...new Set([...base.related, ...patch.related])] : base.related;
  return { ...base, ...patch, related };
}

/**
 * Apply the ledger lines in order. An event for an unknown id is ignored, never invented.
 *
 * A merged ledger can hold the same finding twice, when two branches each recorded it: the same
 * id and the same fingerprint. The second line is then a sighting of the first, not a new
 * finding. A second line with the same id and a DIFFERENT fingerprint never overwrites; it is
 * reported in `conflicts`.
 */
export function foldLedger(lines: LedgerLine[]): LedgerState {
  const findings = new Map<string, HuntFinding>();
  const byFingerprint = new Map<string, string>();
  const conflicts: IdConflict[] = [];
  for (const line of lines) {
    if (line.type === "finding") {
      const incoming = line.finding;
      const prior = findings.get(incoming.id);
      if (prior && prior.fingerprint !== incoming.fingerprint) {
        conflicts.push({
          id: incoming.id,
          kept: prior.fingerprint,
          dropped: incoming.fingerprint,
        });
        continue;
      }
      if (prior) {
        findings.set(prior.id, {
          ...prior,
          last_seen_run: incoming.last_seen_run,
          head_sha: incoming.head_sha,
          updated_at: line.at,
        });
        continue;
      }
      findings.set(incoming.id, incoming);
      if (!byFingerprint.has(incoming.fingerprint)) {
        byFingerprint.set(incoming.fingerprint, incoming.id);
      }
      continue;
    }
    const f = findings.get(line.id);
    if (!f) continue;
    switch (line.type) {
      case "verdict": {
        const v = line.verdict;
        const reproduction =
          v.stage === "prove" && (v.test_path || v.scenario)
            ? {
                ...f.reproduction,
                ...(v.test_path ? { test_path: v.test_path } : {}),
                ...(v.scenario ? { scenario: v.scenario } : {}),
              }
            : f.reproduction;
        findings.set(f.id, {
          ...f,
          reproduction,
          verdicts: [...f.verdicts, v],
          updated_at: line.at,
        });
        break;
      }
      case "status":
        findings.set(f.id, {
          ...f,
          status: line.status,
          ...(line.status === "confirmed" ? { confidence: "confirmed" as const } : {}),
          updated_at: line.at,
        });
        break;
      case "link":
        findings.set(f.id, { ...f, links: mergeLinks(f.links, line.links), updated_at: line.at });
        break;
      case "seen":
        findings.set(f.id, {
          ...f,
          last_seen_run: line.run_id,
          head_sha: line.head_sha,
          updated_at: line.at,
        });
        break;
    }
  }
  return { findings, byFingerprint, conflicts };
}

// ── record ────────────────────────────────────────────────────────────────

export type RecordOutcome =
  | { outcome: "new"; id: string; fingerprint: string; note?: string }
  | { outcome: "duplicate"; id: string; fingerprint: string; status: FindingStatus; note?: string }
  | { outcome: "suppressed"; id: string; fingerprint: string; status: FindingStatus }
  | { outcome: "regressed"; id: string; fingerprint: string };

export interface RecordContext {
  runId: string;
  headSha: string | null;
  now: string;
}

/** The last `human` ruling on a finding, if a person has ruled. */
export function lastHumanVerdict(f: HuntFinding): VerdictEntry | undefined {
  return [...f.verdicts].reverse().find((v) => v.stage === "human");
}

/**
 * Whether a PERSON closed the finding, so a sighting is suppressed (NFR-08, ADR-0054 §3):
 * `wont-fix`, or `rejected` by a human `reject`. A rejection by the referee or by a green test
 * is an agent's call; a later sighting is recorded and a person can still reopen it.
 */
export function closedByHuman(f: HuntFinding): boolean {
  if (f.status === "wont-fix") return true;
  return f.status === "rejected" && lastHumanVerdict(f)?.ruling === "reject";
}

/**
 * Turn claims into ledger lines. A claim whose fingerprint is already in the ledger is not a new
 * finding (TRI-01, TRI-05): a sighting of an open one is a `seen` event, of a human-closed one is
 * suppressed, and of a fixed one reopens it as `regressed` (ORC-06 escalates on that).
 */
export function planRecord(
  state: LedgerState,
  claims: FindingClaim[],
  ctx: RecordContext,
): { lines: LedgerLine[]; results: RecordOutcome[] } {
  const lines: LedgerLine[] = [];
  const results: RecordOutcome[] = [];
  const taken = new Map<string, string>();
  for (const [id, f] of state.findings) taken.set(id, f.fingerprint);
  for (const c of state.conflicts) taken.set(c.id, c.kept);
  const seenThisCall = new Map<string, string>();
  for (const claim of claims) {
    const fingerprint = fingerprintClaim(claim);
    const existingId = state.byFingerprint.get(fingerprint) ?? seenThisCall.get(fingerprint);
    if (existingId) {
      const existing = state.findings.get(existingId);
      const status = existing?.status ?? "candidate";
      if (existing && closedByHuman(existing)) {
        results.push({ outcome: "suppressed", id: existingId, fingerprint, status });
        continue;
      }
      if (existing) {
        lines.push({
          v: 1,
          type: "seen",
          at: ctx.now,
          id: existingId,
          run_id: ctx.runId,
          head_sha: ctx.headSha,
        });
      }
      if (existing && status === "fixed") {
        lines.push({
          v: 1,
          type: "status",
          at: ctx.now,
          id: existingId,
          status: "regressed",
          reason: `seen again in run ${ctx.runId} after it was marked fixed`,
          run_id: ctx.runId,
        });
        results.push({ outcome: "regressed", id: existingId, fingerprint });
      } else if (status === "rejected") {
        results.push({
          outcome: "duplicate",
          id: existingId,
          fingerprint,
          status,
          note: "rejected by an agent, seen again; a person can reopen it with a human confirm",
        });
      } else {
        results.push({ outcome: "duplicate", id: existingId, fingerprint, status });
      }
      continue;
    }
    const id = idForFingerprint(fingerprint, taken);
    taken.set(id, fingerprint);
    seenThisCall.set(fingerprint, id);
    const finding: HuntFinding = {
      ...claim,
      id,
      fingerprint,
      status: "candidate",
      verdicts: [],
      first_seen_run: ctx.runId,
      last_seen_run: ctx.runId,
      head_sha: ctx.headSha,
      created_at: ctx.now,
      updated_at: ctx.now,
    };
    lines.push({ v: 1, type: "finding", at: ctx.now, finding });
    results.push(
      claim.confidence === "low"
        ? { outcome: "new", id, fingerprint, note: "low confidence: logged, never reported" }
        : { outcome: "new", id, fingerprint },
    );
  }
  return { lines, results };
}

// ── verification protocol (VER-*) ─────────────────────────────────────────

/** Classes whose confirmation needs a reproducing artefact (VER-03). */
const PROOF_CLASSES = new Set(["bug", "perf", "spec-drift"]);
/** Classes confirmed by a named rule and visual evidence instead (VER-07). */
const RULE_CLASSES = new Set(["ux-issue", "design-deviation", "a11y"]);

/**
 * Statuses an agent's ruling no longer moves: the protocol has concluded, or a person has taken
 * the finding over. The ruling is still recorded, as evidence; only a `human` ruling, or a
 * sighting of a fixed finding, changes the status from here.
 */
const SETTLED_FOR_AGENTS: FindingStatus[] = [
  "confirmed",
  "rejected",
  "wont-fix",
  "fixed",
  "deferred",
  "ticketed",
];

export type VerdictPlan =
  | { ok: true; lines: LedgerLine[]; status: FindingStatus; note: string }
  | { ok: false; reason: string };

function huntStatusLine(
  id: string,
  status: FindingStatus,
  reason: string,
  now: string,
  runId?: string,
): LedgerLine {
  return { v: 1, type: "status", at: now, id, status, reason, ...(runId ? { run_id: runId } : {}) };
}

/**
 * VER-03's artefact: a test or scenario a `prove` ruling RAN, on this verdict or an earlier one.
 * A path the producer only proposed (`reproduction.proposed_test_path`) never counts.
 */
function hasProofArtefact(f: HuntFinding, v: VerdictEntry): boolean {
  return [f.reproduction.test_path, f.reproduction.scenario, v.test_path, v.scenario].some(
    (x) => x !== undefined,
  );
}

function ruleEvidenceGap(f: HuntFinding): string | null {
  if (!f.rule) return "it names no heuristic, WCAG criterion, token or component rule (VER-07)";
  if (!f.evidence.some((e) => e.kind === "screenshot" || e.kind === "recording")) {
    return "it carries no screenshot or recording (VER-07)";
  }
  return null;
}

/**
 * Apply one ruling. The tool, not the agent, decides what a ruling does to the status:
 *
 * - no ruling by the finding's own producer (VER-01);
 * - once a person has ruled, or the finding is settled (confirmed, rejected, won't fix, fixed,
 *   deferred, ticketed), an agent's ruling is recorded and changes nothing;
 * - a skeptic's ruling is recorded and changes nothing — the referee decides (VER-02/03);
 * - a referee's `dismissed` rejects; `upheld` confirms a rule-class finding that meets VER-07
 *   and leaves a proof-class finding a candidate until a reproducing test rules;
 * - `prove` is accepted only after a referee upheld the claim; `red` confirms a proof-class
 *   finding, but only with a reproducing artefact the ruling ran and a failure classified
 *   `real-defect` (VER-03, VER-05); `green` rejects it — a passing test invalidates the
 *   hypothesis (step 9 of the code check); `flaky` parks it (VER-04);
 * - a human's `confirm`, `reject` and `wont-fix` are final (VER-08, TRI-11).
 */
export function planVerdict(f: HuntFinding, verdict: VerdictEntry, now: string): VerdictPlan {
  if (verdict.stage !== "human" && verdict.by.trim() === f.producer.trim()) {
    return { ok: false, reason: `${verdict.by} produced ${f.id} and cannot rule on it (VER-01).` };
  }
  const allowed: Record<VerdictEntry["stage"], VerdictEntry["ruling"][]> = {
    skeptic: ["upheld", "dismissed"],
    referee: ["upheld", "dismissed"],
    prove: ["red", "green", "flaky"],
    human: ["confirm", "reject", "wont-fix"],
  };
  if (!allowed[verdict.stage].includes(verdict.ruling)) {
    return {
      ok: false,
      reason: `a ${verdict.stage} ruling is one of ${allowed[verdict.stage].join(", ")}, not ${verdict.ruling}.`,
    };
  }
  if (verdict.stage === "prove") {
    if (!PROOF_CLASSES.has(f.class)) {
      return {
        ok: false,
        reason: `${f.class} findings are proven by a rule, not a test (VER-07).`,
      };
    }
    const upheld = f.verdicts.some((x) => x.stage === "referee" && x.ruling === "upheld");
    if (!upheld) {
      return {
        ok: false,
        reason: `${f.id} has no referee ruling that upheld it; the referee rules before a test proves (VER-02, VER-03).`,
      };
    }
    if (verdict.ruling === "red" && !hasProofArtefact(f, verdict)) {
      return {
        ok: false,
        reason: `${f.id} has no reproducing test or scenario; pass test_path (or scenario) with the red ruling (VER-03).`,
      };
    }
  }
  const v: LedgerLine = { v: 1, type: "verdict", at: now, id: f.id, verdict };
  const keep = (note: string): VerdictPlan => ({ ok: true, lines: [v], status: f.status, note });
  const move = (status: FindingStatus, note: string): VerdictPlan => ({
    ok: true,
    lines: [v, huntStatusLine(f.id, status, note, now, verdict.run_id)],
    status,
    note,
  });

  if (verdict.stage !== "human") {
    const human = lastHumanVerdict(f);
    if (human) {
      return keep(
        `recorded as evidence; a person already ruled ${human.ruling}, so the status stays ${f.status}`,
      );
    }
    if (SETTLED_FOR_AGENTS.includes(f.status)) {
      return keep(
        `recorded as evidence; ${f.id} is ${f.status}, which an agent ruling no longer moves`,
      );
    }
  }

  switch (verdict.stage) {
    case "skeptic":
      return keep("recorded; the referee rules on contested claims");
    case "referee":
      if (verdict.ruling === "dismissed") return move("rejected", "referee dismissed the claim");
      if (RULE_CLASSES.has(f.class)) {
        const gap = ruleEvidenceGap(f);
        if (gap) return { ok: false, reason: `${f.id} cannot be confirmed: ${gap}.` };
        return move("confirmed", "referee upheld a rule-backed finding with visual evidence");
      }
      if (PROOF_CLASSES.has(f.class)) {
        return keep("upheld; a reproducing test must rule before it is confirmed (VER-03)");
      }
      return move("suspected", "referee upheld a risk with no reproducing artefact");
    case "prove":
      if (verdict.ruling === "green") {
        return move("rejected", "the reproducing test passed, which invalidates the hypothesis");
      }
      if (verdict.ruling === "flaky")
        return move("flaky", "reproduction mixes passes and failures (VER-04)");
      if (verdict.failure_kind !== "real-defect") {
        return keep(
          `red recorded, but classified ${verdict.failure_kind ?? "unclassified"}: only a real-defect failure confirms (VER-05)`,
        );
      }
      return move("confirmed", "a reproducing test fails for the stated reason");
    case "human":
      if (verdict.ruling === "reject") return move("rejected", "rejected by a person");
      if (verdict.ruling === "wont-fix") return move("wont-fix", "closed by a person as won't fix");
      return move("confirmed", "confirmed by a person");
  }
}

/** Statuses `set-status` may set directly; the rest come only from rulings or sightings. */
export const SETTABLE_STATUSES = ["deferred", "ticketed", "fixed", "suspected"] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

/**
 * Where each settable status may be set FROM. Nothing leaves `rejected`, `wont-fix` or `fixed`
 * through `set-status`: a human ruling reopens a closed finding, a sighting reopens a fixed one.
 * `suspected` is never a downgrade of a confirmed finding, and `ticketed` needs a confirmed one.
 * `fixed` is allowed from an unproven status too, for a defect that is gone before it was proven.
 */
export const SET_STATUS_FROM: Record<SettableStatus, FindingStatus[]> = {
  ticketed: ["confirmed", "regressed"],
  suspected: ["candidate", "flaky"],
  deferred: ["candidate", "confirmed", "suspected", "flaky", "regressed", "ticketed"],
  fixed: ["confirmed", "ticketed", "regressed", "candidate", "suspected", "flaky", "deferred"],
};

export function planSetStatus(
  f: HuntFinding,
  status: SettableStatus,
): { ok: true } | { ok: false; reason: string } {
  const from = SET_STATUS_FROM[status];
  if (from.includes(f.status)) return { ok: true };
  return {
    ok: false,
    reason: `${f.id} is ${f.status}; ${status} is set only from ${from.join(", ")}.`,
  };
}

// ── ranking and triage (TRI-*) ────────────────────────────────────────────

const SEVERITY_ORDER = HuntSeverity.options;
const CONFIDENCE_ORDER = ["confirmed", "high", "medium", "low"];
const PRIORITY_ORDER = ["core", "secondary", "edge"];

/** Open means a team still has something to do about it. */
export const OPEN_STATUSES: FindingStatus[] = [
  "candidate",
  "confirmed",
  "suspected",
  "flaky",
  "regressed",
  "ticketed",
];

function huntJourneyPriority(f: HuntFinding, flows: FlowMap | null): number {
  if (!flows || !f.location.flow) return PRIORITY_ORDER.length;
  const j = flows.journeys.find(
    (x) => x.id === f.location.flow || x.steps.includes(f.location.flow ?? ""),
  );
  return j ? PRIORITY_ORDER.indexOf(j.priority) : PRIORITY_ORDER.length;
}

function huntBlastRadius(f: HuntFinding): number {
  return new Set([...f.location.files.map((x) => x.path), ...f.occurrences.map((x) => x.path)])
    .size;
}

/** TRI-07: severity, then confidence, then journey priority, then blast radius, then id. */
export function rankFindings(findings: HuntFinding[], flows: FlowMap | null): HuntFinding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      CONFIDENCE_ORDER.indexOf(a.confidence) - CONFIDENCE_ORDER.indexOf(b.confidence) ||
      huntJourneyPriority(a, flows) - huntJourneyPriority(b, flows) ||
      huntBlastRadius(b) - huntBlastRadius(a) ||
      a.id.localeCompare(b.id),
  );
}

/** Whether a finding is at or above a severity floor. */
export function atOrAbove(sev: HuntFinding["severity"], floor: HuntFinding["severity"]): boolean {
  return SEVERITY_ORDER.indexOf(sev) <= SEVERITY_ORDER.indexOf(floor);
}

export interface TriageGroups {
  /** Ranked open findings. */
  open: HuntFinding[];
  /** Same category and primary file, different fingerprint: the reconciler decides (TRI-01). */
  possibleDuplicates: string[][];
  /** Same category and title across files: candidates for one systemic finding (TRI-04). */
  systemic: string[][];
  /** Open findings last seen at another commit whose files changed since (TRI-06). */
  stale: string[];
}

function titleSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function huntGroupsOf(findings: HuntFinding[], key: (f: HuntFinding) => string): string[][] {
  const m = new Map<string, string[]>();
  for (const f of findings) {
    const k = key(f);
    m.set(k, [...(m.get(k) ?? []), f.id]);
  }
  return [...m.values()].filter((ids) => ids.length > 1).map((ids) => ids.sort());
}

export function triageGroups(
  findings: HuntFinding[],
  flows: FlowMap | null,
  changedSince: (f: HuntFinding) => boolean,
): TriageGroups {
  const open = rankFindings(
    findings.filter((f) => OPEN_STATUSES.includes(f.status) && f.confidence !== "low"),
    flows,
  );
  return {
    open,
    possibleDuplicates: huntGroupsOf(
      open,
      (f) => `${f.category}\0${f.location.files[0]?.path ?? f.location.route ?? ""}`,
    ),
    systemic: huntGroupsOf(open, (f) => `${f.category}\0${titleSlug(f.title)}`).filter((ids) => {
      const paths = new Set(
        ids.map((id) => open.find((f) => f.id === id)?.location.files[0]?.path),
      );
      return paths.size > 1;
    }),
    stale: open.filter(changedSince).map((f) => f.id),
  };
}

// ── report (TRI-10, ORC-10) ───────────────────────────────────────────────

function locationText(f: HuntFinding): string {
  const file = f.location.files[0];
  if (file) return `\`${file.path}${file.line ? `:${file.line}` : ""}\``;
  if (f.location.route) return `route \`${f.location.route}\``;
  return f.location.component ? `\`${f.location.component}\`` : "—";
}

function reportRow(f: HuntFinding): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return `| ${f.id} | ${f.severity} | ${f.status} | ${cell(f.title)} | ${locationText(f)} | ${f.category} |`;
}

function reportTable(findings: HuntFinding[]): string {
  if (findings.length === 0) return "_None._";
  return [
    "| ID | Severity | Status | Finding | Where | Category |",
    "| --- | --- | --- | --- | --- | --- |",
    ...findings.map(reportRow),
  ].join("\n");
}

export interface ReportInput {
  title: string;
  generatedAt: string;
  findings: HuntFinding[];
  flows: FlowMap | null;
  run?: HuntRun;
  coverage?: { files: number; audited: number };
}

/** Is a finding in the main report (confirmed or regressed), the suspected list, or neither? */
export function reportSection(f: HuntFinding): "main" | "suspected" | "none" {
  if (f.status === "confirmed" || f.status === "regressed" || f.status === "ticketed")
    return "main";
  if (
    (f.status === "candidate" || f.status === "suspected" || f.status === "flaky") &&
    f.confidence !== "low"
  ) {
    return "suspected";
  }
  return "none";
}

/** One-paragraph summary: counts by class and severity, the top three, where evidence lives. */
export function summaryParagraph(findings: HuntFinding[], flows: FlowMap | null): string {
  const main = rankFindings(
    findings.filter((f) => reportSection(f) === "main"),
    flows,
  );
  const suspected = findings.filter((f) => reportSection(f) === "suspected").length;
  if (main.length === 0) {
    return `No confirmed findings. ${suspected} suspected finding(s) await proof or a ruling. Evidence lives under .marvin/hunt/evidence/.`;
  }
  const counts = new Map<string, number>();
  for (const f of main)
    counts.set(`${f.class}/${f.severity}`, (counts.get(`${f.class}/${f.severity}`) ?? 0) + 1);
  const byKind = [...counts.entries()].map(([k, n]) => `${n} ${k}`).join(", ");
  const top = main
    .slice(0, 3)
    .map((f) => `${f.id} ${f.title} (${f.severity})`)
    .join("; ");
  return `${main.length} confirmed finding(s): ${byKind}. Top: ${top}. ${suspected} suspected. Evidence lives under .marvin/hunt/evidence/.`;
}

export function renderReport(input: ReportInput): string {
  const { findings, flows } = input;
  const ranked = rankFindings(findings, flows);
  const main = ranked.filter((f) => reportSection(f) === "main");
  const suspected = ranked.filter((f) => reportSection(f) === "suspected");
  const bugs = main.filter(
    (f) =>
      f.class === "bug" || f.class === "perf" || f.class === "spec-drift" || f.class === "risk",
  );
  const ux = main.filter((f) => f.class === "ux-issue" || f.class === "a11y");
  const design = main.filter((f) => f.class === "design-deviation");
  const systemic = main.filter((f) => f.occurrences.length > 0);
  const closed = findings.filter((f) => reportSection(f) === "none");
  const out: string[] = [
    `# ${input.title}`,
    "",
    `Generated ${input.generatedAt}${input.run ? ` · run \`${input.run.id}\` (${input.run.check}) at \`${input.run.head_sha?.slice(0, 12) ?? "no commit"}\`` : ""}.`,
    "",
    "## Summary",
    "",
    summaryParagraph(findings, flows),
    "",
    "## Bugs by severity",
    "",
    reportTable(bugs),
    "",
    "## UX and accessibility",
    "",
    reportTable(ux),
    "",
    "## Design deviations",
    "",
    reportTable(design),
    "",
    "## Systemic patterns",
    "",
    systemic.length === 0
      ? "_None._"
      : systemic
          .map(
            (f) =>
              `- **${f.id}** ${f.title}: ${f.occurrences.length + f.location.files.length} occurrence(s)`,
          )
          .join("\n"),
    "",
    "## Flow-map gaps",
    "",
    !flows || flows.anomalies.length === 0
      ? "_None recorded._"
      : flows.anomalies.map((a) => `- ${a}`).join("\n"),
    "",
    "## Suspected",
    "",
    "Medium or high confidence, not yet proven. Not counted as confirmed.",
    "",
    reportTable(suspected),
    "",
    "## Coverage",
    "",
    input.coverage
      ? `${input.coverage.audited} of ${input.coverage.files} file(s) in scope have been audited at least once.`
      : "_Not computed for this report._",
    "",
    "## Run cost",
    "",
    input.run
      ? `Started ${input.run.started_at}${input.run.finished_at ? `, finished ${input.run.finished_at}` : ""}; ${input.run.hotspots.length} hotspot(s) ranked, ${input.run.recorded.length} claim(s) recorded. Token cost is not visible to the tool and is reported by the session.`
      : "_Ledger-wide report; no single run._",
    "",
    `_${closed.length} closed finding(s) (rejected, fixed, deferred, won't fix, or low confidence) are in the ledger and not listed._`,
    "",
  ];
  return out.join("\n");
}
