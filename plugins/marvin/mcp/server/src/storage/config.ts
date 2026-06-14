import { readFileSync, existsSync } from "node:fs";
import { Config, type Config as ConfigType } from "./schema.js";

/**
 * Load `.marvin/config.json` if it exists; otherwise return defaults
 * (base_branch="dev", tracker_url_template=null). Bad JSON falls back
 * to defaults — the user sees a warning via the dashboard.
 */
export function loadConfig(configPath: string): {
  config: ConfigType;
  warning: string | null;
} {
  if (!existsSync(configPath)) {
    return { config: Config.parse({}), warning: null };
  }
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      config: Config.parse({}),
      warning: `failed to read config: ${reason}`,
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { config: Config.parse({}), warning: `config.json is not valid JSON: ${reason}` };
  }
  const parsed = Config.safeParse(json);
  if (!parsed.success) {
    return {
      config: Config.parse({}),
      warning: `config.json failed schema validation: ${parsed.error.message}`,
    };
  }
  return { config: parsed.data, warning: null };
}

/** Apply a tracker URL template, returning null when no template is set. */
export function trackerUrl(config: ConfigType, trackerId: string | undefined): string | null {
  if (!trackerId || !config.tracker_url_template) return null;
  return config.tracker_url_template.replace("{tracker_id}", trackerId);
}
