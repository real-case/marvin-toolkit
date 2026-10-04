import { lstatSync, realpathSync, renameSync, writeFileSync } from "node:fs";
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
 */
export function formatTestOne(template: string, path: string): string {
  if (FOREIGN_PLACEHOLDERS.some((placeholder) => template.includes(placeholder))) {
    throw new Error(
      "gates.test_one must not contain {name}, {ref} or {path}: the seal stage runs a whole test file, so name it with {file} alone",
    );
  }
  if (!template.includes(FILE)) throw new Error("gates.test_one must contain {file}");
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

/** Why `abs` is not a regular file that lives inside the worktree, or null if it is. */
function fileProblem(abs: string, realRoot: string): string | null {
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
    return isInside(realRoot, realpathSync(abs)) ? null : "resolves outside the worktree";
  } catch (error) {
    return `cannot be inspected (${errorCode(error) ?? errorText(error)})`;
  }
}

const NOT_RUN_CODES: ReadonlySet<number> = new Set([124, 126, 127]);
const TIMED_OUT = /timed out after/i;
const NO_TEST_FOUND = /\bno tests? (files )?found\b/i;

/** Why a command's outcome is not a genuine failure of the test, or null if it is one. */
function redProblem(result: ReturnType<Runner>): string | null {
  const { code } = result;
  const output = typeof result.output === "string" ? result.output : "";
  if (code === 0) return "passes before implementation, so it proves nothing";
  if (!Number.isInteger(code) || code < 0 || NOT_RUN_CODES.has(code) || TIMED_OUT.test(output)) {
    return `test command did not run (exit ${String(code)})`;
  }
  return NO_TEST_FOUND.test(output) ? "the runner found no test in it" : null;
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
 * inside the worktree (never a link), map to a criterion, and FAIL when run on its own: a
 * command that did not run, or found no test, proves nothing either.
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
    if (!isTest.test(path)) {
      reasons.push(`${path}: not a test path`);
      continue;
    }
    const abs = join(o.worktree, path);
    const problem = fileProblem(abs, realRoot);
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

  const sealed: SealedFile[] = [];
  for (const c of candidates) {
    if (failed.has(c.path)) continue;
    const problem = fileProblem(c.abs, realRoot);
    if (problem !== null) {
      reasons.push(`${c.path}: after its red run, it ${problem}`);
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
