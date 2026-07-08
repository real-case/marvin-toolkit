import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { callTool } from "./_driver.mjs";

const PR_URL = "https://github.com/acme/widget/pull/7";

/**
 * Seed two handoff docs the storage layer accepts (numeric-prefixed filename,
 * frontmatter id matching the seq). 001 has no PR/base/spec; 002 carries all
 * the optional fields. The reader must sort newest-first (002 before 001) and
 * map an absent `pr_url` to the contract's nullable field.
 */
function seedHandoffs(dir) {
  writeFileSync(
    join(dir, "001--initial-context.md"),
    [
      "---",
      'id: "001"',
      "slug: initial-context",
      "objective: Stand up the widget data layer",
      "branch: feat/widget-data-contracts",
      'created: "2026-06-20T09:00:00Z"',
      "---",
      "",
      "# Handoff — Stand up the widget data layer",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "002--handoff-read-side.md"),
    [
      "---",
      'id: "002"',
      "slug: handoff-read-side",
      "objective: Add the handoff read side",
      "branch: feat/handoff-list",
      "base: dev",
      `pr_url: ${PR_URL}`,
      "spec_slug: handoff-list",
      'created: "2026-06-29T12:00:00Z"',
      "---",
      "",
      "# Handoff — Add the handoff read side",
      "",
    ].join("\n"),
  );
}

/** Drive the live server: initialize, then call the `handoff` `list` action. */
function listHandoffs(handoffDir) {
  return callTool(
    "handoff",
    { action: "list" },
    { env: { CLAUDE_PROJECT_DIR: handoffDir, MARVIN_HANDOFF_DIR: handoffDir } },
  );
}

test("handoff list emits a HandoffDetailPayload structuredContent alongside the text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-handoff-"));
  try {
    seedHandoffs(dir);

    const result = await listHandoffs(dir);

    // text surface (terminal fallback)
    const text = result.content.map((c) => c.text).join("\n");
    assert.match(text, /# Handoffs \(2\)/);

    // widget surface: the typed payload
    const sc = result.structuredContent;
    assert.ok(sc, "structuredContent present on the list result");
    assert.equal(sc.handoffs.length, 2);

    // newest-first ordering
    const [first, second] = sc.handoffs;
    assert.equal(first.id, "002");
    assert.equal(second.id, "001");

    // 002 carries every optional field
    assert.equal(first.slug, "handoff-read-side");
    assert.equal(first.objective, "Add the handoff read side");
    assert.equal(first.branch, "feat/handoff-list");
    assert.equal(first.base, "dev");
    assert.equal(first.pr_url, PR_URL);
    assert.equal(first.spec_slug, "handoff-list");
    assert.ok(first.created, "created present");

    // widget-detail fields (ADR-0024 #5): the file body verbatim + a derived
    // continue prompt that names the objective, the real filename, and the branch
    // (mirrors the handoff skill's step-5 template).
    assert.equal(typeof first.body_markdown, "string");
    assert.ok(
      first.body_markdown.includes("Add the handoff read side"),
      "body_markdown carries the handoff's file body",
    );
    assert.ok(
      first.continue_prompt.includes("Add the handoff read side"),
      "continue_prompt names the objective",
    );
    assert.ok(
      first.continue_prompt.includes("002--handoff-read-side.md"),
      "continue_prompt points at the handoff's real on-disk filename",
    );
    assert.ok(
      first.continue_prompt.includes("feat/handoff-list"),
      "continue_prompt names the branch",
    );

    // 001 omits PR/base/spec — pr_url maps to null, the optionals are absent
    assert.equal(second.pr_url, null, "absent pr_url maps to the contract's nullable field");
    assert.equal(second.base, undefined);
    assert.equal(second.spec_slug, undefined);
    // ...but every handoff still gets a body and a continue prompt
    assert.equal(typeof second.body_markdown, "string");
    assert.ok(second.continue_prompt.includes("001--initial-context.md"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
