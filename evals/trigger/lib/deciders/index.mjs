// Decider factory. A decider answers the one question triggering reduces to:
// given the metadata catalog and a user message, which skill loads first?

/**
 * @typedef {Object} Decision
 * @property {string|null} skill   the skill that would load first, or null
 * @property {string} [reason]
 *
 * @typedef {(ctx: {
 *   catalog: import("../catalog.mjs").Skill[],
 *   catalogText: string,
 *   query: import("../schema.mjs").QueryRecord,
 *   target: string,
 *   runIndex: number,
 *   runs: number,
 * }) => Promise<Decision>} Decider
 */

import { createMockDecider } from "./mock.mjs";
import { createApiDecider } from "./api.mjs";
import { createClaudeCliDecider } from "./claude-cli.mjs";
import { createFileDecider } from "./file.mjs";

export const DECIDERS = ["mock", "api", "claude-cli", "file"];

/** @returns {Decider} */
export function makeDecider(kind, opts = {}) {
  switch (kind) {
    case "mock":
      return createMockDecider(opts);
    case "api":
      return createApiDecider(opts);
    case "claude-cli":
      return createClaudeCliDecider(opts);
    case "file":
      return createFileDecider(opts);
    default:
      throw new Error(`unknown decider "${kind}" (use one of: ${DECIDERS.join(", ")})`);
  }
}
