import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import { parseFrontmatter } from "../storage/frontmatter.js";
import type { ServerEnv } from "../lib/env.js";

/**
 * Deterministic Definition-of-Ready gate (ADR-0005, extended by ADR-0006).
 * Validates a task spec against the contract that Phase 2 (task-implement /
 * marvin-tm-executor) relies on: required frontmatter + valid enums (incl.
 * `breaking`, `spike_required`), all required sections present (incl. Definition
 * of Done), a File Change Plan whose edit/delete targets exist on disk, the
 * AC⇄files⇄tests traceability triple (every criterion maps to real plan IDs,
 * every `Satisfies` points at a real criterion, every `verified_by` test is an
 * allowlisted plan row, and ≥1 criterion carries a non-prose-review proof),
 * open questions resolved, and no leftover `{…}` template placeholders.
 *
 * The point mirrors ADR-0004: these are properties checked by code, not by a
 * model re-reading its own markdown checklist. The critic (marvin-tm-spec-critic)
 * remains the *semantic* complement — it judges whether a verified_by is genuine;
 * this tool only proves the contract's shape and internal references are complete.
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
const ACTION_VALUES = ["new", "edit", "delete"] as const;

/** Canonicalised (## heading → lowercase, alnum-separated) required/recommended
 * sections per type. A missing required section is a FAIL; a missing
 * recommended one is a WARN. "N/A"/"none" content is fine — the author must
 * still address each required section explicitly. */
const FEATURE_REQUIRED = [
  "goal",
  "file change plan",
  "interface contract",
  "data config",
  "chosen approach",
  "acceptance criteria",
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
  "file change plan",
  "fix approach",
  "acceptance criteria",
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

const MIN_AC: Record<string, number> = { feature: 3, bugfix: 2 };

const SpecInput = z.object({
  specPath: z
    .string()
    .optional()
    .describe("Path to the spec file to validate (relative to projectRoot or absolute)."),
  specContent: z
    .string()
    .optional()
    .describe("Inline spec content — the draft at DoR time, before it is written to specs/."),
  projectRoot: z
    .string()
    .optional()
    .describe(
      "Project root for File Change Plan path-existence checks. Defaults to CLAUDE_PROJECT_DIR / cwd.",
    ),
});
type SpecInput = z.infer<typeof SpecInput>;

export function buildSpecTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "spec",
    description:
      "Validate a task spec against the Definition of Ready mechanically — frontmatter + enums (incl. breaking / spike_required), required sections (incl. Definition of Done), File Change Plan path existence + size, acceptance-criteria proofs (verified_by), the AC⇄files⇄tests traceability triple (every criterion maps to plan files, every verified_by test is allowlisted, ≥1 real proof), resolved open questions, no leftover placeholders. The tool-backed DoR gate for /marvin:task-start. Returns PASS / PASS WITH WARNINGS / FAIL.",
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

  const { type, checks } = validateSpec(raw, projectRoot);
  return result(computeVerdict(checks), type, checks);
}

function validateSpec(raw: string, projectRoot: string): { type: string | null; checks: Check[] } {
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
    checks.push(...checkFileChangePlan(sections.get("file change plan"), projectRoot));
    checks.push(...checkAcceptanceCriteria(sections.get("acceptance criteria"), MIN_AC[type]!));
    checks.push(checkOpenQuestions(sections.get("open questions")));
    checks.push(
      ...checkTraceability(sections.get("file change plan"), sections.get("acceptance criteria")),
    );
    if (type === "feature") {
      checks.push(checkContract(sections.get("interface contract")));
    }
  } else {
    checks.push(
      fail("type", "Frontmatter", "cannot validate sections without a valid type (feature|bugfix)"),
    );
  }

  return { type, checks };
}

// ── individual checks ────────────────────────────────────────────────────

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
  // An omitted flag is a FAIL, not a lenient WARN: a "ready" spec that never
  // states its public-surface impact lets the executor ship a breaking change blind.
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

function checkFileChangePlan(section: string | undefined, projectRoot: string): Check[] {
  if (section === undefined) {
    return [fail("file-change-plan", "File Change Plan", "section missing")];
  }
  const table = parseTable(section);
  if (!table || table.rows.length === 0) {
    return [
      fail(
        "file-change-plan",
        "File Change Plan",
        "no table rows — list each file with Path/Action",
      ),
    ];
  }
  const pathIdx = table.headers.findIndex((h) => h.includes("path"));
  const actionIdx = table.headers.findIndex((h) => h.includes("action"));
  if (pathIdx === -1 || actionIdx === -1) {
    return [fail("file-change-plan", "File Change Plan", "table needs Path and Action columns")];
  }

  const checks: Check[] = [];
  const missing: string[] = [];
  const newButExists: string[] = [];
  let valid = 0;

  for (const row of table.rows) {
    const rawPath = (row[pathIdx] ?? "").replace(/`/g, "").trim();
    const action = (row[actionIdx] ?? "").toLowerCase().trim();
    if (!rawPath) continue;
    if (!ACTION_VALUES.includes(action as (typeof ACTION_VALUES)[number])) {
      checks.push(
        warn(
          "fcp-action",
          "File Change Plan",
          `row "${rawPath}" has action "${action}" (expected new/edit/delete)`,
        ),
      );
      continue;
    }
    valid += 1;
    const abs = isAbsolute(rawPath) ? rawPath : join(projectRoot, rawPath);
    const exists = existsSync(abs);
    if ((action === "edit" || action === "delete") && !exists) missing.push(rawPath);
    if (action === "new" && exists) newButExists.push(rawPath);
  }

  checks.push(
    valid === 0
      ? fail("file-change-plan", "File Change Plan", "no rows with a valid action")
      : pass("file-change-plan", "File Change Plan", `${valid} file(s) planned`),
  );
  if (valid > 12) {
    checks.push(
      warn(
        "fcp-size",
        "File Change Plan",
        `${valid} files planned — confirm this is one PR, not several (scope gate)`,
      ),
    );
  }
  if (missing.length) {
    checks.push(
      fail(
        "fcp-paths",
        "File Change Plan paths",
        `edit/delete target(s) not found: ${missing.join(", ")}`,
      ),
    );
  }
  if (newButExists.length) {
    checks.push(
      warn(
        "fcp-new-exists",
        "File Change Plan paths",
        `marked "new" but already exist: ${newButExists.join(", ")}`,
      ),
    );
  }
  return checks;
}

function checkAcceptanceCriteria(section: string | undefined, min: number): Check[] {
  if (section === undefined) {
    return [fail("acceptance-criteria", "Acceptance Criteria", "section missing")];
  }
  const table = parseTable(section);
  if (!table || table.rows.length === 0) {
    return [fail("acceptance-criteria", "Acceptance Criteria", "no criteria table rows found")];
  }

  const checks: Check[] = [];
  checks.push(
    table.rows.length < min
      ? fail("ac-count", "Acceptance Criteria", `only ${table.rows.length} criteria; need ≥${min}`)
      : pass("ac-count", "Acceptance Criteria", `${table.rows.length} criteria`),
  );

  const verifiedIdx = table.headers.findIndex((h) => h.includes("verified"));
  if (verifiedIdx === -1) {
    checks.push(fail("ac-verified-by", "Acceptance Criteria", "table has no verified_by column"));
    return checks;
  }

  const empty: string[] = [];
  table.rows.forEach((row, i) => {
    if (isEmptyCell((row[verifiedIdx] ?? "").replace(/`/g, ""))) empty.push(`row ${i + 1}`);
  });
  checks.push(
    empty.length
      ? fail("ac-verified-by", "Acceptance Criteria", `empty verified_by in: ${empty.join(", ")}`)
      : pass("ac-verified-by", "Acceptance Criteria", "every criterion has a verified_by"),
  );

  return checks;
}

/**
 * The traceability triple: every acceptance criterion is implemented by named
 * File-Change-Plan rows and proven by a real verifier, and every test it names
 * lives inside the allowlist. This is the property that lets Phase 2 execute
 * without inferring the AC→file→test mapping. Shape only — the critic still
 * judges whether a proof is genuine.
 */
function checkTraceability(fcpSection: string | undefined, acSection: string | undefined): Check[] {
  if (fcpSection === undefined || acSection === undefined) return [];
  const fcp = parseTable(fcpSection);
  const ac = parseTable(acSection);
  if (!fcp || !ac || fcp.rows.length === 0 || ac.rows.length === 0) return [];

  const col = (t: ParsedTable, pred: (h: string) => boolean) => t.headers.findIndex(pred);
  const cell = (row: string[], i: number) =>
    i === -1 ? "" : (row[i] ?? "").replace(/`/g, "").trim();

  const fcpIdIdx = col(fcp, (h) => h === "id");
  const fcpPathIdx = col(fcp, (h) => h.includes("path"));
  const fcpSatIdx = col(fcp, (h) => h.includes("satisf"));
  const acIdIdx = col(ac, (h) => h === "id");
  const acImplIdx = col(ac, (h) => h.includes("implement"));
  const acVerIdx = col(ac, (h) => h.includes("verified"));

  const checks: Check[] = [];

  // The linking columns are load-bearing: without them the AC⇄files⇄tests graph
  // cannot be verified, so the spec is not ready to dispatch. Their absence is a
  // FAIL, not a lenient WARN — a renamed or omitted column must never silently
  // disable the strongest guarantee in the gate. Fail closed, never open.
  if (fcpIdIdx === -1 || acIdIdx === -1 || acImplIdx === -1) {
    return [
      fail(
        "traceability",
        "Traceability",
        "File Change Plan needs an ID column and Acceptance Criteria need ID + Implemented-by — without them the AC ⇄ files ⇄ tests graph cannot be verified",
      ),
    ];
  }

  const refs = (s: string) =>
    s
      .split(/[,\s]+/)
      .map((x) => x.trim().toUpperCase())
      .filter((x) => x && !["-", "—", "N/A", "NONE"].includes(x));

  const fcpIds = new Set(fcp.rows.map((r) => cell(r, fcpIdIdx).toUpperCase()).filter(Boolean));
  const acIds = new Set(ac.rows.map((r) => cell(r, acIdIdx).toUpperCase()).filter(Boolean));
  const fcpPaths = new Set(fcp.rows.map((r) => cell(r, fcpPathIdx)).filter(Boolean));

  // 1. Every AC names ≥1 implementing file; each named file exists in the plan.
  const acNoImpl: string[] = [];
  const acBadImpl: string[] = [];
  ac.rows.forEach((r) => {
    const id = cell(r, acIdIdx).toUpperCase() || "?";
    const named = refs(cell(r, acImplIdx));
    if (named.length === 0) {
      acNoImpl.push(id);
      return;
    }
    const dangling = named.filter((n) => !fcpIds.has(n));
    if (dangling.length) acBadImpl.push(`${id}→${dangling.join("/")}`);
  });
  if (acBadImpl.length) {
    checks.push(
      fail(
        "ac-traceability",
        "Traceability",
        `criteria reference unknown File-Change-Plan IDs: ${acBadImpl.join(", ")}`,
      ),
    );
  } else if (acNoImpl.length) {
    checks.push(
      warn(
        "ac-traceability",
        "Traceability",
        `criteria with no Implemented-by file: ${acNoImpl.join(", ")}`,
      ),
    );
  } else {
    checks.push(pass("ac-traceability", "Traceability", "every criterion maps to plan files"));
  }

  // 2. Every Satisfies link on a file points at a real AC.
  if (fcpSatIdx !== -1) {
    const badSat: string[] = [];
    fcp.rows.forEach((r) => {
      const fid = cell(r, fcpIdIdx).toUpperCase() || "?";
      const dangling = refs(cell(r, fcpSatIdx)).filter((n) => !acIds.has(n));
      if (dangling.length) badSat.push(`${fid}→${dangling.join("/")}`);
    });
    if (badSat.length) {
      checks.push(
        fail(
          "fcp-traceability",
          "Traceability",
          `File-Change-Plan rows satisfy unknown criteria: ${badSat.join(", ")}`,
        ),
      );
    }
  }

  // 3. Every test named in a verified_by is allowlisted, and ≥1 criterion
  //    carries a real (non-prose-review) proof.
  if (acVerIdx !== -1) {
    let realProofs = 0;
    const testsOutsidePlan: string[] = [];
    ac.rows.forEach((r) => {
      const v = cell(r, acVerIdx);
      const low = v.toLowerCase();
      if (!v || low === "prose-review" || low === "prose review") return;
      realProofs += 1;
      for (const token of v.split(/[;,]+/)) {
        const path = testPath(token);
        if (path && !fcpPaths.has(path)) testsOutsidePlan.push(path);
      }
    });
    checks.push(
      realProofs === 0
        ? fail(
            "ac-verified-real",
            "Acceptance Criteria",
            "every criterion is prose-review — at least one needs a real test or command",
          )
        : pass(
            "ac-verified-real",
            "Acceptance Criteria",
            `${realProofs} criterion(s) with a real proof`,
          ),
    );
    if (testsOutsidePlan.length) {
      checks.push(
        fail(
          "ac-test-in-plan",
          "Acceptance Criteria",
          `verified_by test(s) not in the File Change Plan allowlist: ${[...new Set(testsOutsidePlan)].join(", ")}`,
        ),
      );
    }
  }

  return checks;
}

/** Extract a file path from a verified_by token, or null if it is a command or
 * prose-review. `test/x.test.ts::name` → `test/x.test.ts`; `npm run build` → null. */
function testPath(token: string): string | null {
  let t = token.replace(/`/g, "").trim();
  if (/^cmd:/i.test(t)) return null;
  t = t.replace(/^test:/i, "");
  const file = (t.split("::")[0] ?? "").trim();
  if (!file || /\s/.test(file)) return null; // commands have spaces
  if (!file.includes("/")) return null; // bare word, not a path
  if (!/\.[A-Za-z0-9]+$/.test(file)) return null; // needs a file extension
  return file;
}

/** The Interface/Contract should be a literal code block the implementer copies,
 * not prose to interpret. "N/A" (no callable surface) is fine. */
function checkContract(section: string | undefined): Check {
  const body = (section ?? "").trim();
  const low = body.toLowerCase();
  if (body === "" || low === "n/a" || low.startsWith("n/a")) {
    return pass("contract-code", "Interface / Contract", "no callable surface (N/A)");
  }
  if (body.includes("```")) {
    return pass("contract-code", "Interface / Contract", "literal code block present");
  }
  return warn(
    "contract-code",
    "Interface / Contract",
    "prose contract — prefer a literal code block the implementer copies",
  );
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
  // Strip fenced and inline code so real code (e.g. `{}`) is not flagged.
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

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/** Parse the first markdown pipe-table in a section. Headers are canonicalised. */
function parseTable(section: string): ParsedTable | null {
  const rowLines = section
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));
  if (rowLines.length < 2) return null;

  const cells = (line: string) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  const isSeparator = (line: string) => /^\|?[\s:|-]+\|?$/.test(line) && line.includes("-");

  const headers = cells(rowLines[0]!).map(canon);
  const dataStart = rowLines[1] && isSeparator(rowLines[1]) ? 2 : 1;
  const rows = rowLines
    .slice(dataStart)
    .filter((l) => !isSeparator(l))
    .map(cells);
  return { headers, rows };
}

function isEmptyCell(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "" || ["-", "—", "n/a", "tbd", "todo", "?"].includes(v);
}

// ── result construction ────────────────────────────────────────────────────

function computeVerdict(checks: Check[]): Verdict {
  if (checks.some((c) => c.status === "fail")) return "FAIL";
  if (checks.some((c) => c.status === "warn")) return "PASS WITH WARNINGS";
  return "PASS";
}

function result(verdict: Verdict, type: string | null, checks: Check[]): ToolResult {
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
