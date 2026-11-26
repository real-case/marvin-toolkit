import { posix, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import type { GateRunner } from "./gate.js";
import { isolatedGit } from "./gate.js";
import { formatTestOne } from "./seal.js";
import { withBaseWorktreeAsync } from "./worktree.js";

/**
 * Inherited-failure detection for the gate stage (ADR-0058). A project gate that fails is run
 * again, one failing test file at a time, on the commit the run is diffed from; a file that fails
 * there with the same test-level failure lines is inherited from the base, not caused by the run.
 * The gate is classified `inherited` only when every failing file is, and every test-level failure
 * line of the gate's own output is accounted for by those files. Anything short of that, and any
 * error on the way, leaves the gate failed: the check can only take a failure away when it has
 * proved, like for like, that the base already has it.
 */

/** Files the check will run per gate; a base that is redder than this is not "a few tests". */
export const MAX_INHERITED_FILES = 10;

/** One base-side run of one test file, as the cache keeps it. */
export interface BaseRun {
  code: number;
  lines: string[];
}

/** Keyed by base SHA and the exact command, so a changed template or file never reuses a result. */
export interface BaseRunCache {
  get(baseSha: string, command: string): BaseRun | undefined;
  set(baseSha: string, command: string, run: BaseRun): void;
}

export const cacheKey = (baseSha: string, command: string) =>
  createHash("sha256").update(`${baseSha}\0${command}`).digest("hex").slice(0, 32);

export type InheritedVerdict =
  | {
      kind: "inherited";
      base: string;
      files: string[];
      lines: string[];
      /** How many of the files' base runs came from the cache. */
      cached: number;
    }
  /** The run broke something the base does not: at least one failure is the run's own. */
  | { kind: "new"; reason: string }
  /** The check could not decide; the gate stays failed (fail closed). */
  | { kind: "unavailable"; reason: string };

export interface InheritedCheck {
  /** Absolute path of the run worktree, where HEAD is checked out. */
  worktree: string;
  gitDir: string;
  /** The commit the run is diffed from, 40-hex; the base side runs here. */
  baseSha: string;
  /** The paths the run changed against `baseSha`: a failing test the run touched is never inherited. */
  changed: readonly string[];
  /** `gates.test_one`, or undefined when the project has none. */
  testOne: string | undefined;
  /** `pipeline.test_path_pattern`: what a test file looks like. */
  testPathPattern: string;
  /** The failed gate's whole output on HEAD. */
  output: string;
  run: GateRunner;
  timeoutMs: number;
  cache: BaseRunCache;
  signal?: AbortSignal;
}

/** A line naming one failed test (node's spec and TAP reporters, vitest, jest). */
const FAILURE_LINE = /^(?:✖|×|✗|❯|FAIL\b|not ok\b|●)/u;
/** The headers and summaries that carry the markers but name no test. */
const NOT_A_TEST = /^(?:✖ failing tests:?$|FAIL\s*$|●\s*$)/u;

/**
 * The test-level failure lines of a runner's output, normalised so that two runs of the same
 * failure compare equal: ANSI colour removed, the worktree's path replaced, durations, TAP
 * ordinals and `:line:col` positions dropped. Summary counts are not failure lines at all.
 */
export function failureLines(output: string, root: string): string[] {
  const roots = [...new Set([root, realOrSelf(root)])]
    .flatMap((r) => [r, `file://${r}`])
    .sort((a, b) => b.length - a.length);
  const out = new Set<string>();
  for (const raw of output.split("\n")) {
    // eslint-disable-next-line no-control-regex
    let line = raw.replace(/\u001b\[[0-9;]*m/g, "").trim();
    if (!FAILURE_LINE.test(line) || NOT_A_TEST.test(line)) continue;
    for (const r of roots) line = line.split(`${r}/`).join("<root>/");
    line = line
      .replace(/\s*\(\d+(?:\.\d+)?\s*m?s\)/g, "")
      .replace(/\s+\d+(?:\.\d+)?\s*m?s$/, "")
      .replace(/^not ok \d+/, "not ok")
      .replace(/:\d+(?::\d+)?\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (line !== "") out.add(line);
  }
  return [...out].sort();
}

/** A failure that is not a test's: the line-based comparison cannot account for it. */
const COMPILER_ERROR = /\berror TS\d{3,}\b/;

const PATH_TOKEN = /(?:file:\/\/)?[\w@.\-/]+\.[A-Za-z0-9]+(?::\d+(?::\d+)?)?/g;

/**
 * The test files a runner's output names as failing: path tokens on its failure lines and on
 * node's `test at <file>:<line>:<col>` lines and TAP's `location:` line of a `not ok` block, made relative to `root`, kept when they look like a
 * test file and git tracks them at HEAD. Sorted, each once.
 */
export function failingFiles(
  output: string,
  root: string,
  testPathPattern: string,
  tracked: (path: string) => boolean,
): string[] {
  const looksLikeTest = new RegExp(testPathPattern);
  const roots = [...new Set([root, realOrSelf(root)])];
  const out = new Set<string>();
  // TAP (node's default reporter off a terminal before v23) names a failed test's file only in
  // the `location:` line of the YAML block after its `not ok`; a passing test's block is skipped.
  let inFailedBlock = false;
  for (const raw of output.split("\n")) {
    // eslint-disable-next-line no-control-regex
    const line = raw.replace(/\u001b\[[0-9;]*m/g, "").trim();
    if (/^(?:not )?ok\b/.test(line)) inFailedBlock = line.startsWith("not ok");
    else if (line === "...") inFailedBlock = false;
    const location = inFailedBlock && line.startsWith("location:");
    if (!FAILURE_LINE.test(line) && !line.startsWith("test at ") && !location) continue;
    for (const token of line.match(PATH_TOKEN) ?? []) {
      let path = token.replace(/^file:\/\//, "").replace(/(?::\d+){1,2}$/, "");
      if (isAbsolute(path)) {
        const rel = roots
          .map((r) => relative(r, path))
          .find((x) => !x.startsWith("..") && !isAbsolute(x));
        if (rel === undefined) continue;
        path = rel.split("\\").join("/");
      }
      path = posix.normalize(path).replace(/^\.\//, "");
      if (path.startsWith("../") || !looksLikeTest.test(path)) continue;
      if (tracked(path)) out.add(path);
    }
  }
  return [...out].sort();
}

const realOrSelf = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Decide whether a failed gate's failures are all inherited from `baseSha`. Each failing file runs
 * through `gates.test_one` on HEAD (in the run worktree) and on the base (in a throwaway detached
 * worktree, `withBaseWorktreeAsync`, created only when a base result is not cached). A stop
 * request on `signal` rejects with its reason; every other error is `unavailable`.
 */
export async function checkInherited(o: InheritedCheck): Promise<InheritedVerdict> {
  try {
    return await decideInherited(o);
  } catch (error) {
    if (o.signal?.aborted) throw o.signal.reason;
    return {
      kind: "unavailable",
      reason:
        `the base check failed: ${error instanceof Error ? error.message : String(error)}`.split(
          "\n",
        )[0]!,
    };
  }
}

async function decideInherited(o: InheritedCheck): Promise<InheritedVerdict> {
  if (!o.testOne) return { kind: "unavailable", reason: "no gates.test_one to run a single file" };
  const gateLines = failureLines(o.output, o.worktree);
  if (gateLines.length === 0) {
    return { kind: "unavailable", reason: "the output names no failed test" };
  }
  if (COMPILER_ERROR.test(o.output)) {
    return { kind: "unavailable", reason: "the output carries a compiler error besides its tests" };
  }
  const git = isolatedGit(o.worktree, o.gitDir);
  const atHead = (path: string) => {
    try {
      git.text("cat-file", "-e", `HEAD:${path}`);
      return true;
    } catch {
      return false;
    }
  };
  const files = failingFiles(o.output, o.worktree, o.testPathPattern, atHead);
  if (files.length === 0) {
    return { kind: "unavailable", reason: "the output names no failing test file" };
  }
  if (files.length > MAX_INHERITED_FILES) {
    return {
      kind: "unavailable",
      reason: `${files.length} failing test files, more than the ${MAX_INHERITED_FILES} the base check runs`,
    };
  }
  const changed = new Set(o.changed);
  for (const f of files) {
    if (changed.has(f)) return { kind: "new", reason: `the run changed the failing test ${f}` };
    try {
      git.text("cat-file", "-e", `${o.baseSha}:${f}`);
    } catch {
      return { kind: "new", reason: `the failing test ${f} does not exist on the base` };
    }
  }
  const commands = new Map(files.map((f) => [f, formatTestOne(o.testOne!, f)]));

  const run = async (command: string, cwd: string): Promise<BaseRun> => {
    o.signal?.throwIfAborted();
    const r = await o.run(command, cwd, o.timeoutMs, o.signal);
    o.signal?.throwIfAborted();
    return { code: r.code, lines: failureLines(r.output, cwd) };
  };

  const head = new Map<string, BaseRun>();
  for (const [f, command] of commands) {
    const r = await run(command, o.worktree);
    if (r.code === 0) {
      return {
        kind: "unavailable",
        reason: `${f} passes when run alone on HEAD, so its failure in the gate is not attributable to it`,
      };
    }
    if (r.lines.length === 0) {
      return { kind: "unavailable", reason: `${f} fails on HEAD without naming a failed test` };
    }
    head.set(f, r);
  }
  const covered = new Set([...head.values()].flatMap((r) => r.lines));
  const unaccounted = gateLines.filter((l) => !covered.has(l));
  if (unaccounted.length > 0) {
    return {
      kind: "unavailable",
      reason: `the gate fails on lines no single-file run reproduces: ${unaccounted.slice(0, 3).join(" | ")}`,
    };
  }

  const base = new Map<string, BaseRun>();
  let cached = 0;
  for (const [f, command] of commands) {
    const hit = o.cache.get(o.baseSha, command);
    if (hit !== undefined) {
      base.set(f, hit);
      cached += 1;
    }
  }
  const missing = [...commands].filter(([f]) => !base.has(f));
  if (missing.length > 0) {
    await withBaseWorktreeAsync(
      { worktree: o.worktree, gitDir: o.gitDir, commit: o.baseSha },
      async (tree) => {
        for (const [f, command] of missing) {
          const r = await run(command, tree);
          o.cache.set(o.baseSha, command, r);
          base.set(f, r);
        }
      },
    );
  }

  for (const f of files) {
    const b = base.get(f)!;
    const h = head.get(f)!;
    if (b.code === 0) return { kind: "new", reason: `${f} passes on the base` };
    if (!sameSet(h.lines, b.lines)) {
      const added = h.lines.filter((l) => !b.lines.includes(l));
      return {
        kind: added.length > 0 ? "new" : "unavailable",
        reason:
          added.length > 0
            ? `${f} fails on HEAD where the base does not: ${added.slice(0, 3).join(" | ")}`
            : `${f} fails differently on the base`,
      };
    }
  }
  return { kind: "inherited", base: o.baseSha, files, lines: gateLines, cached };
}
