import { parse as parseYaml } from "yaml";
import { parseFrontmatter } from "../storage/frontmatter.js";
import { resolveOracleCommand } from "../storage/oracles.js";
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

export interface OracleCommand {
  criterion: string;
  command: string;
}

export interface OracleCommandOptions {
  /** `.marvin/config.json` `gates.test_one`, the project's single-test template. */
  testOne?: string;
  /** A stack detector id (`python`, `go`, `rust`) for the resolver's default table. */
  stack?: string;
  /** Passed through to the resolver, which does not read it today. */
  projectRoot?: string;
}

/**
 * The command each runnable criterion of a spec resolves to, in criterion order.
 *
 * A prose-review criterion has no command by construction and is skipped, as `verify` skips
 * it; a criterion whose command cannot be resolved is omitted rather than guessed, as
 * `verify` journals it `not-run`. A spec with no readable contract block throws, so an
 * unreadable spec is never mistaken for one that has no oracles.
 */
export function oracleCommands(specText: string, opts: OracleCommandOptions = {}): OracleCommand[] {
  const block = extractContractBlock(parseFrontmatter(specText).body);
  if (block === null) throw new Error("the spec has no ```yaml spec-contract block");
  const parsed = parseContractCriteria(block);
  if ("error" in parsed) throw new Error(parsed.error);
  const out: OracleCommand[] = [];
  for (const criterion of parsed.criteria) {
    if (criterion.oracle.kind === "prose-review") continue;
    const resolved = resolveOracleCommand(criterion, {
      testOne: opts.testOne,
      stack: opts.stack,
      projectRoot: opts.projectRoot ?? "",
    });
    if (resolved.command !== null) out.push({ criterion: criterion.id, command: resolved.command });
  }
  return out;
}
