import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { z } from "zod";
import { Config, Statuses, type Config as ConfigType, type StatusDef } from "./schema.js";
import { defaultBranchFromOrigin, hasGit, inGitRepo } from "../lib/git.js";

/** Where the effective `base_branch` value came from (shown by the config view). */
export type BaseBranchSource = "config" | "origin/HEAD" | "default";

export interface LoadedConfig {
  config: ConfigType;
  warning: string | null;
  base_branch_source: BaseBranchSource;
}

/**
 * Load `.marvin/config.json` if it exists; otherwise return defaults
 * (tracker_url_template=null, the default status set). Bad JSON falls back
 * to defaults — the user sees a warning via the dashboard.
 *
 * `base_branch` on a config-less project is auto-detected from `origin/HEAD`
 * when `projectDir` is given (WP2, audit finding 4) so a main-based repo works
 * on first run; the schema default ("dev") stays the last resort. A config
 * file, once present, always wins — detection never overrides it.
 * `base_branch_source` records which of the three supplied the value.
 */
export function loadConfig(configPath: string, projectDir?: string): LoadedConfig {
  if (!existsSync(configPath)) {
    const config = Config.parse({});
    if (projectDir !== undefined && hasGit() && inGitRepo(projectDir)) {
      const detected = defaultBranchFromOrigin(projectDir);
      if (detected) {
        config.base_branch = detected;
        return { config, warning: null, base_branch_source: "origin/HEAD" };
      }
    }
    return { config, warning: null, base_branch_source: "default" };
  }
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      config: Config.parse({}),
      warning: `failed to read config: ${reason}`,
      base_branch_source: "default",
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      config: Config.parse({}),
      warning: `config.json is not valid JSON: ${reason}`,
      base_branch_source: "default",
    };
  }
  const parsed = Config.safeParse(json);
  if (!parsed.success) {
    return {
      config: Config.parse({}),
      warning: `config.json failed schema validation: ${parsed.error.message}`,
      base_branch_source: "default",
    };
  }
  const hasOwnBase =
    typeof json === "object" && json !== null && Object.hasOwn(json, "base_branch");
  return {
    config: parsed.data,
    warning: null,
    base_branch_source: hasOwnBase ? "config" : "default",
  };
}

/** Apply a tracker URL template, returning null when no template is set. */
export function trackerUrl(config: ConfigType, trackerId: string | undefined): string | null {
  if (!trackerId || !config.tracker_url_template) return null;
  return config.tracker_url_template.replace("{tracker_id}", trackerId);
}

// ── config surface (WP4) ─────────────────────────────────────────────────

/**
 * The settings the `config` action manages. `null` removes the key from the
 * file (back to default / auto-detection); `undefined` leaves it untouched.
 */
export interface ConfigPatch {
  base_branch?: string | null;
  tracker_url_template?: string | null;
  branch_template?: string | null;
  statuses?: StatusDef[] | null;
}

export type ConfigWriteResult =
  | { ok: true; config: ConfigType; created: boolean }
  | { ok: false; error: string };

/**
 * Read-modify-write `.marvin/config.json`. The file also carries keys owned
 * by other tools (`gates` for the verify tool, and whatever a future tool
 * adds), so the patch is merged over the raw JSON object — every key the
 * config surface does not manage survives untouched. Fail-closed: an
 * unreadable or unparseable existing file, or a merged result that fails the
 * Config schema, returns an error and writes nothing. Creates the file (and
 * its directory) when absent; the write is atomic (temp + rename, the WP3
 * pattern), so readers never see a torn file.
 */
export function updateConfigFile(configPath: string, patch: ConfigPatch): ConfigWriteResult {
  const created = !existsSync(configPath);
  let raw: Record<string, unknown> = {};
  if (!created) {
    let text: string;
    try {
      text = readFileSync(configPath, "utf8");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `cannot read ${configPath}: ${reason}` };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `the existing config.json is not valid JSON (${reason}) — fix the file by hand first; nothing was written`,
      };
    }
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      return {
        ok: false,
        error:
          "the existing config.json is not a JSON object — fix the file by hand first; nothing was written",
      };
    }
    raw = { ...(json as Record<string, unknown>) };
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete raw[key];
    else raw[key] = value;
  }

  const merged = Config.safeParse(raw);
  if (!merged.success) {
    return { ok: false, error: `the merged config fails validation: ${zodIssues(merged.error)}` };
  }

  mkdirSync(dirname(configPath), { recursive: true });
  const tmp = `${configPath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(raw, null, 2) + "\n");
  renameSync(tmp, configPath);
  return { ok: true, config: merged.data, created };
}

export type StatusesParse = { ok: true; statuses: StatusDef[] } | { ok: false; error: string };

/**
 * Parse the `statuses` tool argument — a JSON string — fail-closed against
 * the Statuses schema (shape, key format, duplicates, the todo/wip/done role
 * invariants). The error message lists the exact issues so the caller can fix
 * the payload and retry.
 */
export function parseStatusesJson(input: string): StatusesParse {
  let json: unknown;
  try {
    json = JSON.parse(input);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `not valid JSON: ${reason}` };
  }
  const parsed = Statuses.safeParse(json);
  if (!parsed.success) return { ok: false, error: zodIssues(parsed.error) };
  return { ok: true, statuses: parsed.data };
}

/** Render zod issues as `path: message` lines joined with "; " — the exact-issues contract. */
function zodIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length > 0 ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}
