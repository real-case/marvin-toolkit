import { z } from "zod";

/**
 * The critic receipt (ADR-0039) — a critic's verdict as a durable, typed
 * artifact instead of a sentence that survives only as long as the session.
 *
 * Written by the calling session to `.marvin/critique/<NNN>-<slug>.md` at the
 * four spec-backed pipeline call sites (`task-start` 8F/8B, `task-implement`
 * 6F/9B) and ingested by the `report` tool as the fifth `ReportGroup`. This
 * module ships types and a schema ONLY — the roll-up function lives in
 * `plugins/marvin/mcp/server/src/lib/reports.ts`, for the reason stated at
 * {@link TerminalVerdict}.
 */

/**
 * What a critic may EMIT — the five-value vocabulary both agent bodies carry
 * (`marvin-tm-diff-critic`, `marvin-tm-spec-critic`).
 */
export const CritiqueVerdict = z.enum([
  "PASS",
  "PASS WITH WARNINGS",
  "BLOCK",
  "NEEDS_CONTEXT",
  "UNABLE",
]);
export type CritiqueVerdict = z.infer<typeof CritiqueVerdict>;

/**
 * What a RECEIPT may record — the four-value subset, excluding
 * `NEEDS_CONTEXT`.
 *
 * The protocol already states that a `NEEDS_CONTEXT` resolves on its single
 * re-dispatch or becomes `UNABLE`, and is never the verdict recorded
 * (`marvin-tm-spec-critic` Integration point, `task-start/SKILL.md` Step 8F).
 * Excluding it here turns that prose rule into a schema rule: a receipt
 * claiming a non-terminal verdict does not validate.
 *
 * **Roll-up ordering (normative): `BLOCK` > `UNABLE` > `PASS WITH WARNINGS` >
 * `PASS`.** `BLOCK` outranks `UNABLE` because `BLOCK` carries an action and
 * `UNABLE` carries none, and because `task-deliver`'s draft-PR rule keys off
 * `BLOCK` — rolling a `BLOCK` + `UNABLE` pair up to `UNABLE` would silently
 * disarm the one enforcement the receipt promises not to weaken.
 *
 * The ordering has exactly ONE implementation: `rollUp` in
 * `plugins/marvin/mcp/server/src/lib/reports.ts`. It cannot live here — that
 * module imports this package type-only and its unit tests compile it with
 * `packages: "external"`, so a value import would resolve to an uncommitted
 * `dist/contracts/index.js` and make the parser tests depend on a shared-package
 * build. Declaring it in both places would be exactly the unguarded duplication
 * ADR-0039 exists to eliminate, so this comment is the pointer and there is no
 * second copy.
 */
export const TerminalVerdict = z.enum(["PASS", "PASS WITH WARNINGS", "BLOCK", "UNABLE"]);
export type TerminalVerdict = z.infer<typeof TerminalVerdict>;

/** One judged axis: its verdict plus the counts that produced it. */
export const AxisVerdict = z.object({
  verdict: TerminalVerdict,
  blockers: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
});
export type AxisVerdict = z.infer<typeof AxisVerdict>;

/** Which critic wrote the receipt — the two agent names, as an enum. */
export const CritiqueCritic = z.enum(["marvin-tm-spec-critic", "marvin-tm-diff-critic"]);
export type CritiqueCritic = z.infer<typeof CritiqueCritic>;

/**
 * The three fields the **Inability** section of both report templates already
 * carries, promoted into the block so an inability is machine-readable.
 */
export const CritiqueInability = z.object({
  blocker: z.string().min(1),
  attempted: z.string().min(1),
  recommendation: z.string().min(1),
});
export type CritiqueInability = z.infer<typeof CritiqueInability>;

/**
 * One receipt's typed block — the ` ```json critic-verdict ` fence at the tail
 * of a `.marvin/critique/<NNN>-<slug>.md` document.
 *
 * `subject` is the **spec slug, always** — the identity of the task being
 * critiqued, not of the thing the critic looked at, which `critic` already
 * carries (`marvin-tm-spec-critic` judged the spec, `marvin-tm-diff-critic`
 * judged the diff that implements it). That is what makes a receipt resolvable
 * from a spec in both directions: the `report` scan's spec `LinkRef` and the
 * `summary` tool's receipt lookup both key on this one field. There is
 * deliberately no `subject_kind`: it would be a second value the writing model
 * must keep consistent with `critic`, which is the same defect that rules out a
 * stored roll-up.
 *
 * There is deliberately **no roll-up field**. The roll-up is derived from the
 * two axes by the single `rollUp` declaration named at {@link TerminalVerdict},
 * so the value a reader computes and the value a model wrote can never disagree.
 *
 * The refinement makes the receipt fail-closed in one direction: if either axis
 * is `UNABLE`, `inability` is REQUIRED. A receipt cannot claim the semantic gate
 * did not run while declining to say why.
 */
export const Critique = z
  .object({
    critic: CritiqueCritic,
    /** The spec slug this critique belongs to — non-empty, always. */
    subject: z
      .string()
      .min(1)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "subject must be a spec slug"),
    judged_at: z.string().datetime(),
    compliance: AxisVerdict,
    quality: AxisVerdict,
    inability: CritiqueInability.optional(),
  })
  .superRefine((value, ctx) => {
    const unable = value.compliance.verdict === "UNABLE" || value.quality.verdict === "UNABLE";
    if (unable && !value.inability) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inability"],
        message: "an UNABLE axis requires an inability object (blocker, attempted, recommendation)",
      });
    }
  });
export type Critique = z.infer<typeof Critique>;
