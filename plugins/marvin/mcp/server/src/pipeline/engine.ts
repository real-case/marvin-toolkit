import { z } from "zod";
import {
  assignmentFor,
  criticCap,
  enforceVerifierFloor,
  fingerprint,
  HaltError,
  previewAssignments,
  type Rubric,
  type Signals,
  shouldAuthorTests,
  tierFor,
} from "./assess.js";
import type { CiState } from "./ci.js";
import { type Finding, type GateReport, isCanonicalPath, SEVERITIES } from "./gate.js";
import {
  Assignment,
  ROLES,
  type Role,
  type Run,
  type Stage,
  type Tier,
  transition,
} from "./run-store.js";
import type { WaitResult } from "./wait.js";

export type JudgmentKind =
  "planner_questions" | "executor_questions" | "spec_approval" | "halt" | "no_ci";
export type Answer =
  | { kind: "answers"; text: string; count: number }
  | { kind: "approve"; tier?: Tier; reason?: string }
  | { kind: "changes"; text: string }
  | { kind: "revise_tests"; text: string }
  | { kind: "retry" }
  | { kind: "wait" }
  | { kind: "proceed" }
  | { kind: "cancel"; reason: string };
export type Observation =
  | { kind: "start" }
  | {
      kind: "child";
      role: Role;
      result: WaitResult;
      signals?: Signals;
      mutated?: string[];
      leaked?: string[];
    }
  | { kind: "answer"; judgment: JudgmentKind; answer: Answer }
  | { kind: "gate"; report: GateReport; findings: Finding[] }
  | { kind: "seal"; ok: boolean; reasons: string[]; sealed: Run["sealed"] }
  | { kind: "ci"; state: CiState; failing: string[] }
  | { kind: "finalized" };
export interface SpawnAction {
  kind: "spawn";
  role: Role;
  assignment: Assignment;
  iteration: number;
  context: Record<string, string>;
  resume: boolean;
}
export type Action =
  | SpawnAction
  | { kind: "judgment"; judgment: JudgmentKind; payload: Record<string, unknown> }
  | {
      kind: "work";
      work: "gate" | "seal" | "ci" | "finalize" | "mark_ready" | "rename_branch" | "snapshot";
      data?: Record<string, unknown>;
    }
  | { kind: "notify"; text: string };
export interface Decision {
  run: Run;
  actions: Action[];
}

/**
 * What the engine reads from each role's structured output, and nothing more. A child's output
 * is untrusted: the CLI's `--json-schema` is a contract, not a guarantee, and a child may be
 * following instructions injected into what it read. Output that does not fit is handled like a
 * crash. The objects whose whole content the orchestrator is shown (questions, the spec, a
 * dispute) keep their unknown keys; every other object is cut down to the fields read.
 */
export const PR_URL_PATTERN = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

const SpecPath = z.string().refine((path) => isCanonicalPath(path) && path.endsWith(".md"), {
  message: "must be a canonical repo-relative path ending in .md",
});
const Question = z
  .object({
    id: z.string().min(1),
    text: z.string(),
    recommendation: z.string(),
    why_blocking: z.string(),
  })
  .passthrough();
const FindingShape = z.object({
  id: z.string().min(1),
  severity: z.enum(SEVERITIES),
  category: z.string().min(1),
  file: z.string().optional(),
  line: z.number().int().optional(),
  criterion: z.string().optional(),
  claim: z.string(),
  evidence: z.string(),
  expected: z.string(),
});

export const PlannerOutput = z
  .object({
    status: z.enum(["needs_input", "spec_ready"]),
    summary: z.string(),
    questions: z.array(Question).default([]),
    spec: z.object({ path: SpecPath }).passthrough().optional(),
    assumptions: z.array(z.string()).default([]),
  })
  .superRefine((out, ctx) => {
    if (out.status === "needs_input" && out.questions.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questions"],
        message: "needs_input requires at least one question",
      });
    }
    if (out.status === "spec_ready" && out.spec === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["spec"],
        message: "spec_ready requires a spec",
      });
    }
  });

export const TestAuthorOutput = z.object({
  status: z.literal("done"),
  tests: z.array(z.object({ path: z.string(), criteria: z.array(z.string()) })),
});

export const ExecutorOutput = z
  .object({
    status: z.enum(["done", "needs_input"]),
    claims: z.array(z.string()).default([]),
    questions: z.array(Question).default([]),
    dispute: z
      .object({ path: z.string(), reason: z.string(), evidence: z.string() })
      .passthrough()
      .optional(),
    pr_url: z.string().regex(PR_URL_PATTERN, "must be a github.com pull request URL").optional(),
  })
  .superRefine((out, ctx) => {
    if (out.status === "needs_input" && out.questions.length === 0 && !out.dispute) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["questions"],
        message: "needs_input requires a question or a dispute",
      });
    }
  });

export const VerifierOutput = z.object({
  status: z.literal("done"),
  verdict: z.enum(["PASS", "FAIL"]),
  criteria: z
    .array(
      z.object({
        id: z.string().min(1),
        result: z.enum(["met", "unmet", "unverifiable"]),
        evidence: z.string(),
      }),
    )
    .min(1),
  findings: z.array(FindingShape),
});

/** The retro's output is validated where it is applied (`applyRetro`); only its status is read here. */
export const RetroOutput = z.object({ status: z.literal("done") }).passthrough();

export const ChildOutputSchemas = {
  planner: PlannerOutput,
  "test-author": TestAuthorOutput,
  executor: ExecutorOutput,
  verifier: VerifierOutput,
  retro: RetroOutput,
} as const satisfies Record<Role, z.ZodTypeAny>;

type ChildOutput =
  | { role: "planner"; data: z.infer<typeof PlannerOutput> }
  | { role: "test-author"; data: z.infer<typeof TestAuthorOutput> }
  | { role: "executor"; data: z.infer<typeof ExecutorOutput> }
  | { role: "verifier"; data: z.infer<typeof VerifierOutput> }
  | { role: "retro"; data: z.infer<typeof RetroOutput> };
type Parsed<T> = { data: T } | { issue: string };

function parseOutput<T extends { status: string }>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  result: WaitResult,
): Parsed<T> {
  const parsed = schema.safeParse(result.structured);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { issue: `${first?.path.join(".") || "(root)"}: ${first?.message ?? "invalid"}` };
  }
  if (parsed.data.status !== result.outcome) {
    return {
      issue: `status: "${parsed.data.status}" does not match the reported outcome "${result.outcome}"`,
    };
  }
  return { data: parsed.data };
}

function readOutput(role: Role, result: WaitResult): ChildOutput | { issue: string } {
  switch (role) {
    case "planner": {
      const r = parseOutput(PlannerOutput, result);
      return "issue" in r ? r : { role, data: r.data };
    }
    case "test-author": {
      const r = parseOutput(TestAuthorOutput, result);
      return "issue" in r ? r : { role, data: r.data };
    }
    case "executor": {
      const r = parseOutput(ExecutorOutput, result);
      return "issue" in r ? r : { role, data: r.data };
    }
    case "verifier": {
      const r = parseOutput(VerifierOutput, result);
      return "issue" in r ? r : { role, data: r.data };
    }
    case "retro": {
      const r = parseOutput(RetroOutput, result);
      return "issue" in r ? r : { role, data: r.data };
    }
  }
}

const SpawnRecord = z.object({
  kind: z.literal("spawn"),
  role: z.enum(ROLES),
  assignment: Assignment,
  iteration: z.number().int().min(0),
  context: z.record(z.string(), z.string()),
  resume: z.boolean(),
});

function lastSpawnOf(run: Run, role: Role): SpawnAction {
  const parsed = SpawnRecord.safeParse(run.lastSpawn[role]);
  if (!parsed.success || parsed.data.role !== role) {
    throw new Error(`no previous spawn for ${role}`);
  }
  return parsed.data;
}

const STAGE_OF: Record<Role, Stage> = {
  planner: "planning",
  "test-author": "test_authoring",
  executor: "executing",
  verifier: "verifying",
  retro: "retro",
};
const CHILD_FAULTS = new Set(["crashed", "failed", "limited", "stalled"]);

const blocking = (f: Finding) => f.severity !== "minor";
const asFindings = (xs: Record<string, unknown>[]) => xs as unknown as Finding[];
const asRecords = (fs: readonly Finding[]) => fs as unknown as Record<string, unknown>[];
const unique = (xs: readonly string[]) => [...new Set(xs)];

const UNSPECIFIED_CLAIM = {
  gate: "gate failed without a blocking finding",
  verifier: "verifier rejected without a blocking finding",
  ci: "CI failed without a named failing job",
} as const;

/** A rejection always has something to fix: a verdict that names no finding gets this one. */
const unspecified = (source: keyof typeof UNSPECIFIED_CLAIM): Finding => ({
  id: `${source}-unspecified`,
  severity: "blocker",
  category: "gate",
  claim: UNSPECIFIED_CLAIM[source],
  evidence: `the ${source} verdict is a rejection and names no blocking finding`,
  expected: `the ${source} names what failed`,
});

/** A re-seal replaces the entries it names and leaves every other seal as it was. */
function mergeSealed(old: Run["sealed"], fresh: Run["sealed"]): Run["sealed"] {
  const byPath = new Map(old.map((s) => [s.path, s]));
  for (const s of fresh) byPath.set(s.path, s);
  return [...byPath.values()];
}

export function findingsText(fs: readonly Finding[]): string {
  if (!fs.length) return "(none)";
  return fs
    .map(
      (f) =>
        `- [${f.id}] ${f.severity}/${f.category}${f.file ? ` ${f.file}${f.line ? `:${f.line}` : ""}` : ""}: ${f.claim} — expected: ${f.expected}\n  evidence: ${f.evidence}`,
    )
    .join("\n");
}

/**
 * The next state and the work it implies, for one observation. Pure: the run and the observation
 * are never changed, and every spawn the decision emits is recorded in the returned run as the
 * last spawn of its role, which is what a crash retry or a halt retry repeats. An observation the
 * run's stage has no rule for throws, so that a runtime fault is never mistaken for progress.
 */
export function decide(run: Run, obs: Observation, rubric: Rubric, now: Date): Decision {
  const decision = step(run, obs, rubric, now);
  const spawns = decision.actions.filter((a): a is SpawnAction => a.kind === "spawn");
  if (spawns.length === 0) return decision;
  const lastSpawn = { ...decision.run.lastSpawn };
  for (const s of spawns) lastSpawn[s.role] = { ...structuredClone(s) };
  return { run: { ...decision.run, lastSpawn }, actions: decision.actions };
}

function step(run: Run, obs: Observation, rubric: Rubric, now: Date): Decision {
  const go = (r: Run, to: Stage, reason?: string) => transition(r, to, now, reason);
  const ask = (r: Run, judgment: JudgmentKind, payload: Record<string, unknown>): Decision => ({
    run: r,
    actions: [{ kind: "judgment", judgment, payload }],
  });
  const spawn = (
    r: Run,
    role: Role,
    context: Record<string, string>,
    resume = false,
  ): SpawnAction => {
    const tier = r.tier ?? r.stageA;
    const own = assignmentFor(tier, role, role === "executor" ? r.rung : 0, rubric);
    if (own === "skip") throw new Error(`${role} is skipped on tier ${tier}`);
    const assignment =
      role === "verifier"
        ? enforceVerifierFloor(assignmentFor(tier, "executor", r.rung, rubric), own)
        : own;
    return { kind: "spawn", role, assignment, iteration: r.iteration, context, resume };
  };
  const sealedList = (r: Run) =>
    r.sealed.map((s) => `- ${s.path} (${s.criteria.join(", ")})`).join("\n") || "(none)";
  const executorCtx = (r: Run, fs: readonly Finding[]) => ({
    iteration: String(r.iteration),
    branch: r.branch ?? "",
    spec: r.specPath ?? "",
    base: r.base,
    sealed: sealedList(r),
    findings: findingsText(fs),
  });
  const verifierCtx = (r: Run) => ({
    iteration: String(r.iteration),
    branch: r.branch ?? "",
    pr: r.prUrl ?? "(none)",
    spec: r.specPath ?? "",
    base: r.base,
    gate_report: JSON.stringify(r.gateReport ?? {}, null, 2),
    sealed: sealedList(r),
    previous: findingsText(asFindings(r.previousFindings)),
    claims: r.claims.map((c) => `- ${c}`).join("\n") || "(none)",
  });
  const testAuthorCtx = (r: Run, feedback: string) => ({
    spec: r.specPath ?? "",
    feedback: feedback || "(first attempt)",
  });
  const cancel = (r: Run, reason: string): Decision => {
    if (r.stage === "finalizing") {
      const closed = { ...go(r, "done"), haltReason: r.haltReason ?? reason };
      return { run: closed, actions: [{ kind: "notify", text: `halted: ${reason}` }] };
    }
    if (r.stage === "retro") {
      const fin = go({ ...r, haltReason: r.haltReason ?? reason }, "finalizing");
      return { run: fin, actions: [{ kind: "work", work: "finalize", data: { retro: null } }] };
    }
    const retro = go(go({ ...r, awaitingRole: null }, "halted", reason), "retro");
    return {
      run: retro,
      actions: [spawn(retro, "retro", {}), { kind: "notify", text: `halted: ${reason}` }],
    };
  };
  const toRetro = (r: Run): Decision => {
    const retro = go(r, "retro");
    return {
      run: retro,
      actions: [spawn(retro, "retro", {}), { kind: "notify", text: "CI green; retro started" }],
    };
  };
  /**
   * The one way to reopen test authoring, from a failed seal, a verifier fault in a sealed test
   * or an orchestrator's `revise_tests`. Each counts one attempt, and the attempt that reaches
   * the cap halts. The halted run records the spawn it would have made as the last spawn of the
   * test-author, so that a retry carries this feedback rather than the previous attempt's.
   */
  const reopenTests = (r: Run, feedback: string, reason: string, detail: unknown): Decision => {
    const counted: Run = { ...r, testAuthorAttempts: r.testAuthorAttempts + 1 };
    const reopened =
      r.stage === "test_authoring"
        ? counted
        : go({ ...counted, awaitingRole: null }, "test_authoring");
    const action = spawn(reopened, "test-author", testAuthorCtx(reopened, feedback));
    if (counted.testAuthorAttempts >= rubric.caps.test_author_attempts) {
      return ask(
        {
          ...counted,
          haltRole: "test-author",
          lastSpawn: { ...counted.lastSpawn, "test-author": { ...action } },
        },
        "halt",
        { reason, detail },
      );
    }
    return { run: reopened, actions: [action] };
  };
  const reject = (r: Run, source: "gate" | "verifier" | "ci", found: Finding[]): Decision => {
    const fs = found.length ? found : [unspecified(source)];
    const prints = fs.map(fingerprint);
    const last = r.rejections.at(-1)?.fingerprints ?? [];
    let rung = r.rung + 1;
    if (prints.some((p) => last.includes(p))) {
      while (rubric.escalation[rung - 1]?.startsWith("effort")) rung += 1;
    }
    const next: Run = {
      ...r,
      rung,
      previousFindings: asRecords(fs),
      rejections: [...r.rejections, { iteration: r.iteration, source, fingerprints: prints }],
    };
    const halted = (reason: string) =>
      ask({ ...next, haltRole: "executor" }, "halt", { reason, findings: fs });
    const stepNow = rubric.escalation[rung - 1];
    if (
      next.rejections.length >= rubric.caps.rejections ||
      stepNow === undefined ||
      stepNow === "halt"
    ) {
      return halted(`rejected ${next.rejections.length} times (last: ${source})`);
    }
    const exec = go({ ...next, iteration: r.iteration + 1 }, "executing");
    try {
      return {
        run: exec,
        actions: [
          spawn(exec, "executor", executorCtx(exec, fs)),
          {
            kind: "notify",
            text: `${source} rejected iteration ${r.iteration} (${fs.length} blocking); executor ${exec.iteration} started on rung ${rung}`,
          },
        ],
      };
    } catch (error) {
      if (error instanceof HaltError) return halted(error.message);
      throw error;
    }
  };
  /**
   * An orchestrator's retry of a halt. A role halted in its own stage repeats its last spawn; an
   * executor halted after a rejection starts a new iteration on the findings that were rejected,
   * at the last rung the ladder still allows; a test-author halted at its attempt cap reopens
   * test authoring. A halt with no role is a CI wait that polls again.
   */
  const retryHalt = (r: Run): Decision => {
    const cleared: Run = { ...r, retries: {}, haltRole: null };
    const role = r.haltRole;
    if (role === null) {
      if (r.stage === "ci_wait" || r.stage === "finalizing") {
        return { run: cleared, actions: [{ kind: "work", work: "ci" }] };
      }
      throw new Error(`nothing to retry in stage ${r.stage}`);
    }
    if (r.stage === STAGE_OF[role]) return { run: cleared, actions: [lastSpawnOf(r, role)] };
    if (role === "executor") {
      const halt = rubric.escalation.indexOf("halt");
      const usable = halt === -1 ? rubric.escalation.length : halt;
      const exec = go(
        { ...cleared, iteration: r.iteration + 1, rung: Math.min(r.rung, usable) },
        "executing",
      );
      return {
        run: exec,
        actions: [spawn(exec, "executor", executorCtx(exec, asFindings(r.previousFindings)))],
      };
    }
    if (role === "test-author") {
      const reopened = go({ ...cleared, awaitingRole: null }, "test_authoring");
      return { run: reopened, actions: [lastSpawnOf(r, role)] };
    }
    throw new Error(`cannot retry ${role} from stage ${r.stage}`);
  };

  const child = obs.kind === "child" ? obs : null;
  let output: ChildOutput | null = null;
  if (child) {
    const { role, result } = child;
    if (result.outcome === "running") throw new Error(`${role} is still running`);
    if (child.leaked?.length) {
      return ask({ ...run, haltRole: role }, "halt", {
        reason: `${role} wrote outside its worktree`,
        detail: child.leaked,
      });
    }
    if (child.mutated?.length) {
      return ask({ ...run, haltRole: role }, "halt", {
        reason: `${role} mutated the tree`,
        detail: child.mutated,
      });
    }
    let fault: { kind: string; reason: string; detail: string } | null = null;
    if (CHILD_FAULTS.has(result.outcome)) {
      fault = { kind: result.outcome, reason: `${role} ${result.outcome}`, detail: result.detail };
    } else {
      const read = readOutput(role, result);
      if ("issue" in read) {
        fault = {
          kind: "invalid",
          reason: `${role} returned invalid output (${read.issue})`,
          detail: read.issue,
        };
      } else output = read;
    }
    if (fault) {
      const tries = run.retries[role] ?? 0;
      const spent = tries >= rubric.caps.child_retries;
      if (role === "retro" && (spent || fault.kind === "limited")) {
        return {
          run: go(run, "finalizing"),
          actions: [{ kind: "work", work: "finalize", data: { retro: null } }],
        };
      }
      if (fault.kind === "limited" || fault.kind === "stalled" || spent) {
        return ask({ ...run, haltRole: role }, "halt", {
          reason: fault.reason,
          detail: fault.detail,
        });
      }
      return {
        run: { ...run, retries: { ...run.retries, [role]: tries + 1 } },
        actions: [lastSpawnOf(run, role)],
      };
    }
  }
  if (obs.kind === "answer" && obs.judgment === "halt") {
    if (obs.answer.kind === "cancel") return cancel(run, obs.answer.reason);
    if (obs.answer.kind !== "retry") {
      throw new Error(`a halt cannot be answered with ${obs.answer.kind}`);
    }
    return retryHalt(run);
  }

  switch (run.stage) {
    case "intake":
      if (obs.kind === "start") {
        const r = go(run, "planning");
        return {
          run: r,
          actions: [
            spawn(r, "planner", { task: r.task.english, critic_cap: String(criticCap(r, rubric)) }),
          ],
        };
      }
      break;
    case "planning": {
      if (output?.role !== "planner") break;
      const out = output.data;
      if (out.status === "needs_input") {
        if (run.questionsAnswered + out.questions.length > rubric.caps.planner_questions) {
          const lines = out.questions.map(
            (q) => `${q.id}: ${q.recommendation} (recommendation accepted: question cap reached)`,
          );
          const r = { ...run, assumptions: unique([...run.assumptions, ...lines]) };
          return {
            run: r,
            actions: [spawn(r, "planner", { message: `ANSWERS:\n${lines.join("\n")}` }, true)],
          };
        }
        return ask(
          go({ ...run, awaitingRole: "planner" }, "awaiting_answer"),
          "planner_questions",
          { questions: out.questions },
        );
      }
      if (!child?.signals) throw new Error("spec_ready observation carries no signals");
      const { tier, reasons } = tierFor(child.signals, rubric);
      const assumptions = unique([...run.assumptions, ...out.assumptions]);
      const r = go(
        { ...run, specPath: out.spec?.path ?? null, tier, tierReasons: reasons, assumptions },
        "awaiting_approval",
      );
      return ask(r, "spec_approval", {
        spec: out.spec,
        summary: out.summary,
        tier,
        reasons,
        assumptions,
        assignments: previewAssignments(r, rubric),
      });
    }
    case "awaiting_answer": {
      if (obs.kind !== "answer") break;
      const role = run.awaitingRole ?? "planner";
      if (obs.judgment !== (role === "planner" ? "planner_questions" : "executor_questions")) break;
      const a = obs.answer;
      if (a.kind === "cancel") return cancel(run, a.reason);
      if (a.kind === "answers") {
        const r = go(
          { ...run, awaitingRole: null, questionsAnswered: run.questionsAnswered + a.count },
          role === "planner" ? "planning" : "executing",
        );
        return { run: r, actions: [spawn(r, role, { message: `ANSWERS:\n${a.text}` }, true)] };
      }
      if (a.kind === "revise_tests" && role === "executor") {
        return reopenTests(run, a.text, "the sealed tests were revised too often", [a.text]);
      }
      break;
    }
    case "awaiting_approval": {
      if (obs.kind !== "answer" || obs.judgment !== "spec_approval") break;
      const a = obs.answer;
      if (a.kind === "cancel") return cancel(run, a.reason);
      if (a.kind === "changes") {
        const r = go(run, "planning");
        return {
          run: r,
          actions: [spawn(r, "planner", { message: `CHANGES REQUESTED:\n${a.text}` }, true)],
        };
      }
      if (a.kind === "approve") {
        const tiered = a.tier
          ? {
              ...run,
              tier: a.tier,
              tierReasons: [...run.tierReasons, `override: ${a.reason ?? "orchestrator"}`],
            }
          : run;
        const rename: Action = { kind: "work", work: "rename_branch" };
        if (shouldAuthorTests(tiered, rubric)) {
          const r = go(tiered, "test_authoring");
          return { run: r, actions: [rename, spawn(r, "test-author", testAuthorCtx(r, ""))] };
        }
        const r = go({ ...tiered, iteration: 1 }, "executing");
        return { run: r, actions: [rename, spawn(r, "executor", executorCtx(r, []))] };
      }
      break;
    }
    case "test_authoring": {
      if (output?.role === "test-author") {
        return {
          run,
          actions: [{ kind: "work", work: "seal", data: { tests: output.data.tests } }],
        };
      }
      if (obs.kind === "seal") {
        if (obs.ok === true && obs.reasons.length === 0 && obs.sealed.length > 0) {
          const r = go(
            { ...run, sealed: mergeSealed(run.sealed, obs.sealed), iteration: run.iteration + 1 },
            "executing",
          );
          return {
            run: r,
            actions: [spawn(r, "executor", executorCtx(r, asFindings(run.previousFindings)))],
          };
        }
        const reasons = obs.reasons.length
          ? obs.reasons
          : [obs.ok ? "seal reported success but sealed no tests" : "seal failed without a reason"];
        return reopenTests(run, reasons.join("\n"), "acceptance tests rejected", reasons);
      }
      break;
    }
    case "executing": {
      if (output?.role !== "executor") break;
      const out = output.data;
      if (out.status === "needs_input") {
        return ask(
          go({ ...run, awaitingRole: "executor" }, "awaiting_answer"),
          "executor_questions",
          {
            questions: out.questions,
            dispute: out.dispute ?? null,
          },
        );
      }
      const r = go({ ...run, claims: out.claims, prUrl: out.pr_url ?? run.prUrl }, "gating");
      return { run: r, actions: [{ kind: "work", work: "gate" }] };
    }
    case "gating": {
      if (obs.kind !== "gate") break;
      const blockers = obs.findings.filter(blocking);
      if (obs.report.passed !== true || blockers.length > 0) return reject(run, "gate", blockers);
      const minors = asRecords(obs.findings);
      const r = go(
        {
          ...run,
          gateReport: obs.report as unknown as Record<string, unknown>,
          minorFindings: [...run.minorFindings, ...minors],
        },
        "verifying",
      );
      return {
        run: r,
        actions: [{ kind: "work", work: "snapshot" }, spawn(r, "verifier", verifierCtx(r))],
      };
    }
    case "verifying": {
      if (output?.role !== "verifier") break;
      const v = output.data;
      const unmet = v.criteria
        .filter((c) => c.result === "unmet")
        .map<Finding>((c) => ({
          id: `AC-${c.id}`,
          severity: "blocker",
          category: "criterion",
          criterion: c.id,
          claim: `criterion ${c.id} unmet`,
          evidence: c.evidence,
          expected: `criterion ${c.id} met`,
        }));
      const unverifiable = v.criteria
        .filter((c) => c.result === "unverifiable")
        .map<Finding>((c) => ({
          id: `AC-${c.id}-unverifiable`,
          severity: "minor",
          category: "criterion",
          criterion: c.id,
          claim: `criterion ${c.id} could not be verified`,
          evidence: c.evidence,
          expected: "human check",
        }));
      const all = [...v.findings, ...unmet];
      const blockers = all.filter(blocking);
      const base = {
        ...run,
        minorFindings: [
          ...run.minorFindings,
          ...asRecords([...all.filter((f) => !blocking(f)), ...unverifiable]),
        ],
      };
      const sealedPaths = new Set(run.sealed.map((s) => s.path));
      const testFaults = blockers.filter(
        (f) => f.category === "test-quality" && f.file && sealedPaths.has(f.file),
      );
      if (testFaults.length && testFaults.length === blockers.length) {
        return reopenTests(
          base,
          findingsText(testFaults),
          "the verifier faulted the sealed tests",
          testFaults,
        );
      }
      if (blockers.length) return reject(base, "verifier", blockers);
      if (v.verdict !== "PASS") {
        const tries = run.retries.verifier ?? 0;
        if (tries >= rubric.caps.child_retries) {
          return ask({ ...base, haltRole: "verifier" }, "halt", {
            reason: "verifier returned FAIL without blocking findings",
          });
        }
        const r = { ...base, retries: { ...base.retries, verifier: tries + 1 } };
        return {
          run: r,
          actions: [{ kind: "work", work: "snapshot" }, spawn(r, "verifier", verifierCtx(r))],
        };
      }
      const r = go(base, "ci_wait");
      return {
        run: r,
        actions: [
          { kind: "work", work: "ci" },
          { kind: "notify", text: `verifier PASS on iteration ${run.iteration}` },
        ],
      };
    }
    case "ci_wait": {
      if (obs.kind === "answer") {
        if (obs.judgment !== "no_ci") break;
        const a = obs.answer;
        if (a.kind === "cancel") return cancel(run, a.reason);
        if (a.kind === "proceed") return toRetro(run);
        if (a.kind === "wait") return { run, actions: [{ kind: "work", work: "ci" }] };
        break;
      }
      if (obs.kind !== "ci") break;
      if (obs.state === "pending") return { run, actions: [{ kind: "work", work: "ci" }] };
      if (obs.state === "green" && obs.failing.length === 0) return toRetro(run);
      if (obs.state === "no_ci") return ask(run, "no_ci", {});
      if (obs.state === "closed")
        return ask({ ...run, haltRole: null }, "halt", { reason: "PR was closed" });
      const fs: Finding[] =
        obs.state === "conflict"
          ? [
              {
                id: "CI-conflict",
                severity: "blocker",
                category: "gate",
                claim: `PR conflicts with ${run.base}`,
                evidence: "mergeable=CONFLICTING",
                expected: `merge origin/${run.base} into the branch (no rebase, no force-push) and resolve`,
              },
            ]
          : obs.failing.map((name) => ({
              id: `CI-${name}`,
              severity: "blocker",
              category: "gate",
              claim: `CI job ${name} failed`,
              evidence: "see the PR checks",
              expected: `${name} green`,
            }));
      return reject(run, "ci", fs);
    }
    case "retro": {
      if (output?.role === "retro") {
        return {
          run: go(run, "finalizing"),
          actions: [{ kind: "work", work: "finalize", data: { retro: child?.result.structured } }],
        };
      }
      break;
    }
    case "finalizing": {
      if (obs.kind === "finalized") {
        if (run.haltReason) {
          return {
            run: go(run, "done"),
            actions: [{ kind: "notify", text: "halted run closed; retro saved" }],
          };
        }
        return { run: { ...run, finalized: true }, actions: [{ kind: "work", work: "ci" }] };
      }
      if (obs.kind === "ci") {
        if (obs.state === "pending") return { run, actions: [{ kind: "work", work: "ci" }] };
        if (obs.state === "green" && obs.failing.length === 0) {
          return {
            run: go(run, "ready"),
            actions: [
              { kind: "work", work: "mark_ready" },
              { kind: "notify", text: "PR ready to merge" },
            ],
          };
        }
        return ask({ ...run, haltRole: null }, "halt", {
          reason:
            obs.state === "green"
              ? "CI reports green but names failing jobs after finalize"
              : `CI ${obs.state} after finalize`,
          failing: obs.failing,
        });
      }
      break;
    }
    default:
      break;
  }
  const detail = obs.kind === "answer" ? ` (${obs.judgment}: ${obs.answer.kind})` : "";
  throw new Error(`no rule for stage ${run.stage} and observation ${obs.kind}${detail}`);
}
