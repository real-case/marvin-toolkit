import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "server.js");

/**
 * Lessons v2 hygiene surface (ADR-0028): `stats`, `prune` (candidate listing,
 * confirmation-gated deletion, MEMORY.md index consistency), and the
 * near-duplicate guard on `add`. Same stdio-driven layout as lessons.test.mjs;
 * state persists on disk between calls, each call is a fresh server process.
 */

/**
 * Drive one `lessons` call against a temp project dir. By default the client
 * declares NO elicitation capability (the degradation paths). Pass
 * `elicitation: { delete: "yes" }` (or "no") to declare the capability and
 * auto-answer the confirmation form; `elicitation: "decline"` dismisses it.
 */
function callLessons(projectDir, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    });
    let buf = "";
    let initialized = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout; partial=${JSON.stringify(buf)}`));
    }, 15000);

    const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");

    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        // Server-initiated confirmation form → answer per the test scenario.
        if (msg.method === "elicitation/create" && msg.id != null) {
          send({
            jsonrpc: "2.0",
            id: msg.id,
            result:
              opts.elicitation === "decline"
                ? { action: "decline" }
                : { action: "accept", content: opts.elicitation },
          });
          continue;
        }
        if (msg.id === 1 && !initialized) {
          initialized = true;
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "lessons", arguments: args },
          });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          try {
            const text = msg.result.content.map((c) => c.text).join("\n");
            resolve({
              text,
              isError: !!msg.result.isError,
              structuredContent: msg.result.structuredContent,
            });
          } catch (err) {
            reject(err);
          }
        }
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", reject);

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: opts.elicitation !== undefined ? { elicitation: {} } : {},
        clientInfo: { name: "lessons-hygiene-test", version: "0" },
      },
    });
  });
}

function freshProject() {
  return mkdtempSync(join(tmpdir(), "marvin-lessons-hyg-"));
}

const memoryDir = (proj) => join(proj, ".marvin", "memory");

async function addLesson(proj, overrides = {}) {
  const res = await callLessons(proj, {
    action: "add",
    type: "gotcha",
    title: "Vitest needs --run in CI",
    body: "Without --run vitest stays in watch mode and the CI job hangs.",
    tags: "ci, vitest",
    ...overrides,
  });
  assert.equal(res.isError, false, res.text);
  return res;
}

/** Plant a lesson file by hand — the only way to control `created` (stale cases). */
function plantLesson(proj, slug, { title, type = "pitfall", created }) {
  mkdirSync(memoryDir(proj), { recursive: true });
  writeFileSync(
    join(memoryDir(proj), `${slug}.md`),
    [
      "---",
      `id: ${slug}`,
      `type: ${type}`,
      `title: ${title}`,
      `created: ${created}`,
      "source: manual",
      "---",
      "",
      "Planted body.",
      "",
    ].join("\n"),
  );
}

// ── stats ─────────────────────────────────────────────────────────────────────

// stats counts by type and tag, and mirrors the payload as structuredContent
// (the LessonsStats contract — the dashboard feed).
test("stats: counts by type and by tag with structuredContent", async () => {
  const proj = freshProject();
  try {
    await addLesson(proj);
    await addLesson(proj, {
      type: "bug-pattern",
      title: "Null user on expired session",
      body: "getUser() returns null after the JWT expires; guard the caller.",
      tags: "ci, auth",
    });

    const { text, isError, structuredContent } = await callLessons(proj, { action: "stats" });
    assert.equal(isError, false, text);
    assert.match(text, /2 lesson\(s\)/);
    assert.match(text, /`gotcha` — 1/);
    assert.match(text, /`bug-pattern` — 1/);
    assert.match(text, /ci — 2/);

    assert.equal(structuredContent.total, 2);
    assert.equal(structuredContent.by_type.gotcha, 1);
    assert.equal(structuredContent.by_type["bug-pattern"], 1);
    // The closed taxonomy is present per key even at 0 (ADR-0026 doctrine).
    assert.equal(structuredContent.by_type.process, 0);
    assert.equal(structuredContent.by_tag.ci, 2);
    assert.equal(structuredContent.by_tag.vitest, 1);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// stats on an empty store degrades to zeros rather than erroring.
test("stats: empty store reports zero without error", async () => {
  const proj = freshProject();
  try {
    const { text, isError, structuredContent } = await callLessons(proj, { action: "stats" });
    assert.equal(isError, false, text);
    assert.match(text, /No lessons captured yet/);
    assert.equal(structuredContent.total, 0);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── add: near-duplicate guard ────────────────────────────────────────────────

// A close title match warns, names the existing slug, and writes nothing.
test("add: near-duplicate title warns instead of writing", async () => {
  const proj = freshProject();
  try {
    await addLesson(proj);
    const dup = await callLessons(proj, {
      action: "add",
      type: "gotcha",
      title: "Vitest requires --run in CI jobs",
      body: "A second write attempt for the same underlying lesson.",
    });
    assert.equal(dup.isError, true, "near-duplicate add should refuse");
    assert.match(dup.text, /Near-duplicate/);
    assert.match(dup.text, /vitest-needs-run-in-ci/, "warning names the existing slug");
    assert.match(dup.text, /force: true/);
    assert.ok(!existsSync(join(memoryDir(proj), "vitest-requires-run-in-ci-jobs.md")));

    const { structuredContent } = await callLessons(proj, { action: "stats" });
    assert.equal(structuredContent.total, 1, "store still holds exactly one lesson");
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// `force: true` is the deliberate override — the write happens.
test("add: force overrides the near-duplicate guard", async () => {
  const proj = freshProject();
  try {
    await addLesson(proj);
    const forced = await callLessons(proj, {
      action: "add",
      type: "gotcha",
      title: "Vitest requires --run in CI jobs",
      body: "Deliberately captured as its own lesson.",
      force: true,
    });
    assert.equal(forced.isError, false, forced.text);
    assert.match(forced.text, /Captured lesson/);
    assert.ok(existsSync(join(memoryDir(proj), "vitest-requires-run-in-ci-jobs.md")));

    const { structuredContent } = await callLessons(proj, { action: "stats" });
    assert.equal(structuredContent.total, 2);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── prune: candidate listing ─────────────────────────────────────────────────

// With no slug, prune only LISTS: stale lessons and near-duplicate pairs.
test("prune: lists stale and duplicate candidates, deletes nothing", async () => {
  const proj = freshProject();
  try {
    plantLesson(proj, "ancient-build-cache-wisdom", {
      title: "Ancient wisdom about the build cache",
      created: "2020-01-01",
    });
    await addLesson(proj);
    await addLesson(proj, {
      title: "Vitest requires --run in CI jobs",
      body: "Near-copy planted via force.",
      force: true,
    });

    const { text, isError } = await callLessons(proj, { action: "prune" });
    assert.equal(isError, false, text);
    assert.match(text, /Stale/);
    assert.match(text, /ancient-build-cache-wisdom/);
    assert.match(text, /duplicates/i);
    assert.match(text, /vitest-needs-run-in-ci.*vitest-requires-run-in-ci-jobs/);
    // Listing is read-only — everything still on disk.
    assert.ok(existsSync(join(memoryDir(proj), "ancient-build-cache-wisdom.md")));
    assert.ok(existsSync(join(memoryDir(proj), "vitest-needs-run-in-ci.md")));
    assert.ok(existsSync(join(memoryDir(proj), "vitest-requires-run-in-ci-jobs.md")));
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// A healthy store answers "no candidates" rather than inventing work.
test("prune: healthy store reports no candidates", async () => {
  const proj = freshProject();
  try {
    await addLesson(proj);
    const { text, isError } = await callLessons(proj, { action: "prune" });
    assert.equal(isError, false, text);
    assert.match(text, /No prune candidates/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── prune: confirmation-gated deletion ───────────────────────────────────────

// Without elicitation support and without `confirm`, deletion refuses with an
// instructive error and nothing is removed (the canElicit degradation).
test("prune: delete on a form-less host requires confirm: true", async () => {
  const proj = freshProject();
  try {
    await addLesson(proj);
    const { text, isError } = await callLessons(proj, {
      action: "prune",
      slug: "vitest-needs-run-in-ci",
    });
    assert.equal(isError, true, "unconfirmed delete should refuse");
    assert.match(text, /confirm: true/);
    assert.ok(existsSync(join(memoryDir(proj), "vitest-needs-run-in-ci.md")), "file untouched");
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// `confirm: true` deletes the file AND its MEMORY.md index line; the other
// lesson's line and the index header survive.
test("prune: confirmed delete keeps MEMORY.md consistent", async () => {
  const proj = freshProject();
  try {
    await addLesson(proj);
    await addLesson(proj, {
      type: "process",
      title: "Release notes want a changelog roll-up",
      body: "Cut release notes from the CHANGELOG, not from git log.",
      tags: "release",
    });

    const { text, isError } = await callLessons(proj, {
      action: "prune",
      slug: "vitest-needs-run-in-ci",
      confirm: true,
    });
    assert.equal(isError, false, text);
    assert.match(text, /Deleted lesson \*\*vitest-needs-run-in-ci\*\*/);
    assert.ok(!existsSync(join(memoryDir(proj), "vitest-needs-run-in-ci.md")), "file removed");

    const index = readFileSync(join(memoryDir(proj), "MEMORY.md"), "utf8");
    assert.ok(!index.includes("vitest-needs-run-in-ci.md"), "index line removed");
    assert.match(index, /release-notes-want-a-changelog-roll-up\.md/, "other line survives");
    assert.match(index, /# Marvin lessons/, "index header survives");
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// On an elicitation-capable host the confirmation is a form: accepting "yes"
// deletes, answering "no" cancels.
test("prune: elicited confirmation gates the deletion", async () => {
  const proj = freshProject();
  try {
    await addLesson(proj);

    const kept = await callLessons(
      proj,
      { action: "prune", slug: "vitest-needs-run-in-ci" },
      { elicitation: { delete: "no" } },
    );
    assert.equal(kept.isError, false, kept.text);
    assert.match(kept.text, /Cancelled/);
    assert.ok(existsSync(join(memoryDir(proj), "vitest-needs-run-in-ci.md")), "no answered → kept");

    const gone = await callLessons(
      proj,
      { action: "prune", slug: "vitest-needs-run-in-ci" },
      { elicitation: { delete: "yes" } },
    );
    assert.equal(gone.isError, false, gone.text);
    assert.match(gone.text, /Deleted lesson/);
    assert.ok(!existsSync(join(memoryDir(proj), "vitest-needs-run-in-ci.md")), "yes → deleted");
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// An unknown slug is an instructive error, pointing back at the candidate list.
test("prune: unknown slug fails with a pointer to the list", async () => {
  const proj = freshProject();
  try {
    await addLesson(proj);
    const { text, isError } = await callLessons(proj, {
      action: "prune",
      slug: "no-such-lesson",
      confirm: true,
    });
    assert.equal(isError, true, "unknown slug should error");
    assert.match(text, /No lesson with slug/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});
