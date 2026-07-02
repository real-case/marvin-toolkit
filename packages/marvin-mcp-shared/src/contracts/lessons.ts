import { z } from "zod";

/**
 * Lessons-store statistics (ADR-0028) — the `lessons stats` action's
 * `structuredContent` shape and the dashboard's lessons feed (ADR-0024
 * data-first staging; the planned dashboard embeds it into `DashboardState`).
 *
 * `by_type` carries every type of the closed lesson taxonomy (owned by the
 * server's lessons storage, ADR-0021), present even at 0 — the per-key counts
 * doctrine of ADR-0026. `by_tag` is an open vocabulary, so only tags that
 * actually occur appear.
 */
export const LessonsStats = z.object({
  total: z.number().int().nonnegative(),
  by_type: z.record(z.string(), z.number().int().nonnegative()),
  by_tag: z.record(z.string(), z.number().int().nonnegative()),
});
export type LessonsStats = z.infer<typeof LessonsStats>;
