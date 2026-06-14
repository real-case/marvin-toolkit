import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { ServerEnv } from "../lib/env.js";

/**
 * Deterministic quality-gate runner (ADR-0004). Runs the project's
 * independent gates — test, lint, type-check, build — concurrently and
 * reduces them to a single verdict at one merge point, then writes
 * `verification.md`. The determinism guarantees (every gate runs to
 * completion, no decision on partial results, verdict parity between
 * parallel and sequential) are properties of `Promise.allSettled` + a
 * single reducer here — not of model discipline in a prompt.
 */

const GATE_NAMES = ["test", "lint", "typecheck", "build"] as const;
type GateName = (typeof GATE_NAMES)[number];

/** A single gate: a label and the shell command that runs it. */
interface GateSpec {
  name: GateName;
  command: string;
}

type GateStatus = "pass" | "fail" | "error";

interface GateResult {
  name: GateName;
  command: string;
  status: GateStatus;
  code: number | null;
  durationMs: number;
  summary: string;
  details: string;
}

type Verdict = "PASS" | "FAIL" | "PASS WITH WARNINGS";

/** Stack → gate commands. Single source of truth (was duplicated in
 * `task-verify/SKILL.md` and `marvin-tm-executor.md`). Five stacks, matching
 * the prior tables exactly — no behaviour change. */
const STACK_TABLE: Record<string, { marker: string; gates: Partial<Record<GateName, string>> }> = {
  "go.mod": {
    marker: "Go",
    gates: { test: "go test ./...", lint: "golangci-lint run", build: "go build ./..." },
  },
  "pyproject.toml": {
    marker: "Python",
    gates: { test: "pytest", lint: "ruff check .", typecheck: "mypy ." },
  },
  "tsconfig.json": {
    marker: "TypeScript",
    gates: {
      test: "npm test",
      lint: "npx eslint .",
      typecheck: "npx tsc --noEmit",
      build: "npm run build",
    },
  },
  "Cargo.toml": {
    marker: "Rust",
    gates: { test: "cargo test", lint: "cargo clippy", build: "cargo build" },
  },
  "pom.xml": {
    marker: "Java",
    gates: { test: "mvn test", build: "mvn package" },
  },
};

const VerifyInput = z.object({
  mode: z
    .enum(["feature", "bug", "standalone"])
    .default("standalone")
    .describe("Pipeline mode. feature: warn if no new tests. bug: warn if no regression test."),
  execution: z
    .enum(["parallel", "sequential", "fail-fast"])
    .default("parallel")
    .describe(
      "parallel: all gates concurrently (default). sequential: one at a time, all run (verdict parity with parallel). fail-fast: one at a time, stop at first failure (resource-constrained / fast feedback).",
    ),
  only: z
    .array(z.enum(GATE_NAMES))
    .optional()
    .describe("Run only these gates (targeted retry, e.g. ['test'] to re-confirm a fix)."),
  stack: z
    .string()
    .optional()
    .describe("Pre-detected stack key (e.g. 'tsconfig.json') to skip detection in a chained run."),
  gates: z
    .array(z.object({ name: z.enum(GATE_NAMES), command: z.string().min(1) }))
    .optional()
    .describe("Explicit gate commands, bypassing stack detection (project override / testing)."),
  projectRoot: z
    .string()
    .optional()
    .describe("Project root. Defaults to CLAUDE_PROJECT_DIR / cwd."),
  write: z
    .boolean()
    .default(true)
    .describe("Write verification.md to <projectRoot>/.taskmaster/current-task/."),
  dryRun: z
    .boolean()
    .default(false)
    .describe("Report the detected gate plan without executing anything."),
});
type VerifyInput = z.infer<typeof VerifyInput>;

export function buildVerifyTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "verify",
    description:
      "Run project quality gates (test/lint/type-check/build) concurrently with stack auto-detection, reduce to one verdict at a single merge point, and write verification.md. Use for /marvin:task-verify and as the executor's self-test.",
    inputSchema: VerifyInput,
    handler: (input) => runVerify(input, env),
  });
}

async function runVerify(input: VerifyInput, env: ServerEnv): Promise<ToolResult> {
  const projectRoot = input.projectRoot ?? env.projectDir;

  // Resolve the gate plan: explicit override > stack hint > detection.
  const detected = resolvePlan(input, projectRoot);
  if (detected.gates.length === 0) {
    return ok(
      `No quality gates detected for \`${projectRoot}\`.\n` +
        `Looked for a known stack (go.mod, pyproject.toml, tsconfig.json, Cargo.toml, pom.xml), ` +
        `then for declared commands (package.json scripts, Makefile targets) — found none. ` +
        `Pass an explicit \`gates\` list (e.g. from the spec's \`test_command\`) to verify this project.`,
    );
  }

  let gates = detected.gates;
  if (input.only) gates = gates.filter((g) => input.only!.includes(g.name));
  if (gates.length === 0) {
    return ok(`None of the requested gates (\`only\`) matched the detected plan.`);
  }

  if (input.dryRun) {
    const plan = gates.map((g) => `- **${g.name}**: \`${g.command}\``).join("\n");
    return ok(
      `# Verify Plan (dry run)\n\n**Stacks:** ${detected.stacks.join(", ") || "explicit"}\n**Execution:** ${input.execution}\n\n${plan}`,
    );
  }

  // Run gates and merge.
  const wallStart = performance.now();
  const results = await executeGates(gates, input.execution, projectRoot);
  const wallClockMs = Math.round(performance.now() - wallStart);
  const sumOfGatesMs = results.reduce((acc, r) => acc + r.durationMs, 0);

  const warnings = modeWarnings(input.mode, projectRoot);
  const verdict = computeVerdict(results, warnings);

  const markdown = renderMarkdown({
    verdict,
    mode: input.mode,
    execution: input.execution,
    results,
    warnings,
    stacks: detected.stacks,
    wallClockMs,
    sumOfGatesMs,
  });

  let artifactPath: string | null = null;
  if (input.write) {
    artifactPath = join(projectRoot, ".taskmaster", "current-task", "verification.md");
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, markdown, "utf8");
  }

  // Embed a machine-readable block so callers/tests can parse the result
  // without scraping prose. The model reads the markdown above it.
  const machine = JSON.stringify({
    verdict,
    gates: results.map((r) => ({
      name: r.name,
      status: r.status,
      code: r.code,
      durationMs: r.durationMs,
    })),
    detectedStacks: detected.stacks,
    warnings,
    wallClockMs,
    sumOfGatesMs,
    artifactPath,
  });

  return {
    content: [
      { type: "text", text: `${markdown}\n\n\`\`\`json verify-result\n${machine}\n\`\`\`` },
    ],
    isError: verdict === "FAIL",
  };
}

/** Resolve which gates to run: explicit override, then stack hint, then detection. */
function resolvePlan(
  input: VerifyInput,
  projectRoot: string,
): { stacks: string[]; gates: GateSpec[] } {
  if (input.gates && input.gates.length > 0) {
    return { stacks: ["explicit"], gates: input.gates };
  }
  const keys =
    input.stack && STACK_TABLE[input.stack]
      ? [input.stack]
      : Object.keys(STACK_TABLE).filter((file) => existsSync(join(projectRoot, file)));

  if (keys.length === 0) {
    // No tabled stack matched. Rather than leave an untabled ecosystem (PHP, Ruby,
    // .NET, Elixir, Swift, Dart, …) silently unverified, fall back to the commands
    // the project declares itself — npm scripts, then Makefile targets. A declared
    // command beats a guessed ecosystem default: the project knows how it is built.
    return detectGeneric(projectRoot);
  }

  const stacks: string[] = [];
  const gates: GateSpec[] = [];
  for (const key of keys) {
    const entry = STACK_TABLE[key];
    if (!entry) continue;
    stacks.push(entry.marker);
    for (const name of GATE_NAMES) {
      const command = entry.gates[name];
      if (command) gates.push({ name, command });
    }
  }
  return { stacks, gates };
}

/** Gate name → the declared script/target names that satisfy it, in priority order. */
const DECLARED_GATE_ALIASES: Array<[GateName, string[]]> = [
  ["test", ["test"]],
  ["lint", ["lint"]],
  ["typecheck", ["typecheck", "type-check", "tsc"]],
  ["build", ["build"]],
];

/**
 * Evidence-based fallback for ecosystems outside STACK_TABLE: build the gate set
 * from the commands the project declares itself (npm scripts, then Makefile
 * targets). Returns no gates when the project declares none — an unknown stack is
 * surfaced to the caller, never papered over with a guessed command.
 */
function detectGeneric(projectRoot: string): { stacks: string[]; gates: GateSpec[] } {
  const npm = detectNpmScripts(projectRoot);
  if (npm.gates.length) return npm;
  const make = detectMakefile(projectRoot);
  if (make.gates.length) return make;
  return { stacks: [], gates: [] };
}

/** Map a project's npm `scripts` to gates: `npm run <name>` per declared gate. */
function detectNpmScripts(projectRoot: string): { stacks: string[]; gates: GateSpec[] } {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return { stacks: [], gates: [] };
  let scripts: Record<string, unknown> = {};
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, unknown> };
    scripts = pkg.scripts ?? {};
  } catch {
    return { stacks: [], gates: [] };
  }
  const gates: GateSpec[] = [];
  for (const [gate, aliases] of DECLARED_GATE_ALIASES) {
    const name = aliases.find(
      (a) => typeof scripts[a] === "string" && (scripts[a] as string).trim(),
    );
    if (name) gates.push({ name: gate, command: `npm run ${name}` });
  }
  return gates.length ? { stacks: ["package.json scripts"], gates } : { stacks: [], gates: [] };
}

/** Map a project's Makefile targets to gates: `make <target>` per declared gate. */
function detectMakefile(projectRoot: string): { stacks: string[]; gates: GateSpec[] } {
  const mkPath = join(projectRoot, "Makefile");
  if (!existsSync(mkPath)) return { stacks: [], gates: [] };
  let text: string;
  try {
    text = readFileSync(mkPath, "utf8");
  } catch {
    return { stacks: [], gates: [] };
  }
  // A real target is a name at line start followed by ':' — but not ':=' (which
  // is a variable assignment, not a rule).
  const targets = new Set(
    [...text.matchAll(/^([A-Za-z][A-Za-z0-9_-]*):(?!=)/gm)].map((m) => m[1]!.toLowerCase()),
  );
  const gates: GateSpec[] = [];
  for (const [gate, aliases] of DECLARED_GATE_ALIASES) {
    const name = aliases.find((a) => targets.has(a));
    if (name) gates.push({ name: gate, command: `make ${name}` });
  }
  return gates.length ? { stacks: ["Makefile"], gates } : { stacks: [], gates: [] };
}

/**
 * Run the gate set. The merge point is the single `await` here: no verdict is
 * computed until every branch has settled (parallel/sequential) or fail-fast
 * has stopped. A gate that crashes becomes its own `error` result — never a
 * loss of sibling results (R-V-3 / F-1).
 */
async function executeGates(
  gates: GateSpec[],
  execution: VerifyInput["execution"],
  cwd: string,
): Promise<GateResult[]> {
  if (execution === "parallel") {
    const settled = await Promise.allSettled(gates.map((g) => runGate(g, cwd)));
    return settled.map((s, i) =>
      s.status === "fulfilled" ? s.value : crashResult(gates[i]!, s.reason),
    );
  }

  // sequential / fail-fast: one at a time.
  const results: GateResult[] = [];
  for (const g of gates) {
    let r: GateResult;
    try {
      r = await runGate(g, cwd);
    } catch (err) {
      r = crashResult(g, err);
    }
    results.push(r);
    if (execution === "fail-fast" && r.status !== "pass") break;
  }
  return results;
}

/** Spawn one gate command via the shell, capturing output and exit code. */
function runGate(gate: GateSpec, cwd: string): Promise<GateResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn(gate.command, { cwd, shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      resolve(crashResult(gate, err, Math.round(performance.now() - start)));
    });
    child.on("close", (code, signal) => {
      const durationMs = Math.round(performance.now() - start);
      // code === null means the process was terminated by a signal (e.g. a
      // timeout SIGKILL) — that is an execution error, not a clean gate failure.
      const status: GateStatus = code === 0 ? "pass" : code === null ? "error" : "fail";
      const tail = (stderr || stdout).trim().split("\n").slice(-12).join("\n");
      const summary =
        status === "pass"
          ? "passed"
          : status === "error"
            ? `terminated (${signal})`
            : `exit ${code}`;
      resolve({
        name: gate.name,
        command: gate.command,
        status,
        code,
        durationMs,
        summary,
        details: tail,
      });
    });
  });
}

function crashResult(gate: GateSpec, reason: unknown, durationMs = 0): GateResult {
  return {
    name: gate.name,
    command: gate.command,
    status: "error",
    code: null,
    durationMs,
    summary: "failed to run",
    details: reason instanceof Error ? reason.message : String(reason),
  };
}

/** Feature/bug mode checks. Best-effort; skipped when not a git repo. */
function modeWarnings(mode: VerifyInput["mode"], cwd: string): string[] {
  if (mode === "standalone") return [];
  const changed = changedFiles(cwd);
  if (changed === null) return []; // not a git repo — nothing to assert
  const hasTestChange = changed.some(
    (f) => /(^|\/)(test|tests|spec|specs)\//i.test(f) || /[._-](test|spec)\./i.test(f),
  );
  if (!hasTestChange) {
    return mode === "feature"
      ? ["No new or modified test files detected — a feature should add tests."]
      : ["No regression test detected — a bugfix should add a test reproducing the bug."];
  }
  return [];
}

function changedFiles(cwd: string): string[] | null {
  try {
    // Tracked changes vs HEAD (staged + unstaged) ...
    const diff = spawnSync("git", ["diff", "--name-only", "HEAD"], { cwd, encoding: "utf8" });
    if (diff.status !== 0) return null;
    // ... plus brand-new untracked files (a fresh test file is often untracked).
    const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd,
      encoding: "utf8",
    });
    const lines = `${diff.stdout || ""}\n${untracked.status === 0 ? untracked.stdout || "" : ""}`;
    return lines
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

/** Reduce all gate results + warnings to one verdict — the single decision point. */
function computeVerdict(results: GateResult[], warnings: string[]): Verdict {
  if (results.some((r) => r.status !== "pass")) return "FAIL";
  if (warnings.length > 0) return "PASS WITH WARNINGS";
  return "PASS";
}

function renderMarkdown(o: {
  verdict: Verdict;
  mode: VerifyInput["mode"];
  execution: VerifyInput["execution"];
  results: GateResult[];
  warnings: string[];
  stacks: string[];
  wallClockMs: number;
  sumOfGatesMs: number;
}): string {
  // Render every result for a gate name — a monorepo may detect the same gate
  // (e.g. "test") for more than one stack; the verdict already counts them all.
  const section = (title: string, n: GateName) => {
    const rs = o.results.filter((r) => r.name === n);
    if (rs.length === 0)
      return `## ${title} Results\n- **Status:** N/A — not configured for this stack`;
    const body = rs
      .map((r) => {
        const head = `- **Command:** \`${r.command}\`\n- **Status:** ${r.status} (${r.summary}, ${r.durationMs}ms)`;
        return r.status === "pass" || !r.details
          ? head
          : `${head}\n- **Details:**\n\n\`\`\`\n${r.details}\n\`\`\``;
      })
      .join("\n");
    return `## ${title} Results\n${body}`;
  };

  return [
    `# Verification Report`,
    ``,
    `**Pipeline:** ${o.mode}`,
    `**Execution:** ${o.execution} (wall-clock ${o.wallClockMs}ms vs sum-of-gates ${o.sumOfGatesMs}ms)`,
    `**Stacks:** ${o.stacks.join(", ") || "explicit"}`,
    `**Verdict:** ${o.verdict}`,
    ``,
    section("Test", "test"),
    ``,
    section("Lint", "lint"),
    ``,
    section("Type-check", "typecheck"),
    ``,
    section("Build", "build"),
    ``,
    `## Warnings`,
    o.warnings.length ? o.warnings.map((w) => `- ${w}`).join("\n") : "- none",
    ``,
  ].join("\n");
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}
