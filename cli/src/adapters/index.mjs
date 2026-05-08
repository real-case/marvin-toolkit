// Target adapter registry. CLI commands consult this to map `--target=<name>`
// onto a concrete adapter implementation. Never bypass — direct imports of
// claude.mjs from cli/src/commands/ are blocked by a CI lint step.
//
// Adding a target: implement an adapter matching the contract in
// ./types.mjs, register it below, and (if it's not for `marvin-core-pack`
// only) extend the per-target docs.

import claudeAdapter from "./claude.mjs";

const REGISTRY = new Map();
REGISTRY.set("claude", claudeAdapter);

/**
 * Returns the adapter for a given target name.
 * Throws with a clear error if the target is unknown.
 *
 * @param {string} name
 * @returns {import("./types.mjs").TargetAdapter}
 */
export function getAdapter(name) {
  const a = REGISTRY.get(name);
  if (!a) {
    const available = [...REGISTRY.keys()].join(", ");
    const err = new Error(`unknown target "${name}". Available: ${available}`);
    err.code = "EUNKNOWNTARGET";
    throw err;
  }
  return a;
}

/** @returns {string[]} */
export function listTargets() { return [...REGISTRY.keys()]; }

export const DEFAULT_TARGET = "claude";
