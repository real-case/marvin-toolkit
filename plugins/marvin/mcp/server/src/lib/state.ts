import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  DashboardAuditArea,
  DashboardAudits,
  DashboardHandoff,
  DashboardSpec,
  DashboardState,
  TaskCard,
} from "@marvin-toolkit/mcp-shared/contracts";
import { readAllTasks } from "../storage/tasks.js";
import { readAllHandoffs } from "../storage/handoff.js";
import { parseFrontmatter } from "../storage/frontmatter.js";
import { buildTaskCard } from "../flows/card.js";
import { roleOfStatus, type Config, type StatusRole } from "../storage/schema.js";
import { currentBranch, hasGh, hasGit, inGitRepo } from "./git.js";
import { parseAuditBlock, parseRegisterFindings } from "./reports.js";
import { PROMPTS } from "../prompts/index.js";
import type { ServerEnv } from "./env.js";

/**
 * Shared project-state computation (ADR-0024 → ADR-0030). The `help` tool has
 * always computed the board counters, git availability, artifact counts, and
 * the registry-derived command groups for its `DashboardState` payload; the
 * `dashboard` tool aggregates the same state into the whole-toolbox report, so
 * the computation lives here once instead of being copy-pasted.
 */

export interface BoardCounts {
  /** Per-status counts over the configured set — every key present, even at 0. */
  counts: Record<string, number>;
  /** The closed per-role roll-up (ADR-0026). */
  roleCounts: Record<StatusRole, number>;
  /** Board files the tolerant reader could not parse. */
  malformed: number;
}

/** Board counters over the configured status set (ADR-0026). */
export function boardCounts(env: ServerEnv, config: Config): BoardCounts {
  const { tasks, malformed } = readAllTasks(env.tasksDir, config);
  const counts: Record<string, number> = {};
  for (const s of config.statuses) counts[s.key] = 0;
  const roleCounts: Record<StatusRole, number> = {
    todo: 0,
    wip: 0,
    review: 0,
    done: 0,
    blocked: 0,
  };
  for (const t of tasks) {
    counts[t.frontmatter.status] = (counts[t.frontmatter.status] ?? 0) + 1;
    roleCounts[roleOfStatus(config, t.frontmatter.status)] += 1;
  }
  return { counts, roleCounts, malformed: malformed.length };
}

/** git / gh availability and the current branch (null outside a repo). */
export function gitState(projectDir: string): DashboardState["git"] {
  return {
    has_git: hasGit(),
    has_gh: hasGh(),
    branch: inGitRepo(projectDir) ? currentBranch(projectDir) : null,
  };
}

const GROUP_PREFIXES = ["adr", "pr", "task", "sec", "refactor", "track"];
export const GROUP_ORDER = ["core", "adr", "pr", "task", "sec", "refactor", "track"];

/**
 * Group of a prompt by its `<group>-<command>` prefix; bare names are "core" —
 * including a bare name that *equals* a prefix (the `/marvin:adr` create
 * singleton is a core tool; the `adr-*` lifecycle around it is the group).
 */
export function groupOf(name: string): string {
  const prefix = name.split("-")[0] ?? "";
  return prefix !== name && GROUP_PREFIXES.includes(prefix) ? prefix : "core";
}

/** Command counts per group, derived from the prompt registry (ADR-0024). */
export function commandGroups(): DashboardState["command_groups"] {
  return GROUP_ORDER.map((group) => ({
    group,
    count: PROMPTS.filter((p) => groupOf(p.name) === group).length,
  })).filter((g) => g.count > 0);
}

/** Count the `.md` artifacts under each `.marvin/` subdir for the dashboard. */
export function artifactCounts(env: ServerEnv): DashboardState["artifacts"] {
  const marvin = join(env.projectDir, ".marvin");
  return {
    specs: countMarkdown(join(marvin, "task"), ["verification.md"]),
    handoffs: countMarkdown(join(marvin, "handoff")),
    audits: countMarkdown(join(marvin, "security")),
    lessons: countMarkdown(env.memoryDir, ["MEMORY.md"]),
  };
}

/** `.md` files in a directory, minus exclusions; a missing dir counts 0. */
export function countMarkdown(dir: string, exclude: string[] = []): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md") && !exclude.includes(f)).length;
  } catch {
    return 0;
  }
}

// ── DashboardState v2 digests (ADR-0024 data-first staging) ─────────────────
// Four narrow readers behind the dashboard's current-work, handoff and audit
// zones. Each reuses an existing seam rather than re-walking `.marvin/`, takes
// an optional `now` so ages are exact under test (mirroring `ScanOptions.now`
// in `lib/reports.ts`), and returns an empty value for a missing directory —
// never a throw (the ADR-0030 zero-state doctrine).

/** How many rows each digest shows. A server-side constant, not a tool input. */
export const DIGEST_LIMIT = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between a timestamp and `now`; null when the timestamp is unusable. */
function ageDays(ms: number, now: number): number | null {
  return Number.isNaN(ms) ? null : Math.max(0, Math.floor((now - ms) / DAY_MS));
}

/** First `# ` heading of a markdown body, or null. */
function firstHeading(text: string): string | null {
  const m = text.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1]! : null;
}

/**
 * Active board cards: roles `wip` and `review` only, newest `updated` first,
 * capped at {@link DIGEST_LIMIT}. Nothing active yields an empty list rather
 * than falling back to `todo` — the zone means *current* work.
 */
export function boardDigest(env: ServerEnv, config: Config): TaskCard[] {
  const { tasks } = readAllTasks(env.tasksDir, config);
  return tasks
    .filter((t) => {
      const role = roleOfStatus(config, t.frontmatter.status);
      return role === "wip" || role === "review";
    })
    .sort(
      (a, b) =>
        // `updated` is an ISO datetime — it compares correctly as a string.
        b.frontmatter.updated.localeCompare(a.frontmatter.updated) ||
        Number(b.frontmatter.id) - Number(a.frontmatter.id),
    )
    .slice(0, DIGEST_LIMIT)
    .map((t) => buildTaskCard(t, config));
}

/**
 * Pipeline specs under `<projectDir>/.marvin/task` still in flight, each keyed by
 * its frontmatter `slug` (the filename slug when the spec carries none): frontmatter
 * `status` other than `shipped` (a missing status counts as in flight, since
 * a spec is only marked shipped on delivery). `verification.md` is the gate
 * artifact, not a spec, and symlinked entries are skipped outright — a planted
 * link must not pull out-of-tree content into `structuredContent` (the
 * `readMdFiles` rule). Ordered by the numeric filename prefix descending, which
 * is stable under edits in a way mtime is not; capped at {@link DIGEST_LIMIT}.
 */
export function specDigest(projectDir: string): DashboardSpec[] {
  const dir = join(projectDir, ".marvin", "task");
  if (!existsSync(dir)) return [];
  let filenames: string[];
  try {
    filenames = readdirSync(dir).sort();
  } catch {
    return []; // an unreadable directory counts as empty — the zero-state doctrine
  }

  const rows: { spec: DashboardSpec; order: number }[] = [];
  for (const filename of filenames) {
    if (!filename.endsWith(".md") || filename === "verification.md") continue;
    try {
      const path = join(dir, filename);
      if (lstatSync(path).isSymbolicLink()) continue;
      const { frontmatter, body } = parseFrontmatter(readFileSync(path, "utf8"));
      if (frontmatter.status === "shipped") continue;
      const base = filename.replace(/\.md$/, "");
      const m = /^(\d+)-(.+)$/.exec(base);
      const id = m?.[1];
      // A spec's identity is its frontmatter `slug` (CLAUDE.md, task-start);
      // the filename slug is the fallback for a spec written without one.
      const slug = frontmatter.slug || (m?.[2] ?? base) || filename;
      rows.push({
        spec: { slug, title: firstHeading(body) ?? slug, ...(id ? { id } : {}) },
        order: id ? Number(id) : -1,
      });
    } catch {
      continue; // an unreadable spec is skipped, never fatal
    }
  }

  return rows
    .sort((a, b) => b.order - a.order || a.spec.slug.localeCompare(b.spec.slug))
    .slice(0, DIGEST_LIMIT)
    .map((r) => r.spec);
}

/**
 * Recent handoffs in the order `readAllHandoffs` returns them (numeric filename
 * id descending), capped at {@link DIGEST_LIMIT}. `age_days` comes from the
 * frontmatter `created` date, independently of that order: a repository whose
 * id order disagrees with its `created` order shows non-monotonic ages, by
 * design — the row says when it was written, the list says which came last.
 */
export function handoffDigest(handoffDir: string, now: number = Date.now()): DashboardHandoff[] {
  const { handoffs } = readAllHandoffs(handoffDir);
  return handoffs.slice(0, DIGEST_LIMIT).map((h) => ({
    slug: h.frontmatter.slug,
    objective: h.frontmatter.objective,
    age_days: ageDays(Date.parse(h.frontmatter.created), now),
  }));
}

/** Severity keys of the closed audit vocabulary (`by_severity` is partial). */
type SeverityKey = keyof DashboardAuditArea["by_severity"];

/**
 * Severity rank, most severe first — the order `findingCounts` already uses in
 * `lib/reports.ts`. Bucketing walks this rather than the findings, so both the
 * payload's key order and the rendered line stay severity-ranked whatever order
 * a report happens to list its findings in.
 */
const SEVERITY_ORDER: SeverityKey[] = ["critical", "high", "medium", "low", "info"];

/**
 * Audit findings per area, from the newest report each area holds.
 *
 * Security takes the newest file whose ` ```json audit-report ` block PARSES —
 * `parseAuditBlock` reports that tri-state, so a prose-only legacy report is
 * skipped rather than counted as zero findings. Refactor takes the newest file
 * matching `NNN-audit-*` / `NNN-smells-*` regardless of how many findings its
 * table yields, because `parseRegisterFindings` cannot distinguish "not a
 * register" from "a register with nothing in it" and `scanRefactorReports`
 * already treats a heading-only register as a valid zero-finding report;
 * `NNN-plan-*` holds steps, not findings, and is excluded.
 *
 * An area with no qualifying report is `null`, which is distinct from an area
 * scanned clean (`total: 0`).
 */
export function auditDigest(
  dirs: { security: string; refactor: string },
  now: number = Date.now(),
): DashboardAudits {
  return {
    security: newestArea(dirs.security, () => true, findingsFromAuditBlock, now),
    refactor: newestArea(dirs.refactor, isRegister, parseRegisterFindings, now),
  };
}

const isRegister = (filename: string): boolean => /^\d+-(audit|smells)-.*\.md$/.test(filename);

/** Findings of a `sec-*` report, or null when its Tier-2 block is absent/broken. */
function findingsFromAuditBlock(raw: string): { severity: SeverityKey }[] | null {
  const parsed = parseAuditBlock(raw);
  return parsed.kind === "ok" ? parsed.report.findings : null;
}

/**
 * The newest qualifying report in one area, bucketed by severity. Candidates
 * are the `.md` files the area's filename filter accepts, ranked by mtime alone
 * (tie-broken by filename so equal mtimes stay deterministic) — bodies are read
 * lazily inside the selection loop, so the usual call reads exactly one file
 * rather than the whole directory. The first whose body yields findings wins;
 * `extract` returning null means "not a report of this kind, keep looking".
 * Null when nothing qualifies.
 */
function newestArea(
  dir: string,
  accepts: (filename: string) => boolean,
  extract: (raw: string) => { severity: SeverityKey }[] | null,
  now: number,
): DashboardAuditArea | null {
  if (!existsSync(dir)) return null;
  let filenames: string[];
  try {
    filenames = readdirSync(dir).sort();
  } catch {
    return null; // an unreadable directory counts as never scanned
  }

  const candidates: { filename: string; mtimeMs: number }[] = [];
  for (const filename of filenames) {
    if (!filename.endsWith(".md") || !accepts(filename)) continue;
    try {
      const path = join(dir, filename);
      if (lstatSync(path).isSymbolicLink()) continue;
      candidates.push({ filename, mtimeMs: statSync(path).mtimeMs });
    } catch {
      continue; // an unstat-able report is skipped, never fatal
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.filename.localeCompare(a.filename));

  for (const candidate of candidates) {
    let findings: { severity: SeverityKey }[] | null;
    try {
      findings = extract(readFileSync(join(dir, candidate.filename), "utf8"));
    } catch {
      continue; // an unreadable report is skipped, never fatal
    }
    if (findings === null) continue;
    const by_severity: DashboardAuditArea["by_severity"] = {};
    for (const severity of SEVERITY_ORDER) {
      const n = findings.filter((f) => f.severity === severity).length;
      if (n > 0) by_severity[severity] = n;
    }
    return {
      scanned_age_days: ageDays(candidate.mtimeMs, now),
      total: findings.length,
      by_severity,
      newest_report: candidate.filename,
    };
  }
  return null;
}
