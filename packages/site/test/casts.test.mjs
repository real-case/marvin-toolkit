// casts.test.mjs (spec 012-website-terminal-recordings, F13) — the recording guard (AC1, AC7).
//
// Mirrors catalog.test.mjs / widget-demos.test.mjs: node:test, assert/strict, and the generator's
// PURE exports rather than its output directory — public/casts/ is a git-ignored build output that
// may not exist in a fresh clone, so asserting against it would make the suite depend on build
// order. Runs browser-free on both CI Node legs.
//
// WHAT THIS PINS, and why each assertion is shaped the way it is. Every check below mirrors a
// SILENT failure mode of asciinema-player@3.17.0 — one where a malformed cast produces a broken
// recording with no error and every other gate green:
//
//   * `parseJsonl` keeps event lines with `l[0] === "["` and SILENTLY DROPS everything else. An
//     indented event line therefore yields an empty recording and a blank terminal. This file
//     replicates that exact predicate rather than a looser "is it JSON" parse, because a looser
//     check passes on precisely the input the player discards.
//   * `parseAsciicastV2` reads `header.width` / `header.height` — NOT cols/rows. A cols/rows header
//     does not throw; it renders at the player's own default geometry.
//   * It guards those two with `header.width === 0 ? DEFAULT : header.width`, so a `0` survives a
//     "is it numeric" test and silently becomes the default geometry. (`NaN` survives that test
//     too but does NOT default — `NaN === 0` is false, so it propagates and the player's own size
//     validation throws. Loud, but still not a value any header should carry.) Hence the assertion
//     is "an integer greater than zero", which excludes both.
//   * v2 event times are ABSOLUTE (`e[0] * 1000`, no accumulation — v3 is the one that accumulates),
//     so a delta-encoded cast plays at the wrong pace rather than failing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STAGES,
  HERO,
  RECORDINGS,
  WIDTH,
  castHeight,
  buildCast,
  buildManifest,
  serializeManifest,
  assertCommandsExist,
  catalogCommandNames,
} from "../scripts/gen-casts.mjs";

const here = import.meta.dirname;
const MANIFEST_JSON = join(here, "..", "src", "data", "casts.json");

/**
 * Strip SGR sequences so an authored line can be measured as the terminal will lay it out.
 *
 * Composed with `new RegExp` rather than written as a literal: ESLint's `no-control-regex`
 * rejects a control escape inside a regex literal even when it is exactly what you mean, and
 * silencing the rule with a disable comment would be worse than building the pattern.
 */
const ANSI_SGR = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");
const stripAnsi = (text) => text.replace(ANSI_SGR, "");

/**
 * Every invariant a recording must satisfy — shared by the four pipeline stages and the Home hero, so
 * "the hero asserts the SAME invariants the stages do" is literal rather than a copy-paste. Each
 * assertion below mirrors one of asciinema-player@3.17.0's silent-failure modes (see the file header).
 */
function assertParseableCast(recording) {
  const { text, duration } = buildCast(recording);
  const label = `recording "${recording.key}"`;

  const lines = text.split("\n");

  // ---- header ----------------------------------------------------------------
  const header = JSON.parse(lines[0]);
  assert.equal(header.version, 2, `${label}: header must declare asciicast version 2`);

  for (const key of ["width", "height"]) {
    assert.ok(
      Number.isInteger(header[key]) && header[key] > 0,
      `${label}: header.${key} must be an integer greater than zero (got ${header[key]}) — ` +
        `0 and NaN both pass a "numeric" test and both silently fall back to the player default`,
    );
  }
  assert.equal(header.width, WIDTH, `${label}: header.width must be the authored geometry`);
  assert.equal(
    header.height,
    castHeight(recording),
    `${label}: header.height must be this recording's own row count`,
  );

  // The whole point of the two assertions above: v2 keys geometry as width/height, and a
  // cols/rows header is accepted, ignored, and rendered at 80x24 with no error anywhere.
  assert.ok(
    !("cols" in header) && !("rows" in header),
    `${label}: header must NOT carry cols/rows — the v2 parser reads width/height only, so a ` +
      `cols/rows header ships a working-but-wrong-geometry recording`,
  );

  // ---- event lines: the player's own predicate, verbatim ----------------------
  const body = lines.slice(1).filter((line) => line !== "");
  assert.ok(body.length > 0, `${label}: a recording with no events renders a blank terminal`);

  for (const [index, line] of body.entries()) {
    assert.equal(
      line[0],
      "[",
      `${label}: event line ${index} must begin with "[" at index 0 — the parser filters on ` +
        `exactly this and DISCARDS anything else, so a stray indent yields an empty recording`,
    );
  }

  // ---- events: shape and absolute, non-decreasing times -----------------------
  const events = body.map((line) => JSON.parse(line));
  let previous = -1;

  for (const [index, event] of events.entries()) {
    assert.ok(
      Array.isArray(event) && event.length === 3,
      `${label}: event ${index} must be a triple`,
    );
    const [time, code, data] = event;
    assert.equal(typeof time, "number", `${label}: event ${index} time must be a number`);
    assert.ok(Number.isFinite(time), `${label}: event ${index} time must be finite`);
    assert.equal(code, "o", `${label}: event ${index} must be an output event`);
    assert.equal(typeof data, "string", `${label}: event ${index} data must be a string`);
    assert.ok(
      time >= previous,
      `${label}: event ${index} time ${time} is before its predecessor ${previous} — v2 times ` +
        `are ABSOLUTE, so a delta-encoded cast plays at the wrong pace instead of failing`,
    );
    previous = time;
  }

  // ---- duration ---------------------------------------------------------------
  assert.ok(duration > 0, `${label}: duration must be greater than zero (got ${duration})`);

  // EXACT, not ">=". The player takes a recording's duration from its last event
  // (`const duration = events[events.length - 1][0]`), so any padding after the final event is
  // invisible to playback and makes the poster badge disagree with the player's own
  // `ap-time-remaining`. A ">=" assertion here passed happily against a 1.4s trailing hold that
  // overstated every stage by up to 19%.
  assert.equal(
    duration,
    previous,
    `${label}: duration must equal the last event time (${previous}) — the player derives ` +
      `duration from the final event, so trailing padding only desynchronises the badge`,
  );

  // ---- the recording actually contains its command -----------------------------
  // The drift detector. Without this the builder could emit a structurally perfect cast of nothing
  // at all and every assertion so far would still pass.
  const rendered = stripAnsi(events.map(([, , data]) => data).join(""));
  assert.ok(
    rendered.includes(recording.command),
    `${label}: the recorded output must contain the command it claims to run (${recording.command})`,
  );
}

test("emits a parseable asciicast v2 per stage", () => {
  assert.ok(STAGES.length > 0, "there must be at least one stage to record");
  for (const stage of STAGES) assertParseableCast(stage);
});

test("emits a parseable asciicast v2 for the hero recording", () => {
  assertParseableCast(HERO);
});

test("every scripted command exists in the generated catalog", () => {
  const known = catalogCommandNames();

  // The guard the build actually runs.
  assert.doesNotThrow(
    () => assertCommandsExist(),
    "the authored stages must all name real commands",
  );

  for (const recording of RECORDINGS) {
    const name = recording.command.replace(/^\/marvin:/, "");
    assert.ok(
      known.has(name),
      `recording "${recording.key}" scripts "${recording.command}", not in the generated catalog`,
    );
  }

  // Negative control — without it this test passes just as happily against a guard that never
  // rejects anything. `verify` is the realistic case: an MCP tool with no prompt entry, absent from
  // the catalog, and the exact string the site shipped on two pages until PR #144 caught it. That
  // fix guards .astro/.tsx sources under src/; this guards the cast scripts, which it cannot reach.
  assert.ok(
    !known.has("verify"),
    "`verify` is a tool, not a prompt — it must not be in the catalog",
  );
  assert.throws(
    () =>
      assertCommandsExist([{ key: "bogus", command: "/marvin:verify", caption: "", lines: [] }]),
    /not in the generated command catalog/,
    "a stage naming a non-existent command must fail the build, not ship",
  );
});

test("the committed manifest matches the emitted recordings", () => {
  const manifest = buildManifest();

  assert.deepEqual(
    manifest.map((row) => row.key),
    RECORDINGS.map((recording) => recording.key),
    "the manifest must carry exactly the authored recordings (four stages + the hero), in order",
  );

  for (const row of manifest) {
    const stage = RECORDINGS.find((candidate) => candidate.key === row.key);
    const { duration } = buildCast(stage);
    assert.equal(row.command, stage.command, `${row.key}: manifest command must match the stage`);
    assert.equal(row.caption, stage.caption, `${row.key}: manifest caption must match the stage`);
    assert.equal(row.file, `/casts/${row.key}.cast`, `${row.key}: manifest file path`);
    // MEASURED, not declared — this is what stops the page printing a duration the recording does
    // not actually run, the drift the hand-typed 0:42 / 1:18 / 0:55 / 0:38 had already accumulated.
    assert.equal(row.duration, duration, `${row.key}: manifest duration must be the measured one`);

    // The poster frame must land in the window between the command's newline and the first line of
    // output, so the frame behind the play button shows the finished command and nothing more.
    // A shape-only /^npt:\d+:\d{2}$/ check is not enough: every stage rounds to the same value, so
    // a generator that always emitted npt:0:00 — parking the poster on an empty screen — would
    // satisfy it. This pins the actual instant.
    assert.match(row.poster, /^npt:\d+:\d{2}$/, `${row.key}: poster must be an npt timestamp`);

    const events = buildCast(stage)
      .text.split("\n")
      .slice(1)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const newlineAt = events.find(([, , data]) => data === "\r\n")[0];
    const firstOutputAt = events[events.findIndex(([, , data]) => data === "\r\n") + 1][0];
    const [, minutes, seconds] = row.poster.match(/^npt:(\d+):(\d{2})$/);
    const posterAt = Number(minutes) * 60 + Number(seconds);

    assert.ok(
      posterAt >= newlineAt,
      `${row.key}: poster at ${posterAt}s lands mid-typing (the command finishes at ${newlineAt}s)`,
    );
    assert.ok(
      posterAt < firstOutputAt,
      `${row.key}: poster at ${posterAt}s already shows output (first line at ${firstOutputAt}s)`,
    );
  }

  // Freshness, exactly as catalog.test.mjs pins catalog.json: the committed file must be what the
  // generator emits today, or the page renders stale data that no other gate would notice.
  assert.equal(
    readFileSync(MANIFEST_JSON, "utf8"),
    serializeManifest(manifest),
    "src/data/casts.json is stale — run `npm run gen:casts -w @marvin-toolkit/site` and commit it",
  );
});

test("authored lines fit the terminal geometry", () => {
  // `fit: "width"` scales the font so the whole grid fits its container, so the column count is a
  // legibility budget on a 360px phone, not just a layout detail. A line wider than the grid wraps
  // and silently breaks the composition the stage was authored for.
  for (const stage of RECORDINGS) {
    for (const [index, line] of stage.lines.entries()) {
      const visible = stripAnsi(line.text);
      assert.ok(
        visible.length <= WIDTH,
        `stage "${stage.key}" line ${index} is ${visible.length} cells wide, over the ${WIDTH}-column ` +
          `grid: ${JSON.stringify(visible)}`,
      );
    }

    // The prompt and the typed command share a line, so they are budgeted together.
    const promptLine = `> ${stage.command}`;
    assert.ok(
      promptLine.length <= WIDTH,
      `stage "${stage.key}" command line is ${promptLine.length} cells wide, over ${WIDTH}`,
    );

    // Rows matter for a subtler reason than columns. The command line plus every output line must
    // fit the grid, or the terminal scrolls and the command disappears off the top once playback
    // finishes — turning the e2e's "the terminal shows this stage's command" into a test that
    // passes mid-typing and fails at the end.
    //
    // Honest about its own strength: castHeight() derives from lines.length, so for authored
    // content this holds by construction and no content edit can break it. What it actually
    // guards is castHeight itself — replacing it with a fixed constant, the way an earlier draft
    // of this generator had it, fails here.
    const rows = 1 + stage.lines.length;
    assert.ok(
      rows <= castHeight(stage),
      `stage "${stage.key}" needs ${rows} rows but its grid is ${castHeight(stage)} — it will ` +
        `scroll the command line off the top mid-playback`,
    );
  }
});

test("the hero recording is distinct from every pipeline stage", () => {
  // The reason this variant records /marvin:task-start rather than the hero's old /marvin:task-verify
  // (which duplicated pipeline stage 3): the hero must be its own cut, not a replay of stage 1, which
  // demos the same command. Three floors, weakest to strongest — the last is the one that matters.

  // 1. Byte-distinct casts — the trivial floor a single changed character satisfies.
  const heroText = buildCast(HERO).text;
  for (const stage of STAGES) {
    assert.notEqual(
      heroText,
      buildCast(stage).text,
      `the hero cast must not be byte-identical to stage "${stage.key}"`,
    );
  }

  // 2. The hero's distinctive ask appears only in the hero — nowhere in the four stages.
  const renderedOf = (recording) =>
    stripAnsi(
      buildCast(recording)
        .text.split("\n")
        .slice(1)
        .filter(Boolean)
        .map((line) => JSON.parse(line)[2])
        .join(""),
    );
  const ASK = "add rate limiting";
  assert.ok(renderedOf(HERO).includes(ASK), `the hero recording must contain its ask ("${ASK}")`);
  for (const stage of STAGES) {
    assert.ok(
      !renderedOf(stage).includes(ASK),
      `stage "${stage.key}" must not contain the hero's ask — it is what makes the hero its own cut`,
    );
  }

  // 3. A MAJORITY of the hero's non-empty output lines appear in no stage, so the hero cannot be
  // mostly a copy of stage 1 with a single line changed — the failure the byte check alone admits.
  const norm = (line) => stripAnsi(line.text).trim();
  const stageLines = new Set(STAGES.flatMap((stage) => stage.lines.map(norm)).filter(Boolean));
  const heroLines = HERO.lines.map(norm).filter(Boolean);
  const unique = heroLines.filter((line) => !stageLines.has(line));
  assert.ok(
    unique.length * 2 > heroLines.length,
    `the hero must be mostly its own content — only ${unique.length}/${heroLines.length} output ` +
      `lines are unique to it (a majority must be)`,
  );
});
