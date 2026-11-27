import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadEnv } from "../lib/env.js";
import { collectProvenance } from "../lib/provenance.js";
import { formatVerifyBlock, type VerifyGate } from "../lib/reports.js";
import { readTaskMetrics } from "../storage/metrics.js";
import type { Config } from "../storage/schema.js";
import { deliverGate, NOT_RUN_WARNING_PREFIX } from "../tools/verify.js";
import type { GateReport } from "./gate.js";

/**
 * The delivery gate, run by the engine (ADR-0059).
 *
 * Before this module the autopilot reached its delivery gate only through the executor's prose
 * (`task-implement` and `task-deliver` in pipeline mode), and the executor called it in a third
 * of the successful runs measured: the ADR-0055 red→green rule and the terminal `task-metrics`
 * block, both of which live in that gate, missed the rest. The engine now calls the same
 * function the `verify` tool's `action: "gate"` calls, once CI is green, with the autopilot's
 * rule switched on explicitly rather than read from its own environment.
 *
 * The verdict the gate judges is the engine's own. Its gate stage ran every configured gate and
 * every oracle on the gated commit (D20), so the engine writes that report as the spec's
 * per-spec run, `.marvin/task/runs/<slug>.md`, with provenance collected just before the gate
 * reads it. The executor's last self-check, recorded before its final commit, would be stale by
 * construction, and its verdict is not the one that let the run through.
 */

export interface DeliveryInput {
  /** The run's worktree, which is the project root every reader resolves against. */
  worktree: string;
  /** The spec's slug, as the engine names the run branch from it. */
  slug: string;
  config: Config;
  /** The gate stage's report for the gated commit (`run.gateReport`). */
  report: GateReport;
  /** The commit the gate approved and CI judged: the delivered commit. */
  head: string;
  /** When the executor whose commit was gated started, or null when none is on record. */
  executorSince: string | null;
}

export interface DeliveryResult {
  decision: "ALLOW" | "BLOCK";
  reason: string;
  /** The gate's `**Metrics:**` line, null when no block was appended. */
  metricsNote: string | null;
  /** The record already held a terminal block for this commit, so none was appended. */
  alreadyRolledUp: boolean;
  /** The per-spec run the engine wrote, relative to the worktree. */
  artifact: string;
}

/** The per-spec run's path, pinned under `.marvin/` whatever `spec.dir` says (ADR-0007/0035). */
export function deliveryArtifactPath(worktree: string, slug: string): string {
  return join(worktree, ".marvin", "task", "runs", `${slug}.md`);
}

/**
 * The engine's gate report as a `verify-result` run. A gate the stage passed on a retry
 * (`flaky`) or on the base check (`inherited`, ADR-0058) passed the stage and is a warning here,
 * as it is a finding there; `not-run` keeps verify's own warning text, which the gate's
 * no-evidence refusal quotes back.
 */
export function verificationFromGate(
  report: GateReport,
  provenance: ReturnType<typeof collectProvenance>,
  artifactPath: string,
): string {
  const warnings: string[] = [];
  const gates: VerifyGate[] = report.gates.map((g) => {
    if (g.result === "not-run") warnings.push(`${NOT_RUN_WARNING_PREFIX} ${g.name} (engine gate)`);
    if (g.result === "flaky") warnings.push(`gate ${g.name} passed only on a retry (engine gate)`);
    if (g.result === "inherited") {
      warnings.push(`gate ${g.name} fails on the base commit as well (engine gate, ADR-0058)`);
    }
    const status = g.result === "flaky" ? "pass" : g.result;
    return { name: g.name, status, code: null, durationMs: g.ms };
  });
  const failed = !report.passed || gates.some((g) => g.status === "fail");
  const verdict = failed ? "FAIL" : warnings.length > 0 ? "PASS WITH WARNINGS" : "PASS";
  const sumOfGatesMs = report.gates.reduce((n, g) => n + g.ms, 0);
  const rows = report.gates.map((g) => `| ${g.name} | ${g.result} | ${g.ms} |`);
  const markdown = [
    "# Verification",
    "",
    `**Verdict:** ${verdict}`,
    "",
    "Written by the autopilot engine from its own gate stage on the gated commit (ADR-0059).",
    "",
    "| Gate | Result | ms |",
    "|------|--------|----|",
    ...rows,
    ...(warnings.length > 0 ? ["", "## Warnings", "", ...warnings.map((w) => `- ${w}`)] : []),
  ].join("\n");
  const block = formatVerifyBlock({
    verdict,
    gates,
    detectedStacks: [],
    warnings,
    wallClockMs: sumOfGatesMs,
    sumOfGatesMs,
    artifactPath,
    ...(provenance ? { provenance } : {}),
  });
  return `${markdown}\n\n${block}`;
}

/**
 * Whether the record already holds the terminal block for this delivery, so the engine appends
 * none: a second block for one delivery would make the roll-up count stop meaning tasks
 * delivered. Two shapes count. The last block names `head`, which is a replayed step or an
 * executor that called the gate after its last commit. Or it was derived after `since`, the
 * start of the executor whose commit was gated: `task-deliver` calls the gate before it commits,
 * so that executor's block names the commit before its own, and it is still this delivery's. A
 * block an earlier executor wrote is older than `since`, and the engine appends a fresh one.
 */
export function rolledUpFor(
  worktree: string,
  slug: string,
  head: string,
  since: string | null,
): boolean {
  const last = readTaskMetrics(join(worktree, ".marvin", "metrics"), slug);
  if (last === null) return false;
  if (last.head_sha === head) return true;
  const after = since === null ? Number.NaN : Date.parse(since);
  return !Number.isNaN(after) && Date.parse(last.rolled_up_at) >= after;
}

/**
 * Write the engine's run, then decide. The `ServerEnv` is the worktree's own, built from no
 * variable of the engine's process, so a `MARVIN_*_DIR` override the engine happens to carry
 * cannot point the gate's reads or the record's write at another tree.
 */
export function runDeliveryGate(input: DeliveryInput): DeliveryResult {
  const { worktree, slug, config, report, head, executorSince } = input;
  const path = deliveryArtifactPath(worktree, slug);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, verificationFromGate(report, collectProvenance(worktree), path), "utf8");
  const alreadyRolledUp = rolledUpFor(worktree, slug, head, executorSince);
  const outcome = deliverGate(worktree, {
    specSlug: slug,
    allowStale: false,
    specConfig: config.spec,
    env: loadEnv({ CLAUDE_PROJECT_DIR: worktree }),
    config,
    redGreenRequired: true,
    rollUp: !alreadyRolledUp,
  });
  return {
    decision: outcome.decision,
    reason: outcome.reason,
    metricsNote: outcome.metricsNote,
    alreadyRolledUp,
    artifact: `.marvin/task/runs/${slug}.md`,
  };
}
