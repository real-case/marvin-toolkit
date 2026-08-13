import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Criterion } from "./spec.js";

/**
 * Oracle command resolution and the run journal (ADR-0036) — the **pure half**
 * of executing the oracle graph the Definition-of-Ready gate already validates.
 *
 * Nothing here spawns a child process. Execution lives on `verify`, where the
 * shell already lives and where ADR-0015's trust boundary is drawn; this module
 * decides *what command* a criterion means and *how a run is recorded*, so both
 * are unit-testable against tmp-dir fixtures without a server build. It imports
 * node builtins, zod and one type — the same self-containment rule
 * `lib/reports.ts` follows, for the same reason.
 *
 * The design rule for resolution is that it **never guesses**: a guessed command
 * that exits zero is indistinguishable from a proof. Every rung below is
 * something a human wrote down, and when no rung applies the answer is
 * `not-run` with a machine-readable reason rather than an inference.
 */

// ── resolution ───────────────────────────────────────────────────────────────

/** Which rung of the chain produced the command. Recorded on every run, so the
 * command-resolution success rate is a query over the journal rather than a study. */
export type OracleSource =
  "call" | "oracle.run" | "oracle.ref" | "config.test_one" | "stack-default";

/** A resolved command, or the refusal to invent one. */
export type Resolved =
  { command: string; source: OracleSource } | { command: null; source: null; reason: string };

export interface ResolveOptions {
  /** The per-call override — the caller already knows the exact command. */
  call?: string;
  /** `.marvin/config.json` `gates.test_one`, the project's single-test template. */
  testOne?: string;
  /** A stack detector id (`python`, `go`, `rust`, …) for the default table. */
  stack?: string;
  /** The project root. Present for symmetry with the runner; resolution is textual. */
  projectRoot: string;
}

/**
 * Anything that would make a substituted value more than an argument: a chain, a
 * pipe, a background, a substitution, a redirection, a newline.
 *
 * Refusal, not sanitisation. Substitution is literal and the template author owns
 * the quoting — the placeholder commonly sits inside a flag they already quoted,
 * and quoting it again produces a command that fails for a reason nobody can
 * read. So a ref that would reach the shell as syntax is `not-run` instead.
 *
 * **It screens substituted values only, and that boundary is load-bearing.** A
 * `kind: "command"` ref is not substituted into anything — it IS the command,
 * whole, the way `oracle.run` is — so screening it would refuse the very refs
 * rung 3 exists to pass through. Measured against this repository's own spec
 * corpus, screening them refused 24 of 44 `kind: command` oracles, every one a
 * deliberate `a && b` chain a human wrote out: the feature would have shipped
 * mostly inert while reporting `unsafe-ref`, which reads as an accusation of a
 * malformed ref rather than as the refusal to run what was asked. See
 * `resolveOracleCommand` for where the boundary is drawn.
 */
const SHELL_METACHARACTERS = /[;|&`\n<>]|\$\(/;

/** `path/to/file::test name` → its two halves. A ref with no `::` is all file. */
function splitRef(ref: string): { file: string; name: string } {
  const i = ref.indexOf("::");
  return i === -1
    ? { file: ref, name: "" }
    : { file: ref.slice(0, i).trim(), name: ref.slice(i + 2).trim() };
}

/** The directory part of a POSIX-ish path, as a `go test` package argument. */
function packageDir(file: string): string {
  const i = file.lastIndexOf("/");
  return i === -1 ? "." : `./${file.slice(0, i)}`;
}

/**
 * The default table — **three rows, admitted on one criterion**: the runner's
 * documented single-invocation form consumes a file path and a test name, and
 * the stack detector matches exactly one such runner.
 *
 * There is deliberately NO JavaScript or TypeScript row. This repository is the
 * measured counter-example: its own `npm test` fans out to three workspaces
 * running `node --test`, vitest and Playwright, so a synthesized
 * `node --test --test-name-pattern …` would run the wrong workspace's suite or
 * none at all — and report green from a suite that never contained the test,
 * which is strictly worse than `not-run`. A row is added with a measurement,
 * never by analogy.
 */
const STACK_DEFAULTS: Record<string, (parts: { file: string; name: string }) => string> = {
  python: ({ file, name }) => `pytest ${file}::${name}`,
  go: ({ file, name }) => `go test -run '^${name}$' ${packageDir(file)}`,
  rust: ({ name }) => `cargo test ${name}`,
};

/**
 * Resolve one criterion's oracle to a command, in ADR-0009's precedence order
 * generalised from gates to criteria:
 *
 *   1. the per-call `call` argument — the caller already knows the command;
 *   2. `oracle.run` — the criterion's own exact command;
 *   3. `oracle.ref` verbatim, for `kind: "command"` — that is already what a
 *      command ref means;
 *   4. `gates.test_one` with `{file}` / `{name}` / `{ref}` substituted, for
 *      `kind: "test"` — the project's durable declaration;
 *   5. the three-row default table, for `kind: "test"`;
 *   6. otherwise `{command: null, source: null, reason}` — `not-run`, never a guess.
 *
 * (1), (2) and (3) are commands a human wrote whole, so they pass through
 * untouched — a `kind: "command"` ref is the command, not an argument inside
 * one. From (4) on, the ref is *data* being interpolated into a template, and
 * the metacharacter screen applies: to the whole ref (`{ref}`) and to each
 * substituted half (`{file}`, `{name}`), which is the pair the criterion names.
 */
export function resolveOracleCommand(criterion: Criterion, opts: ResolveOptions): Resolved {
  const oracle = criterion.oracle;

  if (opts.call?.trim()) return { command: opts.call.trim(), source: "call" };
  if (oracle.run?.trim()) return { command: oracle.run.trim(), source: "oracle.run" };

  if (oracle.kind === "prose-review") {
    return { command: null, source: null, reason: "prose-review-oracle" };
  }

  const ref = oracle.ref?.trim();
  if (!ref) return { command: null, source: null, reason: "no-ref" };

  // Rung 3, ABOVE the screen. `kind: "command"` declares a whole command, so it
  // passes through for the same reason `oracle.run` does: there is no template
  // it is substituted into, and a chain in it is the author's chain, not syntax
  // smuggled into someone else's quoting.
  if (oracle.kind === "command") return { command: ref, source: "oracle.ref" };

  // Rung 4 on: the ref is data. Screen the whole ref (`{ref}`) and both
  // substituted halves (`{file}`, `{name}`) — one refusal, one reason.
  const parts = splitRef(ref);
  if (
    SHELL_METACHARACTERS.test(ref) ||
    SHELL_METACHARACTERS.test(parts.file) ||
    SHELL_METACHARACTERS.test(parts.name)
  ) {
    return { command: null, source: null, reason: "unsafe-ref" };
  }

  if (opts.testOne?.trim()) {
    const command = opts.testOne
      .replaceAll("{file}", parts.file)
      .replaceAll("{name}", parts.name)
      .replaceAll("{ref}", ref)
      .trim();
    return command
      ? { command, source: "config.test_one" }
      : { command: null, source: null, reason: "empty-test_one" };
  }

  const row = opts.stack ? STACK_DEFAULTS[opts.stack] : undefined;
  if (!row) return { command: null, source: null, reason: "no-single-test-command" };
  if (!parts.name) return { command: null, source: null, reason: "ref-has-no-test-name" };
  return { command: row(parts), source: "stack-default" };
}

/**
 * The project-relative test file a `kind: test` oracle names, or null. Declared
 * here rather than at the runner so the `path::name` convention has one reader:
 * the runner hashes this file's bytes into the journal, and a red and a green
 * carrying the same hash are what makes a pair a proof rather than two
 * consecutive runs of two different tests.
 */
export function oracleTestFile(criterion: Criterion): string | null {
  if (criterion.oracle.kind !== "test") return null;
  const ref = criterion.oracle.ref?.trim();
  if (!ref) return null;
  return splitRef(ref).file || null;
}

// ── the journal: one append-only file per spec ───────────────────────────────

/**
 * The house typed-block shape, matching `audit-report` and `verify-result`: one
 * fenced ` ```json oracle-run ` block per run. The file grows by APPEND and is
 * never rewritten whole — the property `verification.md` lacks, and the reason a
 * red phase recorded an hour ago survives the green phase that follows it.
 */
export const ORACLE_RUN_TAG = "oracle-run";
const ORACLE_RUN_RE = new RegExp("```json " + ORACLE_RUN_TAG + "\\n([\\s\\S]*?)\\n```", "g");

const OracleRunSchema = z.object({
  /** The spec's validated kebab-case slug — also this journal's filename. */
  slug: z.string().min(1),
  /** The seal this run was recorded against. Proofs never cross it. */
  contract_sha: z.string().min(1),
  criterion: z.string().min(1),
  /** Which phase this was: the red run expects `fail`, the green one `pass`. */
  expect: z.enum(["pass", "fail"]),
  /** What happened. `not-run` covers an unresolved command, a signal kill and a
   * launch failure alike — none of them is evidence about the code. */
  status: z.enum(["pass", "fail", "not-run"]),
  command: z.string().nullable(),
  source: z.string().nullable(),
  reason: z.string().nullable().optional(),
  code: z.number().nullable(),
  signal: z.string().nullable(),
  /** The referenced test file and the hash of its bytes at run time — what makes
   * a red and a green comparable rather than merely consecutive. */
  test_file: z.string().nullable(),
  test_sha: z.string().nullable(),
  head_sha: z.string().nullable(),
  durationMs: z.number().optional(),
  ran_at: z.string(),
});
export type OracleRun = z.infer<typeof OracleRunSchema>;

/** `<runsDir>/<slug>.oracles.md` — beside the per-spec verification run, and
 * NEVER at the top level of the spec directory, where four enumerators across
 * three modules would classify it as a spec (ADR-0036). */
export function oracleJournalPath(runsDir: string, slug: string): string {
  return join(runsDir, `${slug}.oracles.md`);
}

/** Append one run to its spec's journal, creating the directory and the file's
 * one-time header as needed. Never reads the file back to write it. */
export function recordOracleRun(runsDir: string, entry: OracleRun): void {
  mkdirSync(runsDir, { recursive: true });
  const path = oracleJournalPath(runsDir, entry.slug);
  const header = existsSync(path)
    ? ""
    : `# Oracle runs — ${entry.slug}\n\nAppend-only. One \`${ORACLE_RUN_TAG}\` block per run.\n\n`;
  const block = `\`\`\`json ${ORACLE_RUN_TAG}\n${JSON.stringify(entry)}\n\`\`\`\n\n`;
  appendFileSync(path, `${header}${block}`, "utf8");
}

/**
 * Every readable run for a spec, oldest first. A block that does not parse is
 * DROPPED — the file is not: one corrupt append must not discard the proofs
 * recorded around it, and there is nothing to gain by refusing to read the rest.
 */
export function readOracleRuns(runsDir: string, slug: string): OracleRun[] {
  const path = oracleJournalPath(runsDir, slug);
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: OracleRun[] = [];
  for (const m of raw.matchAll(ORACLE_RUN_RE)) {
    let json: unknown;
    try {
      json = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    const parsed = OracleRunSchema.safeParse(json);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** A red phase: the test was expected to fail, and it failed cleanly, with the
 * file it names present and hashed. A signal kill or a launch failure is not one. */
function isRed(r: OracleRun): boolean {
  return (
    r.expect === "fail" && r.status === "fail" && r.code !== null && r.code !== 0 && !!r.test_sha
  );
}

/** A green phase: the same test, expected to pass, exiting 0. */
function isGreen(r: OracleRun): boolean {
  return r.expect === "pass" && r.status === "pass" && r.code === 0 && !!r.test_sha;
}

/**
 * Is this criterion's red→green pair on the record, under the contract in force?
 *
 * `proven` for exactly one shape: a red entry followed by a green entry for the
 * same criterion, both at `contractSha`, both carrying an identical `test_sha`.
 * Every other shape — a green with no red, a red with no green, a pair whose
 * test file changed in between, an empty journal — is `missing`.
 *
 * **The `contract_sha` filter runs first, in code, and that is the point.** Keyed
 * by criterion id alone, a spec amended and re-sealed would report a proof for a
 * contract that no longer exists: a silent failure that reads as a pass, which is
 * the one defect class this whole feature exists to remove.
 */
export function redGreenProof(
  runs: OracleRun[],
  contractSha: string,
  criterionId: string,
): "proven" | "missing" {
  if (!contractSha) return "missing";
  const relevant = runs.filter(
    (r) => r.contract_sha === contractSha && r.criterion === criterionId,
  );
  for (let i = 0; i < relevant.length; i++) {
    const red = relevant[i]!;
    if (!isRed(red)) continue;
    for (let j = i + 1; j < relevant.length; j++) {
      const green = relevant[j]!;
      if (isGreen(green) && green.test_sha === red.test_sha) return "proven";
    }
  }
  return "missing";
}
