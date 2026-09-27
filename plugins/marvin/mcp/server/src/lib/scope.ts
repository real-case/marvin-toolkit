import { normalizeScopePath } from "./git.js";

/**
 * How a task's changed files are judged against its contract allowlist, in one
 * place (ADR-0045).
 *
 * Two callers ask the same question of the same file set: the scope gate in
 * `tools/spec.ts` (is every change inside the allowlist?) and the metrics
 * roll-up (which changes did the contract not declare? — Q1). Both read the set
 * from `changedFilesForScope` in `lib/git.ts`, and both route it through
 * `partitionScope` below, so the two cannot disagree about which paths are
 * marvin's own, which are by-products and which are violations. Declared here
 * so the two can never drift, as `changedFilesForScope` is.
 *
 * Three classes are removed before the allowlist is consulted, in this order:
 *
 * 1. marvin's own `.marvin/` artifacts and the spec file, which change on every
 *    task by construction — the rule both callers have always applied;
 * 2. paths the allowlist names (the contract's `files`, plus the gate's `allow`);
 * 3. paths matching a `scope.exempt` pattern from `.marvin/config.json` — files
 *    a task writes as a by-product (reviewer agent memory, a lock file, a typed
 *    sidecar) that no spec author can reasonably plan.
 *
 * The order matters for reporting only: a path the contract declares is
 * declared, never "exempted", so an exemption can only ever turn a would-be
 * violation into a reported by-product.
 */

/** One exempted path and the first configured pattern that matched it. */
export interface ScopeExemption {
  path: string;
  pattern: string;
}

/** A configured pattern the matcher refused, and why. */
export interface RejectedPattern {
  pattern: string;
  issue: string;
}

export interface ScopePartition {
  /** Changed files the judgement covers: `.marvin/` and the spec file removed. */
  judged: string[];
  /** Judged files neither allowlisted nor exempt — violations for the gate, `undeclared` for Q1. */
  outside: string[];
  /** Judged files not allowlisted that matched a `scope.exempt` pattern, in `judged` order. */
  exempt: ScopeExemption[];
  /** Configured patterns that were ignored, in configuration order. */
  rejected: RejectedPattern[];
}

export interface PartitionOptions {
  /** Paths permitted by the contract (and, at the gate, by `allow`). */
  allowlist: Iterable<string>;
  /** Project-relative path of the spec file, or null when the spec was passed inline. */
  specPath: string | null;
  /** The configured `scope.exempt` patterns; absent means none. */
  exempt?: readonly string[] | null;
}

/** marvin's own service files, which never count against a task's scope. */
function isMarvinArtifact(path: string): boolean {
  return path.startsWith(".marvin/");
}

/**
 * Split a task's changed files into the four classes above. Every path, the
 * allowlist and the spec path are normalised with the same `normalizeScopePath`
 * the changed set was built with, so `./src/a.ts` and `src/a.ts` are one path.
 */
export function partitionScope(changed: readonly string[], opts: PartitionOptions): ScopePartition {
  const allowed = new Set([...opts.allowlist].map(normalizeScopePath));
  const specPath = opts.specPath ? normalizeScopePath(opts.specPath) : null;
  const { matchers, rejected } = compileExemptions(opts.exempt ?? []);

  const judged: string[] = [];
  const outside: string[] = [];
  const exempt: ScopeExemption[] = [];
  for (const raw of changed) {
    const path = normalizeScopePath(raw);
    if (!path || isMarvinArtifact(path) || path === specPath) continue;
    judged.push(path);
    if (allowed.has(path)) continue;
    const hit = matchers.find((m) => m.test(path));
    if (hit) exempt.push({ path, pattern: hit.pattern });
    else outside.push(path);
  }
  return { judged, outside, exempt, rejected };
}

/**
 * The exemptions grouped by pattern, each group placed where its first path
 * appears in the changed set (git's diff order, not configuration order) —
 * the one rendering both callers use, so a gate detail and a metrics note name
 * the same patterns the same way.
 */
export function describeExemptions(exempt: readonly ScopeExemption[]): string {
  const byPattern = new Map<string, string[]>();
  for (const e of exempt) {
    const paths = byPattern.get(e.pattern);
    if (paths) paths.push(e.path);
    else byPattern.set(e.pattern, [e.path]);
  }
  return [...byPattern]
    .map(([pattern, paths]) => `\`${pattern}\` (${paths.length}): ${paths.join(", ")}`)
    .join("; ");
}

// ── the matcher ──────────────────────────────────────────────────────────────

interface CompiledPattern {
  pattern: string;
  test(path: string): boolean;
}

/**
 * Compile the configured patterns, keeping the valid ones and returning the
 * rest with a reason. This is the only place validity is decided: the config
 * loader reports the same issues as setting warnings but does not rewrite the
 * list, so the gate and the roll-up see exactly one verdict per pattern.
 */
export function compileExemptions(patterns: readonly string[]): {
  matchers: CompiledPattern[];
  rejected: RejectedPattern[];
} {
  const matchers: CompiledPattern[] = [];
  const rejected: RejectedPattern[] = [];
  for (const pattern of patterns) {
    const issue = exemptPatternIssue(pattern);
    if (issue) {
      rejected.push({ pattern, issue });
      continue;
    }
    const re = globToRegExp(canonicalPattern(pattern));
    matchers.push({ pattern, test: (path) => re.test(path) });
  }
  return { matchers, rejected };
}

/**
 * Does `path` match `pattern`? Both are project-relative POSIX paths. Exported
 * for the unit tests and for any future caller; the partition above compiles
 * each pattern once instead of calling this per path.
 */
export function matchesExemptPattern(path: string, pattern: string): boolean {
  if (exemptPatternIssue(pattern)) return false;
  return globToRegExp(canonicalPattern(pattern)).test(normalizeScopePath(path));
}

/**
 * Why a pattern cannot be used, or null when it can. The grammar is deliberately
 * small (see `globToRegExp`), so each refusal names a construct a user coming
 * from `.gitignore` or a shell might reasonably try and that would otherwise be
 * matched literally — a pattern that silently never matches is the failure this
 * guards against.
 */
export function exemptPatternIssue(pattern: string): string | null {
  if (typeof pattern !== "string" || pattern.trim() === "") return "it is empty";
  const p = pattern.trim();
  if (p.startsWith("/")) {
    return "it starts with `/` — patterns are already relative to the project root, so drop the leading slash";
  }
  if (p.includes("\\")) return "it contains a backslash — write paths with forward slashes";
  if (p.startsWith("!")) {
    return "it starts with `!` — negation is not supported; list only the paths to exempt";
  }
  const segments = canonicalPattern(p).split("/");
  if (segments.some((s) => s === ".." || s === "." || s === "")) {
    return "it contains an empty, `.` or `..` segment — name paths inside the project, one `/` between segments";
  }
  if (!/[^*?/]/.test(canonicalPattern(p))) {
    return "it is only wildcards — it would exempt every changed file and switch the scope gate off";
  }
  return null;
}

/**
 * The pattern in the form the matcher compiles: trimmed, a leading `./`
 * dropped (as `normalizeScopePath` drops it from paths), and a trailing `/`
 * read as "everything under this directory" (`dir/` → `dir/**`), since a file
 * path never ends in a slash and the literal reading could never match.
 */
function canonicalPattern(pattern: string): string {
  let p = pattern.trim().replace(/^\.\//, "");
  if (p.endsWith("/")) p = `${p}**`;
  return p;
}

/**
 * Translate a pattern into an anchored regular expression over a whole
 * project-relative path. The grammar, and all of it:
 *
 * - `**` as a whole segment matches zero or more whole segments, so `**\/x`
 *   matches `x` and `a/b/x`, `a/**\/b` matches `a/b` and `a/x/y/b`, and a
 *   trailing `a/**` matches everything under `a/`;
 * - `*` matches any run of characters within one segment, `?` exactly one; a
 *   `**` inside a segment (`a**b`) is read as `*`;
 * - every other character is literal — there are no character classes, no
 *   brace expansion and no negation, so `app/[id]/page.tsx` means that file.
 *
 * Wildcards match a leading dot like any other character (`*` matches
 * `.hidden`): by-products live in dot-directories often enough that the shell's
 * dotfile rule would only produce patterns that look right and never match.
 * Every pattern is anchored at the project root — `bun.lock` is the root lock
 * file and `**\/bun.lock` is any of them — so one rule covers every pattern,
 * unlike `.gitignore`, where a slash anywhere changes where a pattern applies.
 */
function globToRegExp(pattern: string): RegExp {
  const segments = pattern.split("/");
  let source = "";
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    if (segment === "**") {
      source += last ? ".*" : "(?:[^/]*/)*";
      return;
    }
    source += segment
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*+/g, "[^/]*")
      .replace(/\?/g, "[^/]");
    if (!last) source += "/";
  });
  return new RegExp(`^${source}$`);
}
