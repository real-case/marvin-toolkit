import { z } from "zod";
import { defineTool, type AnyToolDef, type ToolResult } from "@marvin-toolkit/mcp-shared";
import type { TaskCard, TrackerListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { readAllTasks } from "../storage/tasks.js";
import { loadConfig } from "../storage/config.js";
import { buildTaskCard } from "../flows/card.js";
import type { ServerEnv } from "../lib/env.js";
import { TRACKER_LIST_WIDGET_URI } from "../resources/widgets.js";

/**
 * The tracker-list read tool (ADR-0024 widget #6). It surfaces the board tasks
 * that carry an external `tracker_id` — each linking out to its tracker item —
 * as text (the terminal fallback) and as a `TrackerListPayload` `structuredContent`
 * payload the tracker-list `ui://` widget renders in an MCP Apps host.
 *
 * It is a *separate* tool from `task` on purpose: a widget is bound on the tool
 * descriptor via `_meta.ui.resourceUri` and resolved once by the host, so one tool
 * surfaces exactly one widget. `task` is already bound to task-list; a tracker view
 * therefore needs its own tool — the same forcing constraint that produced the
 * `task-detail` tool (ADR-0024 #2). It is also the FIRST consumer of the external
 * link-out (`app.openLink`) path in the 3-type link model. Read-only — no
 * elicitation, no writes; the tracker URL is derived (`trackerUrl()`), never stored.
 */
const TrackerInput = z.object({});

export function buildTrackerTool(env: ServerEnv): AnyToolDef {
  return defineTool({
    name: "tracker",
    description:
      'Show the board tasks that carry an external tracker id (e.g. OSI-123), each linking out to its tracker item. Returns the tracked tasks as text and, for MCP Apps hosts, binds the tracker-list widget (ADR-0024). Read-only. Serves requests like "which tasks are tracked in Jira?", "show my tracker links", or "open the tracker board".',
    inputSchema: TrackerInput,
    // Bind the tracker-list `ui://` widget for MCP Apps hosts (ADR-0024). A plain
    // object literal — no ext-apps import — so tsup never bundles the SDK into
    // dist/server.js. The terminal ignores `_meta` and renders the text content.
    meta: { ui: { resourceUri: TRACKER_LIST_WIDGET_URI } },
    handler: async () => {
      // Config is (re)loaded per call so a mid-session `task config` edit (setting
      // the tracker_url_template) applies without a restart — same contract as the
      // `task` / `task-detail` tools.
      const { config } = loadConfig(env.configPath, env.projectDir);
      const { tasks } = readAllTasks(env.tasksDir, config);

      // The filter is on `tracker_id` presence (ADR-0024 §6). A task with a
      // tracker_id but no configured template maps to `tracker_url: null` via
      // buildTaskCard — it is still tracked (kept in the payload); the widget
      // renders the id with a configure hint rather than a dead link.
      const cards: TaskCard[] = tasks
        .filter((t) => t.frontmatter.tracker_id)
        .map((t) => buildTaskCard(t, config));

      const payload: TrackerListPayload = { tasks: cards };
      const result: ToolResult = {
        content: [{ type: "text", text: renderTrackerText(cards) }],
        structuredContent: payload,
      };
      return result;
    },
  });
}

/** The terminal fallback — the tracked tasks as a markdown list (empty state included). */
function renderTrackerText(cards: TaskCard[]): string {
  if (cards.length === 0) {
    return [
      "# Tracked tasks (0)",
      "",
      "No tasks carry a tracker id. Add one when you create a task (e.g. `tracker_id: OSI-123`),",
      "and set `tracker_url_template` via `/marvin:kanban-config` to link out.",
    ].join("\n");
  }

  const lines: string[] = [`# Tracked tasks (${cards.length})`, ""];
  let anyUnlinked = false;
  for (const c of cards) {
    // A tracked card always has a tracker_id; render it as a link when a url was
    // derived, else as plain text (the template is unconfigured for this project).
    const tracker = c.tracker_url
      ? `[${c.tracker_id}](${c.tracker_url})`
      : `${c.tracker_id} _(no URL)_`;
    if (!c.tracker_url) anyUnlinked = true;
    const pr = c.pr
      ? ` · ${c.pr.number ? `[PR #${c.pr.number}](${c.pr.url})` : `[PR](${c.pr.url})`}`
      : "";
    lines.push(`- **${c.id}** ${c.title} — ${tracker} · ${c.status.key}${pr}`);
  }
  if (anyUnlinked) {
    lines.push("");
    lines.push(
      "_Some tasks have no tracker URL — set `tracker_url_template` via `/marvin:kanban-config` to link out._",
    );
  }
  return lines.join("\n");
}
