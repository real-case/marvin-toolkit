import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { withSession } from "./_driver.mjs";

// A title that stresses the YAML codec: colon-space (forces quoting), double
// quotes, parens, ampersand — all printable ASCII (TaskTitle requires it).
const TITLE = 'Fix: the "tricky" title (v2) & more';
const TRACKER = "OSI-7";

/**
 * Drive the live server through the kanban `task` tool — create a task (which
 * goes through stringifyFrontmatter) then list it (parseFrontmatter) — so the
 * full YAML-codec round-trip is exercised end-to-end through the real kanban
 * path. Responds to the create form's elicitation request as a client would.
 * Project dir is a fresh temp dir (not a git repo), so no branch elicitation.
 */
function createThenList(dir) {
  return withSession(
    {
      env: { CLAUDE_PROJECT_DIR: dir, MARVIN_TASKS_DIR: dir },
      capabilities: { elicitation: {} },
      // Server-initiated elicitation request → accept with the form content.
      onServerRequest: () => ({ action: "accept", content: { title: TITLE, tracker_id: TRACKER } }),
    },
    async (s) => {
      const create = await s.request("tools/call", {
        name: "task",
        arguments: { action: "create", type: "bug" },
      });
      const createText = create.content.map((c) => c.text).join("\n");
      const list = await s.request("tools/call", {
        name: "task",
        arguments: { action: "list" },
      });
      const listText = list.content.map((c) => c.text).join("\n");
      return { createText, listText };
    },
  );
}

test("kanban task frontmatter round-trips through the YAML codec (create → list)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-fm-"));
  try {
    const { createText, listText } = await createThenList(dir);

    // create went through stringifyFrontmatter and reported success
    assert.match(createText, /Created task \*\*001\*\*/);

    // list parsed the file back and rendered the exact title + tracker verbatim —
    // the special characters survived stringify → parse intact.
    assert.ok(listText.includes(TITLE), `list output missing exact title:\n${listText}`);
    assert.ok(listText.includes(TRACKER), `list output missing tracker:\n${listText}`);

    // and the on-disk file the codec wrote is valid YAML frontmatter
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    assert.equal(files.length, 1, "exactly one task file written");
    const raw = readFileSync(join(dir, files[0]), "utf8");
    assert.ok(raw.startsWith("---\n"), "file has YAML frontmatter");
    assert.ok(raw.includes("status: todo"), "status persisted as a string");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
