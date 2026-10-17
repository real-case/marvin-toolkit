#!/usr/bin/env node
/**
 * message-guard — a pipeline child reports to its orchestrator and to no one else.
 *
 * SendMessage finds a peer by name in the machine-wide session registry, and ListAgents lists
 * every local session. In the 2026-10-11 bench an executor whose orchestrator ("Bench") was no
 * session listed the peers and sent its report to an unrelated interactive session. The guard
 * denies ListAgents and any SendMessage not addressed to the orchestrator. A denied report is
 * recorded in events.jsonl here, since the PostToolUse message-log does not run for a denied
 * call; it also resets the heartbeat, so the child is not asked again at once.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readPayload } from "../../hooks/lib/hook-io.mjs";
import { denyPipeline, isPipelineEntry, pipelineMain } from "./lib/deny.mjs";
import { orchestratorOf } from "./lib/orchestrator.mjs";

/**
 * Why a child may not make this call, or null.
 *
 * @param {unknown} toolName `SendMessage` or `ListAgents`.
 * @param {unknown} input The tool input.
 * @param {string | undefined} orch The orchestrator's current name.
 * @returns {string | null}
 */
export function messageViolation(toolName, input, orch) {
  if (toolName === "ListAgents")
    return "you report to your orchestrator only; there is no one else to find";
  if (toolName !== "SendMessage") return null;
  const to = input !== null && typeof input === "object" ? input.to : undefined;
  if (!orch) return "this run names no orchestrator";
  return to === orch
    ? null
    : `reports go to the orchestrator "${orch}" only, not to "${String(to)}"`;
}

if (isPipelineEntry(import.meta.url)) {
  pipelineMain("message-guard", () => {
    const payload = readPayload();
    const { MARVIN_PIPELINE_RUN: run, MARVIN_PIPELINE_CHILD: child } = process.env;
    const orch = run ? orchestratorOf(run, process.env.MARVIN_PIPELINE_ORCH) : undefined;
    const why = messageViolation(payload?.tool_name, payload?.tool_input, orch);
    if (!why) return 0;
    if (run && child && payload?.tool_name === "SendMessage") {
      const { to = "", message = "" } = payload.tool_input ?? {};
      appendFileSync(
        join(run, "events.jsonl"),
        `${JSON.stringify({ ts: new Date().toISOString(), kind: "report", actor: child, text: String(message), data: { to: String(to), refused: true } })}\n`,
      );
      writeFileSync(join(run, `${child}.heartbeat`), String(Date.now()));
      return denyPipeline("message-guard", [
        `Pipeline child: ${why}.`,
        "Your report was recorded in the run's log; do not send it again.",
      ]);
    }
    return denyPipeline("message-guard", [`Pipeline child: ${why}.`]);
  });
}
