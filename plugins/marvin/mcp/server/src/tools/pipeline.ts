import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import { loadRun, stateRoot, type Child, type Run } from "../pipeline/run-store.js";

/**
 * The `pipeline` tool — the fifteenth tool, and the autopilot pipeline's only door into the MCP
 * server. Everything that drives a run lives in the `marvin-pipe` CLI, because the engine is a
 * detached process that outlives any session; this tool only tells a session where that CLI and
 * its assets are, and what a run looks like. Two actions, both read-only:
 *
 * - `paths` answers where the pipeline's shipped assets are: the CLI bundle, the role prompts,
 *   the result schemas, the child guard hooks, the default rubric and checks, and the state root
 *   runs live under. A skill cannot work these out itself. The plugin may be a marketplace cache
 *   copy, a symlinked local install or a `--plugin-dir` checkout, and the session's cwd is the
 *   user's project, which holds none of them. The server knows where it was loaded from, so every
 *   shipped path is resolved from its `packRoot` and none from the cwd. A shipped path that is
 *   absent is reported in `missing` rather than failing the call: the CLI is a second bundle
 *   entry, and a checkout that has not been built yet should still say where it will be.
 * - `status` reads one run back through run-store's `loadRun`: stage, tier, iteration, PR, the
 *   pending judgment and the children behind it. The run directory is named by the caller, so it
 *   must resolve inside the state root with every symlink resolved, down to `run.json` itself.
 *   Otherwise the tool would read any JSON file the caller pointed it at. It never writes: the
 *   engine is the only writer of `run.json`.
 *
 * Both actions refuse a state root that is not an absolute path. run-store keeps an empty or
 * relative MARVIN_PIPELINE_HOME as written, and such a root would resolve against the server's
 * cwd, which is the session's project rather than anywhere runs live.
 *
 * The input is `.strict()`, like `spec`, `report` and `metrics`: a misspelt `runDir` must be an
 * error, not a call that silently reads nothing. The tool binds no widget; the text is the answer
 * and `structuredContent` carries the same data for a caller that parses it.
 */

const PipelineInput = z.object({
  action: z
    .enum(["paths", "status"])
    .describe(
      "paths: where the pipeline's assets are — the marvin-pipe CLI bundle (run it with node), the role prompts, the result schemas, the child guard hooks, the default rubric and checks — and the state root runs live under, each resolved from where the plugin is installed. status: one run read back from its run.json — stage, tier, iteration, PR, pending judgment and children.",
    ),
  runDir: z
    .string()
    .optional()
    .describe(
      "status only: the run directory, as marvin-pipe init printed it. Must be an absolute path inside the state root.",
    ),
});
type PipelineInput = z.infer<typeof PipelineInput>;

const PIPELINE_INPUT_FIELDS = Object.keys(PipelineInput.shape).join(", ");
const PipelineInputStrict = PipelineInput.strict(
  `unknown argument for the pipeline tool — it accepts only: ${PIPELINE_INPUT_FIELDS}.`,
);

/** The shipped assets, in the order `paths` lists them. The state root is not shipped. */
const SHIPPED = ["cli", "roles", "schemas", "hooks", "rubricDefault", "checksDefault"] as const;
type Shipped = (typeof SHIPPED)[number];

export type PipelinePaths = Record<Shipped | "stateRoot", string>;

/**
 * Every path the pipeline ships, resolved from the plugin root. The CLI is the second tsup entry
 * beside `dist/server.js`; the rest live under `pipeline/` at the plugin root. `env` only names
 * the state root, which is per user, not per install.
 */
export function pipelinePaths(packRoot: string, env: NodeJS.ProcessEnv): PipelinePaths {
  const root = resolve(packRoot);
  const assets = join(root, "pipeline");
  return {
    cli: join(root, "mcp", "server", "dist", "marvin-pipe.js"),
    roles: join(assets, "roles"),
    schemas: join(assets, "schemas"),
    hooks: join(assets, "hooks"),
    rubricDefault: join(assets, "rubric.default.yaml"),
    checksDefault: join(assets, "checks.default.yaml"),
    stateRoot: stateRoot(env),
  };
}

export function buildPipelineTool(
  packRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): AnyToolDef {
  return defineTool({
    name: "pipeline",
    description:
      'The autopilot pipeline\'s read-only door; runs are driven by the marvin-pipe CLI, never by this tool. action: "paths" returns where the pipeline\'s assets are — cli (the marvin-pipe bundle, run with node), roles, schemas, hooks, rubricDefault, checksDefault — each resolved from where the plugin is installed and never from the cwd, plus the stateRoot runs live under (MARVIN_PIPELINE_HOME, else ~/.local/state/marvin-pipeline) and the list of shipped paths that are missing. action: "status" reads one run back from <runDir>/run.json — id, stage, halt reason, tier, iteration, PR, pending judgment and a children summary — and refuses a runDir that does not resolve inside the state root. Strict input: an unknown key is an error.',
    inputSchema: PipelineInputStrict,
    handler: (input) => Promise.resolve(runPipeline(input, packRoot, env)),
  });
}

function runPipeline(input: PipelineInput, packRoot: string, env: NodeJS.ProcessEnv): ToolResult {
  if (input.action === "paths") {
    if (input.runDir !== undefined) {
      return errText(
        '`runDir` is read by `action: "status"` only — `paths` does not depend on a run. ' +
          "Call status for the run, or drop runDir.",
      );
    }
    return paths(packRoot, env);
  }
  if (input.runDir === undefined || input.runDir.trim() === "") {
    return errText('`action: "status"` needs a `runDir` — the directory marvin-pipe init printed.');
  }
  return status(input.runDir, env);
}

/**
 * The refusal for a state root that is not absolute, or null when it is. Checked by both actions:
 * `paths` must not hand a skill a root that means a different directory in every cwd, and
 * `status` must not read runs from under the session's project.
 */
function relativeStateRoot(env: NodeJS.ProcessEnv): ToolResult | null {
  const root = stateRoot(env);
  if (isAbsolute(root)) return null;
  return errText(
    `MARVIN_PIPELINE_HOME is set to ${JSON.stringify(root)}, which is not an absolute path. ` +
      "The state root is never resolved against the server's cwd, which is the session's " +
      "project and not where runs live. Set it to an absolute path, or unset it for " +
      "~/.local/state/marvin-pipeline.",
  );
}

function paths(packRoot: string, env: NodeJS.ProcessEnv): ToolResult {
  const refused = relativeStateRoot(env);
  if (refused) return refused;
  const p = pipelinePaths(packRoot, env);
  const missing = SHIPPED.filter((key) => !existsSync(p[key]));
  const line = (key: Shipped | "stateRoot", note: string) =>
    `- **${key}:** \`${p[key]}\`${note}${missing.includes(key as Shipped) ? " — **missing**" : ""}`;
  const lines = [
    line("cli", " — run it with `node`"),
    line("roles", ""),
    line("schemas", ""),
    line("hooks", ""),
    line("rubricDefault", ""),
    line("checksDefault", ""),
    line(
      "stateRoot",
      existsSync(p.stateRoot) ? "" : " — not created yet; the first `init` creates it",
    ),
  ];
  const warning =
    missing.length === 0
      ? ""
      : `\n\n_⚠ missing: ${missing.join(", ")}.` +
        (missing.includes("cli")
          ? " The CLI is built with the server (`npm run build` in mcp/server); until then no run can start."
          : "") +
        (missing.some((key) => key !== "cli")
          ? " A shipped pipeline asset is absent, so this plugin install is incomplete."
          : "") +
        "_";
  return {
    content: [{ type: "text", text: `# Pipeline paths\n\n${lines.join("\n")}${warning}` }],
    structuredContent: { ...p, missing },
  };
}

/** A path relative to `root` that does not climb out of it and is not the root itself. */
function strictlyInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  // A climb is the segment `..` itself; `..dotted` is an ordinary name inside the root.
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function status(runDirArg: string, env: NodeJS.ProcessEnv): ToolResult {
  if (!isAbsolute(runDirArg)) {
    return errText(
      `\`runDir\` \`${runDirArg}\` is not an absolute path. It is never resolved against the ` +
        "server's cwd, which is not the run's; pass the path marvin-pipe init printed.",
    );
  }
  const refused = relativeStateRoot(env);
  if (refused) return refused;
  const root = resolve(stateRoot(env));
  const runDir = resolve(runDirArg);
  if (!existsSync(root)) {
    if (!strictlyInside(root, runDir)) return outsideRoot(runDirArg, root);
    return errText(
      `The state root \`${root}\` does not exist, so no run has been started under it.`,
    );
  }
  // The root and the run directory may name one place in two spellings. A root behind a symlink
  // with the run dir printed resolved is caught here, by comparing against both spellings of the
  // root, and a missing run dir written that way is reported as missing. The reverse, a resolved
  // root with the run dir written through an alias (macOS's tmpdir() is /var/folders, which is
  // /private/var/folders), is caught below, once the run dir's own links are resolved.
  const realRoot = realpathSync(root);
  if (strictlyInside(root, runDir) || strictlyInside(realRoot, runDir)) {
    if (!existsSync(runDir)) return errText(`There is no run directory at \`${runDir}\`.`);
  } else if (!existsSync(runDir)) {
    // Written outside the root and absent: the same answer as a present path outside it, so a
    // refusal never says whether something outside the root exists.
    return outsideRoot(runDirArg, root);
  }
  // Then with symlinks resolved, for the directory and for run.json itself. This is the check
  // that decides: an alias written outside the root is accepted only when it lands inside, and
  // a link inside the root that points out of it would otherwise read whatever file it names.
  if (!strictlyInside(realRoot, realpathSync(runDir))) return outsideRoot(runDirArg, root);
  const file = join(runDir, "run.json");
  if (!existsSync(file)) return errText(`There is no run.json in \`${runDir}\`.`);
  if (!strictlyInside(realRoot, realpathSync(file))) return outsideRoot(runDirArg, root);

  let run: Run;
  try {
    run = loadRun(runDir);
  } catch (error) {
    return errText(`\`${file}\` is not a valid run: ${describeError(error)}`);
  }
  const payload = statusPayload(runDir, run);
  return {
    content: [{ type: "text", text: renderStatus(payload) }],
    structuredContent: payload as unknown as Record<string, unknown>,
  };
}

interface ChildRow {
  name: string;
  role: Child["role"];
  iteration: number;
  status: Child["status"];
  model: string;
  effort: string;
  costUsd: number | null;
  startedAt: string;
  endedAt: string | null;
}

interface StatusPayload {
  runDir: string;
  id: string;
  stage: Run["stage"];
  haltReason: string | null;
  tier: Run["tier"];
  stageA: Run["stageA"];
  iteration: number;
  rung: number;
  prUrl: string | null;
  branch: string | null;
  worktree: string | null;
  specPath: string | null;
  pendingJudgment: Run["pendingJudgment"];
  rejections: number;
  children: {
    total: number;
    running: number;
    byStatus: Partial<Record<Child["status"], number>>;
    /** The sum over children whose cost is known; null when none is. */
    costUsd: number | null;
    rows: ChildRow[];
  };
  updatedAt: string;
}

function statusPayload(runDir: string, run: Run): StatusPayload {
  const byStatus: Partial<Record<Child["status"], number>> = {};
  for (const child of run.children) byStatus[child.status] = (byStatus[child.status] ?? 0) + 1;
  const costs = run.children.map((c) => c.costUsd).filter((c): c is number => c !== null);
  return {
    runDir,
    id: run.id,
    stage: run.stage,
    haltReason: run.haltReason,
    tier: run.tier,
    stageA: run.stageA,
    iteration: run.iteration,
    rung: run.rung,
    prUrl: run.prUrl,
    branch: run.branch,
    worktree: run.worktree,
    specPath: run.specPath,
    pendingJudgment: run.pendingJudgment,
    rejections: run.rejections.length,
    children: {
      total: run.children.length,
      running: byStatus.running ?? 0,
      byStatus,
      costUsd: costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0),
      rows: run.children.map((c) => ({
        name: c.name,
        role: c.role,
        iteration: c.iteration,
        status: c.status,
        model: c.assignment.model,
        effort: c.assignment.effort,
        costUsd: c.costUsd,
        startedAt: c.startedAt,
        endedAt: c.endedAt,
      })),
    },
    updatedAt: run.updatedAt,
  };
}

const usd = (n: number | null) => (n === null ? "—" : `$${n.toFixed(2)}`);
const code = (s: string | null) => (s === null ? "none" : `\`${s}\``);

function renderStatus(s: StatusPayload): string {
  const tier = s.tier === null ? `not assessed yet (stage A \`${s.stageA}\`)` : `\`${s.tier}\``;
  const judgment =
    s.pendingJudgment === null ? "none" : `\`${s.pendingJudgment.id}\` (${s.pendingJudgment.kind})`;
  const head = [
    `# Pipeline run — ${s.id}`,
    "",
    `**Stage:** \`${s.stage}\` · **Tier:** ${tier} · **Iteration:** ${s.iteration} · **Rung:** ${s.rung}`,
    ...(s.haltReason === null ? [] : [`**Halted:** ${s.haltReason}`]),
    `**PR:** ${s.prUrl ?? "none yet"}`,
    `**Pending judgment:** ${judgment}`,
    `**Branch:** ${code(s.branch)} · **Worktree:** ${code(s.worktree)}`,
    `**Spec:** ${code(s.specPath)}`,
    `**Rejections:** ${s.rejections} · **Updated:** ${s.updatedAt}`,
    `**Run dir:** \`${s.runDir}\``,
  ];
  const c = s.children;
  if (c.total === 0) return [...head, "", "_No children launched yet._"].join("\n");
  const counts = Object.entries(c.byStatus)
    .map(([status, n]) => `${status} ${n}`)
    .join(", ");
  const rows = c.rows.map(
    (r) =>
      `| ${r.name} | ${r.role} | ${r.iteration} | ${r.status} | ${r.model}/${r.effort} | ${usd(r.costUsd)} |`,
  );
  return [
    ...head,
    "",
    `## Children (${c.total}) — ${counts} · cost ${usd(c.costUsd)}`,
    "",
    "| Child | Role | Iteration | Status | Model/effort | Cost |",
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

function outsideRoot(runDir: string, root: string): ToolResult {
  return errText(
    `\`${runDir}\` is not a run directory inside the pipeline state root \`${root}\` ` +
      "(MARVIN_PIPELINE_HOME, else ~/.local/state/marvin-pipeline). status reads runs only " +
      "from there, so nothing was read.",
  );
}

/** One line per zod issue, or the error's own message: enough to see what in run.json is wrong. */
function describeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

function errText(text: string): ToolResult {
  return {
    content: [{ type: "text", text: `# Pipeline tool — refused\n\n${text}` }],
    isError: true,
  };
}
