// Shared types for the generated command catalog (spec 005-website-content-pipeline, F3).
//
// scripts/gen-catalog.mjs emits catalog.json from the plugin sources at build time (FR-20);
// this module declares its shape and re-exports it typed. Phase-3 pages import from here
// (`import { catalog } from "../data/catalog"`) for the counts strip (FR-5), the command
// catalog grouped by the seven groups (FR-12), and the search corpus (FR-13). The generated
// JSON is the single source of the site's command list, counts, and version — no number is
// hand-maintained. A byte-exact drift guard (test/catalog.test.mjs) keeps the JSON fresh and
// the `check:catalog` tsc pass keeps this type and the JSON in lockstep.
import data from "./catalog.json";

/** Registry counts shown on the site (FR-5) — every value derived from the plugin sources. */
export interface Counts {
  prompts: number;
  tools: number;
  agents: number;
  widgets: number;
  version: string;
  license: string;
}

/** One command group (FR-12) — its key, curated blurb, and how many commands it holds. */
export interface CatalogGroup {
  key: string;
  blurb: string;
  count: number;
}

/** One command in the catalog (FR-12 / FR-13). */
export interface CatalogCommand {
  /** Bare command name, e.g. "task-start" (invoked as `/marvin:task-start`). */
  name: string;
  /** One of the seven groups: core, adr, pr, task, sec, refactor, track. */
  group: string;
  /** One-line synopsis (COMMAND_BLURBS). */
  blurb: string;
  /** Richer 1–2 sentence description (COMMAND_DETAILS). */
  description: string;
  /** Natural-language trigger phrases (COMMAND_PROMPTS) — part of the FR-13 search corpus. */
  phrases: string[];
  /** Optional copy-pasteable example invocation (COMMAND_EXAMPLES); absent when the command is run bare. */
  example?: string;
  /** True for human-run-only commands (adr-accept / adr-supersede / adr-sync). */
  human: boolean;
}

/** The whole generated catalog — the site's single data source (FR-20). */
export interface Catalog {
  version: string;
  counts: Counts;
  groups: CatalogGroup[];
  commands: CatalogCommand[];
}

export const catalog: Catalog = data;
export default catalog;
