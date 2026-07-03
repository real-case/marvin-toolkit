import {
  packRootFromMeta,
  promptsDirFromMeta,
  runPackServer,
  type PackBundle,
} from "@marvin-toolkit/mcp-shared";
import { PROMPTS } from "./prompts/index.js";
import { loadEnv } from "./lib/env.js";
import { buildAdrTool } from "./tools/adr.js";
import { buildTaskTool } from "./tools/task.js";
import { buildHelpTool } from "./tools/help.js";
import { buildVerifyTool } from "./tools/verify.js";
import { buildSpecTool } from "./tools/spec.js";
import { buildLessonsTool } from "./tools/lessons.js";
import { buildHandoffTool } from "./tools/handoff.js";
import { buildSummaryTool } from "./tools/summary.js";

const VERSION = "0.11.0";

await runPackServer({
  name: "marvin",
  version: VERSION,
  promptsDir: promptsDirFromMeta(import.meta.url),
  packRoot: packRootFromMeta(import.meta.url),
  build: (server): PackBundle => {
    const env = loadEnv();
    // No startup config snapshot: every tool that needs .marvin/config.json
    // loads it per call, so `task config` edits (and hand edits) apply
    // immediately — see the loadConfig calls in the tool handlers.
    return {
      prompts: PROMPTS,
      tools: [
        buildTaskTool(server, env),
        buildHelpTool(env, VERSION),
        buildVerifyTool(env),
        buildSpecTool(env),
        buildLessonsTool(server, env),
        buildHandoffTool(env),
        buildSummaryTool(env),
        buildAdrTool(env),
      ],
    };
  },
});
