import {
  packRootFromMeta,
  promptsDirFromMeta,
  runPackServer,
  type PackBundle,
} from "@marvin-toolkit/mcp-shared";
import { PROMPTS } from "./prompts/index.js";
import { loadEnv } from "./lib/env.js";
import { logUsageEvent } from "./lib/usage.js";
import { buildAdrTool } from "./tools/adr.js";
import { buildTaskTool } from "./tools/task.js";
import { buildTaskDetailTool } from "./tools/task-detail.js";
import { buildTrackerTool } from "./tools/tracker.js";
import { buildHelpTool } from "./tools/help.js";
import { buildDashboardTool } from "./tools/dashboard.js";
import { buildVerifyTool } from "./tools/verify.js";
import { buildSpecTool } from "./tools/spec.js";
import { buildLessonsTool } from "./tools/lessons.js";
import { buildHandoffTool } from "./tools/handoff.js";
import { buildSummaryTool } from "./tools/summary.js";
import { buildAuditTool } from "./tools/audit.js";
import { buildWidgetResources } from "./resources/widgets.js";

const VERSION = "0.20.0";

// One env for the whole process: the tools read it, and the usage-log
// middleware (ADR-0030) closes over the same paths. `env` carries only
// resolved directory strings — the config-backed kill-switch is re-read per
// event inside `logUsageEvent`, so toggling `usage.enabled` applies immediately.
const env = loadEnv();

// The plugin root (holds skills/, .mcp.json, and the committed widgets/ HTML the
// resource layer serves — ADR-0008/0024). Computed once and shared with the
// widget-resource builder below.
const packRoot = packRootFromMeta(import.meta.url);

await runPackServer({
  name: "marvin",
  version: VERSION,
  promptsDir: promptsDirFromMeta(import.meta.url),
  packRoot,
  // Usage telemetry (ADR-0030): fire-and-forget, fail-open. The shared hook
  // reports only `{ kind, name }`; the logger owns the kill-switch, the
  // self-ignoring dir, rotation, and error-swallowing.
  onInvoke: (event) => logUsageEvent(env, event),
  build: (server): PackBundle => {
    // No startup config snapshot: every tool that needs .marvin/config.json
    // loads it per call, so `task config` edits (and hand edits) apply
    // immediately — see the loadConfig calls in the tool handlers.
    return {
      prompts: PROMPTS,
      tools: [
        buildTaskTool(server, env),
        buildTaskDetailTool(env),
        buildTrackerTool(env),
        buildHelpTool(env, VERSION),
        buildDashboardTool(env, VERSION),
        buildVerifyTool(env),
        buildSpecTool(env),
        buildLessonsTool(server, env),
        buildHandoffTool(env),
        buildSummaryTool(env),
        buildAdrTool(env),
        buildAuditTool(env),
      ],
      // MCP Apps `ui://` widget documents (ADR-0024). Registering these advertises
      // the `resources` capability; each is served from the committed HTML under
      // packRoot via the shared registerResource — no ext-apps SDK in this bundle.
      resources: buildWidgetResources(packRoot),
    };
  },
});
