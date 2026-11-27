/**
 * Oracle outcome classification — "red for the right reason" (F6b of the fleet plan
 * "Fleet oracles that can fail"; ADR-0056).
 *
 * Ported from platform-agent-factory (`packages/cli/src/lib/oracle-run.ts`,
 * `docs/oracles-that-can-fail.md` step 2, origin/main 7bdf2dee826b). The names are the
 * factory's, so marvin and the factory sort a red the same way:
 *
 * - `failed`      — ran and failed: a failure raised while a test body ran.
 * - `did_not_run` — a collection, import or syntax error, a setup error, a skipped/todo
 *                   case, a suite that failed with no test results, no tests found, a
 *                   runner crash or a kill. NOT evidence about the code.
 * - `passed`      — ran and passed.
 * - `unknown`     — a non-zero exit from a command marvin has no per-runner detection
 *                   for (jest, go, cargo, plain commands). Never "ran and failed":
 *                   the factory refuses to fall back to the exit code, and so does this.
 *
 * Marks refine `failed` by the failure message alone (the factory's regexes, verbatim):
 * `missing_name` and `missing_file` are informational; `snapshot` is refused as proof.
 *
 * Difference from the factory: it reads a per-case report (vitest JSON, pytest JUnit XML)
 * through a `test_one_report` command. Marvin runs the project's own command and keeps no
 * report, so detection here reads the runner's summary text. Pure; no I/O.
 */

export type OracleOutcome = "passed" | "failed" | "did_not_run" | "unknown";
export type FailureMark = "missing_name" | "missing_file" | "snapshot";
export type OracleRunner = "pytest" | "vitest" | "node" | null;

export interface OracleClassification {
  outcome: OracleOutcome;
  marks: FailureMark[];
  runner: OracleRunner;
  /** One line saying why — the reason a red was not accepted, or what the runner reported. */
  detail: string;
}

// Factory regexes, verbatim (oracle-run.ts).
const MISSING_NAME =
  /cannot import name|has no attribute|is not defined|is not a function|of undefined|NameError/;
const MISSING_FILE = /FileNotFoundError|ENOENT/;
const SNAPSHOT =
  /Snapshot `[^`]*` mismatched|snapshot .*(?:does not exist|not written|missing)|Snapshot '[^']*' does not exist|obsolete snapshot|toMatch(?:Inline|File)?Snapshot/i;

export function failureMarks(message: string): FailureMark[] {
  const marks: FailureMark[] = [];
  if (MISSING_NAME.test(message)) marks.push("missing_name");
  if (MISSING_FILE.test(message)) marks.push("missing_file");
  if (SNAPSHOT.test(message)) marks.push("snapshot");
  return marks;
}

// eslint-disable-next-line no-control-regex -- stripping ANSI colour codes
const ANSI = /\u001b\[[0-9;]*m/g;
/** pytest's final line: `===== 1 failed, 1 passed in 0.02s =====`, or without the rules under `-q`. */
const PYTEST_SUMMARY = /^=*\s*((?:\d+ [a-z]+(?:, )?)+) in [\d.]+s(?: \([^)]*\))?\s*=*$/;
const VITEST_TESTS = /^\s*Tests\s+(.+?)\s*\(\d+\)\s*$/;
const VITEST_FILES = /^\s*Test Files\s+(.+?)\s*\(\d+\)\s*$/;

function counts(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [, n, word] of text.matchAll(/(\d+) ([a-z]+)/g)) {
    out.set(word!, (out.get(word!) ?? 0) + Number(n));
  }
  return out;
}

function pytest(lines: string[], text: string, code: number | null): OracleClassification | null {
  const summaryLine = lines
    .map((l) => PYTEST_SUMMARY.exec(l.trim()))
    .filter((m) => m)
    .pop();
  const noTests = lines.some((l) => /\bno tests ran\b|collected 0 items/.test(l));
  const session = /=+ test session starts =+/.test(text) || /^collected \d+ items?/m.test(text);
  if (!summaryLine && !noTests && !session) return null;
  const c = summaryLine ? counts(summaryLine[1]!) : new Map<string, number>();
  const failed = c.get("failed") ?? 0;
  const errors = (c.get("error") ?? 0) + (c.get("errors") ?? 0);
  const base = { runner: "pytest" as const };
  if (/errors? during collection|ERROR collecting|Interrupted:/.test(text)) {
    return { ...base, outcome: "did_not_run", marks: [], detail: "pytest: collection error" };
  }
  if (noTests && !summaryLine?.[1]?.includes("passed") && failed === 0) {
    return { ...base, outcome: "did_not_run", marks: [], detail: "pytest: no tests ran" };
  }
  if (failed > 0 && errors === 0) {
    return {
      ...base,
      outcome: "failed",
      marks: failureMarks(text),
      detail: `pytest: ${failed} failed`,
    };
  }
  if (errors > 0) {
    return {
      ...base,
      outcome: "did_not_run",
      marks: [],
      detail: `pytest: ${errors} setup/collection error(s)`,
    };
  }
  if (code === 0) {
    return (c.get("passed") ?? 0) > 0
      ? { ...base, outcome: "passed", marks: [], detail: "pytest: passed" }
      : { ...base, outcome: "did_not_run", marks: [], detail: "pytest: no test passed (skipped)" };
  }
  return {
    ...base,
    outcome: "did_not_run",
    marks: [],
    detail: `pytest: exit ${code} with no failed test`,
  };
}

function vitest(lines: string[], text: string, code: number | null): OracleClassification | null {
  const tests = lines
    .map((l) => VITEST_TESTS.exec(l))
    .filter((m) => m)
    .pop();
  const files = lines
    .map((l) => VITEST_FILES.exec(l))
    .filter((m) => m)
    .pop();
  const noFiles = /No test files found/.test(text);
  if (!tests && !files && !noFiles) return null;
  const base = { runner: "vitest" as const };
  if (noFiles)
    return { ...base, outcome: "did_not_run", marks: [], detail: "vitest: no test files found" };
  const t = tests ? counts(tests[1]!) : new Map<string, number>();
  const failed = t.get("failed") ?? 0;
  if (failed > 0) {
    return {
      ...base,
      outcome: "failed",
      marks: failureMarks(text),
      detail: `vitest: ${failed} failed`,
    };
  }
  if (!tests) {
    // The factory's "a vitest file whose suite failed with no test results".
    return {
      ...base,
      outcome: "did_not_run",
      marks: [],
      detail: "vitest: suite failed with no test results",
    };
  }
  if (code === 0 && (t.get("passed") ?? 0) > 0)
    return { ...base, outcome: "passed", marks: [], detail: "vitest: passed" };
  return {
    ...base,
    outcome: "did_not_run",
    marks: [],
    detail: "vitest: no test ran and failed (skipped/todo)",
  };
}

/** `node --test`'s summary, in either reporter: `ℹ fail 1` (spec) or `# fail 1` (TAP). */
const NODE_COUNT = (word: string) => new RegExp(`^(?:ℹ|#) ${word} (\\d+)\\s*$`, "m");
/**
 * A failure outside any test body: a file that did not load (an import, resolution or syntax
 * error) or threw at top level. The runner reports it as one failing test named after the file,
 * with the bare error `'test failed'`: on its own line in the spec reporter, as `error:` in TAP.
 * An assertion failing inside a test carries its own message instead.
 */
const NODE_FILE_FAILURE = /^\s*(?:error: )?'test failed'\s*$/m;

function nodeTest(text: string, code: number | null): OracleClassification | null {
  const read = (word: string) => {
    const m = NODE_COUNT(word).exec(text);
    return m ? Number(m[1]) : null;
  };
  const tests = read("tests");
  const fail = read("fail");
  if (tests === null || fail === null) return null;
  const pass = read("pass") ?? 0;
  const cancelled = read("cancelled") ?? 0;
  const base = { runner: "node" as const };
  if (fail > 0) {
    if (NODE_FILE_FAILURE.test(text)) {
      return {
        ...base,
        outcome: "did_not_run",
        marks: [],
        detail: "node:test: a test file failed outside any test (load, import or top-level error)",
      };
    }
    return {
      ...base,
      outcome: "failed",
      marks: failureMarks(text),
      detail: `node:test: ${fail} failed`,
    };
  }
  if (cancelled > 0) {
    return {
      ...base,
      outcome: "did_not_run",
      marks: [],
      detail: `node:test: ${cancelled} cancelled`,
    };
  }
  if (code === 0 && pass > 0) {
    return { ...base, outcome: "passed", marks: [], detail: "node:test: passed" };
  }
  return {
    ...base,
    outcome: "did_not_run",
    marks: [],
    detail: "node:test: no test ran and failed (skipped/todo)",
  };
}

/** Classify one oracle run from its exit and captured output. */
export function classifyOracleRun(run: {
  code: number | null;
  signal: string | null;
  output: string;
  launchError?: boolean;
}): OracleClassification {
  if (run.launchError || run.code === null || run.signal !== null) {
    return {
      outcome: "did_not_run",
      marks: [],
      runner: null,
      detail: "runner crashed, was killed or never launched",
    };
  }
  const text = run.output.replace(ANSI, "");
  const lines = text.split(/\r?\n/);
  const detected =
    pytest(lines, text, run.code) ?? vitest(lines, text, run.code) ?? nodeTest(text, run.code);
  if (detected) return detected;
  if (run.code === 0) return { outcome: "passed", marks: [], runner: null, detail: "exit 0" };
  return {
    outcome: "unknown",
    marks: [],
    runner: null,
    detail: `exit ${run.code}: no per-runner detection for this command, so the red is not shown to have run`,
  };
}

/** Is this classification acceptable as the red of a red→green proof? */
export function isRedForRightReason(c: {
  outcome?: OracleOutcome;
  marks?: FailureMark[];
}): boolean {
  return c.outcome === "failed" && !(c.marks ?? []).includes("snapshot");
}
