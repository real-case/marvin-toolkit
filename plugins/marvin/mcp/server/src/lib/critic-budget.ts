import type { SpecContract } from "../storage/spec.js";

/**
 * The critic dispatch budgets, stated once for the two places that judge them:
 * the `metrics` tool's answer to a `critic-dispatch` event, which tells the
 * session the budget is spent, and the roll-up's `critic_budget_exceeded`,
 * which counts the tasks where a session dispatched past it anyway.
 *
 * The limits are the ones the pipeline prose sets, counted in dispatch passes:
 *
 * - `marvin-tm-spec-critic` — two per spec (`task-start` Step 8F/8B), one on
 *   the light tier: a feature with `risk: low`, or a bugfix with
 *   `severity: low`, whose contract names at most five files.
 * - `marvin-tm-diff-critic` — the first dispatch plus one re-dispatch in each
 *   of the critic loop's first two fix-cycle rounds (`task-implement` Step 6F,
 *   `marvin-tm-executor` §3–§4); round 3 re-reads the spec instead.
 *
 * A `NEEDS_CONTEXT` re-dispatch reuses its pass number, so it never spends the
 * budget, which is the one-shot allowance the prose gives it.
 */
export const SPEC_CRITIC_BUDGET = 2;
export const SPEC_CRITIC_LIGHT_BUDGET = 1;
export const DIFF_CRITIC_BUDGET = 3;
/** The light tier's file ceiling. */
export const LIGHT_TIER_MAX_FILES = 5;

export type CriticTier = "standard" | "light";

export interface CriticBudget {
  /** The highest pass number the budget allows. */
  limit: number;
  /**
   * The spec critic's tier, or null when there is none to judge: the diff
   * critic has no tiers, and a spec that could not be read cannot establish the
   * light tier, so the standard allowance applies.
   */
  tier: CriticTier | null;
}

export type BudgetStatus = "within" | "final" | "exceeded";

/** The spec as far as the budget needs it. */
export interface BudgetSpec {
  frontmatter: Record<string, string>;
  contract: SpecContract | null;
}

/** Is this spec on the light tier? Null when the spec or its contract is unusable. */
export function isLightTier(spec: BudgetSpec | null): boolean | null {
  if (!spec || !spec.contract) return null;
  const fm = spec.frontmatter;
  const type = fm.type?.trim();
  const low = type === "bugfix" ? fm.severity?.trim() === "low" : fm.risk?.trim() === "low";
  return low && spec.contract.files.length <= LIGHT_TIER_MAX_FILES;
}

export function criticBudget(critic: string, spec: BudgetSpec | null): CriticBudget {
  if (critic !== "marvin-tm-spec-critic") return { limit: DIFF_CRITIC_BUDGET, tier: null };
  const light = isLightTier(spec);
  if (light === null) return { limit: SPEC_CRITIC_BUDGET, tier: null };
  return light
    ? { limit: SPEC_CRITIC_LIGHT_BUDGET, tier: "light" }
    : { limit: SPEC_CRITIC_BUDGET, tier: "standard" };
}

/** `final` is the last pass the budget allows; past it is `exceeded`. */
export function budgetStatus(pass: number, limit: number): BudgetStatus {
  if (pass > limit) return "exceeded";
  return pass === limit ? "final" : "within";
}
