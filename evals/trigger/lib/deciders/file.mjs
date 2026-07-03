// File decider — replays decisions recorded out-of-band (e.g. by an orchestration
// run that used fresh subagents as the discovery model). Makes an
// externally-produced measurement a first-class harness input: the harness still
// owns scoring, this just feeds it the recorded choice per (skill, query, run).
//
// Decisions file: a flat JSON map keyed "<skill>::<queryId>::<runIndex>" → chosen
// skill name (or null). Missing keys score as "no skill loaded".

import { readFileSync } from "node:fs";

/**
 * @param {Object} [opts]
 * @param {string} [opts.decisions]  path to the decisions JSON
 * @returns {import("./index.mjs").Decider}
 */
export function createFileDecider(opts = {}) {
  const path = opts.decisions || process.env.MARVIN_EVAL_DECISIONS;
  if (!path) {
    throw new Error("file decider needs --decisions <path> (or MARVIN_EVAL_DECISIONS)");
  }
  const map = JSON.parse(readFileSync(path, "utf8"));
  return async ({ target, query, runIndex }) => {
    const key = `${target}::${query.id}::${runIndex}`;
    const hit = Object.prototype.hasOwnProperty.call(map, key);
    return { skill: hit ? (map[key] ?? null) : null, reason: hit ? "recorded" : "missing" };
  };
}
