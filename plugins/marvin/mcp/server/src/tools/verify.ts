import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { ServerEnv } from "../lib/env.js";
import { loadConfig } from "../storage/config.js";

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

/** True when `root` directly contains any of the named marker files. */
function hasFile(root: string, ...names: string[]): boolean {
  return names.some((n) => existsSync(join(root, n)));
}

/** True when any entry directly under `root` matches `re` (e.g. `*.csproj`). */
function hasFileMatching(root: string, re: RegExp): boolean {
  try {
    return readdirSync(root).some((f) => re.test(f));
  } catch {
    return false;
  }
}

interface StackDetector {
  /** Stable id; also accepted as the `stack` hint to skip detection. */
  id: string;
  /** Human-readable name shown on the report's `Stacks:` line. */
  marker: string;
  /** Does this project use the stack? A root-level marker-file / glob check. */
  detect: (root: string) => boolean;
  gates: Partial<Record<GateName, string>>;
}

/**
 * Built-in stack detectors with canonical gate commands — the zero-config default
 * (single source of truth; was duplicated in `task-verify/SKILL.md` and
 * `marvin-tm-executor.md`). The table is a *convenience*, not authoritative:
 * `.marvin/config.json` `gates` overrides any of these per gate (ADR-0011).
 * Canonical commands are best-effort defaults — a project on a non-standard
 * toolchain (`gotestsum`, `minitest`, a custom lint) pins its own via config.
 * Anything outside this set falls back to the project's declared commands
 * (npm scripts → Makefile targets).
 */
const STACK_DETECTORS: StackDetector[] = [
  {
    id: "go",
    marker: "Go",
    detect: (r) => hasFile(r, "go.mod"),
    gates: { test: "go test ./...", lint: "golangci-lint run", build: "go build ./..." },
  },
  {
    id: "rust",
    marker: "Rust",
    detect: (r) => hasFile(r, "Cargo.toml"),
    gates: { test: "cargo test", lint: "cargo clippy", build: "cargo build" },
  },
  {
    id: "python",
    marker: "Python",
    detect: (r) => hasFile(r, "pyproject.toml", "setup.py", "setup.cfg"),
    gates: { test: "pytest", lint: "ruff check .", typecheck: "mypy ." },
  },
  {
    id: "typescript",
    marker: "TypeScript",
    detect: (r) => hasFile(r, "tsconfig.json"),
    gates: {
      test: "npm test",
      lint: "npx eslint .",
      typecheck: "npx tsc --noEmit",
      build: "npm run build",
    },
  },
  {
    id: "maven",
    marker: "Java (Maven)",
    detect: (r) => hasFile(r, "pom.xml"),
    gates: { test: "mvn test", build: "mvn package" },
  },
  {
    id: "gradle",
    marker: "JVM (Gradle)",
    detect: (r) => hasFile(r, "build.gradle", "build.gradle.kts"),
    gates: { test: "./gradlew test", build: "./gradlew build" },
  },
  {
    id: "dotnet",
    marker: "C#/.NET",
    detect: (r) => hasFileMatching(r, /\.(sln|csproj|fsproj)$/i) || hasFile(r, "global.json"),
    gates: {
      test: "dotnet test",
      lint: "dotnet format --verify-no-changes",
      build: "dotnet build",
    },
  },
  {
    id: "swift",
    marker: "Swift",
    detect: (r) => hasFile(r, "Package.swift"),
    gates: { test: "swift test", build: "swift build" },
  },
  {
    id: "ruby",
    marker: "Ruby",
    detect: (r) => hasFile(r, "Gemfile"),
    gates: { test: "bundle exec rspec", lint: "bundle exec rubocop" },
  },
  {
    id: "php",
    marker: "PHP",
    detect: (r) => hasFile(r, "composer.json"),
    gates: { test: "composer test" },
  },
  {
    id: "cpp",
    marker: "C/C++ (CMake)",
    detect: (r) => hasFile(r, "CMakeLists.txt"),
    // test/lint vary too much across C/C++ to default safely — declare them in
    // `.marvin/config.json`. The build gate configures then builds, so it is
    // self-contained (no dependence on a sibling gate running first).
    gates: { build: "cmake -B build && cmake --build build" },
  },
];

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
    .describe("Pre-detected stack id (e.g. 'go', 'dotnet') to skip detection in a chained run."),
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
    .describe("Write verification.md to <projectRoot>/.marvin/task/."),
  dryRun: z
    .boolean()
    .default(false)
    .describe("Report the detected gate plan without executing anything."),
  action: z
    .enum(["run", "gate"])
    .default("run")
    .describe(
      "run: execute the gates (default). gate: do not run anything — read the existing verification.md and decide whether delivery is allowed (verdict PASS / PASS WITH WARNINGS) or blocked (FAIL / missing). The deterministic delivery gate for /marvin:task-deliver.",
    ),
});
type VerifyInput = z.infer<typeof VerifyInput>;

export function buildVerifyTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "verify",
    description:
      'Run project quality gates (test/lint/type-check/build) concurrently with stack auto-detection, reduce to one verdict at a single merge point, and write verification.md. Use for /marvin:task-verify and as the executor\'s self-test. Pass action: "gate" to instead read the written verdict and decide whether delivery is allowed — the delivery gate for /marvin:task-deliver.',
    inputSchema: VerifyInput,
    handler: (input) => runVerify(input, env),
  });
}

async function runVerify(input: VerifyInput, env: ServerEnv): Promise<ToolResult> {
  const projectRoot = input.projectRoot ?? env.projectDir;

  // Delivery gate: read the prior verification.md verdict, run nothing.
  if (input.action === "gate") return deliverGate(projectRoot);

  // When the caller targets an explicit projectRoot, read that project's config;
  // otherwise honour MARVIN_TASKS_CONFIG via env.configPath.
  const configPath = input.projectRoot
    ? join(input.projectRoot, ".marvin", "config.json")
    : env.configPath;
  const { config, warning: configWarning } = loadConfig(configPath);
  const configGates = gateSpecsFromConfig(config.gates);

  // Resolve the gate plan: explicit per-call gates > config-declared gates > detection.
  const detected = resolvePlan(input, projectRoot, configGates);
  if (detected.gates.length === 0) {
    return ok(
      `No quality gates detected for \`${projectRoot}\`.\n` +
        `Looked for a known stack (${STACK_DETECTORS.map((d) => d.marker).join(", ")}), ` +
        `then for declared commands (package.json scripts, Makefile targets) — found none. ` +
        `Declare them in \`.marvin/config.json\` (\`"gates": { "test": "…" }\`) or pass an explicit ` +
        `\`gates\` list (e.g. from the spec's \`test_command\`) to verify this project.`,
    );
  }

  let gates = detected.gates;
  if (input.only) gates = gates.filter((g) => input.only!.includes(g.name));
  if (gates.length === 0) {
    return ok(`None of the requested gates (\`only\`) matched the detected plan.`);
  }

  if (input.dryRun) {
    const plan = gates.map((g) => `- **${g.name}**: \`${g.command}\``).join("\n");
    const warn = configWarning
      ? `\n\n> ⚠️ \`.marvin/config.json\`: ${configWarning} — using auto-detected gates.`
      : "";
    return ok(
      `# Verify Plan (dry run)\n\n**Stacks:** ${detected.stacks.join(", ") || "explicit"}\n**Execution:** ${input.execution}\n\n${plan}${warn}`,
    );
  }

  // Run gates and merge.
  const wallStart = performance.now();
  const results = await executeGates(gates, input.execution, projectRoot);
  const wallClockMs = Math.round(performance.now() - wallStart);
  const sumOfGatesMs = results.reduce((acc, r) => acc + r.durationMs, 0);

  const warnings = modeWarnings(input.mode, projectRoot);
  if (configWarning) {
    warnings.push(`\`.marvin/config.json\`: ${configWarning} — using auto-detected gates.`);
  }
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
    artifactPath = join(projectRoot, ".marvin", "task", "verification.md");
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

/**
 * Resolve which gates to run, in precedence order:
 *   1. explicit per-call `gates` — wholesale override (testing / programmatic).
 *   2. config-declared gates (`.marvin/config.json`) — per-gate, config wins.
 *   3. auto-detection — stack table, then declared-command fallback.
 * (1) is for the caller that already knows the plan; (2) is the durable,
 * stack-agnostic project declaration (ADR-0011); (3) is the convenience default.
 */
function resolvePlan(
  input: VerifyInput,
  projectRoot: string,
  configGates: GateSpec[],
): { stacks: string[]; gates: GateSpec[] } {
  if (input.gates && input.gates.length > 0) {
    return { stacks: ["explicit"], gates: input.gates };
  }
  const base = detectBase(input, projectRoot);
  if (configGates.length === 0) return base;
  return mergeConfigGates(base, configGates);
}

/**
 * Auto-detect the gate plan from the filesystem: each matched built-in stack's
 * canonical gates, else the commands the project declares itself (npm scripts →
 * Makefile). A polyglot repo that matches several stacks contributes each one's
 * gates (the verdict already counts them all).
 */
function detectBase(
  input: VerifyInput,
  projectRoot: string,
): { stacks: string[]; gates: GateSpec[] } {
  // A `stack` hint names a detector id and skips filesystem detection; an
  // unrecognised hint is ignored and normal detection runs.
  if (input.stack) {
    const hinted = STACK_DETECTORS.find((d) => d.id === input.stack);
    if (hinted) return gatesFromStacks([hinted]);
  }

  const matched = STACK_DETECTORS.filter((d) => d.detect(projectRoot));
  if (matched.length === 0) {
    // No built-in stack matched. Rather than leave an unrecognised ecosystem
    // (Elixir, Dart, Haskell, Scala/sbt, Zig, …) silently unverified, fall back to
    // the commands the project declares itself — npm scripts, then Makefile
    // targets. A declared command beats a guessed default: the project knows how
    // it is built.
    return detectGeneric(projectRoot);
  }
  return gatesFromStacks(matched);
}

/** Flatten matched detectors into a {stacks, gates} plan in canonical gate order. */
function gatesFromStacks(detectors: StackDetector[]): { stacks: string[]; gates: GateSpec[] } {
  const stacks: string[] = [];
  const gates: GateSpec[] = [];
  for (const d of detectors) {
    stacks.push(d.marker);
    for (const name of GATE_NAMES) {
      const command = d.gates[name];
      if (command) gates.push({ name, command });
    }
  }
  return { stacks, gates };
}

/**
 * Overlay config-declared gates onto the detected base, per gate name. A gate
 * set in `.marvin/config.json` replaces every detected gate of that name (the
 * project has declared how it is built); gates absent from config keep their
 * detected command. Output stays in canonical GATE_NAMES order for a
 * deterministic report, and `.marvin/config.json` is appended to the stacks so
 * the report shows config participated.
 */
function mergeConfigGates(
  base: { stacks: string[]; gates: GateSpec[] },
  configGates: GateSpec[],
): { stacks: string[]; gates: GateSpec[] } {
  const gates: GateSpec[] = [];
  for (const name of GATE_NAMES) {
    const override = configGates.find((g) => g.name === name);
    if (override) gates.push(override);
    else gates.push(...base.gates.filter((g) => g.name === name));
  }
  return { stacks: [...base.stacks, ".marvin/config.json"], gates };
}

/** Map the `.marvin/config.json` `gates` object to internal gate specs. */
function gateSpecsFromConfig(gates: Partial<Record<GateName, string>> | undefined): GateSpec[] {
  if (!gates) return [];
  const out: GateSpec[] = [];
  for (const name of GATE_NAMES) {
    const command = gates[name];
    if (command) out.push({ name, command });
  }
  return out;
}

/** Gate name → the declared script/target names that satisfy it, in priority order. */
const DECLARED_GATE_ALIASES: Array<[GateName, string[]]> = [
  ["test", ["test"]],
  ["lint", ["lint"]],
  ["typecheck", ["typecheck", "type-check", "tsc"]],
  ["build", ["build"]],
];

/**
 * Evidence-based fallback for ecosystems outside the built-in detectors: build the gate set
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

/**
 * Delivery gate (the tool-backed half of /marvin:task-deliver's pre-flight).
 * Reads the verdict the verify run already wrote to verification.md — the same
 * machine-readable `verify-result` block this tool emits — and decides ALLOW /
 * BLOCK. Deterministic by construction: write and read share one format, so the
 * delivery decision cannot drift from what verify recorded, and the model never
 * eyeballs a prose verdict.
 */
function deliverGate(projectRoot: string): ToolResult {
  const artifactPath = join(projectRoot, ".marvin", "task", "verification.md");
  if (!existsSync(artifactPath)) {
    return gateResult(
      "BLOCK",
      null,
      "no verification.md found — run /marvin:task-verify before delivering",
    );
  }
  let text: string;
  try {
    text = readFileSync(artifactPath, "utf8");
  } catch (err) {
    return gateResult(
      "BLOCK",
      null,
      `could not read verification.md: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const m = text.match(/```json verify-result\n([\s\S]*?)\n```/);
  if (!m) {
    return gateResult(
      "BLOCK",
      null,
      "verification.md has no machine-readable verify-result block — re-run /marvin:task-verify",
    );
  }
  let verdict: unknown;
  try {
    verdict = (JSON.parse(m[1]!) as { verdict?: unknown }).verdict;
  } catch {
    return gateResult(
      "BLOCK",
      null,
      "verify-result block is not valid JSON — re-run /marvin:task-verify",
    );
  }
  if (verdict === "PASS") return gateResult("ALLOW", "PASS", "verification passed");
  if (verdict === "PASS WITH WARNINGS") {
    return gateResult(
      "ALLOW",
      "PASS WITH WARNINGS",
      "verification passed with warnings — review them before delivering",
    );
  }
  if (verdict === "FAIL") {
    return gateResult(
      "BLOCK",
      "FAIL",
      "verification FAILED — fix the failing gates and re-run /marvin:task-verify",
    );
  }
  return gateResult(
    "BLOCK",
    typeof verdict === "string" ? verdict : null,
    "unrecognised verdict — re-run /marvin:task-verify",
  );
}

/** Render an ALLOW/BLOCK delivery decision with a machine-readable block. */
function gateResult(
  decision: "ALLOW" | "BLOCK",
  verdict: string | null,
  reason: string,
): ToolResult {
  const machine = JSON.stringify({ decision, verdict, reason });
  const md = [
    `# Delivery Gate`,
    ``,
    `**Decision:** ${decision}`,
    `**Verdict:** ${verdict ?? "—"}`,
    `**Reason:** ${reason}`,
    ``,
  ].join("\n");
  return {
    content: [{ type: "text", text: `${md}\n\`\`\`json deliver-gate\n${machine}\n\`\`\`` }],
    isError: decision === "BLOCK",
  };
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}
