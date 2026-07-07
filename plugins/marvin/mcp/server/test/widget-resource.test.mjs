import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { withSession, SERVER_PATH } from "./_driver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// test/ → server → mcp → marvin, then widgets/<name>.html (the committed build).
const COMMITTED_HTML = join(here, "..", "..", "..", "widgets", "task-list.html");
const DETAIL_HTML = join(here, "..", "..", "..", "widgets", "task-detail.html");
const HANDOFFS_HTML = join(here, "..", "..", "..", "widgets", "handoffs.html");
const TRACKER_HTML = join(here, "..", "..", "..", "widgets", "tracker-list.html");
const AUDIT_HTML = join(here, "..", "..", "..", "widgets", "audit.html");
const SUMMARY_HTML = join(here, "..", "..", "..", "widgets", "task-summary.html");

const URI = "ui://marvin/task-list.html";
const DETAIL_URI = "ui://marvin/task-detail.html";
const HANDOFFS_URI = "ui://marvin/handoffs.html";
const TRACKER_URI = "ui://marvin/tracker-list.html";
const AUDIT_URI = "ui://marvin/audit.html";
const SUMMARY_URI = "ui://marvin/task-summary.html";
const MIME = "text/html;profile=mcp-app";

/**
 * AC4 — the built server binds the task-list `ui://` widget end-to-end over stdio
 * (ADR-0024): the task tool advertises `_meta.ui.resourceUri`, the resource is
 * listed and read as the committed self-contained HTML with the mcp-app mimeType,
 * and the terminal text fallback is unchanged. Drives the committed dist via the
 * shared `_driver.mjs` (no resources helper there — use `s.request` directly).
 */
test("task tool binds the ui:// widget and the resource serves the committed html", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-widget-"));
  try {
    await withSession({ env: { CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_DIR: dir } }, async (s) => {
      // 1. tools/list — the task tool advertises the widget binding.
      const tools = await s.request("tools/list", {});
      const task = tools.tools.find((t) => t.name === "task");
      assert.ok(task, "task tool is registered");
      assert.equal(
        task._meta?.ui?.resourceUri,
        URI,
        "task tool _meta.ui.resourceUri binds the widget",
      );

      // 2. resources/list — the ui:// resource is advertised with the mcp-app mime.
      const resources = await s.request("resources/list", {});
      const res = resources.resources.find((r) => r.uri === URI);
      assert.ok(res, "resources/list includes the widget uri");
      assert.equal(res.mimeType, MIME, "listed resource carries the mcp-app mimeType");

      // 3. resources/read — returns the committed HTML with the mcp-app mimeType.
      const read = await s.request("resources/read", { uri: URI });
      const content = read.contents[0];
      assert.equal(content.uri, URI);
      assert.equal(content.mimeType, MIME, "resources/read mimeType is text/html;profile=mcp-app");
      assert.equal(
        content.text,
        readFileSync(COMMITTED_HTML, "utf8"),
        "served HTML is byte-for-byte the committed build output",
      );
      assert.match(content.text, /<!doctype html>/i, "served body is an HTML document");

      // 4. terminal fallback unchanged — the task list still emits its text content.
      const listed = await s.request("tools/call", {
        name: "task",
        arguments: { action: "list" },
      });
      const text = listed.content.map((c) => c.text).join("\n");
      assert.match(text, /# Tasks \(0\)/, "task list text fallback is still present");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * AC5 — the task-detail widget (ADR-0024 #2) binds end-to-end over stdio: the
 * task-detail tool advertises `_meta.ui.resourceUri`, the resource is listed and
 * read as the committed self-contained HTML with the mcp-app mimeType, the
 * terminal text fallback still renders, and the committed server bundle bundles
 * no ext-apps SDK (the server stays ext-apps/React free — the load-bearing
 * ADR-0024 invariant).
 */
test("task-detail tool binds the ui:// widget and the resource serves the committed html", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-widget-detail-"));
  try {
    await withSession({ env: { CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_DIR: dir } }, async (s) => {
      // 1. tools/list — the task-detail tool advertises the widget binding.
      const tools = await s.request("tools/list", {});
      const detail = tools.tools.find((t) => t.name === "task-detail");
      assert.ok(detail, "task-detail tool is registered");
      assert.equal(
        detail._meta?.ui?.resourceUri,
        DETAIL_URI,
        "task-detail tool _meta.ui.resourceUri binds the widget",
      );

      // 2. resources/list — the ui:// resource is advertised with the mcp-app mime.
      const resources = await s.request("resources/list", {});
      const res = resources.resources.find((r) => r.uri === DETAIL_URI);
      assert.ok(res, "resources/list includes the task-detail widget uri");
      assert.equal(res.mimeType, MIME, "listed resource carries the mcp-app mimeType");

      // 3. resources/read — returns the committed HTML with the mcp-app mimeType.
      const read = await s.request("resources/read", { uri: DETAIL_URI });
      const content = read.contents[0];
      assert.equal(content.uri, DETAIL_URI);
      assert.equal(content.mimeType, MIME, "resources/read mimeType is text/html;profile=mcp-app");
      assert.equal(
        content.text,
        readFileSync(DETAIL_HTML, "utf8"),
        "served HTML is byte-for-byte the committed build output",
      );
      assert.match(content.text, /<!doctype html>/i, "served body is an HTML document");

      // 4. terminal fallback — task-detail on an empty board still emits text.
      const shown = await s.request("tools/call", { name: "task-detail", arguments: {} });
      const text = shown.content.map((c) => c.text).join("\n");
      assert.match(text, /No tasks on the board/, "task-detail text fallback is present");
    });

    // 5. the committed server bundle stays ext-apps/React free (ADR-0024): the
    // ext-apps SDK lives only in the widget HTML, never in dist/server.js.
    const bundle = readFileSync(SERVER_PATH, "utf8");
    assert.doesNotMatch(
      bundle,
      /@modelcontextprotocol\/ext-apps/,
      "dist/server.js must not bundle the ext-apps SDK",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The handoffs widget (ADR-0024 #5) binds end-to-end over stdio: the handoff tool
 * advertises `_meta.ui.resourceUri`, the resource is listed and read as the
 * committed self-contained HTML with the mcp-app mimeType, and the terminal text
 * fallback still renders. Content-independent (an empty handoff dir) so it fails
 * precisely when the tool binding (F2 `meta`) and the resource registration (F3
 * `resources/widgets.ts`) drift apart — the gap the DoR critic flagged.
 */
test("handoff tool binds the ui:// widget and the resource serves the committed html", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-widget-handoffs-"));
  try {
    await withSession({ env: { CLAUDE_PROJECT_DIR: dir, MARVIN_HANDOFF_DIR: dir } }, async (s) => {
      // 1. tools/list — the handoff tool advertises the widget binding.
      const tools = await s.request("tools/list", {});
      const handoff = tools.tools.find((t) => t.name === "handoff");
      assert.ok(handoff, "handoff tool is registered");
      assert.equal(
        handoff._meta?.ui?.resourceUri,
        HANDOFFS_URI,
        "handoff tool _meta.ui.resourceUri binds the widget",
      );

      // 2. resources/list — the ui:// resource is advertised with the mcp-app mime.
      const resources = await s.request("resources/list", {});
      const res = resources.resources.find((r) => r.uri === HANDOFFS_URI);
      assert.ok(res, "resources/list includes the handoffs widget uri");
      assert.equal(res.mimeType, MIME, "listed resource carries the mcp-app mimeType");

      // 3. resources/read — returns the committed HTML with the mcp-app mimeType.
      const read = await s.request("resources/read", { uri: HANDOFFS_URI });
      const content = read.contents[0];
      assert.equal(content.uri, HANDOFFS_URI);
      assert.equal(content.mimeType, MIME, "resources/read mimeType is text/html;profile=mcp-app");
      assert.equal(
        content.text,
        readFileSync(HANDOFFS_HTML, "utf8"),
        "served HTML is byte-for-byte the committed build output",
      );
      assert.match(content.text, /<!doctype html>/i, "served body is an HTML document");

      // 4. terminal fallback — the handoff list on an empty dir still emits text.
      const listed = await s.request("tools/call", {
        name: "handoff",
        arguments: { action: "list" },
      });
      const text = listed.content.map((c) => c.text).join("\n");
      assert.match(text, /# Handoffs \(0\)/, "handoff list text fallback is still present");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tracker tool binds the ui widget and the resource serves the committed html", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-widget-tracker-"));
  try {
    await withSession({ env: { CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_DIR: dir } }, async (s) => {
      // 1. tools/list — the tracker tool advertises the widget binding.
      const tools = await s.request("tools/list", {});
      const tracker = tools.tools.find((t) => t.name === "tracker");
      assert.ok(tracker, "tracker tool is registered");
      assert.equal(
        tracker._meta?.ui?.resourceUri,
        TRACKER_URI,
        "tracker tool _meta.ui.resourceUri binds the widget",
      );

      // 2. resources/list — the ui:// resource is advertised with the mcp-app mime.
      const resources = await s.request("resources/list", {});
      const res = resources.resources.find((r) => r.uri === TRACKER_URI);
      assert.ok(res, "resources/list includes the tracker-list widget uri");
      assert.equal(res.mimeType, MIME, "listed resource carries the mcp-app mimeType");

      // 3. resources/read — returns the committed HTML with the mcp-app mimeType.
      const read = await s.request("resources/read", { uri: TRACKER_URI });
      const content = read.contents[0];
      assert.equal(content.uri, TRACKER_URI);
      assert.equal(content.mimeType, MIME, "resources/read mimeType is text/html;profile=mcp-app");
      assert.equal(
        content.text,
        readFileSync(TRACKER_HTML, "utf8"),
        "served HTML is byte-for-byte the committed build output",
      );
      assert.match(content.text, /<!doctype html>/i, "served body is an HTML document");

      // 4. terminal fallback — tracker on an empty board still emits text.
      const shown = await s.request("tools/call", { name: "tracker", arguments: {} });
      const text = shown.content.map((c) => c.text).join("\n");
      assert.match(text, /Tracked tasks \(0\)/, "tracker text fallback is present");
    });

    // 5. the committed server bundle stays ext-apps/React free (ADR-0024).
    const bundle = readFileSync(SERVER_PATH, "utf8");
    assert.doesNotMatch(
      bundle,
      /@modelcontextprotocol\/ext-apps/,
      "dist/server.js must not bundle the ext-apps SDK",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit tool binds the ui:// widget and the resource serves the committed html", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-widget-audit-"));
  try {
    await withSession({ env: { CLAUDE_PROJECT_DIR: dir, MARVIN_SECURITY_DIR: dir } }, async (s) => {
      // 1. tools/list — the audit tool advertises the widget binding.
      const tools = await s.request("tools/list", {});
      const audit = tools.tools.find((t) => t.name === "audit");
      assert.ok(audit, "audit tool is registered");
      assert.equal(
        audit._meta?.ui?.resourceUri,
        AUDIT_URI,
        "audit tool _meta.ui.resourceUri binds the widget",
      );

      // 2. resources/list — the ui:// resource is advertised with the mcp-app mime.
      const resources = await s.request("resources/list", {});
      const res = resources.resources.find((r) => r.uri === AUDIT_URI);
      assert.ok(res, "resources/list includes the audit widget uri");
      assert.equal(res.mimeType, MIME, "listed resource carries the mcp-app mimeType");

      // 3. resources/read — returns the committed HTML with the mcp-app mimeType.
      const read = await s.request("resources/read", { uri: AUDIT_URI });
      const content = read.contents[0];
      assert.equal(content.uri, AUDIT_URI);
      assert.equal(content.mimeType, MIME, "resources/read mimeType is text/html;profile=mcp-app");
      assert.equal(
        content.text,
        readFileSync(AUDIT_HTML, "utf8"),
        "served HTML is byte-for-byte the committed build output",
      );
      assert.match(content.text, /<!doctype html>/i, "served body is an HTML document");

      // 4. terminal fallback — audit list on an empty security dir still emits text.
      const listed = await s.request("tools/call", {
        name: "audit",
        arguments: { action: "list" },
      });
      const text = listed.content.map((c) => c.text).join("\n");
      assert.match(text, /No audit reports yet/, "audit text fallback is present");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The task-summary widget (ADR-0024 #3) binds end-to-end over stdio: the summary tool
 * advertises `_meta.ui.resourceUri`, the resource is listed and read as the committed
 * self-contained HTML with the mcp-app mimeType, and the terminal text fallback still
 * renders. Content-independent (an empty project dir → the tool's "no spec found" text),
 * so it fails precisely when the tool binding (summary.ts `meta`) and the resource
 * registration (resources/widgets.ts) drift apart — the drop-a-widget bug the batch hit.
 */
test("summary tool binds the ui:// widget and the resource serves the committed html", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-widget-summary-"));
  try {
    await withSession({ env: { CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_DIR: dir } }, async (s) => {
      // 1. tools/list — the summary tool advertises the widget binding.
      const tools = await s.request("tools/list", {});
      const summary = tools.tools.find((t) => t.name === "summary");
      assert.ok(summary, "summary tool is registered");
      assert.equal(
        summary._meta?.ui?.resourceUri,
        SUMMARY_URI,
        "summary tool _meta.ui.resourceUri binds the widget",
      );

      // 2. resources/list — the ui:// resource is advertised with the mcp-app mime.
      const resources = await s.request("resources/list", {});
      const res = resources.resources.find((r) => r.uri === SUMMARY_URI);
      assert.ok(res, "resources/list includes the task-summary widget uri");
      assert.equal(res.mimeType, MIME, "listed resource carries the mcp-app mimeType");

      // 3. resources/read — returns the committed HTML with the mcp-app mimeType.
      const read = await s.request("resources/read", { uri: SUMMARY_URI });
      const content = read.contents[0];
      assert.equal(content.uri, SUMMARY_URI);
      assert.equal(content.mimeType, MIME, "resources/read mimeType is text/html;profile=mcp-app");
      assert.equal(
        content.text,
        readFileSync(SUMMARY_HTML, "utf8"),
        "served HTML is byte-for-byte the committed build output",
      );
      assert.match(content.text, /<!doctype html>/i, "served body is an HTML document");

      // 4. terminal fallback — summary on an empty project dir still emits its text.
      const shown = await s.request("tools/call", { name: "summary", arguments: {} });
      const text = shown.content.map((c) => c.text).join("\n");
      assert.match(text, /No spec found/, "summary text fallback is present");
    });

    // 5. the committed server bundle stays ext-apps/React free (ADR-0024).
    const bundle = readFileSync(SERVER_PATH, "utf8");
    assert.doesNotMatch(
      bundle,
      /@modelcontextprotocol\/ext-apps/,
      "dist/server.js must not bundle the ext-apps SDK",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
