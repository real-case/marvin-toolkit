import { z } from "zod";
import { LinkRef } from "./links.js";

/**
 * "What was done" task summary (ADR-0024) — feeds the task-summary widget (#3).
 * This is the one genuinely-aggregated contract: a Stage-1 tool joins the
 * spec-contract `criteria` (from the immutable spec) against the `verification.md`
 * gate outcomes, the branch's git log, the captured lessons, and the artifact
 * links. No prose is re-parsed — every input already lives in a typed block.
 */
export const OracleKind = z.enum(["test", "command", "prose-review"]);
export type OracleKind = z.infer<typeof OracleKind>;

/** An acceptance criterion (from the spec-contract) joined to its proof outcome. */
export const AcOutcome = z.object({
  id: z.string().regex(/^AC\d+$/i, "criterion id like AC1"),
  statement: z.string().min(1),
  oracle_kind: OracleKind,
  oracle_ref: z.string().optional(),
  outcome: z.enum(["pass", "fail", "unknown"]),
});
export type AcOutcome = z.infer<typeof AcOutcome>;

export const GateName = z.enum(["test", "lint", "typecheck", "build"]);
export type GateName = z.infer<typeof GateName>;

export const GateOutcome = z.object({
  name: GateName,
  status: z.enum(["pass", "fail", "skip"]),
  detail: z.string().optional(),
});
export type GateOutcome = z.infer<typeof GateOutcome>;

export const CommitRef = z.object({ sha: z.string(), subject: z.string() });
export type CommitRef = z.infer<typeof CommitRef>;

export const LessonRef = z.object({ id: z.string(), title: z.string() });
export type LessonRef = z.infer<typeof LessonRef>;

export const TaskSummary = z.object({
  slug: z.string(),
  title: z.string(),
  status: z.string(),
  acceptance: z.array(AcOutcome),
  gates: z.array(GateOutcome),
  commits: z.array(CommitRef),
  lessons: z.array(LessonRef),
  links: z.array(LinkRef),
});
export type TaskSummary = z.infer<typeof TaskSummary>;
