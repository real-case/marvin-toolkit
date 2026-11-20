import type { FlowMap } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * Flow-map regeneration rules (FLW-07, FLW-08). Pure: the tool reads the previous map and the
 * new one and writes what `mergeFlows` returns.
 */

type Keyed = { id: string; pinned: boolean };

function keepPinned<T extends Keyed>(next: T[], prev: T[]): T[] {
  const ids = new Set(next.map((x) => x.id));
  const carried = prev.filter((x) => x.pinned && !ids.has(x.id));
  // A pinned entry the regeneration also produced keeps the human's version.
  const pinnedById = new Map(prev.filter((x) => x.pinned).map((x) => [x.id, x]));
  return [...next.map((x) => pinnedById.get(x.id) ?? x), ...carried].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

/** Merge a regenerated map over the previous one: pinned (human) entries survive regeneration. */
export function mergeFlows(next: FlowMap, prev: FlowMap | null): FlowMap {
  if (!prev) {
    return {
      ...next,
      nodes: [...next.nodes].sort((a, b) => a.id.localeCompare(b.id)),
      transitions: [...next.transitions].sort((a, b) => a.id.localeCompare(b.id)),
      journeys: [...next.journeys].sort((a, b) => a.id.localeCompare(b.id)),
    };
  }
  return {
    ...next,
    nodes: keepPinned(next.nodes, prev.nodes),
    transitions: keepPinned(next.transitions, prev.transitions),
    journeys: keepPinned(next.journeys, prev.journeys),
  };
}

export interface FlowDiff {
  nodes: { added: string[]; removed: string[] };
  transitions: { added: string[]; removed: string[] };
  journeys: { added: string[]; removed: string[] };
}

function diffIds(
  next: { id: string }[],
  prev: { id: string }[],
): { added: string[]; removed: string[] } {
  const a = new Set(next.map((x) => x.id));
  const b = new Set(prev.map((x) => x.id));
  return {
    added: [...a].filter((id) => !b.has(id)).sort(),
    removed: [...b].filter((id) => !a.has(id)).sort(),
  };
}

/** FLW-07: flows that appeared or disappeared between two maps. */
export function diffFlows(next: FlowMap, prev: FlowMap | null): FlowDiff {
  const empty: FlowMap = { version: 1, nodes: [], transitions: [], journeys: [], anomalies: [] };
  const p = prev ?? empty;
  return {
    nodes: diffIds(next.nodes, p.nodes),
    transitions: diffIds(next.transitions, p.transitions),
    journeys: diffIds(next.journeys, p.journeys),
  };
}

/** Dangling references inside one map: a transition or journey naming a node that does not exist. */
export function danglingRefs(map: FlowMap): string[] {
  const nodes = new Set(map.nodes.map((n) => n.id));
  const transitions = new Set(map.transitions.map((t) => t.id));
  const out: string[] = [];
  for (const t of map.transitions) {
    if (!nodes.has(t.from)) out.push(`transition ${t.id}: from "${t.from}" is not a node`);
    if (t.to !== undefined && !nodes.has(t.to))
      out.push(`transition ${t.id}: to "${t.to}" is not a node`);
  }
  for (const j of map.journeys) {
    for (const s of j.steps) {
      if (!transitions.has(s) && !nodes.has(s))
        out.push(`journey ${j.id}: step "${s}" is neither a node nor a transition`);
    }
  }
  return out;
}
