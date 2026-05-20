import {
  promptsDirFromMeta,
  runPackServer,
  type PackBundle,
} from "@marvin-toolkit/mcp-shared";
import { loadConfig } from "./storage/config.js";
import { loadEnv } from "./lib/env.js";
import { buildTaskTool } from "./tools/task.js";
import { buildGitTool } from "./tools/git.js";
import { buildHelpTool } from "./tools/help.js";
import { PROMPTS } from "./prompts/index.js";

const VERSION = "1.0.0-alpha.1";

await runPackServer({
  name: "marvin-tasks",
  version: VERSION,
  promptsDir: promptsDirFromMeta(import.meta.url),
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
