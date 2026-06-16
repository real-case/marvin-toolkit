import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import { parseFrontmatter } from "../storage/frontmatter.js";
import { git, inGitRepo } from "../lib/git.js";
import type { ServerEnv } from "../lib/env.js";

/**
 * Deterministic Definition-of-Ready gate (ADR-0005 → 0006 → 0007).
 *
 * ADR-0007 moved the execution-load-bearing structure — the File Change Plan,
 * the Acceptance Criteria, and the interface contract — out of regex-parsed
 * markdown tables into a single authoritative ```yaml spec-contract block,
 * parsed by `yaml` and validated by a `zod` schema. The point is to **fail
 * closed**: a missing field, a dangling cross-reference, an unfilled contract,
 * a `{…}` placeholder (which parses as a YAML map and trips the type check), or
 * an all-`prose-review` proof set is now a typed FAIL that no column rename can
 * silently downgrade — the failure mode of the prior table parser.
 *
 * Identity + lifecycle stay in the `---` frontmatter (slug/type/status/created/
 * tracker/supersedes + the scalar markers risk/severity/breaking/spike_required/
 * stack/test_command). The block carries the graph: files, criteria,
 * build_order, contract. The critic (marvin-tm-spec-critic) remains the semantic
 * complement — it judges whether a proof is *genuine*; this tool proves the
 * contract's shape and internal references are complete.
 */

type CheckStatus = "pass" | "fail" | "warn";

interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

type Verdict = "PASS" | "PASS WITH WARNINGS" | "FAIL";

const STATUS_VALUES = ["draft", "ready", "in-progress", "shipped", "superseded"] as const;
const RISK_VALUES = ["low", "medium", "high"] as const;
const SEVERITY_VALUES = ["critical", "high", "medium", "low"] as const;

/** Canonicalised (## heading → lowercase, alnum-separated) required/recommended
 * prose sections per type. The File Change Plan, Acceptance Criteria, and
 * Interface/Contract are no longer prose sections — they live in the
 * spec-contract block — so they are absent from these lists. */
const FEATURE_REQUIRED = [
  "goal",
  "data config",
  "chosen approach",
  "test plan",
  "definition of done",
  "non goals",
  "open questions",
  "security nfr",
];
const FEATURE_RECOMMENDED = [
  "context",
  "why this over alternatives",
  "assumptions",
  "critic verdict overrides",
  "design notes",
  "future considerations",
];
const BUGFIX_REQUIRED = [
  "problem",
  "reproduction steps",
  "root cause analysis",
  "fix approach",
  "regression test specification",
  "definition of done",
  "non goals",
  "open questions",
];
const BUGFIX_RECOMMENDED = [
  "expected behavior",
  "severity impact",
  "assumptions",
  "critic verdict overrides",
  "design notes",
];

// ── spec-contract block schema (the typed, fail-closed graph) ────────────────

const ID_FILE = /^F\d+$/i;
const ID_AC = /^AC\d+$/i;
/** A scalar id, an array of ids, or "—"/"none" for an infra row. */
const RefList = z.union([z.array(z.union([z.string(), z.number()])), z.string()]);

const FileRow = z.object({
  id: z.string().regex(ID_FILE, "file id must look like F1, F2, …"),
  path: z.string().min(1),
  action: z.enum(["new", "edit", "delete"]),
  intent: z.string().optional(),
  satisfies: RefList.optional(),
  anchor: z.string().optional(),
});

const Oracle = z.object({
  kind: z.enum(["test", "command", "prose-review"]),
  ref: z.string().optional(),
});

const Criterion = z.object({
  id: z.string().regex(ID_AC, "criterion id must look like AC1, AC2, …"),
  statement: z.string().min(1),
  implemented_by: RefList,
  oracle: Oracle,
  failure: z.string().optional(),
  regression: z.boolean().optional(),
});

const ContractObj = z.object({
  kind: z.enum(["function", "route", "schema", "cli", "event", "none"]),
  signature: z.string().optional(),
});

const SpecContract = z.object({
  files: z.array(FileRow).min(1),
  build_order: z.array(z.union([z.string(), z.number()])).optional(),
  contract: ContractObj.optional(),
  criteria: z.array(Criterion).min(1),
  depends_on: z.array(z.string()).optional(),
});
type SpecContract = z.infer<typeof SpecContract>;

/** Discovered, host-specific bindings (ADR-0007 Contract B). Optional and
 * advisory — populated by task-start's pre-draft discovery, not load-bearing for
 * execution. `passthrough` keeps any extra host keys the author records;
 * `spec_location` is what lets depends_on resolve sibling specs. */
const HostBindings = z
  .object({
    spec_location: z.string().optional(),
    decision_record: z
      .object({ style: z.string().optional(), path: z.string().optional() })
      .optional(),
    merge_obligations: z.array(z.string()).optional(),
    gates: z.record(z.string()).optional(),
  })
  .passthrough();

const SpecInput = z.object({
  specPath: z
    .string()
    .optional()
    .describe("Path to the spec file to validate (relative to projectRoot or absolute)."),
  specContent: z
    .string()
    .optional()
    .describe(
      "Inline spec content — the draft at DoR time, before it is written to .marvin/task/.",
    ),
  projectRoot: z
    .string()
    .optional()
    .describe(
      "Project root for File Change Plan path-existence checks. Defaults to CLAUDE_PROJECT_DIR / cwd.",
    ),
  mode: z
    .enum(["dor", "seal", "scope"])
    .default("dor")
    .describe(
      "dor: the full Definition-of-Ready gate (default). seal: verify only the spec-contract immutability hash against the frontmatter contract_sha (the deterministic tamper check for /marvin:task-implement). scope: check the working-tree diff stays within the contract files allowlist (deterministic scope-creep gate).",
    ),
  allow: z
    .array(z.string())
    .optional()
    .describe(
      "mode: scope — extra file paths permitted beyond the contract files allowlist (recorded SPEC GAPs).",
    ),
  base: z
    .string()
    .optional()
    .describe(
      "mode: scope — git ref to diff against (default HEAD, i.e. uncommitted changes). Pass the task base branch to include committed task changes.",
    ),
});
type SpecInput = z.infer<typeof SpecInput>;

export function buildSpecTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "spec",
    description:
      'Validate a task spec against the Definition of Ready mechanically — identity/lifecycle frontmatter + a ```yaml spec-contract block (files / criteria / build_order / contract) parsed and zod-validated fail-closed: schema-valid shape, file-path existence, the AC⇄files⇄tests traceability triple (every criterion maps to real file IDs, every satisfies / test-oracle is allowlisted, ≥1 real proof), a typed oracle, bugfix regression marker, resolved open questions, no leftover placeholders. The tool-backed DoR gate for /marvin:task-start. Returns PASS / PASS WITH WARNINGS / FAIL. With mode: "seal" it instead verifies only the spec-contract immutability hash against the stamped contract_sha — the deterministic tamper check for /marvin:task-implement. With mode: "scope" it checks that the working-tree diff stays within the contract files allowlist.',
    inputSchema: SpecInput,
    handler: (input) => runSpec(input, env),
  });
}

async function runSpec(input: SpecInput, env: ServerEnv): Promise<ToolResult> {
  const projectRoot = input.projectRoot ?? env.projectDir;

  let raw: string;
  if (input.specContent != null && input.specContent.trim() !== "") {
    raw = input.specContent;
  } else if (input.specPath) {
    const path = isAbsolute(input.specPath) ? input.specPath : join(projectRoot, input.specPath);
    if (!existsSync(path)) {
      return result("FAIL", null, [fail("input", "Input", `spec file not found: ${path}`)]);
    }
    raw = readFileSync(path, "utf8");
  } else {
    return result("FAIL", null, [fail("input", "Input", "provide specContent or specPath")]);
  }

  if (input.mode === "seal") return verifySeal(raw);
  if (input.mode === "scope") {
    return verifyScope(raw, projectRoot, input.allow ?? [], input.base, input.specPath);
  }

  const { type, checks, contractSha } = validateSpec(raw, projectRoot);
  return result(computeVerdict(checks), type, checks, contractSha);
}

/**
 * Seal check (the tamper gate for /marvin:task-implement). Recompute the
 * spec-contract hash and compare it to the `contract_sha` stamped into the
 * frontmatter at DoR time. This is the deterministic replacement for the prose
 * instruction that asked the model to "re-hash the block and compare" — a
 * SHA-256 an LLM cannot compute reliably. Reuses the same `contractHash` the DoR
 * gate stamps, so seal and stamp can never drift.
 */
function verifySeal(raw: string): ToolResult {
  const { frontmatter, body } = parseFrontmatter(raw);
  const type = frontmatter.type ?? null;
  const sealed = (frontmatter.contract_sha ?? "").trim();
  const blockText = extractContractBlock(body);

  if (blockText === null) {
    return result("FAIL", type, [
      fail(
        "seal",
        "Contract seal",
        "no ```yaml spec-contract block found — cannot verify the seal",
      ),
    ]);
  }

  const actual = contractHash(blockText);

  if (!sealed) {
    return result(
      "PASS WITH WARNINGS",
      type,
      [
        warn(
          "seal",
          "Contract seal",
          `spec is unsealed — no contract_sha in frontmatter (current block hash is ${actual}). Re-run /marvin:task-start to stamp it and enable tamper detection.`,
        ),
      ],
      actual,
    );
  }

  if (sealed === actual) {
    return result(
      "PASS",
      type,
      [pass("seal", "Contract seal", `intact — contract_sha matches (${actual})`)],
      actual,
    );
  }

  return result(
    "FAIL",
    type,
    [
      fail(
        "seal",
        "Contract seal",
        `TAMPERED — the spec-contract block was edited after DoR sealed it (stamped ${sealed}, current ${actual}). Do not execute a tampered spec; re-run /marvin:task-start to re-seal.`,
      ),
    ],
    actual,
  );
}

/**
 * Scope gate (the mechanical half of scope-creep detection for
 * /marvin:task-implement). Checks that every changed file in the working tree is
 * within the spec-contract `files` allowlist — pure set math the model should not
 * eyeball. The semantic half (is an in-allowlist change *doing* something out of
 * scope?) stays with marvin-tm-diff-critic. marvin's own `.marvin/` artifacts and
 * the spec file are excluded; intentional out-of-allowlist files (recorded SPEC
 * GAPs) are passed in `allow`.
 */
function verifyScope(
  raw: string,
  projectRoot: string,
  allow: string[],
  base: string | undefined,
  specPath: string | undefined,
): ToolResult {
  const { frontmatter, body } = parseFrontmatter(raw);
  const type = frontmatter.type ?? null;

  const blockText = extractContractBlock(body);
  if (blockText === null) {
    return result("FAIL", type, [
      fail(
        "scope",
        "Scope",
        "no ```yaml spec-contract block found — cannot resolve the file allowlist",
      ),
    ]);
  }
  let doc: unknown;
  try {
    doc = parseYaml(blockText);
  } catch (err) {
    return result("FAIL", type, [
      fail("scope", "Scope", `contract block is not valid YAML: ${errMessage(err)}`),
    ]);
  }
  const parsed = SpecContract.safeParse(doc);
  if (!parsed.success) {
    return result("FAIL", type, [
      fail(
        "scope",
        "Scope",
        "contract block failed schema validation — run the DoR gate (mode: dor) first",
      ),
    ]);
  }

  if (!inGitRepo(projectRoot)) {
    return result("PASS WITH WARNINGS", type, [
      warn(
        "scope",
        "Scope",
        "not a git repository — cannot compute the diff; scope left unchecked",
      ),
    ]);
  }

  const allowed = new Set([...parsed.data.files.map((f) => f.path), ...allow].map(normalizePath));
  const specRel = specPath ? normalizePath(relativeToRoot(specPath, projectRoot)) : null;
  const ignored = (p: string) => p.startsWith(".marvin/") || p === specRel;

  const changed = changedFilesForScope(projectRoot, base).filter((p) => !ignored(p));
  const violations = changed.filter((p) => !allowed.has(p));

  if (violations.length === 0) {
    return result("PASS", type, [
      pass(
        "scope",
        "Scope",
        `all ${changed.length} in-scope changed file(s) are within the contract allowlist`,
      ),
    ]);
  }
  return result("FAIL", type, [
    fail(
      "scope",
      "Scope",
      `${violations.length} changed file(s) outside the contract allowlist (scope creep): ${violations.join(", ")}. Either add them to the spec's files list (amend the spec, then re-seal), or — if intentional — re-run with allow: [...] as a recorded SPEC GAP.`,
    ),
  ]);
}

/** git diff (vs `base`, default HEAD) + untracked, normalised and de-duped. */
function changedFilesForScope(projectRoot: string, base: string | undefined): string[] {
  const ref = base && base.trim() ? base.trim() : "HEAD";
  const diff = git(["diff", "--name-only", ref], projectRoot);
  const untracked = git(["ls-files", "--others", "--exclude-standard"], projectRoot);
  const lines = [
    ...(diff.ok ? diff.value.split("\n") : []),
    ...(untracked.ok ? untracked.value.split("\n") : []),
  ];
  return [...new Set(lines.map(normalizePath).filter(Boolean))];
}

/** Normalise a path for comparison: posix separators, no leading `./`. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/** Make `p` relative to `root` when it is an absolute path under it. */
function relativeToRoot(p: string, root: string): string {
  const np = normalizePath(p);
  const nr = normalizePath(root).replace(/\/$/, "");
  return np.startsWith(nr + "/") ? np.slice(nr.length + 1) : np;
}

function validateSpec(
  raw: string,
  projectRoot: string,
): { type: string | null; checks: Check[]; contractSha: string | null } {
  const { frontmatter, body } = parseFrontmatter(raw);
  const type = frontmatter.type ?? null;
  const checks: Check[] = [];

  checks.push(checkPlaceholders(raw));
  checks.push(...checkFrontmatter(frontmatter, type));

  const sections = parseSections(body);

  if (type === "feature" || type === "bugfix") {
    const [required, recommended] =
      type === "feature"
        ? [FEATURE_REQUIRED, FEATURE_RECOMMENDED]
        : [BUGFIX_REQUIRED, BUGFIX_RECOMMENDED];
    checks.push(...checkSections(sections, required, recommended));
    checks.push(checkOpenQuestions(sections.get("open questions")));
    const hb = checkHostBindings(body);
    checks.push(...hb.checks);
    checks.push(...checkContractBlock(body, type, projectRoot, hb.specLocation));
  } else {
    checks.push(
      fail("type", "Frontmatter", "cannot validate sections without a valid type (feature|bugfix)"),
    );
  }

  const blockText = extractContractBlock(body);
  return { type, checks, contractSha: blockText ? contractHash(blockText) : null };
}

// ── frontmatter (identity + lifecycle + scalar markers) ──────────────────────

function checkFrontmatter(fm: Record<string, string>, type: string | null): Check[] {
  const checks: Check[] = [];
  const present = (key: string) => (fm[key] ?? "").trim() !== "";

  const coreMissing = ["slug", "type", "status", "created"].filter((k) => !present(k));
  checks.push(
    coreMissing.length
      ? fail("fm-core", "Frontmatter", `missing/empty: ${coreMissing.join(", ")}`)
      : pass("fm-core", "Frontmatter", "slug/type/status/created present"),
  );

  if (fm.type && fm.type !== "feature" && fm.type !== "bugfix") {
    checks.push(fail("fm-type", "Frontmatter", `type "${fm.type}" is not feature|bugfix`));
  }
  if (fm.status && !STATUS_VALUES.includes(fm.status as (typeof STATUS_VALUES)[number])) {
    checks.push(
      fail("fm-status", "Frontmatter", `status "${fm.status}" is not ${STATUS_VALUES.join("|")}`),
    );
  }
  if (fm.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.slug)) {
    checks.push(fail("fm-slug", "Frontmatter", `slug "${fm.slug}" must be kebab-case`));
  }

  if (type === "feature") {
    if (!present("risk")) checks.push(fail("fm-risk", "Frontmatter", "feature requires risk"));
    else if (!RISK_VALUES.includes(fm.risk as (typeof RISK_VALUES)[number]))
      checks.push(fail("fm-risk", "Frontmatter", `risk "${fm.risk}" is not low|medium|high`));
  } else if (type === "bugfix") {
    if (!present("severity"))
      checks.push(fail("fm-severity", "Frontmatter", "bugfix requires severity"));
    else if (!SEVERITY_VALUES.includes(fm.severity as (typeof SEVERITY_VALUES)[number]))
      checks.push(
        fail(
          "fm-severity",
          "Frontmatter",
          `severity "${fm.severity}" is not ${SEVERITY_VALUES.join("|")}`,
        ),
      );
  }

  // Off-ramp: a spec that still needs investigation is not ready to dispatch.
  if ((fm.spike_required ?? "").trim().toLowerCase() === "true") {
    checks.push(
      fail(
        "spike-required",
        "Frontmatter",
        "spike_required: true — resolve the unknown (e.g. /marvin:kanban-spike) before DoR",
      ),
    );
  }

  // Backward-compat must be a conscious declaration on features, not an omission.
  if (type === "feature") {
    if (!present("breaking")) {
      checks.push(
        fail(
          "fm-breaking",
          "Frontmatter",
          "feature requires breaking: true|false (public-surface impact)",
        ),
      );
    } else if (!["true", "false"].includes((fm.breaking ?? "").trim().toLowerCase())) {
      checks.push(
        fail("fm-breaking", "Frontmatter", `breaking "${fm.breaking}" is not true|false`),
      );
    }
  }

  const softMissing = ["tracker", "supersedes", "stack", "test_command"].filter((k) => !present(k));
  if (softMissing.length) {
    checks.push(
      warn(
        "fm-meta",
        "Frontmatter",
        `missing (use "none" if not applicable): ${softMissing.join(", ")}`,
      ),
    );
  }

  return checks;
}

function checkSections(
  sections: Map<string, string>,
  required: string[],
  recommended: string[],
): Check[] {
  const present = new Set(sections.keys());
  const checks: Check[] = [];

  const missingReq = required.filter((s) => !present.has(s));
  checks.push(
    missingReq.length
      ? fail("sections-required", "Required sections", `missing: ${missingReq.join(", ")}`)
      : pass("sections-required", "Required sections", "all present"),
  );

  const missingRec = recommended.filter((s) => !present.has(s));
  if (missingRec.length) {
    checks.push(
      warn(
        "sections-recommended",
        "Recommended sections",
        `consider adding: ${missingRec.join(", ")}`,
      ),
    );
  }

  return checks;
}

// ── spec-contract block ──────────────────────────────────────────────────────

/** Extract the first fenced block whose info string mentions `spec-contract`. */
function extractContractBlock(body: string): string | null {
  const m = /```[^\n`]*spec-contract[^\n`]*\n([\s\S]*?)\n```/.exec(body);
  return m ? m[1]! : null;
}

function checkContractBlock(
  body: string,
  type: string,
  projectRoot: string,
  specLocation: string | undefined,
): Check[] {
  const blockText = extractContractBlock(body);
  if (blockText === null) {
    return [
      fail(
        "spec-contract",
        "Spec contract",
        "no ```yaml spec-contract block found — migrate the File Change Plan + Acceptance Criteria into the YAML block (ADR-0007); legacy table specs are no longer accepted",
      ),
    ];
  }

  let doc: unknown;
  try {
    doc = parseYaml(blockText);
  } catch (err) {
    return [fail("spec-contract", "Spec contract", `block is not valid YAML: ${errMessage(err)}`)];
  }

  const parsed = SpecContract.safeParse(doc);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return [fail("spec-contract", "Spec contract", `block failed schema validation: ${issues}`)];
  }

  const c = parsed.data;
  const checks: Check[] = [
    pass(
      "spec-contract",
      "Spec contract",
      `${c.files.length} file(s), ${c.criteria.length} criteria`,
    ),
  ];
  checks.push(...checkFiles(c, projectRoot));
  checks.push(...checkCriteria(c, type));
  checks.push(checkContractField(c));
  checks.push(...checkGraph(c));
  checks.push(...checkDependsOn(c.depends_on, specLocation, projectRoot));
  return checks;
}

// ── host-bindings + sibling dependencies (Contract B) ────────────────────────

/** Extract the first fenced block whose info string mentions `host-bindings`. */
function extractHostBindings(body: string): string | null {
  const m = /```[^\n`]*host-bindings[^\n`]*\n([\s\S]*?)\n```/.exec(body);
  return m ? m[1]! : null;
}

/** The host-bindings block is optional and advisory (discovered, not load-bearing
 * for execution). Validate it lightly when present and surface its `spec_location`
 * so depends_on can resolve siblings; a malformed block warns, never blocks. */
function checkHostBindings(body: string): { checks: Check[]; specLocation: string | undefined } {
  const text = extractHostBindings(body);
  if (text === null) return { checks: [], specLocation: undefined };
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    return {
      checks: [
        warn("host-bindings", "Host bindings", `block is not valid YAML: ${errMessage(err)}`),
      ],
      specLocation: undefined,
    };
  }
  const parsed = HostBindings.safeParse(doc);
  if (!parsed.success) {
    return {
      checks: [warn("host-bindings", "Host bindings", "block does not match the expected shape")],
      specLocation: undefined,
    };
  }
  return {
    checks: [pass("host-bindings", "Host bindings", "present")],
    specLocation: parsed.data.spec_location,
  };
}

/**
 * Mechanical sibling-dependency gate (audit finding B1): a spec may not depend on
 * an incomplete sibling. Each `depends_on` slug is resolved against the host's
 * spec location (then conventional dirs); the dependency must exist and be
 * `status: shipped`, or DoR fails.
 */
function checkDependsOn(
  deps: string[] | undefined,
  specLocation: string | undefined,
  projectRoot: string,
): Check[] {
  if (!deps || deps.length === 0) {
    return [pass("depends-on", "Dependencies", "no sibling dependencies")];
  }
  const dirs = [specLocation, ".marvin/task", "specs", "docs/specs", "docs/rfcs", "rfcs"].filter(
    (d): d is string => !!d,
  );
  const notFound: string[] = [];
  const notShipped: string[] = [];
  for (const slug of deps) {
    let resolved: string | null = null;
    for (const dir of dirs) {
      const p = join(projectRoot, dir, `${slug}.md`);
      if (existsSync(p)) {
        resolved = p;
        break;
      }
    }
    if (!resolved) {
      notFound.push(slug);
      continue;
    }
    const { frontmatter } = parseFrontmatter(readFileSync(resolved, "utf8"));
    const status = (frontmatter.status ?? "").trim();
    if (status !== "shipped") notShipped.push(`${slug}(${status || "?"})`);
  }
  const checks: Check[] = [];
  if (notFound.length) {
    checks.push(
      fail("depends-on", "Dependencies", `sibling spec(s) not found: ${notFound.join(", ")}`),
    );
  }
  if (notShipped.length) {
    checks.push(
      fail(
        "depends-on",
        "Dependencies",
        `depends on incomplete sibling(s): ${notShipped.join(", ")} — a dependency must be shipped`,
      ),
    );
  }
  if (!checks.length) {
    checks.push(pass("depends-on", "Dependencies", `${deps.length} sibling(s) shipped`));
  }
  return checks;
}

function checkFiles(c: SpecContract, projectRoot: string): Check[] {
  const checks: Check[] = [];
  const missing: string[] = [];
  const newButExists: string[] = [];
  for (const f of c.files) {
    const abs = isAbsolute(f.path) ? f.path : join(projectRoot, f.path);
    const exists = existsSync(abs);
    if ((f.action === "edit" || f.action === "delete") && !exists) missing.push(f.path);
    if (f.action === "new" && exists) newButExists.push(f.path);
  }
  if (c.files.length > 12) {
    checks.push(
      warn(
        "fcp-size",
        "Spec contract",
        `${c.files.length} files planned — confirm this is one PR, not several (scope gate)`,
      ),
    );
  }
  if (missing.length) {
    checks.push(
      fail("fcp-paths", "File paths", `edit/delete target(s) not found: ${missing.join(", ")}`),
    );
  }
  if (newButExists.length) {
    checks.push(
      warn(
        "fcp-new-exists",
        "File paths",
        `marked "new" but already exist: ${newButExists.join(", ")}`,
      ),
    );
  }
  return checks;
}

function checkCriteria(c: SpecContract, type: string): Check[] {
  const checks: Check[] = [];
  const min = type === "feature" ? 3 : 2;
  checks.push(
    c.criteria.length < min
      ? fail("ac-count", "Acceptance Criteria", `only ${c.criteria.length} criteria; need ≥${min}`)
      : pass("ac-count", "Acceptance Criteria", `${c.criteria.length} criteria`),
  );

  if (type === "bugfix") {
    const hasRegression = c.criteria.some((cr) => cr.regression === true);
    checks.push(
      hasRegression
        ? pass("ac-regression", "Acceptance Criteria", "regression criterion present")
        : fail(
            "ac-regression",
            "Acceptance Criteria",
            "no criterion marked `regression: true` — a bugfix must assert the test fails pre-fix and passes after",
          ),
    );
  }
  return checks;
}

/** The interface contract is a typed field now. kind "none" means no callable
 * surface; any other kind needs a real (non-empty) signature — an unfilled
 * `{…}` placeholder parses as a YAML map and fails the schema before this. */
function checkContractField(c: SpecContract): Check {
  if (!c.contract || c.contract.kind === "none") {
    return pass("contract", "Interface / Contract", "no callable surface (none)");
  }
  const sig = (c.contract.signature ?? "").trim();
  if (!sig) {
    return fail(
      "contract",
      "Interface / Contract",
      `contract.kind is "${c.contract.kind}" but signature is empty`,
    );
  }
  return pass("contract", "Interface / Contract", `${c.contract.kind} signature present`);
}

/**
 * The traceability triple over the typed graph: every criterion is implemented
 * by named real file IDs and proven by a real oracle, every Satisfies points at
 * a real criterion, every test oracle lives inside the allowlist, and ≥1
 * criterion carries a non-prose-review proof. Shape only — the critic still
 * judges whether a proof is genuine.
 */
function checkGraph(c: SpecContract): Check[] {
  const checks: Check[] = [];
  const fileIds = new Set(c.files.map((f) => f.id.toUpperCase()));
  const acIds = new Set(c.criteria.map((cr) => cr.id.toUpperCase()));
  const filePaths = new Set(c.files.map((f) => f.path));

  // 1. Every criterion names ≥1 implementing file; each named file is real.
  const badImpl: string[] = [];
  for (const cr of c.criteria) {
    const named = refs(cr.implemented_by);
    if (named.length === 0) {
      badImpl.push(`${cr.id}(none)`);
      continue;
    }
    const dangling = named.filter((n) => !fileIds.has(n));
    if (dangling.length) badImpl.push(`${cr.id}→${dangling.join("/")}`);
  }
  checks.push(
    badImpl.length
      ? fail(
          "ac-traceability",
          "Traceability",
          `criteria reference unknown / no file IDs: ${badImpl.join(", ")}`,
        )
      : pass("ac-traceability", "Traceability", "every criterion maps to plan files"),
  );

  // 2. Every Satisfies link points at a real criterion.
  const badSat: string[] = [];
  for (const f of c.files) {
    const dangling = refs(f.satisfies).filter((n) => !acIds.has(n));
    if (dangling.length) badSat.push(`${f.id}→${dangling.join("/")}`);
  }
  if (badSat.length) {
    checks.push(
      fail(
        "fcp-traceability",
        "Traceability",
        `files satisfy unknown criteria: ${badSat.join(", ")}`,
      ),
    );
  }

  // 3. build_order references real file IDs.
  if (c.build_order) {
    const dangling = c.build_order
      .map((x) => String(x).toUpperCase())
      .filter((x) => !fileIds.has(x));
    if (dangling.length) {
      checks.push(
        fail("build-order", "Build order", `references unknown file IDs: ${dangling.join("/")}`),
      );
    }
  }

  // 4. ≥1 real proof; non-prose oracles need a ref; test oracles are allowlisted.
  let realProofs = 0;
  const missingRef: string[] = [];
  const testsOutsidePlan: string[] = [];
  for (const cr of c.criteria) {
    const ref = (cr.oracle.ref ?? "").trim();
    if (cr.oracle.kind !== "prose-review") {
      realProofs += 1;
      if (!ref) missingRef.push(cr.id);
    }
    if (cr.oracle.kind === "test" && ref) {
      const path = testPath(ref);
      if (path && !filePaths.has(path)) testsOutsidePlan.push(path);
    }
  }
  checks.push(
    realProofs === 0
      ? fail(
          "ac-verified-real",
          "Acceptance Criteria",
          "every criterion is prose-review — at least one needs a real test or command oracle",
        )
      : pass(
          "ac-verified-real",
          "Acceptance Criteria",
          `${realProofs} criterion(s) with a real proof`,
        ),
  );
  if (missingRef.length) {
    checks.push(
      fail(
        "oracle-ref",
        "Acceptance Criteria",
        `non-prose oracle missing a ref: ${missingRef.join(", ")}`,
      ),
    );
  }
  if (testsOutsidePlan.length) {
    checks.push(
      fail(
        "ac-test-in-plan",
        "Acceptance Criteria",
        `test oracle(s) not in the File Change Plan allowlist: ${[...new Set(testsOutsidePlan)].join(", ")}`,
      ),
    );
  }

  return checks;
}

/** Normalise an id ref that may be a YAML array, a comma/space string, or a
 * "—"/"none" placeholder, to an uppercased id list. */
function refs(value: unknown): string[] {
  const arr = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s]+/)
      : value == null
        ? []
        : [value];
  return arr
    .map((x) => String(x).trim().toUpperCase())
    .filter((x) => x && !["-", "—", "N/A", "NONE"].includes(x));
}

/** Extract a file path from a test oracle ref, or null if it is a command or
 * a bare name. `test/x.test.ts::name` → `test/x.test.ts`. */
function testPath(ref: string): string | null {
  const file = (ref.split("::")[0] ?? "").trim();
  if (!file || /\s/.test(file)) return null; // commands have spaces
  if (!file.includes("/")) return null; // bare word, not a path
  if (!/\.[A-Za-z0-9]+$/.test(file)) return null; // needs a file extension
  return file;
}

function checkOpenQuestions(section: string | undefined): Check {
  if (section === undefined) {
    return fail("open-questions", "Open Questions", "section missing");
  }
  const stripped = section
    .replace(/^[-*]\s*/gm, "")
    .trim()
    .toLowerCase();
  if (stripped === "" || ["none", "n/a", "nil", "—", "-", "none."].includes(stripped)) {
    return pass("open-questions", "Open Questions", "resolved");
  }
  return fail(
    "open-questions",
    "Open Questions",
    'unresolved open questions remain — resolve to "none" before DoR',
  );
}

function checkPlaceholders(raw: string): Check {
  // Strip fenced and inline code so real code (and the spec-contract block's
  // YAML) is not flagged — placeholders inside the block surface as schema
  // type errors instead.
  const prose = raw.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const matches = [...prose.matchAll(/\{[A-Za-z#][^}\n]{1,70}\}/g)].map((m) => m[0]);
  const uniq = [...new Set(matches)];
  if (uniq.length === 0) {
    return pass("placeholders", "Template placeholders", "no unfilled placeholders");
  }
  const shown = uniq.slice(0, 8).join(", ");
  return fail(
    "placeholders",
    "Template placeholders",
    `unfilled placeholder(s): ${shown}${uniq.length > 8 ? " …" : ""}`,
  );
}

// ── parsing helpers ──────────────────────────────────────────────────────

/** Canonicalise a heading: lowercase, non-alphanumerics → single space, trim. */
function canon(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Map level-2 (`## `) headings → their content, keyed by canonical heading. */
function parseSections(body: string): Map<string, string> {
  const map = new Map<string, string>();
  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current !== null) map.set(current, buf.join("\n").trim());
  };
  for (const line of body.split("\n")) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      current = canon(m[1]!);
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  return map;
}

function errMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n")[0]!.slice(0, 160);
}

// ── result construction ────────────────────────────────────────────────────

function computeVerdict(checks: Check[]): Verdict {
  if (checks.some((c) => c.status === "fail")) return "FAIL";
  if (checks.some((c) => c.status === "warn")) return "PASS WITH WARNINGS";
  return "PASS";
}

/** A short, stable fingerprint of the spec-contract block — stamped into the
 * spec's frontmatter at write so later tampering of the immutable contract is
 * detectable by re-hashing. */
function contractHash(blockText: string): string {
  return createHash("sha256").update(blockText.trim()).digest("hex").slice(0, 16);
}

function result(
  verdict: Verdict,
  type: string | null,
  checks: Check[],
  contractSha: string | null = null,
): ToolResult {
  const icon = (s: CheckStatus) => (s === "pass" ? "✅" : s === "warn" ? "⚠️" : "❌");
  const lines = [
    `# Spec Readiness Report`,
    ``,
    `**Type:** ${type ?? "unknown"}`,
    `**Verdict:** ${verdict}`,
    ``,
    `## Checks`,
    ...checks.map((c) => `- ${icon(c.status)} **${c.label}** — ${c.detail}`),
    ``,
  ];
  if (verdict === "FAIL") {
    lines.push(
      `## Definition of Ready: BLOCKED`,
      ``,
      `Resolve the ❌ checks above, then re-run the gate. Do not write the spec until this passes.`,
      ``,
    );
  }
  const machine = JSON.stringify({
    verdict,
    type,
    contractSha,
    checks: checks.map((c) => ({ id: c.id, status: c.status, detail: c.detail })),
  });
  return {
    content: [
      { type: "text", text: `${lines.join("\n")}\n\`\`\`json spec-result\n${machine}\n\`\`\`` },
    ],
    isError: verdict === "FAIL",
  };
}

function pass(id: string, label: string, detail: string): Check {
  return { id, label, status: "pass", detail };
}
function fail(id: string, label: string, detail: string): Check {
  return { id, label, status: "fail", detail };
}
function warn(id: string, label: string, detail: string): Check {
  return { id, label, status: "warn", detail };
}
