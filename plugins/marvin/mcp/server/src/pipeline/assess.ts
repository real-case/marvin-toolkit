import { parse } from "yaml";
import { z } from "zod";
import { parseFrontmatter } from "../storage/frontmatter.js";
import { extractContractBlock } from "../storage/spec.js";
import { modelFamily, type ModelFamily } from "./command.js";
import {
  type Assignment,
  EFFORTS,
  type Effort,
  type Role,
  type Run,
  type Tier,
} from "./run-store.js";

const AssignmentText = z.union([
  z.literal("skip"),
  z.string().regex(new RegExp(`^[A-Za-z0-9.-]+/(${EFFORTS.join("|")})$`)),
]);
const RoleRow = z.object({
  planner: AssignmentText,
  "test-author": AssignmentText,
  executor: AssignmentText,
  verifier: AssignmentText,
  retro: AssignmentText,
});
const Risk = z.enum(["low", "medium", "high"]);
type Risk = z.infer<typeof Risk>;

export const Rubric = z.object({
  version: z.literal(1),
  tiers: z.object({
    light: z.object({ max_files: z.number().int().min(0), risk: z.array(Risk) }),
    heavy: z.object({ min_files: z.number().int().min(1), risk: z.array(Risk) }),
  }),
  assignments: z.object({ light: RoleRow, standard: RoleRow, heavy: RoleRow }),
  escalation: z.array(z.string().regex(/^(effort\+1|model:[A-Za-z0-9.-]+|halt)$/)),
  caps: z.object({
    rejections: z.number().int().min(1),
    planner_questions: z.number().int().min(0),
    test_author_attempts: z.number().int().min(1),
    child_retries: z.number().int().min(0),
    spec_critic: z.object({ light: z.number().int().min(1), default: z.number().int().min(1) }),
  }),
  sensitive_paths: z.array(z.string()),
  cross_repo_markers: z.array(z.string()),
  slicing: z.object({
    enabled: z.boolean(),
    min_criteria: z.number().int(),
    min_files: z.number().int(),
  }),
});
export type Rubric = z.infer<typeof Rubric>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function merge(base: unknown, over: unknown): unknown {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

function parseYaml(text: string, what: string): unknown {
  try {
    return parse(text);
  } catch (err) {
    throw new Error(`${what} is not valid YAML: ${reason(err)}`, { cause: err });
  }
}

const describeIssues = (err: z.ZodError) =>
  err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");

function assertPatternsCompile(key: "sensitive_paths" | "cross_repo_markers", list: string[]) {
  for (const entry of list) {
    try {
      new RegExp(entry);
    } catch (err) {
      throw new Error(
        `${key} entry ${JSON.stringify(entry)} is not a valid regular expression: ${reason(err)}`,
        { cause: err },
      );
    }
  }
}

/**
 * Merge the project rubric over the shipped default and validate the result completely, so
 * that nothing the engine later reads from a rubric can be malformed: every model passes the
 * pipeline's model rule (Fable and unknown models are refused here, not when a child
 * launches), every pattern compiles, and the escalation ladder and tier bounds are coherent.
 */
export function loadRubric(defaultText: string, projectText: string | null): Rubric {
  const over = projectText ? parseYaml(projectText, "the project rubric") : undefined;
  const parsed = Rubric.safeParse(
    merge(parseYaml(defaultText, "the default rubric"), over ?? undefined),
  );
  if (!parsed.success) throw new Error(`invalid rubric: ${describeIssues(parsed.error)}`);
  const rubric = parsed.data;

  for (const row of Object.values(rubric.assignments)) {
    for (const text of Object.values(row)) {
      if (text !== "skip") modelFamily(text.slice(0, text.indexOf("/")));
    }
  }
  for (const step of rubric.escalation) {
    if (step.startsWith("model:")) modelFamily(step.slice("model:".length));
  }

  assertPatternsCompile("sensitive_paths", rubric.sensitive_paths);
  assertPatternsCompile("cross_repo_markers", rubric.cross_repo_markers);

  const { escalation, tiers } = rubric;
  if (escalation.length === 0) throw new Error("escalation must list at least one step");
  if (escalation.some((step, i) => step === "halt" && i !== escalation.length - 1)) {
    throw new Error("escalation: halt must be the last step");
  }
  if (tiers.light.max_files >= tiers.heavy.min_files) {
    throw new Error(
      `tiers.light.max_files (${tiers.light.max_files}) must be below tiers.heavy.min_files (${tiers.heavy.min_files})`,
    );
  }
  return rubric;
}

export interface Signals {
  risk: Risk;
  bugfix: boolean;
  files: number;
  newFiles: number;
  criteria: number;
  paths: string[];
  sensitive: string[];
  crossRepo: string[];
}

const toRisk = (value: string | undefined): Risk => {
  const v = value?.trim().toLowerCase();
  return v === "low" || v === "medium" ? v : v === "high" || v === "critical" ? "high" : "medium";
};

const ContractShape = z.object({
  files: z.array(z.object({ path: z.string().min(1), action: z.string().optional() })).default([]),
  criteria: z.array(z.object({ id: z.string().min(1) })).default([]),
});

/**
 * Only the three fields tiering needs are read from the contract (`files[].path`,
 * `files[].action`, `criteria[].id`). The block is found by the finder the gate uses, so a spec
 * the gate can read is a spec this can read; the shape is deliberately looser than the gate's
 * `SpecContract` because tiering has no use for the rest of the row.
 */
function readContract(specText: string): z.infer<typeof ContractShape> {
  const block = extractContractBlock(specText);
  if (block === null) throw new Error("spec has no spec-contract block");
  const parsed = ContractShape.safeParse(parseYaml(block, "the spec-contract block"));
  if (!parsed.success) {
    throw new Error(`spec-contract block is invalid: ${describeIssues(parsed.error)}`);
  }
  return parsed.data;
}

export function readSignals(specText: string, rubric: Rubric): Signals {
  const text = specText.replace(/\r\n?/g, "\n");
  const { frontmatter } = parseFrontmatter(text);
  const { files, criteria } = readContract(text);
  const paths = files.map((f) => f.path);
  const sensitive = rubric.sensitive_paths.map((r) => new RegExp(r));
  return {
    risk: toRisk(frontmatter.risk ?? frontmatter.severity),
    bugfix: frontmatter.type === "bugfix" || Object.hasOwn(frontmatter, "severity"),
    files: files.length,
    newFiles: files.filter((f) => f.action === "new").length,
    criteria: criteria.length,
    paths,
    sensitive: paths.filter((p) => sensitive.some((re) => re.test(p))),
    crossRepo: rubric.cross_repo_markers.filter((m) => new RegExp(m).test(text)),
  };
}

export function tierFor(s: Signals, r: Rubric): { tier: Tier; reasons: string[] } {
  const heavy: string[] = [];
  if (r.tiers.heavy.risk.includes(s.risk)) heavy.push(`risk ${s.risk}`);
  if (s.files >= r.tiers.heavy.min_files) heavy.push(`${s.files} contract files`);
  heavy.push(
    ...s.sensitive.map((p) => `sensitive path ${p}`),
    ...s.crossRepo.map((m) => `cross-repo marker ${m}`),
  );
  if (heavy.length) return { tier: "heavy", reasons: heavy };
  const base = [`risk ${s.risk}`, `${s.files} contract files`];
  if (r.tiers.light.risk.includes(s.risk) && s.files <= r.tiers.light.max_files) {
    return { tier: "light", reasons: base };
  }
  return { tier: "standard", reasons: base };
}

const toAssignment = (text: string): Assignment => {
  const [model = "", effort = ""] = text.split("/");
  return { model, effort: effort as Effort };
};

const exhausted = (rung: number) =>
  new Error(`halt: the escalation ladder is exhausted at rung ${rung}`);

/**
 * What a role runs as. Only the executor climbs the escalation ladder: `rung` is the number of
 * steps already spent, a `halt` step (or running past the last step) throws, and a rubric that
 * skipped `loadRubric` still cannot name a model the pipeline refuses.
 */
export function assignmentFor(
  tier: Tier,
  role: Role,
  rung: number,
  r: Rubric,
): Assignment | "skip" {
  if (!Number.isInteger(rung) || rung < 0) throw new Error(`invalid escalation rung: ${rung}`);
  const raw = r.assignments[tier][role];
  if (raw === "skip") return "skip";
  let a = toAssignment(raw);
  if (role === "executor") {
    for (const step of r.escalation.slice(0, rung)) {
      if (step === "halt") throw exhausted(rung);
      if (step === "effort+1") {
        const next = Math.min(EFFORTS.indexOf(a.effort) + 1, EFFORTS.length - 1);
        a = { ...a, effort: EFFORTS[next]! };
      } else a = { ...a, model: step.slice("model:".length) };
    }
    if (rung > r.escalation.length) throw exhausted(rung);
  }
  modelFamily(a.model);
  return a;
}

const RANK: Record<ModelFamily, number> = { haiku: 0, sonnet: 1, opus: 2 };

/**
 * The verifier is never weaker than the executor it checks, on either axis: its model family
 * is at least the executor's (it keeps its own model string when it already is) and its effort
 * is the higher of the two.
 */
export function enforceVerifierFloor(executor: Assignment, verifier: Assignment): Assignment {
  const model =
    RANK[modelFamily(verifier.model)] >= RANK[modelFamily(executor.model)]
      ? verifier.model
      : executor.model;
  const effort =
    EFFORTS[Math.max(EFFORTS.indexOf(executor.effort), EFFORTS.indexOf(verifier.effort))]!;
  return { model, effort };
}

export const fingerprint = (f: { category: string; file?: string; criterion?: string }) =>
  `${f.category}|${f.file ?? ""}|${f.criterion ?? ""}`;

export const shouldAuthorTests = (run: Run, r: Rubric) =>
  assignmentFor(run.tier ?? run.stageA, "test-author", 0, r) !== "skip";

export const criticCap = (run: Run, r: Rubric) =>
  (run.tier ?? run.stageA) === "light" ? r.caps.spec_critic.light : r.caps.spec_critic.default;

export function previewAssignments(run: Run, r: Rubric): Record<Role, string> {
  const tier = run.tier ?? run.stageA;
  const show = (role: Role) => {
    const a = assignmentFor(tier, role, 0, r);
    return a === "skip" ? "skip" : `${a.model}/${a.effort}`;
  };
  return {
    planner: show("planner"),
    "test-author": show("test-author"),
    executor: show("executor"),
    verifier: show("verifier"),
    retro: show("retro"),
  };
}
