import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { childGitViolation } from "../../../pipeline/hooks/child-git-guard.mjs";
import { importTs } from "./_tsload.mjs";

const { ChildOutputSchemas, decide, PR_URL_PATTERN } = await importTs("src/pipeline/engine.ts");
const { parseRetro } = await importTs("src/pipeline/learning.ts");
const { classify } = await importTs("src/pipeline/wait.ts");
const { initRun, ROLES } = await importTs("src/pipeline/run-store.ts");
const { loadRubric } = await importTs("src/pipeline/assess.ts");
const { scanChecks, SEVERITIES } = await importTs("src/pipeline/gate.ts");
const { LESSON_TYPES } = await importTs("src/storage/lessons.ts");

const pipelineDir = fileURLToPath(new URL("../../../pipeline/", import.meta.url));
const rolesDir = join(pipelineDir, "roles");
const schemasDir = join(pipelineDir, "schemas");
const rubric = loadRubric(readFileSync(join(pipelineDir, "rubric.default.yaml"), "utf8"), null);
const roleText = (name) => readFileSync(join(rolesDir, `${name}.md`), "utf8");
const skillText = (name) =>
  readFileSync(join(pipelineDir, "..", "skills", name, "SKILL.md"), "utf8");
/** Whitespace-normalised, so a phrase is found across a wrapped line. */
const flat = (text) => text.replace(/\s+/g, " ");
const NOW = new Date("2026-10-04T10:00:00Z");
const PR = "https://github.com/tesari-ai/osint/pull/42";

/**
 * The variables each role's context template uses, split by who supplies them. `engine` is what
 * `decide` puts into a fresh spawn's context, and a test below derives it from `decide` itself.
 * `runtime` is what Task 13's `spawnChild` is to add, and is only declared here: no runtime exists
 * yet to derive it from, so this half proves nothing about one. When Task 13 lands, the list moves
 * into `src/pipeline/`, this file imports it, and Task 13's prompt test renders these five
 * templates through `composePrompts` with what `spawnChild` builds (the todo at the end of this
 * file). A resumed spawn renders no template at all: it sends its `message` alone.
 *
 * `orchestrator` and `child` are in every role's half because `common.md` sends progress reports
 * to the orchestrator the TASK CONTEXT names, signed with the child's own name. The heartbeat
 * reminder names both as well, but only once its interval has passed, so a child with something
 * to report in its first minutes has no other way to learn either.
 */
const ADDRESS = ["child", "orchestrator"];
const TEMPLATE_VARS = {
  planner: { engine: ["critic_cap", "task"], runtime: [...ADDRESS, "lessons"] },
  "test-author": {
    engine: ["feedback", "spec"],
    runtime: [...ADDRESS, "lessons", "test_path_pattern"],
  },
  executor: {
    engine: ["base", "branch", "findings", "iteration", "run", "sealed", "spec", "tier"],
    runtime: [...ADDRESS, "lessons"],
  },
  verifier: {
    engine: [
      "base",
      "branch",
      "claims",
      "gate_report",
      "iteration",
      "pr",
      "previous",
      "sealed",
      "spec",
    ],
    runtime: [...ADDRESS, "conventions", "lessons"],
  },
  retro: {
    engine: [],
    runtime: [...ADDRESS, "aggregate", "efficacy", "lessons", "lessons_index"],
  },
};

const schemaCache = new Map();
const schemaOf = (role) => {
  if (!schemaCache.has(role)) {
    const text = readFileSync(join(schemasDir, `${role}.schema.json`), "utf8");
    schemaCache.set(role, JSON.parse(text));
  }
  return schemaCache.get(role);
};

/**
 * The keywords each type may use. `claude --json-schema` (CLI 2.1.285, read from its bundle)
 * compiles the schema with ajv (`allErrors`, formats off) and checks the StructuredOutput call
 * against it, so a mismatch goes back to the child as a tool error to correct in the same session.
 * It constrains decoding only for a schema within a narrower set (type, properties, required,
 * additionalProperties, items, enum, const, anyOf, description, title); the bounds below already
 * put every role outside it, so `pattern` costs nothing more. The set is kept small so that the
 * validator in this file can implement all of it, and ajv checks that validator on every sample.
 * Every `pattern` is compiled with the `u` flag, as ajv compiles it.
 */
const KEYWORDS = {
  object: new Set(["type", "properties", "required", "additionalProperties"]),
  array: new Set(["type", "items", "minItems", "maxItems"]),
  string: new Set(["type", "enum", "minLength", "maxLength", "pattern"]),
  integer: new Set(["type"]),
  boolean: new Set(["type"]),
};
const patternOf = (source) => new RegExp(source, "u");
const isCount = (n) => Number.isInteger(n) && n >= 0;
const BOUNDS = [
  ["minItems", "maxItems"],
  ["minLength", "maxLength"],
];

/** What makes `node` something other than a closed schema in the subset, one line per problem. */
function schemaProblems(node, at = "(root)") {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    return [`${at}: not a schema object`];
  }
  const allowed = KEYWORDS[node.type];
  if (!allowed) return [`${at}: type ${JSON.stringify(node.type)} is outside the subset`];
  const out = Object.keys(node)
    .filter((k) => !allowed.has(k))
    .map((k) => `${at}: ${k} is outside the subset for ${node.type}`);
  for (const [lo, hi] of BOUNDS) {
    for (const k of [lo, hi]) {
      if (node[k] !== undefined && !isCount(node[k])) out.push(`${at}: ${k} is not a count`);
    }
    if (isCount(node[lo]) && isCount(node[hi]) && node[lo] > node[hi]) {
      out.push(`${at}: ${lo} exceeds ${hi}`);
    }
  }
  if (node.type === "object") {
    if (node.additionalProperties !== false) out.push(`${at}: additionalProperties is not false`);
    const props = node.properties;
    if (props === null || typeof props !== "object" || Object.keys(props).length === 0) {
      return [...out, `${at}: no properties`];
    }
    const required = node.required ?? [];
    if (!Array.isArray(required) || new Set(required).size !== required.length) {
      out.push(`${at}: required is not a list of distinct names`);
    } else {
      for (const r of required) {
        if (!Object.hasOwn(props, r)) out.push(`${at}: ${r} is required but not a property`);
      }
    }
    for (const [k, v] of Object.entries(props)) out.push(...schemaProblems(v, `${at}.${k}`));
  }
  if (node.type === "array") out.push(...schemaProblems(node.items, `${at}[]`));
  if (node.pattern !== undefined) {
    try {
      patternOf(node.pattern);
    } catch {
      out.push(`${at}: pattern does not compile with the u flag`);
    }
  }
  if (node.enum !== undefined) {
    const e = node.enum;
    const distinctStrings =
      Array.isArray(e) &&
      e.length > 0 &&
      e.every((v) => typeof v === "string") &&
      new Set(e).size === e.length;
    if (!distinctStrings) out.push(`${at}: enum is not a list of distinct strings`);
  }
  return out;
}

/** Why the schema refuses `value`, or [] when it accepts it; lengths count code points, as ajv does. */
function refusals(node, value, at = "(root)") {
  switch (node.type) {
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return [`${at}: not an object`];
      }
      const out = (node.required ?? [])
        .filter((k) => !Object.hasOwn(value, k))
        .map((k) => `${at}: ${k} is missing`);
      for (const [k, v] of Object.entries(value)) {
        const sub = node.properties[k];
        out.push(...(sub ? refusals(sub, v, `${at}.${k}`) : [`${at}: ${k} is not a property`]));
      }
      return out;
    }
    case "array": {
      if (!Array.isArray(value)) return [`${at}: not an array`];
      const out = [];
      if (value.length < (node.minItems ?? 0)) out.push(`${at}: fewer than ${node.minItems}`);
      if (value.length > (node.maxItems ?? Infinity)) out.push(`${at}: more than ${node.maxItems}`);
      value.forEach((v, i) => out.push(...refusals(node.items, v, `${at}[${i}]`)));
      return out;
    }
    case "string": {
      if (typeof value !== "string") return [`${at}: not a string`];
      const length = [...value].length;
      const out = [];
      if (node.enum && !node.enum.includes(value)) out.push(`${at}: ${value} is not in the enum`);
      if (length < (node.minLength ?? 0)) out.push(`${at}: shorter than ${node.minLength}`);
      if (length > (node.maxLength ?? Infinity)) out.push(`${at}: longer than ${node.maxLength}`);
      if (node.pattern !== undefined && !patternOf(node.pattern).test(value)) {
        out.push(`${at}: does not match ${node.pattern}`);
      }
      return out;
    }
    case "integer":
      return Number.isInteger(value) ? [] : [`${at}: not an integer`];
    case "boolean":
      return typeof value === "boolean" ? [] : [`${at}: not a boolean`];
    default:
      return [`${at}: unknown type ${node.type}`];
  }
}

/**
 * ajv arrives with the MCP SDK this server depends on. When it resolves, it compiles every schema
 * in strict mode and must agree with the subset validator on every sample, so the validator the
 * assertions rely on is checked against a real implementation rather than trusted.
 */
const Ajv = await import("ajv").then(
  (m) => m.default?.default ?? m.default,
  () => null,
);
const compiled = new Map();
const ajvValidate = (role) => {
  if (!compiled.has(role)) {
    compiled.set(role, new Ajv({ strict: true, allErrors: true }).compile(schemaOf(role)));
  }
  return compiled.get(role);
};

/** The schema's refusals for `value`, cross-checked with ajv when ajv is there. */
function judge(role, value) {
  const own = refusals(schemaOf(role), value);
  if (Ajv) {
    assert.equal(
      ajvValidate(role)(value),
      own.length === 0,
      `ajv and the subset validator disagree on ${role} ${JSON.stringify(value)}: ${own.join("; ")}`,
    );
  }
  return own;
}

/** Why the engine refuses this output, or null. The retro is read twice: by `decide`, at finalize. */
function engineRefusal(role, value) {
  const parsed = ChildOutputSchemas[role].safeParse(value);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "invalid";
  if (role === "retro") {
    try {
      parseRetro(value);
    } catch (error) {
      return error.message;
    }
  }
  return null;
}

/** What `wait` makes of a finished child whose structured output is `structured`. */
const resultOf = (structured) =>
  classify({
    exitCode: 0,
    result: { type: "result", session_id: "s", total_cost_usd: 0.1, structured_output: structured },
    idleMs: 0,
    stallMs: 60_000,
  });

const question = (id, extra = {}) => ({
  id,
  text: `Should the filter keep its state in the URL (${id})?`,
  recommendation: "yes, as the other filters do",
  why_blocking: "it decides the component's props",
  ...extra,
});
const SPEC = {
  path: ".marvin/task/012-tag-filter.md",
  slug: "tag-filter",
  risk: "medium",
  files: 4,
  criteria: 3,
  sealed: true,
};
const DISPUTE = {
  path: "src/tag-filter.test.ts",
  reason: "AC2 asks for a debounce the spec never mentions",
  evidence: "spec AC2 says filter on every keystroke; the test waits 300 ms",
};
const GATES = [
  { name: "test", result: "pass" },
  { name: "lint", result: "fail" },
  { name: "build", result: "not-run" },
];
const SHA = "0123456789abcdef0123456789abcdef01234567";
const FINDING = {
  id: "V1",
  severity: "major",
  category: "regression",
  criterion: "AC2",
  file: "src/tag-filter.tsx",
  line: 42,
  claim: "an empty tag list renders nothing",
  evidence: "src/tag-filter.tsx:42 returns null when tags is []",
  expected: "the empty state from the spec",
};
const CHECK = {
  id: "no-console-log",
  pattern: "console\\.log\\(",
  path_pattern: "^src/",
  exclude_pattern: "\\.test\\.ts$",
  message: "console.log left in",
  severity: "major",
  category: "convention",
  evidence: ["V3"],
};
const PROPOSAL = {
  target: "marvin",
  file: "plugins/marvin/pipeline/roles/executor.md",
  change: "name the single gate to re-run after a lint finding",
  rationale: "the executor re-ran every gate for a one-line lint fix",
  evidence: ["G1"],
};
const LESSON = {
  type: "gotcha",
  title: "Vitest needs the run subcommand outside watch mode",
  body: "Run `vitest run <file>`; a bare `vitest <file>` waits for changes and the gate times out.",
  tags: ["vitest", "role:executor"],
  target_category: "gate",
  evidence: ["G2"],
};
const PRUNE = { id: "old-lesson", reason: "prune-candidate: no drop after 6 exposed runs" };
const emptyRetro = {
  status: "done",
  summary: "nothing to learn",
  checks: [],
  proposals: [],
  lessons: [],
  prune: [],
};
const retroWith = (patch) => ({ ...emptyRetro, ...patch });

/**
 * Per role: outputs the engine reads (`parsed`: the smallest and the fullest of each status) and
 * one with status "failed", which `wait` classifies as a child fault before any schema reads it.
 */
const SAMPLES = {
  planner: {
    parsed: [
      { status: "needs_input", summary: "two designs fit", questions: [question("Q1")] },
      { status: "spec_ready", summary: "spec sealed", spec: SPEC },
      {
        status: "needs_input",
        summary: "four points block the spec",
        questions: ["Q1", "Q2", "Q3", "Q4"].map((id) => question(id, { options: ["yes", "no"] })),
        assumptions: ["the filter is client-side"],
      },
      {
        status: "spec_ready",
        summary: "spec sealed",
        questions: [],
        spec: { ...SPEC, critic: "PASS WITH WARNINGS", overrides: ["W2: the copy is product's"] },
        assumptions: ["the filter is client-side", "Q1 answered by the orchestrator"],
      },
    ],
    failed: { status: "failed", summary: "no spec", failure: "the spec tool is unreachable" },
  },
  "test-author": {
    parsed: [
      {
        status: "done",
        summary: "one test",
        tests: [{ path: "src/tag-filter.test.ts", criteria: ["AC1"] }],
      },
      {
        status: "done",
        summary: "two tests, one criterion left to the verifier",
        tests: [
          { path: "src/tag-filter.test.ts", criteria: ["AC1", "AC2"] },
          { path: "e2e/tag-filter.spec.ts", criteria: ["AC3"] },
        ],
        untestable: [{ criterion: "AC4", reason: "a visual judgement" }],
      },
    ],
    failed: {
      status: "failed",
      summary: "no tests",
      tests: [],
      failure: "the test runner does not start",
    },
  },
  executor: {
    parsed: [
      { status: "done", summary: "implemented" },
      { status: "needs_input", summary: "blocked", questions: [question("Q1")] },
      { status: "needs_input", summary: "a sealed test is wrong", dispute: DISPUTE },
      {
        status: "done",
        summary: "implemented, gates green, draft PR open",
        branch: "feature/OSI-TBD--tag-filter",
        head_sha: SHA,
        pr_url: PR,
        gates: GATES,
        findings_addressed: [{ id: "V1", resolution: "fixed: the empty state renders" }],
        claims: ["src/tag-filter.tsx renders the empty state from AC2"],
        questions: [],
      },
      {
        status: "needs_input",
        summary: "blocked on a dispute and a product point",
        branch: "feature/OSI-TBD--tag-filter",
        head_sha: SHA,
        pr_url: PR,
        gates: GATES,
        findings_addressed: [{ id: "V2", resolution: "disputed: AC3 names no limit" }],
        claims: [],
        questions: ["Q1", "Q2", "Q3", "Q4"].map((id) => question(id, { options: ["a", "b"] })),
        dispute: DISPUTE,
      },
    ],
    failed: { status: "failed", summary: "nothing done", failure: "npm ci fails in the worktree" },
  },
  verifier: {
    parsed: [
      {
        status: "done",
        verdict: "PASS",
        summary: "every criterion met",
        criteria: [{ id: "AC1", result: "met", evidence: "src/tag-filter.test.ts filters by tag" }],
        findings: [],
      },
      {
        status: "done",
        verdict: "FAIL",
        summary: "AC2 unmet",
        criteria: [
          { id: "AC1", result: "met", evidence: "src/tag-filter.test.ts filters by tag" },
          { id: "AC2", result: "unmet", evidence: "src/tag-filter.tsx:42 returns null" },
          { id: "AC3", result: "unverifiable", evidence: "a visual judgement" },
        ],
        findings: [FINDING, { ...FINDING, id: "V2", severity: "minor", category: "convention" }],
        previous_findings: [{ id: "V0", state: "fixed" }],
      },
    ],
    failed: {
      status: "failed",
      verdict: "FAIL",
      summary: "could not review",
      criteria: [{ id: "AC1", result: "unverifiable", evidence: "the branch could not be read" }],
      findings: [],
      failure: "git refuses to read the worktree",
    },
  },
  retro: {
    parsed: [
      emptyRetro,
      retroWith({ checks: [CHECK], proposals: [PROPOSAL], lessons: [LESSON], prune: [PRUNE] }),
    ],
    failed: { ...emptyRetro, status: "failed", failure: "the run aggregate is unreadable" },
  },
};

const withCheck = (patch) => retroWith({ checks: [{ ...CHECK, ...patch }] });
const withProposal = (patch) => retroWith({ proposals: [{ ...PROPOSAL, ...patch }] });
const withLesson = (patch) => retroWith({ lessons: [{ ...LESSON, ...patch }] });
const withPrune = (patch) => retroWith({ prune: [{ ...PRUNE, ...patch }] });

/**
 * What the schemas leave to the engine: a condition across fields, whether a check's own regular
 * expression compiles and is safe to run, a spec path's canonical form, and the one lesson title
 * the lesson store reserves for its index. The first would need `if`/`then`, which nothing here
 * shows the model API takes in a tool's schema; the second needs a parser; the last two would
 * each be a pattern too intricate to review as a copy of the code it mirrors. The role prompts
 * state these rules instead (`PROMPT_RULES` below pins that), and the engine refuses output that
 * breaks one the way it refuses any invalid output (a retry, then a halt; for the retro, at
 * finalize). Pinned so that the distance between each schema and the engine is known rather than
 * assumed away.
 */
const GAPS = [
  ["planner", "needs_input without a question", { status: "needs_input", summary: "s" }],
  ["planner", "spec_ready without a spec", { status: "spec_ready", summary: "s" }],
  [
    "planner",
    "spec_ready that still asks",
    { status: "spec_ready", summary: "s", spec: SPEC, questions: [question("Q1")] },
  ],
  [
    "planner",
    "an absolute spec path",
    { status: "spec_ready", summary: "s", spec: { ...SPEC, path: "/repo/specs/1-x.md" } },
  ],
  [
    "executor",
    "needs_input with no question and no dispute",
    { status: "needs_input", summary: "s" },
  ],
  [
    "executor",
    "done that still asks",
    { status: "done", summary: "s", questions: [question("Q1")] },
  ],
  ["executor", "done that still disputes", { status: "done", summary: "s", dispute: DISPUTE }],
  ["retro", "a pattern that does not compile", retroWith({ checks: [{ ...CHECK, pattern: "(" }] })],
  [
    "retro",
    "a pattern with a nested quantifier",
    retroWith({ checks: [{ ...CHECK, pattern: "(a+)+$" }] }),
  ],
  ["retro", "a lesson title that slugs to the lesson index", withLesson({ title: "Memory." })],
];

/**
 * The converse: wherever a keyword in the set can state an engine rule (a bound, an enum, a
 * required field, an integer, a pattern), the schema states it, so the CLI turns the output away
 * in the child's own session, where correcting it is cheap, rather than the engine discarding the
 * whole session. Each sample breaks one rule at its boundary and must be refused by both.
 */
const verifierWith = (patch) => ({ ...SAMPLES.verifier.parsed[0], ...patch });
const times = (n, item) => Array.from({ length: n }, () => item);
const long = (n) => "a".repeat(n);
const MIRRORED = [
  ["planner", "a status the engine does not know", { status: "blocked", summary: "s" }],
  [
    "planner",
    "a question with an empty id",
    { status: "needs_input", summary: "s", questions: [question("")] },
  ],
  [
    "executor",
    "a dispute without evidence",
    { status: "needs_input", summary: "s", dispute: { path: DISPUTE.path, reason: "r" } },
  ],
  [
    "executor",
    "a pull request URL off github.com",
    { status: "done", summary: "s", pr_url: "https://example.com/pull/1" },
  ],
  ["test-author", "no tests list", { status: "done", summary: "s" }],
  ["verifier", "no criteria", verifierWith({ criteria: [] })],
  [
    "verifier",
    "a criterion result the engine does not know",
    verifierWith({ criteria: [{ id: "AC1", result: "partial", evidence: "e" }] }),
  ],
  ["verifier", "a fractional line", verifierWith({ findings: [{ ...FINDING, line: 1.5 }] })],
  [
    "verifier",
    "an unknown severity",
    verifierWith({ findings: [{ ...FINDING, severity: "high" }] }),
  ],
  ["retro", "no prune list", { ...emptyRetro, prune: undefined }],
  ["retro", "eleven checks", retroWith({ checks: times(11, CHECK) })],
  ["retro", "twenty-one proposals", retroWith({ proposals: times(21, PROPOSAL) })],
  ["retro", "eleven lessons", retroWith({ lessons: times(11, LESSON) })],
  ["retro", "fifty-one prune items", retroWith({ prune: times(51, PRUNE) })],
  ["retro", "a check id over 64", retroWith({ checks: [{ ...CHECK, id: long(65) }] })],
  ["retro", "a pattern over 500", retroWith({ checks: [{ ...CHECK, pattern: long(501) }] })],
  ["retro", "a check category over 64", retroWith({ checks: [{ ...CHECK, category: long(65) }] })],
  [
    "retro",
    "a proposal file over 200",
    retroWith({ proposals: [{ ...PROPOSAL, file: long(201) }] }),
  ],
  ["retro", "an unknown lesson type", retroWith({ lessons: [{ ...LESSON, type: "trivia" }] })],
  ["retro", "a lesson title over 200", retroWith({ lessons: [{ ...LESSON, title: long(201) }] })],
  ["retro", "a lesson body over 4000", retroWith({ lessons: [{ ...LESSON, body: long(4001) }] })],
  ["retro", "a lesson tag over 64", retroWith({ lessons: [{ ...LESSON, tags: [long(65)] }] })],
  ["retro", "a prune id over 200", retroWith({ prune: [{ ...PRUNE, id: long(201) }] })],
  ["retro", "a check id with an underscore", withCheck({ id: "no_log" })],
  ["retro", "a check id that starts with a hyphen", withCheck({ id: "-no-log" })],
  ["retro", "a check category that starts with an underscore", withCheck({ category: "_gate" })],
  ["retro", "a check message of whitespace", withCheck({ message: " \n " })],
  ["retro", "a proposal file on two lines", withProposal({ file: "a.md\nb.md" })],
  ["retro", "a proposal change of whitespace", withProposal({ change: "   " })],
  ["retro", "a proposal rationale of whitespace", withProposal({ rationale: "\t" })],
  ["retro", "a lesson title with a square bracket", withLesson({ title: "[x] a rule" })],
  ["retro", "a lesson title on two lines", withLesson({ title: "a rule\nand another" })],
  ["retro", "a lesson title of whitespace", withLesson({ title: "   " })],
  ["retro", "a lesson body of whitespace", withLesson({ body: "\n\n" })],
  ["retro", "a lesson tag with a comma", withLesson({ tags: ["vitest,jest"] })],
  ["retro", "a lesson tag with a line break", withLesson({ tags: ["a\nb"] })],
  ["retro", "a lesson tag of whitespace", withLesson({ tags: [" "] })],
  ["retro", "a target: tag", withLesson({ tags: ["target:gate"] })],
  ["retro", "a target: tag in another case, indented", withLesson({ tags: ["  Target:gate"] })],
  ["retro", "a target category in capitals", withLesson({ target_category: "Gate" })],
  ["retro", "a target category with a space", withLesson({ target_category: "test quality" })],
  ["retro", "a prune id on two lines", withPrune({ id: "a\nb" })],
  ["retro", "a prune reason of whitespace", withPrune({ reason: " " })],
].map(([role, what, sample]) => [role, what, JSON.parse(JSON.stringify(sample))]);

/**
 * Where a schema's pattern is the engine's own rule rather than a stricter approximation of it,
 * the two must agree on every value, not only on the refusals above: a pattern that refused too
 * much would turn away output the engine needs. Each probe is set into one field of a valid
 * sample. The one-line fields are left out on purpose: their patterns also refuse a line break
 * the engine would trim away, which costs a child one correction and never a run.
 */
const AGREEMENT = [
  [
    "retro",
    "check id",
    (id) => withCheck({ id }),
    ["a", "0", "no-log", "a1-b2", long(64), long(65), "", "-x", "x_y", "A", "a b", "é"],
  ],
  ...["check category", "lesson target_category"].map((what) => [
    "retro",
    what,
    what === "check category"
      ? (category) => withCheck({ category })
      : (target_category) => withLesson({ target_category }),
    ["gate", "test-quality", "spec_drift", "0", long(64), long(65), "", "_x", "-x", "Gate", "a b"],
  ]),
  [
    "executor",
    "pr_url",
    (pr_url) => ({ status: "done", summary: "s", pr_url }),
    [
      PR,
      "https://github.com/a.b/c-d_e/pull/7",
      "http://github.com/a/b/pull/1",
      "https://github.com/a/b/pull/",
      "https://github.com/a/b/pull/1/files",
      "https://github.com/a/b/c/pull/1",
      "https://example.com/a/b/pull/1",
    ],
  ],
];

const at = (stage, patch = {}) => ({
  ...initRun({
    id: "r1",
    repoRoot: "/repo",
    base: "dev",
    lang: "ru",
    orchestratorName: "Autopilot",
    task: "задача",
    taskEnglish: "task",
    stageA: "standard",
    now: NOW,
  }),
  stage,
  branch: "feature/OSI-TBD--x",
  specPath: "specs/1-x.md",
  tier: "standard",
  ...patch,
});
const answer = (judgment, a) => ({ kind: "answer", judgment, answer: a });
const report = (passed) => ({
  passed,
  gates: [],
  undeclared: [],
  protected: [],
  protectedSources: {},
  protectedPatterns: [],
  checks: [],
  sealed: [],
  blockers: [],
});
const approve = answer("spec_approval", { kind: "approve" });
const sealedTest = { path: "src/a.test.ts", criteria: ["AC1"], sha256: "0".repeat(64) };

/** One decision for every way `decide` spawns a child, fresh or resumed. */
const SPAWNING = [
  ["intake", at("intake"), { kind: "start" }],
  ["approval, standard tier", at("awaiting_approval"), approve],
  ["approval, light tier", at("awaiting_approval", { tier: "light" }), approve],
  [
    "changes requested",
    at("awaiting_approval"),
    answer("spec_approval", { kind: "changes", text: "narrow it" }),
  ],
  [
    "planner answered",
    at("awaiting_answer", { awaitingRole: "planner" }),
    answer("planner_questions", { kind: "answers", text: "Q1: yes", count: 1 }),
  ],
  [
    "executor answered",
    at("awaiting_answer", { awaitingRole: "executor", iteration: 1 }),
    answer("executor_questions", { kind: "answers", text: "Q1: yes", count: 1 }),
  ],
  [
    "seal refused",
    at("test_authoring"),
    { kind: "seal", ok: false, reasons: ["no tests were authored"], sealed: [] },
  ],
  [
    "seal accepted",
    at("test_authoring"),
    { kind: "seal", ok: true, reasons: [], sealed: [sealedTest] },
  ],
  [
    "gate passed",
    at("gating", { iteration: 1, prUrl: PR, claims: ["src/a.ts adds x"] }),
    { kind: "gate", report: report(true), findings: [] },
  ],
  [
    "gate rejected",
    at("gating", { iteration: 1 }),
    { kind: "gate", report: report(false), findings: [] },
  ],
  [
    "unverified retried",
    at("verifying", { iteration: 1 }),
    answer("unverified", { kind: "retry" }),
  ],
  [
    "CI green",
    at("ci_wait", { iteration: 1, prUrl: PR, ciSince: NOW.toISOString() }),
    { kind: "ci", state: "green", failing: [] },
  ],
  [
    "halt cancelled",
    at("executing", { iteration: 1 }),
    answer("halt", { kind: "cancel", reason: "stopped" }),
  ],
];
let decided;
const spawns = () =>
  (decided ??= SPAWNING.flatMap(([name, run, obs]) => {
    const decision = decide(run, obs, rubric, NOW);
    return decision.actions
      .filter((a) => a.kind === "spawn")
      .map((action) => ({ name, decision, action }));
  }));

const templateVars = (role) => {
  const text = readFileSync(join(rolesDir, `${role}.context.md`), "utf8");
  const vars = [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  const opened = text.split("{{").length - 1;
  assert.equal(vars.length, opened, `${role}: a {{ the renderer would not replace`);
  return [...new Set(vars)].sort();
};

/** Every property path the schema declares, an array's items as `[]`. */
const declaredPaths = (node, at = "") =>
  node.type === "object"
    ? Object.entries(node.properties).flatMap(([k, v]) => [
        `${at}.${k}`,
        ...declaredPaths(v, `${at}.${k}`),
      ])
    : node.type === "array"
      ? declaredPaths(node.items, `${at}[]`)
      : [];
const presentPaths = (value, at = "") =>
  Array.isArray(value)
    ? value.flatMap((v) => presentPaths(v, `${at}[]`))
    : value !== null && typeof value === "object"
      ? Object.entries(value).flatMap(([k, v]) => [`${at}.${k}`, ...presentPaths(v, `${at}.${k}`)])
      : [];
/** Every enum below the root, with its path; an array step is index 0. */
const enumNodes = (node, path = []) =>
  node.type === "object"
    ? Object.entries(node.properties).flatMap(([k, v]) => enumNodes(v, [...path, k]))
    : node.type === "array"
      ? enumNodes(node.items, [...path, 0])
      : node.enum
        ? [{ path, values: node.enum }]
        : [];
const getAt = (value, path) => path.reduce((x, k) => (x == null ? undefined : x[k]), value);
const setAt = (value, path, leaf) => {
  const copy = structuredClone(value);
  path.slice(0, -1).reduce((x, k) => x[k], copy)[path.at(-1)] = leaf;
  return copy;
};

test("the roles and schemas directories hold exactly what the runtime composes, none naming Fable", () => {
  const roleFiles = ["common.md", ...ROLES.flatMap((r) => [`${r}.md`, `${r}.context.md`])].sort();
  const schemaFiles = ROLES.map((r) => `${r}.schema.json`).sort();
  assert.deepEqual(readdirSync(rolesDir).sort(), roleFiles);
  assert.deepEqual(readdirSync(schemasDir).sort(), schemaFiles);
  for (const [dir, files] of [
    [rolesDir, roleFiles],
    [schemasDir, schemaFiles],
  ]) {
    for (const f of files) assert.doesNotMatch(readFileSync(join(dir, f), "utf8"), /fable/i, f);
  }
});

test("the static role prompts hold no template variable, so a role's system prompt never varies", () => {
  for (const name of ["common", ...ROLES]) {
    const text = readFileSync(join(rolesDir, `${name}.md`), "utf8");
    assert.ok(text.trim().length > 0, name);
    assert.ok(!text.includes("{{"), name);
  }
});

test("each schema keeps to the keywords this file validates, closed at every object", () => {
  for (const role of ROLES) {
    assert.deepEqual(schemaProblems(schemaOf(role)), [], role);
    if (Ajv) assert.doesNotThrow(() => ajvValidate(role), role);
  }
});

test("the schemas offer exactly the engine's severities and lesson types", () => {
  const props = (role) => schemaOf(role).properties;
  assert.deepEqual(props("verifier").findings.items.properties.severity.enum, [...SEVERITIES]);
  assert.deepEqual(props("retro").checks.items.properties.severity.enum, [...SEVERITIES]);
  assert.deepEqual(props("retro").lessons.items.properties.type.enum, [...LESSON_TYPES]);
  assert.equal(props("executor").pr_url.pattern, PR_URL_PATTERN.source);
});

test("every output the engine reads, smallest and fullest, passes the schema and the engine", () => {
  for (const role of ROLES) {
    for (const sample of SAMPLES[role].parsed) {
      const shown = `${role} ${JSON.stringify(sample)}`;
      assert.deepEqual(judge(role, sample), [], shown);
      assert.equal(resultOf(sample).outcome, sample.status, shown);
      assert.equal(engineRefusal(role, sample), null, shown);
    }
  }
});

test("status failed is a child fault, classified before any schema reads it and retried once", () => {
  const fresh = (role) => spawns().find((s) => s.action.role === role && !s.action.resume);
  for (const role of ROLES) {
    const sample = SAMPLES[role].failed;
    assert.deepEqual(judge(role, sample), [], role);
    const result = resultOf(sample);
    assert.equal(result.outcome, "failed", role);
    const { decision, action } = fresh(role);
    const next = decide(decision.run, { kind: "child", role, result }, rubric, NOW);
    assert.equal(next.run.retries[role], 1, role);
    assert.deepEqual(next.actions, [action], role);
  }
});

test("the samples exercise every property and every status each schema declares", () => {
  for (const role of ROLES) {
    const schema = schemaOf(role);
    const all = [...SAMPLES[role].parsed, SAMPLES[role].failed];
    const present = new Set(all.flatMap((s) => presentPaths(s)));
    assert.deepEqual(
      declaredPaths(schema).filter((p) => !present.has(p)),
      [],
      role,
    );
    const statuses = [...new Set(SAMPLES[role].parsed.map((s) => s.status)), "failed"].sort();
    assert.deepEqual([...schema.properties.status.enum].sort(), statuses, role);
    assert.ok(schema.required.includes("status") && schema.required.includes("summary"), role);
  }
});

test("every enum value a schema offers below the status parses under the engine's schema", () => {
  for (const role of ROLES) {
    for (const { path, values } of enumNodes(schemaOf(role))) {
      if (path.join(".") === "status") continue;
      const host = SAMPLES[role].parsed.find((s) => getAt(s, path) !== undefined);
      assert.ok(host, `${role}: no sample holds ${path.join(".")}`);
      for (const value of values) {
        const sample = setAt(host, path, value);
        const shown = `${role} ${path.join(".")}=${value}`;
        assert.deepEqual(judge(role, sample), [], shown);
        assert.equal(engineRefusal(role, sample), null, shown);
      }
    }
  }
});

test("the rules the schemas leave to the engine are enforced by the engine", () => {
  for (const [role, what, sample] of GAPS) {
    assert.deepEqual(judge(role, sample), [], `${role}: the schema should accept ${what}`);
    assert.notEqual(engineRefusal(role, sample), null, `${role}: the engine should refuse ${what}`);
  }
});

test("where a keyword can state an engine rule, the schema refuses what the engine refuses", () => {
  for (const [role, what, sample] of MIRRORED) {
    assert.notDeepEqual(judge(role, sample), [], `${role}: the schema should refuse ${what}`);
    assert.notEqual(engineRefusal(role, sample), null, `${role}: the engine should refuse ${what}`);
  }
});

test("a pattern that copies an engine rule accepts exactly what the engine accepts", () => {
  for (const [role, what, sampleOf, probes] of AGREEMENT) {
    for (const probe of probes) {
      const sample = sampleOf(probe);
      const schemaTakes = judge(role, sample).length === 0;
      const engineTakes = engineRefusal(role, sample) === null;
      assert.equal(schemaTakes, engineTakes, `${role} ${what} ${JSON.stringify(probe)}`);
    }
  }
});

test("decide gives every fresh spawn of a role the same context keys, and a resume its message", () => {
  const seen = new Set();
  for (const { name, action } of spawns()) {
    const keys = Object.keys(action.context).sort();
    if (action.resume) {
      assert.deepEqual(keys, ["message"], name);
      continue;
    }
    assert.deepEqual(keys, TEMPLATE_VARS[action.role].engine, `${name}: ${action.role}`);
    seen.add(action.role);
  }
  assert.deepEqual([...seen].sort(), [...ROLES].sort());
});

test("each context template uses exactly the engine's variables and the runtime's declared ones", () => {
  for (const role of ROLES) {
    const { engine, runtime } = TEMPLATE_VARS[role];
    assert.deepEqual(
      engine.filter((v) => runtime.includes(v)),
      [],
      role,
    );
    assert.deepEqual(templateVars(role), [...engine, ...runtime].sort(), role);
  }
});

test("every context template names the orchestrator a report goes to and the child it is from", () => {
  for (const role of ROLES) {
    const vars = templateVars(role);
    for (const name of ADDRESS) assert.ok(vars.includes(name), `${role}: no {{${name}}}`);
  }
  assert.match(flat(roleText("common")), /to the orchestrator named in the TASK CONTEXT/);
});

/**
 * The rules a role prompt states because no schema keyword states them, or because the code it
 * describes behaves in a way the plan's wording got wrong. Each is found by a stable phrase in
 * the prompt the role reads, whitespace-normalised so a rewrap does not break it, and names the
 * code that makes it true. A rule reworded on purpose updates its phrase here; one dropped by
 * accident fails here instead of in a headless run nobody watches.
 */
const PROMPT_RULES = [
  // The schemas leave these to the engine (GAPS above).
  ["common", /finish your turn with it and your questions/, "needs_input requires a question"],
  ["planner", /status "spec_ready" and no questions/, "spec_ready must not carry questions"],
  ["planner", /`spec\.path` relative to the repo root/, "SpecPath is canonical and repo-relative"],
  ["executor", /Status "done" carries no questions and no dispute/, "ExecutorOutput refines"],
  ["executor", /status "needs_input" and fill `dispute`/, "needs_input takes a dispute alone"],
  ["executor", /`pr_url` = the draft PR's github\.com URL, which every "done" carries/, "decide()"],
  // decide() accepts the recommendations of the turn that crosses the question cap once, then
  // halts on the next needs_input; the task-start Critic row takes the recommendation past it.
  [
    "planner",
    /marked "recommendation accepted: question cap reached", never return "needs_input" again/,
    "the needs_input after a cap-accepted answer halts the run",
  ],
  [
    "planner",
    /ask while the question cap allows one, otherwise take your own recommendation/,
    "a surviving critic blocker past the question cap is not a question",
  ],
  ["retro", /backreference/, "regexHazard refuses a backreference and nested repetition"],
  ["retro", /never just the word "memory"/, "a title that slugs to the lesson index is refused"],
  // Charsets the schema states, repeated in prose so the retro gets them right first time.
  ["retro", /`id` is lowercase letters, digits and hyphens, starting with/, "CHECK_ID"],
  ["retro", /`target_category`[^.]* are lowercase letters, digits, `_` and `-`/, "CATEGORY"],
  ["retro", /a prune item's `id` are one line each/, "prune ids are oneLine"],
  // A failed output is classified before any schema reads it, yet the CLI still validates it.
  ["common", /still give every field your output schema requires/, "the CLI validates failed too"],
  ["verifier", /each criterion unverifiable/, "a failed verifier still lists one criterion"],
  // How the engine routes what the children report.
  ["verifier", /An unmet criterion also counts as a blocking finding/, "unmet becomes a blocker"],
  ["test-author", /a previously sealed test you revised/, "a re-seal replaces only what it names"],
  ["test-author", /keeps its old seal/, "mergeSealed keeps every seal a re-seal does not name"],
  ["executor", /record the resolution as `tests revised`/, "re-sealed executors get the faults"],
  ["executor", /do not invoke \/marvin:task-deliver yourself/, "task-implement chains into it"],
  // A re-seal raises the iteration without a delivery, so the iteration number says nothing.
  [
    "executor",
    /no pull request yet \(`gh pr view` finds none\)[^.]*whatever the iteration number/,
    "the first spawn after a re-seal may still have no pull request",
  ],
  // Only the verifier's own faults and `T-revise` are re-sealed; the gate's never are.
  ["executor", /`git checkout <seal commit> -- <path>`/, "the gate's T-<path> is never re-sealed"],
  ["executor", /then raise it as a `dispute`/, "a check hit or a mixed list is never re-sealed"],
];

test("each role prompt states the rules the engine enforces beyond its schema", () => {
  for (const [role, phrase, why] of PROMPT_RULES) {
    assert.match(flat(roleText(role)), phrase, `${role}.md: ${why}`);
  }
});

test("task-implement still chains into task-deliver, which executor.md relies on", () => {
  assert.match(
    flat(skillText("task-implement")),
    /auto-chains into `?\/marvin:task-verify`? and `?\/marvin:task-deliver/,
  );
});

test("a verifier fault in a sealed test reaches the re-sealed executor as the prompts describe", () => {
  const fault = { ...FINDING, id: "V7", category: "test-quality", file: sealedTest.path };
  const verified = decide(
    at("verifying", { iteration: 1, sealed: [sealedTest] }),
    {
      kind: "child",
      role: "verifier",
      result: resultOf({
        status: "done",
        verdict: "FAIL",
        summary: "the sealed test proves nothing",
        criteria: [{ id: "AC1", result: "met", evidence: "src/a.ts:3" }],
        findings: [fault],
      }),
    },
    rubric,
    NOW,
  );
  // The verifier's rule: a fault in a sealed test alone sends the tests back to their author.
  assert.equal(verified.run.stage, "test_authoring");
  // The author revised src/a.test.ts but listed only a new file: only the new file is sealed.
  const other = { path: "src/b.test.ts", criteria: ["AC2"], sha256: "2".repeat(64) };
  const resealed = decide(
    verified.run,
    { kind: "seal", ok: true, reasons: [], sealed: [other] },
    rubric,
    NOW,
  );
  // test-author.md: the revised file left out of `tests` keeps its old seal and its old hash.
  assert.deepEqual(resealed.run.sealed, [sealedTest, other]);
  // executor.md: the re-sealed executor is handed the test-quality fault on the sealed path...
  const spawn = resealed.actions.find((a) => a.kind === "spawn");
  assert.equal(spawn.role, "executor");
  assert.match(spawn.context.findings, /\[V7\] major\/test-quality src\/a\.test\.ts/);
  // ...and nothing executor.md reads as a fault the pipeline did not re-seal.
  assert.doesNotMatch(spawn.context.findings, /\[T-(?!revise\])|\[C-/);
});

/** The one spawn of `decision`, which must be an executor's: nothing went back to the tests. */
function executorSpawned(decision) {
  const spawned = decision.actions.filter((a) => a.kind === "spawn");
  assert.deepEqual(
    spawned.map((a) => a.role),
    ["executor"],
  );
  return { run: decision.run, spawn: spawned[0] };
}

/** The claim and the expected text `findingsText` renders for the finding with this id. */
function rendered(findings, id) {
  const line = findings.split("\n").find((l) => l.startsWith(`- [${id}] `));
  assert.ok(line, `no finding ${id} in:\n${findings}`);
  // `severity/category`, then ` file` or ` file:line` when the finding has one.
  const [, claim, expected] = /^- \[[^\]]+\] \S+(?: \S+)?: (.+) — expected: (.+)$/.exec(line) ?? [];
  assert.ok(claim && expected, line);
  return { claim, expected };
}

const RUN_BRANCH = { base: "dev", branch: "feature/OSI-TBD--x" };

test("a sealed-test fault the engine does not re-seal reaches the executor as executor.md tells", () => {
  const executor = flat(roleText("executor"));
  const sealedRun = (stage) => at(stage, { iteration: 1, prUrl: PR, sealed: [sealedTest] });
  /** The findings an executor is started on with the sealed tests exactly as they were. */
  const unrevised = (decision) => {
    const { run, spawn } = executorSpawned(decision);
    assert.equal(run.stage, "executing");
    assert.equal(spawn.context.iteration, "2");
    assert.deepEqual(run.sealed, [sealedTest], "nothing was re-sealed");
    assert.equal(run.testAuthorAttempts, 0, "the tests never went back to their author");
    return spawn.context.findings;
  };

  // The gate's hash check: this branch changed a sealed file, through Bash or a formatter.
  const hashed = unrevised(
    decide(
      sealedRun("gating"),
      {
        kind: "gate",
        report: { ...report(false), sealed: [{ path: sealedTest.path, ok: false }] },
        findings: [],
      },
      rubric,
      NOW,
    ),
  );
  assert.match(hashed, /^- \[T-src\/a\.test\.ts\] blocker\/test-quality src\/a\.test\.ts: /);
  // executor.md names it by the claim the gate renders, and its fix is a restore the guard allows.
  const { claim } = rendered(hashed, `T-${sealedTest.path}`);
  assert.ok(executor.includes(`("${claim}")`), `executor.md does not quote "${claim}"`);
  const restore = /`(git checkout <seal commit> -- <path>)`/.exec(executor)?.[1];
  assert.ok(restore, "executor.md gives no restore command");
  const command = restore.replace("<seal commit>", "0123abc").replace("<path>", sealedTest.path);
  assert.match(executor, /`git log -- <path>`/);
  for (const allowed of [command, `git log -- ${sealedTest.path}`]) {
    assert.equal(childGitViolation(allowed, RUN_BRANCH), null, allowed);
  }

  // A shipped check over the added lines, which include the pipeline's own seal commit.
  const checks = parse(readFileSync(join(pipelineDir, "checks.default.yaml"), "utf8"));
  const hits = scanChecks(
    [{ file: sealedTest.path, line: 3, text: '  it.skip("keeps the tag", () => {});' }],
    checks,
  );
  assert.deepEqual(
    hits.map((h) => [h.id, h.category, h.file]),
    [["skip", "test-quality", sealedTest.path]],
  );
  const caught = unrevised(
    decide(
      sealedRun("gating"),
      { kind: "gate", report: { ...report(true), checks: hits }, findings: [] },
      rubric,
      NOW,
    ),
  );
  assert.match(caught, /^- \[C-skip-1\] major\/test-quality src\/a\.test\.ts:3: /);
  // executor.md names a check hit by its id's shape and the expected text the gate renders.
  const { expected } = rendered(caught, "C-skip-1");
  assert.equal(expected, "no match for check skip");
  assert.match(executor, /a check hit \(`C-<check>-<n>`, expected "no match for check …"\)/);

  // A verifier fault in a sealed test, listed beside a blocking finding of another kind.
  const fault = { ...FINDING, id: "V7", category: "test-quality", file: sealedTest.path };
  const mixed = unrevised(
    decide(
      sealedRun("verifying"),
      {
        kind: "child",
        role: "verifier",
        result: resultOf({
          status: "done",
          verdict: "FAIL",
          summary: "a hollow sealed test and a regression",
          criteria: [{ id: "AC1", result: "met", evidence: "src/a.ts:3" }],
          findings: [fault, { ...FINDING, id: "V8" }],
        }),
      },
      rubric,
      NOW,
    ),
  );
  assert.match(mixed, /\[V7\] major\/test-quality src\/a\.test\.ts/);
  assert.match(mixed, /\[V8\] major\/regression src\/tag-filter\.tsx/);
  assert.match(executor, /listed beside a finding of another kind/);
});

test("a dispute answered with revise_tests restarts the executor with no pull request", () => {
  const asked = decide(
    at("executing", { iteration: 1, sealed: [sealedTest] }),
    {
      kind: "child",
      role: "executor",
      result: resultOf({
        status: "needs_input",
        summary: "a sealed test is wrong",
        dispute: DISPUTE,
      }),
    },
    rubric,
    NOW,
  );
  assert.equal(asked.run.stage, "awaiting_answer");
  assert.deepEqual(
    asked.actions.map((a) => a.judgment),
    ["executor_questions"],
  );
  const reopened = decide(
    asked.run,
    answer("executor_questions", { kind: "revise_tests", text: "drop the debounce" }),
    rubric,
    NOW,
  );
  assert.equal(reopened.run.stage, "test_authoring");
  const revised = { ...sealedTest, sha256: "1".repeat(64) };
  const { run, spawn } = executorSpawned(
    decide(reopened.run, { kind: "seal", ok: true, reasons: [], sealed: [revised] }, rubric, NOW),
  );
  // Iteration 2, yet nothing was ever delivered: the executor before it stopped on its dispute.
  assert.equal(spawn.context.iteration, "2");
  assert.equal(run.prUrl, null);
  assert.deepEqual(run.sealed, [revised]);
  assert.match(
    spawn.context.findings,
    /^- \[T-revise\] major\/test-quality: [^\n]*drop the debounce/,
  );
  assert.doesNotMatch(spawn.context.findings, /\n- \[/, "T-revise is the only finding");
  // So executor.md picks the full skill by delivery state, never by the iteration number.
  const executor = flat(roleText("executor"));
  assert.doesNotMatch(executor, /\b(iteration 1|later iterations|first iteration)\b/i);
  assert.match(executor, /`T-revise`/);
  const probe = /\(`(gh pr view)` finds none\)/.exec(executor)?.[1];
  assert.ok(probe, "executor.md names no probe for an existing pull request");
  assert.equal(childGitViolation(probe, RUN_BRANCH), null, probe);
});

test.todo(
  "composePrompts renders each real context template with exactly the variables spawnChild " +
    "supplies (owed by Task 13: its runtime list replaces the declared half of TEMPLATE_VARS)",
);
