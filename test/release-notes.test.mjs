// Release notes span every changelog version since the previous release tag, with
// relative links made absolute. The synthetic changelog pins the range and link
// rules; the real changelog pins the one release this was written for (v0.28.0,
// whose first notes carried one section of four); the workflow is parsed to pin
// that it runs the script with the history the tag lookup needs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { CHANGELOG, absolutiseLinks, releaseNotes } from "../scripts/release-notes.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BLOB = "https://github.com/o/r/blob/v1.3.0";

const SAMPLE = `# Changelog

Intro text.

## [1.3.0] — 2026-01-03

Third ([ADR-0002](../../docs/adr/0002-x.md)).

## [1.2.0] — 2026-01-02

### Added

- Second, see [notes](./notes.md#top) and [site](https://example.com).

## [1.1.0] — 2026-01-01

First.

## [1.0.0] — 2025-12-31

Zero.
`;

const headings = (notes) => notes.split("\n").filter((l) => l.startsWith("## "));

test("covers every version since the previous one, newest first", () => {
  const notes = releaseNotes(SAMPLE, { version: "1.3.0", previous: "1.0.0", blobBase: BLOB });
  assert.deepEqual(headings(notes), [
    "## 1.3.0 — 2026-01-03",
    "## 1.2.0 — 2026-01-02",
    "## 1.1.0 — 2026-01-01",
  ]);
  assert.match(notes, /### Added/);
  assert.doesNotMatch(notes, /Zero|Intro/);
});

test("falls back to the tagged section alone, never the whole history", () => {
  for (const previous of [null, "0.9.0", "1.3.0"]) {
    const notes = releaseNotes(SAMPLE, { version: "1.2.0", previous, blobBase: BLOB });
    assert.deepEqual(headings(notes), ["## 1.2.0 — 2026-01-02"], `previous=${previous}`);
  }
});

test("returns null for a version the changelog does not have", () => {
  assert.equal(releaseNotes(SAMPLE, { version: "2.0.0", previous: "1.3.0", blobBase: BLOB }), null);
});

test("rewrites relative links against the changelog's directory", () => {
  const notes = releaseNotes(SAMPLE, { version: "1.3.0", previous: "1.1.0", blobBase: BLOB });
  assert.match(notes, /\(https:\/\/github\.com\/o\/r\/blob\/v1\.3\.0\/docs\/adr\/0002-x\.md\)/);
  assert.match(
    notes,
    /\(https:\/\/github\.com\/o\/r\/blob\/v1\.3\.0\/plugins\/marvin\/notes\.md#top\)/,
  );
  assert.match(notes, /\(https:\/\/example\.com\)/);
});

test("leaves anchors, absolute paths and targets outside the repository alone", () => {
  const text = "[a](#x) [b](/abs) [c](../../../outside.md) [d](mailto:a@b.c)";
  assert.equal(absolutiseLinks(text, BLOB), text);
});

test("the real changelog yields 0.25.0–0.28.0 for v0.28.0, with no relative links", () => {
  const changelog = readFileSync(join(repoRoot, CHANGELOG), "utf8");
  const notes = releaseNotes(changelog, {
    version: "0.28.0",
    previous: "0.24.0",
    blobBase: "https://github.com/real-case/marvin-toolkit/blob/v0.28.0",
  });
  assert.deepEqual(
    headings(notes).map((h) => h.split(" ")[1]),
    ["0.28.0", "0.27.0", "0.26.0", "0.25.0"],
  );
  assert.doesNotMatch(notes, /\]\(\.\.?\//);
});

test("release.yml runs the script with full history and publishes its output", () => {
  const doc = parse(readFileSync(join(repoRoot, ".github", "workflows", "release.yml"), "utf8"));
  const steps = doc.jobs.release.steps;
  const checkout = steps.find((s) => String(s.uses ?? "").startsWith("actions/checkout@"));
  assert.equal(
    checkout?.with?.["fetch-depth"],
    0,
    "the previous-tag lookup needs tags and history",
  );
  const build = steps.find((s) => String(s.run ?? "").includes("scripts/release-notes.mjs"));
  assert.ok(build, "no step runs scripts/release-notes.mjs");
  const out = /> "\$RUNNER_TEMP\/([^"]+)"/.exec(build.run)?.[1];
  const publish = steps.find((s) =>
    String(s.uses ?? "").startsWith("softprops/action-gh-release@"),
  );
  assert.equal(publish?.with?.body_path, `\${{ runner.temp }}/${out}`);
  assert.equal(publish?.with?.body, undefined);
});
