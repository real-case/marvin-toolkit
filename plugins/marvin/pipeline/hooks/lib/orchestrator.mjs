/**
 * The name a pipeline child reports to.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A session that took the run over with `marvin-pipe attach` named itself in orchestrator.txt;
 * a child launched before it still reports to the new name.
 *
 * @param {string} run The run directory (`MARVIN_PIPELINE_RUN`).
 * @param {string | undefined} launchedWith The name the child was launched with (`MARVIN_PIPELINE_ORCH`).
 * @returns {string | undefined}
 */
export function orchestratorOf(run, launchedWith) {
  try {
    return readFileSync(join(run, "orchestrator.txt"), "utf8").trim() || launchedWith;
  } catch {
    return launchedWith;
  }
}
