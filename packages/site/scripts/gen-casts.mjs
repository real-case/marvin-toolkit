#!/usr/bin/env node
// gen-casts.mjs — the pipeline tour's terminal recordings (spec 012-website-terminal-recordings, F1).
//
// Emits, from the authored STAGES below:
//   public/casts/<key>.cast          — one asciicast v2 recording per pipeline stage (git-ignored
//                                      build output, regenerated on every dev/build)
//   public/casts/asciinema-player.css — a byte copy of the player's vendor stylesheet, so the
//                                      island can <link> it at activation without the bundler
//                                      hoisting 19 KB of vendor CSS into every /pipeline visit
//                                      (spec F4's pre-authorized route; also gives AC5 a stable URL)
//   src/data/casts.json              — the COMMITTED manifest: each stage's cast path, its measured
//                                      duration and its poster frame, so no duration is hand-typed
//
// WHY GENERATED RATHER THAN CAPTURED (spec "Why this over alternatives"): a captured session would
// carry local paths and repo state needing scrubbing before a public site, would re-break whenever
// output changes, and could not hit a stated duration. These are reconstructions — authored to match
// what the commands actually print. Swapping in captured casts later is a content-only change,
// because the page reads durations from the cast rather than declaring them.
//
// THE FORMAT HAS TWO SILENT-FAILURE MODES, both verified against asciinema-player@3.17.0 source and
// both guarded by test/casts.test.mjs:
//   1. An asciicast v2 header keys its geometry `width`/`height`. The parser reads exactly those
//      (dist/core-*.js parseAsciicastV2), so a `cols`/`rows` header does not error — it renders at
//      the wrong geometry with every gate green.
//   2. v2 event times are ABSOLUTE, not deltas: parseAsciicastV2 maps `e[0]*1000` with no
//      accumulation (v3 is the one that accumulates). The emitter therefore writes a running total.
// A third: parseJsonl filters event lines on `l[0] === "["` and silently DROPS anything else, so an
// indented event line yields an empty recording and a blank terminal with no error.
//
// CONTENT INTEGRITY: every stage below records where its output was reconstructed from. The
// faithfulness of the output TEXT is a human merge obligation, and the per-stage provenance
// comments are what a reviewer checks it against.
//
// assertCommandsExist() covers the other half mechanically: every scripted command must exist in
// the generated catalog. That guard is NOT redundant with test/command-refs.test.mjs, which was
// added by PR #144 after the site shipped `/marvin:verify` on two pages (`verify` is an MCP tool,
// not a prompt, so it has no slash form). That test scans `src/**/*.{astro,tsx}` only — these
// authored scripts live under scripts/ as .mjs, and the recordings they emit are .cast files, so
// neither is in its reach. A stage naming a non-existent command would render inside a terminal
// where no source scanner would ever see it.
import { writeFileSync, readFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", ".."); // packages/site/scripts → repo root
const OUT_DIR = join(here, "..", "public", "casts");
const CATALOG_JSON = join(here, "..", "src", "data", "catalog.json");
const MANIFEST_JSON = join(here, "..", "src", "data", "casts.json");

/** The vendor stylesheet's package subpath — the only way it is reachable (package.json exports). */
export const VENDOR_CSS_SPECIFIER = "asciinema-player/dist/bundle/asciinema-player.css";
/** Its emitted name under public/casts/ — a stable, unhashed URL, which AC5 asserts on. */
export const VENDOR_CSS_FILE = "asciinema-player.css";

/**
 * Terminal geometry. 64 columns is a deliberate design call, not a default: `fit: "width"` scales
 * the font so the whole grid fits the container, so every extra column shrinks the glyphs at 360px.
 * 64 keeps the posters legible on a phone while still holding the widest authored line below.
 * Every line in STAGES is kept under this width so nothing wraps.
 */
export const WIDTH = 64;

/** No stage renders shorter than this, so a very short script still reads as a terminal. */
export const MIN_HEIGHT = 12;

/**
 * Rows are sized PER STAGE: the command line, every output line, and one row for the resting
 * cursor. A single global height would have to fit the longest stage, leaving the three shorter
 * ones with a third of their terminal blank — and the recordings sit beside cards of their own
 * height, so that dead space shows.
 *
 * Fitting the content exactly is also what keeps the grid from scrolling, which matters beyond
 * looks: once it scrolls, the typed command line leaves the top of the screen, and AC4 ("the
 * terminal contains that stage's recorded command") would pass while the command is being typed
 * and fail once playback finishes — a timing-dependent flake. casts.test.mjs pins the invariant so
 * a future content edit cannot reintroduce it.
 */
export function castHeight(stage) {
  return Math.max(MIN_HEIGHT, 1 + stage.lines.length + 1);
}

/**
 * Seconds per typed character and the pause on either side of the command.
 *
 * There is deliberately no trailing hold. The player derives a recording's duration from its LAST
 * EVENT (`const duration = events[events.length - 1][0]` in dist/core-*.js), so padding time after
 * the final event does not extend playback — it only makes the manifest disagree with the player's
 * own clock, which would put a different number in the poster badge than in `ap-time-remaining`.
 * A closing hold is unnecessary anyway: playback stops on the last frame and leaves it on screen.
 */
const TYPE_DELAY = 0.045;
const PROMPT_PAUSE = 0.35;
const ENTER_PAUSE = 0.3;

// The CSI introducer, written as an explicit escape rather than a raw control byte so the source
// stays greppable and cannot be mangled by an editor or a formatter that trims control chars.
const ESC = "\u001b[";
const sgr = (code, s) => `${ESC}${code}m${s}${ESC}0m`;
/** Terminal colours, kept to the 8-colour set so they follow the player's theme rather than fight it. */
const green = (s) => sgr(32, s);
const dim = (s) => sgr(2, s);
const bold = (s) => sgr(1, s);
const cyan = (s) => sgr(36, s);
const okGreen = (s) => `${ESC}1;32m${s}${ESC}0m`;

/** The shell prompt each recording opens on. */
const PROMPT = green("➜ ");
/** A passed check, as the readiness and verification reports render them. */
const OK = okGreen("✓");

/**
 * The four pipeline stages, in tour order. A maintainer updating a recording edits `lines` here and
 * nothing else — the emitter below is content-free.
 *
 * `delay` is the pause in seconds BEFORE that line appears, which is what makes a stage read like
 * work happening rather than a paste.
 */
export const STAGES = [
  {
    key: "task-start",
    command: "/marvin:task-start",
    caption: "dialogue → spec…",
    // PROVENANCE — reconstructed from:
    //   skills/task-start/SKILL.md steps 1.3–1.4 (intake, codebase context, dimension sweep) and
    //   step 8 (the tool-backed DoR gate);
    //   the `spec` tool's real report renderer, plugins/marvin/mcp/server/src/tools/spec.ts:930-950
    //   (the "Spec Readiness Report" heading, Verdict line, "## Checks" list and ✅ icon) with the
    //   check labels taken verbatim from its pass()/fail() call sites — Frontmatter, Spec contract,
    //   Traceability, File paths, Open Questions;
    //   the `lessons` tool's real search renderer, tools/lessons.ts:260 ("# Relevant lessons (N)");
    //   and a real run in this repo, whose gate returned PASS over 14 files and 7 criteria and wrote
    //   .marvin/task/012-website-terminal-recordings.md.
    lines: [
      { text: dim("Intake · type: feature · stack: typescript, astro"), delay: 0.7 },
      { text: "", delay: 0.35 },
      { text: `${bold("Relevant lessons")} ${dim("(3, from .marvin/memory/)")}`, delay: 0.8 },
      { text: dim("  · a running astro dev server hijacks the site e2e"), delay: 0.3 },
      { text: dim("  · Preact skips prop updates on hydrated DOM"), delay: 0.15 },
      { text: dim("  · generated output needs a .prettierignore entry"), delay: 0.15 },
      { text: "", delay: 0.5 },
      { text: `Dimension sweep ${dim("→")} 7 acceptance criteria`, delay: 0.9 },
      { text: dim("Sealing the spec contract…"), delay: 0.6 },
      { text: "", delay: 0.9 },
      { text: `${bold("Spec Readiness Report")}   Verdict: ${okGreen("PASS")}`, delay: 0.5 },
      { text: `  ${OK} Frontmatter     ${dim("slug · type · status · risk")}`, delay: 0.25 },
      { text: `  ${OK} Spec contract   ${dim("14 files · 7 criteria")}`, delay: 0.2 },
      { text: `  ${OK} Traceability    ${dim("every AC → files → oracle")}`, delay: 0.2 },
      { text: `  ${OK} File paths      ${dim("14 resolve on disk")}`, delay: 0.2 },
      { text: "", delay: 0.4 },
      { text: cyan("→ .marvin/task/012-website-terminal-recordings.md"), delay: 0.3 },
    ],
  },
  {
    key: "task-implement",
    command: "/marvin:task-implement",
    caption: "writing code + tests…",
    // PROVENANCE — reconstructed from:
    //   skills/task-implement/SKILL.md step 1 (resolve the spec), step 2 (the tool-backed
    //   immutability check and the status → in-progress carve-out), step 5F (build order and the
    //   contract file allowlist) and step 6F (the `spec` tool's scope gate, then diff-critic ‖
    //   verify run concurrently);
    //   a real run of THIS spec in this repo — the seal hash d80af627a6f82eb6 below is the value the
    //   `spec` tool actually returned for 012-website-terminal-recordings, and the five listed paths
    //   are five of its fourteen contract files.
    lines: [
      { text: dim("Resolving spec… 012-website-terminal-recordings"), delay: 0.7 },
      { text: `Contract seal: ${okGreen("intact")} ${dim("(d80af627a6f82eb6)")}`, delay: 0.5 },
      { text: dim("Status → in-progress"), delay: 0.3 },
      { text: "", delay: 0.5 },
      { text: `Implementing ${dim("— 14 files, build order pinned")}`, delay: 0.7 },
      { text: `  ${green("+")} scripts/gen-casts.mjs`, delay: 0.6 },
      { text: `  ${green("+")} src/data/casts.json`, delay: 0.45 },
      { text: `  ${green("+")} src/components/CastPlayer.tsx`, delay: 0.5 },
      { text: `  ${cyan("~")} src/pages/pipeline.astro`, delay: 0.55 },
      { text: `  ${green("+")} test/casts.test.mjs`, delay: 0.5 },
      { text: "", delay: 0.5 },
      { text: `Scope gate: ${dim("git diff ⊆ contract allowlist")}  ${OK}`, delay: 0.8 },
      { text: dim("Self-review ‖ verify — running concurrently…"), delay: 0.4 },
    ],
  },
  {
    key: "task-verify",
    command: "/marvin:task-verify",
    caption: "gates: 4 running…",
    // PROVENANCE — reconstructed from a REAL ARTIFACT: .marvin/task/verification.md as written by
    //   the `verify` tool in this repo. The report heading, the Pipeline/Verdict lines, the four
    //   "## <Gate> Results" sections, the "N/A — not configured for this stack" type-check line and
    //   the wall-clock-vs-sum-of-gates latency line are its structure verbatim; the four durations
    //   (42797 / 1751 / 8270 ms, 52819 vs 52818) are that artifact's real measured numbers.
    //   Cross-checked against skills/task-verify/SKILL.md step 3 (relay the verdict) and
    //   plugins/marvin/mcp/server/src/tools/verify.ts:628-633 (the report renderer).
    //   The command is the task-verify PROMPT, not the tool of a similar name: the tool has no
    //   prompt entry and is absent from the generated catalog, so assertCommandsExist rejects it.
    lines: [
      { text: dim("Detecting stack… package.json scripts"), delay: 0.7 },
      { text: dim("Running 4 gates concurrently…"), delay: 0.4 },
      { text: "", delay: 1.1 },
      { text: `${bold("Verification Report")}   Verdict: ${okGreen("PASS")}`, delay: 0.6 },
      { text: dim("  pipeline: feature · execution: parallel"), delay: 0.25 },
      { text: "", delay: 0.35 },
      { text: `  ${OK} test        ${dim("passed, 42797ms")}`, delay: 0.5 },
      { text: `  ${OK} lint        ${dim("passed,  1751ms")}`, delay: 0.3 },
      { text: `  ${dim("·")} type-check  ${dim("N/A — not configured")}`, delay: 0.25 },
      { text: `  ${OK} build       ${dim("passed,  8270ms")}`, delay: 0.4 },
      { text: "", delay: 0.4 },
      { text: dim("  wall-clock 52819ms vs sum-of-gates 52818ms"), delay: 0.3 },
      { text: cyan("→ .marvin/task/verification.md"), delay: 0.4 },
    ],
  },
  {
    key: "task-deliver",
    command: "/marvin:task-deliver",
    caption: "commit → pull request…",
    // PROVENANCE — reconstructed from:
    //   skills/task-deliver/SKILL.md step 1 (the tool-backed delivery gate reading verification.md
    //   and returning ALLOW / BLOCK), step 2 (commit via the /marvin:commit workflow), step 3
    //   (PR via /marvin:pr-create) and step 5 (capture a lesson into .marvin/memory/);
    //   the repo's Conventional Commits convention (CLAUDE.md) and the real branch/base pair this
    //   task used — feat/website-terminal-recordings onto dev, which is the ADR-0019 branching
    //   model. Commit hash and PR number are illustrative; the shapes are this repo's real ones.
    lines: [
      { text: `Delivery gate: ${dim("verification.md →")} ${okGreen("PASS")}  ${OK}`, delay: 0.8 },
      { text: "", delay: 0.4 },
      { text: dim("Staging 14 files…"), delay: 0.5 },
      { text: `${dim("[feat/website-terminal-recordings 8dca29e]")}`, delay: 0.7 },
      { text: "  feat(site): terminal recordings on the pipeline tour", delay: 0.2 },
      { text: "", delay: 0.5 },
      { text: dim("Pushing → origin"), delay: 0.6 },
      { text: dim("Opening pull request…"), delay: 0.7 },
      { text: "", delay: 0.6 },
      { text: `  ${bold("#145")}  feat(site): terminal recordings`, delay: 0.3 },
      { text: `  ${dim("base: dev ← feat/website-terminal-recordings")}`, delay: 0.2 },
      { text: "", delay: 0.4 },
      { text: `Lesson captured ${dim("→ .marvin/memory/")}  ${OK}`, delay: 0.5 },
    ],
  },
];

/** Times are written with millisecond precision — enough for playback, short enough to stay exact. */
const round = (t) => Math.round(t * 1000) / 1000;

/**
 * `npt:M:SS`, the player's poster syntax — parks the poster frame on the fully-typed command.
 *
 * Rounds UP, which is the whole point: the command finishes typing partway through a second, so
 * flooring would land the poster mid-word (`➜ /marvin:task-st`) rather than on the finished
 * command. Ceiling lands after the command's newline and still before the first output line, so
 * the frame behind the play button matches the poster the island server-renders. casts.test.mjs
 * pins that window rather than just the string shape.
 */
function npt(seconds) {
  const whole = Math.max(0, Math.ceil(seconds));
  return `npt:${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * One stage → one asciicast v2 document.
 *
 * The command is typed a character at a time (that is what makes it read as a recording rather than
 * a paste); `lines` are then printed with their authored pauses. Every event time is the running
 * total, because v2 times are absolute.
 *
 * Pure — returns the text, writes nothing, so the guard can call it without touching public/.
 */
export function buildCast(stage) {
  const events = [];
  let t = 0;
  const emit = (data) => events.push([round(t), "o", data]);

  emit(PROMPT);
  t += PROMPT_PAUSE;
  for (const char of stage.command) {
    emit(char);
    t += TYPE_DELAY;
  }
  // Where the poster parks: the command is fully typed but nothing has run yet, so the frame behind
  // the play button matches the poster the island server-renders.
  const posterAt = t;
  t += ENTER_PAUSE;
  emit("\r\n");

  for (const line of stage.lines) {
    t += line.delay;
    // \r\n, not \n: a terminal's \n moves down without returning to column 0, so a bare \n would
    // stair-step every line off the right edge.
    emit(`${line.text}\r\n`);
  }

  const header = {
    version: 2,
    // width/height — NOT cols/rows. See the header comment: the v2 parser reads these two names
    // only, and silently renders at its own default for anything else.
    width: WIDTH,
    height: castHeight(stage),
    title: `marvin ${stage.command}`,
    env: { TERM: "xterm-256color", SHELL: "/bin/zsh" },
  };

  // `t` now sits on the final event, which is exactly where the player ends: it takes the duration
  // from the last event time, so this is the number its own clock will report. That is what makes
  // the poster badge and `ap-time-remaining` agree.
  const text = `${[JSON.stringify(header), ...events.map((e) => JSON.stringify(e))].join("\n")}\n`;
  return { text, duration: round(t), poster: npt(posterAt) };
}

/** The commands the site advertises, by bare name — the AC7 lookup set. */
export function catalogCommandNames() {
  const catalog = JSON.parse(readFileSync(CATALOG_JSON, "utf8"));
  return new Set(catalog.commands.map((command) => command.name));
}

/**
 * Fail the build if a stage names a command the plugin does not have — a tour that demonstrates a
 * non-existent command is worse than no recording, because it looks authoritative. See the header
 * for why the source-scanning guard added by PR #144 does not cover these scripts.
 */
export function assertCommandsExist(stages = STAGES) {
  const known = catalogCommandNames();
  for (const stage of stages) {
    const name = stage.command.replace(/^\/marvin:/, "");
    if (!known.has(name)) {
      throw new Error(
        `[gen-casts] stage "${stage.key}" scripts "${stage.command}", which is not in the ` +
          `generated command catalog. A tour that demonstrates a non-existent command is worse ` +
          `than no recording. (Note: MCP tools such as \`verify\` are not prompts and are ` +
          `correctly absent — use the prompt that wraps them, e.g. /marvin:task-verify.)`,
      );
    }
  }
}

/**
 * Manifest rows for src/data/casts.json — pure, writes nothing. Durations are MEASURED from the
 * emitted cast rather than declared, so the number the page prints is always the number the
 * recording actually runs.
 */
export function buildManifest(stages = STAGES) {
  return stages.map((stage) => {
    const { duration, poster } = buildCast(stage);
    return {
      key: stage.key,
      command: stage.command,
      caption: stage.caption,
      file: `/casts/${stage.key}.cast`,
      duration,
      poster,
    };
  });
}

/** Serialization for the committed manifest — matches gen-catalog.mjs so Prettier stays out of it. */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// Run directly (`node scripts/gen-casts.mjs`) → write the assets. Imported (by the guard) → export
// only, so the test can rebuild every cast without writing into public/.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertCommandsExist();

  // Rebuild from scratch so a stage removed from STAGES cannot leave a stale recording behind.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  for (const stage of STAGES) {
    writeFileSync(join(OUT_DIR, `${stage.key}.cast`), buildCast(stage).text);
  }

  // The vendor stylesheet ships through public/ rather than through an import, because it is
  // structurally required (it absolutely positions every terminal row and span — without it the
  // terminal collapses to a point) and a module-level import would put 19 KB on every /pipeline
  // visit. Copying it here keeps it on the same lazy path as the player and gives it a stable,
  // unhashed URL. Same trick gen-widget-demos.mjs uses to ship the committed widget HTML.
  const require = createRequire(import.meta.url);
  copyFileSync(require.resolve(VENDOR_CSS_SPECIFIER), join(OUT_DIR, VENDOR_CSS_FILE));

  const manifest = buildManifest();
  writeFileSync(MANIFEST_JSON, serializeManifest(manifest));

  console.log(
    `[gen-casts] wrote ${relative(ROOT, OUT_DIR)} — ${STAGES.length} recordings ` +
      `(${manifest.map((m) => `${m.key} ${m.duration}s`).join(", ")}) + ${VENDOR_CSS_FILE}, ` +
      `and ${relative(ROOT, MANIFEST_JSON)}`,
  );
}
