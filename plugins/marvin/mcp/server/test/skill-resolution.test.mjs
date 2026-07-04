import { test } from "node:test";
import assert from "node:assert/strict";
import { getPrompt } from "./_driver.mjs";

/**
 * Sends an initialize and then a prompts/get to the live server and
 * returns the prompt response. Verifies that the body comes from the
 * SKILL.md file under `plugins/marvin/skills/commit/`
 * and arrives without the YAML frontmatter (`---` block).
 */

test("prompts/get commit returns SKILL.md body without frontmatter", async () => {
  const result = await getPrompt("commit");
  assert.ok(result, `missing result`);
  assert.ok(Array.isArray(result.messages), "missing messages");
  const text = result.messages[0]?.content?.text;
  assert.ok(text, "missing message text");
  // The SKILL.md begins with `---` frontmatter and `name:` / `description:` keys.
  // The MCP body must NOT contain those — they should be stripped at resolve time.
  assert.ok(!/^---\nname:/.test(text), "frontmatter leaked into prompt body");
  // The actual commit workflow uses the phrase "Conventional Commits" in the body.
  assert.match(text, /Conventional Commits|commit message|git commit/i);
  // `commit` references no plugin resource files, so the door-3 resource preamble
  // (added only when a body contains a `skills/...` path) must NOT appear.
  assert.ok(
    !/Plugin resources:/.test(text),
    "resource preamble leaked onto a skill with no skills/ refs",
  );
});

test("prompts/get sec-compliance prepends plugin-root context for its skills/ resource path", async () => {
  const result = await getPrompt("sec-compliance");
  assert.ok(result, `missing result`);
  const text = result.messages[0]?.content?.text;
  assert.ok(text, "missing message text");
  // sec-compliance tells the model to read skills/sec-compliance/asvs-4.0-checklist.md by a
  // plugin-relative path. Through the MCP door the model's cwd is the user's project, so the
  // server must prepend the absolute plugin root for that path to resolve (ADR-0008).
  assert.match(
    text,
    /Plugin resources:[\s\S]*installed at/,
    "missing plugin-root resolution preamble",
  );
  assert.match(
    text,
    /skills\/sec-compliance\/asvs-4\.0-checklist\.md/,
    "checklist reference missing from body",
  );
});
