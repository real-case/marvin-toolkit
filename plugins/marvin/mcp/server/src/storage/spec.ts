import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

/**
 * Shared spec-contract reader (ADR-0005 → ADR-0024).
 *
 * The typed, fail-closed graph that the `spec` Definition-of-Ready gate
 * validates — the File Change Plan, the Acceptance Criteria, and the interface
 * contract — lives in a `yaml spec-contract` block (ADR-0005). These schemas
 * and extractors are the single source of truth: the `spec` tool imports them
 * for the DoR gate, and the task-summary aggregator (ADR-0024) imports them to
 * read a spec's `criteria` from the *same* authoritative shape rather than
 * re-parsing prose or duplicating the parser (which would silently drift from
 * the gate). Parsing orchestration and the gate checks stay in the `spec` tool.
 */

const ID_FILE = /^F\d+$/i;
const ID_AC = /^AC\d+$/i;
/** A scalar id, an array of ids, or "—"/"none" for an infra row. */
const RefList = z.union([z.array(z.union([z.string(), z.number()])), z.string()]);

const FileRow = z.object({
  id: z.string().regex(ID_FILE, "file id must look like F1, F2, …"),
  path: z.string().min(1),
  action: z.enum(["new", "edit", "delete"]),
  intent: z.string().optional(),
  satisfies: RefList.optional(),
  anchor: z.string().optional(),
});

const Oracle = z.object({
  kind: z.enum(["test", "command", "prose-review"]),
  ref: z.string().optional(),
});

const Criterion = z.object({
  id: z.string().regex(ID_AC, "criterion id must look like AC1, AC2, …"),
  statement: z.string().min(1),
  implemented_by: RefList,
  oracle: Oracle,
  failure: z.string().optional(),
  regression: z.boolean().optional(),
});
export type Criterion = z.infer<typeof Criterion>;

const ContractObj = z.object({
  kind: z.enum(["function", "route", "schema", "cli", "event", "none"]),
  signature: z.string().optional(),
});

export const SpecContract = z.object({
  files: z.array(FileRow).min(1),
  build_order: z.array(z.union([z.string(), z.number()])).optional(),
  contract: ContractObj.optional(),
  criteria: z.array(Criterion).min(1),
  depends_on: z.array(z.string()).optional(),
});
export type SpecContract = z.infer<typeof SpecContract>;

/**
 * Discovered, host-specific bindings (ADR-0005 Contract B). Optional and
 * advisory — populated by task-start's pre-draft discovery, not load-bearing
 * for execution. `passthrough` keeps any extra host keys the author records;
 * `spec_location` is what lets depends_on resolve sibling specs, and
 * `decision_record.path` is a link the task summary surfaces.
 */
export const HostBindings = z
  .object({
    spec_location: z.string().optional(),
    decision_record: z
      .object({ style: z.string().optional(), path: z.string().optional() })
      .optional(),
    merge_obligations: z.array(z.string()).optional(),
    gates: z.record(z.string()).optional(),
  })
  .passthrough();
export type HostBindings = z.infer<typeof HostBindings>;

/** Extract the first fenced block whose info string mentions `spec-contract`. */
export function extractContractBlock(body: string): string | null {
  const m = /```[^\n`]*spec-contract[^\n`]*\n([\s\S]*?)\n```/.exec(body);
  return m ? m[1]! : null;
}

/** Extract the first fenced block whose info string mentions `host-bindings`. */
export function extractHostBindings(body: string): string | null {
  const m = /```[^\n`]*host-bindings[^\n`]*\n([\s\S]*?)\n```/.exec(body);
  return m ? m[1]! : null;
}

/**
 * Host-adaptive spec directories searched, in order, after any host
 * `spec_location` (ADR-0005): `.marvin/task` is the default, but an existing
 * host convention is preferred when present.
 */
export const SPEC_DIRS = [".marvin/task", "specs", "docs/specs", "docs/rfcs", "rfcs"] as const;

/**
 * Resolve a spec filename from its slug within one directory, tolerating the
 * numeric ordering prefix that `task-start` stamps onto spec files
 * (`NNN-<slug>.md`). Returns the absolute path, or null if no file in the
 * directory matches. An exact `<slug>.md` (legacy, unnumbered) is preferred;
 * otherwise the first `<digits>-<slug>.md` match wins.
 */
export function resolveSpecBySlug(dir: string, slug: string, projectRoot: string): string | null {
  const abs = isAbsolute(dir) ? dir : join(projectRoot, dir);
  if (!existsSync(abs)) return null;
  const exact = `${slug}.md`;
  const numbered = new RegExp(`^\\d+-${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.md$`);
  let fallback: string | null = null;
  for (const entry of readdirSync(abs).sort()) {
    if (entry === exact) return join(abs, entry);
    if (!fallback && numbered.test(entry)) fallback = join(abs, entry);
  }
  return fallback;
}
