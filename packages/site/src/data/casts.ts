// Shared types for the generated pipeline-tour recordings (spec 012-website-terminal-recordings, F3).
//
// scripts/gen-casts.mjs emits casts.json from the authored stage scripts at build time; this module
// declares its shape and re-exports it typed, exactly as catalog.ts does for the command catalog.
// pipeline.astro imports from here so no stage command, caption or duration is hand-typed — the
// page and the recordings cannot drift, which is the whole point of AC2. The `check:catalog` tsc
// pass covers this file too, keeping the type and the JSON in lockstep.
import data from "./casts.json";

/** One pipeline stage's recording, as emitted by gen-casts.mjs. */
export interface Cast {
  /** Stage key, e.g. "task-start" — also the emitted <key>.cast basename. */
  key: string;
  /** The command the recording runs, e.g. "/marvin:task-start". Guaranteed present in the catalog. */
  command: string;
  /** The poster's second line, e.g. "dialogue → spec…". */
  caption: string;
  /** Absolute URL of the cast under public/, e.g. "/casts/task-start.cast" — unhashed and stable. */
  file: string;
  /** Seconds, MEASURED from the emitted cast rather than declared. */
  duration: number;
  /** Player poster frame, `npt:M:SS` — parked on the fully-typed command. */
  poster: string;
}

export const casts: Cast[] = data;

// The Home hero recording (spec 016-website-home-hero-recording) — the manifest row keyed "hero",
// played by the hero <CastPlayer> in index.astro. Resolved by name so the page consumes a checked
// Cast rather than indexing the array by a literal; throws at build time if the generator did not
// emit it (the four pipeline stages stay reachable via `casts`, which pipeline.astro looks up by key).
const hero = casts.find((cast) => cast.key === "hero");
if (!hero) {
  throw new Error(
    "src/data/casts.json is missing the hero recording — run `npm run gen:casts -w @marvin-toolkit/site`.",
  );
}
export const heroCast: Cast = hero;

/**
 * `M:SS`, the form the posters print. Kept here rather than in the island so the Astro page and the
 * Preact component format the same number identically.
 *
 * FLOORS, matching the player's own `formatTime` (`let s = Math.floor(seconds)`), so the badge and
 * the player's `ap-time-remaining` never disagree. Rounding instead put three of the four stages
 * one second above what the player then counted down from. Flooring also makes the badge a lower
 * bound on the running time rather than an occasional overstatement, which is the safer direction
 * for a number a visitor decides whether to spend time on.
 */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export default casts;
