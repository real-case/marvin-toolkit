import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import {
  FindingClaim,
  FindingLinks,
  FlowMap,
  HUNT_STATE_VERSION,
  HuntCheck,
  HuntConfig,
  VerdictEntry,
  type HuntFinding,
  type HuntRun,
  type LedgerLine,
} from "@marvin-toolkit/mcp-shared/contracts";
import type { ServerEnv } from "../lib/env.js";
import {
  currentBranch,
  git,
  hasUncommittedChanges,
  headSha,
  inGitRepo,
  isIgnored,
} from "../lib/git.js";
import { parseVerifyBlock } from "../lib/reports.js";
import { keyList, strictInput } from "../lib/strict-input.js";
import {
  OPEN_STATUSES,
  SETTABLE_STATUSES,
  atOrAbove,
  foldLedger,
  planRecord,
  planVerdict,
  rankFindings,
  renderReport,
  reportSection,
  summaryParagraph,
  triageGroups,
} from "../lib/hunt-ledger.js";
import { danglingRefs, diffFlows, mergeFlows } from "../lib/hunt-flows.js";
import { collectSignals, rankHotspots, resolveScope } from "../lib/hunt-scope.js";
import {
  FLOWS_FILE,
  HuntStateError,
  appendLedger,
  ensureHuntDir,
  listRunIds,
  readCoverage,
  readFlows,
  readHuntConfig,
  readLedger,
  readRun,
  runDir,
  writeCoverage,
  writeFlows,
  writeHuntConfig,
  writeReport,
  writeRun,
} from "../storage/hunt.js";

/**
 * The bug-hunter's deterministic half (ADR-0053): every write under `.marvin/hunt/`, every git
 * read, the hotspot order, the ledger's identity and the verification protocol's transitions.
 * The `hunt-*` skills and the `marvin-hunt-*` agents decide what is a defect; this tool decides
 * what that decision does to the shared state, and refuses what the protocol forbids (PKG-04,
 * NFR-04). It never edits source code, never commits and never pushes (ORC-07).
 */

export const HUNT_ACTIONS = [
  "init",
  "preflight",
  "baseline",
  "hotspots",
  "checkpoint",
  "flows",
  "record",
  "verdict",
  "set-status",
  "link",
  "triage",
  "finalize",
  "report",
  "status",
] as const;

const HuntInput = strictInput(
  z.object({
    action: z.enum(HUNT_ACTIONS).describe("What to do; see the tool description."),
    run_id: z
      .string()
      .optional()
      .describe(
        "The run this call belongs to (from preflight). Required by baseline, hotspots, checkpoint, record, finalize.",
      ),
    check: HuntCheck.optional().describe("preflight: which check this run is. Default code."),
    paths: z
      .array(z.string().min(1))
      .optional()
      .describe("preflight: path prefixes or globs; overrides hunt.scope.paths."),
    since: z
      .string()
      .min(1)
      .optional()
      .describe("preflight: hunt only files changed since the merge base with this ref."),
    diff: z.boolean().optional().describe("preflight: hunt only the uncommitted diff."),
    config: z
      .record(z.unknown())
      .optional()
      .describe("init: the hunt settings to merge over the current ones."),
    findings: z
      .array(z.unknown())
      .optional()
      .describe("record: finding claims (finding.schema.json)."),
    flows: z
      .unknown()
      .optional()
      .describe(
        "flows: the regenerated flow map (flows.schema.json). Omit to read the current one.",
      ),
    id: z
      .string()
      .optional()
      .describe("verdict / set-status / link: the finding id, e.g. BH-2026-0007."),
    verdict: z
      .unknown()
      .optional()
      .describe("verdict: { stage, ruling, by, reasoning, failure_kind? }."),
    status: z
      .string()
      .optional()
      .describe(`set-status: one of ${SETTABLE_STATUSES.join(", ")}.`),
    reason: z.string().optional().describe("set-status: why."),
    links: z
      .unknown()
      .optional()
      .describe("link: { task?, root_cause?, duplicate_of?, related?, commit?, adr?, spec? }."),
    step: z
      .string()
      .optional()
      .describe("checkpoint: the step just completed, e.g. map, hunt, challenge, rule, prove."),
    note: z
      .string()
      .optional()
      .describe("checkpoint: a short note. finalize: the summary to store."),
    round: z.number().int().min(1).optional().describe("checkpoint: convergence round."),
    batch: z.number().int().min(1).optional().describe("checkpoint: hotspot batch just finished."),
  }),
  (keys) => `hunt does not take ${keyList(keys)}.`,
);
type Input = z.infer<typeof HuntInput>;

export function buildHuntTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "hunt",
    description:
      "The bug-hunter's state under .marvin/hunt/ (ADR-0053/0054), driven by the hunt-* commands. " +
      "init writes the `hunt` settings; preflight opens a run and resolves its scope; baseline " +
      "attaches the latest verify result; hotspots ranks the scope deterministically; checkpoint " +
      "saves progress; flows writes or reads the flow map; record appends finding claims to the " +
      "ledger (deduplicated by fingerprint); verdict applies a skeptic, referee, reproducing-test " +
      "or human ruling under the verification protocol; set-status and link annotate a finding; " +
      "triage ranks the open findings and lists duplicates, systemic patterns and stale ones; " +
      "finalize closes a run, updates coverage and writes its report; report renders the ledger; " +
      "status summarises. Never edits source, commits or pushes.",
    inputSchema: HuntInput,
    handler: (input) => Promise.resolve(huntRun(env, input)),
  });
}

function huntReply(body: string, structured?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: body }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

function huntFail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function huntZodIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 6)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

function huntNowIso(): string {
  return new Date().toISOString();
}

function huntRunIdFor(check: string, d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}-${check}`;
}

function huntRequireRun(env: ServerEnv, input: Input): HuntRun {
  if (!input.run_id) throw new HuntStateError(`${input.action} needs run_id (from preflight).`);
  const r = readRun(env.huntDir, input.run_id);
  if (r.state !== "running" && input.action !== "finalize") {
    throw new HuntStateError(`run ${r.id} is ${r.state}; open a new one with preflight.`);
  }
  return r;
}

function huntRun(env: ServerEnv, input: Input): ToolResult {
  try {
    switch (input.action) {
      case "init":
        return huntInit(env, input);
      case "preflight":
        return huntPreflight(env, input);
      case "baseline":
        return huntBaseline(env, input);
      case "hotspots":
        return huntHotspots(env, input);
      case "checkpoint":
        return huntCheckpoint(env, input);
      case "flows":
        return huntFlows(env, input);
      case "record":
        return huntRecord(env, input);
      case "verdict":
        return huntVerdict(env, input);
      case "set-status":
        return huntSetStatus(env, input);
      case "link":
        return huntLink(env, input);
      case "triage":
        return huntTriage(env);
      case "finalize":
        return huntFinalize(env, input);
      case "report":
        return huntReport(env);
      case "status":
        return huntStatus(env);
    }
  } catch (err) {
    if (err instanceof HuntStateError) return huntFail(err.message);
    throw err;
  }
}

// ── init ──────────────────────────────────────────────────────────────────

function huntInit(env: ServerEnv, input: Input): ToolResult {
  const current = readHuntConfig(env.configPath);
  const merged = huntDeepMerge(
    current.config as unknown as Record<string, unknown>,
    input.config ?? {},
  );
  const parsed = HuntConfig.safeParse(merged);
  if (!parsed.success)
    return huntFail(
      `The hunt settings are invalid: ${huntZodIssues(parsed.error)}. Nothing was written.`,
    );
  writeHuntConfig(env.configPath, parsed.data);
  ensureHuntDir(env.huntDir);
  const rel = huntRelToProject(env, env.huntDir);
  const ignored = inGitRepo(env.projectDir)
    ? isIgnored(join(rel, "findings.jsonl"), env.projectDir)
    : null;
  const lines = [
    `# Hunt settings ${current.present ? "updated" : "created"}`,
    "",
    "```json",
    JSON.stringify(parsed.data, null, 2),
    "```",
    "",
    `State directory: \`${rel}/\` (run state and evidence stay local through its own .gitignore).`,
  ];
  if (ignored === true) {
    lines.push(
      "",
      `⚠ git ignores \`${rel}/findings.jsonl\`. The ledger, flow map and coverage are meant to be committed so verdicts survive the machine: add \`!${rel}/\` after the rule that ignores \`.marvin/\`.`,
    );
  }
  return huntReply(lines.join("\n"), { config: parsed.data, ignored });
}

function huntDeepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const b = out[k];
    out[k] =
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      b &&
      typeof b === "object" &&
      !Array.isArray(b)
        ? huntDeepMerge(b as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}

function huntRelToProject(env: ServerEnv, abs: string): string {
  return abs.startsWith(env.projectDir)
    ? abs.slice(env.projectDir.length).replace(/^[\\/]/, "") || "."
    : abs;
}

// ── preflight / baseline / hotspots / checkpoint ─────────────────────────

function huntPreflight(env: ServerEnv, input: Input): ToolResult {
  if (!inGitRepo(env.projectDir))
    return huntFail("A hunt needs a git repository: scope, hotspots and provenance all read git.");
  const { config } = readHuntConfig(env.configPath);
  const check = input.check ?? "code";
  const scope = resolveScope(
    env.projectDir,
    { paths: input.paths, since: input.since, diff: input.diff },
    config,
  );
  const id = huntRunIdFor(check);
  if (existsSync(join(runDir(env.huntDir, id), "run.json"))) {
    return huntFail(`A run ${id} already exists; wait a second and retry.`);
  }
  const record: HuntRun = {
    version: HUNT_STATE_VERSION,
    id,
    check,
    state: "running",
    started_at: huntNowIso(),
    branch: currentBranch(env.projectDir),
    head_sha: headSha(env.projectDir),
    dirty: hasUncommittedChanges(env.projectDir),
    scope,
    authority: config.authority.mode,
    hotspots: [],
    steps: [{ step: "preflight", at: huntNowIso() }],
    recorded: [],
  };
  writeRun(env.huntDir, record);
  const floor = config.severity_floor[check];
  const body = [
    `# Hunt run \`${id}\` (${check})`,
    "",
    `- Branch \`${record.branch ?? "detached"}\` at \`${record.head_sha?.slice(0, 12) ?? "no commit"}\`${record.dirty ? " · working tree has uncommitted changes" : ""}`,
    `- Scope: ${scope.kind}${scope.base ? ` since \`${scope.base}\`` : ""}${scope.paths.length ? ` · ${scope.paths.join(", ")}` : ""} → **${scope.files.length} file(s)**`,
    `- Authority: ${config.authority.mode} · severity floor ${floor} · budget ${config.budgets.max_minutes} min, ${config.budgets.max_rounds} round(s)`,
    "",
    scope.files.length === 0
      ? "Nothing in scope: widen `paths` or check `hunt.scope.exclude`."
      : 'Next: `verify` (standalone), then `hunt action: "baseline"`, then `hunt action: "hotspots"`.',
  ];
  return huntReply(body.join("\n"), { run_id: id, run: record, config });
}

function huntBaseline(env: ServerEnv, input: Input): ToolResult {
  const r = huntRequireRun(env, input);
  const path = join(env.projectDir, ".marvin", "task", "verification.md");
  if (!existsSync(path)) {
    return huntFail(
      "No .marvin/task/verification.md. Run the `verify` tool (action run, no specSlug) first, then call baseline again.",
    );
  }
  const parsed = parseVerifyBlock(readFileSync(path, "utf8"));
  if (parsed.kind !== "ok") {
    return huntFail(
      `verification.md carries no readable verify-result block (${parsed.kind === "invalid" ? parsed.reason : "none"}). Rerun verify.`,
    );
  }
  const res = parsed.result;
  const recordedSha = res.provenance?.head_sha ?? null;
  const stale = recordedSha !== r.head_sha;
  const updated: HuntRun = {
    ...r,
    baseline: {
      verdict: res.verdict ?? "UNKNOWN",
      head_sha: recordedSha,
      gates: res.gates.map((g) => ({ name: g.name, status: g.status ?? "unknown" })),
      stale,
    },
    steps: [...r.steps, { step: "baseline", at: huntNowIso() }],
  };
  writeRun(env.huntDir, updated);
  const gates = updated.baseline!.gates.map((g) => `${g.name}=${g.status}`).join(", ") || "none";
  return huntReply(
    [
      `Baseline for \`${r.id}\`: **${updated.baseline!.verdict}** (${gates}).`,
      stale
        ? `⚠ The verification ran at \`${recordedSha?.slice(0, 12) ?? "unknown"}\`, not at this run's \`${r.head_sha?.slice(0, 12) ?? "unknown"}\`; rerun verify for a baseline of this commit.`
        : "Recorded at this run's commit.",
      "A red baseline is not a finding: reproducing tests are judged against it, so note which gates were already failing.",
    ].join("\n"),
    { baseline: updated.baseline },
  );
}

function huntHotspots(env: ServerEnv, input: Input): ToolResult {
  const r = huntRequireRun(env, input);
  const { config } = readHuntConfig(env.configPath);
  const coverage = readCoverage(env.huntDir);
  const tracked = git(["ls-files", "-z"], env.projectDir, { maxBuffer: 256 * 1024 * 1024 });
  const all = tracked.ok ? tracked.value.split("\0").filter(Boolean) : [];
  const { signals } = collectSignals(
    env.projectDir,
    r.scope.files,
    config.history_months,
    coverage,
    all,
    Date.now(),
  );
  const ranked = rankHotspots(signals, config.budgets.max_hotspots, config.budgets.batch_size);
  writeRun(env.huntDir, {
    ...r,
    hotspots: ranked,
    steps: [...r.steps, { step: "hotspots", at: huntNowIso() }],
  });
  const batches = ranked.length === 0 ? 0 : ranked[ranked.length - 1]!.batch;
  const lines = [
    `# Hotspots for \`${r.id}\` — ${ranked.length} of ${r.scope.files.length} file(s), ${batches} batch(es)`,
    "",
    "| # | Batch | Score | File | Why |",
    "| --- | --- | --- | --- | --- |",
    ...ranked.map(
      (h) => `| ${h.rank} | ${h.batch} | ${h.score} | \`${h.path}\` | ${h.why.join("; ")} |`,
    ),
  ];
  return huntReply(lines.join("\n"), { hotspots: ranked, batches });
}

function huntCheckpoint(env: ServerEnv, input: Input): ToolResult {
  const r = huntRequireRun(env, input);
  if (!input.step) return huntFail("checkpoint needs step.");
  const step = {
    step: input.step,
    at: huntNowIso(),
    ...(input.note ? { note: input.note } : {}),
    ...(input.round ? { round: input.round } : {}),
    ...(input.batch ? { batch: input.batch } : {}),
  };
  writeRun(env.huntDir, { ...r, steps: [...r.steps, step] });
  return huntReply(
    `Saved \`${input.step}\`${input.batch ? ` (batch ${input.batch})` : ""} for \`${r.id}\`.`,
  );
}

// ── flows ─────────────────────────────────────────────────────────────────

function huntFlows(env: ServerEnv, input: Input): ToolResult {
  const prev = readFlows(env.huntDir);
  if (input.flows === undefined) {
    if (!prev)
      return huntReply("No flow map yet. `/marvin:hunt-code` builds one.", { flows: null });
    return huntReply(
      `Flow map: ${prev.nodes.length} node(s), ${prev.transitions.length} transition(s), ${prev.journeys.length} journey(s), ${prev.anomalies.length} anomaly(ies). File: \`.marvin/hunt/${FLOWS_FILE}\`.`,
      { flows: prev },
    );
  }
  const parsed = FlowMap.safeParse(input.flows);
  if (!parsed.success)
    return huntFail(
      `The flow map is invalid: ${huntZodIssues(parsed.error)}. Nothing was written.`,
    );
  const r = input.run_id ? huntRequireRun(env, input) : null;
  const next = mergeFlows(
    {
      ...parsed.data,
      generated_at: huntNowIso(),
      ...(r ? { run_id: r.id, head_sha: r.head_sha } : {}),
    },
    prev,
  );
  const dangling = danglingRefs(next);
  if (dangling.length > 0) {
    return huntFail(
      `The flow map references things it does not define: ${dangling.slice(0, 8).join("; ")}. Nothing was written.`,
    );
  }
  ensureHuntDir(env.huntDir);
  writeFlows(join(env.huntDir, FLOWS_FILE), next);
  if (r) {
    writeFlows(join(runDir(env.huntDir, r.id), FLOWS_FILE), next);
    writeRun(env.huntDir, { ...r, steps: [...r.steps, { step: "flows", at: huntNowIso() }] });
  }
  const d = diffFlows(next, prev);
  const changes = (["nodes", "transitions", "journeys"] as const)
    .map((k) => `${k}: +${d[k].added.length} −${d[k].removed.length}`)
    .join(" · ");
  return huntReply(
    [
      `Flow map written: ${next.nodes.length} node(s), ${next.transitions.length} transition(s), ${next.journeys.length} journey(s).`,
      prev ? `Since the previous map — ${changes}.` : "First map for this project.",
      ...(d.nodes.removed.length ? [`Disappeared: ${d.nodes.removed.join(", ")}.`] : []),
    ].join("\n"),
    { diff: d },
  );
}

// ── ledger writes ─────────────────────────────────────────────────────────

function huntRecord(env: ServerEnv, input: Input): ToolResult {
  const r = huntRequireRun(env, input);
  const raw = input.findings ?? [];
  if (raw.length === 0)
    return huntFail("record needs findings: an array of claims (finding.schema.json).");
  const claims: z.infer<typeof FindingClaim>[] = [];
  const errors: string[] = [];
  raw.forEach((c, i) => {
    const p = FindingClaim.safeParse(c);
    if (p.success) claims.push(p.data);
    else errors.push(`findings[${i}]: ${huntZodIssues(p.error)}`);
  });
  if (errors.length > 0)
    return huntFail(`Nothing was recorded; fix these claims first:\n${errors.join("\n")}`);
  const { lines } = readLedger(env.huntDir);
  const state = foldLedger(lines);
  const plan = planRecord(state, claims, { runId: r.id, headSha: r.head_sha, now: huntNowIso() });
  appendLedger(env.huntDir, plan.lines);
  const newIds = plan.results.filter((x) => x.outcome === "new").map((x) => x.id);
  writeRun(env.huntDir, { ...r, recorded: [...r.recorded, ...plan.results.map((x) => x.id)] });
  const body = plan.results.map((x, i) => {
    const t = claims[i]!.title;
    switch (x.outcome) {
      case "new":
        return `- **${x.id}** new · ${t}${x.note ? ` (${x.note})` : ""}`;
      case "duplicate":
        return `- ${x.id} already in the ledger (${x.status}) · ${t}`;
      case "suppressed":
        return `- ${x.id} suppressed: a person closed it as ${x.status}; not reported again without new evidence · ${t}`;
      case "regressed":
        return `- **${x.id} REGRESSED**: marked fixed and seen again. Escalate (ORC-06) · ${t}`;
    }
  });
  return huntReply(
    [
      `Recorded ${newIds.length} new of ${claims.length} claim(s) in run \`${r.id}\`:`,
      ...body,
    ].join("\n"),
    { results: plan.results },
  );
}

function huntFindingOr(
  env: ServerEnv,
  id: string | undefined,
): { f: HuntFinding } | { error: ToolResult } {
  if (!id) return { error: huntFail("This action needs id (e.g. BH-2026-0007).") };
  const state = foldLedger(readLedger(env.huntDir).lines);
  const f = state.findings.get(id);
  return f ? { f } : { error: huntFail(`No finding ${id} in the ledger.`) };
}

function huntVerdict(env: ServerEnv, input: Input): ToolResult {
  const got = huntFindingOr(env, input.id);
  if ("error" in got) return got.error;
  const raw = (
    typeof input.verdict === "object" && input.verdict !== null ? input.verdict : {}
  ) as Record<string, unknown>;
  const parsed = VerdictEntry.safeParse({
    ...raw,
    at: huntNowIso(),
    ...(input.run_id ? { run_id: input.run_id } : {}),
  });
  if (!parsed.success) return huntFail(`The verdict is invalid: ${huntZodIssues(parsed.error)}.`);
  const plan = planVerdict(got.f, parsed.data, huntNowIso());
  if (!plan.ok) return huntFail(`Refused: ${plan.reason}`);
  appendLedger(env.huntDir, plan.lines);
  return huntReply(
    `${got.f.id}: ${parsed.data.stage} ${parsed.data.ruling} → **${plan.status}** (${plan.note}).`,
    {
      id: got.f.id,
      status: plan.status,
    },
  );
}

function huntSetStatus(env: ServerEnv, input: Input): ToolResult {
  const got = huntFindingOr(env, input.id);
  if ("error" in got) return got.error;
  const s = input.status as (typeof SETTABLE_STATUSES)[number] | undefined;
  if (!s || !SETTABLE_STATUSES.includes(s)) {
    return huntFail(
      `set-status takes one of ${SETTABLE_STATUSES.join(", ")}. confirmed, rejected and wont-fix come only from a verdict; regressed only from a sighting.`,
    );
  }
  if (!input.reason) return huntFail("set-status needs a reason.");
  if (s === "fixed" && !["confirmed", "ticketed", "regressed"].includes(got.f.status)) {
    return huntFail(
      `${got.f.id} is ${got.f.status}; only a confirmed, ticketed or regressed finding can be fixed.`,
    );
  }
  const line: LedgerLine = {
    v: 1,
    type: "status",
    at: huntNowIso(),
    id: got.f.id,
    status: s,
    reason: input.reason,
    ...(input.run_id ? { run_id: input.run_id } : {}),
  };
  appendLedger(env.huntDir, [line]);
  return huntReply(`${got.f.id}: ${got.f.status} → **${s}** (${input.reason}).`, {
    id: got.f.id,
    status: s,
  });
}

function huntLink(env: ServerEnv, input: Input): ToolResult {
  const got = huntFindingOr(env, input.id);
  if ("error" in got) return got.error;
  const parsed = FindingLinks.partial()
    .strict()
    .safeParse(input.links ?? {});
  if (!parsed.success) return huntFail(`The links are invalid: ${huntZodIssues(parsed.error)}.`);
  if (Object.keys(parsed.data).length === 0)
    return huntFail(
      "link needs at least one of task, root_cause, duplicate_of, related, commit, adr, spec.",
    );
  const state = foldLedger(readLedger(env.huntDir).lines);
  for (const ref of [
    parsed.data.root_cause,
    parsed.data.duplicate_of,
    ...(parsed.data.related ?? []),
  ]) {
    if (ref && !state.findings.has(ref)) return huntFail(`${ref} is not a finding in the ledger.`);
    if (ref === got.f.id) return huntFail(`${got.f.id} cannot link to itself.`);
  }
  appendLedger(env.huntDir, [
    { v: 1, type: "link", at: huntNowIso(), id: got.f.id, links: parsed.data },
  ]);
  return huntReply(`${got.f.id}: linked ${Object.keys(parsed.data).join(", ")}.`, {
    id: got.f.id,
    links: parsed.data,
  });
}

// ── reads ─────────────────────────────────────────────────────────────────

function huntChangedSinceFn(env: ServerEnv): (f: HuntFinding) => boolean {
  const head = headSha(env.projectDir);
  return (f) => {
    if (!f.head_sha || !head || f.head_sha === head) return false;
    const paths = f.location.files.map((x) => x.path);
    if (paths.length === 0) return false;
    const d = git(["diff", "--name-only", f.head_sha, head, "--", ...paths], env.projectDir);
    return !d.ok || d.value.trim().length > 0;
  };
}

function huntTriage(env: ServerEnv): ToolResult {
  const { lines, malformed } = readLedger(env.huntDir);
  const all = [...foldLedger(lines).findings.values()];
  const flowsMap = readFlows(env.huntDir);
  const g = triageGroups(all, flowsMap, huntChangedSinceFn(env));
  const { config } = readHuntConfig(env.configPath);
  const body = [
    `# Triage — ${g.open.length} open finding(s)`,
    "",
    "| Rank | ID | Check | Class | Severity | Status | Floor | Title |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...g.open.map(
      (f, i) =>
        `| ${i + 1} | ${f.id} | ${f.check} | ${f.class} | ${f.severity} | ${f.status} | ${atOrAbove(f.severity, config.severity_floor[f.check]) ? "at/above" : "below"} | ${f.title.replace(/\|/g, "\\|")} |`,
    ),
    "",
    `Possible duplicates (same category and file): ${g.possibleDuplicates.map((x) => x.join(" + ")).join("; ") || "none"}`,
    `Systemic candidates (same rule, several files): ${g.systemic.map((x) => x.join(" + ")).join("; ") || "none"}`,
    `Re-verify before reporting (code changed since last seen): ${g.stale.join(", ") || "none"}`,
    ...(malformed.length
      ? [
          `⚠ ${malformed.length} unreadable ledger line(s) skipped: ${malformed.map((m) => m.line).join(", ")}`,
        ]
      : []),
  ];
  return huntReply(body.join("\n"), {
    open: g.open.map((f) => f.id),
    possible_duplicates: g.possibleDuplicates,
    systemic: g.systemic,
    stale: g.stale,
  });
}

function huntFinalize(env: ServerEnv, input: Input): ToolResult {
  const r = huntRequireRun(env, input);
  if (r.state !== "running") return huntFail(`run ${r.id} is already ${r.state}.`);
  const all = [...foldLedger(readLedger(env.huntDir).lines).findings.values()];
  const inRun = new Set(r.recorded);
  const runFindings = all.filter((f) => inRun.has(f.id));
  // Coverage: every hotspot in a batch the run checkpointed as hunted (CODE-O02).
  const doneBatches = new Set(r.steps.filter((s) => s.batch !== undefined).map((s) => s.batch!));
  const audited = r.hotspots.filter((h) => doneBatches.has(h.batch)).map((h) => h.path);
  const coverage = readCoverage(env.huntDir);
  const byPath = new Map(coverage.files.map((e) => [e.path, e]));
  const now = huntNowIso();
  const blobs = git(["hash-object", "--stdin-paths"], env.projectDir, {
    input: audited.length ? `${audited.join("\n")}\n` : "",
  });
  const blobList = blobs.ok ? blobs.value.split("\n") : [];
  audited.forEach((path, i) => {
    const prev = byPath.get(path);
    const hits = runFindings.filter((f) => f.location.files.some((x) => x.path === path)).length;
    byPath.set(path, {
      path,
      last_audited_at: now,
      last_run: r.id,
      blob: blobList[i]?.trim() || null,
      audits: (prev?.audits ?? 0) + 1,
      findings: (prev?.findings ?? 0) + hits,
    });
  });
  if (audited.length > 0)
    writeCoverage(env.huntDir, { version: HUNT_STATE_VERSION, files: [...byPath.values()] });
  const flowsMap = readFlows(env.huntDir);
  const closed: HuntRun = {
    ...r,
    state: "finished",
    finished_at: now,
    steps: [...r.steps, { step: "finalize", at: now }],
    summary: input.note ?? summaryParagraph(runFindings, flowsMap),
  };
  writeRun(env.huntDir, closed);
  const md = renderReport({
    title: `Hunt report — ${r.check}`,
    generatedAt: now,
    findings: runFindings,
    flows: flowsMap,
    run: closed,
    coverage: {
      files: r.scope.files.length,
      audited: r.scope.files.filter((p) => byPath.has(p)).length,
    },
  });
  const written = writeReport(env.huntDir, r.id, md);
  return huntReply(
    [
      `Run \`${r.id}\` finished. ${summaryParagraph(runFindings, flowsMap)}`,
      `Coverage updated for ${audited.length} file(s). Report: ${written.map((w) => `\`.marvin/hunt/${w}\``).join(", ")}.`,
    ].join("\n"),
    { run: closed, report: written },
  );
}

function huntReport(env: ServerEnv): ToolResult {
  const all = [...foldLedger(readLedger(env.huntDir).lines).findings.values()];
  const flowsMap = readFlows(env.huntDir);
  const now = huntNowIso();
  const md = renderReport({
    title: "Hunt report — ledger",
    generatedAt: now,
    findings: all,
    flows: flowsMap,
  });
  const name = `${now.slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}-triage`;
  ensureHuntDir(env.huntDir);
  const written = writeReport(env.huntDir, name, md);
  return huntReply(
    `${summaryParagraph(all, flowsMap)}\nReport: ${written.map((w) => `\`.marvin/hunt/${w}\``).join(", ")}.`,
    {
      report: written,
    },
  );
}

function huntStatus(env: ServerEnv): ToolResult {
  const { lines, malformed } = readLedger(env.huntDir);
  const all = [...foldLedger(lines).findings.values()];
  const open = rankFindings(
    all.filter((f) => OPEN_STATUSES.includes(f.status) && f.confidence !== "low"),
    readFlows(env.huntDir),
  );
  const counts = new Map<string, number>();
  for (const f of open) counts.set(f.status, (counts.get(f.status) ?? 0) + 1);
  const runs = listRunIds(env.huntDir)
    .slice(0, 5)
    .map((id) => {
      try {
        const r = readRun(env.huntDir, id);
        return `- \`${r.id}\` ${r.check} · ${r.state} · ${r.scope.files.length} file(s) · ${r.recorded.length} claim(s)`;
      } catch (err) {
        return `- \`${id}\` unreadable: ${(err as Error).message}`;
      }
    });
  const coverage = readCoverage(env.huntDir);
  const main = open.filter((f) => reportSection(f) === "main");
  const closed = all.filter((f) => !OPEN_STATUSES.includes(f.status)).length;
  const lowOpen = all.length - open.length - closed;
  const body = [
    "# Hunt status",
    "",
    all.length === 0
      ? "_The ledger is empty. Start with `/marvin:hunt-init`, then `/marvin:hunt-code`._"
      : `${open.length} open finding(s): ${[...counts.entries()].map(([k, n]) => `${n} ${k}`).join(", ") || "none"}. ${closed} closed${lowOpen ? `, ${lowOpen} low-confidence logged only` : ""}.`,
    ...(main.length
      ? [
          "",
          "Top confirmed:",
          ...main.slice(0, 5).map((f) => `- **${f.id}** ${f.severity} ${f.class} · ${f.title}`),
        ]
      : []),
    "",
    "Recent runs:",
    ...(runs.length ? runs : ["- none"]),
    "",
    `Coverage: ${coverage.files.length} file(s) audited at least once.`,
    ...(malformed.length ? [`⚠ ${malformed.length} unreadable ledger line(s).`] : []),
  ];
  return huntReply(body.join("\n"), {
    open: open.length,
    by_status: Object.fromEntries(counts),
    closed,
    low_confidence: lowOpen,
    audited_files: coverage.files.length,
  });
}
