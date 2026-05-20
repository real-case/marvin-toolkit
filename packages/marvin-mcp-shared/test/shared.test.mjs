import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { interpolateArgs, resolvePromptBody, zodToElicitSchema } from "../dist/index.js";

test("interpolateArgs replaces known placeholders and preserves unknown ones", () => {
  const body = "Hello {{name}}, your level is {{lvl}}. Unknown {{x}}.";
  const out = interpolateArgs(body, { name: "Marvin", lvl: "42" });
  assert.equal(out, "Hello Marvin, your level is 42. Unknown {{x}}.");
});

test("resolvePromptBody reads bodyFile relative to promptsDir", () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-test-"));
  try {
    writeFileSync(join(dir, "review.md"), "# review body");
    const body = resolvePromptBody(
      { name: "review", description: "x", bodyFile: "review.md" },
      { promptsDir: dir },
    );
    assert.equal(body, "# review body");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolvePromptBody returns inline body when set", () => {
  const body = resolvePromptBody(
    { name: "x", description: "x", body: "inline" },
    { promptsDir: "/nonexistent" },
  );
  assert.equal(body, "inline");
});

test("resolvePromptBody rejects multiple body sources", () => {
  assert.throws(() =>
    resolvePromptBody(
      { name: "x", description: "x", body: "a", bodyFile: "b.md" },
      { promptsDir: "/tmp" },
    ),
  );
});

test("resolvePromptBody reads skill SKILL.md and strips frontmatter", async () => {
  const { mkdirSync } = await import("node:fs");
  const packRoot = mkdtempSync(join(tmpdir(), "marvin-pack-"));
  try {
    const skillDir = join(packRoot, "skills", "mn.example");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: example\ndescription: test\n---\n\n# body\nText.\n",
    );
    const body = resolvePromptBody(
      { name: "example", description: "x", skill: "mn.example" },
      { promptsDir: "/nonexistent", packRoot },
    );
    // splitFrontmatter strips exactly one trailing newline of the closing `---`.
    // The blank separator line between frontmatter and prose is preserved as-is.
    assert.equal(body, "\n# body\nText.\n");
  } finally {
    rmSync(packRoot, { recursive: true, force: true });
  }
});

test("resolvePromptBody with skill but no packRoot throws", () => {
  assert.throws(() =>
    resolvePromptBody(
      { name: "x", description: "x", skill: "mn.x" },
      { promptsDir: "/tmp" },
    ),
  );
});

test("zodToElicitSchema handles strings, enums, optional, regex", () => {
  const schema = z.object({
    title: z.string().min(3).max(120).regex(/^[\x20-\x7E]+$/),
    type: z.enum(["bug", "feature"]),
    tracker_id: z.string().optional(),
  });
  const out = zodToElicitSchema(schema);
  assert.deepEqual(out, {
    type: "object",
    properties: {
      title: { type: "string", minLength: 3, maxLength: 120, pattern: "^[\\x20-\\x7E]+$" },
      type: { type: "string", enum: ["bug", "feature"] },
      tracker_id: { type: "string" },
    },
    required: ["title", "type"],
  });
});

test("zodToElicitSchema handles number, integer, boolean, array", () => {
  const schema = z.object({
    age: z.number(),
    count: z.number().int(),
    active: z.boolean(),
    tags: z.array(z.string()),
  });
  const out = zodToElicitSchema(schema);
  assert.deepEqual(out.properties, {
    age: { type: "number" },
    count: { type: "integer" },
    active: { type: "boolean" },
    tags: { type: "array", items: { type: "string" } },
  });
});
