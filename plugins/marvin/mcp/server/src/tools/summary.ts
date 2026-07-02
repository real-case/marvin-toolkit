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
  extractContractBlock,
  extractHostBindings,
  resolveSpecBySlug,
  SPEC_DIRS,
  type Criterion,
} from "../storage/spec.js";
import { parseFrontmatter } from "../storage/frontmatter.js";
import { findTaskByBranch, readAllTasks } from "../storage/tasks.js";
import { searchLessons } from "../storage/lessons.js";
import { trackerUrl } from "../storage/config.js";
import type { Config } from "../storage/schema.js";
import { currentBranch, git, inGitRepo } from "../lib/git.js";
import type { ServerEnv } from "../lib/env.js";

/**
 * "What was done" task-summary aggregator (ADR-0024, widget #3). Joins five
 * already-typed sources for one spec — the spec-contract `criteria`, the
 * `verification.md` gate outcomes, the branch's git log, the captured lessons,
 * and the artifact links — into a single `TaskSummary` payload. No prose is
 * re-parsed: criteria come from the shared spec-contract schema, gates from the
 * machine-readable `verify-result` block (persisted by the `verify` tool).
 *
 * Per-AC `outcome` is deliberately conservative — verify reports gate-level
 * results, not per-criterion, so a criterion is "pass" only when verification
 * passed AND its oracle is a real (test/command) proof; everything else
 * (prose-review oracle, a FAIL verdict, or no verification) is "unknown". The
 * summary never fabricates a per-AC pass/fail it cannot prove.
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

interface VerifyResult {
  verdict: string;
  gates: Array<{ name: string; status: string; code: number | null }>;
}

export function buildSummaryTool(env: ServerEnv, config: Config): AnyToolDef {
  return defineTool({
    name: "summary",
    description:
      "Aggregate a spec's acceptance criteria, verification gates, commits, lessons and links into a 'what was done' task summary.",
    inputSchema: SummaryInput,
    handler: (input) => Promise.resolve(runSummary(env, config, input)),
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
  const verify = readVerifyResult(projectRoot);

  const acceptance: AcOutcome[] = (contract?.criteria ?? []).map((cr) => toAcOutcome(cr, verify));
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
    content: [{ type: "text", text: render(summary, verify) }],
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

/** Read the machine-readable verify-result block from verification.md. */
function readVerifyResult(projectRoot: string): VerifyResult | null {
  const path = join(projectRoot, ".marvin", "task", "verification.md");
  if (!existsSync(path)) return null;
  const m = readFileSync(path, "utf8").match(/```json verify-result\n([\s\S]*?)\n```/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]!) as VerifyResult;
    return { verdict: parsed.verdict, gates: parsed.gates ?? [] };
  } catch {
    return null;
  }
}

// ── joins ────────────────────────────────────────────────────────────────────

/** Conservative per-AC outcome: only "pass" with a real proof on a passing
 * verification; never a fabricated per-AC "fail". */
function toAcOutcome(cr: Criterion, verify: VerifyResult | null): AcOutcome {
  const base = {
    id: cr.id,
    statement: cr.statement,
    oracle_kind: cr.oracle.kind,
    ...(cr.oracle.ref ? { oracle_ref: cr.oracle.ref } : {}),
  };
  const passed = verify?.verdict === "PASS" || verify?.verdict === "PASS WITH WARNINGS";
  const real = cr.oracle.kind === "test" || cr.oracle.kind === "command";
  return { ...base, outcome: passed && real ? "pass" : "unknown" };
}

function toGateOutcome(g: { name: string; status: string; code: number | null }): GateOutcome {
  const status = g.status === "pass" ? "pass" : "fail";
  return {
    name: g.name as GateOutcome["name"],
    status,
    ...(status === "fail"
      ? { detail: g.status === "error" ? "errored" : `exit ${g.code ?? "?"}` }
      : {}),
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

function render(s: TaskSummary, verify: VerifyResult | null): string {
  const acIcon = (o: string) => (o === "pass" ? "✅" : o === "fail" ? "❌" : "⚪");
  const gateIcon = (st: string) => (st === "pass" ? "✅" : st === "skip" ? "⚪" : "❌");
  const lines: string[] = [
    `# Task summary — ${s.title}`,
    "",
    `**Spec:** \`${s.slug}\` · **Status:** ${s.status}${
      verify ? ` · **Verification:** ${verify.verdict}` : " · **Verification:** not run"
    }`,
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
