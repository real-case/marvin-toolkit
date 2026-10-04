import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
export interface GateReport {
  passed: boolean;
  gates: GateResult[];
  undeclared: string[];
  protected: string[];
  checks: CheckHit[];
  sealed: { path: string; ok: boolean }[];
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
 * The changed paths that match a protected-path regex source. Case-insensitive, like the
 * boundary hook that enforces the same list, because the default macOS volume is.
 */
export function protectedChanges(
  changed: readonly string[],
  patterns: readonly string[],
): string[] {
  const res = patterns.map((source) => new RegExp(source, "i"));
  return [...new Set(changed)].filter((f) => res.some((re) => re.test(f)));
}

export const sha256File = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

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

export function buildReport(parts: Omit<GateReport, "passed">): GateReport {
  const passed =
    parts.gates.every((g) => g.result !== "fail") &&
    parts.undeclared.length === 0 &&
    parts.protected.length === 0 &&
    parts.checks.every((c) => c.severity === "minor") &&
    parts.sealed.every((s) => s.ok);
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
  r.protected.forEach((f, i) =>
    out.push({
      id: `P-${i + 1}`,
      severity: "blocker",
      category: "scope",
      file: f,
      claim: `${f} is a protected path`,
      evidence: "git diff --name-only",
      expected:
        "protected paths (marvin config, Claude settings and hooks, husky, .mcp.json, .git) unchanged",
    }),
  );
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
  return out;
}

export function runGateStage(o: {
  worktree: string;
  base: string;
  gates: readonly GateCommand[];
  oracles: readonly { criterion: string; command: string }[];
  contractFiles: readonly string[];
  sealed: readonly SealedFile[];
  checks: readonly CheckRule[];
  exemptPattern: string | null;
  protectedPatterns: readonly string[];
  run: Runner;
  timeoutMs: number;
}): GateReport {
  const git = (...a: string[]) =>
    execFileSync("git", ["-c", "core.quotePath=false", ...a], {
      cwd: o.worktree,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
  const range = `origin/${o.base}...HEAD`;
  const changed = [
    ...git("diff", "--name-only", "-z", range).split("\0"),
    ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
  ].filter(Boolean);
  return buildReport({
    gates: runGates(
      [
        ...o.gates,
        ...o.oracles.map((x) => ({
          name: `oracle:${x.criterion}`,
          command: x.command,
          retry: false,
        })),
      ],
      o.worktree,
      o.run,
      o.timeoutMs,
    ),
    undeclared: undeclaredFiles(
      changed,
      [...o.contractFiles, ...o.sealed.map((s) => s.path)],
      o.exemptPattern,
    ),
    protected: protectedChanges(changed, o.protectedPatterns),
    checks: scanChecks(addedLines(git("diff", "--unified=0", range)), o.checks),
    sealed: checkSealed(o.worktree, o.sealed),
  });
}
