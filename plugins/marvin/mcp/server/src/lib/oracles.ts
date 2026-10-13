import { parse as parseYaml } from "yaml";
import { parseFrontmatter } from "../storage/frontmatter.js";
import { resolveOracleCommand, type ResolveOptions, type Resolved } from "../storage/oracles.js";
import { SpecContract, extractContractBlock, type Criterion } from "../storage/spec.js";

/**
 * The criterion-oracle parser `verify`'s `action: "oracles"` and the autopilot gate stage
 * share, so both read a spec-contract block the same way and resolve a criterion's command
 * through the same ADR-0009-shaped chain (`resolveOracleCommand`).
 *
 * Nothing here touches the filesystem or the project's config. What the resolver needs from
 * them arrives as parameters: `gates.test_one` as `testOne`, the detected stack as `stack`.
 */

/** The parsed criteria of a spec-contract block, or the one-line reason it cannot be read. */
export type ContractCriteria = { criteria: Criterion[] } | { error: string };

/** Parse the YAML text of a ```yaml spec-contract block into its criteria. */
export function parseContractCriteria(blockText: string): ContractCriteria {
  let parsed;
  try {
    parsed = SpecContract.safeParse(parseYaml(blockText));
  } catch (err) {
    return {
      error: `spec-contract block is not valid YAML: ${err instanceof Error ? err.message : err}`,
    };
  }
  if (!parsed.success) {
    return { error: `spec-contract block is invalid: ${parsed.error.issues[0]?.message ?? "?"}` };
  }
  return { criteria: parsed.data.criteria };
}

/** One criterion with the command (or the refusal) the shared resolver gave it. */
export interface ResolvedCriterion {
  criterion: Criterion;
  resolved: Resolved;
}

/**
 * Resolve every runnable criterion through `resolveOracleCommand`, in criterion order.
 * The one per-criterion loop `verify`'s `action: "oracles"` and the gate stage share: a
 * prose-review criterion has no command by construction and is skipped, and one whose
 * command cannot be resolved stays in the list with its refusal, never guessed.
 */
export function resolveCriteria(
  criteria: readonly Criterion[],
  opts: ResolveOptions,
): ResolvedCriterion[] {
  return criteria
    .filter((criterion) => criterion.oracle.kind !== "prose-review")
    .map((criterion) => ({ criterion, resolved: resolveOracleCommand(criterion, opts) }));
}

export interface OracleResolution {
  criterion: string;
  command: string | null;
  /** Why `command` is null; null when it resolved. */
  reason: string | null;
}

export interface OracleResolutionOptions {
  /** `.marvin/config.json` `gates.test_one`, the project's single-test template. */
  testOne?: string;
  /** A stack detector id (`python`, `go`, `rust`) for the resolver's default table. */
  stack?: string;
  /** Passed through to the resolver, which does not read it today. */
  projectRoot?: string;
}

/**
 * What each runnable criterion of a spec resolves to, in criterion order, with the refusal
 * reason for those that resolve to nothing. A spec with no readable contract block throws,
 * so an unreadable spec is never mistaken for one that has no oracles.
 */
export function resolveOracles(
  specText: string,
  opts: OracleResolutionOptions = {},
): OracleResolution[] {
  const block = extractContractBlock(parseFrontmatter(specText).body);
  if (block === null) throw new Error("the spec has no ```yaml spec-contract block");
  const parsed = parseContractCriteria(block);
  if ("error" in parsed) throw new Error(parsed.error);
  return resolveCriteria(parsed.criteria, {
    testOne: opts.testOne,
    stack: opts.stack,
    projectRoot: opts.projectRoot ?? "",
  }).map(({ criterion, resolved }) => ({
    criterion: criterion.id,
    command: resolved.command,
    reason: resolved.command === null ? resolved.reason : null,
  }));
}
