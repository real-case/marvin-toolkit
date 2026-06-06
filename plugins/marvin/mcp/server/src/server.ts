import {
  packRootFromMeta,
  promptsDirFromMeta,
  runPackServer,
  type PackBundle,
} from "@marvin-toolkit/mcp-shared";
import { PROMPTS } from "./prompts/index.js";
import { loadConfig } from "./storage/config.js";
import { loadEnv } from "./lib/env.js";
import { buildTaskTool } from "./tools/task.js";
import { buildGitTool } from "./tools/git.js";
import { buildHelpTool } from "./tools/help.js";

const VERSION = "2.0.0-alpha.1";

await runPackServer({
  name: "marvin",
  version: VERSION,
  promptsDir: promptsDirFromMeta(import.meta.url),
  packRoot: packRootFromMeta(import.meta.url),
  build: (server): PackBundle => {
    const env = loadEnv();
    const { config } = loadConfig(env.configPath);
    return {
      prompts: PROMPTS,
      tools: [
        buildTaskTool(server, env, config),
        buildGitTool(server, env, config),
        buildHelpTool(env, config, VERSION),
      ],
    };
  },
});
