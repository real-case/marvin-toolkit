import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export type Severity = "blocker" | "major" | "minor";
export interface GateCommand {
  name: string;
  command: string;
  /** Re-run once after a failure and call a pass on the re-run flaky. Default true. */
  retry?: boolean;
}
export interface CheckRule {
  id: string;
  pattern: string;
  path_pattern?: string;
  exclude_pattern?: string;
  message: string;
  severity?: Severity;
  category?: string;
}
export interface GateResult {
  name: string;
  result: "pass" | "fail" | "flaky";
  ms: number;
  tail: string;
}
export interface AddedLine {
  file: string;
  line: number;
  text: string;
}
export interface CheckHit {
  id: string;
  file: string;
  line: number;
  text: string;
  message: string;
  severity: Severity;
  category: string;
}
export interface SealedFile {
  path: string;
  sha256: string;
  criteria: string[];
}
/** Path to a fingerprint (content hash, `link:<target>` or `missing`) of every protected file. */
export type ProtectedSnapshot = Record<string, string>;
export type ProtectedSource = "committed diff" | "protected snapshot" | "post-gate snapshot";
/** A blocker the engine found by itself rather than through a gate, check or hash. */
export interface GateBlocker {
  category: "scope" | "gate";
  claim: string;
  file?: string;
  evidence: string;
  expected: string;
}
export interface GateReport {
  passed: boolean;
  gates: GateResult[];
  undeclared: string[];
  protected: string[];
  /** Where each protected path was seen; a path with no entry came from the committed diff. */
  protectedSources: Record<string, ProtectedSource[]>;
  /** The patterns the protected paths were judged against. */
  protectedPatterns: string[];
  checks: CheckHit[];
  sealed: { path: string; ok: boolean }[];
  blockers: GateBlocker[];
}
export interface Finding {
  id: string;
  severity: Severity;
  category: string;
  file?: string;
  line?: number;
  criterion?: string;
  claim: string;
  evidence: string;
  expected: string;
}
export type Runner = (
  command: string,
  cwd: string,
  timeoutMs: number,
) => { code: number; output: string; ms: number };

const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * The command is `$1` of a wrapper that runs it as a background job under `set -m`, so it
 * gets its own process group, and that group is what a TERM or INT to the wrapper kills
 * (KILL a second later for a command that ignores TERM). Killing only `/bin/sh` on a
 * timeout would leave the suite running next to its own retry, and writing to the worktree.
 * The wrapper's own stderr goes to /dev/null so the shell's job notices (`[1]+ Done`) stay
 * out of the output; the command gets the real stderr back through fd 3.
 */
const RUNNER_WRAPPER = [
  "set -m",
  "exec 3>&2 2>/dev/null",
  '/bin/sh -c "$1" 2>&3 3>&- &',
  "pid=$!",
  `trap 'kill -TERM -"$pid" 2>/dev/null; sleep 1; kill -KILL -"$pid" 2>/dev/null' TERM INT`,
  'wait "$pid"',
  "code=$?",
  'exit "$code"',
].join("\n");

export const shellRunner: Runner = (command, cwd, timeoutMs) => {
  const started = Date.now();
  const r = spawnSync("/bin/sh", ["-c", RUNNER_WRAPPER, "sh", command], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
  });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  const launch = timedOut
    ? `error: timed out after ${timeoutMs}ms\n`
    : r.error
      ? `error: ${r.error.message}\n`
      : "";
  return {
    code: timedOut ? 124 : (r.status ?? 124),
    output: `${r.stdout ?? ""}${r.stderr ?? ""}${launch}`,
    ms: Date.now() - started,
  };
};

const relevantTail = (s: string) => {
  const lines = s.trimEnd().split("\n");
  const errors = lines.filter((l) => /\berror\b|\bfail(ed|ure)?\b|✗|×/i.test(l)).slice(-20);
  return (errors.length ? errors : lines.slice(-40)).join("\n");
};

export function runGates(
  commands: readonly GateCommand[],
  cwd: string,
  run: Runner,
  timeoutMs: number,
): GateResult[] {
  return commands.map(({ name, command, retry = true }) => {
    const first = run(command, cwd, timeoutMs);
    if (first.code === 0) return { name, result: "pass", ms: first.ms, tail: "" };
    if (!retry) return { name, result: "fail", ms: first.ms, tail: relevantTail(first.output) };
    const second = run(command, cwd, timeoutMs);
    if (second.code === 0) {
      return { name, result: "flaky", ms: first.ms + second.ms, tail: relevantTail(first.output) };
    }
    return { name, result: "fail", ms: first.ms + second.ms, tail: relevantTail(second.output) };
  });
}

const C_ESCAPES: Record<string, number> = {
  '"': 0x22,
  "\\": 0x5c,
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
};

/**
 * Decode git's C-style quoting of a path: a name with a quote, backslash or control
 * character, or (without `core.quotePath=false`) a non-ASCII byte, is wrapped in `"…"`
 * with `\" \\ \a \b \t \n \v \f \r` and three-digit octal bytes, which form UTF-8.
 * Anything not wrapped in quotes is returned as is.
 */
export function cUnquote(quoted: string): string {
  if (quoted.length < 2 || !quoted.startsWith('"') || !quoted.endsWith('"')) return quoted;
  const inner = quoted.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner.charAt(i);
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(inner.slice(i + 1, i + 4))?.[0];
    if (octal) {
      bytes.push(parseInt(octal, 8) & 0xff);
      i += octal.length;
      continue;
    }
    const escaped = C_ESCAPES[inner.charAt(i + 1)];
    if (escaped !== undefined) {
      bytes.push(escaped);
      i += 1;
      continue;
    }
    bytes.push(0x5c);
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * The added lines of a unified diff with their new-file line numbers. Inside a hunk the
 * header counts say how many lines belong to it, so an added line whose text happens to
 * start with `++ ` or `-- ` is content, never a file header that would re-attribute the
 * lines after it to another path.
 */
export function addedLines(diff: string): AddedLine[] {
  const out: AddedLine[] = [];
  let file = "";
  let next = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of diff.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (raw.startsWith("+")) {
        out.push({ file, line: next, text: raw.slice(1) });
        next += 1;
        newLeft -= 1;
      } else if (raw.startsWith("-")) {
        oldLeft -= 1;
      } else if (!raw.startsWith("\\")) {
        next += 1;
        oldLeft -= 1;
        newLeft -= 1;
      }
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const name = raw.slice(4);
      file = (name.startsWith('"') ? cUnquote(name) : name.replace(/\t.*$/, "")).replace(
        /^b\//,
        "",
      );
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      next = Number(hunk[2]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    }
  }
  return out;
}

export function scanChecks(lines: readonly AddedLine[], rules: readonly CheckRule[]): CheckHit[] {
  const hits: CheckHit[] = [];
  for (const rule of rules) {
    const re = new RegExp(rule.pattern);
    const only = rule.path_pattern ? new RegExp(rule.path_pattern) : null;
    const skip = rule.exclude_pattern ? new RegExp(rule.exclude_pattern) : null;
    for (const l of lines) {
      if (only && !only.test(l.file)) continue;
      if (skip?.test(l.file)) continue;
      if (re.test(l.text)) {
        hits.push({
          id: rule.id,
          file: l.file,
          line: l.line,
          text: l.text.trim(),
          message: rule.message,
          severity: rule.severity ?? "major",
          category: rule.category ?? "convention",
        });
      }
    }
  }
  return hits;
}

export function undeclaredFiles(
  changed: readonly string[],
  declared: readonly string[],
  exemptPattern: string | null,
): string[] {
  const known = new Set(declared);
  const exempt = exemptPattern ? new RegExp(exemptPattern) : null;
  return [...new Set(changed)].filter((f) => !known.has(f) && !exempt?.test(f));
}

/**
 * The protected-path regexes, case-insensitive like the boundary hook that enforces the same
 * list (the default macOS volume is). An empty list, a non-string or a pattern that does
 * not compile throws: a gate that quietly protects nothing is the failure to rule out.
 */
export function compileProtected(patterns: readonly string[]): RegExp[] {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error("protectedPatterns must be a non-empty array of regex strings");
  }
  return patterns.map((source: unknown) => {
    if (typeof source !== "string") throw new Error("protectedPatterns must hold only strings");
    return new RegExp(source, "i");
  });
}

/** The changed paths that match a protected-path regex source, each listed once. */
export function protectedChanges(
  changed: readonly string[],
  patterns: readonly string[],
): string[] {
  const res = compileProtected(patterns);
  return [...new Set(changed)].filter((f) => res.some((re) => re.test(f)));
}

export const sha256Bytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const sha256File = (path: string) => sha256Bytes(readFileSync(path));

export function checkSealed(
  worktree: string,
  sealed: readonly SealedFile[],
): { path: string; ok: boolean }[] {
  return sealed.map((s) => {
    try {
      return { path: s.path, ok: sha256File(join(worktree, s.path)) === s.sha256 };
    } catch {
      return { path: s.path, ok: false };
    }
  });
}

const fingerprint = (abs: string): string => {
  try {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) return `link:${readlinkSync(abs)}`;
    if (st.isDirectory()) return "dir";
    return sha256File(abs);
  } catch {
    return "missing";
  }
};

const nul = (s: string) => s.split("\0").filter(Boolean);

type IsolatedGit = {
  text: (...args: string[]) => string;
  bytes: (...args: string[]) => Buffer;
};

/**
 * Git pinned to one repository: `GIT_DIR` and `GIT_WORK_TREE` are passed explicitly and every
 * other `GIT_*` variable is dropped, so neither the worktree's `.git` pointer (which a child
 * can rewrite) nor an inherited `GIT_INDEX_FILE` decides which repository is judged.
 */
function isolatedGit(worktree: string, gitDir: string): IsolatedGit {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_") || key === "GIT_EXEC_PATH") env[key] = value;
  }
  env.GIT_DIR = gitDir;
  env.GIT_WORK_TREE = worktree;
  const run = (args: string[]) =>
    execFileSync("git", ["-c", "core.quotePath=false", "-c", "core.fsmonitor=false", ...args], {
      cwd: worktree,
      env,
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });
  return { text: (...args) => run(args).toString("utf8"), bytes: (...args) => run(args) };
}

/**
 * Hash every protected file, tracked or not and ignored or not, so a protected file hidden by
 * a self-ignoring `.gitignore`, or one in an ignored directory such as husky's `.husky/_`,
 * still shows up when its content changes. The engine takes a baseline before a writing child
 * runs and the gate compares against it. A symlink is `link:<target>`, a path git lists that
 * is gone from disk is `missing`.
 */
export function snapshotProtected(
  worktree: string,
  gitDir: string,
  patterns: readonly string[],
): ProtectedSnapshot {
  const res = compileProtected(patterns);
  const git = isolatedGit(worktree, gitDir);
  const names = new Set<string>();
  for (const args of [
    ["ls-files", "-z", "--cached"],
    ["ls-files", "-z", "--others", "--exclude-standard"],
    ["ls-files", "-z", "--others", "--ignored", "--exclude-standard"],
  ]) {
    for (const name of nul(git.text(...args))) names.add(name);
  }
  const out: ProtectedSnapshot = {};
  for (const name of [...names].sort()) {
    if (res.some((re) => re.test(name))) out[name] = fingerprint(join(worktree, name));
  }
  return out;
}

/** The sorted paths whose fingerprint differs between two snapshots, or exist in only one. */
export function diffProtected(a: ProtectedSnapshot, b: ProtectedSnapshot): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}

/**
 * Paths whose parsed added-line count disagrees with `git diff --numstat -z` for the same
 * range. The check scan reads a patch; if anything reshapes the patch into fewer lines than
 * git counted, the scan is blind there and the gate must say so rather than pass. A path
 * numstat reports as binary (`-`, which `--text` does not override: a `-diff` attribute, as
 * lockfiles often carry, is enough) has no count to compare and is left out.
 */
export function addedLineMismatches(lines: readonly AddedLine[], numstat: string): string[] {
  const parsed = new Map<string, number>();
  for (const l of lines) parsed.set(l.file, (parsed.get(l.file) ?? 0) + 1);
  const counted = new Map<string, number>();
  const binary = new Set<string>();
  for (const record of nul(numstat)) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record);
    if (m?.[3] === undefined) continue;
    if (m[1] === "-") binary.add(m[3]);
    else counted.set(m[3], Number(m[1]));
  }
  const paths = new Set([...parsed.keys(), ...counted.keys()]);
  return [...paths]
    .filter((f) => !binary.has(f) && (parsed.get(f) ?? 0) !== (counted.get(f) ?? 0))
    .sort();
}

export function buildReport(parts: Omit<GateReport, "passed">): GateReport {
  const passed =
    parts.gates.every((g) => g.result !== "fail") &&
    parts.undeclared.length === 0 &&
    parts.protected.length === 0 &&
    parts.checks.every((c) => c.severity === "minor") &&
    parts.sealed.every((s) => s.ok) &&
    parts.blockers.length === 0;
  return { ...parts, passed };
}

export function reportFindings(r: GateReport): Finding[] {
  const out: Finding[] = [];
  for (const g of r.gates) {
    if (g.result === "fail") {
      out.push({
        id: `G-${g.name}`,
        severity: "blocker",
        category: "gate",
        claim: `${g.name} fails`,
        evidence: g.tail,
        expected: `${g.name} passes`,
      });
    }
    if (g.result === "flaky") {
      out.push({
        id: `G-${g.name}-flaky`,
        severity: "minor",
        category: "gate",
        claim: `${g.name} failed once and passed on re-run`,
        evidence: g.tail,
        expected: "deterministic pass",
      });
    }
  }
  r.undeclared.forEach((f, i) =>
    out.push({
      id: `S-${i + 1}`,
      severity: "major",
      category: "scope",
      file: f,
      claim: `${f} changed outside the spec contract`,
      evidence: "git diff --name-only",
      expected: "only contract files and sealed tests change",
    }),
  );
  r.protected.forEach((f, i) => {
    const sources = r.protectedSources[f] ?? ["committed diff"];
    const duringGates = sources.every((source) => source === "post-gate snapshot");
    out.push({
      id: `P-${i + 1}`,
      severity: "blocker",
      category: "scope",
      file: f,
      claim: duringGates ? `protected path ${f} changed during gates` : `${f} is a protected path`,
      evidence: sources.join(", "),
      expected: `no changes to protected paths (patterns: ${r.protectedPatterns.join(", ")})`,
    });
  });
  r.checks.forEach((c, i) =>
    out.push({
      id: `C-${c.id}-${i + 1}`,
      severity: c.severity,
      category: c.category,
      file: c.file,
      line: c.line,
      claim: c.message,
      evidence: c.text,
      expected: `no match for check ${c.id}`,
    }),
  );
  for (const s of r.sealed) {
    if (!s.ok) {
      out.push({
        id: `T-${s.path}`,
        severity: "blocker",
        category: "test-quality",
        file: s.path,
        claim: "sealed acceptance test was modified or removed",
        evidence: "sha256 mismatch",
        expected: "sealed tests unchanged; dispute them through needs_input",
      });
    }
  }
  r.blockers.forEach((b, i) =>
    out.push({
      id: `B-${i + 1}`,
      severity: "blocker",
      category: b.category,
      ...(b.file === undefined ? {} : { file: b.file }),
      claim: b.claim,
      evidence: b.evidence,
      expected: b.expected,
    }),
  );
  return out;
}

/** What the engine resolved a criterion's oracle to; a null command is a blocker. */
export interface OracleInput {
  criterion: string;
  command: string | null;
  reason: string | null;
}

export interface GateStageOptions {
  /** Absolute path of the run worktree. */
  worktree: string;
  /** The commit the run branched from, a 40-hex SHA the engine recorded; `origin/<base>` is never read. */
  baseSha: string;
  /** Absolute path of the worktree's private git dir, recorded at worktree creation. */
  gitDir: string;
  gates: readonly GateCommand[];
  oracles: readonly OracleInput[];
  contractFiles: readonly string[];
  sealed: readonly SealedFile[];
  checks: readonly CheckRule[];
  exemptPattern: string | null;
  protectedPatterns: readonly string[];
  /** `snapshotProtected` as it stood before the child ran. */
  protectedBaseline: ProtectedSnapshot;
  run: Runner;
  timeoutMs: number;
}

const MAX_UNCOMMITTED_FINDINGS = 100;

const PATCH_FLAGS = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--text",
  "--no-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

function validateOptions(o: GateStageOptions): void {
  if (!/^[0-9a-f]{40}$/.test(o.baseSha)) throw new Error("baseSha must be a 40-hex commit SHA");
  if (!isAbsolute(o.gitDir)) throw new Error("gitDir must be an absolute path");
  if (!isAbsolute(o.worktree)) throw new Error("worktree must be an absolute path");
  compileProtected(o.protectedPatterns);
  const baseline: unknown = o.protectedBaseline;
  if (
    typeof baseline !== "object" ||
    baseline === null ||
    Array.isArray(baseline) ||
    Object.values(baseline).some((v) => typeof v !== "string")
  ) {
    throw new Error("protectedBaseline must be a snapshotProtected record");
  }
}

/** Why the worktree's `.git` is not the pointer the engine recorded, or null if it is. */
function pointerProblem(worktree: string, gitDir: string): string | null {
  try {
    const dotGit = join(worktree, ".git");
    if (!lstatSync(dotGit).isFile()) return ".git is not a file";
    const target = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(readFileSync(dotGit, "utf8"))?.[1];
    if (target === undefined) return ".git holds no gitdir line";
    return realpathSync(resolve(worktree, target)) === realpathSync(gitDir)
      ? null
      : `.git points at ${target}`;
  } catch (error) {
    return `.git cannot be read (${error instanceof Error ? error.message : String(error)})`;
  }
}

export function runGateStage(o: GateStageOptions): GateReport {
  validateOptions(o);
  const git = isolatedGit(o.worktree, o.gitDir);
  const blockers: GateBlocker[] = [];
  const protectedRes = compileProtected(o.protectedPatterns);
  const exempt = o.exemptPattern ? new RegExp(o.exemptPattern) : null;
  const sealedPaths = new Set(o.sealed.map((s) => s.path));
  const tolerated = (path: string) =>
    exempt !== null &&
    exempt.test(path) &&
    !sealedPaths.has(path) &&
    !protectedRes.some((re) => re.test(path));

  const headSha = git.text("rev-parse", "--verify", "HEAD^{commit}").trim();
  git.text("cat-file", "-e", `${o.baseSha}^{commit}`);
  const range = `${o.baseSha}...${headSha}`;

  const pointerBefore = pointerProblem(o.worktree, o.gitDir);
  if (pointerBefore !== null) {
    blockers.push({
      category: "scope",
      claim: "worktree .git pointer was changed",
      file: ".git",
      evidence: pointerBefore,
      expected: "the worktree's .git points at the git dir recorded when the run started",
    });
  }

  const status = (untracked: "all" | "no") =>
    nul(
      git.text("status", "--porcelain=v1", "-z", `--untracked-files=${untracked}`, "--no-renames"),
    ).map((record) => ({ xy: record.slice(0, 2), path: record.slice(3) }));
  const dirtyBefore = status("all");
  const untolerated = dirtyBefore.filter((e) => !tolerated(e.path));
  for (const e of untolerated.slice(0, MAX_UNCOMMITTED_FINDINGS)) {
    blockers.push({
      category: "scope",
      claim: `uncommitted work: ${e.path}`,
      file: e.path,
      evidence: `git status --porcelain (${e.xy.trim() || "?"})`,
      expected: "everything the run produced is committed; the gate judges the committed HEAD",
    });
  }
  if (untolerated.length > MAX_UNCOMMITTED_FINDINGS) {
    blockers.push({
      category: "scope",
      claim: `uncommitted work: ${untolerated.length - MAX_UNCOMMITTED_FINDINGS} more paths`,
      evidence: "git status --porcelain",
      expected: "everything the run produced is committed; the gate judges the committed HEAD",
    });
  }

  const changed = nul(git.text("diff", "--name-only", "-z", "--no-renames", range));
  const sources = new Map<string, ProtectedSource[]>();
  const flag = (path: string, source: ProtectedSource) => {
    sources.set(path, [...(sources.get(path) ?? []), source]);
  };
  for (const path of protectedChanges(changed, o.protectedPatterns)) flag(path, "committed diff");
  const protectedBefore = snapshotProtected(o.worktree, o.gitDir, o.protectedPatterns);
  for (const path of diffProtected(o.protectedBaseline, protectedBefore)) {
    flag(path, "protected snapshot");
  }

  const patch = git.text("diff", "--unified=0", ...PATCH_FLAGS, range);
  const added = addedLines(patch);
  const numstat = git.text("diff", "--numstat", "-z", "--text", "--no-renames", range);
  for (const path of addedLineMismatches(added, numstat)) {
    blockers.push({
      category: "gate",
      claim: `check diff could not be parsed for ${path}`,
      file: path,
      evidence: "added lines read from the patch differ from git diff --numstat",
      expected: "the scan for leftover constructs sees every added line",
    });
  }

  const sealedBefore = o.sealed.map((s) => {
    try {
      return {
        path: s.path,
        ok: sha256Bytes(git.bytes("cat-file", "blob", `${headSha}:${s.path}`)) === s.sha256,
      };
    } catch {
      return { path: s.path, ok: false };
    }
  });

  const runnable = o.oracles.flatMap((x) =>
    x.command === null ? [] : [{ criterion: x.criterion, command: x.command }],
  );
  for (const x of o.oracles) {
    if (x.command !== null) continue;
    blockers.push({
      category: "gate",
      claim: `criterion ${x.criterion} has no runnable oracle: ${x.reason ?? "unresolved"}`,
      evidence: "spec-contract oracle resolution",
      expected: "every criterion that is not prose-review resolves to a command",
    });
  }
  const gates = runGates(
    [
      ...o.gates,
      ...runnable.map((x) => ({
        name: `oracle:${x.criterion}`,
        command: x.command,
        retry: false,
      })),
    ],
    o.worktree,
    o.run,
    o.timeoutMs,
  );

  const headAfter = git.text("rev-parse", "--verify", "HEAD^{commit}").trim();
  if (headAfter !== headSha) {
    blockers.push({
      category: "scope",
      claim: "HEAD moved during gates",
      evidence: `${headSha} -> ${headAfter}`,
      expected: "the gates leave the committed HEAD alone",
    });
  }
  const seenBefore = new Set(dirtyBefore.map((e) => `${e.xy}\0${e.path}`));
  for (const e of status("no")) {
    if (seenBefore.has(`${e.xy}\0${e.path}`) || tolerated(e.path)) continue;
    blockers.push({
      category: "scope",
      claim: `gates modified tracked file ${e.path}`,
      file: e.path,
      evidence: `git status --porcelain (${e.xy.trim() || "?"})`,
      expected: "the gates may create untracked artefacts but not touch tracked files",
    });
  }
  const pointerAfter = pointerProblem(o.worktree, o.gitDir);
  if (pointerBefore === null && pointerAfter !== null) {
    blockers.push({
      category: "scope",
      claim: "worktree .git pointer was changed during gates",
      file: ".git",
      evidence: pointerAfter,
      expected: "the worktree's .git points at the git dir recorded when the run started",
    });
  }
  const sealedAfter = checkSealed(o.worktree, o.sealed);
  const sealed = sealedBefore.map((before, i) => {
    const after = sealedAfter[i];
    if (before.ok && after !== undefined && !after.ok) {
      blockers.push({
        category: "scope",
        claim: `sealed file ${before.path} changed during gates`,
        file: before.path,
        evidence: "sha256 differs from the sealed value after the gates ran",
        expected: "sealed tests unchanged by the gates",
      });
    }
    return { path: before.path, ok: before.ok && after?.ok === true };
  });
  const protectedAfter = snapshotProtected(o.worktree, o.gitDir, o.protectedPatterns);
  for (const path of diffProtected(protectedBefore, protectedAfter))
    flag(path, "post-gate snapshot");

  const protectedPaths = [...sources.keys()].sort();
  return buildReport({
    gates,
    undeclared: undeclaredFiles(
      changed,
      [...o.contractFiles, ...o.sealed.map((s) => s.path)],
      o.exemptPattern,
    ),
    protected: protectedPaths,
    protectedSources: Object.fromEntries(sources),
    protectedPatterns: [...o.protectedPatterns],
    checks: scanChecks(added, o.checks),
    sealed,
    blockers,
  });
}
