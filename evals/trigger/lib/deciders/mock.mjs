// Mock decider — no model, no network. Deterministic from each query's
// `mock_rate`: over N runs it selects the target on exactly round(rate*N) runs.
// This exists to prove the runner + scoring math end-to-end in CI. It never
// measures a real description; only `api` and `claude-cli` do that.

/** @returns {import("./index.mjs").Decider} */
export function createMockDecider() {
  return async ({ target, query, runIndex, runs }) => {
    const rate =
      typeof query.mock_rate === "number" ? query.mock_rate : query.should_trigger ? 1 : 0;
    const hits = Math.round(rate * runs);
    // Deterministic placement: the first `hits` runs select the target.
    return { skill: runIndex < hits ? target : null, reason: `mock rate=${rate}` };
  };
}
