import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type {
  AcOutcome,
  CommitRef,
  GateOutcome,
  LessonRef,
  LinkRef,
  TaskSummary,
} from "@marvin-toolkit/mcp-shared/contracts";
import {
  SpecContract,
  HostBindings,
  contractHash,
  extractContractBlock,
  extractHostBindings,
  resolveSpecBySlug,
  SPEC_DIRS,
  type Criterion,
} from "../storage/spec.js";
import { parseFrontmatter } from "../storage/frontmatter.js";
import { findTaskByBranch, readAllTasks } from "../storage/tasks.js";
import { searchLessons } from "../storage/lessons.js";
import { loadConfig, trackerUrl } from "../storage/config.js";
import type { Config } from "../storage/schema.js";
import { currentBranch, git, inGitRepo } from "../lib/git.js";
import { parseVerifyBlock, type VerifyBlockParse, type VerifyGate } from "../lib/reports.js";
import { readOracleRuns, type OracleRun } from "../storage/oracles.js";
import type { ServerEnv } from "../lib/env.js";
import { TASK_SUMMARY_WIDGET_URI } from "../resources/widgets.js";

/**
 * "What was done" task-summary aggregator (ADR-0024, widget #3). Joins five
 * already-typed sources for one spec — the spec-contract `criteria`, the
 * `verification.md` gate outcomes, the branch's git log, the captured lessons,
 * and the artifact links — into a single `TaskSummary` payload. No prose is
 * re-parsed: criteria come from the shared spec-contract schema, gates from the
 * machine-readable `verify-result` block (persisted by the `verify` tool).
 *
 * Per-AC `outcome` is a JOIN AGAINST THE ORACLE JOURNAL, never an inference from
 * the gate-level verdict (ADR-0036). Until 0.15.0 this function read
 * `passed && real ? "pass" : "unknown"` — a green suite promoted every
 * test/command criterion to `pass` with no per-criterion evidence of any kind,
 * including a criterion whose test was never written. The comment here claimed
 * the opposite, which is how the wrong invariant survived.
 *
 * What it does now: read `.marvin/task/runs/<slug>.oracles.md`, keep only the
 * entries recorded at the spec's CURRENT `contract_sha` — recomputed from the
 * block rather than read off the stamp, so an amendment that was never re-sealed
 * cannot hand an old proof to a new statement — and let the newest entry for a
 * criterion decide — a recorded green is `pass`, a recorded
 * `expect: pass` run that exited non-zero is `fail`. A red-only entry, a
 * `not-run` entry, an unsealed spec and an absent journal are all `unknown`, and
 * the verify verdict does not participate at all. The visible effect is MORE
 * `unknown` than before, and every remaining `pass` names a run that proves it.
 */

const SummaryInput = z.object({
  slug: z
    .string()
    .optional()
    .describe("Spec slug to summarise. Defaults to the most recent spec under the spec dir."),
  projectRoot: z
    .string()
    .optional()
    .describe("Project root. Defaults to CLAUDE_PROJECT_DIR / cwd."),
});

export function buildSummaryTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "summary",
    description:
      "Aggregate a spec's acceptance criteria, verification gates, commits, lessons and links into a 'what was done' task summary.",
    inputSchema: SummaryInput,
    // Bind the task-summary `ui://` widget for MCP Apps hosts (ADR-0024 #3). A plain
    // object literal — no ext-apps import — so tsup never bundles the SDK into
    // dist/server.js. The terminal ignores `_meta` and renders the text content.
    meta: { ui: { resourceUri: TASK_SUMMARY_WIDGET_URI } },
    handler: (input) => {
      // Fresh config per call — `task config` edits apply without a restart.
      const { config } = loadConfig(env.configPath, env.projectDir);
      return Promise.resolve(runSummary(env, config, input));
    },
  });
}

function runSummary(
  env: ServerEnv,
  config: Config,
  input: z.infer<typeof SummaryInput>,
): ToolResult {
  const projectRoot = input.projectRoot ?? env.projectDir;

  const specPath = input.slug
    ? findSpecBySlug(input.slug, projectRoot)
    : findLatestSpec(projectRoot);
  if (!specPath) {
    return errOk(
      input.slug
        ? `No spec found for slug \`${input.slug}\` under ${SPEC_DIRS.join(", ")}.`
        : `No spec found under ${SPEC_DIRS.join(", ")} — run /marvin:task-start first.`,
    );
  }

  const { frontmatter, body } = parseFrontmatter(readFileSync(specPath, "utf8"));
  const slug = frontmatter.slug?.trim() || basenameSlug(specPath);
  const contract = parseSpecContract(body);
  const hostBindings = parseHostBindings(body);
  const verification = readVerifyResult(projectRoot, slug);
  // The joins below need the payload or nothing; only the text fallback cares
  // which of the two "nothing" cases it was.
  const verify = verification.parse.kind === "ok" ? verification.parse.result : null;

  // The seal is the join key, RECOMPUTED rather than trusted as stamped: a run
  // recorded against a contract that has since been amended proves nothing about
  // the criteria in force now, and an amendment that was never re-sealed leaves
  // the stamp — and so a stamp-only join — pointing at the superseded run.
  const seal = contractJoinKey(body, frontmatter);
  const proofs = latestRunsByCriterion(projectRoot, slug, seal.key);
  const acceptance: AcOutcome[] = (contract?.criteria ?? []).map((cr) =>
    toAcOutcome(cr, proofs.get(cr.id) ?? null),
  );
  const gates: GateOutcome[] = (verify?.gates ?? []).map(toGateOutcome);
  const commits = readCommits(projectRoot, config.base_branch);
  const lessons: LessonRef[] = searchLessons(env.memoryDir, { query: slug, limit: 10 }).map(
    (l) => ({
      id: l.slug,
      title: l.title,
    }),
  );
  const links = buildLinks(env, config, projectRoot, slug, frontmatter, hostBindings);

  const summary: TaskSummary = {
    slug,
    title: extractTitle(body) ?? slug,
    status: frontmatter.status?.trim() || "unknown",
    acceptance,
    gates,
    commits,
    lessons,
    links,
  };

  return {
    content: [{ type: "text", text: render(summary, verification, seal.note) }],
    // Widget payload for MCP Apps hosts (ADR-0024) — the task-summary view (#3).
    structuredContent: summary,
  };
}

// ── spec resolution ──────────────────────────────────────────────────────────

function findSpecBySlug(slug: string, projectRoot: string): string | null {
  for (const dir of SPEC_DIRS) {
    const p = resolveSpecBySlug(dir, slug, projectRoot);
    if (p) return p;
  }
  return null;
}

/** The newest spec (highest numeric prefix) in the first existing spec dir. */
function findLatestSpec(projectRoot: string): string | null {
  for (const dir of SPEC_DIRS) {
    const abs = join(projectRoot, dir);
    if (!existsSync(abs)) continue;
    const specs = readdirSync(abs)
      .filter((f) => f.endsWith(".md") && f !== "verification.md")
      .sort();
    if (specs.length) return join(abs, specs[specs.length - 1]!);
  }
  return null;
}

function basenameSlug(specPath: string): string {
  const file = specPath.split("/").pop() ?? specPath;
  return file.replace(/\.md$/, "").replace(/^\d+-/, "");
}

// ── typed-block parsing (schemas shared with the spec DoR gate) ───────────────

function parseSpecContract(body: string): SpecContract | null {
  const block = extractContractBlock(body);
  if (!block) return null;
  try {
    const parsed = SpecContract.safeParse(parseYaml(block));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseHostBindings(body: string): HostBindings | null {
  const text = extractHostBindings(body);
  if (!text) return null;
  try {
    const parsed = HostBindings.safeParse(parseYaml(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The kebab-case rule `verify` validates `specSlug` against before writing. */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface VerificationSource {
  parse: VerifyBlockParse;
  /** Project-relative path of the artifact actually read, or null when none was. */
  path: string | null;
}

/**
 * Read the machine-readable verify-result block through the shared codec,
 * preferring **this spec's** run (`.marvin/task/runs/<slug>.md`) over the global
 * `verification.md` (ADR-0035).
 *
 * The global artifact means "the most recent verification in this project,
 * whatever spec it was for", so joining against it presented a foreign run as
 * this task's own. Writer and reader resolve the slug by one rule — the spec's
 * frontmatter `slug`, else its filename slug — so they cannot disagree about
 * which file this is. A missing artifact is `none`, the same as a prose-only
 * one: from here both mean "no verification to join against".
 */
function readVerifyResult(projectRoot: string, slug: string): VerificationSource {
  const taskDir = join(projectRoot, ".marvin", "task");
  const candidates: Array<[string, string]> = [];
  if (SLUG_RE.test(slug)) {
    candidates.push([join(taskDir, "runs", `${slug}.md`), `.marvin/task/runs/${slug}.md`]);
  }
  candidates.push([join(taskDir, "verification.md"), ".marvin/task/verification.md"]);

  for (const [abs, rel] of candidates) {
    if (!existsSync(abs)) continue;
    return { parse: parseVerifyBlock(readFileSync(abs, "utf8")), path: rel };
  }
  return { parse: { kind: "none" }, path: null };
}

// ── joins ────────────────────────────────────────────────────────────────────

/**
 * The seal to join the journal on — **recomputed from the block, never taken on
 * the stamp's word** — plus the note that explains a refusal to a human.
 *
 * Trusting `frontmatter.contract_sha` closes only half the case it was written
 * for. A spec amended AND re-sealed moves the stamp, so the old entries fall out
 * of the join on their own. A spec amended and NOT re-sealed keeps the stamp the
 * journal was written against, so a stamp-only join hands the run that proved the
 * OLD statement of AC3 to the NEW statement of AC3 and prints `pass` beside it.
 * That is the one defect class this feature exists to remove, and the summary is
 * the surface a human actually reads: `action: "oracles"` already refuses to run
 * such a spec (`readSealedSpec`) and the DoR gate already flags it, so the check
 * belongs here too rather than only where nobody is looking.
 *
 * Three outcomes: a matching stamp joins; a missing block or missing stamp joins
 * against nothing, silently, because an unsealed spec never had proofs to begin
 * with; a stamp that disagrees with the block joins against nothing AND says so,
 * because every criterion going `unknown` at once is otherwise indistinguishable
 * from the feature not working. The note is text-fallback only — `TaskSummary`
 * is a shared contract with pinned widget baselines, and this is not a reason to
 * move it.
 */
function contractJoinKey(
  body: string,
  frontmatter: Record<string, string>,
): { key: string | null; note: string | null } {
  const stamped = (frontmatter.contract_sha ?? "").trim();
  const blockText = extractContractBlock(body);
  if (!stamped || !blockText) return { key: null, note: null };
  const actual = contractHash(blockText);
  if (actual !== stamped) {
    return {
      key: null,
      note:
        `⚠️ The spec-contract has been EDITED SINCE IT WAS SEALED — stamped \`${stamped}\`, the ` +
        `block now hashes to \`${actual}\`. Recorded runs prove the superseded contract, so no ` +
        `criterion below can claim one and every outcome reads \`unknown\`. Re-seal the spec ` +
        `deliberately (\`spec\` with \`mode: "seal"\`) and re-run the oracles.`,
    };
  }
  return { key: actual, note: null };
}

/**
 * The newest journalled run per criterion, **filtered by the seal first**.
 *
 * The `contract_sha` is the join key, not the criterion id: a spec amended and
 * re-sealed means the criterion AC3 that a run proved is not the criterion AC3
 * in force now, so an entry recorded against another contract is dropped before
 * anything reads it (ADR-0036). A null key — an unsealed spec, or one whose
 * stamp no longer matches its block (`contractJoinKey`) — joins against nothing
 * rather than against every unsealed spec's runs at once.
 *
 * `readOracleRuns` yields oldest-first, so a plain `set` per criterion leaves
 * the newest entry in the map.
 */
function latestRunsByCriterion(
  projectRoot: string,
  slug: string,
  contractSha: string | null,
): Map<string, OracleRun> {
  const sha = contractSha?.trim();
  const runs = new Map<string, OracleRun>();
  if (!sha || !SLUG_RE.test(slug)) return runs;
  for (const run of readOracleRuns(join(projectRoot, ".marvin", "task", "runs"), slug)) {
    if (run.contract_sha !== sha) continue;
    runs.set(run.criterion, run);
  }
  return runs;
}

/**
 * Per-AC outcome from the RECORDED run, never from the gate-level verdict.
 *
 * The verdict does not appear here at all, and that is the change (ADR-0036):
 * the previous body was `passed && real ? "pass" : "unknown"`, which promoted a
 * green suite to a per-criterion `pass` for every test/command oracle — a
 * criterion whose test was never written included. Keeping it as a fallback
 * would preserve exactly that claim behind a new feature.
 *
 * What earns a `pass` is a green phase that exited zero. A green phase that
 * exited non-zero is a `fail`. Everything else is `unknown`: a red-only entry
 * (`expect: "fail"` proves the test fails, not that the criterion holds), a
 * `not-run` entry, an unsealed spec, a stale seal, and an absent journal.
 */
function toAcOutcome(cr: Criterion, run: OracleRun | null): AcOutcome {
  const base = {
    id: cr.id,
    statement: cr.statement,
    oracle_kind: cr.oracle.kind,
    ...(cr.oracle.ref ? { oracle_ref: cr.oracle.ref } : {}),
  };
  return { ...base, outcome: recordedOutcome(run) };
}

function recordedOutcome(run: OracleRun | null): AcOutcome["outcome"] {
  if (!run || run.expect !== "pass") return "unknown";
  if (run.status === "pass") return "pass";
  if (run.status === "fail") return "fail";
  return "unknown"; // not-run — an unresolved command, a signal kill, a launch failure
}

/**
 * `not-run` (a gate whose binary was absent, ADR-0035) and `skip` both map to
 * the `skip` member the `GateOutcome` contract, the widget and its committed
 * fixtures already support — no schema edit, no baseline refresh. Mapping them
 * to `fail` would show a red gate for a tool nobody installed.
 */
function toGateOutcome(g: VerifyGate): GateOutcome {
  const status =
    g.status === "pass" ? "pass" : g.status === "not-run" || g.status === "skip" ? "skip" : "fail";
  return {
    name: g.name as GateOutcome["name"],
    status,
    ...(status === "fail"
      ? { detail: g.status === "error" ? "errored" : `exit ${g.code ?? "?"}` }
      : {}),
    ...(g.status === "not-run" ? { detail: "not run — binary not on PATH" } : {}),
  };
}

/** Commits on the current branch not in the base branch (newest first). */
function readCommits(projectRoot: string, base: string): CommitRef[] {
  if (!inGitRepo(projectRoot)) return [];
  const r = git(
    ["log", `${base}..HEAD`, "--no-merges", "--format=%h%x09%s", "-n", "30"],
    projectRoot,
  );
  if (!r.ok || !r.value.trim()) return [];
  return r.value
    .split("\n")
    .map((line) => {
      const tab = line.indexOf("\t");
      return tab === -1 ? null : { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
    })
    .filter((c): c is CommitRef => c !== null);
}

function buildLinks(
  env: ServerEnv,
  config: Config,
  projectRoot: string,
  slug: string,
  frontmatter: Record<string, string>,
  hostBindings: HostBindings | null,
): LinkRef[] {
  const links: LinkRef[] = [{ kind: "spec", label: slug, ref: slug }];

  const branch = currentBranch(projectRoot);
  if (branch) {
    links.push({ kind: "branch", label: branch, ref: branch });
    const { tasks } = readAllTasks(env.tasksDir, config);
    const pr = findTaskByBranch(tasks, branch)?.frontmatter.pr;
    if (pr) links.push({ kind: "pr", label: prLabel(pr), url: pr });
  }

  const tracker = (frontmatter.tracker ?? "").trim();
  if (tracker && !["none", "n/a", "—", "-"].includes(tracker.toLowerCase())) {
    const url = trackerUrl(config, tracker);
    links.push({ kind: "tracker", label: tracker, ...(url ? { url } : { ref: tracker }) });
  }

  const adr = hostBindings?.decision_record?.path;
  if (adr) links.push({ kind: "adr", label: adr, ref: adr });

  return links;
}

function prLabel(url: string): string {
  const m = url.match(/\/pull\/(\d+)/);
  return m ? `PR #${m[1]}` : "PR";
}

function extractTitle(body: string): string | null {
  const m = body.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1]! : null;
}

// ── text fallback ────────────────────────────────────────────────────────────

/**
 * Four states, one of which used to print the word `undefined`: before the
 * parser was unified, any JSON that survived `JSON.parse` was cast to a verdict
 * and interpolated unchecked. A block that is present but unusable now says so
 * instead of impersonating a verdict — a text-fallback change only; the widget
 * payload never carried the verdict.
 */
function verdictLabel(v: VerifyBlockParse): string {
  if (v.kind === "none") return "not run";
  if (v.kind === "invalid") return "unreadable";
  return v.result.verdict ?? "recorded, no verdict";
}

function render(s: TaskSummary, verification: VerificationSource, sealNote: string | null): string {
  const acIcon = (o: string) => (o === "pass" ? "✅" : o === "fail" ? "❌" : "⚪");
  const gateIcon = (st: string) => (st === "pass" ? "✅" : st === "skip" ? "⚪" : "❌");
  const lines: string[] = [
    `# Task summary — ${s.title}`,
    "",
    // Name the artifact the gates were joined from: with a per-spec run beside a
    // global verification.md, "PASS" alone does not say which run passed.
    `**Spec:** \`${s.slug}\` · **Status:** ${s.status} · **Verification:** ${verdictLabel(
      verification.parse,
    )}${verification.path ? ` (\`${verification.path}\`)` : ""}`,
    ...(sealNote ? ["", sealNote] : []),
    "",
    `## Acceptance (${s.acceptance.length})`,
    ...(s.acceptance.length
      ? s.acceptance.map(
          (a) =>
            `- ${acIcon(a.outcome)} **${a.id}** ${a.statement} — _${a.oracle_kind}${
              a.oracle_ref ? ` ${a.oracle_ref}` : ""
            }_ · ${a.outcome}`,
        )
      : ["_no spec-contract criteria found_"]),
    "",
    `## Gates`,
    ...(s.gates.length
      ? s.gates.map(
          (g) =>
            `- ${gateIcon(g.status)} ${g.name} — ${g.status}${g.detail ? ` (${g.detail})` : ""}`,
        )
      : ["_no verification gates_"]),
    "",
    `## Commits (${s.commits.length})`,
    ...(s.commits.length
      ? s.commits.map((c) => `- \`${c.sha}\` ${c.subject}`)
      : ["_none on this branch vs base_"]),
  ];
  if (s.lessons.length) {
    lines.push(
      "",
      `## Lessons (${s.lessons.length})`,
      ...s.lessons.map((l) => `- ${l.title} (\`${l.id}\`)`),
    );
  }
  lines.push(
    "",
    `## Links`,
    ...s.links.map(
      (l) => `- [${l.kind}] ${l.label}${l.url ? ` → ${l.url}` : l.ref ? ` → \`${l.ref}\`` : ""}`,
    ),
  );
  return lines.join("\n");
}

function errOk(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
