import { z } from "zod";

/**
 * The bug-hunter data contracts (ADR-0053, ADR-0054) — the `hunt-*` command group's shared
 * state under `.marvin/hunt/`: the configuration (`hunt` key of `.marvin/config.json`), the
 * flow map (`flows.json`), the findings ledger (`findings.jsonl`), the per-file audit history
 * (`coverage.json`) and one run's state (`runs/<run-id>/run.json`).
 *
 * Unlike most contracts here these schemas ARE the runtime validators: the `hunt` tool imports
 * them and validates every artefact it writes against them (PKG-06), and the JSON Schema copies
 * shipped under `plugins/marvin/skills/hunt-code/references/schemas/` are generated from them
 * (`scripts/gen-hunt-schemas.mjs`) so the agents that hand records to the tool read the same
 * shape the tool enforces.
 *
 * The machine vocabulary is ASCII and English whatever language a report is written in, for the
 * reason the audit family's `findings` block gives: a report's prose may be localised, the
 * values that join runs together may not.
 */

/** The version every artefact under `.marvin/hunt/` carries. A newer one is refused (PKG-07). */
export const HUNT_STATE_VERSION = 1;

/** The four checks plus triage. `triage` produces no findings of its own. */
export const HuntCheck = z.enum(["code", "user-behavior", "ux", "design"]);
export type HuntCheck = z.infer<typeof HuntCheck>;

export const FindingClass = z.enum([
  "bug",
  "ux-issue",
  "design-deviation",
  "a11y",
  "perf",
  "spec-drift",
  "risk",
]);
export type FindingClass = z.infer<typeof FindingClass>;

/** Ordered most severe first; the order is the ranking order (TRI-07). */
export const HuntSeverity = z.enum(["critical", "high", "medium", "low"]);
export type HuntSeverity = z.infer<typeof HuntSeverity>;

/** `confirmed` means reproduced by evidence (VER-03); only it and `high` reach the main report. */
export const HuntConfidence = z.enum(["confirmed", "high", "medium", "low"]);
export type HuntConfidence = z.infer<typeof HuntConfidence>;

export const FindingStatus = z.enum([
  "candidate",
  "confirmed",
  "rejected",
  "suspected",
  "flaky",
  "fixed",
  "ticketed",
  "deferred",
  "wont-fix",
  "regressed",
]);
export type FindingStatus = z.infer<typeof FindingStatus>;

/** Who ruled. `hunter` and `fixer` never rule; they produce. */
export const VerdictStage = z.enum(["skeptic", "referee", "prove", "human"]);
export type VerdictStage = z.infer<typeof VerdictStage>;

/**
 * A ruling. `upheld`/`dismissed` are a judge's; `red`/`green` are a reproducing test's
 * (`red` = the test fails against the current code, which is the proof a bug exists);
 * `confirm`/`reject`/`wont-fix` are a human's (VER-08, TRI-11).
 */
export const VerdictRuling = z.enum([
  "upheld",
  "dismissed",
  "red",
  "green",
  "flaky",
  "confirm",
  "reject",
  "wont-fix",
]);
export type VerdictRuling = z.infer<typeof VerdictRuling>;

/** VER-05: what a failing reproduction actually showed. */
export const FailureKind = z.enum(["real-defect", "test-drift", "environment", "data"]);
export type FailureKind = z.infer<typeof FailureKind>;

/** CODE-E02: how well the existing suite already covers the finding. */
export const TestCoverage = z.enum(["covered", "partial", "wrong-assertion", "none"]);
export type TestCoverage = z.infer<typeof TestCoverage>;

const RelPath = z
  .string()
  .min(1)
  .refine(
    (p) => !p.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(p) && !p.split(/[\\/]/).includes(".."),
    {
      message: "must be a repository-relative path without '..'",
    },
  );

export const HuntFileRef = z
  .object({
    path: RelPath,
    line: z.number().int().min(1).optional(),
    end_line: z.number().int().min(1).optional(),
  })
  .strict();
export type HuntFileRef = z.infer<typeof HuntFileRef>;

export const FindingLocation = z
  .object({
    files: z.array(HuntFileRef).default([]),
    route: z.string().min(1).optional(),
    flow: z.string().min(1).optional(),
    step: z.string().min(1).optional(),
    component: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
  })
  .strict();
export type FindingLocation = z.infer<typeof FindingLocation>;

export const EvidenceKind = z.enum([
  "test-output",
  "trace",
  "screenshot",
  "recording",
  "console",
  "network",
  "log",
  "code",
]);

export const Evidence = z
  .object({
    kind: EvidenceKind,
    /** Repository-relative, normally under `.marvin/hunt/evidence/<finding-id>/`. */
    path: RelPath.optional(),
    /** A short excerpt, masked of secrets and PII by the writer (NFR-09). */
    excerpt: z.string().max(4000).optional(),
  })
  .strict()
  .refine((e) => e.path !== undefined || e.excerpt !== undefined, {
    message: "evidence needs a path or an excerpt",
  });
export type Evidence = z.infer<typeof Evidence>;

export const Reproduction = z
  .object({
    steps: z.array(z.string().min(1)).default([]),
    /** The reproducing test, at the caller's boundary (CODE-E01). */
    test_path: RelPath.optional(),
    /** A replayable e2e scenario (user-behavior). */
    scenario: RelPath.optional(),
    /** CODE-E04: the input or state sequence that reaches the defect, and why guards do not stop it. */
    path_feasibility: z.string().min(1).optional(),
  })
  .strict();
export type Reproduction = z.infer<typeof Reproduction>;

export const VerdictEntry = z
  .object({
    stage: VerdictStage,
    ruling: VerdictRuling,
    /** Which agent or person ruled; must differ from the finding's `producer` (VER-01). */
    by: z.string().min(1),
    reasoning: z.string().min(1),
    failure_kind: FailureKind.optional(),
    /**
     * `prove` only: the reproducing test or scenario this ruling ran, when the claim did not
     * carry one. The fold writes it onto the finding's `reproduction` (VER-03).
     */
    test_path: RelPath.optional(),
    scenario: RelPath.optional(),
    at: z.string().min(1),
    run_id: z.string().min(1).optional(),
  })
  .strict();
export type VerdictEntry = z.infer<typeof VerdictEntry>;

export const FindingLinks = z
  .object({
    related: z.array(z.string().min(1)).default([]),
    root_cause: z.string().min(1).optional(),
    duplicate_of: z.string().min(1).optional(),
    /** Board task id (`task` tool), MAR-01. */
    task: z.string().min(1).optional(),
    commit: z.string().min(1).optional(),
    /** MAR-04: an ADR or spec the finding violates, by repository path. */
    adr: RelPath.optional(),
    spec: RelPath.optional(),
  })
  .strict();
export type FindingLinks = z.infer<typeof FindingLinks>;

/**
 * What a producer hands the tool (`hunt action: "record"`). The tool assigns `id`,
 * `fingerprint`, `status`, timestamps and run ids; a producer cannot set them.
 */
export const FindingClaim = z
  .object({
    check: HuntCheck,
    class: FindingClass,
    /** Taxonomy category id from the check's reference, e.g. `CODE-D04`. */
    category: z.string().min(1).max(64),
    title: z.string().min(1).max(160),
    summary: z.string().min(1).max(2000),
    location: FindingLocation,
    expected: z.string().min(1),
    actual: z.string().min(1),
    reproduction: Reproduction.default({}),
    evidence: z.array(Evidence).default([]),
    severity: HuntSeverity,
    confidence: HuntConfidence,
    /** The named heuristic, WCAG criterion, token or component rule (VER-07). */
    rule: z.string().min(1).optional(),
    /** VER-06: guarding code checked, framework behaviour checked, similar patterns searched. */
    not_false_positive: z.string().min(1).optional(),
    test_coverage: TestCoverage.optional(),
    /** Every occurrence of a systemic pattern (CODE-D25, TRI-04), beyond `location.files`. */
    occurrences: z.array(HuntFileRef).default([]),
    /** The agent that produced the claim, e.g. `marvin-hunt-hunter`. */
    producer: z.string().min(1),
    links: FindingLinks.default({}),
  })
  .strict();
export type FindingClaim = z.infer<typeof FindingClaim>;

/** A finding as the ledger folds it: the claim plus everything the tool owns. */
export const HuntFinding = FindingClaim.extend({
  id: z.string().regex(/^BH-\d{4}-\d{4,}$/),
  fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
  status: FindingStatus,
  verdicts: z.array(VerdictEntry).default([]),
  first_seen_run: z.string().min(1),
  last_seen_run: z.string().min(1),
  head_sha: z.string().nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
}).strict();
export type HuntFinding = z.infer<typeof HuntFinding>;

/**
 * One line of `findings.jsonl`. The ledger is append-only (NFR-12): a finding is written once
 * and every later change — a verdict, a status, a link, a sighting in a later run — is an event
 * that the fold applies in order. Rewriting a line is never needed and never done.
 */
export const LedgerLine = z.discriminatedUnion("type", [
  z
    .object({
      v: z.literal(HUNT_STATE_VERSION),
      type: z.literal("finding"),
      at: z.string().min(1),
      finding: HuntFinding,
    })
    .strict(),
  z
    .object({
      v: z.literal(HUNT_STATE_VERSION),
      type: z.literal("verdict"),
      at: z.string().min(1),
      id: z.string().min(1),
      verdict: VerdictEntry,
    })
    .strict(),
  z
    .object({
      v: z.literal(HUNT_STATE_VERSION),
      type: z.literal("status"),
      at: z.string().min(1),
      id: z.string().min(1),
      status: FindingStatus,
      reason: z.string().min(1),
      run_id: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      v: z.literal(HUNT_STATE_VERSION),
      type: z.literal("link"),
      at: z.string().min(1),
      id: z.string().min(1),
      links: FindingLinks.partial(),
    })
    .strict(),
  z
    .object({
      v: z.literal(HUNT_STATE_VERSION),
      type: z.literal("seen"),
      at: z.string().min(1),
      id: z.string().min(1),
      run_id: z.string().min(1),
      head_sha: z.string().nullable(),
    })
    .strict(),
]);
export type LedgerLine = z.infer<typeof LedgerLine>;

// ── flow map (FLW-*) ─────────────────────────────────────────────────────

export const FlowProvenance = z.enum(["code", "runtime", "both", "manual"]);
export type FlowProvenance = z.infer<typeof FlowProvenance>;

const FlowMeta = {
  provenance: FlowProvenance,
  confidence: z.enum(["high", "medium", "low"]),
  sources: z.array(HuntFileRef).default([]),
  /** FLW-08: a human entry, kept across regenerations. */
  pinned: z.boolean().default(false),
};

export const ScreenState = z.enum([
  "loading",
  "empty",
  "populated",
  "partial",
  "error",
  "offline",
  "unauthorized",
  "not-found",
  "read-only",
]);

export const FlowNode = z
  .object({
    id: z.string().min(1),
    route: z.string().min(1),
    params: z.array(z.string()).default([]),
    guards: z.array(z.string()).default([]),
    role: z.string().min(1).optional(),
    data: z.array(z.string()).default([]),
    states: z.array(ScreenState).default([]),
    entry: z.boolean().default(false),
    ...FlowMeta,
  })
  .strict();
export type FlowNode = z.infer<typeof FlowNode>;

/** FLW-06: a machine-checkable expected outcome where one exists. */
export const Assertion = z
  .object({
    kind: z.enum(["url", "text", "request", "db-row", "toast", "state", "other"]),
    value: z.string().min(1),
  })
  .strict();

export const FlowTransition = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1).optional(),
    action: z.enum([
      "click",
      "submit",
      "navigate",
      "back",
      "refresh",
      "deep-link",
      "keyboard",
      "other",
    ]),
    trigger: z.string().min(1).optional(),
    preconditions: z.array(z.string()).default([]),
    side_effects: z.array(z.string()).default([]),
    expected: z.array(Assertion).default([]),
    handler: HuntFileRef.optional(),
    ...FlowMeta,
  })
  .strict();
export type FlowTransition = z.infer<typeof FlowTransition>;

export const Journey = z
  .object({
    id: z.string().min(1),
    goal: z.string().min(1),
    persona: z.string().min(1).optional(),
    priority: z.enum(["core", "secondary", "edge"]),
    steps: z.array(z.string().min(1)).min(1),
    ...FlowMeta,
  })
  .strict();
export type Journey = z.infer<typeof Journey>;

export const FlowMap = z
  .object({
    version: z.literal(HUNT_STATE_VERSION),
    generated_at: z.string().min(1).optional(),
    run_id: z.string().min(1).optional(),
    head_sha: z.string().nullable().optional(),
    nodes: z.array(FlowNode).default([]),
    transitions: z.array(FlowTransition).default([]),
    journeys: z.array(Journey).default([]),
    /** CODE-F09: unreachable screens, orphan routes, dead handlers, links to nowhere. */
    anomalies: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type FlowMap = z.infer<typeof FlowMap>;

// ── coverage (CODE-P04, O02) ─────────────────────────────────────────────

export const CoverageEntry = z
  .object({
    path: RelPath,
    last_audited_at: z.string().min(1),
    last_run: z.string().min(1),
    /** The git blob of the file when audited; a different blob now means "changed since". */
    blob: z.string().nullable(),
    audits: z.number().int().min(1),
    findings: z.number().int().min(0),
  })
  .strict();
export type CoverageEntry = z.infer<typeof CoverageEntry>;

export const Coverage = z
  .object({
    version: z.literal(HUNT_STATE_VERSION),
    files: z.array(CoverageEntry).default([]),
  })
  .strict();
export type Coverage = z.infer<typeof Coverage>;

// ── configuration (CFG-*) ────────────────────────────────────────────────

export const Authority = z.enum(["detect-only", "approve", "autonomous"]);
export type Authority = z.infer<typeof Authority>;

export const HuntConfig = z
  .object({
    version: z.literal(HUNT_STATE_VERSION).default(HUNT_STATE_VERSION),
    scope: z
      .object({
        /** Glob-ish path prefixes or patterns; empty means the whole repository (CFG-01). */
        paths: z.array(z.string().min(1)).default([]),
        /** Added to the default exclusions (CFG-02). */
        exclude: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .default({}),
    /** CFG-03; ADR-0053 sets High for code and user-behavior, Medium for ux and design. */
    severity_floor: z
      .object({
        code: HuntSeverity.default("high"),
        "user-behavior": HuntSeverity.default("high"),
        ux: HuntSeverity.default("medium"),
        design: HuntSeverity.default("medium"),
      })
      .strict()
      .default({}),
    /** CFG-04; detect-only by default (NFR-01), with separate switches for tickets and fixes. */
    authority: z
      .object({
        mode: Authority.default("detect-only"),
        tickets: z.boolean().default(false),
        fixes: z.boolean().default(false),
      })
      .strict()
      .default({}),
    /** CFG-08. */
    budgets: z
      .object({
        max_minutes: z.number().int().min(1).default(30),
        max_rounds: z.number().int().min(1).default(3),
        max_findings_per_round: z.number().int().min(1).default(25),
        max_hotspots: z.number().int().min(1).default(40),
        batch_size: z.number().int().min(1).default(8),
        max_fixes: z.number().int().min(0).default(0),
      })
      .strict()
      .default({}),
    /** CFG-09. */
    constraints: z
      .object({
        frozen_paths: z.array(z.string().min(1)).default([]),
        no_public_api_breaks: z.boolean().default(true),
      })
      .strict()
      .default({}),
    /** Hotspot ranking window in months (CODE-P01). */
    history_months: z.number().int().min(1).max(120).default(12),
    /**
     * CFG-05/06/07 belong to the runtime checks (phases 2–4). They are accepted and kept now so a
     * config written ahead of those phases survives, and validated when the checks ship.
     */
    runtime: z.record(z.unknown()).optional(),
    personas: z.array(z.record(z.unknown())).optional(),
    design: z.record(z.unknown()).optional(),
  })
  .strict();
export type HuntConfig = z.infer<typeof HuntConfig>;

// ── run state (ORC-04, NFR-05) ───────────────────────────────────────────

export const HuntScope = z
  .object({
    kind: z.enum(["repo", "paths", "diff"]),
    paths: z.array(z.string()).default([]),
    base: z.string().min(1).optional(),
    files: z.array(RelPath),
  })
  .strict();
export type HuntScope = z.infer<typeof HuntScope>;

export const HotspotSignals = z
  .object({
    churn: z.number().int().min(0),
    authors: z.number().int().min(0),
    fix_commits: z.number().int().min(0),
    lines: z.number().int().min(0),
    days_since_change: z.number().int().min(0).nullable(),
    risk_terms: z.array(z.string()),
    audit: z.enum(["never", "changed", "stale", "fresh"]),
    has_test: z.boolean(),
  })
  .strict();

export const Hotspot = z
  .object({
    path: RelPath,
    rank: z.number().int().min(1),
    score: z.number(),
    signals: HotspotSignals,
    /** CODE-P07: the signals that converged on this rank, in words. */
    why: z.array(z.string()),
    batch: z.number().int().min(1),
  })
  .strict();
export type Hotspot = z.infer<typeof Hotspot>;

export const RunStep = z
  .object({
    step: z.string().min(1),
    at: z.string().min(1),
    note: z.string().optional(),
    round: z.number().int().min(1).optional(),
    batch: z.number().int().min(1).optional(),
  })
  .strict();

export const HuntRun = z
  .object({
    version: z.literal(HUNT_STATE_VERSION),
    id: z.string().regex(/^\d{8}-\d{6}-[a-z-]+$/),
    check: z.union([HuntCheck, z.literal("triage")]),
    state: z.enum(["running", "finished", "abandoned"]),
    started_at: z.string().min(1),
    finished_at: z.string().min(1).optional(),
    branch: z.string().nullable(),
    head_sha: z.string().nullable(),
    dirty: z.boolean(),
    scope: HuntScope,
    authority: Authority,
    baseline: z
      .object({
        verdict: z.string(),
        head_sha: z.string().nullable(),
        gates: z.array(z.object({ name: z.string(), status: z.string() }).strict()),
        stale: z.boolean(),
      })
      .strict()
      .optional(),
    hotspots: z.array(Hotspot).default([]),
    steps: z.array(RunStep).default([]),
    recorded: z.array(z.string()).default([]),
    summary: z.string().optional(),
  })
  .strict();
export type HuntRun = z.infer<typeof HuntRun>;
