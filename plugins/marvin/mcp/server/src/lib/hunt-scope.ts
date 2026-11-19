import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  Coverage,
  CoverageEntry,
  Hotspot,
  HuntConfig,
  HuntScope,
} from "@marvin-toolkit/mcp-shared/contracts";
import { changedFilesForScope, git, hashObjects, normalizeScopePath } from "./git.js";

/**
 * Scope resolution and hotspot ranking for the code check (CFG-01/02, CODE-P01–P07). Git and the
 * filesystem are read in `collect*`; the ranking itself is the pure `rankHotspots`, so the same
 * signals always give the same order (NFR-04) and a test can pin the order on literals.
 */

/** File extensions the code check reads. Anything else is not source. */
const SOURCE_EXT =
  /\.(?:[cm]?[jt]sx?|vue|svelte|astro|py|go|rs|rb|java|kt|kts|swift|php|cs|scala|sql|ex|exs|dart|c|cc|cpp|h|hpp)$/i;

/** CFG-02 default exclusions: tests, vendored, generated and build output. */
export const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/vendor/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.svelte-kit/**",
  "**/__generated__/**",
  "**/generated/**",
  "**/*.generated.*",
  "**/*.gen.*",
  "**/*.d.ts",
  "**/*.min.*",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.stories.*",
  "**/test/**",
  "**/tests/**",
  "**/e2e/**",
  "**/fixtures/**",
  ".marvin/**",
  ".github/**",
];

const TEST_FILE = /(^|\/)(__tests__\/|tests?\/|e2e\/)|\.(test|spec)\.[^/]+$/;

/**
 * A small glob → RegExp: `**` spans directories, `*` and `?` stay inside one segment. A pattern
 * with no glob character is a path prefix, so `src/billing` selects the directory.
 */
export function globToRegExp(pattern: string): RegExp {
  const p = normalizeScopePath(pattern).replace(/\/$/, "");
  if (!/[*?]/.test(p)) {
    const esc = p.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${esc}(?:/.*)?$`);
  }
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === "*") {
      if (p[i + 1] === "*") {
        const slash = p[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(path));
}

/** Which tracked files are in scope: source files, inside `paths` (if any), outside every exclusion. */
export function filterScope(files: string[], paths: string[], exclude: string[]): string[] {
  const excludes = [...DEFAULT_EXCLUDES, ...exclude];
  return [...new Set(files.map(normalizeScopePath))]
    .filter((f) => f && SOURCE_EXT.test(f))
    .filter((f) => paths.length === 0 || matchesAny(f, paths))
    .filter((f) => !matchesAny(f, excludes))
    .sort();
}

export interface ScopeRequest {
  paths?: string[];
  /** A base ref: hunt only files changed since its merge base with HEAD (CODE-P06). */
  since?: string;
  /** Only the uncommitted diff. */
  diff?: boolean;
}

/** Resolve a scope request against the repository. Throws only outside a git repository. */
export function resolveScope(
  projectRoot: string,
  req: ScopeRequest,
  config: HuntConfig,
): HuntScope {
  const paths = req.paths && req.paths.length > 0 ? req.paths : config.scope.paths;
  if (req.since || req.diff) {
    const changed = changedFilesForScope(projectRoot, req.diff ? undefined : req.since);
    return {
      kind: "diff",
      paths,
      ...(req.since ? { base: req.since } : {}),
      // A deletion is a change with nothing left to read or hash: it leaves the scope here
      // rather than reaching `hash-object`, whose one failure would null every blob.
      files: filterScope(changed, paths, config.scope.exclude).filter((f) =>
        existsSync(join(projectRoot, f)),
      ),
    };
  }
  const tracked = git(["ls-files", "-z"], projectRoot, { maxBuffer: 256 * 1024 * 1024 });
  if (!tracked.ok) throw new Error(`git ls-files failed: ${tracked.stderr}`);
  const files = tracked.value.split("\0").filter(Boolean);
  return {
    kind: paths.length > 0 ? "paths" : "repo",
    paths,
    files: filterScope(files, paths, config.scope.exclude),
  };
}

// ── signals ───────────────────────────────────────────────────────────────

/**
 * CODE-P03: code touching money, auth, permissions, PII, deletion, concurrency or integrations.
 * The generic default; vendor names (a payment provider, a telephony API, a database's policy
 * feature) are project knowledge and belong in `hunt.risk_terms`, which replaces this list.
 */
export const RISK_TERMS = [
  "auth",
  "authentication",
  "authorization",
  "oauth",
  "login",
  "session",
  "token",
  "password",
  "secret",
  "permission",
  "role",
  "admin",
  "tenant",
  "payment",
  "checkout",
  "billing",
  "invoice",
  "refund",
  "webhook",
  "delete",
  "migration",
  "transaction",
  "mutex",
  "lock",
  "queue",
  "cron",
  "upload",
  "email",
  "phone",
] as const;

const MAX_READ = 256 * 1024;

/**
 * Identifier segments of a text, lowercased: identifiers split on camelCase, digits, `_`, `-`,
 * `/` and `.`. `getAuthToken` gives `get`, `auth`, `token`; `author` and `urls` stay whole, so a
 * term matches a segment exactly and never a substring of an unrelated word.
 */
export function identifierSegments(text: string): Set<string> {
  const out = new Set<string>();
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  for (const seg of spaced.split(/[^A-Za-z]+/)) if (seg) out.add(seg.toLowerCase());
  return out;
}

/** The risk terms a text contains, as whole segments; a plain plural (`payments`) counts. */
export function matchRiskTerms(text: string, terms: readonly string[]): string[] {
  const segs = identifierSegments(text);
  const lowered = [...new Set(terms.map((t) => t.toLowerCase()))];
  return lowered.filter((t) => segs.has(t) || segs.has(`${t}s`) || segs.has(`${t}es`)).sort();
}

/**
 * The time the ranking is judged at: the HEAD commit's committer time, so the same commit gives
 * the same order on any day (NFR-04). Null outside a repository with a commit.
 */
export function headTimeMs(projectRoot: string): number | null {
  const r = git(["show", "-s", "--format=%ct", "HEAD"], projectRoot);
  if (!r.ok) return null;
  const sec = Number(r.value.trim());
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : null;
}

/** `months` calendar months before `nowMs`, as an ISO timestamp for `git log --since`. */
export function windowStart(nowMs: number, months: number): string {
  const d = new Date(nowMs);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
}

/**
 * Blob ids for the files that exist; null for one that does not. `hash-object --stdin-paths`
 * fails the whole list on one missing path, so a deleted file is never handed to it.
 */
export function hashExisting(files: string[], projectRoot: string): Map<string, string | null> {
  const present = files.filter((f) => existsSync(join(projectRoot, f)));
  const ids = hashObjects(present, projectRoot);
  const byPath = new Map(present.map((f, i) => [f, ids?.[i] ?? null]));
  return new Map(files.map((f) => [f, byPath.get(f) ?? null]));
}

export interface RawSignals {
  path: string;
  churn: number;
  authors: number;
  fixCommits: number;
  lines: number;
  daysSinceChange: number | null;
  riskTerms: string[];
  audit: "never" | "changed" | "stale" | "fresh";
  hasTest: boolean;
}

interface History {
  churn: Map<string, number>;
  authors: Map<string, Set<string>>;
  fixes: Map<string, number>;
  last: Map<string, number>;
}

const FIX_SUBJECT = /^(fix|hotfix|bugfix|revert)(\(|:|!|\s)|\bfix(e[sd])?\b/i;

/** One `git log` over the window, folded per file. */
export function readHistory(
  projectRoot: string,
  months: number,
  files: string[],
  nowMs: number,
): History {
  const history: History = {
    churn: new Map(),
    authors: new Map(),
    fixes: new Map(),
    last: new Map(),
  };
  if (files.length === 0) return history;
  const wanted = new Set(files);
  const r = git(
    [
      "log",
      `--since=${windowStart(nowMs, months)}`,
      `--until=${new Date(nowMs).toISOString()}`,
      "--no-merges",
      "--format=%x1e%an%x1f%ct%x1f%s",
      "--name-only",
    ],
    projectRoot,
    { maxBuffer: 256 * 1024 * 1024 },
  );
  if (!r.ok) return history;
  for (const record of r.value.split("\x1e")) {
    if (!record.trim()) continue;
    const [head, ...names] = record.split("\n");
    const [author = "", ct = "0", subject = ""] = (head ?? "").split("\x1f");
    const isFix = FIX_SUBJECT.test(subject);
    for (const raw of names) {
      const f = normalizeScopePath(raw);
      if (!wanted.has(f)) continue;
      history.churn.set(f, (history.churn.get(f) ?? 0) + 1);
      history.authors.set(f, (history.authors.get(f) ?? new Set()).add(author));
      if (isFix) history.fixes.set(f, (history.fixes.get(f) ?? 0) + 1);
      history.last.set(f, Math.max(history.last.get(f) ?? 0, Number(ct)));
    }
  }
  return history;
}

const STALE_DAYS = 90;

export function auditState(
  entry: CoverageEntry | undefined,
  blob: string | null,
  nowMs: number,
): RawSignals["audit"] {
  if (!entry) return "never";
  if (blob !== null && entry.blob !== null && entry.blob !== blob) return "changed";
  const age = (nowMs - Date.parse(entry.last_audited_at)) / 86_400_000;
  return age > STALE_DAYS ? "stale" : "fresh";
}

function stem(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^.]+$/, "");
}

/** Collect every signal for every in-scope file. */
export function collectSignals(
  projectRoot: string,
  files: string[],
  months: number,
  coverage: Coverage,
  allTracked: string[],
  nowMs: number,
  riskTerms: readonly string[] = RISK_TERMS,
): { signals: RawSignals[]; blobs: Map<string, string | null> } {
  const history = readHistory(projectRoot, months, files, nowMs);
  const blobs = hashExisting(files, projectRoot);
  const byPath = new Map(coverage.files.map((e) => [e.path, e]));
  const testStems = new Set(
    allTracked.filter((f) => TEST_FILE.test(f)).map((f) => stem(f).replace(/\.(test|spec)$/, "")),
  );
  const signals = files.map((path): RawSignals => {
    let text = "";
    let lines = 0;
    try {
      const abs = join(projectRoot, path);
      if (statSync(abs).size <= 4 * 1024 * 1024) {
        text = readFileSync(abs, "utf8");
        lines = text.split("\n").length;
      }
    } catch {
      // A file deleted in the working tree has no lines and no content signals.
    }
    const terms = matchRiskTerms(`${path}\n${text.slice(0, MAX_READ)}`, riskTerms);
    const last = history.last.get(path);
    return {
      path,
      churn: history.churn.get(path) ?? 0,
      authors: history.authors.get(path)?.size ?? 0,
      fixCommits: history.fixes.get(path) ?? 0,
      lines,
      daysSinceChange: last ? Math.max(0, Math.floor((nowMs / 1000 - last) / 86_400)) : null,
      riskTerms: terms,
      audit: auditState(byPath.get(path), blobs.get(path) ?? null, nowMs),
      hasTest: testStems.has(stem(path)),
    };
  });
  return { signals, blobs };
}

// ── ranking ───────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Score one file. Each term is a logarithm or a step so no single signal dominates; the weights
 * are stated here once and explained in `hunt-code/references/hotspots.md`.
 */
export function scoreSignals(s: RawSignals): { score: number; why: string[] } {
  const parts: [number, string][] = [
    [Math.log2(1 + s.churn), `${s.churn} commit(s) in the window`],
    [Math.log2(1 + s.authors) * 0.75, `${s.authors} author(s)`],
    [Math.min(s.fixCommits, 5) * 0.75, `${s.fixCommits} fix commit(s)`],
    [Math.log2(1 + s.lines / 50), `${s.lines} line(s)`],
    [
      s.daysSinceChange === null
        ? 0
        : s.daysSinceChange <= 30
          ? 1.5
          : s.daysSinceChange <= 90
            ? 0.75
            : 0,
      s.daysSinceChange === null
        ? "no change in the window"
        : `changed ${s.daysSinceChange} day(s) ago`,
    ],
    [Math.min(s.riskTerms.length, 4) * 1.25, `risk terms: ${s.riskTerms.join(", ") || "none"}`],
    [
      { never: 1.5, changed: 1, stale: 0.5, fresh: -2 }[s.audit],
      {
        never: "never audited",
        changed: "changed since its last audit",
        stale: "audit is stale",
        fresh: "audited recently",
      }[s.audit],
    ],
    [s.hasTest ? 0 : 1, s.hasTest ? "has a test file" : "no matching test file"],
  ];
  const score = round2(parts.reduce((sum, [v]) => sum + v, 0));
  const why = parts
    .filter(([v]) => v > 0)
    .sort((a, b) => b[0] - a[0])
    .slice(0, 4)
    .map(([, w]) => w);
  return { score, why };
}

/** Rank by score, then path, and cut into batches (CODE-P07: every rank carries its reasons). */
export function rankHotspots(signals: RawSignals[], max: number, batchSize: number): Hotspot[] {
  return signals
    .map((s) => ({ s, ...scoreSignals(s) }))
    .sort((a, b) => b.score - a.score || a.s.path.localeCompare(b.s.path))
    .slice(0, max)
    .map(({ s, score, why }, i) => ({
      path: s.path,
      rank: i + 1,
      score,
      signals: {
        churn: s.churn,
        authors: s.authors,
        fix_commits: s.fixCommits,
        lines: s.lines,
        days_since_change: s.daysSinceChange,
        risk_terms: s.riskTerms,
        audit: s.audit,
        has_test: s.hasTest,
      },
      why,
      batch: Math.floor(i / batchSize) + 1,
    }));
}
