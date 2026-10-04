import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { isCanonicalPath, type Runner, type SealedFile, sha256File } from "./gate.js";

export interface AuthoredTest {
  path: string;
  criteria: string[];
}
export interface SealVerdict {
  ok: boolean;
  reasons: string[];
  sealed: SealedFile[];
}

const FILE = "{file}";
const FOREIGN_PLACEHOLDERS = ["{name}", "{ref}", "{path}"];
/** Syntax in which a substituted word is not one word: a heredoc body, a comment, a substitution. */
const NOT_ONE_WORD = /[`\r\n]|\$\(|<<|#/;

/**
 * True when a `{file}` in `template` sits inside a quoted span or behind a backslash. The
 * substituted path is single-quoted by `formatTestOne`, which inside another quote would be a
 * literal character and behind a backslash would be an escaped one.
 */
function placeholderIsQuoted(template: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < template.length; i += 1) {
    if (template.startsWith(FILE, i)) {
      if (quote !== null) return true;
      i += FILE.length - 1;
      continue;
    }
    const ch = template[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === "\\") {
      if (template.startsWith(FILE, i + 1)) return true;
      i += 1;
      continue;
    }
    if (ch === '"') quote = quote === null ? '"' : null;
    else if (ch === "'" && quote === null) quote = "'";
  }
  return false;
}

/**
 * The shell command that runs one test file: `{file}` is replaced, everywhere, by the path in
 * single quotes. The path is data written by the test-author, so it reaches the shell as one
 * literal word whatever it contains. `{name}`, `{ref}` and `{path}` are refused because the
 * seal stage runs a whole file, and a name filter left unfilled would match nothing or everything.
 * A backtick, `$(`, `<<`, `#` or newline anywhere in the template is refused too: after one of
 * them `{file}` would be a heredoc line, a comment, or a word the shell splits and globs.
 *
 * `gates.test_one` must select exactly ONE file. A runner that takes its argument as a filter
 * selects every file the argument matches, and the runners disagree on what it is: vitest reads
 * a substring, jest a regular expression, `node --test` a glob. `sealAuthoredTests` refuses a
 * candidate that ANY of the three readings would match to another test file, even if the
 * template hands the path over literally (`jest --runTestsByPath {file}`): seal cannot know the
 * runner. A path with regular-expression or glob characters, such as a Next.js `[id]` directory,
 * is therefore refused while a sibling it could match exists, and the operator adjusts
 * `gates.test_one`.
 */
export function formatTestOne(template: string, path: string): string {
  if (FOREIGN_PLACEHOLDERS.some((placeholder) => template.includes(placeholder))) {
    throw new Error(
      "gates.test_one must not contain {name}, {ref} or {path}: the seal stage runs a whole test file, so name it with {file} alone",
    );
  }
  if (!template.includes(FILE)) throw new Error("gates.test_one must contain {file}");
  if (NOT_ONE_WORD.test(template)) {
    throw new Error(
      "gates.test_one must not contain a backtick, $(, <<, # or a newline: {file} must stay one shell word",
    );
  }
  if (placeholderIsQuoted(template)) {
    throw new Error("gates.test_one must not quote {file}: the engine quotes the path itself");
  }
  const quoted = `'${path.replaceAll("'", "'\\''")}'`;
  return template.replaceAll(FILE, () => quoted);
}

const isInside = (root: string, target: string): boolean => {
  const rel = relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException)?.code;
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Why `abs` is not a regular file that lives at `path` inside the worktree, or null if it is.
 * The physical path must be the canonical spelling: a path through a symlinked directory names a
 * file git holds under a different path, which the gate could never verify.
 */
function fileProblem(abs: string, realRoot: string, path: string): string | null {
  let stat;
  try {
    stat = lstatSync(abs);
  } catch (error) {
    const code = errorCode(error);
    return code === "ENOENT" || code === "ENOTDIR"
      ? "does not exist"
      : `cannot be inspected (${code ?? errorText(error)})`;
  }
  if (stat.isSymbolicLink()) return "is a symbolic link, not a regular file";
  if (stat.isDirectory()) return "is a directory, not a regular file";
  if (!stat.isFile()) return "is not a regular file";
  try {
    const real = realpathSync(abs);
    if (!isInside(realRoot, real)) return "resolves outside the worktree";
    return real === join(realRoot, path)
      ? null
      : "is reached through a symbolic link, so git does not hold it under this path";
  } catch (error) {
    return `cannot be inspected (${errorCode(error) ?? errorText(error)})`;
  }
}

const NOT_RUN_CODES: ReadonlySet<number> = new Set([124, 126, 127]);
const TIMED_OUT = /timed out after/i;
/** vitest: `No test files found`, `No test found in suite x`, `No test suite found in file y`. */
const NO_TEST_FOUND = /\bno tests? (suites? |files? )?found\b/i;
/** jest, for a file with no test in it. */
const NO_TEST_IN_SUITE = /\byour test suite must contain at least one test\b/i;

/** Why a command's outcome is not a genuine failure of the test, or null if it is one. */
function redProblem(result: ReturnType<Runner>): string | null {
  const { code } = result;
  const output = typeof result.output === "string" ? result.output : "";
  if (code === 0) return "passes before implementation, so it proves nothing";
  if (!Number.isInteger(code) || code < 0 || NOT_RUN_CODES.has(code) || TIMED_OUT.test(output)) {
    return `test command did not run (exit ${String(code)})`;
  }
  return NO_TEST_FOUND.test(output) || NO_TEST_IN_SUITE.test(output)
    ? "the runner found no test in it"
    : null;
}

function compilePattern(source: string): RegExp {
  if (typeof source !== "string" || source === "") {
    throw new Error("testPathPattern must be a non-empty regular expression");
  }
  try {
    return new RegExp(source);
  } catch (error) {
    throw new Error(`testPathPattern is not a valid regular expression (${errorText(error)})`, {
      cause: error,
    });
  }
}

const MAX_BUFFER = 64 * 1024 * 1024;

/** The environment git runs in: every inherited `GIT_*` variable dropped but `GIT_EXEC_PATH`. */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_") || key === "GIT_EXEC_PATH") env[key] = value;
  }
  return env;
}

interface Listed {
  path: string;
  /** The name's bytes survive a UTF-8 round trip, so `path` is the name git holds, not a lossy decoding of it. */
  exact: boolean;
}

/**
 * Every file the worktree holds that git does not ignore, tracked or not, spelled the way git
 * spells it (`git ls-files`: a precomposed name where `core.precomposeunicode` is on, the case
 * the index holds). That spelling is the one the gate looks a sealed path up under. Git runs
 * against the worktree with every inherited `GIT_*` variable dropped, so an ambient `GIT_DIR` or
 * `GIT_INDEX_FILE` does not decide which repository is listed.
 */
function listFiles(worktree: string): Listed[] {
  const env = gitEnv();
  let out: Buffer;
  try {
    out = execFileSync(
      "git",
      [
        "-c",
        "core.fsmonitor=false",
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
      ],
      { cwd: worktree, env, maxBuffer: MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    throw new Error(`cannot list the worktree's files (${errorText(error)})`, { cause: error });
  }
  return out
    .toString("latin1")
    .split("\0")
    .filter(Boolean)
    .map((raw) => {
      const path = Buffer.from(raw, "latin1").toString("utf8");
      return { path, exact: Buffer.from(path, "utf8").toString("latin1") === raw };
    });
}

/**
 * A name in the form two spellings of one file share: composed Unicode, lower case. Jest reads
 * its path filter as a case-insensitive regular expression, and a file system may fold either, so
 * a sibling that differs from a candidate only in case or Unicode form can still be selected by it.
 */
const fold = (s: string): string => s.normalize("NFC").toLowerCase();

/**
 * Whether git would commit `path` with other bytes than the ones on disk: an eol or `filter`
 * attribute, `core.autocrlf`. The gate compares the sealed hash with the committed blob, so a
 * file git rewrites on commit could never converge. `hash-object --path` applies the filters a
 * commit would; `--no-filters` hashes the disk bytes. A hash-object that fails (safecrlf, a
 * failing filter) is a rewrite too: the commit would fail the same way.
 */
function gitWouldRewrite(worktree: string, path: string): boolean {
  const run = (...args: string[]) =>
    execFileSync("git", ["-c", "core.fsmonitor=false", "hash-object", ...args, "--", path], {
      cwd: worktree,
      env: gitEnv(),
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    })
      .toString("utf8")
      .trim();
  try {
    return run(`--path=${path}`) !== run("--no-filters");
  } catch {
    return true;
  }
}

/** The shapes of a test file that runners select by default, whatever `testPathPattern` says. */
const BUILTIN_TEST_SHAPES: readonly RegExp[] = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)__tests__\//,
];

interface Sibling {
  path: string;
  dev: bigint;
  ino: bigint;
}

interface Walked {
  siblings: Sibling[];
  /** Set when a directory could not be read: what the runner could select is then unknown. */
  problem: string | null;
}

/**
 * Every file in the worktree that a runner could take for a test, found by walking the disk, not
 * by asking git: vitest never reads `.gitignore` and does not stop at a nested repository, so an
 * ignored `coverage/xa.test.ts` or a failing test inside `vendor/` is selected like any other.
 * Symlinks are not followed. Only `.git` entries (a directory, or the file a worktree or
 * submodule has) and directories named `node_modules` are skipped, which runners exclude by default.
 */
function walkTestFiles(worktree: string, isTest: RegExp): Walked {
  const siblings: Sibling[] = [];
  const pending = [""];
  for (let rel = pending.pop(); rel !== undefined; rel = pending.pop()) {
    let entries;
    try {
      entries = readdirSync(join(worktree, rel), { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      return {
        siblings,
        problem: `${errorCode(error) ?? errorText(error)} reading ${rel === "" ? "." : rel}`,
      };
    }
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") pending.push(path);
        continue;
      }
      if (!isTest.test(path) && !BUILTIN_TEST_SHAPES.some((shape) => shape.test(path))) continue;
      try {
        const { dev, ino } = lstatSync(join(worktree, path), { bigint: true });
        siblings.push({ path, dev, ino });
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          return { siblings, problem: `${errorCode(error) ?? errorText(error)} reading ${path}` };
        }
      }
    }
  }
  return { siblings, problem: null };
}

const escapeRegExp = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");

/** `[...]` of a glob, or -1: a `]` straight after the opening (and an optional `!`/`^`) is a member. */
function classEnd(glob: string, open: number): number {
  let i = open + 1;
  if (glob[i] === "!" || glob[i] === "^") i += 1;
  if (glob[i] === "]") i += 1;
  return glob.indexOf("]", i);
}

/** `{...}` of a glob with its matching brace, or -1. */
function braceEnd(glob: string, open: number): number {
  let depth = 0;
  for (let i = open; i < glob.length; i += 1) {
    if (glob[i] === "\\") i += 1;
    else if (glob[i] === "{") depth += 1;
    else if (glob[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** The top-level comma-separated parts of a brace body. */
function braceParts(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === "\\") i += 1;
    else if (body[i] === "{") depth += 1;
    else if (body[i] === "}") depth -= 1;
    else if (body[i] === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/**
 * A regular expression source that matches at least every path the glob matches, or null when
 * the glob uses something not modelled (an extglob, a POSIX class, a brace range): null is read
 * as "matches everything". `*` and `**` become `.*` (so they cross `/`), `?` becomes `.`, a
 * negated class loses its `/` exclusion, and a brace set with one member also matches its own
 * braces, which is how a shell reads it. Every simplification matches more, never less.
 */
function globSource(glob: string): string | null {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i] as string;
    if ("?*+@!".includes(ch) && glob[i + 1] === "(") return null;
    if (ch === "*") {
      while (glob[i + 1] === "*") i += 1;
      out += ".*";
    } else if (ch === "?") {
      out += ".";
    } else if (ch === "[") {
      const end = classEnd(glob, i);
      if (end === -1) {
        out += "\\[";
        continue;
      }
      const inner = glob.slice(i + 1, end);
      if (inner.includes("[:") || inner.includes("[.") || inner.includes("[=")) return null;
      const negated = inner.startsWith("!") || inner.startsWith("^");
      const members = (negated ? inner.slice(1) : inner).replace(/[\\\][^]/g, "\\$&");
      out += `[${negated ? "^" : ""}${members}]`;
      i = end;
    } else if (ch === "{") {
      const end = braceEnd(glob, i);
      if (end === -1) {
        out += "\\{";
        continue;
      }
      const body = glob.slice(i + 1, end);
      if (body.includes("..")) return null;
      const parts = braceParts(body).map(globSource);
      if (parts.some((part) => part === null)) return null;
      const alternatives = parts as string[];
      if (alternatives.length === 1) alternatives.push(escapeRegExp(glob.slice(i, end + 1)));
      out += `(?:${alternatives.join("|")})`;
      i = end;
    } else if (ch === "\\") {
      out += escapeRegExp(glob[i + 1] ?? "\\");
      i += 1;
    } else {
      out += escapeRegExp(ch);
    }
  }
  return out;
}

/** A matcher for `glob` over a whole path; null (read as "matches everything") if it cannot be built. */
function globMatcher(glob: string): RegExp | null {
  const source = globSource(glob);
  if (source === null) return null;
  try {
    return new RegExp(`^${source}$`, "i");
  } catch {
    return null;
  }
}

/** A matcher for `source` read as a case-insensitive regular expression; null if it does not compile. */
function regexMatcher(source: string): RegExp | null {
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}

/**
 * The three ways a runner can read `{file}`: vitest takes it as a substring of the path, jest as
 * a case-insensitive regular expression, `node --test` as a glob. The command may also select a
 * sibling if ANY of them does, and a reading that cannot be built (a regular expression that does
 * not compile, a glob with an extglob) counts as selecting every sibling.
 */
function selectedBy(candidate: string): (sibling: string) => boolean {
  const c = fold(candidate);
  const regex = regexMatcher(c);
  const glob = globMatcher(c);
  return (sibling) => {
    const s = fold(sibling);
    return s.includes(c) || regex === null || regex.test(s) || glob === null || glob.test(s);
  };
}

const REWRITE =
  "git would rewrite this file on commit (eol/filter attributes); write it in its committed form";

const shown = (path: unknown): string =>
  typeof path === "string" ? JSON.stringify(path) : String(path);

interface Candidate {
  path: string;
  abs: string;
  criteria: string[];
  before: string;
}

/**
 * Judge the tests a test-author wrote before they become the acceptance contract. Each one
 * must be a canonical repo-relative path that matches the test pattern, name a regular file
 * inside the worktree (never a link, never through a symlinked directory), appear in
 * `git ls-files` byte for byte (so seal, the runner's filter and the gate's `HEAD:<path>` blob
 * lookup all name the file by one spelling: a case variant or the other Unicode form of the
 * name, a gitignored file and a file inside a nested repository are refused), map to a
 * criterion, and FAIL when run on its own: a command that did not run, or found no test, proves
 * nothing either. No segment may start with `-` (the runner would read it as an option).
 *
 * `gates.test_one` must select exactly one file, and a runner that treats its argument as a
 * filter would run a sibling too and judge the exit code of the pair. So no OTHER test file may
 * be matched by the candidate's path read as a substring (vitest), as a regular expression
 * (jest) or as a glob (`node --test`). The siblings come from walking the disk, not from git:
 * they include ignored files and the contents of nested repositories, and skip only `.git` and
 * `node_modules`. A sibling is any file matching the test pattern, a `.test`/`.spec` file or a
 * file under `__tests__/`. The glob reading is converted to a regular expression here, not by
 * `path.matchesGlob`, which Node 20 lacks before 20.17 and which is experimental in some
 * versions; the conversion matches at least everything the glob does.
 *
 * Git must commit what is on disk: a file that an eol or filter attribute (or `core.autocrlf`)
 * would rewrite on commit is refused, since the gate compares the sealed hash with the blob.
 *
 * Nothing is sealed unless every test passes every check. A red run executes the test, so each
 * file is hashed before the first run and again after the last, and one that changed while the
 * runs executed is refused: what was seen failing must be what gets sealed.
 *
 * Throws only on a misconfigured call (pattern, template, timeout, worktree); anything a
 * test-author can influence comes back as a reason.
 */
export function sealAuthoredTests(o: {
  worktree: string;
  tests: readonly AuthoredTest[];
  testPathPattern: string;
  testOne: string;
  run: Runner;
  timeoutMs: number;
}): SealVerdict {
  const isTest = compilePattern(o.testPathPattern);
  formatTestOne(o.testOne, "probe.test.ts");
  if (!Number.isFinite(o.timeoutMs) || o.timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive finite number");
  }
  if (!isAbsolute(o.worktree)) throw new Error("worktree must be an absolute path");
  const realRoot = realpathSync(o.worktree);

  const reasons: string[] = [];
  if (o.tests.length === 0) reasons.push("no tests were authored");

  let files: Listed[] | undefined;
  const isListed = (path: string, list: readonly Listed[]): boolean =>
    list.some((f) => f.exact && f.path === path);
  /** Why the single-test command may select a file other than `path`, or null if it cannot. */
  const selection = (path: string, abs: string, walked: Walked): string | null => {
    if (walked.problem !== null) {
      return `cannot tell what the single-test command may also select (${walked.problem})`;
    }
    const self = lstatSync(abs, { bigint: true });
    const selects = selectedBy(path);
    const other = walked.siblings
      .filter((s) => s.path !== path && !(s.dev === self.dev && s.ino === self.ino))
      .map((s) => s.path)
      .filter(selects)
      .sort()[0];
    return other === undefined ? null : `the single-test command may also select ${other}`;
  };
  let walked: Walked | undefined;

  const seen = new Set<string>();
  const accepted: Omit<Candidate, "before">[] = [];
  for (const t of o.tests) {
    const path: unknown = t?.path;
    if (!isCanonicalPath(path)) {
      reasons.push(`${shown(path)}: path must be a canonical repo-relative POSIX path`);
      continue;
    }
    if (seen.has(path)) {
      reasons.push(`${path}: listed more than once`);
      continue;
    }
    seen.add(path);
    if (path.split("/").some((segment) => segment.startsWith("-"))) {
      reasons.push(`${path}: a path segment starting with "-" would be read as a runner option`);
      continue;
    }
    if (!isTest.test(path)) {
      reasons.push(`${path}: not a test path`);
      continue;
    }
    const abs = join(o.worktree, path);
    const problem = fileProblem(abs, realRoot, path);
    if (problem !== null) {
      reasons.push(`${path}: ${problem}`);
      continue;
    }
    const criteria: unknown = t.criteria;
    if (
      !Array.isArray(criteria) ||
      criteria.length === 0 ||
      criteria.some((c) => typeof c !== "string" || c.trim() === "")
    ) {
      reasons.push(`${path}: maps to no acceptance criterion`);
      continue;
    }
    files ??= listFiles(o.worktree);
    if (!isListed(path, files)) {
      reasons.push(`${path}: not listed by git under this exact spelling`);
      continue;
    }
    if (gitWouldRewrite(o.worktree, path)) {
      reasons.push(`${path}: ${REWRITE}`);
      continue;
    }
    walked ??= walkTestFiles(o.worktree, isTest);
    const selected = selection(path, abs, walked);
    if (selected !== null) {
      reasons.push(`${path}: ${selected}`);
      continue;
    }
    accepted.push({ path, abs, criteria: [...(criteria as string[])] });
  }

  const candidates: Candidate[] = [];
  for (const a of accepted) {
    try {
      candidates.push({ ...a, before: sha256File(a.abs) });
    } catch (error) {
      reasons.push(`${a.path}: cannot be read (${errorText(error)})`);
    }
  }

  const failed = new Set<string>();
  for (const c of candidates) {
    let problem: string | null;
    try {
      problem = redProblem(o.run(formatTestOne(o.testOne, c.path), o.worktree, o.timeoutMs));
    } catch (error) {
      problem = `test command did not run (${errorText(error)})`;
    }
    if (problem !== null) {
      failed.add(c.path);
      reasons.push(`${c.path}: ${problem}`);
    }
  }

  const afterRuns = candidates.length > 0 ? listFiles(o.worktree) : [];
  const walkedAfter = candidates.length > 0 ? walkTestFiles(o.worktree, isTest) : undefined;
  const sealed: SealedFile[] = [];
  for (const c of candidates) {
    if (failed.has(c.path)) continue;
    const problem = fileProblem(c.abs, realRoot, c.path);
    if (problem !== null) {
      reasons.push(`${c.path}: after its red run, it ${problem}`);
      continue;
    }
    if (!isListed(c.path, afterRuns)) {
      reasons.push(`${c.path}: after the red runs, not listed by git under this exact spelling`);
      continue;
    }
    if (gitWouldRewrite(o.worktree, c.path)) {
      reasons.push(`${c.path}: after the red runs, ${REWRITE}`);
      continue;
    }
    const selected = walkedAfter === undefined ? null : selection(c.path, c.abs, walkedAfter);
    if (selected !== null) {
      reasons.push(`${c.path}: after the red runs, ${selected}`);
      continue;
    }
    let after: string;
    try {
      after = sha256File(c.abs);
    } catch (error) {
      reasons.push(`${c.path}: cannot be read (${errorText(error)})`);
      continue;
    }
    if (after !== c.before) {
      reasons.push(
        `${c.path}: changed while its red run executed, so what ran is not what is sealed`,
      );
      continue;
    }
    sealed.push({ path: c.path, criteria: c.criteria, sha256: after });
  }

  return reasons.length > 0
    ? { ok: false, reasons, sealed: [] }
    : { ok: true, reasons: [], sealed };
}

/**
 * Record which paths are sealed, for `sealed-guard`: a JSON array of repo-relative paths in
 * `<runDir>/sealed.json`, written through a temporary file so the guard never reads half of it.
 */
export function writeSealManifest(runDir: string, sealed: readonly SealedFile[]): void {
  const paths = sealed.map((s) => s.path);
  for (const path of paths) {
    if (!isCanonicalPath(path)) throw new Error(`sealed path is not canonical: ${shown(path)}`);
  }
  const target = join(runDir, "sealed.json");
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(paths)}\n`);
  renameSync(tmp, target);
}
