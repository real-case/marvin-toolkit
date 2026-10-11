import type { TaskMetrics } from "@marvin-toolkit/mcp-shared/contracts";
import { projectScopedDir, type ServerEnv } from "./env.js";
import { inGitRepo, isIgnored } from "./git.js";
import { collectRollupInputs, findSpecBySlug, relFromRoot } from "./metrics-collect.js";
import { rollUpMetrics } from "./metrics-rollup.js";
import type { Config, SpecConfig } from "../storage/schema.js";
import {
  appendTaskMetrics,
  ensureRecord,
  findRecord,
  metricsRecordPath,
  readRecord,
  recordBasenameForSpec,
  SLUG_RE,
  slugOfRecord,
} from "../storage/metrics.js";

/**
 * Writing a metrics record, in one place (ADR-0044).
 *
 * Three callers reach this module — the `metrics` tool's `rollup` action, the
 * `spec` tool's seal gate, and the `verify` tool's delivery gate — and the rule
 * that decides a record's FILENAME must be identical for all three. Two copies
 * of it give one task two record files, which no reader joins; that is why
 * `recordPathFor` lives here rather than staying private to the tool that first
 * needed it.
 *
 * The module deliberately does NOT own fail-open behaviour. Each caller wraps
 * its own call in its own `try/catch`, so one anchor's failure can never decide
 * another's, and the "a record can never change a verdict" property stays
 * checkable by reading the few lines around each call site.
 */

/**
 * The record's path for a slug: an existing record first (so a slug never gets
 * two files), else the spec's own basename (ADR-0043 §1), else `<slug>.md` for
 * a record written against a draft the corpus cannot yet see.
 *
 * `knownSpecPath` short-circuits the corpus search. A caller that already holds
 * the spec file — the seal gate reads it to hash it — passes it and needs no
 * `specConfig` at all. That matters beyond saving a search: the seal branch of
 * `runSpec` returns BEFORE the config is loaded, so it could only ever supply
 * `undefined`, and a project whose `spec.dir` sits outside the detection
 * candidates would then miss its own spec and pin the record to `<slug>.md`.
 */
export function recordPathFor(
  dir: string,
  slug: string,
  projectRoot: string,
  specConfig: SpecConfig | undefined,
  knownSpecPath?: string,
): string {
  const existing = findRecord(dir, slug);
  if (existing) return existing;
  const specPath = knownSpecPath ?? findSpecBySlug(slug, projectRoot, specConfig);
  return metricsRecordPath(dir, specPath ? recordBasenameForSpec(specPath) : slug);
}

/**
 * The slug a spec's record is filed under, or null where the seal anchor files none: the
 * frontmatter `slug` first, else the filename with `.md` and any `NNN-` prefix stripped
 * (`slugOfRecord`'s rule). The slug becomes a FILENAME, so it must be kebab-case.
 *
 * A filename fallback that still leads with a numeric group is refused as well. `slugOfRecord`
 * strips one leading `<digits>-` group, which is the spec-number convention — but a date-named
 * file (`2026-09-04-thing.md`) loses only its year and yields `09-04-thing`, a slug that is
 * kebab-case and WRONG. A record under it would be joined by nothing, and the roll-up would
 * later mint a second file under the real slug: writing nothing costs an `empty` row, writing the
 * wrong name costs the join.
 *
 * The seal anchor creates a record under this slug, and the autopilot engine finds the record by
 * it to commit it with the approved spec, so the two cannot look for different files.
 */
export function recordSlugForSpec(declared: string | undefined, specPath: string): string | null {
  const own = (declared ?? "").trim();
  const slug = own || slugOfRecord(specPath);
  if (!SLUG_RE.test(slug)) return null;
  if (!own && /^\d+-/.test(slug)) return null;
  return slug;
}

/** The metrics directory that governs a call's own project root. */
export function metricsDirFor(env: ServerEnv, projectRoot: string): string {
  return projectScopedDir(env, projectRoot, env.metricsDir, "metrics");
}

/**
 * Create the record for a spec the caller already holds, and nothing more.
 *
 * Returns the path written or reused; the caller decides whether to say so.
 */
export function ensureRecordForSpec(
  env: ServerEnv,
  projectRoot: string,
  slug: string,
  specPath: string,
): string {
  const path = recordPathFor(
    metricsDirFor(env, projectRoot),
    slug,
    projectRoot,
    undefined,
    specPath,
  );
  ensureRecord(path, slug);
  return path;
}

export interface RollupRequest {
  env: ServerEnv;
  projectRoot: string;
  config: Config;
  slug: string;
  /** The ref scope drift is measured against; defaults to the config's base branch. */
  base?: string;
  /** ISO 8601, stamped as `rolled_up_at`. Defaults to now. */
  now?: string;
}

export interface RollupWrite {
  /** Absolute path of the record written. */
  path: string;
  /** The same path, project-relative — what an answer shows a user. */
  record: string;
  block: TaskMetrics;
  /** Terminal blocks in the record AFTER this append; a second delivery makes it 2. */
  terminalBlocks: number;
  /** Whether git ignores the record, or null outside a git repository. */
  ignored: boolean | null;
}

/**
 * Derive the terminal block from the artifacts on disk and append it.
 *
 * Every metric is nullable and null means the source was absent, so this never
 * fails for want of an input; it throws only on an unwritable directory, which
 * is what each caller's own `try/catch` is for.
 */
export function performRollup(req: RollupRequest): RollupWrite {
  const { env, projectRoot, config, slug } = req;
  const base = req.base?.trim() || config.base_branch;
  const now = req.now ?? new Date().toISOString();

  const block = rollUpMetrics(
    collectRollupInputs(env, projectRoot, config.spec, slug, base, now, config.scope?.exempt),
  );

  const dir = metricsDirFor(env, projectRoot);
  const path = recordPathFor(dir, slug, projectRoot, config.spec);
  appendTaskMetrics(path, block);

  const record = relFromRoot(path, projectRoot);
  return {
    path,
    record,
    block,
    terminalBlocks: readRecord(path).terminal.length,
    // A host project with a blanket `.marvin/` exclusion learns at the FIRST
    // roll-up that its series is not being committed, rather than never.
    ignored: inGitRepo(projectRoot) ? isIgnored(record, projectRoot) : null,
  };
}
