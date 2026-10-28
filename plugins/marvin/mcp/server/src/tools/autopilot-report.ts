import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { relative, sep, isAbsolute } from "node:path";
import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type {
  AutopilotEvent,
  AutopilotReport,
  AutopilotReportPayload,
  AutopilotSummary,
} from "@marvin-toolkit/mcp-shared/contracts";
import {
  autopilotContext,
  autopilotCriterionMet,
  autopilotLabels,
  autopilotModel,
  autopilotRoleName,
  autopilotTime,
  autopilotTokenTotal,
  autopilotUsd,
  type AutopilotLabels,
} from "@marvin-toolkit/mcp-shared/autopilot-labels";
import { keyList, strictInput } from "../lib/strict-input.js";
import { lastReportNumber, readReport, reportPath } from "../pipeline/status-report.js";
import { AUTOPILOT_STATUS_WIDGET_URI } from "../resources/widgets.js";
import { checkedRunDir } from "./pipeline.js";

/**
 * The `autopilot-report` tool — the sixteenth tool (ADR-0051). It renders one autopilot status
 * report as a card: the `ui://marvin/autopilot-status.html` widget on a host that draws MCP Apps,
 * and the same card in Markdown everywhere else. The engine writes the report
 * (`marvin-pipe await --report-min <m>`), so every number on the card is the engine's; this tool
 * only reads it back.
 *
 * The orchestrator speaks the user's language and the engine does not. Labels come from
 * `autopilotLabels(report.lang)`, and the orchestrator passes its translation of the English
 * event texts and callout in `translations`, one text per event in order. A list of the wrong
 * length is refused rather than paired up by position, because a shifted list would put every
 * text beside the wrong time.
 *
 * The card can unfold the whole run, so the payload also carries the events of every earlier
 * report. Their translations were given to earlier calls, so a call that passes `translations`
 * keeps them beside the report as `<n>.text.json`, and a later call shows each earlier event in
 * the words it was first shown in (English when its report was never translated). That file is
 * the one thing this tool writes.
 *
 * Confined to the directories `pipeline status` reads: the run directory must hold a `run.json`
 * inside the state root, and the report file must resolve inside the run directory. The input is
 * `.strict()`.
 */

const Translations = z
  .object({
    events: z
      .array(z.string().max(500))
      .optional()
      .describe(
        "The report's event texts in the user's language, one per event, in the report's order.",
      ),
    callout: z
      .string()
      .max(1000)
      .optional()
      .describe("The callout in the user's language: the question asked, or why the run stopped."),
  })
  .strict();

const AutopilotReportInput = z.object({
  runDir: z
    .string()
    .describe(
      "The run directory, as marvin-pipe init printed it. Absolute, inside the state root.",
    ),
  n: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("The report number await printed in its REPORT line. Defaults to the newest."),
  translations: Translations.optional(),
});
type AutopilotReportInput = z.infer<typeof AutopilotReportInput>;

const FIELDS = Object.keys(AutopilotReportInput.shape).join(", ");
const AutopilotReportInputStrict = strictInput(
  AutopilotReportInput,
  (keys) =>
    `unknown argument ${keyList(keys)} for the autopilot-report tool — it accepts only: ${FIELDS}.`,
);

export function buildAutopilotReportTool(env: NodeJS.ProcessEnv = process.env): AnyToolDef {
  return defineTool({
    name: "autopilot-report",
    description:
      "Show one autopilot status report as a card: session name, stage rail, elapsed time, cost, iteration, rejections, the events since the previous report (the whole run's history unfolds in the widget), and the working session's model, effort and context use. A final report shows the run summed up instead: stage times, tokens by kind and role, the PR, the acceptance criteria with their proof, questions, the retro's additions and assumptions. The report is written by `marvin-pipe await --report-min`, which prints `REPORT <n> <path>`; pass the run directory and n, plus your translation of the event texts and callout into the user's language.",
    inputSchema: AutopilotReportInputStrict,
    meta: { ui: { resourceUri: AUTOPILOT_STATUS_WIDGET_URI } },
    handler: (input) => Promise.resolve(runAutopilotReport(input, env)),
  });
}

function runAutopilotReport(input: AutopilotReportInput, env: NodeJS.ProcessEnv): ToolResult {
  const checked = checkedRunDir(input.runDir, env, refuse);
  if (!("runDir" in checked)) return checked;
  const { runDir } = checked;
  const n = input.n ?? lastReportNumber(runDir);
  if (n === 0) return refuse(`No status report has been written in \`${runDir}\` yet.`);
  const file = reportPath(runDir, n);
  if (!existsSync(file)) return refuse(`There is no report ${n} in \`${runDir}\`.`);
  if (!inside(realpathSync(runDir), realpathSync(file))) {
    return refuse(`Report ${n} resolves outside \`${runDir}\`, so it was not read.`);
  }
  const report = readReport(runDir, n);
  if (report === null) return refuse(`\`${file}\` is not a valid status report.`);

  const t = input.translations;
  if (t?.events !== undefined && t.events.length !== report.events.length) {
    return refuse(
      `translations.events has ${t.events.length} texts; report ${n} has ` +
        `${report.events.length} events. Pass one text per event, in order.`,
    );
  }
  if (t?.callout !== undefined && report.callout === null) {
    return refuse(`translations.callout was given, but report ${n} has no callout.`);
  }
  const shown: AutopilotReport = {
    ...report,
    events: report.events.map((e, i) => ({ ...e, text: oneLine(t?.events?.[i] ?? e.text) })),
    callout:
      report.callout === null
        ? null
        : { ...report.callout, text: oneLine(t?.callout ?? report.callout.text) },
  };
  if (t !== undefined) keepTexts(runDir, shown);
  const history = earlierEvents(runDir, n);
  const payload: AutopilotReportPayload = { report: shown, runDir, ...history };
  return {
    content: [{ type: "text", text: renderReport(shown) }],
    structuredContent: payload as unknown as Record<string, unknown>,
  };
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Where the texts a report was shown with are kept: `<runDir>/status-reports/<n>.text.json`. */
const textsPath = (runDir: string, n: number) =>
  reportPath(runDir, n).replace(/\.json$/, ".text.json");

interface ShownTexts {
  events: string[];
}

/**
 * Keeps the texts a report was shown with, so a later card can show its events in the same words.
 * Best effort: a failed write only means a later card shows those events in English.
 */
function keepTexts(runDir: string, shown: AutopilotReport): void {
  const path = textsPath(runDir, shown.n);
  const kept: ShownTexts = { events: shown.events.map((e) => e.text) };
  try {
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(kept, null, 2)}\n`);
    renameSync(tmp, path);
  } catch {
    // The card still shows; only the history loses this report's translation.
  }
}

function keptTexts(runDir: string, n: number, length: number): string[] | null {
  try {
    const kept = JSON.parse(readFileSync(textsPath(runDir, n), "utf8")) as Partial<ShownTexts>;
    const events = kept.events;
    return Array.isArray(events) &&
      events.length === length &&
      events.every((e) => typeof e === "string")
      ? events
      : null;
  } catch {
    return null;
  }
}

/** The events of reports 1 to n − 1, oldest first, each in the words it was shown in. */
function earlierEvents(
  runDir: string,
  n: number,
): { earlier: AutopilotEvent[]; earlierOmitted: number } {
  const earlier: AutopilotEvent[] = [];
  let earlierOmitted = 0;
  for (let k = 1; k < n; k += 1) {
    const report = readReport(runDir, k);
    if (report === null) continue;
    const texts = keptTexts(runDir, k, report.events.length);
    earlier.push(...report.events.map((e, i) => ({ ...e, text: oneLine(texts?.[i] ?? e.text) })));
    earlierOmitted += report.omittedEvents;
  }
  return { earlier, earlierOmitted };
}

/** The footer's line: the working session's model, effort and context use. Empty with no session. */
export function sessionLine(r: AutopilotReport): string {
  const s = r.session;
  if (s === null) return "";
  const l = autopilotLabels(r.lang);
  const parts = [l.modelEffort(autopilotModel(s.model), s.effort)];
  if (s.contextTokens !== null) {
    parts.push(`${l.context} ${autopilotContext(s.contextTokens, s.contextWindow).text}`);
  }
  return parts.join(" · ");
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

const MARK = { done: "✓", current: "●", waiting: "◐", failed: "✕", pending: "○" } as const;

/** The events block, shared by the periodic and the final card. */
function eventLines(r: AutopilotReport, l: AutopilotLabels): string[] {
  return r.events.length === 0
    ? [
        `_${l.noEvents}_`,
        ...(r.active.length === 0
          ? []
          : [
              `${l.working}: ${r.active
                .map((a) => `${a.role} (\`${a.name}\`), ${l.duration(a.runningMs)}`)
                .join("; ")}`,
            ]),
      ]
    : [
        ...(r.omittedEvents > 0 ? [`- … +${r.omittedEvents}`] : []),
        ...r.events.map((e) => `- \`${autopilotTime(e.at)}\` ${e.text}`),
      ];
}

const rejectionSub = (r: AutopilotReport, l: AutopilotLabels) =>
  r.rejections.last === null
    ? l.noRejections
    : l.lastRejection(l.sources[r.rejections.last.source], r.rejections.last.blocking);

/**
 * The final card in Markdown (ADR-0051): the same sections in the same order as the widget's
 * final layout, each left out when its source was absent, and no session footer.
 */
function renderFinal(r: AutopilotReport, s: AutopilotSummary): string {
  const l = autopilotLabels(r.lang);
  const f = l.final;
  const head = [
    `## ${f.title} · ${l.state[r.state]}`,
    ...(r.sessionName === null ? [] : [`**${r.sessionName}**`]),
    `\`${r.runId}\` · ${autopilotTime(r.startedAt)} → ${autopilotTime(r.at)}`,
  ];
  const rail = r.rail
    .map((step, i) => {
      const ms = s.stages[i]?.ms ?? null;
      const label = `${MARK[step.state]} ${l.rail[step.key]}${ms === null ? "" : ` (${l.duration(ms)})`}`;
      return step.state === "failed" ? `**${label}**` : label;
    })
    .join(" → ");
  const cost = r.costUsd === null ? "—" : `${autopilotUsd(r.costUsd)}${r.costComplete ? "" : "+"}`;
  const costSub = [
    ...(s.roles === null ? [] : [f.roles(s.roles)]),
    ...(r.costComplete ? [] : [l.costPartial]),
  ].join(", ");
  const table = [
    `| ${l.elapsed} | ${l.cost} | ${f.iterations} | ${l.rejections} |`,
    "|---|---|---|---|",
    `| ${l.duration(r.elapsedMs)}${s.activeMs === null ? "" : ` · ${f.active(l.duration(s.activeMs))}`} | ${cost}${costSub === "" ? "" : ` · ${costSub}`} | ${r.iteration} · ${l.rung(r.rung)} | ${r.rejections.total} · ${rejectionSub(r, l)} |`,
  ];
  const callout =
    r.callout === null ? [] : ["", `> **${l.calloutTitle[r.callout.kind]}:** ${r.callout.text}`];
  const t = s.tokens;
  const tokens =
    t === null || t.total === null
      ? []
      : [
          "",
          `**${f.tokensTitle(autopilotTokenTotal(t.total))}**`,
          (["cacheRead", "cacheWrite", "input", "output"] as const)
            .filter((k) => t[k] !== null)
            .map((k) => `${f.tokenKinds[k]} ${autopilotTokenTotal(t[k]!)}`)
            .join(" · "),
          ...(t.byRole.length === 0
            ? []
            : [
                "",
                `| ${f.columns.role} | ${f.columns.model} | ${f.columns.tokens} | ${f.columns.peak} |`,
                "|---|---|---:|---:|",
                ...t.byRole.map((row) => {
                  const peak =
                    row.peakContext === null
                      ? "—"
                      : autopilotContext(row.peakContext, row.contextWindow).text;
                  return `| ${autopilotRoleName(f, row.role, row.sessions)} | ${autopilotModel(row.model)} | ${row.total === null ? "—" : autopilotTokenTotal(row.total)} | ${peak} |`;
                }),
              ]),
        ];
  const pr = s.pr;
  const prBlock =
    pr === null || r.state !== "ready"
      ? []
      : [
          "",
          `> **${f.prReady(pr.number)}**${r.prUrl === null ? "" : ` · [${f.openPr}](${r.prUrl})`}`,
          `> ${[
            ...(pr.files === null ? [] : [f.prFiles(pr.files)]),
            ...(pr.additions === null || pr.deletions === null
              ? []
              : [`+${pr.additions} −${pr.deletions}`]),
            ...(pr.checksTotal === null || pr.checksPassed === null
              ? []
              : [f.ci(pr.checksPassed, pr.checksTotal)]),
            f.intoBase(pr.base),
          ].join(" · ")}`,
        ];
  const criteria =
    s.criteria === null || s.criteria.length === 0
      ? []
      : [
          "",
          `**${f.criteriaTitle(criteriaMet(r, s.criteria), s.criteria.length)}**`,
          ...s.criteria.map(
            (c) =>
              `- ${autopilotCriterionMet(r.state, c) ? "✓" : "○"} \`${c.id}\` ${c.text}${c.proof === null ? "" : ` · \`${f.proof[c.proof]}\``}`,
          ),
        ];
  const boxes = [
    ...(s.questions === null
      ? []
      : [
          `**${f.questionsTitle}:** ${f.questions(s.questions.byOrchestrator, s.questions.byUser)}`,
        ]),
    ...(s.retro === null
      ? []
      : [`**${f.retroTitle}:** ${f.retro(s.retro.checks, s.retro.lessons)}`]),
  ];
  const assumptions = s.assumptions.flatMap((a) => ["", `> **${f.assumptionTitle}:** ${a}`]);
  return [
    ...head,
    "",
    rail,
    "",
    ...table,
    ...callout,
    ...tokens,
    ...prBlock,
    ...criteria,
    ...(boxes.length === 0 ? [] : ["", ...boxes]),
    ...assumptions,
    "",
    `**${l.eventsTitle}**`,
    ...eventLines(r, l),
  ].join("\n");
}

const criteriaMet = (r: AutopilotReport, cs: NonNullable<AutopilotSummary["criteria"]>) =>
  cs.filter((c) => autopilotCriterionMet(r.state, c)).length;

/** The card in Markdown: the same blocks in the same order as the widget. */
export function renderReport(r: AutopilotReport): string {
  if (r.final && r.summary) return renderFinal(r, r.summary);
  const l = autopilotLabels(r.lang);
  const head = `## #${r.n} · ${l.state[r.state]} · ${r.runId}`;
  const rail = r.rail
    .map((s) => {
      const label = `${MARK[s.state]} ${l.rail[s.key]}`;
      return s.state === "current" || s.state === "waiting" || s.state === "failed"
        ? `**${label}**`
        : label;
    })
    .join(" → ");
  const cost =
    r.costUsd === null
      ? "—"
      : `${autopilotUsd(r.costUsd)}${r.costComplete ? "" : ` (${l.costPartial})`}`;
  const costSub = r.costDeltaUsd === null ? "" : ` · ${l.costDelta(autopilotUsd(r.costDeltaUsd))}`;
  const rejSub = rejectionSub(r, l);
  const table = [
    `| ${l.elapsed} | ${l.cost} | ${l.iteration} | ${l.rejections} |`,
    "|---|---|---|---|",
    `| ${l.duration(r.elapsedMs)} · ${l.since(autopilotTime(r.startedAt))} | ${cost}${costSub} | ${r.iteration} · ${l.rung(r.rung)} | ${r.rejections.total} · ${rejSub} |`,
  ];
  const callout =
    r.callout === null ? [] : ["", `> **${l.calloutTitle[r.callout.kind]}:** ${r.callout.text}`];
  const events = eventLines(r, l);
  const foot = sessionLine(r);
  return [
    head,
    ...(r.sessionName === null ? [] : [`**${r.sessionName}**`]),
    "",
    rail,
    "",
    ...table,
    ...callout,
    "",
    `**${l.eventsTitle}**`,
    ...events,
    ...(foot === "" ? [] : ["", foot]),
  ].join("\n");
}

function refuse(text: string): ToolResult {
  return {
    content: [{ type: "text", text: `# Autopilot report — refused\n\n${text}` }],
    isError: true,
  };
}
