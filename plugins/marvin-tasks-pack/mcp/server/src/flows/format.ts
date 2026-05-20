import type { Task, TaskStatus } from "../storage/schema.js";
import type { Config } from "../storage/schema.js";
import { trackerUrl } from "../storage/config.js";

export function formatTaskLine(t: Task): string {
  const tracker = t.frontmatter.tracker_id ? ` · ${t.frontmatter.tracker_id}` : "";
  return `${t.frontmatter.id} · [${t.frontmatter.type}] ${t.frontmatter.title}${tracker} · ${t.frontmatter.status}`;
}

export function groupByStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
  const groups: Record<TaskStatus, Task[]> = {
    todo: [],
    wip: [],
    review: [],
    done: [],
    blocked: [],
  };
  for (const t of tasks) groups[t.frontmatter.status].push(t);
  return groups;
}

export function renderListTable(tasks: Task[], currentBranch: string | null): string {
  if (tasks.length === 0) return "_No tasks yet — use `/marvin-tasks:bug` or similar to create one._";
  const groups = groupByStatus(tasks);
  const order: TaskStatus[] = ["wip", "review", "todo", "blocked", "done"];
  const sections: string[] = [];
  for (const status of order) {
    const list = groups[status];
    if (list.length === 0) continue;
    sections.push(`### ${status} (${list.length})`);
    sections.push("");
    sections.push("| seq | type | title | tracker | branch |");
    sections.push("|-----|------|-------|---------|--------|");
    for (const t of list) {
      const marker = currentBranch === t.frontmatter.branch ? " ◀ current" : "";
      sections.push(
        `| ${t.frontmatter.id} | ${t.frontmatter.type} | ${t.frontmatter.title} | ${t.frontmatter.tracker_id ?? "—"} | \`${t.frontmatter.branch}\`${marker} |`,
      );
    }
    sections.push("");
  }
  return sections.join("\n");
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
