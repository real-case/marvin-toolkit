import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Critique } from "@marvin-toolkit/mcp-shared/contracts";
import { projectScopedDir, type ServerEnv } from "./env.js";
import { changedFilesForScope, headSha, inGitRepo, refExists } from "./git.js";
import { parseCritiqueBlock, parseVerifyBlock } from "./reports.js";
import type { RollupGit, RollupInputs, RollupSpec } from "./metrics-rollup.js";
import { parseFrontmatter } from "../storage/frontmatter.js";
import { readMetricEvents } from "../storage/metrics.js";
import { oracleJournalPath, readOracleRuns } from "../storage/oracles.js";
import { progressJournalPath, readProgress } from "../storage/progress.js";
import type { SpecConfig } from "../storage/schema.js";
import {
  SpecContract,
  contractHash,
  extractContractBlock,
  resolveSpecBySlug,
  resolveSpecDir,
  specSearchDirs,
} from "../storage/spec.js";
import { readVerifyRuns, verifyJournalPath } from "../storage/verify-runs.js";

/**
 * The IO half of the metrics roll-up (ADR-0043 §2): read every input from where
 * it lives and hand the lot to the pure `rollUpMetrics`.
 *
 * The inputs come from three places, and one of them is not where the other two
 * are. The progress journal follows the SPEC directory — `<dirname(spec)>/runs/`,
 * the rule `tools/spec.ts` writes it by — while the oracle journal, the
 * verification-run journal and the per-spec run stay pinned under
 * `.marvin/task/runs/` whatever `spec.dir` says (ADR-0007, ADR-0035). Receipts
 * and the metrics record resolve against the call's own project root through
 * `projectScopedDir`, the rule `summary` applies to receipts and
 * `projectConfigPath` applies to the config.
 *
 * Presence is decided HERE, by whether the file exists, not by whether it
 * parsed to anything: a journal that exists with zero readable entries is a
 * present source with nothing in it, and a journal that does not exist is an
 * absent one. The roll-up's `sources` map reports the second, never the first.
 */

/** The spec file for a slug, searched host-adaptively (ADR-0005/0037); null when none. */
export function findSpecBySlug(
  slug: string,
  projectRoot: string,
  specConfig?: SpecConfig,
): string | null {
  for (const dir of specSearchDirs(projectRoot, specConfig)) {
    const p = resolveSpecBySlug(dir, slug, projectRoot);
    if (p) return p;
  }
  return null;
}

/** Project-relative POSIX path when inside the root, the absolute path otherwise. */
export function relFromRoot(abs: string, projectRoot: string): string {
  const rel = relative(projectRoot, abs);
  return rel && !rel.startsWith("..") ? rel.split(sep).join(posix.sep) : abs;
}

/**
 * The newest receipt per critic whose `subject` is the slug (ADR-0039) — the
 * selection `summary` makes, ordered here by the block's own `judged_at` rather
 * than the file's mtime, because a committed receipt's mtime is its checkout
 * time and says nothing about when it was judged. Null when the directory holds
 * no receipt for the slug at all.
 */
export function latestReceipts(
  dir: string,
  slug: string,
): { spec: Critique | null; diff: Critique | null } | null {
  if (!existsSync(dir)) return null;
  let filenames: string[];
  try {
    filenames = readdirSync(dir).sort();
  } catch {
    return null;
  }
  const newest = new Map<string, { critique: Critique; filename: string }>();
  for (const filename of filenames) {
    if (!filename.endsWith(".md")) continue;
    let raw: string;
    try {
      raw = readFileSync(join(dir, filename), "utf8");
    } catch {
      continue;
    }
    const parse = parseCritiqueBlock(raw);
    if (parse.kind !== "ok" || parse.critique.subject !== slug) continue;
    const current = newest.get(parse.critique.critic);
    const later =
      !current ||
      parse.critique.judged_at > current.critique.judged_at ||
      (parse.critique.judged_at === current.critique.judged_at && filename > current.filename);
    if (later) newest.set(parse.critique.critic, { critique: parse.critique, filename });
  }
  if (newest.size === 0) return null;
  return {
    spec: newest.get("marvin-tm-spec-critic")?.critique ?? null,
    diff: newest.get("marvin-tm-diff-critic")?.critique ?? null,
  };
}

function readRollupSpec(specPath: string, projectRoot: string, notes: string[]): RollupSpec {
  const raw = readFileSync(specPath, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const block = extractContractBlock(body);
  let contract: SpecContract | null = null;
  if (block !== null) {
    try {
      const parsed = SpecContract.safeParse(parseYaml(block));
      if (parsed.success) contract = parsed.data;
      else
        notes.push(
          "the spec-contract block failed schema validation — contract-sourced rows are null",
        );
    } catch {
      notes.push("the spec-contract block is not valid YAML — contract-sourced rows are null");
    }
  } else {
    notes.push("the spec carries no spec-contract block — contract-sourced rows are null");
  }
  return {
    path: relFromRoot(specPath, projectRoot),
    frontmatter,
    contract,
    stamped_sha: frontmatter.contract_sha?.trim() || null,
    actual_sha: block !== null ? contractHash(block) : null,
  };
}

/** The `verify-result` block of this spec's own run, or null with a note when the file is unusable. */
function readRunResult(path: string, slug: string, notes: string[]) {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const parse = parseVerifyBlock(raw);
  if (parse.kind === "ok") return parse.result;
  notes.push(
    parse.kind === "none"
      ? `runs/${slug}.md carries no verify-result block — treated as absent`
      : `runs/${slug}.md: ${parse.reason} — treated as absent`,
  );
  return null;
}

function collectGit(projectRoot: string, base: string, notes: string[]): RollupGit | null {
  if (!inGitRepo(projectRoot)) return null;
  const head_sha = headSha(projectRoot);
  if (!refExists(base, projectRoot)) {
    notes.push(
      `base ref \`${base}\` does not resolve in this repository — scope drift (Q1) not computed`,
    );
    return { head_sha, changed_files: null };
  }
  return { head_sha, changed_files: changedFilesForScope(projectRoot, base) };
}

/** Read every roll-up input for a slug from where it lives. */
export function collectRollupInputs(
  env: ServerEnv,
  projectRoot: string,
  specConfig: SpecConfig | undefined,
  slug: string,
  base: string,
  now: string,
): RollupInputs {
  const notes: string[] = [];

  const specPath = findSpecBySlug(slug, projectRoot, specConfig);
  const spec = specPath ? readRollupSpec(specPath, projectRoot, notes) : null;

  // The progress journal follows the spec; the other three are `.marvin/`-pinned.
  const progressRuns = specPath
    ? join(dirname(specPath), "runs")
    : join(resolveSpecDir(projectRoot, specConfig).abs, "runs");
  const progress = existsSync(progressJournalPath(progressRuns, slug))
    ? readProgress(progressRuns, slug)
    : null;

  const pinned = join(projectRoot, ".marvin", "task", "runs");
  const oracles = existsSync(oracleJournalPath(pinned, slug)) ? readOracleRuns(pinned, slug) : null;
  const verify_journal = existsSync(verifyJournalPath(pinned, slug))
    ? readVerifyRuns(pinned, slug)
    : null;
  const verify_result = readRunResult(join(pinned, `${slug}.md`), slug, notes);

  const critique = latestReceipts(
    projectScopedDir(env, projectRoot, env.critiqueDir, "critique"),
    slug,
  );
  const events = readMetricEvents(
    projectScopedDir(env, projectRoot, env.metricsDir, "metrics"),
    slug,
  );
  const git = collectGit(projectRoot, base, notes);

  return {
    slug,
    base_branch: base,
    now,
    spec,
    progress,
    oracles,
    verify_journal,
    verify_result,
    critique,
    events: events.length ? events : null,
    git,
    notes,
  };
}
