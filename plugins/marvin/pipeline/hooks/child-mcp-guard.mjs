#!/usr/bin/env node
/**
 * child-mcp-guard — the marvin tools a pipeline child must not drive.
 *
 * The board and its config (`task`, `tracker`) belong to the pipeline, ADR ratification
 * and the lessons store to a human, and the freshness waiver and the findings baseline
 * to the delivery gate; sealing a spec is the planner's step alone. Matched in the role
 * settings by `mcp__.*marvin.*__(task|tracker|spec|adr|lessons|verify|report)$`.
 */
import { isMain, readPayload } from "../../hooks/lib/hook-io.mjs";
import { denyPipeline, pipelineMain } from "./lib/deny.mjs";

const isSet = (value) => value !== undefined && value !== false;

/**
 * Why a child may not make this call, or null.
 *
 * @param {unknown} toolName The full MCP tool name, e.g. `mcp__plugin_marvin_marvin__spec`.
 * @param {unknown} input The tool input.
 * @param {string | undefined} role The child's role (`MARVIN_PIPELINE_ROLE`).
 * @returns {string | null}
 */
export function childMcpViolation(toolName, input, role) {
  if (typeof toolName !== "string" || !toolName.includes("__"))
    return "the tool name is unreadable";
  const tool = toolName.slice(toolName.lastIndexOf("__") + 2);
  const args = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {};
  const action = typeof args.action === "string" ? args.action : undefined;
  switch (tool) {
    case "task":
      return `marvin task${action ? ` action:${action}` : ""} changes the board or its config; the pipeline owns both`;
    case "tracker":
      return "marvin tracker changes the board; the pipeline owns it";
    case "spec":
      return (args.action === "seal" || args.mode === "seal") && role !== "planner"
        ? "only the planner may seal a spec"
        : null;
    case "adr":
      return action === "accept" || action === "supersede"
        ? `adr action:${action} is a human decision`
        : null;
    case "lessons":
      return action === "add" || action === "prune"
        ? `lessons action:${action} writes the lessons store; report the lesson in your result instead`
        : null;
    case "verify":
      return isSet(args.allowStale)
        ? "verify allowStale waives the freshness gate; re-run verify instead"
        : null;
    case "report":
      return isSet(args.snapshot) ? "report snapshot rewrites the findings baseline" : null;
    default:
      return null;
  }
}

if (isMain(import.meta.url)) {
  pipelineMain("child-mcp-guard", () => {
    const payload = readPayload();
    const why = childMcpViolation(
      payload?.tool_name,
      payload?.tool_input,
      process.env.MARVIN_PIPELINE_ROLE,
    );
    return why ? denyPipeline("child-mcp-guard", [`Pipeline child: ${why}.`]) : 0;
  });
}
