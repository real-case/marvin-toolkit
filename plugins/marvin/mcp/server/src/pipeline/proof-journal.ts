import { join } from "node:path";
import { classifyOracleRun } from "../lib/oracle-classify.js";
import { recordOracleRun, type OracleRun } from "../storage/oracles.js";
import type { GateReport, OracleInput, SealedFile } from "./gate.js";
import type { SealRed } from "./seal.js";

/**
 * The engine's own red→green proof, written to the oracle journal (ADR-0059).
 *
 * The seal stage runs every authored test before the implementation, and the gate stage runs
 * every oracle on the gated commit with the sealed files' hashes checked around it. Both are
 * the two halves of the proof ADR-0055 asks for, and the delivery gate reads that proof from one
 * place only, `.marvin/task/runs/<slug>.oracles.md`. These functions append the engine's runs
 * there in the journal's own `oracle-run` shape, keyed by the spec's `contract_sha`, so the
 * gate's `red_green` reader pairs them without knowing the engine wrote them.
 *
 * A red is journalled with the class `classifyOracleRun` gives it (ADR-0056), and only a
 * `failed` class is a red to the reader: a run that did not run, crashed, or exited non-zero
 * from a runner marvin cannot read is recorded as what it was, and proves nothing. `test_sha`
 * is the sealed hash in `verify`'s 16-character form, so an engine red also pairs with a green
 * the executor records through `verify action: "oracles"`, and the other way round.
 */

export interface ProofSpec {
  worktree: string;
  slug: string;
  contractSha: string;
}

const runsDir = (worktree: string) => join(worktree, ".marvin", "task", "runs");
const shortSha = (sha256: string) => sha256.slice(0, 16);

/** The seal's red runs, one entry per criterion each sealed file proves. */
export function journalSealReds(
  spec: ProofSpec,
  reds: readonly SealRed[],
  headSha: string | null,
  now: Date = new Date(),
): OracleRun[] {
  const entries: OracleRun[] = [];
  for (const red of reds) {
    const ran = Number.isInteger(red.code) && red.code >= 0;
    const c = classifyOracleRun({ code: ran ? red.code : null, signal: null, output: red.output });
    for (const criterion of red.criteria) {
      entries.push({
        slug: spec.slug,
        contract_sha: spec.contractSha,
        criterion,
        expect: "fail",
        status: !ran ? "not-run" : red.code === 0 ? "pass" : "fail",
        command: red.command,
        source: "engine seal",
        reason: ran ? null : `exit ${String(red.code)}`,
        code: ran ? red.code : null,
        signal: null,
        test_file: red.path,
        test_sha: shortSha(red.sha256),
        head_sha: headSha,
        durationMs: red.ms,
        outcome: c.outcome,
        marks: c.marks,
        runner: c.runner,
        outcome_detail: c.detail,
        ran_at: now.toISOString(),
      });
    }
  }
  for (const e of entries) recordOracleRun(runsDir(spec.worktree), e);
  return entries;
}

/**
 * The gate stage's greens for `head`, the commit it approved: a sealed file's criterion whose
 * `oracle:<id>` gate passed, and whose sealed hash held before and after the oracles ran. Called
 * only for a gate stage that passed, so a green is never journalled for a commit the stage
 * rejected.
 */
export function journalGateGreens(
  spec: ProofSpec,
  report: GateReport,
  sealed: readonly SealedFile[],
  oracles: readonly OracleInput[],
  head: string,
  now: Date = new Date(),
): OracleRun[] {
  if (!report.passed) return [];
  const intact = new Set(report.sealed.filter((s) => s.ok).map((s) => s.path));
  const moved = new Set(report.blockers.flatMap((b) => (b.file ? [b.file] : [])));
  const entries: OracleRun[] = [];
  for (const file of sealed) {
    if (!intact.has(file.path) || moved.has(file.path)) continue;
    for (const criterion of file.criteria) {
      const gate = report.gates.find((g) => g.name === `oracle:${criterion}`);
      if (gate?.result !== "pass") continue;
      entries.push({
        slug: spec.slug,
        contract_sha: spec.contractSha,
        criterion,
        expect: "pass",
        status: "pass",
        command: oracles.find((o) => o.criterion === criterion)?.command ?? null,
        source: "engine gate",
        reason: null,
        code: 0,
        signal: null,
        test_file: file.path,
        test_sha: shortSha(file.sha256),
        head_sha: head,
        durationMs: gate.ms,
        outcome: "passed",
        marks: [],
        runner: null,
        outcome_detail: "the engine's gate stage ran this oracle on the gated commit",
        ran_at: now.toISOString(),
      });
    }
  }
  for (const e of entries) recordOracleRun(runsDir(spec.worktree), e);
  return entries;
}
