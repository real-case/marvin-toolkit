import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
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
 * a substring, jest a regular expression, `node --test` a glob, each against paths relative to a
 * root the project's config may move. `sealAuthoredTests` refuses a red run in which the runner
 * reports more than one test file. As a conservative fallback, checked before anything runs, it
 * also refuses a candidate that ANY of three static readings would match to another test file,
 * even if the template hands the path over literally (`jest --runTestsByPath {file}`): seal
 * cannot know the runner. A path with regular-expression or glob characters, such as a Next.js
 * `[id]` directory, is therefore refused while a sibling it could match exists, and the operator
 * adjusts `gates.test_one`.
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
/**
 * vitest: `No test files found`, `No test found in suite x`, `No test suite found in file y`.
 * jest: `No tests found`.
 */
const NO_TEST_FOUND = /\bno tests? (suites? |files? )?found\b/i;
/** jest, for a file with no test in it. */
const NO_TEST_IN_SUITE = /\byour test suite must contain at least one test\b/i;

/**
 * Whether `node --test` reported that it found nothing under the candidate's own name. It prints
 * `Could not find '<path>'`, with exit 1, for a path argument that names no file and holds no glob
 * magic (a brace set, a one-character class): the path as given, or, in older versions, resolved
 * against its working directory. Only that exact line counts, unindented, case-sensitive, with
 * one of `spellings` quoted; the same words in a failure message (jest indents one) are a failure.
 */
function nodeFoundNothing(output: string, spellings: readonly string[]): boolean {
  const lines = new Set(spellings.map((path) => `Could not find '${path}'`));
  return output.split("\n").some((line) => lines.has(line));
}

/** The escape sequences a coloured reporter wraps its words in: CSI, OSC and the two-byte ones. */
// eslint-disable-next-line no-control-regex -- the escape character is exactly what is stripped
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
/**
 * The summary lines in which a runner reports how many test files it ran: vitest's
 * ` Test Files  1 failed | 1 passed (2)` and jest's `Test Suites: 1 failed, 1 passed, 2 total`.
 */
const FILE_COUNTS: readonly RegExp[] = [
  /^\s*Test Files\b.*\((\d+)\)\s*$/gm,
  /^\s*Test Suites:.*?\b(\d+) total\b/gm,
];

/**
 * The largest number of test files the runner says it ran, or null when it printed no count.
 * The largest, because a test's own output can print a line of the same shape, and it must not
 * be able to hide the runner's.
 */
function reportedFileCount(output: string): number | null {
  let largest: number | null = null;
  for (const line of FILE_COUNTS) {
    for (const match of output.matchAll(line)) {
      const n = Number(match[1]);
      if (largest === null || n > largest) largest = n;
    }
  }
  return largest;
}

/**
 * Why a command's outcome is not a genuine failure of the test, or null if it is one. `spellings`
 * are the candidate's path as the command named it and its absolute forms.
 */
function redProblem(result: ReturnType<Runner>, spellings: readonly string[]): string | null {
  const { code } = result;
  const output = typeof result.output === "string" ? result.output.replace(ANSI, "") : "";
  if (code === 0) return "passes before implementation, so it proves nothing";
  if (!Number.isInteger(code) || code < 0 || NOT_RUN_CODES.has(code) || TIMED_OUT.test(output)) {
    return `test command did not run (exit ${String(code)})`;
  }
  const files = reportedFileCount(output);
  if (files !== null && files !== 1) return `the runner ran ${files} test files, not just this one`;
  return NO_TEST_FOUND.test(output) ||
    NO_TEST_IN_SUITE.test(output) ||
    nodeFoundNothing(output, spellings)
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
 * failing filter) is a rewrite too, and so is one that exits 0 but writes an `error:` or `fatal:`
 * line to stderr: a BOM under `working-tree-encoding` is reported that way by `hash-object`, while
 * `git add` dies on it and commits nothing.
 */
function gitWouldRewrite(worktree: string, path: string): boolean {
  const run = (...args: string[]) =>
    spawnSync("git", ["-c", "core.fsmonitor=false", "hash-object", ...args, "--", path], {
      cwd: worktree,
      env: gitEnv(),
      maxBuffer: MAX_BUFFER,
      encoding: "utf8",
    });
  const filtered = run(`--path=${path}`);
  const raw = run("--no-filters");
  if (filtered.error || raw.error || filtered.status !== 0 || raw.status !== 0) return true;
  if (/^(error|fatal):/m.test(`${filtered.stderr}${raw.stderr}`)) return true;
  return filtered.stdout.trim() !== raw.stdout.trim();
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
  /** In a nested `.git` or `node_modules` directory: vitest and jest exclude those, node's glob does not. */
  runnerExcluded: boolean;
}

interface OutsideLink {
  path: string;
  /** In a nested `.git` or `node_modules` directory, or named so: only node's glob can enter it. */
  runnerExcluded: boolean;
}

interface Walked {
  siblings: Sibling[];
  /** Set when a directory could not be read: what the runner could select is then unknown. */
  problem: string | null;
  /** Symlinked directories that lead out of the worktree, which the walk does not enter. */
  outside: OutsideLink[];
}

/** Whether `path` lies in a nested `.git` or `node_modules` directory (the root ones are never walked). */
const runnerExcludes = (path: string): boolean =>
  path.split("/").some((segment) => segment === ".git" || segment === "node_modules");

/**
 * Every file in the worktree that a runner could take for a test, found by walking the disk, not
 * by asking git: vitest never reads `.gitignore` and does not stop at a nested repository, so an
 * ignored `coverage/xa.test.ts` or a failing test inside `vendor/` is selected like any other.
 *
 * Symlinked directories are followed (vitest follows them), under the name of the link, with the
 * real paths of the directories above as the guard against a cycle; one whose real path lies
 * outside the worktree is reported in `outside` and not entered. Only the ROOT `.git` and the root
 * `node_modules` are skipped. Nested ones are walked, because node's glob can name a `.git` or
 * `node_modules` segment with a class or a leading dot (`d/.gi[t]/a.test.mjs`), and their files and
 * outside links are marked `runnerExcluded` so that only the glob reading counts them.
 */
function walkTestFiles(worktree: string, realRoot: string, isTest: RegExp): Walked {
  const siblings: Sibling[] = [];
  const outside: OutsideLink[] = [];
  const pending = [{ rel: "", real: realRoot, chain: [realRoot] as readonly string[] }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { rel, real, chain } = next;
    let entries;
    try {
      entries = readdirSync(join(worktree, rel), { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      return {
        siblings,
        outside,
        problem: `${errorCode(error) ?? errorText(error)} reading ${rel === "" ? "." : rel}`,
      };
    }
    for (const entry of entries) {
      if (rel === "" && (entry.name === ".git" || entry.name === "node_modules")) continue;
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      let directory = entry.isDirectory();
      let childReal = join(real, entry.name);
      if (entry.isSymbolicLink()) {
        let target: string | null = null;
        try {
          if (statSync(join(worktree, path)).isDirectory())
            target = realpathSync(join(worktree, path));
        } catch {
          target = null;
        }
        if (target !== null) {
          if (target !== realRoot && !isInside(realRoot, target)) {
            outside.push({ path, runnerExcluded: runnerExcludes(path) });
            continue;
          }
          if (chain.includes(target)) continue;
          directory = true;
          childReal = target;
        }
      }
      if (directory) {
        pending.push({ rel: path, real: childReal, chain: [...chain, childReal] });
        continue;
      }
      if (!isTest.test(path) && !BUILTIN_TEST_SHAPES.some((shape) => shape.test(path))) continue;
      try {
        const { dev, ino } = lstatSync(join(worktree, path), { bigint: true });
        siblings.push({ path, dev, ino, runnerExcluded: runnerExcludes(path) });
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          return {
            siblings,
            outside,
            problem: `${errorCode(error) ?? errorText(error)} reading ${path}`,
          };
        }
      }
    }
  }
  return { siblings, outside, problem: null };
}

const escapeRegExp = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");

/** `[...]` of a glob, or -1: a `]` straight after the opening (and an optional `!`/`^`) is a member. */
function classEnd(glob: string, open: number): number {
  let i = open + 1;
  if (glob[i] === "!" || glob[i] === "^") i += 1;
  if (glob[i] === "]") i += 1;
  return glob.indexOf("]", i);
}

const ANY = ".*";

/**
 * The glob as a sequence of regular expression elements, each matching one character, or `.*`;
 * joined, they match every path the glob matches, plus more. Null when the glob holds something
 * not modelled, which is read as "matches everything": any `{` (brace expansion has rules of its
 * own, such as `x{},y}` expanding to `x}` and `xy`), an extglob, a POSIX class. `*` and `**` become
 * `.*` (so they cross `/`), `?` becomes `.`, and a negated class loses its `/` exclusion; leading
 * dots are not special. Anything else is the literal character.
 */
function globElements(glob: string): string[] | null {
  if (glob.includes("{")) return null;
  const out: string[] = [];
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i] as string;
    if ("?*+@!".includes(ch) && glob[i + 1] === "(") return null;
    if (ch === "*") {
      while (glob[i + 1] === "*") i += 1;
      out.push(ANY);
    } else if (ch === "?") {
      out.push(".");
    } else if (ch === "[") {
      const end = classEnd(glob, i);
      if (end === -1) {
        out.push("\\[");
        continue;
      }
      const inner = glob.slice(i + 1, end);
      if (inner.includes("[:") || inner.includes("[.") || inner.includes("[=")) return null;
      const negated = inner.startsWith("!") || inner.startsWith("^");
      const members = (negated ? inner.slice(1) : inner).replace(/[\\\][^]/g, "\\$&");
      out.push(`[${negated ? "^" : ""}${members}]`);
      i = end;
    } else if (ch === "\\") {
      out.push(escapeRegExp(glob[i + 1] ?? "\\"));
      i += 1;
    } else {
      out.push(escapeRegExp(ch));
    }
  }
  return out;
}

/** A matcher for `glob` over a whole path; null (read as "matches everything") if it cannot be built. */
function globMatcher(glob: string): RegExp | null {
  const elements = globElements(glob);
  if (elements === null) return null;
  try {
    return new RegExp(`^${elements.join("")}$`, "i");
  } catch {
    return null;
  }
}

/**
 * Whether the glob reading of `glob` can match a path inside the directory `dir`, which it can
 * when it is not modelled: does `dir/`, as it is on disk or folded, begin some path the glob
 * matches? Each element in turn is optional, so that the sequence may stop anywhere, and the
 * first `.*` ends it, since it matches any rest.
 */
function globCanEnter(glob: string, dir: string): boolean {
  const elements = globElements(glob);
  if (elements === null) return true;
  const star = elements.indexOf(ANY);
  const head = star === -1 ? elements : elements.slice(0, star + 1);
  try {
    const prefix = head.reduceRight((rest, element) => `(?:${element}${rest})?`, "");
    const begins = new RegExp(`^${prefix}$`, "i");
    return [dir, fold(dir)].some((subject) => begins.test(`${subject}/`));
  } catch {
    return true;
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
 * The static readings of `{file}`: a conservative fallback, not a model of how any runner really
 * selects. `{file}` is read as a substring of the path (as vitest's filter is), as a
 * case-insensitive regular expression (as jest's is) and as a glob (as `node --test`'s is), and
 * the command may also select a sibling if ANY reading does. The candidate is compiled as
 * written, with the `i` flag, never case-folded first (`[A-z]` is not `[a-z]`); each reading is
 * tried against the sibling's path as it is on disk and in its folded form (NFC, lower case),
 * relative to the worktree and under each spelling of its root. A reading that cannot be built
 * (a regular expression that does not compile, a glob that is not modelled) selects every sibling
 * it applies to. vitest and jest exclude nested `.git` and `node_modules` directories, so those
 * siblings count for the glob alone.
 *
 * Every subject is relative to the worktree root, or absolute. A runner whose root sits below the
 * worktree (vitest `test.projects`, `--root` or `--dir`; jest `rootDir` or `projects`) matches
 * `{file}` against paths relative to that root, which none of these readings sees: such a
 * selection is covered only by the runner's own count of the files it ran (`reportedFileCount`).
 * Where a runner prints that count it is the primary evidence. These readings are what is left
 * for a runner that prints none, such as `node --test`; they stay in force for every runner,
 * because they are checked before anything runs.
 */
function selectedBy(candidate: string, roots: readonly string[]): (sibling: Sibling) => boolean {
  const folded = fold(candidate);
  const regex = regexMatcher(candidate);
  const glob = globMatcher(candidate);
  return (sibling) => {
    const subjects = [sibling.path, ...roots.map((root) => `${root}/${sibling.path}`)];
    const viaGlob =
      glob === null || [sibling.path, fold(sibling.path)].some((subject) => glob.test(subject));
    if (sibling.runnerExcluded) return viaGlob;
    return (
      viaGlob ||
      regex === null ||
      subjects.some(
        (subject) =>
          subject.includes(candidate) ||
          fold(subject).includes(folded) ||
          regex.test(subject) ||
          regex.test(fold(subject)),
      )
    );
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
 * filter would run a sibling too and judge the exit code of the pair. Two kinds of evidence
 * guard this. The primary one is the runner's own count: after each red run, a vitest or jest
 * summary reporting any number of test files but 1 refuses the candidate. It alone covers a
 * runner whose root sits below the worktree (vitest `test.projects`, jest `rootDir`), which
 * matches `{file}` against paths the static readings never see. The fallback, for a runner that
 * prints no count (`node --test`), is the static readings, which are conservative and are checked
 * for every runner before anything runs: no OTHER test file may be matched by the candidate's
 * path read as a substring, a regular expression or a glob, relative to the worktree root or
 * absolute; see `selectedBy`. The siblings come from walking the disk, not from git: they
 * include ignored files, the contents of nested repositories and the files behind symlinked
 * directories, and skip only the root `.git` and the root `node_modules` (see `walkTestFiles`).
 * A symlinked directory that leaves the worktree is a reason of its own, except one in a nested
 * `.git` or `node_modules` directory, which counts only for a candidate whose glob reading can
 * match a path inside it (vitest and jest never enter those directories). A sibling is any file
 * matching the test pattern, a `.test`/`.spec` file or a file under `__tests__/`. The glob
 * reading is converted to a regular expression here, not by `path.matchesGlob`, which Node 20
 * lacks before 20.17 and which is experimental in some versions.
 *
 * This is a guard against honest mistakes and cheap tricks, not a proof: the red run executes
 * test-author code, which can defeat any check made around it. The structural snapshots around
 * the seal stage, the verifier and the PR review are the other lines.
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
    const selects = selectedBy(path, [...new Set([o.worktree, realRoot])]);
    const own = fold(path);
    const other = walked.siblings
      .filter((s) => !(s.dev === self.dev && s.ino === self.ino && fold(s.path) === own))
      .filter(selects)
      .map((s) => s.path)
      .sort()[0];
    return other === undefined ? null : `the single-test command may also select ${other}`;
  };
  /**
   * A symlinked directory that leaves the worktree hides what the runner could select behind it.
   * In a nested `.git` or `node_modules` directory only node's glob could enter it, so there it
   * counts only for a candidate whose glob reading can match a path inside it.
   */
  const outsideLinks = (found: Walked, path: string): void => {
    for (const link of found.outside) {
      if (link.runnerExcluded && !globCanEnter(path, link.path)) continue;
      const reason = `${link.path}: symlinked directory points outside the worktree`;
      if (!reasons.includes(reason)) reasons.push(reason);
    }
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
    walked ??= walkTestFiles(o.worktree, realRoot, isTest);
    outsideLinks(walked, path);
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
      problem = redProblem(o.run(formatTestOne(o.testOne, c.path), o.worktree, o.timeoutMs), [
        c.path,
        join(o.worktree, c.path),
        join(realRoot, c.path),
      ]);
    } catch (error) {
      problem = `test command did not run (${errorText(error)})`;
    }
    if (problem !== null) {
      failed.add(c.path);
      reasons.push(`${c.path}: ${problem}`);
    }
  }

  const afterRuns = candidates.length > 0 ? listFiles(o.worktree) : [];
  const walkedAfter =
    candidates.length > 0 ? walkTestFiles(o.worktree, realRoot, isTest) : undefined;
  if (walkedAfter !== undefined) for (const c of candidates) outsideLinks(walkedAfter, c.path);
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
