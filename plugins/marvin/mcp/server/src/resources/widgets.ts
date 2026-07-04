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
    description: "Marvin kanban board — the task-list widget (ADR-0024).",
  },
];

/** The `ui://marvin/task-list.html` binding, exported for the tool `_meta`. */
export const TASK_LIST_WIDGET_URI = "ui://marvin/task-list.html";

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
