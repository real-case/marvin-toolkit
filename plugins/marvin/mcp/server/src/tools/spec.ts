import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { SpecAuditFinding, SpecAuditPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { parseFrontmatter } from "../storage/frontmatter.js";
import type { SpecConfig } from "../storage/schema.js";
import {
  SpecContract,
  HostBindings,
  contractHash,
  extractContractBlock,
  extractHostBindings,
  formatSpecId,
  nextSpecNumber,
  readSpecCorpus,
  resolveSpecBySlug,
  resolveSpecDir,
  specIdWidth,
  specSearchDirs,
  type SpecCorpus,
  type SpecDirResolution,
  type SpecRecord,
} from "../storage/spec.js";
import {
  progressJournalPath,
  readProgress,
  recordProgress,
  resumeState,
  type ProgressEntry,
} from "../storage/progress.js";
import { loadConfig } from "../storage/config.js";
import {
  changedFilesForScope,
  inGitRepo,
  normalizeScopePath as normalizePath,
} from "../lib/git.js";
import type { ServerEnv } from "../lib/env.js";

/**
 * Deterministic Definition-of-Ready gate (ADR-0003 → 0006 → 0007).
 *
 * ADR-0005 moved the execution-load-bearing structure — the File Change Plan,
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

// The spec-contract / host-bindings schemas and block extractors now live in
// ../storage/spec.ts — the single source of truth shared with the task-summary
// aggregator (ADR-0024). This tool imports them and keeps the gate checks below.

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
  action: z
    .enum(["dor", "seal", "scope", "next", "list", "audit", "progress", "resume"])
    .optional()
    .describe(
      "dor: the full Definition-of-Ready gate (default). seal: verify the spec-contract immutability hash against the frontmatter contract_sha and refuse a spec whose lifecycle is already over (the deterministic pre-execution gate for /marvin:task-implement). scope: check the working-tree diff stays within the contract files allowlist (deterministic scope-creep gate). next: allocate the next ordering number for a new spec — the resolved directory, the padded id, the composed filename and any slug collision. list: enumerate the spec corpus, newest number first. audit: lint the whole corpus for consistency — duplicate numbers, numbering holes, slug collisions, dangling depends_on, unsealed specs, unknown statuses and files that do not identify themselves as specs. progress: append one entry to a spec's append-only progress journal. resume: read that journal back and report where an interrupted run got to.",
    ),
  mode: z
    .enum(["dor", "seal", "scope"])
    .optional()
    .describe(
      "Deprecated synonym for `action`, kept so shipped callers keep working. Same three values; `action` wins when both are passed and they agree, and a disagreeing pair is rejected rather than answered for.",
    ),
  slug: z
    .string()
    .optional()
    .describe(
      "action: next — the kebab-case slug of the spec being created, so the answer carries the composed filename and any collision with an existing spec. action: progress / resume — the slug whose journal is written or read (it is also the journal's filename, so it is rejected rather than sanitised).",
    ),
  source: z
    .enum(["task-start", "task-implement"])
    .optional()
    .describe("action: progress — which skill is writing; step ids collide across the two."),
  step: z
    .string()
    .optional()
    .describe('action: progress — the writer\'s own step id ("1.5", "4F", "5F", "2.5").'),
  kind: z
    .enum(["step", "criterion", "decision", "note", "archived"])
    .optional()
    .describe(
      'action: progress — what this entry records. "archived" is the boundary a resumed run appends when the user chooses to start clean; everything before it stops counting without being deleted.',
    ),
  detail: z
    .string()
    .optional()
    .describe(
      "action: progress — one line of position and choice. Never a credential, token or customer datum.",
    ),
  criterion: z
    .string()
    .optional()
    .describe('action: progress — the acceptance-criterion id, when kind is "criterion".'),
  draftPath: z
    .string()
    .optional()
    .describe(
      "action: progress — the draft/spec path to record in the entry. Distinct from `specPath`, which locates the journal and is never written into it.",
    ),
  contractSha: z
    .string()
    .optional()
    .describe("action: progress — the seal in force, when the writer knows one."),
  allow: z
    .array(z.string())
    .optional()
    .describe(
      "action: scope — extra file paths permitted beyond the contract files allowlist (recorded SPEC GAPs).",
    ),
  base: z
    .string()
    .optional()
    .describe(
      "action: scope — git ref to diff against (default HEAD, i.e. uncommitted changes). Pass the task base branch to include committed task changes.",
    ),
});
type SpecInput = z.infer<typeof SpecInput>;

/**
 * The gate is only as trustworthy as its inputs. Left non-strict, zod drops an
 * unrecognised key instead of rejecting it — so a caller passing, say,
 * `changedFiles` to `mode: "scope"` had it silently discarded and got a
 * confident PASS/FAIL over a file set the tool never saw (scope is always
 * computed from git). A wrong answer that looks right is worse than an error,
 * and this tool's whole purpose is to be a deterministic guarantee. Strict
 * turns that into an explicit failure naming the argument and the valid fields.
 */
const SPEC_INPUT_FIELDS = Object.keys(SpecInput.shape).join(", ");
const SpecInputStrict = SpecInput.strict(
  `unknown argument for the spec tool — it accepts only: ${SPEC_INPUT_FIELDS}. ` +
    `The changed-file set for action: "scope" is always derived from git (use \`base\` to pick the ref, ` +
    `\`allow\` to permit extra paths); it cannot be supplied by the caller.`,
);

export function buildSpecTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "spec",
    description:
      'Validate a task spec against the Definition of Ready mechanically — identity/lifecycle frontmatter + a ```yaml spec-contract block (files / criteria / build_order / contract) parsed and zod-validated fail-closed: schema-valid shape, file-path existence, the AC⇄files⇄tests traceability triple (every criterion maps to real file IDs, every satisfies / test-oracle is allowlisted, the two directions of the graph agree, ≥1 real proof), a typed oracle, bugfix regression marker, resolved open questions, no leftover placeholders. The tool-backed DoR gate for /marvin:task-start. Returns PASS / PASS WITH WARNINGS / FAIL. With action: "seal" it instead verifies the spec-contract immutability hash against the stamped contract_sha and refuses a spec already shipped or superseded — the deterministic pre-execution gate for /marvin:task-implement. With action: "scope" it checks that the working-tree diff stays within the contract files allowlist. Two corpus reads answer without a verdict: action: "next" allocates the next ordering number (resolved directory, padded id, composed filename, slug collision) and action: "list" enumerates the specs this project holds. With action: "audit" it lints the corpus as a whole — duplicate numbers, numbering holes, slug collisions, dangling depends_on references, unsealed specs, statuses outside the vocabulary and files that do not identify themselves as specs — and returns typed findings by severity (the corpus lint behind /marvin:task-audit). Two actions carry the pipeline\'s durable memory: action: "progress" appends one entry to a spec\'s append-only journal under the spec directory\'s runs/ (step, criterion, decision, note, or an "archived" boundary), and action: "resume" reads it back so an interrupted intake or a compacted implementation run can say where it got to. A resume that finds no journal is NOT an error and NOT a claim that nothing was done — it says so and asks for every criterion to be verified from scratch.',
    inputSchema: SpecInputStrict,
    handler: (input) => runSpec(input, env),
  });
}

async function runSpec(input: SpecInput, env: ServerEnv): Promise<ToolResult> {
  const projectRoot = input.projectRoot ?? env.projectDir;

  // One resolution of the effective action, before anything reads a spec.
  // `mode` is the deprecated key; since PR #186 made the input strict both may
  // legally arrive, so a disagreeing pair is refused rather than silently
  // answered for one of them — the "wrong answer that looks right" strictness
  // exists to prevent.
  if (input.action && input.mode && input.action !== input.mode) {
    return corpusError(
      `conflicting arguments: \`action: "${input.action}"\` and \`mode: "${input.mode}"\`. ` +
        `\`mode\` is the deprecated synonym for \`action\` — pass one of them (prefer \`action\`), ` +
        `not both with different values.`,
    );
  }
  const action = input.action ?? input.mode ?? "dor";

  // The corpus reads take no spec at all, so they dispatch before the
  // specContent/specPath read below — whose "provide specContent or specPath"
  // failure must stay reachable only for dor/seal/scope. `audit` belongs in this
  // block for exactly the same reason: it is corpus-wide and takes no spec file,
  // so a branch placed beside `seal`/`scope` would fail every ordinary
  // invocation while every fixture-driven test still passed.
  if (action === "next" || action === "list") {
    return readCorpus(action, input, env, projectRoot);
  }
  if (action === "audit") {
    return runSpecAudit(env, projectRoot);
  }
  // The journal actions dispatch here for a sharper reason than the corpus
  // reads: `progress` is legitimately called at task-start step 1.5 — in the
  // moment BEFORE the draft is written — so the `specPath` read below, which
  // FAILs on a path that does not exist yet, would refuse the first entry of
  // every intake. Neither action reads the spec file at all; `specPath` serves
  // only to locate the journal's directory.
  if (action === "progress" || action === "resume") {
    return runProgressAction(action, input, env, projectRoot);
  }

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

  if (action === "seal") return verifySeal(raw);
  if (action === "scope") {
    return verifyScope(raw, projectRoot, input.allow ?? [], input.base, input.specPath);
  }

  // The `spec.dir` tier for the depends_on lookup follows the resolved root, as
  // the corpus reads do (see `readCorpus`); one argument, so an absent config
  // file cannot make the gate shell out to git for a branch it never uses.
  const { config } = loadConfig(specConfigPath(env, projectRoot));
  const { type, checks, contractSha } = validateSpec(raw, projectRoot, config.spec);
  return result(computeVerdict(checks), type, checks, contractSha);
}

/**
 * Pre-execution gate for /marvin:task-implement — two independent checks,
 * reduced by the same `computeVerdict` every other path uses.
 *
 * **Seal.** Recompute the spec-contract hash and compare it to the
 * `contract_sha` stamped into the frontmatter at DoR time. This is the
 * deterministic replacement for the prose instruction that asked the model to
 * "re-hash the block and compare" — a SHA-256 an LLM cannot compute reliably.
 * Reuses the same `contractHash` the DoR gate stamps, so seal and stamp can
 * never drift.
 *
 * **Status transition.** A spec whose lifecycle is over — `shipped` or
 * `superseded` — must not be executed again. The check belongs here rather than
 * on `dor`: `dor` is only ever called by task-start on a spec it is itself
 * writing with `status: ready`, while seal is the gate a spec passes on the way
 * INTO execution. A `draft` deliberately does not block here — task-implement
 * refuses one in prose, and resumability owns what `draft` means on disk.
 *
 * Collecting checks rather than hand-picking one verdict per branch is what
 * lets the two coexist: the previous shape could not express "tampered AND
 * shipped", and `computeVerdict` reduces every single-check case identically.
 */
function verifySeal(raw: string): ToolResult {
  const { frontmatter, body } = parseFrontmatter(raw);
  const type = frontmatter.type ?? null;
  const sealed = (frontmatter.contract_sha ?? "").trim();
  const blockText = extractContractBlock(body);
  const statusCheck = checkStatusTransition(frontmatter.status);

  if (blockText === null) {
    return result("FAIL", type, [
      fail(
        "seal",
        "Contract seal",
        "no ```yaml spec-contract block found — cannot verify the seal",
      ),
      statusCheck,
    ]);
  }

  const actual = contractHash(blockText);
  const sealCheck = !sealed
    ? warn(
        "seal",
        "Contract seal",
        `spec is unsealed — no contract_sha in frontmatter (current block hash is ${actual}). Re-run /marvin:task-start to stamp it and enable tamper detection.`,
      )
    : sealed === actual
      ? pass("seal", "Contract seal", `intact — contract_sha matches (${actual})`)
      : fail(
          "seal",
          "Contract seal",
          `TAMPERED — the spec-contract block was edited after DoR sealed it (stamped ${sealed}, current ${actual}). Do not execute a tampered spec; re-run /marvin:task-start to re-seal.`,
        );

  const checks = [sealCheck, statusCheck];
  return result(computeVerdict(checks), type, checks, actual);
}

/** The two terminal states: the work is done, and re-executing it is a mistake. */
const TERMINAL_STATUSES = ["shipped", "superseded"] as const;

/**
 * Classify the frontmatter `status` for the seal gate.
 *
 * An ABSENT or empty status is a WARNING that says the check did not run, not a
 * pass: seal is legitimately called with inline `specContent` whose frontmatter
 * may be a fragment, and a silent pass there would report a check that never
 * happened — the same class of false assurance the seal exists to remove. A
 * status outside the tool's own vocabulary warns and echoes the value: a
 * repository experimenting with its own lifecycle words should not be unable to
 * execute its specs, but it should be told the value could not be classified.
 */
function checkStatusTransition(rawStatus: string | undefined): Check {
  const status = (rawStatus ?? "").trim();
  if (!status) {
    return warn(
      "status",
      "Lifecycle status",
      "no `status` in frontmatter — the shipped/superseded transition check did not run",
    );
  }
  if ((TERMINAL_STATUSES as readonly string[]).includes(status)) {
    return fail(
      "status",
      "Lifecycle status",
      `spec is \`${status}\` — its lifecycle is over and it must not be executed again. Write a NEW spec whose \`supersedes:\` names this one (/marvin:task-start).`,
    );
  }
  if (!(STATUS_VALUES as readonly string[]).includes(status)) {
    return warn(
      "status",
      "Lifecycle status",
      `status \`${status}\` is outside the vocabulary (${STATUS_VALUES.join(" | ")}) — the transition check could not classify it`,
    );
  }
  return pass("status", "Lifecycle status", `\`${status}\` — not a terminal state`);
}

// ── corpus reads (ADR-0037) ────────────────────────────────────────────────

/** The kebab-case rule `verify` validates `specSlug` against — rejected, never sanitised. */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * `action: "next"` and `action: "list"` — the two reads that answer about the
 * corpus rather than about one spec.
 *
 * Neither ever reports a corpus condition as an error: an absent directory and
 * an empty corpus are answers (`next` = 1 → "001"), not failures. A malformed
 * INPUT — a slug that is not kebab-case — still is one.
 *
 * The config is read from the RESOLVED project root, not from the server's own
 * `env.configPath`. `env.configPath` is `MARVIN_TASKS_CONFIG ?? join(projectDir,
 * ".marvin", "config.json")`, so absent that override it is derived from
 * `env.projectDir` — and this tool accepts a foreign `projectRoot`, so reading
 * the env path would apply one project's spec directory to another project's
 * tree. `loadConfig` is called with ONE argument on purpose: the two-argument
 * form shells out to git to detect `base_branch` whenever the file is absent —
 * the common case on a fresh project, and exactly the case `next` is called in —
 * and branch detection has nothing to do with resolving `spec.dir`.
 */
function readCorpus(
  action: "next" | "list",
  input: SpecInput,
  env: ServerEnv,
  projectRoot: string,
): ToolResult {
  const slug = input.slug?.trim();
  if (action === "next" && slug !== undefined && slug !== "" && !SLUG_RE.test(slug)) {
    return corpusError(
      `\`slug\` \`${slug}\` is not kebab-case (${SLUG_RE.source}) — no number was allocated. ` +
        `Pass a lowercase, hyphen-separated slug; it is rejected rather than rewritten, because a ` +
        `sanitised slug is not the identity the author chose.`,
    );
  }

  const { config } = loadConfig(specConfigPath(env, projectRoot));
  const dir = resolveSpecDir(projectRoot, config.spec);
  const corpus = readSpecCorpus(dir);

  const payload: Record<string, unknown> = { action, dir: { rel: dir.rel, source: dir.source } };
  const lines = [
    action === "next" ? "# Next spec number" : "# Spec corpus",
    "",
    `**Directory:** \`${dir.rel}\` (${dir.source})`,
  ];

  if (action === "next") {
    const width = specIdWidth(corpus);
    const number = nextSpecNumber(corpus);
    const id = formatSpecId(number, width);
    const filename = slug ? `${id}-${slug}.md` : null;
    const collision = slug ? (corpus.records.find((r) => r.slug === slug) ?? null) : null;
    payload.next = {
      number,
      id,
      width,
      filename,
      collision: collision
        ? {
            slug: collision.slug,
            filename: collision.filename,
            path: collision.path,
            status: collision.status,
          }
        : null,
    };
    lines.push(
      `**Next number:** ${number} → \`${id}\` (width ${width})`,
      ...(filename ? [`**Filename:** \`${dir.rel}/${filename}\``] : []),
      ...(collision
        ? [
            "",
            `⚠️ **Slug collision** — \`${collision.slug}\` already exists as \`${collision.path}\`` +
              `${collision.status ? ` (status \`${collision.status}\`)` : ""}. Decide with the user ` +
              `whether this task **supersedes** that spec (new slug + \`supersedes:\`) or is a distinct task (different slug).`,
          ]
        : []),
    );
  } else {
    payload.specs = corpus.records;
    lines.push(
      `**Specs:** ${corpus.records.length}`,
      "",
      ...(corpus.records.length === 0
        ? ["_No specs yet — `/marvin:task-start` writes the first one._"]
        : corpus.records.map(
            (r) =>
              `- ${r.id ? `\`${r.id}\` ` : ""}**${r.slug}** — ${r.title} · status \`${r.status ?? "—"}\`` +
              `${r.contract_sha ? "" : " · _unsealed_"} · \`${r.path}\``,
          )),
    );
  }

  if (corpus.malformed.length > 0) {
    lines.push(
      "",
      `⚠️ ${corpus.malformed.length} file(s) could not be read as specs (their numbers are still reserved):`,
      ...corpus.malformed.map((m) => `- \`${m.filename}\` — ${m.reason}`),
    );
  }

  return corpusResult(lines, payload);
}

/** The config file that governs THIS call's project root (see `readCorpus`). */
function specConfigPath(env: ServerEnv, projectRoot: string): string {
  return projectRoot === env.projectDir
    ? env.configPath
    : join(projectRoot, ".marvin", "config.json");
}

/**
 * The non-verdict renderer. It cannot be `result()`: that one always emits a
 * verdict line, a Checks list and a ```json spec-result``` block, and sets
 * `isError` on FAIL — none of which a corpus read or a journal read has. The
 * tag keeps the answers apart: a reader keyed on `spec-result` can never
 * mistake one for the other, and `spec-progress` is a journal rather than a
 * corpus even though both arrive through this function.
 */
function corpusResult(
  lines: string[],
  payload: Record<string, unknown>,
  tag: "spec-corpus" | "spec-progress" = "spec-corpus",
): ToolResult {
  const machine = JSON.stringify(payload);
  return {
    content: [
      {
        type: "text",
        text: `${lines.join("\n")}\n\n\`\`\`json ${tag}\n${machine}\n\`\`\``,
      },
    ],
  };
}

/** A refused CALL (bad input), as distinct from a corpus that holds nothing. */
function corpusError(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `# Spec tool — invalid input\n\n${detail}` }],
    isError: true,
  };
}

// ── the progress journal (spec resumability) ───────────────────────────────
//
// `task-start` used to write nothing to disk until its last step and
// `task-implement` tracks its criteria in `TodoWrite`, so an interrupted intake
// lost every answer and a compacted run lost its position. These two actions are
// the durable memory: `progress` appends, `resume` reads back. They are this
// tool's FIRST write in its history — until now every path here was `existsSync`
// / `readFileSync` — which is why the slug guard below is new surface rather
// than something inherited.

/**
 * Where this call's journal lives: `<dirname of the resolved specPath>/runs`
 * when a `specPath` is supplied, else `<resolveSpecDir(projectRoot)>/runs`.
 *
 * **Caller first, deliberately.** This inverts the obvious design. At task-start
 * step 1.5 the directory is a USER CHOICE among the host conventions, and
 * `resolveSpecDir` answers a different question — "where does this project keep
 * specs?" — which can legitimately disagree with it: a host that keeps specs in
 * `docs/rfcs/` while an empty `.marvin/task/` exists resolves to the latter. A
 * journal written beside a draft in a different tree is a journal nobody finds.
 * Both callers already hold the path, so the fallback is the rare branch.
 *
 * A relative `specPath` is joined to `projectRoot` exactly as `runSpec` does.
 */
function progressRunsDir(input: SpecInput, env: ServerEnv, projectRoot: string): string {
  if (input.specPath) {
    const abs = isAbsolute(input.specPath) ? input.specPath : join(projectRoot, input.specPath);
    return join(dirname(abs), "runs");
  }
  const { config } = loadConfig(specConfigPath(env, projectRoot));
  return join(resolveSpecDir(projectRoot, config.spec).abs, "runs");
}

/**
 * `action: "progress"` and `action: "resume"`.
 *
 * Neither reads the spec file, and neither emits a verdict. **`isError` is false
 * for a `resume` that finds nothing**: an empty journal is an answer, not a
 * failure — and the answer it carries is the whole point of the feature, so the
 * renderer states it in words and not only in the payload. A bad INPUT — an
 * absent or non-kebab slug, a `progress` call missing a required field — still
 * is an error.
 */
function runProgressAction(
  action: "progress" | "resume",
  input: SpecInput,
  env: ServerEnv,
  projectRoot: string,
): ToolResult {
  const slug = input.slug?.trim();
  if (!slug) {
    return corpusError(
      `\`action: "${action}"\` needs a \`slug\` — it names the spec whose journal is ` +
        `${action === "progress" ? "written" : "read"}, and it is the journal's filename.`,
    );
  }
  // Fail closed BEFORE any path is joined. The slug is caller-controlled and
  // becomes a filename, so this is the traversal guard — and it REJECTS rather
  // than sanitises (the rule `verify` already applies to `specSlug`): a
  // sanitised slug writes a journal under a name the caller never passes again,
  // so every later `resume` reports an empty journal for a spec that has one.
  if (!SLUG_RE.test(slug)) {
    return corpusError(
      `\`slug\` \`${slug}\` is not kebab-case (${SLUG_RE.source}) — nothing was written. ` +
        `The slug becomes the journal's filename, so it is rejected rather than rewritten.`,
    );
  }

  const runsDir = progressRunsDir(input, env, projectRoot);

  if (action === "resume") {
    const state = resumeState(readProgress(runsDir, slug));
    const payload: Record<string, unknown> = {
      action,
      slug,
      journal: relFromRoot(progressJournalPath(runsDir, slug), projectRoot),
      found: state.entries.length > 0 || state.archived > 0,
      ...state,
    };
    if (!payload.found) {
      return corpusResult(
        [
          `# Resume — ${slug}`,
          "",
          `no progress journal for ${slug} — an absent journal is never evidence that nothing ` +
            `was done; verify every criterion from scratch.`,
        ],
        payload,
        "spec-progress",
      );
    }
    return corpusResult(
      [
        `# Resume — ${slug}`,
        "",
        `**Entries:** ${state.entries.length}` +
          (state.archived > 0 ? ` (after ${state.archived} archived boundary/-ies)` : ""),
        ...(state.last ? [`**Last:** step ${state.last.step} — ${state.last.detail}`] : []),
        ...(state.path ? [`**Draft:** \`${state.path}\``] : []),
        ...(state.contract_sha ? [`**Recorded seal:** \`${state.contract_sha}\``] : []),
        ...(state.criteria_done.length
          ? [`**Criteria recorded complete:** ${state.criteria_done.join(", ")}`]
          : []),
        "",
        "A recorded criterion is a claim, not a proof — re-read its own oracle before skipping it.",
        "",
        ...state.entries.map((e) => `- \`${e.at}\` **${e.kind}** step ${e.step} — ${e.detail}`),
      ],
      payload,
      "spec-progress",
    );
  }

  const missing = (["source", "step", "kind", "detail"] as const).filter(
    (k) => input[k] === undefined || String(input[k]).trim() === "",
  );
  if (missing.length > 0) {
    return corpusError(
      `\`action: "progress"\` needs ${missing.map((m) => `\`${m}\``).join(", ")} — an entry that ` +
        `cannot say who wrote it, at which step, or what happened is not a record anyone can resume from.`,
    );
  }

  const entry: ProgressEntry = {
    slug,
    source: input.source!,
    step: input.step!,
    kind: input.kind!,
    detail: input.detail!,
    criterion: input.criterion ?? null,
    path: input.draftPath ?? null,
    contract_sha: input.contractSha ?? null,
    at: new Date().toISOString(),
  };
  recordProgress(runsDir, entry);
  const journal = relFromRoot(progressJournalPath(runsDir, slug), projectRoot);
  return corpusResult(
    [
      `# Progress — ${slug}`,
      "",
      `Recorded **${entry.kind}** at step ${entry.step} (${entry.source}).`,
      `**Journal:** \`${journal}\``,
    ],
    { action, slug, journal, entry },
    "spec-progress",
  );
}

/** Project-root-relative when it is inside the root, absolute otherwise. */
function relFromRoot(abs: string, projectRoot: string): string {
  const rel = relative(projectRoot, abs);
  return rel && !rel.startsWith("..") ? rel.split(sep).join(posix.sep) : abs;
}

// ── audit (corpus lint) ────────────────────────────────────────────────────
//
// The consistency lint the ADR corpus already has, for the spec corpus. The DoR
// gate judges ONE spec at a time and never looks at its neighbours, so a slug
// collision is resolved silently by `resolveSpecBySlug` and a duplicate number
// is invisible until two people fight over it. This is the relation half; it
// deliberately makes no judgement about whether a contract is valid or
// executable, which stays `action: "dor"`'s question.

/**
 * `action: "audit"` — the corpus-wide lint behind `/marvin:task-audit`.
 *
 * Read-only, and read-only in the strong sense: it never renumbers, renames or
 * re-seals anything. The config and directory resolution follow `readCorpus`
 * exactly (one-argument `loadConfig`, resolved project root), so the audit can
 * never lint a different directory than the one `next`/`list` answer about.
 */
function runSpecAudit(env: ServerEnv, projectRoot: string): ToolResult {
  const { config } = loadConfig(specConfigPath(env, projectRoot));
  const dir = resolveSpecDir(projectRoot, config.spec);
  const corpus = readSpecCorpus(dir);
  const dirs = specSearchDirs(projectRoot, config.spec);
  return renderSpecAudit(dir, corpus, collectSpecFindings(corpus, dir, dirs, projectRoot));
}

/**
 * The audit's own renderer. It cannot be `result()` (always a Verdict, a Checks
 * list and a fenced `spec-result` block, `isError` on FAIL) and it is not
 * `corpusResult()` either (a fenced `spec-corpus` block, no `structuredContent`).
 * The machine payload rides in `structuredContent` alone, as `adr audit` does —
 * one shape per kind of thing returned, which is why this tool legitimately
 * carries three.
 */
function renderSpecAudit(
  dir: SpecDirResolution,
  corpus: SpecCorpus,
  findings: SpecAuditFinding[],
): ToolResult {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const checked = corpus.records.length + corpus.malformed.length;

  const lines = [`# Spec audit — \`${dir.rel}\` · ${checked} file(s) checked`, ""];
  if (findings.length === 0) {
    lines.push("✓ Corpus clean — no findings.");
  } else {
    if (errors.length > 0) {
      lines.push(`✗ ${errors.length} error(s):`);
      for (const f of errors) lines.push(renderSpecFinding(f));
      lines.push("");
    }
    if (warnings.length > 0) {
      lines.push(`⚠ ${warnings.length} warning(s):`);
      for (const f of warnings) lines.push(renderSpecFinding(f));
    }
  }

  const payload: SpecAuditPayload = { dir: dir.rel, checked, findings, ok: errors.length === 0 };
  return {
    content: [{ type: "text", text: lines.join("\n").trimEnd() }],
    structuredContent: payload,
    ...(errors.length > 0 ? { isError: true } : {}),
  };
}

function renderSpecFinding(f: SpecAuditFinding): string {
  const anchor = f.path ? ` — \`${f.path}\`` : "";
  return `- **[${f.kind}]** ${f.message}${anchor}`;
}

/** The four frontmatter keys that make a file identify itself as a spec. */
const SPEC_IDENTITY_KEYS = ["slug", "type", "status", "created"] as const;

/**
 * How many ids one `numbering-hole` finding names before it summarises the rest.
 *
 * The ADR mirror this class is copied from enumerates a hole in full, and gets
 * away with it because `FILENAME_RE` there is `/^(\d{3,5})-/` — a corpus cannot
 * express a gap wider than 99998. `SPEC_PREFIX_RE` is deliberately unbounded, so
 * that ceiling does not exist here: one mistyped or date-shaped prefix
 * (`20260814-notes.md`, a real convention in the `specs/` and `docs/rfcs/`
 * directories `resolveSpecDir` may detect) makes the gap ~20 million, and an
 * unbounded expansion allocates a string per missing id and emits a payload of
 * hundreds of megabytes. The audit exists to REPORT a malformed corpus; it must
 * not be the thing a malformed corpus takes down.
 *
 * Ten is enough to act on — the reader renumbers nothing either way (the skill's
 * remediation is "do not renumber to close a gap"), so what the finding owes is
 * the two endpoints and the size, and the listing is a convenience.
 */
const MAX_LISTED_HOLE_IDS = 10;

/** The states a contract is expected to be sealed in; see `verifySeal`. */
const SEALABLE_STATUSES = ["ready", "in-progress", "shipped"] as const;

/**
 * What one spec file says about itself that a {@link SpecRecord} cannot answer.
 *
 * The record's `slug` falls back to the filename and its `title` to the slug, so
 * a derived value there is indistinguishable from an authored one — which is
 * exactly the distinction `malformed` is defined on. And `depends_on` is not
 * frontmatter at all: it lives in the fenced `spec-contract` block, which
 * `readSpecCorpus` never parses. Hence one re-read per record, and only one.
 */
interface SpecFileFacts {
  /** Identity keys absent or blank in the file's own frontmatter. */
  missingIdentity: string[];
  /** `status` exactly as authored, or null when absent or blank. */
  status: string | null;
  /** `depends_on` from the fenced spec-contract block; empty when there is none. */
  dependsOn: string[];
}

function readSpecFacts(path: string): SpecFileFacts {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    // The corpus reader already returned this file, so a read failure here is a
    // race, not an authoring mistake — report it as unidentifiable rather than
    // throwing the whole audit away.
    return { missingIdentity: [...SPEC_IDENTITY_KEYS], status: null, dependsOn: [] };
  }
  const { frontmatter, body } = parseFrontmatter(raw);
  const value = (key: string): string => (frontmatter[key] ?? "").trim();
  return {
    missingIdentity: SPEC_IDENTITY_KEYS.filter((key) => value(key) === ""),
    status: value("status") || null,
    dependsOn: dependsOnOf(body),
  };
}

/** `depends_on` out of the fenced contract block — tolerant, because an
 * unparseable block is `action: "dor"`'s finding to report, not this one's. */
function dependsOnOf(body: string): string[] {
  const blockText = extractContractBlock(body);
  if (blockText === null) return [];
  let doc: unknown;
  try {
    doc = parseYaml(blockText);
  } catch {
    return [];
  }
  const deps = (doc as { depends_on?: unknown } | null)?.depends_on;
  return Array.isArray(deps) ? deps.filter((d): d is string => typeof d === "string") : [];
}

/**
 * The seven finding classes, derived from the corpus the reader handed back plus
 * one re-read per record. Mirrors `tools/adr.ts`'s `collectFindings` in
 * structure and message style, and lives beside its renderer for the same
 * reason: the corpus reader is storage, the lint is the tool's.
 */
function collectSpecFindings(
  corpus: SpecCorpus,
  dir: SpecDirResolution,
  dirs: string[],
  projectRoot: string,
): SpecAuditFinding[] {
  const findings: SpecAuditFinding[] = [];
  const { records, malformed } = corpus;
  const width = specIdWidth(corpus);

  // Files the reader could not read at all — a second, narrower source for the
  // same class. Skipping it would let a file the reader dropped go unreported
  // while still counting in `checked`.
  for (const m of malformed) {
    findings.push({
      kind: "malformed",
      severity: "error",
      message: `\`${m.filename}\`: ${m.reason}`,
      slug: null,
      number: m.number,
      path: `${dir.rel}/${m.filename}`,
    });
  }

  // Per-record: identity, status vocabulary, seal, dependencies. ONE read each.
  for (const r of records) {
    const facts = readSpecFacts(join(dir.abs, r.filename));

    if (facts.missingIdentity.length > 0) {
      findings.push({
        kind: "malformed",
        severity: "error",
        message:
          `\`${r.filename}\` does not identify itself as a spec — its frontmatter is missing ` +
          `${facts.missingIdentity.map((k) => `\`${k}\``).join(", ")}`,
        slug: r.slug,
        number: r.number,
        path: r.path,
      });
    }

    // Disjoint from `malformed` on the status axis by construction: that class
    // fires when `status` is ABSENT, this one when it is present and unknown.
    if (facts.status !== null && !(STATUS_VALUES as readonly string[]).includes(facts.status)) {
      findings.push({
        kind: "invalid-status",
        severity: "error",
        message:
          `\`${r.slug}\` carries status \`${facts.status}\`, which is outside the vocabulary ` +
          `(${STATUS_VALUES.join(" | ")})`,
        slug: r.slug,
        number: r.number,
        path: r.path,
      });
    }

    if (
      r.contract_sha === null &&
      facts.status !== null &&
      (SEALABLE_STATUSES as readonly string[]).includes(facts.status)
    ) {
      findings.push({
        kind: "missing-seal",
        severity: "warning",
        message:
          `\`${r.slug}\` is \`${facts.status}\` but carries no \`contract_sha\` — its contract ` +
          `is unsealed, so tampering cannot be detected`,
        slug: r.slug,
        number: r.number,
        path: r.path,
      });
    }

    if (facts.dependsOn.length > 0) {
      // The gate's own resolver, so the audit and DoR can never disagree about
      // what a slug reaches. Only `notFound` is a corpus-consistency question;
      // "not shipped" is the gate's readiness judgement about one spec.
      const { notFound } = resolveDependencies(facts.dependsOn, dirs, projectRoot);
      for (const dep of notFound) {
        findings.push({
          kind: "dangling-depends-on",
          severity: "error",
          message: `\`${r.slug}\` depends on \`${dep}\`, which resolves to no spec in any searched directory`,
          slug: r.slug,
          number: r.number,
          path: r.path,
        });
      }
    }
  }

  // Numbering: duplicates (error) and holes (warning). Malformed files hold
  // their numbers too — a file the reader dropped still occupies its slot.
  const byNumber = new Map<number, string[]>();
  for (const r of records) if (r.number !== null) pushTo(byNumber, r.number, r.filename);
  for (const m of malformed) if (m.number !== null) pushTo(byNumber, m.number, m.filename);
  for (const [number, files] of [...byNumber].sort((a, b) => a[0] - b[0])) {
    if (files.length > 1) {
      findings.push({
        kind: "duplicate-number",
        severity: "error",
        message:
          `\`${formatSpecId(number, width)}\` is claimed by ${files.length} files: ` +
          `${files.map((f) => `\`${f}\``).join(", ")}`,
        slug: null,
        number,
        path: null,
      });
    }
  }
  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  for (let i = 1; i < numbers.length; i++) {
    const prev = numbers[i - 1]!;
    const cur = numbers[i]!;
    if (cur - prev > 1) {
      const size = cur - prev - 1;
      const listed = Math.min(size, MAX_LISTED_HOLE_IDS);
      const shown = Array.from({ length: listed }, (_, k) => formatSpecId(prev + 1 + k, width)).map(
        (g) => `\`${g}\``,
      );
      const missing =
        size > listed ? `${shown.join(", ")}, and ${size - listed} more` : shown.join(", ");
      findings.push({
        kind: "numbering-hole",
        severity: "warning",
        message:
          `numbering hole between \`${formatSpecId(prev, width)}\` and \`${formatSpecId(cur, width)}\` ` +
          `(missing ${missing})`,
        slug: null,
        number: null,
        path: null,
      });
    }
  }

  // Slug collisions. The finding names the file the resolver picks TODAY,
  // because "which of these does /marvin:task-implement <slug> reach" is the
  // only question knowing about the collision is useful for.
  const bySlug = new Map<string, SpecRecord[]>();
  for (const r of records) pushTo(bySlug, r.slug, r);
  for (const [slug, claimants] of [...bySlug].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (claimants.length < 2) continue;
    const resolved = resolveSpecBySlug(dir.abs, slug, projectRoot);
    const picked = resolved ? basename(resolved) : null;
    findings.push({
      kind: "slug-collision",
      severity: "error",
      message:
        `slug \`${slug}\` is claimed by ${claimants.length} files: ` +
        `${claimants.map((c) => `\`${c.filename}\``).join(", ")} — ` +
        (picked
          ? `\`${picked}\` is the one every \`depends_on: [${slug}]\`, /marvin:task-implement and ` +
            `/marvin:task-summary resolve to today`
          : `no file resolves for that slug today`),
      slug,
      number: null,
      path: null,
    });
  }

  return findings;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
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
        'contract block failed schema validation — run the DoR gate (action: "dor") first',
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

// `changedFilesForScope` and `normalizePath` moved to `lib/git.ts` (ADR-0043):
// the metrics roll-up computes scope drift over the same file set this gate
// judges, and two copies of "what changed" would drift the first time either
// was touched.

/** Make `p` relative to `root` when it is an absolute path under it. */
function relativeToRoot(p: string, root: string): string {
  const np = normalizePath(p);
  const nr = normalizePath(root).replace(/\/$/, "");
  return np.startsWith(nr + "/") ? np.slice(nr.length + 1) : np;
}

function validateSpec(
  raw: string,
  projectRoot: string,
  specConfig?: SpecConfig,
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
    checks.push(checkAssumptions(sections.get("assumptions")));
    checks.push(checkCriticVerdict(sections.get("critic verdict overrides")));
    const hb = checkHostBindings(body);
    checks.push(...hb.checks);
    checks.push(...checkContractBlock(body, type, projectRoot, hb.specLocation, specConfig));
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
  if (fm.slug && !SLUG_RE.test(fm.slug)) {
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
        "spike_required: true — resolve the unknown (e.g. a spike via /marvin:track-new) before DoR",
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

// ── spec-contract block (schema + extractor in ../storage/spec.ts) ───────────

function checkContractBlock(
  body: string,
  type: string,
  projectRoot: string,
  specLocation: string | undefined,
  specConfig?: SpecConfig,
): Check[] {
  const blockText = extractContractBlock(body);
  if (blockText === null) {
    return [
      fail(
        "spec-contract",
        "Spec contract",
        "no ```yaml spec-contract block found — migrate the File Change Plan + Acceptance Criteria into the YAML block (ADR-0005); legacy table specs are no longer accepted",
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
  checks.push(...checkDependsOn(c.depends_on, specLocation, projectRoot, specConfig));
  return checks;
}

// ── host-bindings + sibling dependencies (Contract B) ────────────────────────

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
  specConfig?: SpecConfig,
): Check[] {
  if (!deps || deps.length === 0) {
    return [pass("depends-on", "Dependencies", "no sibling dependencies")];
  }
  // The host binding first, then the resolved directory, then every convention
  // (ADR-0037): resolution order changes, reach does not.
  const dirs = specSearchDirs(projectRoot, specConfig, specLocation);
  const { notFound, notShipped } = resolveDependencies(deps, dirs, projectRoot);
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

/**
 * Resolve each `depends_on` slug across the searched directories and split the
 * failures: siblings that resolve to no file at all, and siblings that resolve
 * but are not `shipped` (rendered with the status found).
 *
 * One resolver, two renderings. The DoR gate turns both lists into FAILs; the
 * corpus audit reports only `notFound`, because "not shipped" is a readiness
 * judgement about one spec rather than a corpus inconsistency. A second resolver
 * would disagree with this one the first time either moved.
 */
function resolveDependencies(
  deps: string[],
  dirs: string[],
  projectRoot: string,
): { notFound: string[]; notShipped: string[] } {
  const notFound: string[] = [];
  const notShipped: string[] = [];
  for (const slug of deps) {
    let resolved: string | null = null;
    for (const dir of dirs) {
      const p = resolveSpecBySlug(dir, slug, projectRoot);
      if (p) {
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
  return { notFound, notShipped };
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
export function checkGraph(c: SpecContract): Check[] {
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

  // 2b. The two directions must AGREE. `criteria[].implemented_by` and
  //     `files[].satisfies` are one graph stored twice, and checks 1 and 2
  //     validate each side alone: a criterion could name a file that denies it
  //     and both would pass. Transposing one side and comparing is the whole
  //     check, and it removes a finding class the semantic critic was paying
  //     minutes to catch by hand.
  //
  //     A file row that declares NO `satisfies` (absent, or "none"/"—", which
  //     `refs` erases alike) declares no index and is exempt: an absent index is
  //     not a contradicting one, and infra rows legitimately carry none. Only
  //     edges whose endpoints both exist are compared — a dangling ref is
  //     already check 1's or check 2's finding, and reporting it twice would
  //     send the author to the wrong side of the graph.
  //     Two rows may carry the same id — the schema does not forbid it, and no
  //     check reports it — so the backward index is UNIONED rather than
  //     overwritten. Overwriting would drop the first row's declarations and
  //     report its edges as asymmetric, describing a duplicate id as the wrong
  //     defect.
  const declaredSatisfies = new Map<string, string[]>();
  for (const f of c.files) {
    const named = refs(f.satisfies);
    if (!named.length) continue;
    const id = f.id.toUpperCase();
    declaredSatisfies.set(id, [...(declaredSatisfies.get(id) ?? []), ...named]);
  }
  const asymmetric: string[] = [];
  for (const cr of c.criteria) {
    const acId = cr.id.toUpperCase();
    for (const fid of refs(cr.implemented_by)) {
      const back = declaredSatisfies.get(fid);
      if (back && !back.includes(acId)) {
        asymmetric.push(`${acId}→${fid}, but ${fid} satisfies ${back.join("/")}`);
      }
    }
  }
  for (const f of c.files) {
    const fid = f.id.toUpperCase();
    for (const acId of refs(f.satisfies)) {
      const cr = c.criteria.find((x) => x.id.toUpperCase() === acId);
      if (!cr) continue;
      const forward = refs(cr.implemented_by);
      if (!forward.includes(fid)) {
        asymmetric.push(`${fid}→${acId}, but ${acId} is implemented_by ${forward.join("/")}`);
      }
    }
  }
  checks.push(
    asymmetric.length
      ? fail(
          "graph-symmetry",
          "Traceability",
          `implemented_by and satisfies disagree: ${asymmetric.join("; ")}`,
        )
      : pass("graph-symmetry", "Traceability", "the two directions of the graph agree"),
  );

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

/** The "resolved to nothing" vocabulary, shared by the two section-emptiness
 * checks below — `checkOpenQuestions` and `checkAssumptions` — so they can never
 * disagree about what an empty section looks like. `checkCriticVerdict` does not
 * use it: `## Critic Verdict & Overrides` records a token `task-deliver` renders
 * on the PR, so it deliberately accepts only the literal `none` for the skipped
 * state, and "n/a" or "nil" there is an unrecognised verdict rather than an
 * empty section. */
const NONE_VOCABULARY = ["none", "n/a", "nil", "—", "-", "none."];

/** Normalise a prose section before matching it against NONE_VOCABULARY: drop
 * leading list bullets, trim, lowercase. */
function normalizeSection(section: string): string {
  return section
    .replace(/^[-*]\s*/gm, "")
    .trim()
    .toLowerCase();
}

function checkOpenQuestions(section: string | undefined): Check {
  if (section === undefined) {
    return fail("open-questions", "Open Questions", "section missing");
  }
  const stripped = normalizeSection(section);
  if (stripped === "" || NONE_VOCABULARY.includes(stripped)) {
    return pass("open-questions", "Open Questions", "resolved");
  }
  return fail(
    "open-questions",
    "Open Questions",
    'unresolved open questions remain — resolve to "none" before DoR',
  );
}

/**
 * Advisory content check on `## Assumptions`. `task-start` runs a **bounded**
 * intake — a declared question budget plus a do-not-ask list whose every row
 * names the default it assumes — and that is only safe when the defaults it
 * accepted are written down, where the implementer and the reviewer can correct
 * them. An absent, empty, or "none" section is therefore surfaced.
 *
 * It surfaces as a `warn` and never a `fail`: `computeVerdict` turns a warn into
 * PASS WITH WARNINGS, which steps 7F/7B and 9F/9B all accept, so no already
 * sealed spec becomes undispatchable. "none" stays a legitimate answer, and both
 * shipped templates say so. Promotion to the rejecting tier is decision D5, at
 * the next declared breaking release.
 */
function checkAssumptions(section: string | undefined): Check {
  const remedy =
    'record each default the intake assumed instead of asking, as "assumed X because Y; correct now if wrong"';
  if (section === undefined) {
    return warn("assumptions", "Assumptions", `section missing — ${remedy}`);
  }
  const stripped = normalizeSection(section);
  if (stripped === "" || NONE_VOCABULARY.includes(stripped)) {
    return warn("assumptions", "Assumptions", `no assumptions recorded — accepted, but ${remedy}`);
  }
  return pass("assumptions", "Assumptions", "decisions under uncertainty are recorded");
}

/** The four terminal verdicts `## Critic Verdict & Overrides` may carry. Longest
 * first, so a PASS WITH WARNINGS line is never reported as a bare PASS.
 * NEEDS_CONTEXT is deliberately absent — it is transient and resolves on the one
 * re-dispatch it earns, or becomes UNABLE. */
const TERMINAL_VERDICTS = ["PASS WITH WARNINGS", "PASS", "BLOCK", "UNABLE"];

/** Everything the section may record: the terminal verdicts plus the literal
 * "none" (the critic step was skipped). */
const RECORDABLE_VERDICTS = [...TERMINAL_VERDICTS, "NONE"];

/** Strip the markdown a verdict line is commonly dressed in — a list bullet,
 * bold, code ticks — so the token underneath is comparable. Underscores are left
 * alone: NEEDS_CONTEXT carries one. */
function cleanVerdictLine(line: string): string {
  return line
    .replace(/[`*]/g, "")
    .replace(/^\s*[-+]\s+/, "")
    .trim();
}

/**
 * The verdict a critic line records, or null if it carries none.
 *
 * ACCEPTED SHAPE. Two forms are in use, and both are house style: verdict-first
 * ("BLOCK → resolved.") and attribution-first ("marvin-tm-spec-critic —
 * **PASS WITH WARNINGS**"). Anchoring the match at column 0 recognised only the
 * first, which warned on 17 of the 24 specs under `.marvin/task/` — a warning
 * that fires on correctly authored specs is noise, so the token is looked for
 * anywhere on the line. Two guards keep the scan from reading prose as a
 * judgement: the token must stand as a whole word (never inside "bypass" or
 * "passes"), and away from the start of the line it must be written in the
 * canonical capitals the vocabulary declares — a sentence that merely mentions
 * "we can pass on this" is not a verdict. A token that *leads* the line is
 * matched case-insensitively, which is the older anchored rule kept intact, so
 * nothing that passed before this widening stops passing. `none` is accepted
 * only in that leading position: a skipped critic is the whole answer, never a
 * word inside prose.
 *
 * Where two tokens match, the earliest wins, and at equal position the longest —
 * so `PASS WITH WARNINGS` is never reported as a bare `PASS`. A line recording a
 * round-by-round chain ("BLOCK (round 1) → PASS WITH WARNINGS (round 2)") is
 * therefore reported by the verdict it opens with: the check confirms that a
 * recognisable verdict is present, it does not adjudicate the chain.
 */
function findVerdict(line: string): string | null {
  const leading = RECORDABLE_VERDICTS.find((v) => new RegExp(`^${v}\\b`, "i").test(line));
  if (leading) return leading;
  let best: { at: number; verdict: string } | null = null;
  for (const verdict of TERMINAL_VERDICTS) {
    const at = line.search(new RegExp(`\\b${verdict}\\b`));
    if (at !== -1 && (best === null || at < best.at)) best = { at, verdict };
  }
  return best?.verdict ?? null;
}

/**
 * Advisory content check on `## Critic Verdict & Overrides`. `/marvin:task-deliver`
 * renders this section on the PR's **Spec critic** line and can render exactly
 * the terminal verdicts plus a skipped state, so a token outside that set reaches
 * the pull request as a judgement that was never made. Warn tier for the same
 * reason as `checkAssumptions` (decision D5).
 */
function checkCriticVerdict(section: string | undefined): Check {
  const remedy =
    'record one of PASS | PASS WITH WARNINGS | BLOCK | UNABLE, or "none" if the critic step was skipped';
  if (section === undefined) {
    return warn("critic-verdict", "Critic verdict", `section missing — ${remedy}`);
  }
  const line = section
    .split("\n")
    .map((l) => cleanVerdictLine(l))
    .find((l) => l !== "");
  if (!line) {
    return warn("critic-verdict", "Critic verdict", `section empty — ${remedy}`);
  }
  const verdict = findVerdict(line);
  if (verdict) {
    return pass(
      "critic-verdict",
      "Critic verdict",
      verdict === "NONE" ? "no verdict recorded (critic skipped)" : `${verdict} recorded`,
    );
  }
  if (/\bNEEDS_CONTEXT\b/i.test(line)) {
    return warn(
      "critic-verdict",
      "Critic verdict",
      "NEEDS_CONTEXT is transient and is never recorded here — supply the input the critic named and re-dispatch it once; a second occurrence is UNABLE",
    );
  }
  return warn(
    "critic-verdict",
    "Critic verdict",
    `unrecognised verdict "${line.slice(0, 40)}" — ${remedy}`,
  );
}

export function checkPlaceholders(raw: string): Check {
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
