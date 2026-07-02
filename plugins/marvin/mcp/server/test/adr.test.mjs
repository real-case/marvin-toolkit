import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, "..", "dist", "server.js");

/**
 * Drive the live stdio server with CLAUDE_PROJECT_DIR pointed at a temp
 * project, call one tool, and return `{ text, isError, structured }`.
 */
function callTool(projectDir, name, args) {
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
        if (msg.id === 1 && !initialized) {
          initialized = true;
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          try {
            resolve({
              text: msg.result.content.map((c) => c.text).join("\n"),
              isError: !!msg.result.isError,
              structured: msg.result.structuredContent,
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
        capabilities: {},
        clientInfo: { name: "adr-test", version: "0" },
      },
    });
  });
}

const callAdr = (proj, args) => callTool(proj, "adr", args);

function freshProject() {
  return mkdtempSync(join(tmpdir(), "marvin-adr-"));
}

const id4 = (n) => String(n).padStart(4, "0");
const TODAY = new Date().toISOString().slice(0, 10);

/** marvin's own table-style header. */
function tableAdr({
  number,
  title,
  status = "**Proposed**",
  date = "2026-07-01",
  supersedes = "—",
  supersededBy = "—",
  sections,
}) {
  return [
    `# ADR ${id4(number)} — ${title}`,
    "",
    "| Field         | Value |",
    "| ------------- | ----- |",
    `| Status        | ${status} |`,
    `| Date          | ${date} |`,
    `| Supersedes    | ${supersedes} |`,
    `| Superseded by | ${supersededBy} |`,
    "",
    sections ??
      [
        "## Context",
        "",
        "Why.",
        "",
        "## Decision",
        "",
        "What.",
        "",
        "## Consequences",
        "",
        "So.",
      ].join("\n"),
    "",
  ].join("\n");
}

/** MADR/Nygard heading style — what the adr skill emits on foreign projects. */
function headingAdr({ number, title, status = "Proposed", date = "2026-07-01", sections }) {
  return [
    `# ADR-${id4(number)}: ${title}`,
    "",
    "## Status",
    "",
    status,
    "",
    "## Date",
    "",
    date,
    "",
    sections ??
      [
        "## Context",
        "",
        "Why.",
        "",
        "## Decision",
        "",
        "What.",
        "",
        "## Consequences",
        "",
        "So.",
      ].join("\n"),
    "",
  ].join("\n");
}

function seed(proj, filename, content, dir = "docs/adr") {
  const abs = join(proj, dir);
  mkdirSync(abs, { recursive: true });
  writeFileSync(join(abs, filename), content);
}

function writeConfig(proj, config) {
  mkdirSync(join(proj, ".marvin"), { recursive: true });
  writeFileSync(join(proj, ".marvin", "config.json"), JSON.stringify(config, null, 2) + "\n");
}

// ── corpus resolution ──────────────────────────────────────────────────────

test("resolution: empty project defaults to docs/adr, next number is 0001", async () => {
  const proj = freshProject();
  try {
    const { text, isError, structured } = await callAdr(proj, { action: "next" });
    assert.equal(isError, false, text);
    assert.match(text, /docs\/adr/);
    assert.match(text, /default/);
    assert.equal(structured.number, 1);
    assert.equal(structured.id, "0001");
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("resolution: an existing docs/decisions/ corpus is detected", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-first.md", tableAdr({ number: 1, title: "First" }), "docs/decisions");
    const { text, structured } = await callAdr(proj, { action: "list" });
    assert.match(text, /docs\/decisions/);
    assert.match(text, /detected/);
    assert.equal(structured.dir, "docs/decisions");
    assert.equal(structured.records.length, 1);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("resolution: config adr.dir wins over detection", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-detected.md", tableAdr({ number: 1, title: "Detected" }), "docs/adr");
    seed(proj, "0001-configured.md", tableAdr({ number: 1, title: "Configured" }), "records");
    writeConfig(proj, { adr: { dir: "records" } });
    const { structured } = await callAdr(proj, { action: "list" });
    assert.equal(structured.dir, "records");
    assert.equal(structured.records[0].title, "Configured");
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("resolution: a malformed adr config block degrades to defaults with a warning", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-first.md", tableAdr({ number: 1, title: "First" }));
    writeConfig(proj, { adr: { dir: 123 } });
    const { text, isError, structured } = await callAdr(proj, { action: "list" });
    assert.equal(isError, false, text);
    assert.match(text, /using default ADR configuration/);
    assert.equal(structured.dir, "docs/adr");
    assert.equal(structured.records.length, 1);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── parsing, both header styles ────────────────────────────────────────────

test("parse: table-style header yields the full record shape", async () => {
  const proj = freshProject();
  try {
    seed(
      proj,
      "0002-table-record.md",
      tableAdr({
        number: 2,
        title: "Table record",
        status: "**Accepted** (solo maintainer sign-off)",
        date: "2026-06-15",
        supersedes: "[ADR-0001](0001-old.md)",
      }),
    );
    seed(
      proj,
      "0001-old.md",
      tableAdr({
        number: 1,
        title: "Old",
        status: "**Superseded** by [ADR-0002](0002-table-record.md)",
        supersededBy: "[ADR-0002](0002-table-record.md)",
      }),
    );
    const { structured } = await callAdr(proj, { action: "list" });
    const [oldRec, rec] = structured.records;
    assert.deepEqual(rec, {
      number: 2,
      slug: "table-record",
      title: "Table record",
      status: "accepted",
      date: "2026-06-15",
      supersedes: [1],
      superseded_by: [],
      path: "docs/adr/0002-table-record.md",
    });
    assert.equal(oldRec.status, "superseded");
    assert.deepEqual(oldRec.superseded_by, [2]);
    assert.equal(structured.counts.accepted, 1);
    assert.equal(structured.counts.superseded, 1);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("parse: heading-style header (MADR/Nygard) yields the same shape", async () => {
  const proj = freshProject();
  try {
    seed(
      proj,
      "0001-heading-old.md",
      headingAdr({
        number: 1,
        title: "Heading old",
        status: "Superseded by [ADR-0002](0002-heading-new.md)",
        date: "2026-06-10",
      }),
    );
    seed(
      proj,
      "0002-heading-new.md",
      headingAdr({
        number: 2,
        title: "Heading new",
        status: "Accepted\n\nSupersedes [ADR-0001](0001-heading-old.md)",
      }),
    );
    const { structured } = await callAdr(proj, { action: "list" });
    const [oldRec, newRec] = structured.records;
    assert.equal(oldRec.status, "superseded");
    assert.equal(oldRec.date, "2026-06-10");
    assert.deepEqual(oldRec.superseded_by, [2]);
    assert.equal(newRec.status, "accepted");
    assert.deepEqual(newRec.supersedes, [1]);
    assert.equal(newRec.title, "Heading new");
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("parse: unparseable files surface as malformed without sinking the corpus", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-good.md", tableAdr({ number: 1, title: "Good" }));
    seed(proj, "0002-no-status.md", "# ADR 0002 — No status\n\n## Context\n\nProse only.\n");
    seed(
      proj,
      "0003-bad-status.md",
      tableAdr({ number: 3, title: "Bad status", status: "**Draft**" }),
    );
    seed(proj, "README.md", "# Not a record — skipped silently\n");
    const { text, isError, structured } = await callAdr(proj, { action: "list" });
    assert.equal(isError, false, text);
    assert.equal(structured.records.length, 1);
    assert.equal(structured.malformed.length, 2);
    const reasons = structured.malformed.map((m) => m.reason).join(" | ");
    assert.match(reasons, /no status header/);
    assert.match(reasons, /not in the vocabulary/);
    assert.match(text, /2 file\(s\) could not be parsed/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── next ───────────────────────────────────────────────────────────────────

test("next: numbering continues past holes and malformed files, title previews the path", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-first.md", tableAdr({ number: 1, title: "First" }));
    seed(proj, "0004-broken.md", "# ADR 0004 — Broken, still holds its number\n");
    const { structured } = await callAdr(proj, { action: "next", title: "Shiny New Thing" });
    assert.equal(structured.number, 5);
    assert.equal(structured.path, "docs/adr/0005-shiny-new-thing.md");
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── accept ─────────────────────────────────────────────────────────────────

test("accept: stamps status and date into a table-style record", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-ready.md", tableAdr({ number: 1, title: "Ready" }));
    const { text, isError, structured } = await callAdr(proj, { action: "accept", number: 1 });
    assert.equal(isError, false, text);
    const raw = readFileSync(join(proj, "docs/adr/0001-ready.md"), "utf8");
    assert.match(raw, /\| Status {8}\| \*\*Accepted\*\* \|/);
    assert.match(raw, new RegExp(`\\| Date {10}\\| ${TODAY} \\|`));
    assert.equal(structured.record.status, "accepted");
    assert.equal(structured.record.date, TODAY);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("accept: stamps a heading-style record in its own style", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-ready.md", headingAdr({ number: 1, title: "Ready" }));
    const { text, isError } = await callAdr(proj, { action: "accept", number: "0001" });
    assert.equal(isError, false, text);
    const raw = readFileSync(join(proj, "docs/adr/0001-ready.md"), "utf8");
    assert.match(raw, /## Status\n\nAccepted\n/);
    assert.match(raw, new RegExp(`## Date\\n\\n${TODAY}\\n`));
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("accept: refuses without a number, on a missing record, and on a malformed one", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0002-broken.md", "# ADR 0002 — Broken\n\nNo status anywhere.\n");
    const noNumber = await callAdr(proj, { action: "accept" });
    assert.equal(noNumber.isError, true);
    assert.match(noNumber.text, /requires `number`/);

    const missing = await callAdr(proj, { action: "accept", number: 9 });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /not found/);

    const malformed = await callAdr(proj, { action: "accept", number: 2 });
    assert.equal(malformed.isError, true);
    assert.match(malformed.text, /cannot be parsed/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("accept: refuses non-proposed statuses", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-done.md", tableAdr({ number: 1, title: "Done", status: "**Accepted**" }));
    seed(
      proj,
      "0002-gone.md",
      tableAdr({
        number: 2,
        title: "Gone",
        status: "**Superseded** by [ADR-0001](0001-done.md)",
        supersededBy: "[ADR-0001](0001-done.md)",
      }),
    );
    const already = await callAdr(proj, { action: "accept", number: 1 });
    assert.equal(already.isError, true);
    assert.match(already.text, /already accepted/);

    const superseded = await callAdr(proj, { action: "accept", number: 2 });
    assert.equal(superseded.isError, true);
    assert.match(superseded.text, /only a proposed record/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("accept: readiness gate refuses placeholders, missing sections, dangling refs — and writes nothing", async () => {
  const proj = freshProject();
  try {
    seed(
      proj,
      "0001-placeholders.md",
      tableAdr({
        number: 1,
        title: "Unfilled",
        sections:
          "## Context\n\n{Explain the forces at play}\n\n## Decision\n\nX.\n\n## Consequences\n\nY.",
      }),
    );
    seed(
      proj,
      "0002-sectionless.md",
      tableAdr({ number: 2, title: "Sectionless", sections: "## Context\n\nOnly context here." }),
    );
    seed(
      proj,
      "0003-dangling.md",
      tableAdr({
        number: 3,
        title: "Dangling",
        sections: "## Context\n\nBuilds on ADR-0999.\n\n## Decision\n\nX.\n\n## Consequences\n\nY.",
      }),
    );

    const before = readFileSync(join(proj, "docs/adr/0001-placeholders.md"), "utf8");
    const placeholders = await callAdr(proj, { action: "accept", number: 1 });
    assert.equal(placeholders.isError, true);
    assert.match(placeholders.text, /placeholder/);
    assert.match(placeholders.text, /nothing was written/);
    assert.equal(readFileSync(join(proj, "docs/adr/0001-placeholders.md"), "utf8"), before);

    const sectionless = await callAdr(proj, { action: "accept", number: 2 });
    assert.equal(sectionless.isError, true);
    assert.match(sectionless.text, /required section/);
    assert.match(sectionless.text, /## Decision/);
    assert.match(sectionless.text, /## Consequences/);

    const dangling = await callAdr(proj, { action: "accept", number: 3 });
    assert.equal(dangling.isError, true);
    assert.match(dangling.text, /unresolved cross-reference/);
    assert.match(dangling.text, /ADR-0999/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── supersede ──────────────────────────────────────────────────────────────

test("supersede with title: creates a proposed skeleton and flips the old record only", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-old.md", tableAdr({ number: 1, title: "Old way", status: "**Accepted**" }));
    const before = readFileSync(join(proj, "docs/adr/0001-old.md"), "utf8");
    const bodyBefore = before.slice(before.indexOf("## Context"));

    const { text, isError, structured } = await callAdr(proj, {
      action: "supersede",
      number: 1,
      title: "New way",
    });
    assert.equal(isError, false, text);

    const skeletonPath = join(proj, "docs/adr/0002-new-way.md");
    assert.ok(existsSync(skeletonPath), "successor skeleton created");
    const skeleton = readFileSync(skeletonPath, "utf8");
    assert.match(skeleton, /\| Status {8}\| \*\*Proposed\*\* \|/);
    assert.match(skeleton, /\| Supersedes {4}\| \[ADR-0001\]\(0001-old\.md\) \|/);

    const after = readFileSync(join(proj, "docs/adr/0001-old.md"), "utf8");
    assert.match(
      after,
      /\| Status {8}\| \*\*Superseded\*\* by \[ADR-0002\]\(0002-new-way\.md\) \|/,
    );
    assert.match(after, /\| Superseded by \| \[ADR-0002\]\(0002-new-way\.md\) \|/);
    assert.equal(after.slice(after.indexOf("## Context")), bodyBefore, "old prose untouched");

    assert.equal(structured.record.number, 2);
    assert.equal(structured.record.status, "proposed");
    assert.deepEqual(structured.record.supersedes, [1]);
    assert.equal(structured.superseded.status, "superseded");
    assert.deepEqual(structured.superseded.superseded_by, [2]);

    // The unfilled skeleton cannot sneak through the accept gate.
    const premature = await callAdr(proj, { action: "accept", number: 2 });
    assert.equal(premature.isError, true);
    assert.match(premature.text, /placeholder/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("supersede with successor: pairs two existing records across header styles", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-old.md", headingAdr({ number: 1, title: "Old", status: "Accepted" }));
    seed(proj, "0002-new.md", tableAdr({ number: 2, title: "New", status: "**Accepted**" }));
    const { text, isError } = await callAdr(proj, { action: "supersede", number: 1, successor: 2 });
    assert.equal(isError, false, text);

    const oldRaw = readFileSync(join(proj, "docs/adr/0001-old.md"), "utf8");
    assert.match(oldRaw, /## Status\n\nSuperseded by \[ADR-0002\]\(0002-new\.md\)\n/);
    const newRaw = readFileSync(join(proj, "docs/adr/0002-new.md"), "utf8");
    assert.match(newRaw, /\| Supersedes {4}\| \[ADR-0001\]\(0001-old\.md\) \|/);

    const { structured } = await callAdr(proj, { action: "list" });
    assert.deepEqual(structured.records[0].superseded_by, [2]);
    assert.deepEqual(structured.records[1].supersedes, [1]);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("supersede: fail-closed argument and state validation", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-old.md", tableAdr({ number: 1, title: "Old", status: "**Accepted**" }));
    seed(
      proj,
      "0002-gone.md",
      tableAdr({
        number: 2,
        title: "Gone",
        status: "**Superseded** by [ADR-0001](0001-old.md)",
        supersededBy: "[ADR-0001](0001-old.md)",
      }),
    );

    const noNumber = await callAdr(proj, { action: "supersede", title: "X" });
    assert.equal(noNumber.isError, true);
    assert.match(noNumber.text, /requires `number`/);

    const neither = await callAdr(proj, { action: "supersede", number: 1 });
    assert.equal(neither.isError, true);
    assert.match(neither.text, /exactly one of/);

    const both = await callAdr(proj, { action: "supersede", number: 1, title: "X", successor: 2 });
    assert.equal(both.isError, true);
    assert.match(both.text, /exactly one of/);

    const self = await callAdr(proj, { action: "supersede", number: 1, successor: 1 });
    assert.equal(self.isError, true);
    assert.match(self.text, /cannot supersede itself/);

    const already = await callAdr(proj, { action: "supersede", number: 2, title: "X" });
    assert.equal(already.isError, true);
    assert.match(already.text, /already superseded/);

    const missing = await callAdr(proj, { action: "supersede", number: 9, title: "X" });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /not found/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── index ──────────────────────────────────────────────────────────────────

test("index: skips gracefully when no target resolves", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-first.md", tableAdr({ number: 1, title: "First" }));
    const { text, isError, structured } = await callAdr(proj, { action: "index" });
    assert.equal(isError, false, text);
    assert.match(text, /No corpus index target/);
    assert.equal(structured.result, "skipped");
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("index: creates the configured index file and regenerates only the managed block", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-first.md", tableAdr({ number: 1, title: "First", status: "**Accepted**" }));
    writeConfig(proj, { adr: { index_file: "docs/DECISIONS.md" } });

    const created = await callAdr(proj, { action: "index" });
    assert.equal(created.isError, false, created.text);
    assert.equal(created.structured.result, "created");
    const indexPath = join(proj, "docs/DECISIONS.md");
    let content = readFileSync(indexPath, "utf8");
    assert.match(content, /<!-- marvin:adr-index:start -->/);
    assert.match(content, /\[0001\]\(adr\/0001-first\.md\)/);

    // Hand-written prose around the markers must survive a regeneration.
    writeFileSync(indexPath, `Intro prose stays.\n\n${content}\nOutro prose stays.\n`);
    seed(proj, "0002-second.md", tableAdr({ number: 2, title: "Second" }));
    const regenerated = await callAdr(proj, { action: "index" });
    assert.equal(regenerated.structured.result, "replaced");
    content = readFileSync(indexPath, "utf8");
    assert.match(content, /^Intro prose stays\./);
    assert.match(content, /Outro prose stays\.\n$/);
    assert.match(content, /\[0002\]\(adr\/0002-second\.md\)/);

    // Unchanged corpus → no rewrite.
    const unchanged = await callAdr(proj, { action: "index" });
    assert.equal(unchanged.structured.result, "unchanged");
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

test("index: appends a managed block to a marker-less README detected inside the corpus dir", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-first.md", tableAdr({ number: 1, title: "First" }));
    seed(proj, "README.md", "# Decisions\n\nHand-written preamble.\n");
    const { structured } = await callAdr(proj, { action: "index" });
    assert.equal(structured.result, "appended");
    assert.equal(structured.target, "docs/adr/README.md");
    const content = readFileSync(join(proj, "docs/adr/README.md"), "utf8");
    assert.match(content, /^# Decisions\n\nHand-written preamble\./);
    assert.match(content, /<!-- marvin:adr-index:start -->/);
    assert.match(content, /\[0001\]\(0001-first\.md\)/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── config round-trip with the kanban surface ──────────────────────────────

test("config: the adr block and foreign keys survive a task-config read-modify-write", async () => {
  const proj = freshProject();
  try {
    seed(proj, "0001-first.md", tableAdr({ number: 1, title: "First" }), "records");
    writeConfig(proj, {
      adr: { dir: "records", index_file: "records/README.md" },
      future_tool_key: { keep: true },
    });

    // The kanban config surface writes through the shared fail-closed path.
    const configured = await callTool(proj, "task", { action: "config", base_branch: "main" });
    assert.equal(configured.isError, false, configured.text);

    const raw = JSON.parse(readFileSync(join(proj, ".marvin", "config.json"), "utf8"));
    assert.deepEqual(raw.adr, { dir: "records", index_file: "records/README.md" });
    assert.deepEqual(raw.future_tool_key, { keep: true });
    assert.equal(raw.base_branch, "main");

    // And the adr tool still honors the block after the rewrite.
    const { structured } = await callAdr(proj, { action: "list" });
    assert.equal(structured.dir, "records");
    assert.equal(structured.records.length, 1);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});

// ── e2e lifecycle over the stdio driver ────────────────────────────────────

test("e2e: next → draft → accept → supersede → audit → index across server restarts", async () => {
  const proj = freshProject();
  try {
    writeConfig(proj, { adr: { index_file: "docs/adr/README.md" } });

    const next = await callAdr(proj, { action: "next", title: "Use queues" });
    assert.equal(next.structured.id, "0001");
    seed(proj, "0001-use-queues.md", tableAdr({ number: 1, title: "Use queues" }));

    const accepted = await callAdr(proj, { action: "accept", number: 1 });
    assert.equal(accepted.isError, false, accepted.text);
    assert.equal(accepted.structured.record.status, "accepted");

    const superseded = await callAdr(proj, {
      action: "supersede",
      number: 1,
      title: "Use streams",
    });
    assert.equal(superseded.isError, false, superseded.text);
    assert.equal(superseded.structured.record.number, 2);

    // Audit: skeleton placeholders (warning) + missing index (warning) — no errors.
    const audit = await callAdr(proj, { action: "audit" });
    assert.equal(audit.isError, false, audit.text);
    assert.equal(audit.structured.ok, true);
    const kinds = audit.structured.findings.map((f) => f.kind).sort();
    assert.deepEqual(kinds, ["placeholder-residue", "stale-index"]);

    const index = await callAdr(proj, { action: "index" });
    assert.equal(index.structured.result, "created");

    const list = await callAdr(proj, { action: "list" });
    assert.equal(list.structured.counts.superseded, 1);
    assert.equal(list.structured.counts.proposed, 1);
    assert.match(list.text, /superseded by ADR-0002/);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
});
