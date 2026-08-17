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
  /**
   * Reasons individual settings were dropped to their default at load time,
   * one per setting. Distinct from `warning`, which reports the *whole* file
   * falling back: here the rest of the configuration is intact and only the
   * named setting is inert, so a consumer that renders these must not claim
   * defaults are in force everywhere.
   */
  settingWarnings: string[];
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
        return { config, warning: null, settingWarnings: [], base_branch_source: "origin/HEAD" };
      }
    }
    return { config, warning: null, settingWarnings: [], base_branch_source: "default" };
  }
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      config: Config.parse({}),
      warning: `failed to read config: ${reason}`,
      settingWarnings: [],
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
      settingWarnings: [],
      base_branch_source: "default",
    };
  }
  const parsed = Config.safeParse(json);
  if (!parsed.success) {
    return {
      config: Config.parse({}),
      warning: `config.json failed schema validation: ${parsed.error.message}`,
      settingWarnings: [],
      base_branch_source: "default",
    };
  }
  const hasOwnBase =
    typeof json === "object" && json !== null && Object.hasOwn(json, "base_branch");
  return {
    config: parsed.data,
    warning: null,
    settingWarnings: neutraliseUnusableSettings(parsed.data),
    base_branch_source: hasOwnBase ? "config" : "default",
  };
}

/**
 * Drop settings whose value passes the schema but cannot do its job to their
 * default, in place, and return one reason per drop. The config surface
 * validates what it writes, but `.marvin/config.json` is a plain file the docs
 * invite people to edit by hand, so the loader is the only place that sees
 * every value that ever reaches a tool.
 *
 * Scoped to one setting deliberately. The whole-file fallback (`warning`) is
 * the wrong instrument here: it would reset `statuses`, `gates` and
 * `base_branch` too, so one mistyped URL template would take the board's
 * vocabulary with it.
 */
function neutraliseUnusableSettings(config: ConfigType): string[] {
  const warnings: string[] = [];
  if (config.tracker_url_template) {
    const issue = trackerTemplateIssue(config.tracker_url_template);
    if (issue) {
      warnings.push(
        `\`tracker_url_template\` ${JSON.stringify(config.tracker_url_template)} is ignored — ${issue}. Tasks show their tracker id without a link until it is fixed (\`/marvin:track-config\`).`,
      );
      config.tracker_url_template = null;
    }
  }
  return warnings;
}

/**
 * A `{…}` placeholder left in a string after substitution. Any match in a
 * derived URL means the template asked for something nothing fills in, so the
 * link would point at a page that cannot exist.
 */
const PLACEHOLDER = /\{[^}]*\}/;

/**
 * Why a `tracker_url_template` cannot produce per-task URLs, or `null` when it
 * can. `{tracker_id}` is the only placeholder substitution fills, so a template
 * is unusable when it omits that marker (nothing identifies the task) or when
 * it carries a second placeholder nobody replaces.
 */
export function trackerTemplateIssue(template: string): string | null {
  if (!template.includes("{tracker_id}")) {
    return "it has no `{tracker_id}` placeholder, so a task's id has nowhere to go";
  }
  const leftover = PLACEHOLDER.exec(template.replaceAll("{tracker_id}", "TRACKER-1"));
  if (leftover) {
    return `it leaves \`${leftover[0]}\` unsubstituted — \`{tracker_id}\` is the only placeholder that gets filled in`;
  }
  return null;
}

/**
 * Apply a tracker URL template, returning null when no usable template is set.
 *
 * The single point where a `tracker_url` is derived — the board cards, the
 * list table and the delivery summary all route through here — and therefore
 * the place that guarantees the invariant: a returned URL never carries an
 * unsubstituted `{…}` placeholder. `loadConfig` already drops an unusable
 * template, but the check is repeated here because the argument is a `Config`,
 * which a test or a future loader can build without passing through it. The
 * cost of missing this is a live link to a page that does not exist, rendered
 * as a real link by both the tracker tool and the tracker-list widget; `null`
 * is the state both already render as "no URL".
 */
export function trackerUrl(config: ConfigType, trackerId: string | undefined): string | null {
  const template = config.tracker_url_template;
  if (!trackerId || !template || trackerTemplateIssue(template)) return null;
  const url = template.replaceAll("{tracker_id}", trackerId);
  // Substitution can reintroduce a placeholder through the id itself: the
  // summary tool passes free-form spec frontmatter here, not a `TrackerId`.
  return PLACEHOLDER.test(url) ? null : url;
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
  { ok: true; config: ConfigType; created: boolean } | { ok: false; error: string };

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
