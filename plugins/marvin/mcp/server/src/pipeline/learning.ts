import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { createContext, Script } from "node:vm";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { parseFrontmatter } from "../storage/frontmatter.js";
import { addLesson, findNearDuplicate, LESSON_TYPES } from "../storage/lessons.js";
import { isSafeBranchRef } from "../storage/slug.js";
import {
  type CheckRule,
  isCanonicalPath,
  isolatedGit,
  type Runner,
  SEVERITIES,
  shellRunner,
} from "./gate.js";
import type { PipelineEvent, Role, Run } from "./run-store.js";
import { shellQuote } from "./seal.js";

const CHECKS_PATH = ".marvin/pipeline/checks.yaml";
const CALIBRATION_PATH = ".marvin/pipeline/calibration.jsonl";
const MEMORY_DIR = ".marvin/memory";
/** The index `addLesson` appends to; it changes whenever a lesson is added. */
const MEMORY_INDEX_PATH = `${MEMORY_DIR}/MEMORY.md`;

export interface LessonDoc {
  id: string;
  title: string;
  tags: string[];
  body: string;
}

export function rankLessons(
  lessons: readonly LessonDoc[],
  o: { role: Role; paths: readonly string[]; limit: number },
): LessonDoc[] {
  const terms = new Set(
    o.paths.flatMap((p) => p.toLowerCase().split(/[/._()-]+/)).filter((t) => t.length > 3),
  );
  const score = (l: LessonDoc) => {
    const hay = `${l.title} ${l.tags.join(" ")} ${l.body}`.toLowerCase();
    let s = [...terms].filter((t) => hay.includes(t)).length;
    if (o.paths.some((p) => l.body.includes(p))) s += 5;
    if (s > 0 && l.tags.includes(`role:${o.role}`)) s += 3;
    return s;
  };
  return lessons
    .map((l) => ({ l, s: score(l) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, o.limit)
    .map((x) => x.l);
}

export const lessonsMarkdown = (ls: readonly LessonDoc[]) =>
  ls.length ? ls.map((l) => `- ${l.title} — .marvin/memory/${l.id}.md`).join("\n") : "(none)";

export interface RetroAggregate {
  tier: string | null;
  tierReasons: string[];
  iterations: number;
  rung: number;
  rejections: Run["rejections"];
  findingCategories: string[];
  repeatedFingerprints: string[];
  questions: { byOrchestrator: number; byUser: number };
  perRole: { role: Role; costUsd: number; cacheReadTokens: number }[];
  halted: string | null;
  assumptions: string[];
}

/**
 * What the retro child and the calibration record both read. Fingerprints are
 * `category|file|criterion`, so a finding's category is the part before the first `|`.
 * Who answered a question is `data.answeredBy` (`orchestrator` or `user`) on an `answer` event.
 */
export function aggregate(run: Run, events: readonly PipelineEvent[]): RetroAggregate {
  const prints = run.rejections.flatMap((r) => r.fingerprints);
  const answers = events.filter((e) => e.kind === "answer");
  const perRole = new Map<Role, { costUsd: number; cacheReadTokens: number }>();
  for (const c of run.children) {
    const cur = perRole.get(c.role) ?? { costUsd: 0, cacheReadTokens: 0 };
    perRole.set(c.role, {
      costUsd: cur.costUsd + (c.costUsd ?? 0),
      cacheReadTokens: cur.cacheReadTokens + (c.cacheReadTokens ?? 0),
    });
  }
  return {
    tier: run.tier,
    tierReasons: run.tierReasons,
    iterations: run.iteration,
    rung: run.rung,
    rejections: run.rejections,
    findingCategories: [...new Set(prints.map((p) => p.split("|")[0] ?? "").filter(Boolean))],
    repeatedFingerprints: [...new Set(prints.filter((p, i) => prints.indexOf(p) !== i))],
    questions: {
      byOrchestrator: answers.filter((e) => e.data?.answeredBy === "orchestrator").length,
      byUser: answers.filter((e) => e.data?.answeredBy === "user").length,
    },
    perRole: [...perRole.entries()].map(([role, v]) => ({ role, ...v })),
    halted: run.haltReason,
    assumptions: run.assumptions,
  };
}

export interface CalibrationRecord {
  ts: string;
  runId: string;
  tier: string | null;
  stageA: string;
  signalsReasons: string[];
  aggregate: RetroAggregate;
  findingCategories: string[];
  exposedLessons: string[];
}

export function calibrationRecord(
  run: Run,
  agg: RetroAggregate,
  exposedLessons: readonly string[],
): CalibrationRecord {
  return {
    ts: run.updatedAt,
    runId: run.id,
    tier: run.tier,
    stageA: run.stageA,
    signalsReasons: run.tierReasons,
    aggregate: agg,
    findingCategories: agg.findingCategories,
    exposedLessons: [...exposedLessons],
  };
}

export interface EfficacyItem {
  id: string;
  kind: "lesson" | "check";
  createdAt: string;
  targetCategory: string;
}
export type EfficacyVerdict = "too-early" | "prune-candidate" | "keep";
export interface EfficacyResult {
  id: string;
  exposure: number;
  before: number;
  after: number;
  verdict: EfficacyVerdict;
}

/** Records needed on each side of an item's creation before its effect is judged. */
const MIN_RECORDS = 5;
/** How many of the records before an item was created make up its baseline. */
const BASELINE_WINDOW = 10;

/**
 * Did the findings an item targets get rarer once it existed? The baseline is the last ten
 * records before `createdAt`, the exposure every record after it that carried the lesson (any
 * record, for a check). With fewer than five on either side there is nothing to compare, and
 * an item whose findings did not drop is a prune candidate.
 */
export function efficacy(
  records: readonly { ts: string; findingCategories: string[]; exposedLessons: string[] }[],
  items: readonly EfficacyItem[],
): EfficacyResult[] {
  const ordered = [...records].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return items.map((it) => {
    const before = ordered.filter((r) => r.ts < it.createdAt).slice(-BASELINE_WINDOW);
    const after = ordered.filter(
      (r) => r.ts >= it.createdAt && (it.kind === "check" || r.exposedLessons.includes(it.id)),
    );
    const rate = (rs: typeof ordered) =>
      rs.length
        ? rs.filter((r) => r.findingCategories.includes(it.targetCategory)).length / rs.length
        : 0;
    const verdict: EfficacyVerdict =
      before.length < MIN_RECORDS || after.length < MIN_RECORDS
        ? "too-early"
        : rate(after) >= rate(before)
          ? "prune-candidate"
          : "keep";
    return { id: it.id, exposure: after.length, before: rate(before), after: rate(after), verdict };
  });
}

const MAX_PATTERN_LENGTH = 500;
const CHECK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CATEGORY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ONE_LINE = /^[^\r\n]+$/;

/** The quantifier at `source[i]`: its length (a lazy `?` included) and whether it can repeat. */
function quantifierAt(source: string, i: number): { length: number; repeats: boolean } | null {
  const ch = source[i];
  let length: number;
  let repeats: boolean;
  if (ch === "*" || ch === "+" || ch === "?") {
    length = 1;
    repeats = ch !== "?";
  } else if (ch === "{") {
    const braces = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i, i + 32));
    if (!braces) return null;
    length = braces[0].length;
    repeats =
      braces[2] === undefined ? Number(braces[1]) > 1 : braces[3] === "" || Number(braces[3]) > 1;
  } else {
    return null;
  }
  return { length: source[i + length] === "?" ? length + 1 : length, repeats };
}

/**
 * The shapes that make a backtracking engine take exponential time, found by reading the
 * pattern: a backreference, a repeated group that holds a quantifier (`(a+)+`), a repeated
 * group that holds an alternation (`(a|aa)+`). Deliberately conservative: it also refuses the
 * harmless ones, which can be written without the group.
 */
function staticRegexHazard(source: string): string | null {
  type Frame = { quantified: boolean; alternation: boolean };
  const stack: Frame[] = [{ quantified: false, alternation: false }];
  let i = 0;
  while (i < source.length) {
    const top = stack[stack.length - 1]!;
    const ch = source[i]!;
    if (ch === "\\") {
      const next = source[i + 1];
      if (next !== undefined && (/[1-9]/.test(next) || (next === "k" && source[i + 2] === "<"))) {
        return "it holds a backreference";
      }
      i += 2;
    } else if (ch === "[") {
      i += 1;
      while (i < source.length && source[i] !== "]") i += source[i] === "\\" ? 2 : 1;
      i += 1;
    } else if (ch === "(") {
      stack.push({ quantified: false, alternation: false });
      i += 1;
      if (source[i] === "?") {
        i += 1;
        const kind = source[i];
        if (kind === ":" || kind === "=" || kind === "!") {
          i += 1;
        } else if (kind === "<") {
          i += 1;
          if (source[i] === "=" || source[i] === "!") i += 1;
          else i = source.indexOf(">", i) + 1 || source.length;
        }
      }
    } else if (ch === ")") {
      const group = stack.length > 1 ? stack.pop()! : top;
      const parent = stack[stack.length - 1]!;
      i += 1;
      const quantifier = quantifierAt(source, i);
      if (quantifier) {
        if (quantifier.repeats && group.quantified) {
          return "it has a nested quantifier: a repeated group that already holds a quantifier";
        }
        if (quantifier.repeats && group.alternation) {
          return "it repeats a group that holds an alternation";
        }
        i += quantifier.length;
      }
      parent.quantified ||= group.quantified || quantifier !== null;
      parent.alternation ||= group.alternation;
    } else if (ch === "|") {
      top.alternation = true;
      i += 1;
    } else {
      const quantifier = quantifierAt(source, i);
      if (quantifier) top.quantified = true;
      i += quantifier ? quantifier.length : 1;
    }
  }
  return null;
}

/** A line this long, and this much time, is what the gate would give a rule per added line. */
const PROBE_LENGTH = 5_000;
const PROBE_BUDGET_MS = 250;
const PROBE_CHARS = ["a", "x", "0", " ", ".", "/", "-", "_"];
const PROBE_ENDS = ["!", "\n"];

/**
 * Does matching `source` over a long line of one repeated character, ended by one that breaks
 * an anchor, take longer than the budget? What the static read cannot see (`a*a*a*b`) shows
 * here. The match runs in a vm with a timeout, which interrupts a regular expression mid-match.
 */
function slowOnLongLine(source: string): boolean {
  const context = createContext({ source, input: "" });
  const script = new Script("new RegExp(source).test(input)");
  for (const ch of PROBE_CHARS) {
    for (const end of PROBE_ENDS) {
      context.input = ch.repeat(PROBE_LENGTH) + end;
      try {
        script.runInContext(context, { timeout: PROBE_BUDGET_MS });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return true;
      }
    }
  }
  return false;
}

/**
 * Why a retro-proposed pattern must not run over every added line, or null. The gate runs these
 * synchronously, so one that backtracks without bound would stall every later run.
 */
export function regexHazard(source: string): string | null {
  return (
    staticRegexHazard(source) ??
    (slowOnLongLine(source)
      ? `it is too slow to run over every added line: no match within ${PROBE_BUDGET_MS} ms on a ${PROBE_LENGTH}-character line`
      : null)
  );
}

const regexSource = z
  .string()
  .min(1)
  .max(MAX_PATTERN_LENGTH)
  .superRefine((value, ctx) => {
    try {
      new RegExp(value);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `not a valid regular expression: ${why}`,
      });
      return;
    }
    const hazard = regexHazard(value);
    if (hazard !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unsafe regular expression: ${hazard}`,
      });
    }
  });
const oneLine = z.string().trim().min(1).max(200).regex(ONE_LINE, "must be a single line");
const text = z.string().trim().min(1);

const RetroSchema = z.object({
  checks: z.array(
    z.object({
      id: z.string().regex(CHECK_ID, `must match ${CHECK_ID}`),
      pattern: regexSource,
      path_pattern: regexSource.optional(),
      exclude_pattern: regexSource.optional(),
      message: text,
      severity: z.enum(SEVERITIES).optional(),
      category: z.string().regex(CATEGORY, `must match ${CATEGORY}`).optional(),
      evidence: z.array(z.string()).optional(),
    }),
  ),
  proposals: z.array(
    z.object({
      target: z.enum(["marvin", "project"]),
      file: oneLine,
      change: text,
      rationale: text,
      evidence: z.array(z.string()),
    }),
  ),
  lessons: z.array(
    z.object({
      type: z.enum(LESSON_TYPES),
      title: oneLine,
      body: text,
      tags: z.array(
        z
          .string()
          .trim()
          .min(1)
          .max(64)
          .regex(/^[^,\r\n]+$/, "must not hold a comma or a line break"),
      ),
      target_category: z.string().regex(CATEGORY, `must match ${CATEGORY}`),
      evidence: z.array(z.string()),
    }),
  ),
  prune: z.array(z.object({ id: oneLine, reason: text })),
});

export type RetroOutput = z.infer<typeof RetroSchema>;
export type RetroLesson = RetroOutput["lessons"][number];

/**
 * The retro child reads other children's output, so what it returns is untrusted: this is the
 * only way in, and it throws on the first violation, before anything is written.
 */
export function parseRetro(raw: unknown): RetroOutput {
  const parsed = RetroSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`retro output rejected: ${issues.join("; ")}`);
}

/**
 * Why `rel` is not a plain path beneath `root`, or null. A symbolic link at any component, or a
 * file where a directory belongs, is a problem; a component that does not exist yet is not. With
 * no link below `root`, everything under it is physically under `root`, whatever `root` is.
 */
function physicalProblem(root: string, rel: string): string | null {
  const parts = rel.split("/");
  let current = root;
  for (const [i, part] of parts.entries()) {
    current = join(current, part);
    const where = parts.slice(0, i + 1).join("/");
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ENOENT" ? null : `${where} cannot be inspected (${code ?? String(error)})`;
    }
    if (stat.isSymbolicLink()) return `${where} is a symbolic link`;
    if (i < parts.length - 1 && !stat.isDirectory()) return `${where} is not a directory`;
  }
  return null;
}

/**
 * The engine writes into a worktree a child has had its hands on, and into a run dir. A planted
 * symbolic link would send a write somewhere else (the main checkout, a dotfile), so every
 * path is checked before it is read or written, and a link is refused rather than followed.
 */
function assertPlain(root: string, rel: string): void {
  const problem = physicalProblem(root, rel);
  if (problem !== null) throw new Error(`refusing to use ${rel} under ${root}: ${problem}`);
}

/**
 * The lesson store appends to `MEMORY.md` in place and writes a lesson wherever a slug free by
 * `existsSync` points, which a dangling link satisfies. So the directory must hold no symbolic
 * link at all, and `MEMORY.md` no second hard link.
 */
function assertMemoryStore(root: string): void {
  assertPlain(root, MEMORY_DIR);
  const dir = join(root, MEMORY_DIR);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const stat = lstatSync(join(dir, name));
    if (stat.isSymbolicLink()) {
      throw new Error(`refusing to use ${MEMORY_DIR}/${name}: it is a symbolic link`);
    }
    if (name === "MEMORY.md" && stat.nlink > 1) {
      throw new Error(
        `refusing to use ${MEMORY_INDEX_PATH}: it is a hard link, and would be written through`,
      );
    }
  }
}

/** Create `rel` under `root` as a directory, after checking that nothing on the way is a link. */
function ensureDir(root: string, rel: string): void {
  assertPlain(root, rel);
  mkdirSync(join(root, rel), { recursive: true });
}

/**
 * Write a file whole: a temp file beside it, created exclusively so a planted name is not
 * followed, then a rename over the target.
 */
function writeWhole(root: string, rel: string, content: string | Uint8Array): void {
  assertPlain(root, rel);
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, content, { flag: "wx" });
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

const ExistingChecks = z.array(z.object({ id: z.string() }).passthrough());

/** The rules already in `checks.yaml`; a file that is not a list of rules is never replaced. */
function readExistingChecks(worktree: string): Record<string, unknown>[] {
  assertPlain(worktree, CHECKS_PATH);
  const path = join(worktree, CHECKS_PATH);
  if (!existsSync(path)) return [];
  let doc: unknown;
  try {
    doc = parse(readFileSync(path, "utf8"));
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} is not valid YAML: ${why}`, { cause: error });
  }
  if (doc === null || doc === undefined) return [];
  const rules = ExistingChecks.safeParse(doc);
  if (!rules.success)
    throw new Error(`${path} must be a YAML list of rules, each with a string id`);
  return rules.data;
}

/** A lesson was added (the files it wrote, relative to the root) or the store already had it. */
export type LessonResult = { added: string[] } | { duplicateOf: string };
export type AddLessonFn = (root: string, lesson: RetroLesson) => LessonResult | void;

export interface ApplyResult {
  /** Files written under the worktree, relative to it. */
  written: string[];
  duplicates: { title: string; of: string }[];
}

const proposalText = (n: number, p: RetroOutput["proposals"][number]) =>
  `# Proposal ${n} (${p.target})\n\n- File: ${p.file}\n- Change: ${p.change}\n- Rationale: ${p.rationale}\n- Evidence: ${p.evidence.join(", ")}\n`;

/** Proposals and prune candidates are for a human, so they live in the run dir, never the repo. */
function writeRunDirFiles(runDir: string, retro: RetroOutput): void {
  ensureDir(runDir, "proposals");
  retro.proposals.forEach((p, i) =>
    writeWhole(runDir, `proposals/${i + 1}-${p.target}.md`, proposalText(i + 1, p)),
  );
  if (retro.prune.length) {
    writeWhole(
      runDir,
      "proposals/prune.md",
      `${retro.prune.map((p) => `- ${p.id}: ${p.reason}`).join("\n")}\n`,
    );
  }
}

function applyParsed(o: {
  worktree: string;
  runDir: string;
  retro: RetroOutput;
  addLesson: AddLessonFn;
}): ApplyResult {
  const existing = readExistingChecks(o.worktree);
  const written: string[] = [];

  const ids = new Set(existing.map((c) => c.id));
  const fresh: CheckRule[] = [];
  for (const { evidence: _evidence, ...rule } of o.retro.checks) {
    if (ids.has(rule.id)) continue;
    ids.add(rule.id);
    fresh.push(rule);
  }
  if (fresh.length) {
    writeWhole(o.worktree, CHECKS_PATH, stringify([...existing, ...fresh], { lineWidth: 0 }));
    written.push(CHECKS_PATH);
  }

  writeRunDirFiles(o.runDir, o.retro);

  const duplicates: ApplyResult["duplicates"] = [];
  for (const lesson of o.retro.lessons) {
    const result = o.addLesson(o.worktree, lesson);
    if (typeof result !== "object" || result === null) continue;
    if ("duplicateOf" in result) duplicates.push({ title: lesson.title, of: result.duplicateOf });
    else written.push(...result.added);
  }
  if (duplicates.length) {
    writeWhole(
      o.runDir,
      "proposals/duplicate-lessons.md",
      `# Lessons skipped as near-duplicates\n\n${duplicates.map((d) => `- ${d.title} (near-duplicate of ${d.of})`).join("\n")}\n`,
    );
  }
  return { written, duplicates };
}

/**
 * Apply the retro child's output: new checks into the worktree's `checks.yaml` (a check whose
 * id is already there is skipped), proposals and prune candidates into the run dir, lessons
 * through `addLesson`. `retro` is validated first and nothing is written if it is not valid.
 */
export function applyRetro(o: {
  worktree: string;
  runDir: string;
  retro: unknown;
  addLesson: AddLessonFn;
}): ApplyResult {
  return applyParsed({ ...o, retro: parseRetro(o.retro) });
}

const DELIVERY_HEADING = /^## Delivery[ \t]*$/;
const SECTION_HEADING = /^#{1,2}[ \t]/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const STATUS_KEY = /^status[ \t]*:/;

/** Per line from `from` on: is it prose, that is, neither a fence line nor inside a code fence? */
function proseLines(lines: readonly string[], from: number): boolean[] {
  const prose = lines.map(() => false);
  let fence: { char: string; length: number } | null = null;
  for (let i = from; i < lines.length; i += 1) {
    const m = FENCE.exec(lines[i]!);
    if (fence === null) {
      const opens = m && !(m[1]![0] === "`" && m[2]!.includes("`"));
      if (opens) fence = { char: m[1]![0]!, length: m[1]!.length };
      else prose[i] = true;
    } else if (
      m &&
      m[1]![0] === fence.char &&
      m[1]!.length >= fence.length &&
      m[2]!.trim() === ""
    ) {
      fence = null;
    }
  }
  return prose;
}

/**
 * The spec as shipped: `status` in the front matter becomes `shipped`, and a `## Delivery`
 * section names the PR and the run. The front matter is the block between the opening `---` and
 * the next line that is exactly `---`; a `status:` anywhere else is body text and stays. An
 * existing Delivery section is replaced where it stands, so finalizing twice changes nothing.
 * Line endings come back as LF.
 */
export function finalizeSpec(
  specText: string,
  d: { pr: string; iterations: number; runId: string },
): string {
  if (/[\r\n]/.test(d.pr) || /[\r\n]/.test(d.runId)) {
    throw new Error("the delivery's PR and run id must not contain a line break");
  }
  const lines = specText.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") throw new Error("spec has no front matter: it must start with ---");
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new Error("spec front matter is not closed by a --- line");
  let flipped = false;
  for (let i = 1; i < end; i += 1) {
    if (STATUS_KEY.test(lines[i]!)) {
      lines[i] = "status: shipped";
      flipped = true;
    }
  }
  if (!flipped) throw new Error("spec front matter has no status line");

  const prose = proseLines(lines, end + 1);
  const out: string[] = [];
  let cursor = 0;
  let insertAt = -1;
  for (let i = end + 1; i < lines.length; i += 1) {
    if (!prose[i] || !DELIVERY_HEADING.test(lines[i]!)) continue;
    let next = i + 1;
    while (next < lines.length && !(prose[next] && SECTION_HEADING.test(lines[next]!))) next += 1;
    out.push(...lines.slice(cursor, i));
    if (insertAt === -1) insertAt = out.length;
    cursor = next;
    i = next - 1;
  }
  out.push(...lines.slice(cursor));
  if (insertAt === -1) insertAt = out.length;

  const head = out.slice(0, insertAt).join("\n").trimEnd();
  const tail = out
    .slice(insertAt)
    .join("\n")
    .replace(/^\s*\n/, "")
    .trimEnd();
  const section = `## Delivery\n\n- PR: ${d.pr}\n- Pipeline run: ${d.runId} (${d.iterations} iterations)\n`;
  return `${head}\n\n${section}${tail ? `\n${tail}\n` : ""}`;
}

/**
 * Add a run's record to `calibration.jsonl`. A second record for the same run replaces the
 * first, so finalizing again after a failed push does not count the run twice.
 */
export function appendCalibration(worktree: string, record: CalibrationRecord): void {
  assertPlain(worktree, CALIBRATION_PATH);
  const file = join(worktree, CALIBRATION_PATH);
  const line = JSON.stringify(record);
  const isThisRun = (existing: string) => {
    try {
      return (JSON.parse(existing) as { runId?: unknown }).runId === record.runId;
    } catch {
      return false;
    }
  };
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
  const next = lines.some(isThisRun)
    ? lines.map((existing) => (isThisRun(existing) ? line : existing))
    : [...lines, line];
  writeWhole(worktree, CALIBRATION_PATH, `${next.join("\n")}\n`);
}

/** The tag that records which finding category a lesson was written to reduce. */
export const targetTag = (category: string) => `target:${category}`;

/**
 * Lessons go through marvin's lesson storage, rooted at `<root>/.marvin/memory`. A lesson
 * whose title is a near-duplicate of one already stored is not added. The category it targets
 * rides along as a `target:<category>` tag, which is what `efficacy` needs to find later.
 */
export function lessonStoreSink(source: string): AddLessonFn {
  return (root, lesson) => {
    assertMemoryStore(root);
    const memoryDir = join(root, MEMORY_DIR);
    const duplicate = findNearDuplicate(memoryDir, lesson.title);
    if (duplicate) return { duplicateOf: duplicate.slug };
    const tags = [...new Set([...lesson.tags, targetTag(lesson.target_category)])];
    const { slug } = addLesson(memoryDir, {
      type: lesson.type,
      title: lesson.title,
      body: lesson.body,
      tags,
      source,
    });
    return { added: [`${MEMORY_DIR}/${slug}.md`, MEMORY_INDEX_PATH] };
  };
}

export interface FinalizeOptions {
  run: Run;
  runDir: string;
  worktree: string;
  /** The run's private git dir, as `createRunWorktree` recorded it. */
  gitDir: string;
  /** The retro child's output; untrusted, validated here. */
  retro: unknown;
  events: readonly PipelineEvent[];
  /** Ids of the lessons the engine put into the children's prompts. */
  exposedLessons: readonly string[];
  /** `pipeline.format_command`; run over every written file, which is appended to it. */
  formatCommand: string | null;
  addLesson?: AddLessonFn;
  runCommand?: Runner;
}

export interface FinalizeResult {
  /** False for a run without a PR, which keeps everything in the run dir. */
  shipped: boolean;
  /** The finalize commit, or null when there was nothing to commit. */
  commit: string | null;
  pushed: boolean;
  /** The files written under the worktree, relative to it; with a PR, the ones committed. */
  written: string[];
}

const FORMAT_TIMEOUT_MS = 5 * 60 * 1000;
const COMMIT_TRAILER = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";
const PLAIN_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const specSlug = (frontmatterSlug: string | undefined, specPath: string) =>
  [frontmatterSlug, basename(specPath, ".md").replace(/^\d+-/, ""), "spec"].find(
    (candidate) => candidate !== undefined && PLAIN_TOKEN.test(candidate),
  )!;

const outputTail = (output: string) =>
  output.trimEnd().split("\n").slice(-20).join("\n").slice(-2000);

/**
 * The run's last write. With a PR: apply the retro, add the calibration record, ship the spec,
 * format what was written, commit exactly those files on the run branch and push that branch.
 * Without one (D16) nothing leaves the run dir: the worktree is not touched, nothing is
 * committed or pushed.
 *
 * Everything is validated before the first write, and a failure up to and including the commit
 * puts every written file back, so the call can simply be made again. A push that fails after
 * the commit leaves the commit in place and the next call pushes it.
 */
export function finalizeRun(o: FinalizeOptions): FinalizeResult {
  const { run } = o;
  if (!PLAIN_TOKEN.test(run.id))
    throw new Error(`run id is not a plain token: ${JSON.stringify(run.id)}`);
  const retro = parseRetro(o.retro);
  const record = calibrationRecord(run, aggregate(run, o.events), o.exposedLessons);

  if (run.prUrl === null) {
    writeRunDirFiles(o.runDir, retro);
    writeWhole(o.runDir, "retro-output.json", `${JSON.stringify(retro, null, 2)}\n`);
    writeWhole(o.runDir, "calibration.json", `${JSON.stringify(record, null, 2)}\n`);
    return { shipped: false, commit: null, pushed: false, written: [] };
  }

  const { branch, specPath } = run;
  const { worktree } = o;
  if (branch === null || !isSafeBranchRef(branch)) {
    throw new Error(`run branch is not a safe ref: ${String(branch)}`);
  }
  if (specPath === null || !isCanonicalPath(specPath)) {
    throw new Error(`run spec path is not a canonical repo-relative path: ${String(specPath)}`);
  }
  if (!isAbsolute(worktree) || !isAbsolute(o.gitDir)) {
    throw new Error("worktree and gitDir must be absolute paths");
  }
  const abs = (rel: string) => join(worktree, rel);
  const tracked = [specPath, CHECKS_PATH, CALIBRATION_PATH];
  if (retro.lessons.length) tracked.push(MEMORY_INDEX_PATH);
  for (const rel of tracked) assertPlain(worktree, rel);
  if (retro.lessons.length) assertMemoryStore(worktree);
  const specText = readFileSync(abs(specPath), "utf8");
  const shipped = finalizeSpec(specText, {
    pr: run.prUrl,
    iterations: run.iteration,
    runId: run.id,
  });
  const slug = specSlug(parseFrontmatter(specText).frontmatter.slug, specPath);

  const git = isolatedGit(worktree, o.gitDir, { HUSKY: "0" });
  const before = new Map<string, Buffer | null>();
  for (const rel of tracked) {
    before.set(rel, existsSync(abs(rel)) ? readFileSync(abs(rel)) : null);
  }
  const sink = o.addLesson ?? lessonStoreSink(`pipeline:${run.id}`);
  const written = new Set<string>();
  let committed = false;

  try {
    const applied = applyParsed({
      worktree,
      runDir: o.runDir,
      retro,
      addLesson: (root, lesson) => {
        const result = sink(root, lesson);
        if (typeof result === "object" && result !== null && "added" in result) {
          for (const rel of result.added) if (!before.has(rel)) before.set(rel, null);
        }
        return result;
      },
    });
    for (const rel of applied.written) written.add(rel);
    appendCalibration(worktree, record);
    written.add(CALIBRATION_PATH);
    writeWhole(worktree, specPath, shipped);
    written.add(specPath);
    const paths = [...written];

    if (o.formatCommand?.trim()) {
      const command = `${o.formatCommand} ${paths.map((rel) => shellQuote(abs(rel))).join(" ")}`;
      const result = (o.runCommand ?? shellRunner)(command, worktree, FORMAT_TIMEOUT_MS);
      if (result.code !== 0) {
        throw new Error(
          `format_command failed (exit ${result.code}): ${outputTail(result.output)}`,
        );
      }
    }

    git.text("add", "--", ...paths);
    const staged = git.text("diff", "--cached", "--name-only", "-z", "--", ...paths);
    if (staged !== "") {
      git.text(
        "commit",
        "--only",
        "-m",
        `chore(${slug}): ship spec; lessons and calibration from run ${run.id}`,
        "-m",
        COMMIT_TRAILER,
        "--",
        ...paths,
      );
      committed = true;
    }
  } catch (error) {
    for (const [rel, content] of before) {
      try {
        if (content === null) rmSync(abs(rel), { force: true });
        else writeWhole(worktree, rel, content);
      } catch {
        // best effort: the original error is the one worth reporting
      }
    }
    try {
      git.text("reset", "-q", "--", ...written);
    } catch {
      // nothing was staged, or the index is unreadable
    }
    throw error;
  }

  const commit = committed ? git.text("rev-parse", "HEAD").trim() : null;
  try {
    git.text("push", "origin", `HEAD:refs/heads/${branch}`);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`push of ${branch} failed; the finalize commit stays in the worktree: ${why}`, {
      cause: error,
    });
  }
  return { shipped: true, commit, pushed: true, written: [...written] };
}
