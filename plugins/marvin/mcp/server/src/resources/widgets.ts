import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResourceDef } from "@marvin-toolkit/mcp-shared";

/**
 * Server-side registration of the MCP Apps `ui://` widget documents (ADR-0024).
 *
 * The server stays ext-apps/React free: each widget is a committed, self-contained
 * HTML file (built by `packages/marvin-widgets`) served through the shared
 * `registerResource` primitive — NOT ext-apps' `registerAppResource`. The `read`
 * callback loads the file from the plugin root at request time (ADR-0008, the same
 * way SKILL.md bodies load), so the HTML is never baked into `dist/server.js`.
 */

/** ext-apps requires this exact mimeType; a plain `text/html` is not recognised. */
const WIDGET_MIME = "text/html;profile=mcp-app";

interface WidgetResource {
  /** Registration name / stable key. */
  name: string;
  /** The `ui://` URI a tool binds via `_meta.ui.resourceUri`. */
  uri: string;
  /** Committed HTML path relative to the plugin root (`packRoot`). */
  file: string;
  description: string;
}

const WIDGETS: WidgetResource[] = [
  {
    name: "task-list",
    uri: "ui://marvin/task-list.html",
    file: join("widgets", "task-list.html"),
    description: "Marvin task board — the task-list widget (ADR-0024).",
  },
  {
    name: "task-detail",
    uri: "ui://marvin/task-detail.html",
    file: join("widgets", "task-detail.html"),
    description: "Marvin task detail — a single task's fields + markdown body (ADR-0024).",
  },
  {
    name: "tracker-list",
    uri: "ui://marvin/tracker-list.html",
    file: join("widgets", "tracker-list.html"),
    description:
      "Marvin tracker list — board tasks with an external tracker_id, linking out (ADR-0024).",
  },
  {
    name: "handoffs",
    uri: "ui://marvin/handoffs.html",
    file: join("widgets", "handoffs.html"),
    description:
      "Marvin handoffs — a master-detail browser over the session-continuation docs, each with its continue prompt + markdown body (ADR-0024).",
  },
  {
    name: "audit",
    uri: "ui://marvin/audit.html",
    file: join("widgets", "audit.html"),
    description:
      "Marvin security audit — the sec-* findings viewer with severity triage (ADR-0024).",
  },
  {
    name: "task-summary",
    uri: "ui://marvin/task-summary.html",
    file: join("widgets", "task-summary.html"),
    description:
      "Marvin task summary — the 'what was done' delivery digest: acceptance vs verification, gates, commits, lessons and links, as a panel (ADR-0024).",
  },
  {
    name: "dashboard",
    uri: "ui://marvin/dashboard.html",
    file: join("widgets", "dashboard.html"),
    description:
      "Marvin toolbox dashboard — the whole-toolbox status panel: project paths, config, board counters, artifact inventories with freshness, the ADR corpus, and the security/refactor/lessons/usage sections (ADR-0024).",
  },
  {
    name: "help",
    uri: "ui://marvin/help.html",
    file: join("widgets", "help.html"),
    description:
      "Marvin help — the welcome dashboard: gradient wordmark, project summary, configured MCP servers, and the full command index grouped by family (ADR-0024).",
  },
];

/** The `ui://marvin/task-list.html` binding, exported for the tool `_meta`. */
export const TASK_LIST_WIDGET_URI = "ui://marvin/task-list.html";

/** The `ui://marvin/task-detail.html` binding, exported for the tool `_meta`. */
export const TASK_DETAIL_WIDGET_URI = "ui://marvin/task-detail.html";

/** The `ui://marvin/tracker-list.html` binding, exported for the tool `_meta`. */
export const TRACKER_LIST_WIDGET_URI = "ui://marvin/tracker-list.html";
/** The `ui://marvin/handoffs.html` binding, exported for the tool `_meta`. */
export const HANDOFFS_WIDGET_URI = "ui://marvin/handoffs.html";

/** The `ui://marvin/audit.html` binding, exported for the tool `_meta`. */
export const AUDIT_WIDGET_URI = "ui://marvin/audit.html";

/** The `ui://marvin/task-summary.html` binding, exported for the tool `_meta`. */
export const TASK_SUMMARY_WIDGET_URI = "ui://marvin/task-summary.html";

/** The `ui://marvin/dashboard.html` binding, exported for the tool `_meta`. */
export const DASHBOARD_WIDGET_URI = "ui://marvin/dashboard.html";

/** The `ui://marvin/help.html` binding, exported for the tool `_meta`. */
export const HELP_WIDGET_URI = "ui://marvin/help.html";

/**
 * Build the `ResourceDef[]` the server registers. `packRoot` is the plugin root
 * (`packRootFromMeta(import.meta.url)`) the committed widget HTML lives under.
 */
export function buildWidgetResources(packRoot: string): ResourceDef[] {
  return WIDGETS.map((w) => ({
    name: w.name,
    uri: w.uri,
    description: w.description,
    mimeType: WIDGET_MIME,
    read: () => readFileSync(join(packRoot, w.file), "utf8"),
  }));
}
