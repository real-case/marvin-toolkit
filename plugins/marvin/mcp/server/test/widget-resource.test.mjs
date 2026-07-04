import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { withSession } from "./_driver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// test/ → server → mcp → marvin, then widgets/task-list.html (the committed build).
const COMMITTED_HTML = join(here, "..", "..", "..", "widgets", "task-list.html");

const URI = "ui://marvin/task-list.html";
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
