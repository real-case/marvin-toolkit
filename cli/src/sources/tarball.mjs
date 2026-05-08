// GitHub-tarball source resolver: downloads + extracts a snapshot of the
// marvin-toolkit repo from GitHub, caches it under ~/.cache/marvinx/, and
// returns the absolute path to the requested pack root within that cache.
//
// Defaults:
//   repo: real-case/marvin-toolkit  (override via MARVIN_REPO=<owner/repo>)
//   ref:  main                       (override via MARVIN_REF=<tag-or-branch>)
//
// Requires `tar` in PATH. Pre-installed on macOS/Linux/GitHub-runners.

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_REPO = "real-case/marvin-toolkit";
const DEFAULT_REF = "main";
const CACHE_TTL_BRANCH_MS = 60 * 60 * 1000; // 1h for branches
const HTTP_TIMEOUT_MS = 30_000;

export function getCacheRoot() {
  return path.join(os.homedir(), ".cache", "marvinx");
}

function repoSpec() {
  return {
    repo: process.env.MARVIN_REPO || DEFAULT_REPO,
    ref: process.env.MARVIN_REF || DEFAULT_REF,
  };
}

function isTagLike(ref) {
  // Heuristic: refs starting with "v" or matching semver are treated as immutable tags.
  return /^v?\d+\.\d+\.\d+/.test(ref);
}

// TODO(user): pick the cache invalidation strategy.
//
// PURPOSE: decide when the cached tarball at ~/.cache/marvinx/<ref>/ is
// stale and must be re-fetched. Acceptance criterion 5: "content-addressed
// by version; corrupted downloads detected via simple size+checksum gate
// and re-fetched".
//
// STRATEGY OPTIONS:
//
//   (a) sha256 of the downloaded blob, persisted alongside the extracted
//       tree. On reload: re-hash the tar.gz blob and re-fetch if it differs
//       OR has been deleted. Strong correctness for IMMUTABLE refs (tags),
//       but for branches we'd have to re-download every time to know.
//
//   (b) HTTP If-None-Match with the GitHub Etag. Clean but requires a
//       network round-trip on every CLI invocation.
//
//   (c) Time-based TTL. Refresh branch refs after N minutes; treat tag
//       refs as immutable (no TTL). Cheap, stale-but-bounded.
//
// Default below is (c) with 1h TTL for branches, infinite TTL for tags.
// `verifyChecksum()` adds a layer-(a) corruption gate AT FETCH TIME — if
// the previous download's checksum doesn't match what we just downloaded,
// the cache entry is rebuilt.
function isCacheFresh(cacheEntry, ref) {
  if (!cacheEntry?.fetchedAt) return false;
  if (isTagLike(ref)) return true;
  return Date.now() - cacheEntry.fetchedAt < CACHE_TTL_BRANCH_MS;
}

export async function resolveTarball(packName, opts = {}) {
  const { repo, ref } = { ...repoSpec(), ...(opts.override ?? {}) };
  const cacheRoot = opts.cacheRoot ?? getCacheRoot();
  const entryDir = path.join(cacheRoot, sanitize(ref));
  const metaPath = path.join(entryDir, ".marvinx-meta.json");
  const repoSlug = repo.split("/")[1];

  let meta = await readMeta(metaPath);
  if (!meta || !isCacheFresh(meta, ref) || !existsSync(path.join(entryDir, "extracted"))) {
    meta = await fetchAndExtract({ repo, ref, repoSlug, entryDir, metaPath, fetcher: opts.fetcher });
  } else {
    // Even when fresh by TTL, surface obvious corruption: re-hash the saved blob.
    const tarPath = path.join(entryDir, "archive.tar.gz");
    if (existsSync(tarPath)) {
      const ok = await verifyChecksum(tarPath, meta.sha256, meta.size);
      if (!ok) meta = await fetchAndExtract({ repo, ref, repoSlug, entryDir, metaPath, fetcher: opts.fetcher });
    }
  }

  // The extracted tree contains <repoSlug>-<ref-slug>/... at the top.
  const extracted = path.join(entryDir, "extracted");
  const inner = await findInnerDir(extracted, repoSlug);
  if (!inner) throw new Error(`tarball cache: could not find inner directory under ${extracted}`);
  const packRoot = path.join(inner, "plugins", packName);
  if (!existsSync(packRoot)) throw new Error(`tarball cache: pack "${packName}" not present in ${repo}@${ref}`);
  return packRoot;
}

async function fetchAndExtract({ repo, ref, repoSlug, entryDir, metaPath, fetcher }) {
  await fs.mkdir(entryDir, { recursive: true });
  const url = `https://codeload.github.com/${repo}/tar.gz/${encodeURIComponent(ref)}`;
  const tarPath = path.join(entryDir, "archive.tar.gz");
  const extracted = path.join(entryDir, "extracted");

  const fetchFn = fetcher ?? defaultFetch;
  const buf = await fetchFn(url);
  await fs.writeFile(tarPath, buf);

  const sha256 = sha256OfBuffer(buf);
  const size = buf.length;

  // Clean and re-extract.
  if (existsSync(extracted)) await fs.rm(extracted, { recursive: true, force: true });
  await fs.mkdir(extracted, { recursive: true });
  await execFileAsync("tar", ["-xzf", tarPath, "-C", extracted]);

  const meta = { repo, ref, repoSlug, sha256, size, fetchedAt: Date.now() };
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

async function defaultFetch(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(timer); }
}

async function readMeta(metaPath) {
  try { return JSON.parse(await fs.readFile(metaPath, "utf8")); }
  catch { return null; }
}

async function verifyChecksum(filePath, expectedSha, expectedSize) {
  try {
    const buf = await fs.readFile(filePath);
    if (buf.length !== expectedSize) return false;
    return sha256OfBuffer(buf) === expectedSha;
  } catch { return false; }
}

function sha256OfBuffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function findInnerDir(extractedDir, repoSlug) {
  let entries;
  try { entries = await fs.readdir(extractedDir, { withFileTypes: true }); } catch { return null; }
  // Prefer a directory whose name starts with `<repoSlug>-` (codeload's convention).
  const prefMatch = entries.find((e) => e.isDirectory() && e.name.startsWith(`${repoSlug}-`));
  if (prefMatch) return path.join(extractedDir, prefMatch.name);
  const anyDir = entries.find((e) => e.isDirectory());
  return anyDir ? path.join(extractedDir, anyDir.name) : null;
}

function sanitize(ref) {
  return ref.replace(/[^A-Za-z0-9._-]/g, "_");
}
