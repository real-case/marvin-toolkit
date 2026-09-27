#!/usr/bin/env node
// Release notes for a `v*` tag, read from the plugin changelog.
//
// A release covers every version since the previous release tag, not only the
// tagged one: dev accumulates several changelog versions between promotions to
// `main`, and a body cut from the tagged section alone silently dropped the rest
// (v0.23.0 shipped one section of six, v0.28.0 one of four).
//
// The changelog links to repository files relative to itself (`../../docs/adr/…`).
// On a release page those resolve against `/releases/tag/`, so every such link is
// rewritten to an absolute blob URL pinned to the tag.
//
// Usage (release.yml):
//   node scripts/release-notes.mjs --tag v0.28.0 --repo owner/repo > notes.md
// Optional: --previous v0.24.0 (else resolved with `git describe`), --server URL.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CHANGELOG = "plugins/marvin/CHANGELOG.md";

const HEADING = /^## \[([^\]]+)\](.*)$/;
/** A link target that already names a scheme, an anchor or a site-absolute path. */
const NOT_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i;

/**
 * Split a Keep a Changelog document into `{ version, rest, body }` sections.
 * @param {string} text
 */
export function parseSections(text) {
  const sections = [];
  for (const line of text.split("\n")) {
    const m = HEADING.exec(line);
    if (m) sections.push({ version: m[1], rest: m[2], body: [] });
    else if (sections.length) sections.at(-1).body.push(line);
  }
  return sections;
}

/**
 * Rewrite relative markdown link targets to `blobBase/<repo path>`, resolving them
 * against the changelog's own directory. A target that leaves the repository is
 * left untouched rather than guessed at.
 * @param {string} text
 * @param {string} blobBase e.g. https://github.com/owner/repo/blob/v1.2.3
 */
export function absolutiseLinks(text, blobBase) {
  const from = posix.dirname(CHANGELOG);
  return text.replace(/\]\(([^)\s]+)\)/g, (whole, target) => {
    if (NOT_RELATIVE.test(target)) return whole;
    const resolved = posix.normalize(posix.join(from, target));
    if (resolved.startsWith("..")) return whole;
    return `](${blobBase}/${resolved})`;
  });
}

/**
 * The notes for `version`: its section and every older one down to, not including,
 * `previous`. When `previous` is absent, or is not a section below `version`, only
 * the tagged section is used — never the whole history. Returns null when the
 * changelog has no section for `version`.
 * @param {string} changelog
 * @param {{ version: string, previous?: string | null, blobBase: string }} opts
 */
export function releaseNotes(changelog, { version, previous, blobBase }) {
  const sections = parseSections(changelog);
  const start = sections.findIndex((s) => s.version === version);
  if (start === -1) return null;
  const stop = previous ? sections.findIndex((s) => s.version === previous) : -1;
  const end = stop > start ? stop : start + 1;
  const parts = sections.slice(start, end).map((s) => {
    const body = s.body.join("\n").trim();
    return `## ${s.version}${s.rest}\n\n${body}`;
  });
  return absolutiseLinks(parts.join("\n\n"), blobBase) + "\n";
}

/**
 * The release tag before `tag`. A stable tag skips prerelease tags, so a stable
 * release after release candidates covers everything since the last stable one.
 * @param {string} tag
 * @returns {string | null}
 */
export function previousTag(tag) {
  const args = ["describe", "--tags", "--abbrev=0", "--match", "v*"];
  if (!tag.includes("-")) args.push("--exclude", "v*-*");
  try {
    return execFileSync("git", [...args, `${tag}^`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null; // the first release tag has no predecessor
  }
}

function main(argv) {
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const tag = opt("tag");
  const repo = opt("repo");
  if (!tag || !repo) {
    process.stderr.write(
      "usage: release-notes.mjs --tag vX.Y.Z --repo owner/repo [--previous vA.B.C] [--server URL]\n",
    );
    process.exit(2);
  }
  const server = opt("server") ?? "https://github.com";
  const previous = opt("previous") ?? previousTag(tag);
  const changelog = readFileSync(join(repoRoot, CHANGELOG), "utf8");
  const notes = releaseNotes(changelog, {
    version: tag.replace(/^v/, ""),
    previous: previous?.replace(/^v/, "") ?? null,
    blobBase: `${server}/${repo}/blob/${tag}`,
  });
  process.stdout.write(
    notes ?? `See [${CHANGELOG}](${server}/${repo}/blob/${tag}/${CHANGELOG}) for details.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
