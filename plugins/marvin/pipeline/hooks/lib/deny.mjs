/**
 * The pipeline guards' deny contract.
 *
 * hook-io's `deny()` ends every payload with the hooks kill switch, which is right for
 * the repository's commit guards and wrong here twice over: the switch does not disarm
 * a pipeline guard, and telling a child how to disable the repository's own guards is
 * an invitation an injected instruction can act on. A pipeline denial therefore names
 * the rule and nothing else.
 *
 * Pipeline children are an adversarial setting, so these guards also FAIL CLOSED: where
 * hook-io's `main` turns an unexpected exception into an allow (correct for a guard on
 * every developer's `Bash` call), `pipelineMain` turns it into a denial.
 */

import { writeSync } from "node:fs";
import { DENY, main } from "../../../hooks/lib/hook-io.mjs";

/**
 * Write the denial to stderr and return the deny code. The first line is
 * `marvin:pipeline:<hookName>: BLOCKED - <reason>`; the rest are detail.
 *
 * @param {string} hookName
 * @param {string[]} lines First entry is the reason.
 * @returns {2}
 */
export function denyPipeline(hookName, lines) {
  const [reason = "denied", ...detail] = Array.isArray(lines) ? lines : [String(lines)];
  try {
    writeSync(2, `${[`marvin:pipeline:${hookName}: BLOCKED - ${reason}`, ...detail].join("\n")}\n`);
  } catch {
    // The host still reports exit 2 when the reason cannot be written.
  }
  return DENY;
}

/**
 * hook-io's `main`, with any exception thrown by `run` converted into a denial.
 *
 * @param {string} hookName
 * @param {() => number} run
 * @returns {never}
 */
export function pipelineMain(hookName, run) {
  main(hookName, () => {
    try {
      return run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return denyPipeline(hookName, [`the guard could not evaluate this call (${message}).`]);
    }
  });
}
