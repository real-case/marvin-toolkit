import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import { projectConfigPath, type ServerEnv } from "../lib/env.js";
import { diffAgainstHead, headSha, untrackedFiles } from "../lib/git.js";
import { classifyStaleness, collectProvenance, type Staleness } from "../lib/provenance.js";
import { formatVerifyBlock, parseVerifyBlock, type VerifyGate } from "../lib/reports.js";
import { loadConfig } from "../storage/config.js";
import type { Config, SpecConfig } from "../storage/schema.js";
import { parseFrontmatter } from "../storage/frontmatter.js";
import {
  oracleJournalPath,
  oracleTestFile,
  readOracleRuns,
  recordOracleRun,
  redGreenProof,
  resolveOracleCommand,
  type OracleRun,
} from "../storage/oracles.js";
import { performRollup } from "../lib/metrics-record.js";
import { recordVerifyRun, type VerifyRunEntry } from "../storage/verify-runs.js";
import {
  SpecContract,
  contractHash,
  extractContractBlock,
  resolveSpecBySlug,
  specSearchDirs,
  type Criterion,
} from "../storage/spec.js";

/**
 * Deterministic quality-gate runner (ADR-0002). Runs the project's
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

/**
 * `not-run` (ADR-0035) is decided by a pre-flight probe, never by an exit code:
 * the gate's binary was absent, so nothing was spawned. It is not a failure and
 * not a pass — the two states the verdict used to have to squeeze it into.
 */
type GateStatus = "pass" | "fail" | "error" | "not-run";

interface GateResult {
  name: GateName;
  command: string;
  status: GateStatus;
  code: number | null;
  durationMs: number;
  summary: string;
  details: string;
  /** Set only on `not-run`: the command token the probe could not resolve. */
  missingToken?: string;
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
 * `.marvin/config.json` `gates` overrides any of these per gate (ADR-0009).
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
    .describe(
      "Write verification.md to <projectRoot>/.marvin/task/. That location is deliberately independent of where specs live: a spec is a project document and stays host-adaptive (ADR-0005), while everything marvin generates about a run is a service file pinned under .marvin/ (ADR-0007), so this path does not follow `spec.dir` (ADR-0037).",
    ),
  dryRun: z
    .boolean()
    .default(false)
    .describe("Report the detected gate plan without executing anything."),
  action: z
    .enum(["run", "gate", "oracles"])
    .default("run")
    .describe(
      "run: execute the gates (default). gate: do not run anything — read the existing verification.md and decide whether delivery is allowed (verdict PASS / PASS WITH WARNINGS) or blocked (FAIL / missing). The deterministic delivery gate for /marvin:task-deliver. oracles: run a sealed spec's acceptance oracles (not gates) and append each outcome to .marvin/task/runs/<slug>.oracles.md — the red-green recorder for /marvin:task-implement.",
    ),
  criteria: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'oracles only: run just these criterion ids (e.g. ["AC2"]). Omit to run every non-prose-review criterion. Distinct from `only`, which selects GATES.',
    ),
  expect: z
    .enum(["pass", "fail"])
    .default("pass")
    .describe(
      'oracles only: which phase this is. "fail" is the red phase (the test must fail before the fix); "pass" is the green phase. Recorded on every journal entry — a red and a green at the same contract_sha with the same test hash are what the delivery gate reads as a proof.',
    ),
  command: z
    .string()
    .min(1)
    .optional()
    .describe(
      "oracles only: run this exact command for every selected criterion, outranking the criterion's own `run`, its `ref` and the project's `gates.test_one`.",
    ),
  specSlug: z
    .string()
    .optional()
    .describe(
      "Spec slug (kebab-case) this run verifies. On run: also writes the identical artifact to .marvin/task/runs/<slug>.md. On gate: reads that per-spec run instead of the global verification.md, so the gate judges THIS task's proof. A non-kebab-case slug is rejected with a warning, never sanitised.",
    ),
  allowStale: z
    .boolean()
    .default(false)
    .describe(
      "gate only: deliver even though the recorded verification no longer describes this working tree. Waives the freshness check ONLY — it never turns a FAIL verdict into an ALLOW, and never waives the no-test-evidence refusal. Requires an explicit user decision.",
    ),
});
type VerifyInput = z.infer<typeof VerifyInput>;

export function buildVerifyTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "verify",
    description:
      'Run project quality gates (test/lint/type-check/build) concurrently with stack auto-detection, reduce to one verdict at a single merge point, and write verification.md. A gate whose binary is absent is recorded "not-run" (a warning, not a failure) rather than failing. Use for /marvin:task-verify and as the executor\'s self-test. Pass action: "gate" to instead read the written verdict and decide whether delivery is allowed — the delivery gate for /marvin:task-deliver, which also refuses a run with no test evidence and one whose recorded provenance no longer describes the working tree (waivable with allowStale). Pass specSlug on both actions so the run is written to, and the gate reads, .marvin/task/runs/<slug>.md.',
    inputSchema: VerifyInput,
    handler: (input) => runVerify(input, env),
  });
}

async function runVerify(input: VerifyInput, env: ServerEnv): Promise<ToolResult> {
  const projectRoot = input.projectRoot ?? env.projectDir;

  // ONE config read, ahead of the action fork. Every action needs it: the gate
  // plan below, `gates.test_one` for oracle command resolution, and — the reason
  // it moved above the two early returns — the `spec.dir` tier all three spec
  // lookups on this path resolve through (ADR-0037). It is read per call rather
  // than per server, so a `task config` edit applies without a restart.
  const { config, warning: configWarning } = loadConfig(projectConfigPath(env, projectRoot));

  // Delivery gate: read the prior verification.md verdict, run nothing.
  if (input.action === "gate") {
    return deliverGate(projectRoot, {
      specSlug: input.specSlug,
      allowStale: input.allowStale,
      specConfig: config.spec,
      env,
      config,
    });
  }

  // Acceptance oracles: run a sealed spec's criteria, not the project's gates.
  if (input.action === "oracles") return runOracles(projectRoot, input, config);

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

  // Availability is probed HERE — once per gate, before the clock starts — and
  // the answer is carried into the run. The probe is a blocking `spawnSync`, so
  // inside the measured window it would serialise the concurrent path and take
  // back the latency guarantee ADR-0002 exists for (AC-7).
  const planned = planGates(gates, projectRoot);

  // Run gates and merge.
  const wallStart = performance.now();
  const results = await executeGates(planned, input.execution, projectRoot);
  const wallClockMs = Math.round(performance.now() - wallStart);
  const sumOfGatesMs = results.reduce((acc, r) => acc + r.durationMs, 0);

  const warnings = modeWarnings(input.mode, projectRoot);
  if (configWarning) {
    warnings.push(`\`.marvin/config.json\`: ${configWarning} — using auto-detected gates.`);
  }
  // A gate whose binary was absent is loud but not fatal: one warning each, which
  // is what degrades an otherwise-green plan to PASS WITH WARNINGS. That is a
  // VISIBILITY measure — PASS WITH WARNINGS delivers. The refusal that closes the
  // bypass lives in deliverGate (ADR-0035).
  for (const r of results) {
    if (r.status === "not-run") warnings.push(notRunWarning(r.name, r.missingToken));
  }
  // A pipeline run that names no spec leaves no per-spec run and no journal
  // entry, so the delivery gate judges the global artifact and the metrics series
  // never sees the run (ADR-0043 §6). One warning — which degrades PASS to PASS
  // WITH WARNINGS, the verdict `task-deliver` already surfaces for confirmation —
  // and no other surface changes. A standalone run legitimately has no spec.
  if (input.mode !== "standalone" && input.specSlug === undefined) {
    warnings.push(SLUGLESS_PIPELINE_WARNING);
  }
  const runSlug = resolveRunSlug(input.specSlug);
  if (runSlug.rejected) {
    warnings.push(
      slugRejection(
        runSlug.rejected,
        "wrote only `.marvin/task/verification.md`, no per-spec run.",
      ),
    );
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

  // Resolve the artifact path up front so it can be embedded in the machine
  // block, then write the SAME text we return (markdown + verify-result) to the
  // file — so verification.md is itself machine-readable. Both the delivery gate
  // (action: "gate") and the task-summary aggregator (ADR-0024) read the block
  // back from the file rather than scraping prose; previously the block was only
  // in the tool's return value, so a real verify → deliver never found it.
  const artifactPath = input.write ? join(projectRoot, ".marvin", "task", "verification.md") : null;
  // The per-spec run is written beside the global artifact with IDENTICAL text —
  // `artifactPath` stays the global path in both copies, so the two files are
  // byte-for-byte the same document (ADR-0035).
  const runPath =
    input.write && runSlug.slug
      ? join(projectRoot, ".marvin", "task", "runs", `${runSlug.slug}.md`)
      : null;

  // Provenance is collected HERE — after every gate has settled and immediately
  // before the artifact is written — never at the start of the run. A gate can
  // change the tree it is verifying: this repository's own build gate is
  // `npm run build`, which rewrites the tracked dist/server.js and widgets/*.html.
  // Collected first, the digest would describe a tree the run itself then changed,
  // and every post-build delivery would read as stale.
  const provenance = collectProvenance(projectRoot) ?? undefined;

  const machine = formatVerifyBlock({
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
    provenance,
  });

  const fullText = `${markdown}\n\n${machine}`;

  if (input.write && artifactPath) {
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, fullText, "utf8");
    if (runPath) {
      mkdirSync(dirname(runPath), { recursive: true });
      writeFileSync(runPath, fullText, "utf8");
    }
    // The verification-run journal (ADR-0043 §3). The run file above is
    // OVERWRITTEN by every run, so this append is the only record of how many
    // attempts preceded the surviving one. Written for exactly the runs that
    // wrote a per-spec file — a slugless run writes no journal entry, as it
    // writes no per-spec run — and fail-open, so it can never change the verdict.
    if (runPath && runSlug.slug) {
      journalVerifyEntry(projectRoot, {
        slug: runSlug.slug,
        kind: "run",
        at: new Date().toISOString(),
        verdict,
        mode: input.mode,
        execution: input.execution,
        only: input.only ?? null,
        gates: results.map((r) => ({ name: r.name, status: r.status, durationMs: r.durationMs })),
        wallClockMs,
        sumOfGatesMs,
        head_sha: provenance?.head_sha ?? null,
      });
    }
  }

  return {
    content: [{ type: "text", text: fullText }],
    isError: verdict === "FAIL",
  };
}

/**
 * Resolve which gates to run, in precedence order:
 *   1. explicit per-call `gates` — wholesale override (testing / programmatic).
 *   2. config-declared gates (`.marvin/config.json`) — per-gate, config wins.
 *   3. auto-detection — stack table, then declared-command fallback.
 * (1) is for the caller that already knows the plan; (2) is the durable,
 * stack-agnostic project declaration (ADR-0009); (3) is the convenience default.
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
  planned: PlannedGate[],
  execution: VerifyInput["execution"],
  cwd: string,
): Promise<GateResult[]> {
  if (execution === "parallel") {
    const settled = await Promise.allSettled(planned.map((p) => runGate(p, cwd)));
    return settled.map((s, i) =>
      s.status === "fulfilled" ? s.value : crashResult(planned[i]!.gate, s.reason),
    );
  }

  // sequential / fail-fast: one at a time.
  const results: GateResult[] = [];
  for (const p of planned) {
    let r: GateResult;
    try {
      r = await runGate(p, cwd);
    } catch (err) {
      r = crashResult(p.gate, err);
    }
    results.push(r);
    // fail-fast stops at the first *failure*. A `not-run` gate is not one —
    // nothing was spawned — so it must not cut the remaining gates short.
    if (execution === "fail-fast" && r.status !== "pass" && r.status !== "not-run") break;
  }
  return results;
}

// ── the pre-flight availability probe (ADR-0035) ────────────────────────────

/**
 * Anything that makes a command more than one simple invocation — a chain, a
 * pipe, a substitution, a redirection, a glob, a quote. Its presence is the
 * signal to abstain, and it doubles as the injection screen: a command that
 * reaches the probe provably contains no metacharacter, so neither can the
 * token interpolated into `sh -c`.
 */
const SHELL_METACHARACTERS = /[|&;<>()$`\\"'*?[\]{}~#\n]/;

type Probe = { kind: "abstain" } | { kind: "available" } | { kind: "missing"; token: string };

const ABSTAIN: Probe = { kind: "abstain" };

/** A gate paired with the pre-flight answer for its command, so the two cannot
 * drift apart on the way into the runner. */
interface PlannedGate {
  gate: GateSpec;
  probe: Probe;
}

/**
 * Can each gate's binary be resolved, before anything is spawned?
 *
 * Deliberately **partial**. It answers for a single simple command — which is
 * every built-in stack default except the C/C++ build — and abstains on
 * everything else, so the documented chained form (`"lint": "npm run lint &&
 * gitleaks detect"`) keeps failing exactly as it does today. Parsing the chain
 * was rejected: a mis-parse produces a *false* `not-run`, which downgrades a real
 * failure to a warning, and that is strictly worse than a missed one.
 *
 * Exit code 127 is deliberately NOT the signal. `npm`, `make` and most test
 * runners propagate a child's 127 as their own, so classifying after the fact
 * would silently convert real failures into warnings.
 *
 * Probing is a whole-plan step rather than a per-gate one for two reasons, both
 * about the concurrency this runner exists to provide. Each probe is a blocking
 * `spawnSync`, so run from inside a gate it would hold the event loop and start
 * the gates one after another — the sequential shape, wearing the parallel
 * label. And a plan whose gates share a runner (`npm test`, `npm run lint`)
 * probes that token once for all of them: the memo is per token, so N gates cost
 * one spawn.
 */
function planGates(gates: GateSpec[], cwd: string): PlannedGate[] {
  const byToken = new Map<string, Probe>();
  return gates.map((gate) => {
    if (SHELL_METACHARACTERS.test(gate.command)) return { gate, probe: ABSTAIN };
    const token = gate.command.trim().split(/\s+/)[0];
    if (!token) return { gate, probe: ABSTAIN };
    let probe = byToken.get(token);
    if (!probe) {
      probe = probeToken(token, cwd);
      byToken.set(token, probe);
    }
    return { gate, probe };
  });
}

/** Resolve one command token against PATH. The token provably carries no shell
 * metacharacter (`planGates` screened the whole command), so neither can the
 * string interpolated into `sh -c` here. */
function probeToken(token: string, cwd: string): Probe {
  const probe = spawnSync("sh", ["-c", `command -v -- ${token}`], { cwd, encoding: "utf8" });
  // A probe that could not itself run tells us nothing — abstain and let the
  // gate run exactly as it does today.
  if (probe.error || probe.status === null) return ABSTAIN;
  return probe.status === 0 ? { kind: "available" } : { kind: "missing", token };
}

function notRunWarning(gate: GateName, token: string | undefined): string {
  return (
    `gate not run: \`${gate}\` — \`${token ?? "the gate command"}\` is not on PATH ` +
    `(install it, or pin a different command in \`.marvin/config.json\`)`
  );
}

/** The prefix `deliverGate` filters on to quote these warnings back. */
const NOT_RUN_WARNING_PREFIX = "gate not run:";

// ── the single child-process site (ADR-0015, ADR-0036) ──────────────────────

/** What one child process did. `error` means it never ran at all. */
interface SpawnOutcome {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /**
   * The child could not be LAUNCHED — the `error` event, or a command node
   * rejects outright. Distinct from every exit code, including 127: a launch
   * failure proves nothing about the code under test.
   */
  error?: Error;
}

/**
 * Run one command through the shell and report what happened. Deliberately free
 * of gate vocabulary — no `GateName`, no `GateSpec` — because the gate runner
 * and the acceptance-oracle runner both call it, and the next caller (a timeout,
 * a per-gate environment) should not have to launder its subject into a gate.
 *
 * This is the ONE `shell: true` site in the server, which is what keeps
 * ADR-0015's claim literally true after `action: "oracles"` was added rather
 * than nearly true.
 */
function spawnCommand(command: string, cwd: string): Promise<SpawnOutcome> {
  const start = performance.now();
  const since = () => Math.round(performance.now() - start);
  const asError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)));

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, { cwd, shell: true });
    } catch (err) {
      // `spawn` validates its arguments synchronously (a NUL byte, an
      // unrepresentable command). Same class as the `error` event below, so it
      // takes the same exit — a throw here would otherwise escape as a crash.
      resolve({
        code: null,
        signal: null,
        stdout: "",
        stderr: "",
        durationMs: since(),
        error: asError(err),
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (o: SpawnOutcome) => {
      if (settled) return;
      settled = true;
      resolve(o);
    };
    // Decode through each stream's own StringDecoder rather than per chunk. A
    // command's output is arbitrarily long and full of multibyte characters —
    // test reporters emit ✔/✖/→ by the line — so a character straddling a pipe
    // read would decode to U+FFFD on both sides of the boundary and land as
    // mojibake in `details`, which is what the user reads back out of
    // verification.md.
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (err) =>
      settle({ code: null, signal: null, stdout, stderr, durationMs: since(), error: err }),
    );
    child.on("close", (code, signal) =>
      settle({ code, signal, stdout, stderr, durationMs: since() }),
    );
  });
}

/**
 * The exit trichotomy, stated ONCE. A clean zero is a pass, a clean non-zero is
 * a failure, and a null code — the process was terminated by a signal, which
 * `signal` names — is an execution error rather than a verdict about the code.
 *
 * Copying this into the oracle runner is the defect the extraction exists to
 * prevent: a missing runner exits 127 and a timeout SIGKILL exits null, and a
 * copy that treated "non-zero or null" alike would read both as "the test failed
 * before the fix" — exactly the evidence a red phase must never fabricate.
 */
function classifyExit(
  code: number | null,
  signal: NodeJS.Signals | null,
): "pass" | "fail" | "error" {
  if (code === 0) return "pass";
  if (code === null || signal !== null) return "error";
  return "fail";
}

/** Spawn one gate command via the shell, capturing output and exit code. The
 * availability answer is decided before the run (`planGates`) and passed in — a
 * gate whose binary is missing spawns nothing here. */
async function runGate({ gate, probe }: PlannedGate, cwd: string): Promise<GateResult> {
  if (probe.kind === "missing") {
    return {
      name: gate.name,
      command: gate.command,
      status: "not-run",
      code: null,
      durationMs: 0,
      summary: `not run — \`${probe.token}\` is not on PATH`,
      details: "",
      missingToken: probe.token,
    };
  }

  const out = await spawnCommand(gate.command, cwd);
  if (out.error) return crashResult(gate, out.error, out.durationMs);

  const status: GateStatus = classifyExit(out.code, out.signal);
  const tail = failureExcerpt(out.stderr || out.stdout);
  const summary =
    status === "pass"
      ? "passed"
      : status === "error"
        ? `terminated (${out.signal})`
        : `exit ${out.code}`;
  return {
    name: gate.name,
    command: gate.command,
    status,
    code: out.code,
    durationMs: out.durationMs,
    summary,
    details: tail,
  };
}

/**
 * A line that reports an error rather than merely mentioning one. `error` and
 * `fatal` must be whole tokens (`(?![\w-])` keeps `error-handler.ts` out), the
 * npm and compiler prefixes are matched literally, and the FAIL marker is
 * case-sensitive so a test *named* "…should fail…" does not qualify.
 */
const ERROR_TOKEN = /(^|[\s:[(])(?:errors?|fatal)(?![\w-])|\bERR!|[\u2716\u2717\u2715\u00d7]/i;
const FAIL_MARKER = /(^|\s)(?:FAIL|FAILED|FAILURES?)(?![\w-])/;
/**
 * A line whose own marker says the thing PASSED, removed before error matching.
 * A test *named* "returns an error when the token is missing" prints that name
 * on success, and twelve of those crowd out the assertion that actually failed.
 * The tick characters match anywhere in the line; `ok` must open it, so TAP's
 * `not ok 1 - …` stays a failure.
 */
const PASS_MARKER = /(^|\s)[\u2713\u2714\u221a]|^\s*ok\s/;

/**
 * The excerpt a failing gate shows. A naive tail is the wrong twelve lines for
 * any linter that prints warnings after errors: one measured run rendered a
 * pre-existing warning in a file the task never touched, while all five real
 * errors — in files it had just written — scrolled past above it, and the
 * excerpt is what the reader debugs from. So the matched error lines lead.
 *
 * The tail is kept regardless of what matched, and that is not belt-and-braces.
 * A runner states its verdict in its LAST lines, and those lines routinely match
 * no pattern here at all: `AssertionError [ERR_ASSERTION]: …` carries `Error`
 * mid-token, so every alternative above misses it. Leading with matches alone
 * reproduced the very defect this function exists to fix — twelve passing test
 * names, the assertion gone.
 */
function failureExcerpt(text: string): string {
  const lines = text.trim().split("\n");
  const errors = lines.filter(
    (l) => !PASS_MARKER.test(l) && (ERROR_TOKEN.test(l) || FAIL_MARKER.test(l)),
  );
  if (errors.length === 0) return lines.slice(-12).join("\n");
  const shown = errors.slice(0, 9);
  const head =
    shown.length === errors.length
      ? `${errors.length} error line(s):`
      : `${errors.length} error line(s), first ${shown.length}:`;
  const tail = lines.slice(-3).filter((l) => !shown.includes(l));
  return [head, ...shown, ...(tail.length ? ["…", ...tail] : [])].join("\n");
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

/**
 * The ADR-0043 §6 warning for a `feature`/`bug` run that passed no `specSlug`.
 * It names what the omission costs, because the run itself still passes: the
 * gap is meant to reach the user, not to block them.
 */
const SLUGLESS_PIPELINE_WARNING =
  "No `specSlug` was passed to a pipeline run — no per-spec run was written under " +
  "`.marvin/task/runs/`, the delivery gate will judge the global `verification.md`, and the " +
  "metrics series will not see this run. Pass the spec's slug (its frontmatter `slug`, else its " +
  "filename slug) on every chained run.";

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

/**
 * Reads the same file set as before, now through the shared `lib/git.ts`
 * helpers. Today's asymmetry is preserved exactly: a failed diff returns null
 * (not a git repository — nothing to assert), a failed untracked read
 * contributes an empty list. Neither read excludes anything, so the mode
 * warnings still see the files they have always seen.
 */
function changedFiles(cwd: string): string[] | null {
  const diff = diffAgainstHead(cwd, { format: "name-only" });
  if (diff === null) return null;
  const untracked = untrackedFiles(cwd) ?? [];
  return [...diff.split("\n"), ...untracked].map((s) => s.trim()).filter(Boolean);
}

/**
 * Reduce all gate results + warnings to one verdict — the single decision point.
 *
 * `not-run` is excluded from the failure predicate: nothing ran, so nothing
 * failed. Each such gate has already contributed a warning, so the plan lands on
 * PASS WITH WARNINGS and never on a silent PASS.
 */
function computeVerdict(results: GateResult[], warnings: string[]): Verdict {
  if (results.some((r) => r.status !== "pass" && r.status !== "not-run")) return "FAIL";
  if (warnings.length > 0) return "PASS WITH WARNINGS";
  return "PASS";
}

// ── the per-spec run file (ADR-0035) ────────────────────────────────────────

/** The kebab-case rule the DoR gate applies to a spec's frontmatter `slug`. */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Validate, never sanitise. A slug that does not match resolves to no per-spec
 * file at all, so path traversal is closed by construction rather than by
 * scrubbing a path — and the caller is told, because a silently-skipped run file
 * is a summary that silently joins against the wrong verification.
 *
 * The rejection is returned as the offending value rather than as a finished
 * sentence: what happened *instead* differs per caller — the run writes only the
 * global artifact, the gate judges it, the oracle runner refuses outright — and
 * a rejection that names the wrong consequence is its own small lie.
 */
function resolveRunSlug(specSlug: string | undefined): { slug: string | null; rejected?: string } {
  if (specSlug === undefined) return { slug: null };
  const slug = specSlug.trim();
  if (SLUG_RE.test(slug)) return { slug };
  return { slug: null, rejected: slug };
}

/** The one rejection sentence, closed by the caller's own consequence clause. */
function slugRejection(rejected: string, consequence: string): string {
  return `\`specSlug\` \`${rejected}\` is not kebab-case — ${consequence}`;
}

// ── acceptance oracles (ADR-0036) ───────────────────────────────────────────

/**
 * The spec file for a validated slug, searched host-adaptively (ADR-0005/0037).
 *
 * `specConfig` is the `spec.dir` tier and is REQUIRED to be threaded in by every
 * caller, not optional-by-convenience: a project that configures a directory
 * outside the five conventional candidates is reachable through no other tier,
 * so a lookup that omits it answers "no spec found" for a spec `/marvin:task-start`,
 * `/marvin:task-summary` and the dashboard all resolve. This runner used to be
 * the one reader on the ADR-0037 list that omitted it.
 */
function findSpec(slug: string, projectRoot: string, specConfig?: SpecConfig): string | null {
  for (const dir of specSearchDirs(projectRoot, specConfig)) {
    const p = resolveSpecBySlug(dir, slug, projectRoot);
    if (p) return p;
  }
  return null;
}

/** The per-spec run directory 027 introduced; the oracle journal lives beside
 * the run reports there, never at the top level of the spec directory. */
function runsDirOf(projectRoot: string): string {
  return join(projectRoot, ".marvin", "task", "runs");
}

/**
 * Roll the task's metrics up at delivery, FAIL-OPEN (ADR-0044).
 *
 * Returns the line to add to the answer, or null when nothing was written. The
 * catch stays here rather than in the shared module for the reason
 * `journalVerifyEntry` gives: the decision is already made above, and a write
 * that throws — an unwritable directory, a full disk — must not reach it.
 *
 * The line is deterministic for a given tree: a path, and a boolean. It carries
 * no count and no timestamp, so two consecutive calls produce identical text
 * even though the second one appended a second terminal block.
 */
function rollUpForDelivery(
  projectRoot: string,
  slug: string,
  env: ServerEnv,
  config: Config,
): string | null {
  try {
    const { record, ignored } = performRollup({ env, projectRoot, config, slug });
    return ignored
      ? `**Metrics:** \`${record}\` — ⚠️ git IGNORES this record, so the series is not being ` +
          "committed. Add `!.marvin/metrics/` after `.marvin/*` in `.gitignore`."
      : `**Metrics:** \`${record}\``;
  } catch {
    return null; // fail-open by design — see above
  }
}

/**
 * Add one line after the machine-readable block, leaving that block untouched.
 *
 * `gateResult` returns exactly one text part, so the first branch is the only
 * one taken today. The fallback APPENDS a part rather than dropping the note:
 * this line is the only place a host project is told its series is ignored, and
 * losing it silently is the failure this whole change exists to remove.
 */
function withNote(answer: ToolResult, note: string): ToolResult {
  const first = answer.content[0];
  if (first?.type === "text") {
    return {
      ...answer,
      content: [{ ...first, text: `${first.text}\n\n${note}` }, ...answer.content.slice(1)],
    };
  }
  return { ...answer, content: [...answer.content, { type: "text", text: note }] };
}

/**
 * Append one entry to the verification-run journal, FAIL-OPEN (ADR-0043 §3). A
 * write that throws — a read-only directory, a full disk — is swallowed here, so
 * the journal can never change a verdict or a delivery decision: it is evidence
 * for the metrics roll-up, never an input to a gate.
 */
function journalVerifyEntry(projectRoot: string, entry: VerifyRunEntry): void {
  try {
    recordVerifyRun(runsDirOf(projectRoot), entry);
  } catch {
    // fail-open by design — see above
  }
}

interface SealedSpec {
  slug: string;
  path: string;
  type: string;
  contractSha: string;
  criteria: Criterion[];
}

/**
 * Resolve a spec by slug and prove its contract is intact, or say why not.
 *
 * The digest is recomputed with the ONE exported seal function
 * (`storage/spec.ts`), never re-derived here. Two copies of the seal drift the
 * first time either is touched, and a journal keyed by one and read against the
 * other leaves a spec that reads sealed to `spec mode: "seal"` and tampered to
 * this action, with no way to tell which is right.
 */
function readSealedSpec(
  slug: string,
  projectRoot: string,
  specConfig?: SpecConfig,
): SealedSpec | { error: string } {
  const path = findSpec(slug, projectRoot, specConfig);
  if (!path) {
    // Name the list actually searched, config tier included — a project with a
    // configured spec dir must not be told its spec is missing from five places
    // that are not where the lookup looked.
    const searched = specSearchDirs(projectRoot, specConfig)
      .map((d) => relative(projectRoot, d) || d)
      .join(", ");
    return { error: `No spec found for slug \`${slug}\` under ${searched}.` };
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return { error: `could not read \`${path}\`: ${err instanceof Error ? err.message : err}` };
  }
  const { frontmatter, body } = parseFrontmatter(raw);
  const blockText = extractContractBlock(body);
  if (!blockText) {
    return { error: `\`${path}\` has no \`\`\`yaml spec-contract block — nothing to run.` };
  }
  const stamped = (frontmatter.contract_sha ?? "").trim();
  const actual = contractHash(blockText);
  if (!stamped) {
    return {
      error:
        `spec \`${slug}\` is UNSEALED — its frontmatter carries no \`contract_sha\`, so a run has ` +
        `no key to be journalled against and every unsealed spec would share one proof namespace. ` +
        `Seal it first (/marvin:task-start's seal step, \`spec\` with \`mode: "seal"\`; the current ` +
        `block hash is ${actual}), then re-run.`,
    };
  }
  if (stamped !== actual) {
    return {
      error:
        `spec \`${slug}\` has been edited since it was sealed — stamped \`${stamped}\`, the block ` +
        `now hashes to \`${actual}\`. Refused: nothing was run and nothing was journalled. Restore ` +
        `the contract, or re-run /marvin:task-start's seal step to stamp the new one deliberately.`,
    };
  }
  let parsed;
  try {
    parsed = SpecContract.safeParse(parseYaml(blockText));
  } catch (err) {
    return {
      error: `spec-contract block is not valid YAML: ${err instanceof Error ? err.message : err}`,
    };
  }
  if (!parsed.success) {
    return { error: `spec-contract block is invalid: ${parsed.error.issues[0]?.message ?? "?"}` };
  }
  return {
    slug,
    path,
    type: (frontmatter.type ?? "").trim(),
    contractSha: actual,
    criteria: parsed.data.criteria,
  };
}

/** 16 hex over the referenced test file's bytes, or null when it is absent. */
function testFileHash(projectRoot: string, file: string | null): string | null {
  if (!file) return null;
  const abs = join(projectRoot, file);
  if (!existsSync(abs)) return null;
  try {
    return createHash("sha256").update(readFileSync(abs)).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/**
 * A stack id for the default table, ONLY when detection is unambiguous. A
 * polyglot tree matching two detectors names none: the table's admission
 * criterion is that exactly one single-test runner is in play, and guessing
 * between two is the inference the whole resolver refuses to make.
 */
function unambiguousStack(input: VerifyInput, projectRoot: string): string | undefined {
  if (input.stack) return input.stack;
  const matched = STACK_DETECTORS.filter((d) => d.detect(projectRoot));
  return matched.length === 1 ? matched[0]!.id : undefined;
}

/**
 * Run a sealed spec's acceptance oracles and append each outcome to its journal.
 *
 * Refuses before any child process on a tampered or unsealed contract; resolves
 * each selected criterion to a command through the ADR-0009-shaped chain; and
 * records `not-run` — never a fabricated red or green — whenever the command
 * could not be resolved, could not be launched, or died on a signal.
 */
async function runOracles(
  projectRoot: string,
  input: VerifyInput,
  config: Config,
): Promise<ToolResult> {
  const { slug, rejected } = resolveRunSlug(input.specSlug);
  if (!slug) {
    return errText(
      `\`action: "oracles"\` needs a kebab-case \`specSlug\` naming the sealed spec to run.` +
        (rejected
          ? ` ${slugRejection(rejected, "nothing was run and nothing was journalled.")}`
          : ""),
    );
  }

  const spec = readSealedSpec(slug, projectRoot, config.spec);
  if ("error" in spec) return errText(spec.error);

  const wanted = input.criteria?.map((c) => c.trim().toLowerCase());
  const selected = spec.criteria.filter((c) => !wanted || wanted.includes(c.id.toLowerCase()));
  if (selected.length === 0) {
    return errText(
      `No criterion in \`${slug}\` matched \`criteria\` (${input.criteria?.join(", ")}). ` +
        `The spec declares ${spec.criteria.map((c) => c.id).join(", ")}.`,
    );
  }
  // A prose-review criterion has no command by construction; it is skipped
  // rather than journalled, so the journal never carries a row nothing could
  // ever prove.
  const runnable = selected.filter((c) => c.oracle.kind !== "prose-review");
  const skipped = selected.filter((c) => c.oracle.kind === "prose-review").map((c) => c.id);

  const testOne = config.gates?.test_one;
  const stack = unambiguousStack(input, projectRoot);
  const head = headSha(projectRoot);
  const runsDir = runsDirOf(projectRoot);

  const entries: OracleRun[] = [];
  for (const criterion of runnable) {
    const resolved = resolveOracleCommand(criterion, {
      call: input.command,
      testOne,
      stack,
      projectRoot,
    });
    const file = oracleTestFile(criterion);
    const base = {
      slug,
      contract_sha: spec.contractSha,
      criterion: criterion.id,
      expect: input.expect,
      test_file: file,
      test_sha: testFileHash(projectRoot, file),
      head_sha: head,
      ran_at: new Date().toISOString(),
    };

    if (resolved.command === null) {
      entries.push({
        ...base,
        status: "not-run",
        command: null,
        source: null,
        reason: resolved.reason,
        code: null,
        signal: null,
      });
      continue;
    }

    const out = await spawnCommand(resolved.command, projectRoot);
    const shared = {
      ...base,
      command: resolved.command,
      source: resolved.source,
      durationMs: out.durationMs,
    };
    if (out.error) {
      entries.push({
        ...shared,
        status: "not-run",
        reason: `launch-failed: ${out.error.message}`,
        code: null,
        signal: null,
      });
      continue;
    }
    const classified = classifyExit(out.code, out.signal);
    entries.push({
      ...shared,
      status: classified === "error" ? "not-run" : classified,
      ...(classified === "error" ? { reason: `signal-killed: ${out.signal ?? "unknown"}` } : {}),
      code: out.code,
      signal: out.signal,
    });
  }

  for (const entry of entries) recordOracleRun(runsDir, entry);

  const journal = oracleJournalPath(runsDir, slug);
  const icon = (s: OracleRun["status"]) => (s === "pass" ? "✅" : s === "fail" ? "❌" : "⚪");
  const md = [
    `# Acceptance Oracles — ${slug}`,
    ``,
    `**Contract:** \`${spec.contractSha}\` · **Phase:** expect ${input.expect} · **Journal:** \`${journal}\``,
    ``,
    ...entries.map(
      (e) =>
        `- ${icon(e.status)} **${e.criterion}** — ${e.status}` +
        (e.command ? ` · \`${e.command}\` (${e.source})` : "") +
        (e.reason ? ` · ${e.reason}` : ""),
    ),
    ...(entries.length ? [] : ["_no runnable criterion selected_"]),
    ...(skipped.length ? ["", `Skipped (prose-review): ${skipped.join(", ")}.`] : []),
    ``,
  ].join("\n");

  const machine = JSON.stringify({
    slug,
    contract_sha: spec.contractSha,
    expect: input.expect,
    journal,
    runs: entries,
  });
  return {
    content: [{ type: "text", text: `${md}\n\`\`\`json oracle-result\n${machine}\n\`\`\`` }],
  };
}

/**
 * Advisory red-green status for the delivery gate. `unknown` is the answer for
 * everything that is not a bugfix spec with regression criteria at a readable
 * seal — including every caller that passes no slug, which is why the field is
 * strictly additive.
 */
type RedGreen = "proven" | "missing" | "unknown";

function redGreenStatus(
  projectRoot: string,
  specSlug: string | undefined,
  specConfig?: SpecConfig,
): { status: RedGreen; unproven: string[] } {
  const none = { status: "unknown" as const, unproven: [] as string[] };
  const { slug } = resolveRunSlug(specSlug);
  if (!slug) return none;
  const spec = readSealedSpec(slug, projectRoot, specConfig);
  // A tampered or unreadable contract is `unknown` here rather than an error:
  // this field is advisory, and the gate's own refusals are the ones that block.
  if ("error" in spec) return none;
  if (spec.type !== "bugfix") return none;
  const regression = spec.criteria.filter((c) => c.regression === true);
  if (regression.length === 0) return none;

  const runs = readOracleRuns(runsDirOf(projectRoot), slug);
  const unproven = regression
    .filter((c) => redGreenProof(runs, spec.contractSha, c.id) === "missing")
    .map((c) => c.id);
  return { status: unproven.length ? "missing" : "proven", unproven };
}

function errText(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
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
 * BLOCK. Deterministic by construction: write and read share one codec
 * (`lib/reports.ts`), so the delivery decision cannot drift from what verify
 * recorded, and the model never eyeballs a prose verdict.
 */
function deliverGate(
  projectRoot: string,
  opts: {
    specSlug?: string;
    allowStale: boolean;
    specConfig?: SpecConfig;
    /** ADR-0044: the delivery gate is the terminal block's writer. */
    env: ServerEnv;
    config: Config;
  },
): ToolResult {
  const { allowStale } = opts;
  // The gate must judge THIS task's proof: prefer the per-spec run when a valid
  // slug names one that exists, and fall back to the global artifact otherwise,
  // which is exactly today's behaviour for every caller that passes no slug.
  const globalPath = join(projectRoot, ".marvin", "task", "verification.md");
  const { slug, rejected } = resolveRunSlug(opts.specSlug);
  const runPath = slug ? join(projectRoot, ".marvin", "task", "runs", `${slug}.md`) : null;
  const artifactPath = runPath && existsSync(runPath) ? runPath : globalPath;
  // Advisory, and computed regardless of the verdict so the field is always
  // present on the block. It never reaches `decision` (ADR-0036): the resolver's
  // success rate has never been measured on a real project, so a blocking veto
  // would refuse delivery for the resolver's silence rather than for a missing
  // proof, and the first response would be to disable it.
  const redGreen = redGreenStatus(projectRoot, opts.specSlug, opts.specConfig);
  const extras: GateExtras = { artifactPath, allowStale, redGreen: redGreen.status };

  // A rejected slug decides WHICH artifact this gate judged, so it belongs on
  // every decision below rather than only on the ALLOW that already concatenates
  // the freshness, not-run and red-green notes. The same input warns on
  // `action: "run"` and is refused outright on `action: "oracles"`; the gate must
  // not be the one surface that rejects a slug without saying so.
  const slugNote = rejected
    ? ` · ${slugRejection(rejected, "judged the global `.marvin/task/verification.md`, not a per-spec run")}`
    : "";
  const decide = (
    decision: "ALLOW" | "BLOCK",
    verdict: string | null,
    reason: string,
    extra: GateExtras = extras,
  ) => {
    const answer = gateResult(decision, verdict, `${reason}${slugNote}`, extra);
    // Every decision for a resolved slug is journalled (ADR-0043 §3), a BLOCK for
    // a missing artifact included: `verify-result` never carries `allowStale`, so
    // this entry is the only source for a freshness waiver. Fail-open, and written
    // BESIDE the answer rather than into it — the decision above is already made,
    // and the answer's bytes are what `critique-protocol.test.mjs` pins.
    if (slug) {
      journalVerifyEntry(projectRoot, {
        slug,
        kind: "gate",
        at: new Date().toISOString(),
        decision,
        verdict,
        staleness: extra.staleness ?? "unknown",
        allowStale: extra.allowStale,
        red_green: extra.redGreen ?? "unknown",
        artifact: relative(projectRoot, extra.artifactPath).replaceAll("\\", "/"),
      });
    }
    // The terminal metrics block (ADR-0044). ALLOW only: `rolled_up` is what the
    // series counts as tasks DELIVERED, so writing one for a refused delivery
    // would make coverage overstate what shipped. A refusal is not lost — the
    // journal entry above records every decision, including this one.
    //
    // Written BESIDE the answer, exactly as the journal is. The note goes into
    // the markdown and never through `reason`, which `gateResult` serialises
    // into the `deliver-gate` block: routing it there would look like the
    // obvious implementation and would break the block's byte-stability.
    if (slug && decision === "ALLOW") {
      const note = rollUpForDelivery(projectRoot, slug, opts.env, opts.config);
      if (note) return withNote(answer, note);
    }
    return answer;
  };

  if (!existsSync(artifactPath)) {
    return decide(
      "BLOCK",
      null,
      "no verification.md found — run /marvin:task-verify before delivering",
    );
  }
  let text: string;
  try {
    text = readFileSync(artifactPath, "utf8");
  } catch (err) {
    return decide(
      "BLOCK",
      null,
      `could not read verification.md: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // Three distinguishable BLOCK reasons, because they call for three different
  // user actions: no block at all, a block that cannot be read, and a block
  // whose verdict this gate does not recognise.
  const parse = parseVerifyBlock(text);
  if (parse.kind === "none") {
    return decide(
      "BLOCK",
      null,
      "verification.md has no machine-readable verify-result block — re-run /marvin:task-verify",
    );
  }
  if (parse.kind === "invalid") {
    return decide("BLOCK", null, `${parse.reason} — re-run /marvin:task-verify`);
  }

  const verdict = parse.result.verdict;
  if (verdict === "FAIL") {
    return decide(
      "BLOCK",
      "FAIL",
      "verification FAILED — fix the failing gates and re-run /marvin:task-verify",
    );
  }
  if (verdict !== "PASS" && verdict !== "PASS WITH WARNINGS") {
    return decide(
      "BLOCK",
      typeof verdict === "string" ? verdict : null,
      "unrecognised verdict — re-run /marvin:task-verify",
    );
  }

  // No-evidence refusal — the measure that actually closes the bypass `not-run`
  // would otherwise open. Read off the block's `gates` array, which this gate
  // already parsed and used to ignore. NO input waives either case: `allowStale`
  // is about freshness and does not reach here.
  const noEvidence = noEvidenceRefusal(parse.result.gates, parse.result.warnings ?? []);
  if (noEvidence) return decide("BLOCK", verdict, noEvidence);

  // Freshness. Missing provenance is `unknown`, which ALLOWs — and costs no git
  // spawn, which is what keeps the gate a pure file read in a non-git project.
  const recorded = parse.result.provenance;
  const staleness: Staleness = recorded
    ? classifyStaleness(recorded, collectProvenance(projectRoot))
    : "unknown";

  const base =
    verdict === "PASS"
      ? "verification passed"
      : "verification passed with warnings — review them before delivering";
  const notRun = quoteNotRunWarnings(parse.result.warnings ?? []);

  if (staleness === "stale" && !allowStale) {
    return decide(
      "BLOCK",
      verdict,
      `the recorded verification no longer describes this working tree — verified at ` +
        `\`${recorded?.head_sha ?? "unknown"}\` on \`${recorded?.branch ?? "unknown"}\`. ` +
        `Re-run /marvin:task-verify, or deliver with allowStale: true after an explicit decision.`,
      { ...extras, staleness },
    );
  }
  const freshness =
    staleness === "fresh"
      ? " · the evidence matches this working tree"
      : staleness === "stale"
        ? ` · STALE evidence accepted via allowStale (verified at \`${recorded?.head_sha ?? "unknown"}\`` +
          ` on \`${recorded?.branch ?? "unknown"}\`)`
        : " · freshness not checked (this run recorded no provenance)";
  // A WARNING, not a veto: it lengthens the reason and leaves the decision alone.
  const redGreenNote =
    redGreen.status === "missing"
      ? ` · no recorded red→green pair at this contract_sha for ${redGreen.unproven.join(", ")}` +
        ` — record one with \`verify action: "oracles"\` (this does not block delivery)`
      : "";
  return decide("ALLOW", verdict, `${base}${freshness}${notRun}${redGreenNote}`, {
    ...extras,
    staleness,
  });
}

/**
 * Two cases, both meaning the run proved nothing about the code:
 *   1. at least one gate named `test` was recorded and EVERY one is `not-run`;
 *   2. at least one gate was recorded and EVERY gate is `not-run`.
 *
 * The asymmetry with a `not-run` optional scanner is the point. A missing
 * scanner leaves the pipeline's central claim intact and degrades to a warning;
 * "no tests ran" is not a degraded proof, it is the absence of one. In the limit
 * a machine with none of the four binaries installed would otherwise deliver
 * green with zero gates executed.
 */
function noEvidenceRefusal(gates: VerifyGate[], warnings: string[]): string | null {
  if (gates.length === 0) return null;
  const notRun = (g: VerifyGate) => g.status === "not-run";
  const testGates = gates.filter((g) => g.name === "test");
  const quoted = quoteNotRunWarnings(warnings);
  if (testGates.length > 0 && testGates.every(notRun)) {
    return (
      `no test evidence — every recorded \`test\` gate was not run${quoted}. ` +
      `Install the test runner (or pin one in \`.marvin/config.json\`) and re-run ` +
      `/marvin:task-verify. No input waives this refusal.`
    );
  }
  if (gates.every(notRun)) {
    return (
      `no evidence — every recorded gate was not run${quoted}. ` +
      `Install the missing tooling (or pin gate commands in \`.marvin/config.json\`) and re-run ` +
      `/marvin:task-verify. No input waives this refusal.`
    );
  }
  return null;
}

/** Quote the run's own not-run warnings, which name each gate and its token. */
function quoteNotRunWarnings(warnings: string[]): string {
  const relevant = warnings.filter((w) => w.startsWith(NOT_RUN_WARNING_PREFIX));
  return relevant.length ? ` — ${relevant.join("; ")}` : "";
}

/** The context every delivery decision carries beside its reason. */
interface GateExtras {
  artifactPath: string;
  allowStale: boolean;
  staleness?: Staleness;
  redGreen?: RedGreen;
}

/** Render an ALLOW/BLOCK delivery decision with a machine-readable block. */
function gateResult(
  decision: "ALLOW" | "BLOCK",
  verdict: string | null,
  reason: string,
  extras: GateExtras,
): ToolResult {
  // `staleness` and `red_green` are SIBLINGS of the two-valued decision, never a
  // third decision value: /marvin:task-deliver branches exactly two ways.
  const staleness: Staleness = extras.staleness ?? "unknown";
  const redGreen: RedGreen = extras.redGreen ?? "unknown";
  const machine = JSON.stringify({
    decision,
    verdict,
    reason,
    staleness,
    red_green: redGreen,
    artifactPath: extras.artifactPath,
    allowStale: extras.allowStale,
  });
  const md = [
    `# Delivery Gate`,
    ``,
    `**Decision:** ${decision}`,
    `**Verdict:** ${verdict ?? "—"}`,
    `**Freshness:** ${staleness}`,
    `**Red-green:** ${redGreen}`,
    `**Artifact:** \`${extras.artifactPath}\``,
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
