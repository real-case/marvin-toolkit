import type { PrRef, TaskCard } from "@marvin-toolkit/mcp-shared/contracts";
import { roleOfStatus, type Config, type Task } from "../storage/schema.js";
import { trackerUrl } from "../storage/config.js";

/**
 * Map one kanban task to the TaskCard widget contract (ADR-0024). Shared by the
 * `task` list payload (`buildTaskListPayload`) and the `task-detail` tool, so the
 * two payloads describe a card identically and cannot drift as fields are added.
 *
 * Pure: it computes no counts. The list payload rolls up its `counts` /
 * `role_counts` from the returned cards, keeping this mapping side-effect free
 * (and reusable for a single-task detail where there is nothing to count).
 */
export function buildTaskCard(task: Task, config: Config): TaskCard {
  const fm = task.frontmatter;
  return {
    id: fm.id,
    type: fm.type,
    status: { key: fm.status, role: roleOfStatus(config, fm.status) },
    title: fm.title,
    branch: fm.branch,
    ...(fm.tracker_id ? { tracker_id: fm.tracker_id } : {}),
    tracker_url: trackerUrl(config, fm.tracker_id),
    pr: prRefFromUrl(fm.pr),
    created: fm.created,
    updated: fm.updated,
  };
}

/**
 * Map a stored PR URL to the PrRef widget contract (ADR-0024). The PR number is
 * derived from the URL (`…/pull/<n>`); `state` is intentionally omitted — marvin
 * stores the URL at create time and never live-resolves the PR's current state.
 */
export function prRefFromUrl(url: string | undefined): PrRef | null {
  if (!url) return null;
  const match = url.match(/\/pull\/(\d+)/);
  return match ? { url, number: Number(match[1]) } : { url };
}
