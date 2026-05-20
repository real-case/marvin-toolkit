import {
  packRootFromMeta,
  promptsDirFromMeta,
  runPackServer,
  type PackBundle,
} from "@marvin-toolkit/mcp-shared";
import { PROMPTS } from "./prompts/index.js";

const VERSION = "1.0.0-alpha.1";

await runPackServer({
  name: "marvin-core",
  version: VERSION,
  promptsDir: promptsDirFromMeta(import.meta.url),
  packRoot: packRootFromMeta(import.meta.url),
  build: (): PackBundle => ({
    prompts: PROMPTS,
  }),
});
