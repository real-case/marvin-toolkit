import { randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { Rubric } from "./assess.js";
import {
  type Action,
  type Answer,
  type Decision,
  decide,
  type JudgmentKind,
  type Observation,
  type SpawnAction,
} from "./engine.js";
import {
  appendEvent,
  EventKind,
  loadRun,
  type PipelineEvent,
  Run,
  saveRun,
  type Stage,
  TIERS,
} from "./run-store.js";

/*
 * The engine's loop around `decide`: one process per run, guarded by a lock, that carries out each
 * decision and waits for the next observation. Whatever a restarted engine needs is on disk before
 * the engine acts on it:
 *
 * - `run.json` is the resting state. An engine rests only while it waits for an answer to a
 *   pending judgment or for a running child, and the run records both, so a new engine reads the
 *   run and waits on the same thing.
 * - `engine.journal.json` covers the time between two rests: one decision's remaining actions and
 *   the observations its work has produced, written before any of them is carried out and
 *   advanced after each. A decision such as "snapshot the tree, then spawn the verifier" is two
 *   actions, and an engine that dies between them must not lose the second; a gate that finished
 *   must not lose its result. The journal is removed before the engine rests.
 *
 * Every write that another process may read is atomic: a whole file renamed or linked into place,
 * never one filled after it appears.
 */

const JOURNAL = "engine.journal.json";
const JUDGMENTS = "judgments";
const LOCK = "engine.lock";
const CURSOR = "await.cursor";
const EVENTS = "events.jsonl";
const TERMINAL: ReadonlySet<Stage> = new Set<Stage>(["ready", "done"]);

// ---------------------------------------------------------------------------------------- files

const tmpPath = (path: string) =>
  join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);

/** Replaces a file whole: a reader sees the old content or the new, never a part. */
function writeAtomic(path: string, text: string): void {
  const tmp = tmpPath(path);
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/**
 * Creates a file with its full content, and only if the path is free; false if it was taken.
 * `link` fails on an existing path, so the check and the creation are one step. Opening with flag
 * `wx` is one step too, but it publishes an empty file that is filled afterwards, and a reader in
 * between finds nothing to parse.
 */
function createExclusive(path: string, text: string): boolean {
  const tmp = tmpPath(path);
  writeFileSync(tmp, text);
  try {
    linkSync(tmp, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    rmSync(tmp, { force: true });
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One line of text, so that a child-authored string cannot start an `await` line of its own. */
const oneLine = (text: string) => text.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").trim();

// ----------------------------------------------------------------------------------------- lock

/** A pid names a live process while the OS knows it; EPERM means it lives under another user. */
function isAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const Holder = z.object({
  pid: z.number().int(),
  token: z.string(),
  startedAt: z.string(),
  releasedAt: z.string().nullable(),
});
type Holder = z.infer<typeof Holder>;
const GENERATION = /^(\d+)\.json$/;
const generationFile = (dir: string, generation: number) =>
  join(dir, `${String(generation).padStart(6, "0")}.json`);

function generations(dir: string): number[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => GENERATION.exec(name)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

function readHolder(dir: string, generation: number): Holder | null {
  try {
    return Holder.parse(JSON.parse(readFileSync(generationFile(dir, generation), "utf8")));
  } catch {
    return null;
  }
}

/** The highest generation is the lock; an unreadable or released one is held by nobody. */
function lockState(runDir: string): { generation: number; holder: Holder | null; alive: boolean } {
  const dir = join(runDir, LOCK);
  const generation = generations(dir).at(-1) ?? 0;
  const holder = generation > 0 ? readHolder(dir, generation) : null;
  const alive = holder !== null && holder.releasedAt === null && isAlive(holder.pid);
  return { generation, holder, alive };
}

/**
 * Takes the run's engine lock for `pid`, or throws while another engine holds it, and returns the
 * release. The lock is a directory of numbered generations, `engine.lock/<n>.json`, each naming
 * the process that took it, and the highest number is the lock. Taking it means creating the file
 * one above the highest with `createExclusive`, which refuses a path that exists. That makes the
 * takeover of a dead engine's lock a compare-and-swap: two starters that both find generation n
 * dead both try to create n + 1, and exactly one can. The plainer scheme, removing the stale file
 * and then creating it afresh, cannot be made safe: the second starter's removal can delete the
 * first one's new lock, after which both create it and both run.
 *
 * The highest generation is never deleted, so the number only grows: a release marks its
 * generation released instead of removing it, and a new holder deletes only the generations below
 * its own. A starter working from an old listing may still recreate a deleted lower generation;
 * it then finds a higher one above it and withdraws, which is why a new holder checks that its
 * generation is the highest before it counts as held. Another starter in this same process is
 * refused like any other, because the holder is told apart by a token, not by its pid.
 */
export function acquireLock(runDir: string, pid: number = process.pid): () => void {
  const dir = join(runDir, LOCK);
  mkdirSync(dir, { recursive: true });
  const token = randomUUID();
  // Every retry is caused by another starter creating a generation in between; the next listing
  // then finds that starter's lock, so a handful of rounds settles any race between real engines.
  for (let round = 0; round < 32; round++) {
    const { generation, holder, alive } = lockState(runDir);
    if (alive) throw new Error(`engine already running (pid ${holder?.pid})`);
    const mine = generation + 1;
    const body: Holder = { pid, token, startedAt: new Date().toISOString(), releasedAt: null };
    if (!createExclusive(generationFile(dir, mine), `${JSON.stringify(body)}\n`)) continue;
    const listed = generations(dir);
    if (listed.at(-1) !== mine) {
      rmSync(generationFile(dir, mine), { force: true });
      continue;
    }
    for (const older of listed) {
      if (older < mine) rmSync(generationFile(dir, older), { force: true });
    }
    return () => releaseLock(dir, mine, token);
  }
  throw new Error(`could not take the engine lock in ${dir}: it kept changing`);
}

/** Marks the generation released unless it is no longer this holder's; a second call is a no-op. */
function releaseLock(dir: string, generation: number, token: string): void {
  const holder = readHolder(dir, generation);
  if (!holder || holder.token !== token || holder.releasedAt !== null) return;
  const released: Holder = { ...holder, releasedAt: new Date().toISOString() };
  writeAtomic(generationFile(dir, generation), `${JSON.stringify(released)}\n`);
}

export function engineAlive(runDir: string): boolean {
  return lockState(runDir).alive;
}

// ------------------------------------------------------------------------------------ judgments

const Text = z.string().trim().min(1);
const cancel = z.object({ kind: z.literal("cancel"), reason: Text }).strict();
const answers = z
  .object({ kind: z.literal("answers"), text: Text, count: z.number().int().min(0) })
  .strict();
const reviseTests = z.object({ kind: z.literal("revise_tests"), text: Text }).strict();
const approve = z
  .object({ kind: z.literal("approve"), tier: z.enum(TIERS).optional(), reason: Text.optional() })
  .strict();
const changes = z.object({ kind: z.literal("changes"), text: Text }).strict();
const retry = z.object({ kind: z.literal("retry") }).strict();
const wait = z.object({ kind: z.literal("wait") }).strict();
const proceed = z.object({ kind: z.literal("proceed"), reason: Text.optional() }).strict();
const proceedWithReason = z.object({ kind: z.literal("proceed"), reason: Text }).strict();

type AnswerSchema = z.ZodType<Answer, z.ZodTypeDef, unknown>;

/**
 * The answers each judgment kind takes: exactly the ones `decide` handles in the state that raises
 * the kind, so an answer it would refuse is refused here, before it is written. Two differences
 * from the bare `Answer` type are deliberate. Objects are closed, because a misspelt key such as
 * `teir` would otherwise approve silently without the override it meant. And an unverified
 * `proceed` needs a reason, because `decide` throws without one, while a `no_ci` proceed does not.
 */
export const AnswerSchemas = {
  planner_questions: z.discriminatedUnion("kind", [answers, cancel]),
  executor_questions: z.discriminatedUnion("kind", [answers, reviseTests, cancel]),
  spec_approval: z.discriminatedUnion("kind", [approve, changes, cancel]),
  halt: z.discriminatedUnion("kind", [retry, cancel]),
  no_ci: z.discriminatedUnion("kind", [wait, proceed, cancel]),
  unverified: z.discriminatedUnion("kind", [retry, proceedWithReason, cancel]),
} satisfies Record<JudgmentKind, AnswerSchema>;
export const JUDGMENT_KINDS = Object.keys(AnswerSchemas) as JudgmentKind[];
const schemaFor = (kind: JudgmentKind): AnswerSchema => AnswerSchemas[kind];
const isKind = (kind: string | undefined): kind is JudgmentKind =>
  JUDGMENT_KINDS.includes(kind as JudgmentKind);

export interface JudgmentRequest {
  id: string;
  kind: JudgmentKind;
  payload: Record<string, unknown>;
}
const RequestFile = z.object({
  id: z.string(),
  kind: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

const ID = /^(\d{3,})-([a-z_]+)$/;
const REQUEST_FILE = /^(\d{3,})-([a-z_]+)\.request\.json$/;
const judgmentsDir = (runDir: string) => join(runDir, JUDGMENTS);
const requestPath = (runDir: string, id: string) =>
  join(judgmentsDir(runDir), `${id}.request.json`);
const answerPath = (runDir: string, id: string) => join(judgmentsDir(runDir), `${id}.answer.json`);
const formatId = (seq: number, kind: JudgmentKind) => `${String(seq).padStart(3, "0")}-${kind}`;

/** An id names a file under `judgments/`, so it is checked before it becomes part of a path. */
function parseId(id: string): { seq: number; kind: JudgmentKind } {
  const match = ID.exec(id);
  const kind = match?.[2];
  if (!match || !isKind(kind)) throw new Error(`not a judgment id: ${JSON.stringify(id)}`);
  return { seq: Number(match[1]), kind };
}

/** The ids of every request, oldest first. */
function requestIds(runDir: string): string[] {
  if (!existsSync(judgmentsDir(runDir))) return [];
  return readdirSync(judgmentsDir(runDir))
    .map((name) => REQUEST_FILE.exec(name))
    .filter((m): m is RegExpExecArray => m !== null && isKind(m[2]))
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => `${m[1]}-${m[2]}`);
}

const nextSeq = (runDir: string) =>
  Math.max(0, ...requestIds(runDir).map((id) => parseId(id).seq)) + 1;

function readRequest(runDir: string, id: string): JudgmentRequest {
  const { kind } = parseId(id);
  let raw: string;
  try {
    raw = readFileSync(requestPath(runDir, id), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error(`no judgment ${id}`, { cause: error });
  }
  const request = RequestFile.parse(JSON.parse(raw));
  if (request.id !== id || request.kind !== kind) {
    throw new Error(`judgment file ${id} names ${request.id} (${request.kind})`);
  }
  return { id, kind, payload: request.payload };
}

/** Answers the engine refused are kept beside the request, numbered, and leave it open again. */
function refusals(runDir: string, id: string): number {
  if (!existsSync(judgmentsDir(runDir))) return 0;
  const prefix = `${id}.refused-`;
  return readdirSync(judgmentsDir(runDir)).filter((name) => name.startsWith(prefix)).length;
}

/**
 * Writes the request for a judgment and returns its id: the next sequence number, or `id` when the
 * caller already holds one. The engine always passes one. It fixes the id in its journal before
 * the request is written, so an engine that dies after writing the request and before recording
 * it issues the same request again on restart, and creating a request that exists is a no-op
 * rather than a second judgment.
 */
export function requestJudgment(
  runDir: string,
  kind: JudgmentKind,
  payload: Record<string, unknown>,
  id: string = formatId(nextSeq(runDir), kind),
): string {
  if (parseId(id).kind !== kind) throw new Error(`judgment id ${id} is not a ${kind}`);
  mkdirSync(judgmentsDir(runDir), { recursive: true });
  createExclusive(requestPath(runDir, id), `${JSON.stringify({ id, kind, payload }, null, 2)}\n`);
  return id;
}

/** The oldest request that has no answer, or null. */
export function pendingJudgment(runDir: string): JudgmentRequest | null {
  const open = requestIds(runDir).find((id) => !existsSync(answerPath(runDir, id)));
  return open ? readRequest(runDir, open) : null;
}

/**
 * Validates an answer against its judgment and writes it once. Beyond the kind's schema, a count
 * of answered questions must be one the request asked: between one and the number of questions,
 * or zero for an executor round that raised only a dispute. A count above that would charge the
 * planner's question cap for questions nobody asked.
 *
 * With `rubric`, the answer is also tried against the run as it stands, so that one `decide`
 * cannot take in this state (a halt retry with nothing to retry) is refused here instead of
 * stopping the engine. That trial presumes the run is in the state that raised the judgment, as
 * it is for every request the engine writes. A request written by hand into a run that is
 * elsewhere, such as a test fixture on a fresh `intake` run, has every answer refused: a caller
 * in that position builds the raising state first, or passes no rubric. The answer is written
 * with `createExclusive`: of two answers racing for one judgment exactly one is kept, and the
 * engine never reads a half-written file.
 */
export function answerJudgment(
  runDir: string,
  id: string,
  raw: unknown,
  opts: { rubric?: Rubric; now?: Date } = {},
): Answer {
  const request = readRequest(runDir, id);
  if (existsSync(answerPath(runDir, id))) throw new Error(`judgment ${id} already answered`);
  const parsed = schemaFor(request.kind).safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join(".") || "(root)";
    throw new Error(`invalid answer to ${id} (${request.kind}): ${where}: ${first?.message}`);
  }
  const answer = parsed.data;
  const questions = request.payload.questions;
  if (answer.kind === "answers" && Array.isArray(questions)) {
    const least = questions.length > 0 ? 1 : 0;
    if (answer.count < least || answer.count > questions.length) {
      const asked = questions.length;
      throw new Error(
        `answer to ${id} counts ${answer.count} questions; the judgment asked ${asked}`,
      );
    }
  }
  if (existsSync(join(runDir, "run.json"))) {
    const run = loadRun(runDir);
    if (run.pendingJudgment && run.pendingJudgment.id !== id) {
      throw new Error(`judgment ${run.pendingJudgment.id} is pending, not ${id}`);
    }
    if (opts.rubric) {
      const obs: Observation = { kind: "answer", judgment: request.kind, answer };
      try {
        decide(run, obs, opts.rubric, opts.now ?? new Date());
      } catch (error) {
        throw new Error(`answer to ${id} refused: ${errorText(error)}`, { cause: error });
      }
    }
  }
  if (!createExclusive(answerPath(runDir, id), `${JSON.stringify(answer)}\n`)) {
    throw new Error(`judgment ${id} already answered`);
  }
  return answer;
}

/** The answer to a judgment, or null while there is none; a file that is not one throws. */
export function readAnswer(runDir: string, id: string): Answer | null {
  const { kind } = parseId(id);
  let raw: string;
  try {
    raw = readFileSync(answerPath(runDir, id), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed = schemaFor(kind).safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`the answer file of ${id} is not a valid ${kind} answer`);
  return parsed.data;
}

/** Sets a refused answer aside, which reopens the judgment, and tells the orchestrator why. */
function refuseAnswer(runDir: string, id: string, reason: string): void {
  const aside = join(judgmentsDir(runDir), `${id}.refused-${refusals(runDir, id) + 1}.json`);
  renameSync(answerPath(runDir, id), aside);
  appendEvent(runDir, {
    ts: new Date().toISOString(),
    kind: "note",
    actor: "engine",
    text: `answer to ${id} refused: ${oneLine(reason)}`,
    data: { notify: true, id },
  });
}

// --------------------------------------------------------------------------------------- engine

export type WorkKind = Extract<Action, { kind: "work" }>["work"];

/**
 * Which journal step a runtime call belongs to. `replay` is true for the one step an engine
 * repeats after a restart, which its predecessor may have begun: a spawn whose child was already
 * launched, or work that already committed. The runtime can key what it leaves behind by `ref`
 * and adopt it instead of doing the step twice.
 */
export interface StepInfo {
  ref: string;
  replay: boolean;
}

export interface EngineDeps {
  rubric: Rubric;
  /** How long a wait for an answer sleeps between looks; at least 1 ms. */
  pollMs: number;
  /** `fixtures` answers from `<fixturesDir>/<id>.json`, else `<kind>.json`, when one exists. */
  judge: "files" | "fixtures";
  fixturesDir?: string;
  /** Stops the engine at its next step or wait; the run stays as it was, ready to resume. */
  signal?: AbortSignal;
  /**
   * Sets up the run and returns it with `worktree` set. It is called for a run at `intake` whose
   * `worktree` is still null, so once its result is recorded no engine calls it again. An engine
   * that dies inside it records nothing, and the next one calls it again for the same run: it
   * must then adopt what the earlier call left (a worktree at the run's path) rather than fail.
   */
  prepare(run: Run): Promise<Run>;
  spawnChild(run: Run, action: SpawnAction, step: StepInfo): Run;
  /** Waits for the running child. A result whose outcome is still `running` is waited on again. */
  waitChild(run: Run, signal?: AbortSignal): Promise<{ run: Run; obs: Observation }>;
  work(
    run: Run,
    work: WorkKind,
    data: Record<string, unknown> | undefined,
    step: StepInfo,
  ): Promise<{ run: Run; obs?: Observation }>;
}

type StepAction = Exclude<Action, { kind: "notify" }>;
type Step =
  | { ref: string; kind: "event"; event: PipelineEvent }
  | { ref: string; kind: "action"; action: StepAction; judgmentId?: string };
interface Journal {
  version: 1;
  run: Run;
  steps: Step[];
  next: number;
  queue: Observation[];
}
const JournalFile = z.object({
  version: z.literal(1),
  run: Run,
  steps: z.array(
    z.union([
      z.object({
        ref: z.string().min(1),
        kind: z.literal("event"),
        event: z.object({
          ts: z.string(),
          kind: EventKind,
          actor: z.string(),
          text: z.string(),
          data: z.record(z.string(), z.unknown()).optional(),
        }),
      }),
      z.object({
        ref: z.string().min(1),
        kind: z.literal("action"),
        action: z.object({ kind: z.enum(["spawn", "judgment", "work"]) }).passthrough(),
        judgmentId: z.string().optional(),
      }),
    ]),
  ),
  next: z.number().int().min(0),
  queue: z.array(z.object({ kind: z.string() }).passthrough()),
});
interface Answered {
  id: string;
  answer: Answer;
}

/** The journal first, then the run: the journal is never older than `run.json`. */
function persist(runDir: string, j: Journal): Journal {
  const checked: Journal = { ...j, run: Run.parse(j.run) };
  writeAtomic(join(runDir, JOURNAL), `${JSON.stringify(checked)}\n`);
  saveRun(runDir, checked.run);
  return checked;
}

const settle = (runDir: string) => rmSync(join(runDir, JOURNAL), { force: true });

/**
 * Where a starting engine picks up. A journal means the last engine died while carrying out a
 * decision, and its run is the newest state. Without one, `run.json` is a resting state, unless it
 * still names interrupted work: a run left by an engine that did not keep a journal, whose work
 * is done again since its result was never recorded.
 */
function resume(runDir: string): Journal {
  const file = join(runDir, JOURNAL);
  if (existsSync(file)) {
    let parsed: z.SafeParseReturnType<unknown, z.infer<typeof JournalFile>>;
    try {
      parsed = JournalFile.safeParse(JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      throw new Error(`the engine journal ${file} is unreadable: ${errorText(error)}`, {
        cause: error,
      });
    }
    if (!parsed.success) {
      throw new Error(
        `the engine journal ${file} is unreadable: ${parsed.error.issues[0]?.message}`,
      );
    }
    const journal = parsed.data as unknown as Journal;
    saveRun(runDir, journal.run);
    return journal;
  }
  const run = loadRun(runDir);
  const idle: Journal = { version: 1, run, steps: [], next: 0, queue: [] };
  if (!run.pendingWork) return idle;
  const { work, data } = run.pendingWork;
  const action = { kind: "work", work: work as WorkKind, ...(data ? { data } : {}) } as StepAction;
  return { ...idle, steps: [{ ref: randomUUID(), kind: "action", action }] };
}

/**
 * Turns a decision into journal steps and records them before any is carried out. Events become
 * steps of their own, so that the stage change and every notification are written exactly once
 * even across a restart, and each judgment gets its id here, so that a restart issues the same one.
 */
function plan(
  runDir: string,
  before: Run,
  d: Decision,
  queue: Observation[],
  answered: Answered | null,
): Journal {
  const ts = new Date().toISOString();
  const steps: Step[] = [];
  const event = (e: PipelineEvent) => steps.push({ ref: randomUUID(), kind: "event", event: e });
  if (answered) {
    const text = `${answered.id}: ${answered.answer.kind}`;
    event({ ts, kind: "answer", actor: "engine", text, data: { id: answered.id } });
  }
  if (d.run.stage !== before.stage) {
    const text = `${before.stage} → ${d.run.stage}`;
    event({ ts, kind: "stage", actor: "engine", text, data: { notify: true } });
  }
  let seq = nextSeq(runDir);
  for (const action of d.actions) {
    if (action.kind === "notify") {
      event({ ts, kind: "note", actor: "engine", text: action.text, data: { notify: true } });
    } else if (action.kind === "judgment") {
      const judgmentId = formatId(seq++, action.judgment);
      steps.push({ ref: randomUUID(), kind: "action", action, judgmentId });
    } else {
      steps.push({ ref: randomUUID(), kind: "action", action });
    }
  }
  return persist(runDir, { version: 1, run: d.run, steps, next: 0, queue });
}

/** Appends an engine event once: a replayed step skips the event its predecessor already wrote. */
function emit(runDir: string, ref: string, event: PipelineEvent, replay: boolean): void {
  if (replay && readEventsFrom(runDir, 0).events.some((e) => e.data?.ref === ref)) return;
  appendEvent(runDir, { ...event, data: { ...event.data, ref } });
}

async function perform(
  runDir: string,
  j: Journal,
  deps: EngineDeps,
  replay: boolean,
): Promise<Journal> {
  const step = j.steps[j.next];
  if (!step) throw new Error(`no journal step ${j.next}`);
  const advance = (run: Run, queue: Observation[] = j.queue) =>
    persist(runDir, { ...j, run, next: j.next + 1, queue });
  if (step.kind === "event") {
    emit(runDir, step.ref, step.event, replay);
    return advance(j.run);
  }
  const info: StepInfo = { ref: step.ref, replay };
  const { action } = step;
  switch (action.kind) {
    case "spawn":
      return advance(deps.spawnChild(j.run, action, info));
    case "judgment": {
      const id = requestJudgment(runDir, action.judgment, action.payload, step.judgmentId);
      const ts = new Date().toISOString();
      const asked = `judgment ${id}`;
      const event: PipelineEvent = { ts, kind: "question", actor: "engine", text: asked };
      emit(runDir, step.ref, { ...event, data: { notify: true, id } }, replay);
      return advance({ ...j.run, pendingJudgment: { id, kind: action.judgment } });
    }
    case "work": {
      // The run names the work while it is under way, for readers and for an engine that finds
      // the run without a journal; the journal step is what a restart actually repeats.
      const pendingWork = action.data
        ? { work: action.work, data: action.data }
        : { work: action.work };
      const marked = persist(runDir, { ...j, run: { ...j.run, pendingWork } });
      const out = await deps.work(marked.run, action.work, action.data, info);
      const queue = out.obs ? [...j.queue, out.obs] : j.queue;
      return persist(runDir, {
        ...marked,
        run: { ...out.run, pendingWork: null },
        next: j.next + 1,
        queue,
      });
    }
  }
}

const pollMsOf = (deps: { pollMs: number }) =>
  Number.isFinite(deps.pollMs) && deps.pollMs >= 1 ? deps.pollMs : 1;

function answerFromFixture(runDir: string, id: string, kind: JudgmentKind, deps: EngineDeps): void {
  const dir = deps.fixturesDir;
  if (deps.judge !== "fixtures" || !dir) return;
  for (const name of [`${id}.json`, `${kind}.json`]) {
    const file = join(dir, name);
    if (!existsSync(file)) continue;
    answerJudgment(runDir, id, JSON.parse(readFileSync(file, "utf8")), { rubric: deps.rubric });
    return;
  }
}

/**
 * Waits for the answer to a judgment. A fixture answers it once, unless an earlier answer was
 * refused: answering again from the same file would be refused again, forever. An answer file
 * that does not parse is set aside like a refused one, since it can never become valid in place.
 */
async function awaitAnswer(
  runDir: string,
  id: string,
  kind: JudgmentKind,
  deps: EngineDeps,
): Promise<Answer> {
  if (refusals(runDir, id) === 0 && !existsSync(answerPath(runDir, id))) {
    answerFromFixture(runDir, id, kind, deps);
  }
  for (;;) {
    try {
      const answer = readAnswer(runDir, id);
      if (answer) return answer;
    } catch (error) {
      refuseAnswer(runDir, id, errorText(error));
    }
    await delay(pollMsOf(deps), undefined, { signal: deps.signal });
  }
}

/** Waits on the one thing a resting run waits for: an answer, or its running child. */
async function observe(
  runDir: string,
  run: Run,
  deps: EngineDeps,
): Promise<{ run: Run; obs: Observation; answered: Answered | null }> {
  const pending = run.pendingJudgment;
  if (pending) {
    const { kind } = parseId(pending.id);
    if (kind !== pending.kind) {
      throw new Error(`pending judgment ${pending.id} is not a ${pending.kind}`);
    }
    const answer = await awaitAnswer(runDir, pending.id, kind, deps);
    return {
      run: { ...run, pendingJudgment: null },
      obs: { kind: "answer", judgment: kind, answer },
      answered: { id: pending.id, answer },
    };
  }
  let current = run;
  while (current.children.some((c) => c.status === "running")) {
    const seen = await deps.waitChild(current, deps.signal);
    // A wait that outlasted its deadline reports the child still running; that is not a result
    // to decide on (`decide` throws on one), so the engine records the run and waits again.
    if (seen.obs.kind !== "child" || seen.obs.result.outcome !== "running") {
      return { ...seen, answered: null };
    }
    current = seen.run;
    saveRun(runDir, current);
    deps.signal?.throwIfAborted();
  }
  throw new Error(`engine has nothing to wait for in stage ${run.stage}`);
}

async function drive(runDir: string, deps: EngineDeps): Promise<Run> {
  deps.signal?.throwIfAborted();
  let j = resume(runDir);
  // Only the step a restart resumes at can have been begun by the previous engine.
  let replay = j.next < j.steps.length;
  if (!replay && j.queue.length === 0 && j.run.stage === "intake") {
    // An engine that died after recording the preparation and before planning the start leaves
    // the run at intake with its worktree set; preparing it again would set up a second one.
    const prepared = j.run.worktree === null ? await deps.prepare(j.run) : j.run;
    saveRun(runDir, prepared);
    const d = decide(prepared, { kind: "start" }, deps.rubric, new Date());
    j = plan(runDir, prepared, d, [], null);
  }
  for (;;) {
    while (j.next < j.steps.length) {
      deps.signal?.throwIfAborted();
      j = await perform(runDir, j, deps, replay);
      replay = false;
    }
    if (TERMINAL.has(j.run.stage)) break;
    let before: Run;
    let obs: Observation;
    let queue: Observation[] = [];
    let answered: Answered | null = null;
    const [queued, ...rest] = j.queue;
    if (queued) {
      before = j.run;
      obs = queued;
      queue = rest;
    } else {
      settle(runDir);
      deps.signal?.throwIfAborted();
      const seen = await observe(runDir, j.run, deps);
      before = seen.run;
      obs = seen.obs;
      answered = seen.answered;
    }
    let d: Decision;
    try {
      d = decide(before, obs, deps.rubric, new Date());
    } catch (error) {
      // Only an answer is blamed for a refusal: it came from outside the engine and can be given
      // again. Restarting would read the same answer and fail the same way, so it is set aside
      // and the run keeps waiting on the judgment, which stays pending in `j.run`.
      if (!answered) throw error;
      refuseAnswer(runDir, answered.id, errorText(error));
      continue;
    }
    j = plan(runDir, before, d, queue, answered);
  }
  settle(runDir);
  return j.run;
}

function noteStop(runDir: string, error: unknown, signal: AbortSignal | undefined): void {
  const requested = signal?.aborted === true;
  try {
    appendEvent(runDir, {
      ts: new Date().toISOString(),
      kind: "note",
      actor: "engine",
      text: requested
        ? "engine stopped on request"
        : `engine stopped: ${oneLine(errorText(error))}`,
      ...(requested ? {} : { data: { notify: true } }),
    });
  } catch {
    // The caller needs the error that stopped the engine, not one from failing to log it.
  }
}

/**
 * Drives a run until it is `ready` or `done`. Throws at once, touching nothing, when there is no
 * run at `runDir` or another engine holds it.
 * When the signal aborts, or on a fault no rule covers, it releases the lock and throws, and the
 * run on disk is where a new engine resumes. A fault is also written as a notify event, so that
 * `await` shows why the engine went down next to `ENGINE down`.
 */
export async function runEngine(runDir: string, deps: EngineDeps): Promise<Run> {
  if (deps.judge === "fixtures" && !deps.fixturesDir) {
    throw new Error("the fixtures judge needs a fixtures directory");
  }
  // Checked before the lock, which creates its directory and would turn a mistyped run path
  // into a run directory holding a lock and a log of the failure.
  if (!existsSync(join(runDir, "run.json"))) throw new Error(`no run at ${runDir}`);
  const release = acquireLock(runDir);
  try {
    return await drive(runDir, deps);
  } catch (error) {
    noteStop(runDir, error, deps.signal);
    throw error;
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------------------- await

/**
 * The complete events from `cursor`, a byte offset, and the offset after the last one. A line
 * still being appended has no newline yet and is left for the next read, so the cursor never
 * splits a line, nor a character, and a torn line is never parsed. A line that is not an event
 * is skipped rather than fatal: `await` must not die on one bad write.
 */
function readEventsFrom(
  runDir: string,
  cursor: number,
): { events: PipelineEvent[]; cursor: number } {
  let fd: number;
  try {
    fd = openSync(join(runDir, EVENTS), "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { events: [], cursor: 0 };
    throw error;
  }
  try {
    const size = fstatSync(fd).size;
    // A cursor beyond the end belongs to some other file; read this one from its start.
    const start = Number.isSafeInteger(cursor) && cursor >= 0 && cursor <= size ? cursor : 0;
    const buffer = Buffer.alloc(size - start);
    let filled = 0;
    while (filled < buffer.length) {
      const read = readSync(fd, buffer, filled, buffer.length - filled, start + filled);
      if (read === 0) break;
      filled += read;
    }
    const end = buffer.subarray(0, filled).lastIndexOf(0x0a);
    if (end < 0) return { events: [], cursor: start };
    const events = buffer
      .subarray(0, end)
      .toString("utf8")
      .split("\n")
      .flatMap((line): PipelineEvent[] => {
        try {
          const e = JSON.parse(line) as Partial<PipelineEvent> | null;
          return e && typeof e.kind === "string" && typeof e.text === "string"
            ? [e as PipelineEvent]
            : [];
        } catch {
          return [];
        }
      });
    return { events, cursor: start + end + 1 };
  } finally {
    closeSync(fd);
  }
}

const eventLines = (events: PipelineEvent[]) =>
  events
    .filter((e) => e.data?.notify === true && EventKind.safeParse(e.kind).success)
    .map((e) => `EVENT ${e.kind} ${oneLine(e.text)}`);

/**
 * The conditions that hold until something changes them, each with a key that changes when the
 * condition is a new one: a judgment's key counts its refused answers, so a reopened judgment is
 * new, and a dead engine's key is its lock generation, so an engine that is restarted and dies
 * again is new. A terminal stage never changes, and is reported on every call.
 *
 * A run reaches a terminal stage only once the decision that led there has been carried out.
 * `run.json` names the new stage before that decision's steps run (the `mark_ready` that takes
 * the PR out of draft, say), so until the journal is gone the run is still being driven, and an
 * engine that died among those steps is down like one that died anywhere else.
 */
function standing(runDir: string): { key: string; line: string; always: boolean }[] {
  const out: { key: string; line: string; always: boolean }[] = [];
  const pending = pendingJudgment(runDir);
  if (pending) {
    out.push({
      key: `judgment ${pending.id} ${refusals(runDir, pending.id)}`,
      line: `JUDGMENT ${pending.id} ${pending.kind} ${requestPath(runDir, pending.id)}`,
      always: false,
    });
  }
  const run = loadRun(runDir);
  const unfinished = existsSync(join(runDir, JOURNAL)) || run.pendingWork !== null;
  const { stage } = run;
  if (TERMINAL.has(stage) && !unfinished) {
    out.push({ key: `stage ${stage}`, line: `STAGE ${stage}`, always: true });
  } else {
    const lock = lockState(runDir);
    if (!lock.alive)
      out.push({ key: `down ${lock.generation}`, line: "ENGINE down", always: false });
  }
  return out;
}

/**
 * One look at the run: the notify events after `cursor`, then every standing condition (a pending
 * judgment, a terminal stage the run has finished arriving at, a dead engine). Stateless: a
 * pending judgment is listed on every call until it is answered.
 */
export function awaitLines(runDir: string, cursor: number): { lines: string[]; cursor: number } {
  const read = readEventsFrom(runDir, cursor);
  return {
    lines: [...eventLines(read.events), ...standing(runDir).map((s) => s.line)],
    cursor: read.cursor,
  };
}

/** How long `awaitWork` holds back a standing condition it has already reported. */
export const REPEAT_MS = 60_000;

/**
 * The byte offset of the next event, and when each standing condition was last reported (ms since
 * the epoch). An announcement record this version cannot read is dropped, never the offset, which
 * would print the whole event history again.
 */
const Cursor = z.object({
  offset: z.number().int().min(0),
  announced: z.record(z.string(), z.number()).catch({}),
});
type Cursor = z.infer<typeof Cursor>;

function readCursor(runDir: string): Cursor {
  try {
    return Cursor.parse(JSON.parse(readFileSync(join(runDir, CURSOR), "utf8")));
  } catch {
    return { offset: 0, announced: {} };
  }
}

/**
 * Blocks until there is something to tell the orchestrator, and returns it. The cursor is kept in
 * `await.cursor`, so every event is printed once across calls. A standing condition is reported
 * at once when it is new, and a reported one is held back until `repeatMs` after its last report
 * or until the deadline, whichever comes first. Holding it back keeps a re-armed `await` from
 * waking the orchestrator again at once, in a loop, while a condition stands. Holding it only that
 * long is what keeps the wait from going silent when the condition still needs acting on: a
 * session that resumes the run hears the judgment an earlier session was told, and a restart that
 * failed before it took the lock is reported down again. With nothing at all to report by the
 * deadline, the result is `TIMEOUT rearm`. A terminal stage returns at once, every time, since
 * nothing will follow it.
 */
export async function awaitWork(
  runDir: string,
  o: { pollMs: number; deadlineMs: number; repeatMs?: number; signal?: AbortSignal },
): Promise<string[]> {
  const started = Date.now();
  const repeatMs = o.repeatMs ?? REPEAT_MS;
  const saved = readCursor(runDir);
  const announced = new Map(Object.entries(saved.announced));
  let offset = saved.offset;
  for (;;) {
    const read = readEventsFrom(runDir, offset);
    offset = read.cursor;
    const fresh = eventLines(read.events);
    const now = standing(runDir);
    // A condition that cleared is forgotten, so that it is reported if it comes back.
    const keys = new Set(now.map((s) => s.key));
    for (const key of [...announced.keys()]) if (!keys.has(key)) announced.delete(key);
    const clock = Date.now();
    const due = clock - started >= o.deadlineMs;
    const held = (key: string) => {
      const at = announced.get(key);
      return at !== undefined && clock - at < repeatMs;
    };
    const report = now.filter((s) => s.always || due || !held(s.key));
    if (fresh.length > 0 || report.length > 0 || due) {
      const kept = now.map((s): [string, number] => [
        s.key,
        report.includes(s) ? clock : (announced.get(s.key) ?? clock),
      ]);
      const cursor: Cursor = { offset, announced: Object.fromEntries(kept) };
      writeAtomic(join(runDir, CURSOR), `${JSON.stringify(cursor)}\n`);
      const lines = [...fresh, ...report.map((s) => s.line)];
      return lines.length > 0 ? lines : ["TIMEOUT rearm"];
    }
    await delay(pollMsOf(o), undefined, { signal: o.signal });
  }
}
