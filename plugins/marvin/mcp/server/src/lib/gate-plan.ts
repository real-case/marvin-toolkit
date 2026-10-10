import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Which gates run for a project: the one resolver `verify` and the autopilot pipeline's gate
 * stage share (D-GATEPLAN). Both overlay `.marvin/config.json` `gates` on stack detection
 * (ADR-0009) and append `gates.extra`, so a standard gate the config leaves out is still found by
 * detection in the stage that judges the executor, not only in the executor's own self-check, and
 * the two can never disagree about a project's plan. Both also share the pre-flight probe
 * (`planGates`) that records a gate whose binary is absent as `not-run`: detection adds gates
 * such as `ruff check .` that a project may never have installed, and a stage that failed them
 * where `verify` warns would reject every iteration of a change `verify` passes. Nothing here
 * runs a gate: it reads marker files and the project's declared scripts, asks the shell whether
 * a command's first word resolves, and returns commands.
 */

export const GATE_NAMES = ["test", "lint", "typecheck", "build"] as const;
export type GateName = (typeof GATE_NAMES)[number];

/** The `Stacks:` entry that shows `.marvin/config.json` took part in building the plan. */
export const CONFIG_STACK = ".marvin/config.json";

/**
 * A single gate: a label and the shell command that runs it. The label is one of the four
 * standard names, or — for a `gates.extra` entry, flagged by `extra` — the project's own.
 */
export interface GateSpec {
  name: string;
  command: string;
  extra?: true;
}

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

export interface StackDetector {
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
export const STACK_DETECTORS: StackDetector[] = [
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

/** The part of `.marvin/config.json` `gates` the plan reads: the four commands and the extras. */
export interface ConfigGates {
  test?: string;
  lint?: string;
  typecheck?: string;
  build?: string;
  extra?: readonly { name: string; command: string }[];
}

export interface GatePlanInput {
  projectRoot: string;
  /** `.marvin/config.json` `gates`, or undefined when the project declares none. */
  gates: ConfigGates | undefined;
  /** Explicit per-call gates, bypassing detection and config alike (`verify`'s `gates`). */
  explicit?: readonly { name: GateName; command: string }[];
  /** A detector id that skips filesystem detection (`verify`'s `stack`). */
  stack?: string;
  /** Run only these standard gates (`verify`'s `only`); present, it leaves the extras out. */
  only?: readonly GateName[];
}

export interface GatePlan {
  /** What the report's `Stacks:` line names; `.marvin/config.json` when config took part. */
  stacks: string[];
  /** The standard gates before `only` narrows them. */
  detected: GateSpec[];
  /** The standard gates that run: `detected`, narrowed by `only`. */
  standard: GateSpec[];
  /** `gates.extra`, in declaration order; empty whenever `usesExtras` is false. */
  extra: GateSpec[];
  /** Whether the project's extras belong in this plan: not with explicit gates or `only`. */
  usesExtras: boolean;
  /** Everything that runs: `standard`, then `extra`. */
  gates: GateSpec[];
}

/**
 * The plan for a project, in precedence order:
 *   1. explicit per-call `gates` — wholesale override (testing / programmatic).
 *   2. config-declared gates (`.marvin/config.json`) — per-gate, config wins.
 *   3. auto-detection — stack table, then declared-command fallback.
 * (1) is for the caller that already knows the plan; (2) is the durable,
 * stack-agnostic project declaration (ADR-0009); (3) is the convenience default.
 *
 * `gates.extra` is a config-declared addition to the standard plan, so a caller that names its
 * own gates (explicit `gates`) or selects some (`only`, which can only name standard gates) gets
 * exactly those and none of the project's extras.
 */
export function resolveGatePlan(input: GatePlanInput): GatePlan {
  const configGates = gateSpecsFromConfig(input.gates);
  const resolved = resolveStandard(input, configGates);
  const usesExtras = !(input.explicit?.length || input.only);
  const extra = usesExtras ? extraGateSpecs(input.gates) : [];
  let standard = resolved.gates;
  if (input.only) {
    const only: readonly string[] = input.only;
    standard = standard.filter((g) => only.includes(g.name));
  }
  const stacks =
    extra.length > 0 && !resolved.stacks.includes(CONFIG_STACK)
      ? [...resolved.stacks, CONFIG_STACK]
      : resolved.stacks;
  return {
    stacks,
    detected: resolved.gates,
    standard,
    extra,
    usesExtras,
    gates: [...standard, ...extra],
  };
}

// ── the pre-flight availability probe (ADR-0035) ────────────────────────────

/**
 * Anything that makes a command more than one simple invocation — a chain, a
 * pipe, a substitution, a redirection, a glob, a quote. Its presence is the
 * signal to abstain, and it doubles as the injection screen: a command that
 * reaches the probe provably contains no metacharacter, so neither can the
 * token interpolated into `sh -c`.
 */
export const SHELL_METACHARACTERS = /[|&;<>()$`\\"'*?[\]{}~#\n]/;

export type Probe =
  { kind: "abstain" } | { kind: "available" } | { kind: "missing"; token: string };

const ABSTAIN: Probe = { kind: "abstain" };

/** A gate paired with the pre-flight answer for its command, so the two cannot
 * drift apart on the way into the runner. */
export interface PlannedGate {
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
export function planGates(gates: readonly GateSpec[], cwd: string): PlannedGate[] {
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

/** Which of the two no-evidence cases a set of gates falls in; see {@link evidenceGap}. */
export type EvidenceGap = "test" | "all";

/**
 * Whether gates that did not all run still prove anything, judged the one way `verify`'s delivery
 * gate refuses on (ADR-0035) and the pipeline's gate stage blocks on (D-GATEPLAN), so that the
 * stage cannot accept a change the executor's own delivery gate would refuse:
 *   - `test`: at least one gate named `test` is planned and none of them ran;
 *   - `all`: at least one gate is planned and none ran at all.
 * A gate that did not run is one the pre-flight probe found no binary for. "No tests ran" is
 * not a degraded proof but the absence of one, which is why it is the one `not-run` no input
 * waives. An empty list is neither case: `verify` writes no verdict for a plan with no gates, so
 * its delivery gate never reads one, and the stage, which has a plan in hand, judges it itself.
 */
export function evidenceGap(gates: readonly { name: string; ran: boolean }[]): EvidenceGap | null {
  if (gates.length === 0) return null;
  const tests = gates.filter((g) => g.name === "test");
  if (tests.length > 0 && tests.every((g) => !g.ran)) return "test";
  if (gates.every((g) => !g.ran)) return "all";
  return null;
}

/**
 * A stack id for the oracle resolver's default table, ONLY when detection is unambiguous. A
 * polyglot tree matching two detectors names none: the table's admission criterion is that
 * exactly one single-test runner is in play, and guessing between two is the inference the
 * whole resolver refuses to make.
 */
export function unambiguousStackId(projectRoot: string): string | undefined {
  const matched = STACK_DETECTORS.filter((d) => d.detect(projectRoot));
  return matched.length === 1 ? matched[0]!.id : undefined;
}

function resolveStandard(
  input: GatePlanInput,
  configGates: GateSpec[],
): { stacks: string[]; gates: GateSpec[] } {
  if (input.explicit && input.explicit.length > 0) {
    return { stacks: ["explicit"], gates: [...input.explicit] };
  }
  const base = detectBase(input, input.projectRoot);
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
  input: { stack?: string },
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
  return { stacks: [...base.stacks, CONFIG_STACK], gates };
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

/** Map the `.marvin/config.json` `gates.extra` list to gate specs, in declaration order. */
function extraGateSpecs(
  gates: { extra?: readonly { name: string; command: string }[] } | undefined,
): GateSpec[] {
  return (gates?.extra ?? []).map((g) => ({ name: g.name, command: g.command, extra: true }));
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
