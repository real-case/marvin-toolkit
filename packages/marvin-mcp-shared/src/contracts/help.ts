import { z } from "zod";
import { StatusRole } from "./task.js";

/**
 * Help dashboard contract (ADR-0024) — feeds the `help` widget (`ui://marvin/
 * help.html`) and is the same payload the `help` tool renders to text for the
 * terminal fallback. It is a purpose-built welcome view: the project summary the
 * `dashboard` tool also computes, plus the two things a command index needs and
 * `DashboardState` does not carry — the configured MCP servers with their
 * enabled state, and the full per-command reference with authored blurbs.
 *
 * Data-only (ADR-0024): the same schema backs the tool's `structuredContent`
 * and the widget's props, so the text door and the rich door never drift.
 */

/**
 * One MCP server configured for this project (`.mcp.json` + settings union).
 * `enabled` is the honest signal the server can read without a live probe: a
 * server listed in a `disabledMcpjsonServers` set is dim, everything else is lit.
 */
export const HelpServer = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
});
export type HelpServer = z.infer<typeof HelpServer>;

/** One configured board status with its live count (ADR-0026), in board order. */
export const HelpStatus = z.object({
  key: z.string().min(1),
  role: StatusRole,
  count: z.number().int().nonnegative(),
});
export type HelpStatus = z.infer<typeof HelpStatus>;

/** A command group with its authored one-line purpose (the table of contents). */
export const HelpGroup = z.object({
  group: z.string().min(1),
  blurb: z.string(),
});
export type HelpGroup = z.infer<typeof HelpGroup>;

/**
 * One command in the reference: its registry name, group, authored blurb, and
 * whether it is human-run only (👤 — the `disable-model-invocation` lifecycle
 * commands, ADR-0027). Names come from the prompt registry (drift-proof); the
 * blurb is curated and guarded so every registry command has one.
 */
export const HelpCommand = z.object({
  group: z.string().min(1),
  name: z.string().min(1),
  blurb: z.string(),
  human: z.boolean(),
});
export type HelpCommand = z.infer<typeof HelpCommand>;

export const HelpState = z.object({
  version: z.string(),
  slogan: z.string(),
  project: z.string(),
  git: z.object({
    branch: z.string().nullable(),
    base_branch: z.string(),
    has_git: z.boolean(),
    has_gh: z.boolean(),
  }),
  statuses: z.array(HelpStatus),
  artifacts: z.object({
    specs: z.number().int().nonnegative(),
    handoffs: z.number().int().nonnegative(),
    audits: z.number().int().nonnegative(),
    lessons: z.number().int().nonnegative(),
  }),
  servers: z.array(HelpServer),
  groups: z.array(HelpGroup),
  commands: z.array(HelpCommand),
});
export type HelpState = z.infer<typeof HelpState>;
