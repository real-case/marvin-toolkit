import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { parseFrontmatter } from "../storage/frontmatter.js";
import { addLesson, findNearDuplicate, LESSON_TYPES } from "../storage/lessons.js";
import { isSafeBranchRef, slugify } from "../storage/slug.js";
import {
  type CheckRule,
  isCanonicalPath,
  type IsolatedGit,
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

/**
 * Why a retro-proposed pattern should not be written to `checks.yaml`, or null. An early
 * rejection, not a guarantee: no static read is complete (sequential quantifiers such as
 * `a*a*a*b` find their way round it, as do others), and the retro runs it on nothing. What
 * keeps a slow rule from stalling a run is the time budget `scanChecks` gives every rule.
 */
export function regexHazard(source: string): string | null {
  return staticRegexHazard(source);
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

/** The most a retro may hold of each kind; anything more is refused before an element is read. */
const RETRO_CAPS = { checks: 10, proposals: 20, lessons: 10, prune: 50 } as const;
const MAX_LESSON_BODY = 4000;
/** The lesson store keeps its index in `MEMORY.md`; a lesson slugged `memory` would be that file. */
const RESERVED_LESSON_SLUG = "memory";

const lessonTitle = oneLine
  .refine((title) => !/[[\]]/.test(title), "must not hold a square bracket")
  .refine(
    (title) => slugify(title) !== RESERVED_LESSON_SLUG,
    `must not slug to "${RESERVED_LESSON_SLUG}", the name of the lesson index`,
  );
const lessonTag = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[^,\r\n]+$/, "must not hold a comma or a line break")
  .refine((tag) => !/^target:/i.test(tag), "must not be a target: tag, the engine adds that one");

const RetroSchema = z.object({
  checks: z
    .array(
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
    )
    .max(RETRO_CAPS.checks),
  proposals: z
    .array(
      z.object({
        target: z.enum(["marvin", "project"]),
        file: oneLine,
        change: text,
        rationale: text,
        evidence: z.array(z.string()),
      }),
    )
    .max(RETRO_CAPS.proposals),
  lessons: z
    .array(
      z.object({
        type: z.enum(LESSON_TYPES),
        title: lessonTitle,
        body: text.pipe(z.string().max(MAX_LESSON_BODY)),
        tags: z.array(lessonTag),
        target_category: z.string().regex(CATEGORY, `must match ${CATEGORY}`),
        evidence: z.array(z.string()),
      }),
    )
    .max(RETRO_CAPS.lessons),
  prune: z.array(z.object({ id: oneLine, reason: text })).max(RETRO_CAPS.prune),
});

export type RetroOutput = z.infer<typeof RetroSchema>;
export type RetroLesson = RetroOutput["lessons"][number];

/**
 * The retro child reads other children's output, so what it returns is untrusted: this is the
 * only way in, and it throws on the first violation, before anything is written.
 */
export function parseRetro(raw: unknown): RetroOutput {
  if (typeof raw === "object" && raw !== null) {
    for (const [key, cap] of Object.entries(RETRO_CAPS)) {
      const list = (raw as Record<string, unknown>)[key];
      if (Array.isArray(list) && list.length > cap) {
        throw new Error(
          `retro output rejected: ${key}: at most ${cap} allowed, got ${list.length}`,
        );
      }
    }
  }
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
 * path is checked before it is read, written or removed, and a link is refused, not followed.
 */
function assertPlain(root: string, rel: string): void {
  const problem = physicalProblem(root, rel);
  if (problem !== null) throw new Error(`refusing to use ${rel} under ${root}: ${problem}`);
}

/** Remove `rel` under `root`, after checking that nothing on the way to it is a link. */
function removePlain(root: string, rel: string): void {
  assertPlain(root, rel);
  rmSync(join(root, rel), { force: true });
}

/**
 * Refuse a regular file with a second hard link: it may be a file somewhere else, and a write
 * that goes through the inode (the lesson store appends in place) would change that one too.
 */
function assertNotHardLinked(root: string, rel: string): void {
  let stat;
  try {
    stat = lstatSync(join(root, rel));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (stat.isFile() && stat.nlink > 1) {
    throw new Error(`refusing to use ${rel} under ${root}: it is a hard link to another file`);
  }
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
  }
  assertNotHardLinked(root, MEMORY_INDEX_PATH);
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

/** The rules in the text of a `checks.yaml`; a file that is not a list of rules is never replaced. */
function parseExistingChecks(text: string | null, where: string): Record<string, unknown>[] {
  if (text === null) return [];
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`${where} is not valid YAML: ${why}`, { cause: error });
  }
  if (doc === null || doc === undefined) return [];
  const rules = ExistingChecks.safeParse(doc);
  if (!rules.success)
    throw new Error(`${where} must be a YAML list of rules, each with a string id`);
  return rules.data;
}

/**
 * The existing rules plus the retro's new ones (a check whose id is already there is skipped),
 * as the text to write and the rules that text parses to; null when nothing is new.
 */
function mergeChecks(
  existing: readonly Record<string, unknown>[],
  retro: RetroOutput,
): { text: string; rules: unknown } | null {
  const ids = new Set(existing.map((c) => c.id));
  const fresh: CheckRule[] = [];
  for (const { evidence: _evidence, ...rule } of retro.checks) {
    if (ids.has(rule.id)) continue;
    ids.add(rule.id);
    fresh.push(rule);
  }
  if (!fresh.length) return null;
  const text = stringify([...existing, ...fresh], { lineWidth: 0 });
  return { text, rules: parse(text) as unknown };
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

const DUPLICATES_NOTE = "proposals/duplicate-lessons.md";

/** Every run-dir path `writeRunDirFiles` and the duplicates note may write, checked for links. */
function assertRunDirTargets(runDir: string, retro: RetroOutput): void {
  assertPlain(runDir, "proposals");
  retro.proposals.forEach((p, i) => assertPlain(runDir, `proposals/${i + 1}-${p.target}.md`));
  assertPlain(runDir, "proposals/prune.md");
  assertPlain(runDir, DUPLICATES_NOTE);
}

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

/** Run each lesson through the sink; a near-duplicate is noted in the run dir, not added. */
function addLessons(
  root: string,
  runDir: string,
  lessons: readonly RetroLesson[],
  sink: AddLessonFn,
): ApplyResult {
  const written: string[] = [];
  const duplicates: ApplyResult["duplicates"] = [];
  for (const lesson of lessons) {
    const result = sink(root, lesson);
    if (typeof result !== "object" || result === null) continue;
    if ("duplicateOf" in result) duplicates.push({ title: lesson.title, of: result.duplicateOf });
    else written.push(...result.added);
  }
  if (duplicates.length) {
    writeWhole(
      runDir,
      DUPLICATES_NOTE,
      `# Lessons skipped as near-duplicates\n\n${duplicates.map((d) => `- ${d.title} (near-duplicate of ${d.of})`).join("\n")}\n`,
    );
  }
  return { written, duplicates };
}

function applyParsed(o: {
  worktree: string;
  runDir: string;
  retro: RetroOutput;
  addLesson: AddLessonFn;
}): ApplyResult {
  assertPlain(o.worktree, CHECKS_PATH);
  assertRunDirTargets(o.runDir, o.retro);
  if (o.retro.lessons.length) assertMemoryStore(o.worktree);
  const checksPath = join(o.worktree, CHECKS_PATH);
  const existing = parseExistingChecks(
    existsSync(checksPath) ? readFileSync(checksPath, "utf8") : null,
    checksPath,
  );
  const written: string[] = [];
  const merged = mergeChecks(existing, o.retro);
  if (merged) {
    writeWhole(o.worktree, CHECKS_PATH, merged.text);
    written.push(CHECKS_PATH);
  }
  writeRunDirFiles(o.runDir, o.retro);
  const lessons = addLessons(o.worktree, o.runDir, o.retro.lessons, o.addLesson);
  return { written: [...written, ...lessons.written], duplicates: lessons.duplicates };
}

/**
 * Apply the retro child's output: new checks into the worktree's `checks.yaml` (a check whose
 * id is already there is skipped), proposals and prune candidates into the run dir, lessons
 * through `addLesson`. `retro` is validated and every target checked before the first write.
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
 * `calibration.jsonl` with a run's record added. A second record for the same run replaces the
 * first, so finalizing again after a failed push does not count the run twice.
 */
function calibrationText(existing: string | null, record: CalibrationRecord): string {
  const line = JSON.stringify(record);
  const isThisRun = (candidate: string) => {
    try {
      return (JSON.parse(candidate) as { runId?: unknown }).runId === record.runId;
    } catch {
      return false;
    }
  };
  const lines = existing === null ? [] : existing.split("\n").filter(Boolean);
  const next = lines.some(isThisRun)
    ? lines.map((candidate) => (isThisRun(candidate) ? line : candidate))
    : [...lines, line];
  return `${next.join("\n")}\n`;
}

/** The lines of a JSONL text as parsed values; a line that is not JSON stays the text it is. */
const jsonLines = (text: string): unknown[] =>
  text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return line;
      }
    });

/** Add a run's record to the worktree's `calibration.jsonl`. */
export function appendCalibration(worktree: string, record: CalibrationRecord): void {
  assertPlain(worktree, CALIBRATION_PATH);
  const file = join(worktree, CALIBRATION_PATH);
  writeWhole(
    worktree,
    CALIBRATION_PATH,
    calibrationText(existsSync(file) ? readFileSync(file, "utf8") : null, record),
  );
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
  /**
   * The commit the last gate approved, a 40-hex SHA. Finalize refuses to build on any other
   * HEAD. Not needed for a run without a PR, which touches no git.
   */
  expectedHead: string;
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
const FULL_SHA = /^[0-9a-f]{40}$/;
/** Written in the run dir after the finalize commit, so that a retry can recognise it. */
const FINALIZE_RECORD = "finalize-commit.json";

const specSlug = (frontmatterSlug: string | undefined, specPath: string) =>
  [frontmatterSlug, basename(specPath, ".md").replace(/^\d+-/, ""), "spec"].find(
    (candidate) => candidate !== undefined && PLAIN_TOKEN.test(candidate),
  )!;

const outputTail = (output: string) =>
  output.trimEnd().split("\n").slice(-20).join("\n").slice(-2000);

interface TreeEntry {
  mode: string;
  type: string;
  oid: string;
  path: string;
}

/** The entries `git ls-tree` lists in `commit` for `rel` (a directory's files, with `recursive`). */
function treeEntries(git: IsolatedGit, commit: string, rel: string, recursive: boolean) {
  const out = git.text(
    "ls-tree",
    ...(recursive ? ["-r"] : []),
    "-z",
    "--full-tree",
    commit,
    "--",
    rel,
  );
  return out
    .split("\0")
    .filter(Boolean)
    .map((record): TreeEntry => {
      const m = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(record);
      if (!m) throw new Error(`cannot read git ls-tree output: ${JSON.stringify(record)}`);
      return { mode: m[1]!, type: m[2]!, oid: m[3]!, path: m[4]! };
    });
}

/** The content of a tree entry; only a plain file counts (a link or a submodule is refused). */
function blobOf(git: IsolatedGit, commit: string, entry: TreeEntry): Buffer {
  if (entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) {
    throw new Error(`refusing to use ${entry.path}: it is not a regular file in ${commit}`);
  }
  return git.bytes("cat-file", "blob", entry.oid);
}

/** `rel` as `commit` holds it, or null where the commit has no such path. */
function committedFile(git: IsolatedGit, commit: string, rel: string): Buffer | null {
  const entry = treeEntries(git, commit, rel, false).find((e) => e.path === rel);
  return entry === undefined ? null : blobOf(git, commit, entry);
}

/** What finalize refuses to build on: hidden changes, and anything not committed under its targets. */
function assertCommittedTargets(git: IsolatedGit, targets: readonly string[]): void {
  const hidden = git
    .text("ls-files", "-v", "-z", "--", ...targets)
    .split("\0")
    .filter(Boolean)
    .filter((record) => record[0] !== record[0]!.toUpperCase() || record[0] === "S");
  if (hidden.length) {
    throw new Error(
      `refusing to finalize: an index flag hides changes under ${targets.join(", ")}: ${hidden.map((r) => r.slice(2)).join(", ")}`,
    );
  }
  const dirty = git
    .text("status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored", "--", ...targets)
    .split("\0")
    .filter(Boolean);
  if (dirty.length) {
    throw new Error(
      `refusing to finalize: uncommitted, untracked or ignored content under ${targets.join(", ")}: ${dirty
        .slice(0, 5)
        .map((r) => r.slice(3))
        .join(", ")}`,
    );
  }
}

/** Was HEAD made by an earlier finalize of this run, on top of the commit the gate approved? */
function isOwnFinalizeCommit(
  git: IsolatedGit,
  runDir: string,
  headSha: string,
  expectedHead: string,
): boolean {
  try {
    assertPlain(runDir, FINALIZE_RECORD);
    const record = JSON.parse(readFileSync(join(runDir, FINALIZE_RECORD), "utf8")) as {
      expectedHead?: unknown;
      commit?: unknown;
    };
    return (
      record.expectedHead === expectedHead &&
      record.commit === headSha &&
      git.text("rev-parse", "--verify", `${headSha}^`).trim() === expectedHead
    );
  } catch {
    return false;
  }
}

/**
 * Whether `contents` (path to bytes) holds the rules finalize wrote in `checks.yaml` and the
 * records it wrote in `calibration.jsonl`. A formatter may change layout; it may not change
 * what a rule or a record says.
 */
function verifyContents(
  contents: ReadonlyMap<string, Buffer>,
  expected: { rules: unknown; records: unknown[] },
  who: string,
): void {
  const checks = contents.get(CHECKS_PATH);
  if (expected.rules !== undefined && checks !== undefined) {
    let rules: unknown;
    try {
      rules = parse(checks.toString("utf8"));
    } catch {
      rules = undefined;
    }
    if (!isDeepStrictEqual(rules, expected.rules)) {
      throw new Error(
        `${who} changed the rules in ${CHECKS_PATH}: a formatter may change layout, not rules`,
      );
    }
  }
  const calibration = contents.get(CALIBRATION_PATH);
  if (
    calibration !== undefined &&
    !isDeepStrictEqual(jsonLines(calibration.toString("utf8")), expected.records)
  ) {
    throw new Error(
      `${who} changed the records in ${CALIBRATION_PATH}: a formatter may change layout, not records`,
    );
  }
}

/**
 * After the format command, which ran foreign code in the worktree: every written path must still
 * be a plain file with one link, and `verifyContents` must hold. Returns the bytes read, once,
 * which are the bytes finalize then hashes: nothing is checked on one read and committed from
 * another. Markdown may be reformatted freely.
 */
function readFormatted(
  worktree: string,
  paths: readonly string[],
  expected: { rules: unknown; records: unknown[] },
): Map<string, Buffer> {
  const contents = new Map<string, Buffer>();
  for (const rel of paths) {
    assertPlain(worktree, rel);
    assertNotHardLinked(worktree, rel);
    let stat;
    try {
      stat = lstatSync(join(worktree, rel));
    } catch {
      throw new Error(`the format command removed ${rel}`);
    }
    if (!stat.isFile()) throw new Error(`the format command left ${rel} as something but a file`);
    contents.set(rel, readFileSync(join(worktree, rel)));
  }
  verifyContents(contents, expected, "the format command");
  return contents;
}

const nulList = (text: string) => text.split("\0").filter(Boolean);

/**
 * The run's last write. With a PR: apply the retro, add the calibration record, ship the spec,
 * format what was written, commit exactly those files on the run branch and push that branch.
 * Without one (D16) nothing leaves the run dir: the worktree is not touched, nothing is
 * committed or pushed.
 *
 * It builds on `expectedHead`, the commit the last gate approved, and only on what that commit
 * holds: `checks.yaml`, `calibration.jsonl`, the spec and the lesson store are read from the
 * commit, never from the working tree (lessons are added in a private copy of the committed
 * store). A working tree that differs from the commit under those paths, hides a difference
 * behind an index flag, or holds a link or a hard link there is refused before anything is
 * written, since the finalize commit is not gated again.
 *
 * The format command runs foreign code in the worktree, and the common git dir (replace refs,
 * hooks, config, filters) is as writable to a child as the worktree is. So every git call is the
 * hardened one, and the finalize commit is built from plumbing only: the bytes read once after
 * formatting are hashed without filters, a temporary index seeded from the gated commit takes
 * them, `commit-tree` makes the commit and `update-ref` moves the branch only if it still names
 * the gated commit. Before anything is pushed, the commit is checked: one parent, the gated
 * commit; exactly the written files changed; each blob byte-equal to what was written and
 * `checks.yaml` and `calibration.jsonl` still saying what finalize wrote.
 *
 * Everything is validated before the first write, and a failure up to and including that check
 * puts the branch and every written file back to what the gated commit holds, so the call can
 * simply be made again. A push that fails after the commit leaves the commit in place; the next
 * call recognises it as its own and pushes it.
 */
export function finalizeRun(o: FinalizeOptions): FinalizeResult {
  const { run } = o;
  if (!PLAIN_TOKEN.test(run.id))
    throw new Error(`run id is not a plain token: ${JSON.stringify(run.id)}`);
  const retro = parseRetro(o.retro);
  const record = calibrationRecord(run, aggregate(run, o.events), o.exposedLessons);

  if (run.prUrl === null) {
    assertRunDirTargets(o.runDir, retro);
    assertPlain(o.runDir, "retro-output.json");
    assertPlain(o.runDir, "calibration.json");
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
  if (typeof o.expectedHead !== "string" || !FULL_SHA.test(o.expectedHead)) {
    throw new Error("expectedHead must be the 40-hex SHA of the commit the last gate approved");
  }
  const abs = (rel: string) => join(worktree, rel);
  const targets = [specPath, CHECKS_PATH, CALIBRATION_PATH, MEMORY_INDEX_PATH];
  for (const rel of targets) assertPlain(worktree, rel);
  assertPlain(worktree, MEMORY_DIR);
  assertRunDirTargets(o.runDir, retro);
  assertPlain(o.runDir, FINALIZE_RECORD);
  for (const rel of targets) assertNotHardLinked(worktree, rel);

  const git = isolatedGit(worktree, o.gitDir, { HUSKY: "0" });
  const headSha = git.text("rev-parse", "--verify", "HEAD^{commit}").trim();
  if (headSha !== o.expectedHead && !isOwnFinalizeCommit(git, o.runDir, headSha, o.expectedHead)) {
    throw new Error(`HEAD is ${headSha}, not the gated commit ${o.expectedHead}`);
  }
  let onBranch: string;
  try {
    onBranch = git.text("symbolic-ref", "--short", "HEAD").trim();
  } catch {
    throw new Error(`the worktree is on no branch, and finalize pushes the run branch ${branch}`);
  }
  if (onBranch !== branch) {
    throw new Error(`the worktree is on branch ${onBranch}, not the run branch ${branch}`);
  }
  assertCommittedTargets(git, [specPath, ".marvin/pipeline", MEMORY_DIR]);

  const specBase = committedFile(git, headSha, specPath);
  if (specBase === null) throw new Error(`spec ${specPath} is not committed at ${headSha}`);
  const specText = specBase.toString("utf8");
  const shipped = finalizeSpec(specText, {
    pr: run.prUrl,
    iterations: run.iteration,
    runId: run.id,
  });
  const slug = specSlug(parseFrontmatter(specText).frontmatter.slug, specPath);
  const checksBase = committedFile(git, headSha, CHECKS_PATH)?.toString("utf8") ?? null;
  const merged = mergeChecks(parseExistingChecks(checksBase, CHECKS_PATH), retro);
  const calibrationBase = committedFile(git, headSha, CALIBRATION_PATH)?.toString("utf8") ?? null;
  const calibration = calibrationText(calibrationBase, record);
  const expected = { rules: merged?.rules, records: jsonLines(calibration) };

  const written = new Set<string>();
  const restoreFromCommit = (rel: string) => {
    const base = committedFile(git, headSha, rel);
    if (base === null) removePlain(worktree, rel);
    else writeWhole(worktree, rel, base);
  };
  const scratch = mkdtempSync(join(tmpdir(), "marvin-finalize-"));
  const branchRef = `refs/heads/${branch}`;
  let newCommit: string | null = null;

  try {
    const memoryBase = new Map<string, Buffer>();
    for (const entry of treeEntries(git, headSha, MEMORY_DIR, true)) {
      const content = blobOf(git, headSha, entry);
      memoryBase.set(entry.path, content);
      mkdirSync(dirname(join(scratch, entry.path)), { recursive: true });
      writeFileSync(join(scratch, entry.path), content);
    }
    const sink = o.addLesson ?? lessonStoreSink(`pipeline:${run.id}`);
    writeRunDirFiles(o.runDir, retro);
    addLessons(scratch, o.runDir, retro.lessons, sink);
    const memoryChanges: [string, Buffer][] = [];
    const memoryDir = join(scratch, MEMORY_DIR);
    const memoryFiles = existsSync(memoryDir)
      ? readdirSync(memoryDir, { withFileTypes: true })
      : [];
    for (const entry of memoryFiles.filter((e) => e.isFile())) {
      const rel = `${MEMORY_DIR}/${entry.name}`;
      const content = readFileSync(join(scratch, rel));
      if (!memoryBase.get(rel)?.equals(content)) memoryChanges.push([rel, content]);
    }

    const writes: [string, string | Buffer][] = [
      ...(merged ? [[CHECKS_PATH, merged.text] as [string, string]] : []),
      [CALIBRATION_PATH, calibration],
      [specPath, shipped],
      ...memoryChanges,
    ];
    for (const [rel, content] of writes) {
      written.add(rel);
      writeWhole(worktree, rel, content);
    }
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
    const headNow = git.text("rev-parse", "--verify", "HEAD^{commit}").trim();
    if (headNow !== headSha) {
      throw new Error(
        `HEAD moved from ${headSha} to ${headNow} while finalize ran: the format command must not commit`,
      );
    }
    const branchNow = git.text("symbolic-ref", "--short", "HEAD").trim();
    if (branchNow !== branch) {
      throw new Error(
        `the worktree moved to branch ${branchNow} while finalize ran, not ${branch}`,
      );
    }
    const contents = readFormatted(worktree, paths, expected);

    // The commit is built from the bytes just read and verified, with git plumbing only: no hook,
    // no filter and no replace ref has a chance to change what goes in.
    const plumbing = isolatedGit(worktree, o.gitDir, {
      HUSKY: "0",
      GIT_INDEX_FILE: join(scratch, "index"),
    });
    plumbing.text("read-tree", headSha);
    const changed: string[] = [];
    let indexInfo = "";
    for (const [rel, bytes] of contents) {
      const oid = git.textIn(bytes, "hash-object", "-w", "--no-filters", "--stdin").trim();
      const committedEntry = treeEntries(git, headSha, rel, false).find((e) => e.path === rel);
      if (committedEntry?.oid === oid) continue;
      changed.push(rel);
      indexInfo += `${committedEntry?.mode ?? "100644"} ${oid}\t${rel}\0`;
    }
    if (changed.length > 0) {
      plumbing.textIn(indexInfo, "update-index", "-z", "--index-info");
      const tree = plumbing.text("write-tree").trim();
      const subject = `chore(${slug}): ship spec; lessons and calibration from run ${run.id}`;
      newCommit = git
        .text("commit-tree", tree, "-p", headSha, "-m", subject, "-m", COMMIT_TRAILER)
        .trim();
      git.text("update-ref", branchRef, newCommit, headSha);
      git.text("reset", "-q", "--", ...changed);

      const parents = git.text("rev-list", "--parents", "-n", "1", newCommit).trim().split(" ");
      if (
        git.text("rev-parse", "--verify", "HEAD^{commit}").trim() !== newCommit ||
        parents.length !== 2 ||
        parents[1] !== headSha
      ) {
        throw new Error(
          `the finalize commit ${newCommit} is not the one HEAD names, on top of ${headSha}`,
        );
      }
      const listed = nulList(
        git.text("diff-tree", "-r", "--name-only", "--no-renames", "-z", headSha, newCommit),
      ).sort();
      if (!isDeepStrictEqual(listed, [...changed].sort())) {
        throw new Error(
          `the finalize commit changes ${listed.join(", ")}, not only ${[...changed].join(", ")}`,
        );
      }
      const committedContents = new Map<string, Buffer>();
      for (const [rel, bytes] of contents) {
        const blob = committedFile(git, newCommit, rel);
        if (blob === null || !blob.equals(bytes)) {
          throw new Error(`${rel} in the finalize commit is not what finalize wrote`);
        }
        committedContents.set(rel, blob);
      }
      verifyContents(committedContents, expected, "the finalize commit");
    }
  } catch (error) {
    try {
      const current = git.text("rev-parse", "--verify", branchRef).trim();
      if (current !== headSha) git.text("update-ref", branchRef, headSha, current);
    } catch {
      // best effort: the original error is the one worth reporting
    }
    for (const rel of written) {
      try {
        restoreFromCommit(rel);
      } catch {
        // best effort, as above
      }
    }
    try {
      git.text("reset", "-q", "--", ...written);
    } catch {
      // nothing was staged, or the index is unreadable
    }
    throw error;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (newCommit !== null) {
    writeWhole(
      o.runDir,
      FINALIZE_RECORD,
      `${JSON.stringify({ expectedHead: o.expectedHead, commit: newCommit })}\n`,
    );
  }
  try {
    git.text("push", "origin", `${newCommit ?? headSha}:${branchRef}`);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`push of ${branch} failed; the finalize commit stays in the worktree: ${why}`, {
      cause: error,
    });
  }
  return { shipped: true, commit: newCommit, pushed: true, written: [...written] };
}
