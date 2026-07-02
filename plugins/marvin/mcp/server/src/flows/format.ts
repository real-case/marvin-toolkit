import type { Config, Task } from "../storage/schema.js";
import { orderedStatuses } from "../storage/schema.js";
import { trackerUrl } from "../storage/config.js";

export function formatTaskLine(t: Task): string {
  const tracker = t.frontmatter.tracker_id ? ` · ${t.frontmatter.tracker_id}` : "";
  return `${t.frontmatter.id} · [${t.frontmatter.type}] ${t.frontmatter.title}${tracker} · ${t.frontmatter.status}`;
}

/** Tasks bucketed by status key — an open record over the configured set (ADR-0026). */
export function groupByStatus(tasks: Task[]): Record<string, Task[]> {
  const groups: Record<string, Task[]> = {};
  for (const t of tasks) (groups[t.frontmatter.status] ??= []).push(t);
  return groups;
}

export function renderListTable(
  tasks: Task[],
  currentBranch: string | null,
  config: Config,
): string {
  if (tasks.length === 0)
    return "_No tasks yet — use `/marvin:kanban-bug` or similar to create one._";
  const groups = groupByStatus(tasks);
  const sections: string[] = [];
  for (const status of orderedStatuses(config)) {
    const list = groups[status.key] ?? [];
    if (list.length === 0) continue;
    sections.push(`### ${status.key} (${list.length})`);
    sections.push("");
    sections.push("| seq | type | title | tracker | branch | pr |");
    sections.push("|-----|------|-------|---------|--------|----|");
    for (const t of list) {
      const marker = currentBranch === t.frontmatter.branch ? " ◀ current" : "";
      sections.push(
        `| ${t.frontmatter.id} | ${t.frontmatter.type} | ${t.frontmatter.title} | ${t.frontmatter.tracker_id ?? "—"} | \`${t.frontmatter.branch}\`${marker} | ${prCell(t.frontmatter.pr)} |`,
      );
    }
    sections.push("");
  }
  return sections.join("\n");
}

/** PR cell for the list table: a link labeled with the /pull/<n> number when derivable. */
function prCell(url: string | undefined): string {
  if (!url) return "—";
  const match = url.match(/\/pull\/(\d+)/);
  return match ? `[#${match[1]}](${url})` : `[PR](${url})`;
}

export function renderTaskCard(t: Task, config: Config): string {
  const url = trackerUrl(config, t.frontmatter.tracker_id);
  const trackerLine = url
    ? `Tracker: [${t.frontmatter.tracker_id}](${url})`
    : t.frontmatter.tracker_id
      ? `Tracker: ${t.frontmatter.tracker_id}`
      : "";
  return [
    `**${t.frontmatter.id} · ${t.frontmatter.title}**`,
    `Type: ${t.frontmatter.type} · Status: ${t.frontmatter.status} · Branch: \`${t.frontmatter.branch}\``,
    trackerLine,
  ]
    .filter(Boolean)
    .join("\n");
}
