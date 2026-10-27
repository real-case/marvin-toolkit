import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, join, posix, resolve } from "node:path";
import { createContext, Script } from "node:vm";
import { SLUG_RE } from "../storage/metrics.js";
import { classifyRecord } from "./metrics-carry.js";
import { isCanonicalPath } from "./plain-path.js";
import { declaredVolatile, volatileEntryProblem } from "./volatile.js";

// Re-exported: callers across the engine import it from here, where it was first defined.
export { isCanonicalPath };

export const SEVERITIES = ["blocker", "major", "minor"] as const;
export type Severity = (typeof SEVERITIES)[number];
export interface GateCommand {
  name: string;
  command: string;
  /** Re-run once after a failure and call a pass on the re-run flaky. Default true. */
  retry?: boolean;
}
export interface CheckRule {
  id: string;
  pattern: string;
  path_pattern?: string;
  exclude_pattern?: string;
  message: string;
  severity?: Severity;
  category?: string;
}
export interface GateResult {
  name: string;
  result: "pass" | "fail" | "flaky" | "not-run";
  ms: number;
  tail: string;
  /**
   * The gate whose single run this result repeats: several criteria resolving to one command
   * (one test file proving them all) run it once, and every one of them reports its outcome.
   */
  sharedWith?: string;
}
export interface AddedLine {
  file: string;
  line: number;
  text: string;
}
export interface CheckHit {
  id: string;
  file: string;
  line: number;
  text: string;
  message: string;
  severity: Severity;
  category: string;
  /** The rule did not finish within its time budget; there is no file, line or text. */
  timedOut?: true;
}
export interface SealedFile {
  path: string;
  sha256: string;
  criteria: string[];
}
/** Path to a fingerprint (content hash, `link:<target>` or `missing`) of every protected file. */
export type ProtectedSnapshot = Record<string, string>;
export type ProtectedSource = "committed diff" | "protected snapshot" | "post-gate snapshot";
/** A blocker the engine found by itself rather than through a gate, check or hash. */
export interface GateBlocker {
  category: "scope" | "gate";
  claim: string;
  file?: string;
  evidence: string;
  expected: string;
}
export interface GateReport {
  passed: boolean;
  gates: GateResult[];
  undeclared: string[];
  protected: string[];
  /** Where each protected path was seen; a path with no entry came from the committed diff. */
  protectedSources: Record<string, ProtectedSource[]>;
  /** The patterns the protected paths were judged against. */
  protectedPatterns: string[];
  /**
   * Protected paths that changed but were not judged: declared volatile and ignored by git
   * (`protectedVolatile`). Listed so that the verifier and the PR still see them.
   */
  volatile?: string[];
  checks: CheckHit[];
  sealed: { path: string; ok: boolean }[];
  blockers: GateBlocker[];
}
export interface Finding {
  id: string;
  severity: Severity;
  category: string;
  file?: string;
  line?: number;
  criterion?: string;
  claim: string;
  evidence: string;
  expected: string;
}
export interface RunResult {
  code: number;
  output: string;
  ms: number;
}
export type Runner = (command: string, cwd: string, timeoutMs: number) => RunResult;
/**
 * What the gate stage runs its commands with. It may answer at once (a `Runner`) or later, and
 * one that takes the signal must end the command when it aborts and reject with its reason: a
 * command a stop request interrupted has no result to judge.
 */
export type GateRunner = (
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
) => RunResult | Promise<RunResult>;

const MAX_BUFFER = 64 * 1024 * 1024;
/** How long the supervisor gets to end its command's group after a TERM before it is killed. */
const SUPERVISOR_GRACE_MS = 5000;

/**
 * The command runs under a small Node supervisor, spawned non-detached so that it stays in the
 * caller's process group (a TERM to the engine's group reaches it, as does the runner's own
 * TERM on a timeout or a stop request). The supervisor starts `/bin/sh -c <command>` detached, which puts the shell
 * in its own session and process group, and on TERM or INT it signals that whole group: TERM,
 * then KILL a second later for a command that ignores TERM. Killing only the shell on a timeout
 * would leave the suite running next to its own retry, and writing to the worktree.
 *
 * This replaced a `set -m` shell wrapper. `set -m` gives a background job its own process
 * group only where the shell grants job control without a terminal: bash does, dash (Debian
 * and Ubuntu's `/bin/sh`) does not, so on Linux the wrapper printed `can't access tty; job
 * control turned off` into every gate's output and a timeout left the command's tree alive.
 * Plain POSIX sh has no other way to make a process group; Node's `detached` (setsid) does.
 *
 * The supervisor writes nothing: the command's stdout and stderr are inherited byte for byte,
 * and its exit code is passed through (128 + n for a command ended by signal n).
 */
const SUPERVISOR = `
const { spawn } = require("node:child_process");
const { constants } = require("node:os");
const child = spawn("/bin/sh", ["-c", process.argv[1]], { detached: true, stdio: "inherit" });
let stopping = false;
const signalGroup = (sig) => { try { process.kill(-child.pid, sig); } catch {} };
const stop = () => {
  if (stopping) return;
  stopping = true;
  signalGroup("SIGTERM");
  setTimeout(() => { signalGroup("SIGKILL"); process.exit(124); }, 1000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("SIGHUP", stop);
child.on("error", (e) => { process.stderr.write("error: " + e.message + "\\n"); process.exit(127); });
child.on("exit", (code, signal) => {
  if (stopping) signalGroup("SIGKILL");
  process.exit(code ?? 128 + (constants.signals[signal] ?? 0));
});
`;

export const shellRunner: Runner = (command, cwd, timeoutMs) => {
  const started = Date.now();
  const r = spawnSync(process.execPath, ["-e", SUPERVISOR, "--", command], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
  });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  const launch = timedOut
    ? `error: timed out after ${timeoutMs}ms\n`
    : r.error
      ? `error: ${r.error.message}\n`
      : "";
  return {
    code: timedOut ? 124 : (r.status ?? 124),
    output: `${r.stdout ?? ""}${r.stderr ?? ""}${launch}`,
    ms: Date.now() - started,
  };
};

/**
 * `shellRunner` without blocking the event loop, for the gate stage: a gate may run for an hour,
 * and while `spawnSync` waits the engine cannot run its TERM handler, so a stop request (a
 * shutdown, `kill <pid>`) waited for the gate to end, or for the KILL that followed, and the
 * engine went down with no note and its lock held. Here the same supervisor runs the command;
 * when `signal` aborts, the supervisor gets the TERM it already turns into TERM-then-KILL of the
 * command's group, and the promise rejects with the signal's reason once it has exited.
 *
 * Its answers are `shellRunner`'s: the exit code (128 + n for a signal), stdout then stderr, and
 * a timeout as 124 with the same line. Output is decoded once, at the end, so a character split
 * across two pipe reads stays whole.
 */
export const shellRunnerAsync = (
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RunResult> =>
  new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const started = Date.now();
    const supervisor = spawn(process.execPath, ["-e", SUPERVISOR, "--", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let ended: "timeout" | "abort" | "overflow" | null = null;
    let launchError: Error | null = null;
    let grace: NodeJS.Timeout | undefined;
    const end = (why: "timeout" | "abort" | "overflow") => {
      if (ended !== null) return;
      ended = why;
      supervisor.kill("SIGTERM");
      grace = setTimeout(() => supervisor.kill("SIGKILL"), SUPERVISOR_GRACE_MS);
      grace.unref();
    };
    const collect = (into: Buffer[]) => (chunk: Buffer) => {
      if (ended === "overflow") return;
      size += chunk.length;
      if (size > MAX_BUFFER) {
        end("overflow");
        return;
      }
      into.push(chunk);
    };
    supervisor.stdout.on("data", collect(stdout));
    supervisor.stderr.on("data", collect(stderr));
    const timer = setTimeout(() => end("timeout"), timeoutMs);
    const onAbort = () => end("abort");
    signal?.addEventListener("abort", onAbort, { once: true });
    supervisor.once("error", (error) => {
      launchError = error;
    });
    supervisor.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(grace);
      signal?.removeEventListener("abort", onAbort);
      if (ended === "abort") {
        reject(signal?.reason);
        return;
      }
      const tail =
        ended === "timeout"
          ? `error: timed out after ${timeoutMs}ms\n`
          : ended === "overflow"
            ? `error: output exceeded ${MAX_BUFFER} bytes\n`
            : launchError
              ? `error: ${launchError.message}\n`
              : "";
      resolvePromise({
        code: ended === "timeout" ? 124 : (code ?? 124),
        output: `${Buffer.concat(stdout).toString("utf8")}${Buffer.concat(stderr).toString("utf8")}${tail}`,
        ms: Date.now() - started,
      });
    });
  });

const relevantTail = (s: string) => {
  const lines = s.trimEnd().split("\n");
  const errors = lines.filter((l) => /\berror\b|\bfail(ed|ure)?\b|✗|×/i.test(l)).slice(-20);
  return (errors.length ? errors : lines.slice(-40)).join("\n");
};

/**
 * Runs the gates one after another. A stop request on `signal` rejects with its reason, before a
 * gate starts or after one returns: a gate it interrupted is neither a result nor re-run, and no
 * later gate runs.
 */
export async function runGates(
  commands: readonly GateCommand[],
  cwd: string,
  run: GateRunner,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<GateResult[]> {
  const once = async (command: string) => {
    signal?.throwIfAborted();
    const result = await run(command, cwd, timeoutMs, signal);
    signal?.throwIfAborted();
    return result;
  };
  const results: GateResult[] = [];
  for (const { name, command, retry = true } of commands) {
    const first = await once(command);
    if (first.code === 0) {
      results.push({ name, result: "pass", ms: first.ms, tail: "" });
      continue;
    }
    if (!retry) {
      results.push({ name, result: "fail", ms: first.ms, tail: relevantTail(first.output) });
      continue;
    }
    const second = await once(command);
    results.push(
      second.code === 0
        ? { name, result: "flaky", ms: first.ms + second.ms, tail: relevantTail(first.output) }
        : { name, result: "fail", ms: first.ms + second.ms, tail: relevantTail(second.output) },
    );
  }
  return results;
}

const C_ESCAPES: Record<string, number> = {
  '"': 0x22,
  "\\": 0x5c,
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
};

/**
 * Decode git's C-style quoting of a path: a name with a quote, backslash or control
 * character, or (without `core.quotePath=false`) a non-ASCII byte, is wrapped in `"…"`
 * with `\" \\ \a \b \t \n \v \f \r` and three-digit octal bytes, which form UTF-8.
 * Anything not wrapped in quotes is returned as is.
 */
export function cUnquote(quoted: string): string {
  if (quoted.length < 2 || !quoted.startsWith('"') || !quoted.endsWith('"')) return quoted;
  const chars = Array.from(quoted.slice(1, -1));
  const bytes: number[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] ?? "";
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(chars.slice(i + 1, i + 4).join(""))?.[0];
    if (octal) {
      bytes.push(parseInt(octal, 8) & 0xff);
      i += octal.length;
      continue;
    }
    const escaped = C_ESCAPES[chars[i + 1] ?? ""];
    if (escaped !== undefined) {
      bytes.push(escaped);
      i += 1;
      continue;
    }
    bytes.push(0x5c);
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * The added lines of a unified diff with their new-file line numbers. Inside a hunk the
 * header counts say how many lines belong to it, so an added line whose text happens to
 * start with `++ ` or `-- ` is content, never a file header that would re-attribute the
 * lines after it to another path.
 */
export function addedLines(diff: string): AddedLine[] {
  const out: AddedLine[] = [];
  let file = "";
  let next = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of diff.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (raw.startsWith("+")) {
        out.push({ file, line: next, text: raw.slice(1) });
        next += 1;
        newLeft -= 1;
      } else if (raw.startsWith("-")) {
        oldLeft -= 1;
      } else if (!raw.startsWith("\\")) {
        next += 1;
        oldLeft -= 1;
        newLeft -= 1;
      }
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const name = raw.slice(4);
      file = (name.startsWith('"') ? cUnquote(name) : name.replace(/\t.*$/, "")).replace(
        /^b\//,
        "",
      );
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      next = Number(hunk[2]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    }
  }
  return out;
}

/** How long one check may spend matching over all the added lines. */
export const CHECK_BUDGET_MS = 2000;

/**
 * The matching loop of one rule, run in a vm so that its timeout can interrupt a regular
 * expression that backtracks without bound (V8 checks for the interrupt inside the match).
 * Returns the indices of the lines that match.
 */
const MATCH_LINES = new Script(`(() => {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (only !== null && !only.test(line.file)) continue;
    if (skip !== null && skip.test(line.file)) continue;
    if (re.test(line.text)) out.push(i);
  }
  return out;
})()`);

/**
 * Run each rule over the added lines. A rule is given `budgetMs` for the whole scan; one that
 * does not finish (a pattern such as `(a|aa)+$` on a line of `a`s) is cut off and reported as
 * a blocker in the `gate` category, never waited for and never dropped. The patterns come from
 * `checks.yaml`, which a retro child proposes into, so no pattern is trusted to be cheap.
 */
export function scanChecks(
  lines: readonly AddedLine[],
  rules: readonly CheckRule[],
  budgetMs: number = CHECK_BUDGET_MS,
): CheckHit[] {
  const hits: CheckHit[] = [];
  const context = createContext({ lines, re: null, only: null, skip: null });
  for (const rule of rules) {
    context.re = new RegExp(rule.pattern);
    context.only = rule.path_pattern ? new RegExp(rule.path_pattern) : null;
    context.skip = rule.exclude_pattern ? new RegExp(rule.exclude_pattern) : null;
    let matched: number[];
    try {
      matched = MATCH_LINES.runInContext(context, { timeout: budgetMs }) as number[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
      hits.push({
        id: rule.id,
        file: "",
        line: 0,
        text: "",
        message: `check ${rule.id} exceeded its ${budgetMs / 1000} s time budget`,
        severity: "blocker",
        category: "gate",
        timedOut: true,
      });
      continue;
    }
    for (const i of matched) {
      const l = lines[i]!;
      hits.push({
        id: rule.id,
        file: l.file,
        line: l.line,
        text: l.text.trim(),
        message: rule.message,
        severity: rule.severity ?? "major",
        category: rule.category ?? "convention",
      });
    }
  }
  return hits;
}

/**
 * The records marvin's own tools write for the task in hand: the spec and its `runs/` journals,
 * the metrics record task-deliver commits, and the critic receipts. The interactive scope gate
 * (`spec action: "scope"`) never counts `.marvin/` at all, and without this a pipeline run on
 * the default config would be rejected for the metrics record its own delivery commits. The rest
 * of `.marvin/` still counts: the lessons store reaches later children's prompts, so only the
 * retro writes it, and the config and `pipeline/` are protected paths besides.
 */
const MARVIN_RECORDS = /^\.marvin\/(?:task|metrics|critique)\//;
/** Where a metrics record lives; the one record the gate may carry must be one of these. */
const MARVIN_METRICS = /^\.marvin\/metrics\/[^/]+\.md$/;

export function undeclaredFiles(
  changed: readonly string[],
  declared: readonly string[],
  exemptPattern: string | null,
): string[] {
  const known = new Set(declared);
  const exempt = exemptPattern ? new RegExp(exemptPattern) : null;
  return [...new Set(changed)].filter(
    (f) => !known.has(f) && !MARVIN_RECORDS.test(f) && !exempt?.test(f),
  );
}

const JOURNAL_SUFFIXES = ["", ".progress", ".evidence", ".oracles", ".verify"];

/**
 * The service files the run's own children write for its spec, wherever they land: the `runs/`
 * journals beside the spec and under `.marvin/task/` (progress, evidence sidecar, oracles, verify
 * runs, the latest per-spec run), the project's latest `verification.md`, and the critic receipts
 * `.marvin/critique/<NNN>-<slug>.md`. The planner and the verify tool write them and nothing
 * commits them, so outside `.gitignore` every one of them read as uncommitted work: two rejected
 * iterations of a 2026-10-17 run held nothing else. They are tolerated only while uncommitted.
 * Committed, they are what the PR would carry as evidence, which an executor could forge, so the
 * committed diff still judges them as `undeclaredFiles` always has. Keyed on the run's own slug,
 * so another task's journals and receipts still count. The metrics record is not among them: the
 * carry check judges it.
 */
export function runArtifactMatcher(specPath: string, slug: string): (path: string) => boolean {
  if (!isCanonicalPath(specPath) || !SLUG_RE.test(slug)) return () => false;
  const dirs = new Set([posix.dirname(specPath), ".marvin/task"]);
  const own = new Set([".marvin/task/verification.md"]);
  for (const dir of dirs) {
    for (const suffix of JOURNAL_SUFFIXES) own.add(`${dir}/runs/${slug}${suffix}.md`);
  }
  const receipt = new RegExp(`^\\.marvin/critique/\\d+-${slug}\\.md$`);
  return (path) => own.has(path) || receipt.test(path);
}

/**
 * The protected-path regexes, case-insensitive like the boundary hook that enforces the same
 * list (the default macOS volume is). An empty list, a non-string or a pattern that does
 * not compile throws: a gate that quietly protects nothing is the failure to rule out.
 */
export function compileProtected(patterns: readonly string[]): RegExp[] {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error("protectedPatterns must be a non-empty array of regex strings");
  }
  return patterns.map((source: unknown) => {
    if (typeof source !== "string") throw new Error("protectedPatterns must hold only strings");
    return new RegExp(source, "i");
  });
}

/**
 * Does `path` match a protected pattern, as written or with a trailing `/`? A pattern such
 * as `^\.husky/` describes a directory, so a gitlink or a plain file standing where that
 * directory belongs (`.husky`) is a change to it as much as a file inside would be.
 */
const isProtectedPath = (res: readonly RegExp[], path: string) =>
  res.some((re) => re.test(path) || (!path.endsWith("/") && re.test(`${path}/`)));

/** The changed paths that match a protected-path regex source, each listed once. */
export function protectedChanges(
  changed: readonly string[],
  patterns: readonly string[],
): string[] {
  const res = compileProtected(patterns);
  return [...new Set(changed)].filter((f) => isProtectedPath(res, f));
}

export const sha256Bytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const sha256File = (path: string) => sha256Bytes(readFileSync(path));

export function checkSealed(
  worktree: string,
  sealed: readonly SealedFile[],
): { path: string; ok: boolean }[] {
  return sealed.map((s) => {
    try {
      return { path: s.path, ok: sha256File(join(worktree, s.path)) === s.sha256 };
    } catch {
      return { path: s.path, ok: false };
    }
  });
}

const fingerprint = (abs: string): string => {
  try {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) return `link:${readlinkSync(abs)}`;
    if (st.isDirectory()) return "dir";
    return sha256File(abs);
  } catch {
    return "missing";
  }
};

const nul = (s: string) => s.split("\0").filter(Boolean);

const NESTED_REPO = "nested-repo";

export type IsolatedGit = {
  text: (...args: string[]) => string;
  bytes: (...args: string[]) => Buffer;
  /** `text` with `input` on git's standard input. */
  textIn: (input: string | Uint8Array, ...args: string[]) => string;
};

/**
 * What every git call the engine makes puts before its subcommand. A child with code execution
 * can write anywhere in the repository's common git dir, outside the worktree: replace refs
 * that make an object read as another, a hooks directory, config naming filters and drivers.
 * None of it may steer the engine, so replacement is off, hooks come from nowhere, and no
 * fsmonitor command runs. (Filters and textconv are the caller's to avoid: read content with
 * `cat-file blob` and `diff --no-textconv --no-ext-diff`.) The one definition: `seal.ts` and
 * `worktree.ts` build their git calls from this too.
 */
export const HARDENED_GIT_OPTIONS: readonly string[] = [
  "--no-replace-objects",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
];

/**
 * The inherited `GIT_*` variables git still sees; every other one is dropped. An allowlist, so a
 * variable git adds later is dropped until someone decides it is safe. Three kinds are kept, none
 * of which can name a repository, an index or an object store, nor turn hooks, fsmonitor or object
 * replacement back on (the `-c` options in `HARDENED_GIT_OPTIONS` outrank every config file):
 *
 * - git's helpers and its credentials;
 * - the identity a commit is made under, which the seal and finalize commits need on a host that
 *   supplies it through the environment (a CI runner, a container);
 * - where the global and system config files live. Git reads a global config whatever happens, so
 *   dropping `GIT_CONFIG_GLOBAL` never kept a file out: it only swapped the one the host named for
 *   `$HOME/.gitconfig`, which on a CI runner holds no identity and on a developer's machine is
 *   the developer's own.
 *
 * Dropped on purpose, among the rest: `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
 * `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`, `GIT_NAMESPACE`,
 * `GIT_CEILING_DIRECTORIES`, `GIT_DISCOVERY_ACROSS_FILESYSTEM`, `GIT_REPLACE_REF_BASE`, and the
 * config injectors `GIT_CONFIG`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>`
 * and `GIT_CONFIG_VALUE_<n>`, which set keys at command-line scope rather than name a file.
 */
export const GIT_ENV_KEPT: ReadonlySet<string> = new Set([
  "GIT_EXEC_PATH",
  "GIT_ASKPASS",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_SSH_VARIANT",
  "GIT_TERMINAL_PROMPT",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_DATE",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
]);

/**
 * The environment git runs in: every inherited `GIT_*` variable outside `GIT_ENV_KEPT` dropped,
 * `extraEnv` added, and object replacement turned off for good.
 */
export function hardenedGitEnv(
  extraEnv: Readonly<Record<string, string>> = {},
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (!key.startsWith("GIT_") || GIT_ENV_KEPT.has(key)) env[key] = value;
  }
  Object.assign(env, extraEnv);
  env.GIT_NO_REPLACE_OBJECTS = "1";
  return env;
}

/**
 * Git pinned to one repository: `GIT_DIR` and `GIT_WORK_TREE` are passed explicitly and every
 * other `GIT_*` variable outside `GIT_ENV_KEPT` is dropped, so neither the worktree's `.git`
 * pointer (which a child can rewrite) nor an inherited `GIT_INDEX_FILE` decides which repository
 * is judged. Every call carries `HARDENED_GIT_OPTIONS`. `extraEnv` is added to the environment but
 * can never repoint `GIT_DIR` or `GIT_WORK_TREE`, nor turn object replacement back on.
 */
export function isolatedGit(
  worktree: string,
  gitDir: string,
  extraEnv: Readonly<Record<string, string>> = {},
): IsolatedGit {
  const env = hardenedGitEnv(extraEnv);
  env.GIT_DIR = gitDir;
  env.GIT_WORK_TREE = worktree;
  const run = (args: string[], input?: string | Uint8Array) =>
    execFileSync("git", [...HARDENED_GIT_OPTIONS, "-c", "core.quotePath=false", ...args], {
      cwd: worktree,
      env,
      maxBuffer: MAX_BUFFER,
      input,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
  return {
    text: (...args) => run(args).toString("utf8"),
    bytes: (...args) => run(args),
    textIn: (input, ...args) => run(args, input).toString("utf8"),
  };
}

/**
 * Hash every protected file, tracked or not and ignored or not, so a protected file hidden by
 * a self-ignoring `.gitignore`, or one in an ignored directory such as husky's `.husky/_`,
 * still shows up when its content changes. The engine takes a baseline before a writing child
 * runs and the gate compares against it. A symlink is `link:<target>`, a path git lists that
 * is gone from disk is `missing`.
 *
 * Git lists an embedded repository as its directory (`dir/`) and never looks inside it, so
 * the files in one cannot be fingerprinted. Every such directory, protected pattern or not,
 * is recorded as `"<dir>/": "nested-repo"` instead, so that one appearing is a difference.
 * A committed one is a gitlink (index mode 160000), which `ls-files --cached` prints without
 * the slash and the untracked listings never show; it is recorded under the same key.
 */
export function snapshotProtected(
  worktree: string,
  gitDir: string,
  patterns: readonly string[],
): ProtectedSnapshot {
  const res = compileProtected(patterns);
  const git = isolatedGit(worktree, gitDir);
  const names = new Set<string>();
  for (const args of [
    ["ls-files", "-z", "--cached"],
    ["ls-files", "-z", "--others", "--exclude-standard"],
    ["ls-files", "-z", "--others", "--ignored", "--exclude-standard"],
  ]) {
    for (const name of nul(git.text(...args))) names.add(name);
  }
  for (const entry of nul(git.text("ls-files", "-s", "-z"))) {
    const gitlink = /^160000 [0-9a-f]+ \d\t([\s\S]+)$/.exec(entry)?.[1];
    if (gitlink !== undefined) names.add(`${gitlink}/`);
  }
  const out: ProtectedSnapshot = {};
  for (const name of [...names].sort()) {
    if (name.endsWith("/")) out[name] = NESTED_REPO;
    else if (isProtectedPath(res, name)) out[name] = fingerprint(join(worktree, name));
  }
  return out;
}

/**
 * The paths of `paths` that git ignores, by the worktree's ignore rules. A tracked path is never
 * ignored, and a path gone from disk is judged by the rules alone, so a state file a hook removed
 * is as volatile as one it rewrote.
 */
export function ignoredPaths(
  worktree: string,
  gitDir: string,
  paths: readonly string[],
): Set<string> {
  if (paths.length === 0) return new Set();
  try {
    const out = isolatedGit(worktree, gitDir).textIn(
      `${paths.join("\0")}\0`,
      "check-ignore",
      "-z",
      "--stdin",
    );
    return new Set(nul(out));
  } catch (error) {
    // check-ignore exits 1 when it ignores none of the paths; anything else is a real failure.
    if ((error as { status?: unknown }).status === 1) return new Set();
    throw error;
  }
}

/** The sorted paths whose fingerprint differs between two snapshots, or exist in only one. */
export function diffProtected(a: ProtectedSnapshot, b: ProtectedSnapshot): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}

/**
 * Paths whose parsed added-line count disagrees with `git diff --numstat -z` for the same
 * range. The check scan reads a patch; if anything reshapes the patch into fewer lines than
 * git counted, the scan is blind there and the gate must say so rather than pass. A path
 * numstat reports as binary (`-`, which `--text` does not override: a `-diff` attribute, as
 * lockfiles often carry, is enough) has no count to compare and is left out.
 */
export function addedLineMismatches(lines: readonly AddedLine[], numstat: string): string[] {
  const parsed = new Map<string, number>();
  for (const l of lines) parsed.set(l.file, (parsed.get(l.file) ?? 0) + 1);
  const counted = new Map<string, number>();
  const binary = new Set<string>();
  for (const record of nul(numstat)) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record);
    if (m?.[3] === undefined) continue;
    if (m[1] === "-") binary.add(m[3]);
    else counted.set(m[3], Number(m[1]));
  }
  const paths = new Set([...parsed.keys(), ...counted.keys()]);
  return [...paths]
    .filter((f) => !binary.has(f) && (parsed.get(f) ?? 0) !== (counted.get(f) ?? 0))
    .sort();
}

export function buildReport(parts: Omit<GateReport, "passed">): GateReport {
  const passed =
    parts.gates.every((g) => g.result === "pass" || g.result === "flaky") &&
    parts.undeclared.length === 0 &&
    parts.protected.length === 0 &&
    parts.checks.every((c) => c.severity === "minor") &&
    parts.sealed.every((s) => s.ok) &&
    parts.blockers.length === 0;
  return { ...parts, passed };
}

/**
 * A protected-path finding that only a snapshot saw: the file changed on disk, never in the
 * committed diff. The executor did not commit it and, the path being protected, cannot remove it
 * either, so a repeat of it is not the executor's to fix (`decide`'s early halt).
 */
export const outsideCommittedDiff = (f: Finding) =>
  /^P-\d+$/.test(f.id) &&
  f.category === "scope" &&
  f.file !== undefined &&
  !f.evidence.split(", ").includes("committed diff" satisfies ProtectedSource);

export function reportFindings(r: GateReport): Finding[] {
  const out: Finding[] = [];
  for (const g of r.gates) {
    if (g.result === "not-run") {
      out.push({
        id: `G-${g.name}-not-run`,
        severity: "blocker",
        category: "gate",
        claim: `${g.name} was not run`,
        evidence: g.tail,
        expected: `${g.name} passes`,
      });
    }
    // A failed prepare step is reported by its own blocker ("prepare step <name> failed").
    if (g.result === "fail" && !g.name.startsWith("prepare:")) {
      out.push({
        id: `G-${g.name}`,
        severity: "blocker",
        category: "gate",
        claim: `${g.name} fails`,
        evidence: g.tail,
        expected: `${g.name} passes`,
      });
    }
    if (g.result === "flaky") {
      out.push({
        id: `G-${g.name}-flaky`,
        severity: "minor",
        category: "gate",
        claim: `${g.name} failed once and passed on re-run`,
        evidence: g.tail,
        expected: "deterministic pass",
      });
    }
  }
  r.undeclared.forEach((f, i) =>
    out.push({
      id: `S-${i + 1}`,
      severity: "major",
      category: "scope",
      file: f,
      claim: `${f} changed outside the spec contract`,
      evidence: "git diff --name-only",
      expected: "only contract files and sealed tests change",
    }),
  );
  r.protected.forEach((f, i) => {
    const sources = r.protectedSources[f] ?? ["committed diff"];
    const duringGates = sources.every((source) => source === "post-gate snapshot");
    out.push({
      id: `P-${i + 1}`,
      severity: "blocker",
      category: "scope",
      file: f,
      claim: duringGates ? `protected path ${f} changed during gates` : `${f} is a protected path`,
      evidence: sources.join(", "),
      expected: `no changes to protected paths (patterns: ${r.protectedPatterns.join(", ")})`,
    });
  });
  r.checks.forEach((c, i) =>
    out.push(
      c.timedOut
        ? {
            id: `C-${c.id}-${i + 1}`,
            severity: c.severity,
            category: c.category,
            claim: c.message,
            evidence: "the check's matching was interrupted at its time budget",
            expected: `check ${c.id} finishes within its time budget`,
          }
        : {
            id: `C-${c.id}-${i + 1}`,
            severity: c.severity,
            category: c.category,
            file: c.file,
            line: c.line,
            claim: c.message,
            evidence: c.text,
            expected: `no match for check ${c.id}`,
          },
    ),
  );
  for (const s of r.sealed) {
    if (!s.ok) {
      out.push({
        id: `T-${s.path}`,
        severity: "blocker",
        category: "test-quality",
        file: s.path,
        claim: "sealed acceptance test was modified or removed",
        evidence: "sha256 mismatch",
        expected: "sealed tests unchanged; dispute them through needs_input",
      });
    }
  }
  r.blockers.forEach((b, i) =>
    out.push({
      id: `B-${i + 1}`,
      severity: "blocker",
      category: b.category,
      ...(b.file === undefined ? {} : { file: b.file }),
      claim: b.claim,
      evidence: b.evidence,
      expected: b.expected,
    }),
  );
  return out;
}

/** What the engine resolved a criterion's oracle to; a null command is a blocker. */
export interface OracleInput {
  criterion: string;
  command: string | null;
  reason: string | null;
}

export interface GateStageOptions {
  /** Absolute path of the run worktree. */
  worktree: string;
  /** The commit the run branched from, a 40-hex SHA the engine recorded; `origin/<base>` is never read. */
  baseSha: string;
  /** Absolute path of the worktree's private git dir, recorded at worktree creation. */
  gitDir: string;
  /**
   * Commands that run before the oracles (a build, code generation), never retried. A failure
   * is a blocker, the remaining prepare steps and the oracles are reported as not run, and
   * the ordinary gates still run.
   */
  prepare?: readonly GateCommand[];
  gates: readonly GateCommand[];
  oracles: readonly OracleInput[];
  contractFiles: readonly string[];
  sealed: readonly SealedFile[];
  checks: readonly CheckRule[];
  exemptPattern: string | null;
  protectedPatterns: readonly string[];
  /** `snapshotProtected` as it stood before the child ran. */
  protectedBaseline: ProtectedSnapshot;
  /**
   * The host's volatile protected paths (`pipeline.protected_volatile`): state its own hooks and
   * gate scripts write under a protected directory, such as `.claude/.rules-loaded/`. A protected
   * path a snapshot finds changed is skipped when an entry covers it and git ignores it; a path
   * in `NEVER_VOLATILE` never is. Absent: none.
   */
  protectedVolatile?: readonly string[];
  /**
   * The run's metrics record (`metrics-carry.ts`), or null for none. Its one path is not
   * uncommitted work while its change against HEAD is an append the metrics tool would write:
   * the delivery gate appends the terminal block after the executor's last commit, and finalize
   * commits it. Any other change to it, and every other dirty path, stays a blocker.
   */
  metricsRecord?: { path: string; slug: string } | null;
  /**
   * The run's spec and slug, whose own service files (`runArtifactMatcher`) are not uncommitted
   * work. Committed, they still count. Null or absent: none is tolerated.
   */
  runArtifacts?: { specPath: string; slug: string } | null;
  run: GateRunner;
  timeoutMs: number;
  /**
   * A stop request: the command running when it aborts is ended through `run`, and the stage
   * rejects with its reason instead of reporting, so a stopped gate leaves no verdict and the
   * engine that resumes the run runs the whole stage again.
   */
  signal?: AbortSignal;
}

const MAX_UNCOMMITTED_FINDINGS = 100;

const PATCH_FLAGS = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--text",
  "--no-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

function validateOptions(o: GateStageOptions): void {
  if (!/^[0-9a-f]{40}$/.test(o.baseSha)) throw new Error("baseSha must be a 40-hex commit SHA");
  if (!isAbsolute(o.gitDir)) throw new Error("gitDir must be an absolute path");
  if (!isAbsolute(o.worktree)) throw new Error("worktree must be an absolute path");
  compileProtected(o.protectedPatterns);
  for (const entry of o.protectedVolatile ?? []) {
    const problem = typeof entry === "string" ? volatileEntryProblem(entry) : "it is not a string";
    if (problem !== null) throw new Error(`volatile entry ${String(entry)} is refused: ${problem}`);
  }
  for (const path of o.sealed.map((x) => x.path)) {
    if (!isCanonicalPath(path)) throw new Error(`sealed path is not canonical: ${String(path)}`);
  }
  for (const path of o.contractFiles) {
    if (!isCanonicalPath(path)) throw new Error(`contract file is not canonical: ${String(path)}`);
  }
  const artifacts = o.runArtifacts;
  if (artifacts != null) {
    if (!isCanonicalPath(artifacts.specPath)) {
      throw new Error(`run spec path is not canonical: ${String(artifacts.specPath)}`);
    }
    if (typeof artifacts.slug !== "string" || !SLUG_RE.test(artifacts.slug)) {
      throw new Error(`run slug is not kebab-case: ${String(artifacts.slug)}`);
    }
  }
  const record = o.metricsRecord;
  if (record != null) {
    if (!isCanonicalPath(record.path) || !MARVIN_METRICS.test(record.path)) {
      throw new Error(
        `metrics record is not a path under .marvin/metrics/: ${String(record.path)}`,
      );
    }
    if (typeof record.slug !== "string" || !SLUG_RE.test(record.slug)) {
      throw new Error(`metrics record slug is not kebab-case: ${String(record.slug)}`);
    }
  }
  const baseline: unknown = o.protectedBaseline;
  if (
    typeof baseline !== "object" ||
    baseline === null ||
    Array.isArray(baseline) ||
    Object.values(baseline).some((v) => typeof v !== "string")
  ) {
    throw new Error("protectedBaseline must be a snapshotProtected record");
  }
}

/** Why the worktree's `.git` is not the pointer the engine recorded, or null if it is. */
function pointerProblem(worktree: string, gitDir: string): string | null {
  try {
    const dotGit = join(worktree, ".git");
    if (!lstatSync(dotGit).isFile()) return ".git is not a file";
    const target = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(readFileSync(dotGit, "utf8"))?.[1];
    if (target === undefined) return ".git holds no gitdir line";
    return realpathSync(resolve(worktree, target)) === realpathSync(gitDir)
      ? null
      : `.git points at ${target}`;
  } catch (error) {
    return `.git cannot be read (${error instanceof Error ? error.message : String(error)})`;
  }
}

export async function runGateStage(o: GateStageOptions): Promise<GateReport> {
  validateOptions(o);
  const git = isolatedGit(o.worktree, o.gitDir);
  const blockers: GateBlocker[] = [];
  const protectedRes = compileProtected(o.protectedPatterns);
  const exempt = o.exemptPattern ? new RegExp(o.exemptPattern) : null;
  const sealedPaths = new Set(o.sealed.map((s) => s.path));
  const hiddenByIndex = (): Set<string> =>
    new Set(
      nul(git.text("ls-files", "-v", "-z"))
        .filter((record) => {
          const tag = record.charAt(0);
          return tag !== tag.toUpperCase() || tag === "S";
        })
        .map((record) => record.slice(2)),
    );
  const nestedRepo = (path: string): GateBlocker => ({
    category: "scope",
    claim: `nested git repository: ${path.slice(0, -1)}`,
    file: path.slice(0, -1),
    evidence: "git lists the directory and does not look inside it",
    expected: "no embedded git repository beyond those present when the run started",
  });

  const headSha = git.text("rev-parse", "--verify", "HEAD^{commit}").trim();
  git.text("cat-file", "-e", `${o.baseSha}^{commit}`);
  const range = `${o.baseSha}...${headSha}`;

  // The run's record is judged afresh at every look, against the HEAD the gate judges: the
  // gates run in between, and a record that was an append before them may not be after.
  const record = o.metricsRecord ?? null;
  const carriedRecord = (path: string) =>
    record !== null &&
    path === record.path &&
    !sealedPaths.has(path) &&
    !isProtectedPath(protectedRes, path) &&
    classifyRecord(git, headSha, o.worktree, path, record.slug).state === "appended";
  const runArtifact =
    o.runArtifacts != null
      ? runArtifactMatcher(o.runArtifacts.specPath, o.runArtifacts.slug)
      : () => false;
  const ownArtifact = (path: string) =>
    runArtifact(path) && !sealedPaths.has(path) && !isProtectedPath(protectedRes, path);
  const tolerated = (path: string) =>
    path.endsWith("/")
      ? o.protectedBaseline[path] === NESTED_REPO
      : carriedRecord(path) ||
        ownArtifact(path) ||
        (exempt !== null &&
          exempt.test(path) &&
          !sealedPaths.has(path) &&
          !isProtectedPath(protectedRes, path));

  const pointerBefore = pointerProblem(o.worktree, o.gitDir);
  if (pointerBefore !== null) {
    blockers.push({
      category: "scope",
      claim: "worktree .git pointer was changed",
      file: ".git",
      evidence: pointerBefore,
      expected: "the worktree's .git points at the git dir recorded when the run started",
    });
  }

  const flagsBefore = hiddenByIndex();
  for (const path of flagsBefore) {
    blockers.push({
      category: "scope",
      claim: `index flag hides changes: ${path}`,
      file: path,
      evidence: "git ls-files -v marks the entry assume-unchanged or skip-worktree",
      expected: "no assume-unchanged or skip-worktree entries: they blind every status check",
    });
  }

  const status = (untracked: "all" | "no") =>
    nul(
      git.text("status", "--porcelain=v1", "-z", `--untracked-files=${untracked}`, "--no-renames"),
    ).map((record) => ({ xy: record.slice(0, 2), path: record.slice(3) }));
  const dirtyBefore = status("all");
  const untolerated = dirtyBefore.filter((e) => !tolerated(e.path));
  // A record carried before the gates is judged again after them even when its status code does
  // not move: a gate that rewrites an earlier block of an already-appended record leaves it ` M`.
  const carriedBefore =
    record !== null &&
    dirtyBefore.some((e) => e.path === record.path) &&
    carriedRecord(record.path);
  for (const e of untolerated.slice(0, MAX_UNCOMMITTED_FINDINGS)) {
    blockers.push({
      category: "scope",
      claim: `uncommitted work: ${e.path}`,
      file: e.path,
      evidence: `git status --porcelain (${e.xy.trim() || "?"})`,
      expected: "everything the run produced is committed; the gate judges the committed HEAD",
    });
  }
  if (untolerated.length > MAX_UNCOMMITTED_FINDINGS) {
    blockers.push({
      category: "scope",
      claim: `uncommitted work: ${untolerated.length - MAX_UNCOMMITTED_FINDINGS} more paths`,
      evidence: "git status --porcelain",
      expected: "everything the run produced is committed; the gate judges the committed HEAD",
    });
  }

  const changed = nul(git.text("diff", "--name-only", "-z", "--no-renames", range));
  const sources = new Map<string, ProtectedSource[]>();
  const flag = (path: string, source: ProtectedSource) => {
    sources.set(path, [...(sources.get(path) ?? []), source]);
  };
  for (const path of protectedChanges(changed, o.protectedPatterns)) flag(path, "committed diff");
  const volatile = new Set<string>();
  // The snapshot differences a volatile declaration covers and git ignores; the rest are judged.
  const judged = (paths: string[]): string[] => {
    const declared = paths.filter(
      (p) => !p.endsWith("/") && declaredVolatile(o.protectedVolatile ?? [], p),
    );
    const ignored = ignoredPaths(o.worktree, o.gitDir, declared);
    for (const p of ignored) volatile.add(p);
    return paths.filter((p) => !ignored.has(p));
  };
  const protectedBefore = snapshotProtected(o.worktree, o.gitDir, o.protectedPatterns);
  for (const path of judged(diffProtected(o.protectedBaseline, protectedBefore))) {
    if (!path.endsWith("/")) flag(path, "protected snapshot");
    else if (protectedBefore[path] === NESTED_REPO) blockers.push(nestedRepo(path));
  }

  const patch = git.text("diff", "--unified=0", ...PATCH_FLAGS, range);
  const added = addedLines(patch);
  const numstat = git.text("diff", "--numstat", "-z", "--text", "--no-renames", range);
  for (const path of addedLineMismatches(added, numstat)) {
    blockers.push({
      category: "gate",
      claim: `check diff could not be parsed for ${path}`,
      file: path,
      evidence: "added lines read from the patch differ from git diff --numstat",
      expected: "the scan for leftover constructs sees every added line",
    });
  }

  const sealedBefore = o.sealed.map((s) => {
    try {
      return {
        path: s.path,
        ok: sha256Bytes(git.bytes("cat-file", "blob", `${headSha}:${s.path}`)) === s.sha256,
      };
    } catch {
      return { path: s.path, ok: false };
    }
  });

  const sealedOnDisk = checkSealed(o.worktree, o.sealed);
  const runnable = o.oracles.flatMap((x) =>
    x.command === null ? [] : [{ criterion: x.criterion, command: x.command }],
  );
  for (const x of o.oracles) {
    if (x.command !== null) continue;
    blockers.push({
      category: "gate",
      claim: `criterion ${x.criterion} has no runnable oracle: ${x.reason ?? "unresolved"}`,
      evidence: "spec-contract oracle resolution",
      expected: "every criterion that is not prose-review resolves to a command",
    });
  }
  // Order: prepare steps, oracles, ordinary gates. The oracles run before the ordinary gates
  // so code from those (child-authored tests inside `npm test`, say) cannot rewrite a sealed
  // test before its oracle reads it, and one at a time, with the sealed files hashed on disk
  // immediately before and after each, which also covers a prepare step that tampers.
  const prepareGates: GateResult[] = [];
  let prepareFailed: string | null = null;
  for (const step of o.prepare ?? []) {
    const name = `prepare:${step.name}`;
    if (prepareFailed !== null) {
      prepareGates.push({
        name,
        result: "not-run",
        ms: 0,
        tail: `prepare step ${prepareFailed} failed`,
      });
      continue;
    }
    const ran = await runGates(
      [{ name, command: step.command, retry: false }],
      o.worktree,
      o.run,
      o.timeoutMs,
      o.signal,
    );
    prepareGates.push(...ran);
    const failure = ran.find((r) => r.result === "fail");
    if (failure !== undefined) {
      prepareFailed = step.name;
      blockers.push({
        category: "gate",
        claim: `prepare step ${step.name} failed`,
        evidence: failure.tail,
        expected: "prepare steps succeed before the oracles run",
      });
    }
  }
  // Criteria that resolve to one command (a `kind: test` file that proves several of them) share
  // one run: in a 2026-10-13 run seven criteria named one 70-second test file, and the stage ran
  // it seven times. Each criterion still reports the outcome under its own name.
  const aroundOracle = new Set<string>();
  const oracleGates: GateResult[] = [];
  const byCommand = new Map<string, typeof runnable>();
  for (const x of prepareFailed === null ? runnable : []) {
    byCommand.set(x.command, [...(byCommand.get(x.command) ?? []), x]);
  }
  for (const [command, group] of byCommand) {
    const [first, ...rest] = group;
    if (first === undefined) continue;
    const before = checkSealed(o.worktree, o.sealed).filter((f) => !f.ok);
    const [ran] = await runGates(
      [{ name: `oracle:${first.criterion}`, command, retry: false }],
      o.worktree,
      o.run,
      o.timeoutMs,
      o.signal,
    );
    if (ran === undefined) continue;
    oracleGates.push(
      ran,
      ...rest.map((x) => ({ ...ran, name: `oracle:${x.criterion}`, ms: 0, sharedWith: ran.name })),
    );
    const after = checkSealed(o.worktree, o.sealed).filter((f) => !f.ok);
    const criteria = group.map((x) => x.criterion).join(", ");
    for (const path of new Set([...before, ...after].map((f) => f.path))) {
      aroundOracle.add(path);
      blockers.push({
        category: "scope",
        claim: `sealed file ${path} changed around oracle ${criteria}`,
        file: path,
        evidence: "sha256 differs from the sealed value just before or after the oracle ran",
        expected: "sealed tests are byte-identical while their oracles run",
      });
    }
  }
  if (prepareFailed !== null) {
    for (const x of runnable) {
      oracleGates.push({
        name: `oracle:${x.criterion}`,
        result: "not-run",
        ms: 0,
        tail: `prepare step ${prepareFailed} failed`,
      });
    }
  }
  const gates = [
    ...prepareGates,
    ...oracleGates,
    ...(await runGates(o.gates, o.worktree, o.run, o.timeoutMs, o.signal)),
  ];

  const headAfter = git.text("rev-parse", "--verify", "HEAD^{commit}").trim();
  if (headAfter !== headSha) {
    blockers.push({
      category: "scope",
      claim: "HEAD moved during gates",
      evidence: `${headSha} -> ${headAfter}`,
      expected: "the gates leave the committed HEAD alone",
    });
  }
  for (const path of hiddenByIndex()) {
    if (flagsBefore.has(path)) continue;
    blockers.push({
      category: "scope",
      claim: `gates set an index flag on ${path}`,
      file: path,
      evidence: "git ls-files -v marks the entry assume-unchanged or skip-worktree",
      expected: "the gates leave the index flags alone",
    });
  }
  const seenBefore = new Set(dirtyBefore.map((e) => `${e.xy}\0${e.path}`));
  for (const e of status("no")) {
    const recheck = carriedBefore && e.path === record?.path;
    if ((seenBefore.has(`${e.xy}\0${e.path}`) && !recheck) || tolerated(e.path)) continue;
    blockers.push({
      category: "scope",
      claim: `gates modified tracked file ${e.path}`,
      file: e.path,
      evidence: `git status --porcelain (${e.xy.trim() || "?"})`,
      expected: "the gates may create untracked artefacts but not touch tracked files",
    });
  }
  const pointerAfter = pointerProblem(o.worktree, o.gitDir);
  if (pointerBefore === null && pointerAfter !== null) {
    blockers.push({
      category: "scope",
      claim: "worktree .git pointer was changed during gates",
      file: ".git",
      evidence: pointerAfter,
      expected: "the worktree's .git points at the git dir recorded when the run started",
    });
  }
  const sealedAfter = checkSealed(o.worktree, o.sealed);
  const sealed = sealedBefore.map((before, i) => {
    const after = sealedAfter[i];
    if (before.ok && sealedOnDisk[i]?.ok && after !== undefined && !after.ok) {
      blockers.push({
        category: "scope",
        claim: `sealed file ${before.path} changed during gates`,
        file: before.path,
        evidence: "sha256 differs from the sealed value after the gates ran",
        expected: "sealed tests unchanged by the gates",
      });
    }
    return {
      path: before.path,
      ok: before.ok && after?.ok === true && !aroundOracle.has(before.path),
    };
  });
  const protectedAfter = snapshotProtected(o.worktree, o.gitDir, o.protectedPatterns);
  for (const path of judged(diffProtected(protectedBefore, protectedAfter))) {
    if (!path.endsWith("/")) flag(path, "post-gate snapshot");
    else if (protectedAfter[path] === NESTED_REPO) blockers.push(nestedRepo(path));
  }

  const protectedPaths = [...sources.keys()].sort();
  return buildReport({
    gates,
    undeclared: undeclaredFiles(
      changed,
      [...o.contractFiles, ...o.sealed.map((s) => s.path)],
      o.exemptPattern,
    ),
    protected: protectedPaths,
    protectedSources: Object.fromEntries(sources),
    protectedPatterns: [...o.protectedPatterns],
    volatile: [...volatile].sort(),
    checks: scanChecks(added, o.checks),
    sealed,
    blockers,
  });
}
