import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { withSession } from "./_driver.mjs";

/**
 * The `tracker_url_template` invariant: a derived `tracker_url` never carries
 * an unsubstituted `{…}` placeholder.
 *
 * `.marvin/config.json` is a plain file the docs invite people to edit by
 * hand, so a template the config surface would refuse still reaches the
 * loader. Before this suite, `https://example.com/issues/{id}` flowed through
 * `trackerUrl` unchanged and every tracked card carried a live link ending in
 * a literal `{id}` — rendered as a markdown link by the tracker tool and as an
 * anchor by the tracker-list widget, with no warning anywhere.
 */

const textOf = (result) => result.content.map((c) => c.text).join("\n");

/**
 * No markdown link in `text` targets a URL that still carries a `{…}`
 * placeholder. Asserted on link *targets* rather than on the whole text
 * because a warning quotes the offending template verbatim — that mention is
 * the point, a clickable link to `…/{id}` is the defect.
 */
function assertNoPlaceholderLink(text, label) {
  for (const [, target] of text.matchAll(/\]\(([^)]*)\)/g)) {
    assert.doesNotMatch(target, /\{[^}]*\}/, `${label}: link target carries a placeholder`);
  }
}

/** A board with one tracker-bearing task and a hand-written config file. */
function seedProject(config) {
  const dir = mkdtempSync(join(tmpdir(), "marvin-tracker-url-"));
  const tasksDir = join(dir, ".marvin", "track");
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(
    join(tasksDir, "001--fix-login-timeout.md"),
    [
      "---",
      'id: "001"',
      "type: bug",
      "status: todo",
      "title: Fix login timeout",
      "tracker_id: OSI-101",
      "branch: fix/001-OSI-101--fix-login-timeout",
      'created: "2026-06-20T10:00:00.000Z"',
      'updated: "2026-06-20T10:00:00.000Z"',
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
  const configPath = join(dir, ".marvin", "config.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { dir, configPath };
}

/** Run tools/call requests in order against a seeded project. */
async function drive(dir, calls, { accept = null } = {}) {
  return withSession(
    {
      env: { CLAUDE_PROJECT_DIR: dir },
      capabilities: accept ? { elicitation: {} } : {},
      onServerRequest: () =>
        accept ? { action: "accept", content: accept } : { action: "cancel" },
    },
    async (s) => {
      const out = [];
      for (const params of calls) out.push(await s.request("tools/call", params));
      return out;
    },
  );
}

// ── read side: a hand-edited template that cannot substitute ─────────────

test("a hand-edited template without {tracker_id} yields no URL, not a placeholder URL", async () => {
  const { dir } = seedProject({
    base_branch: "main",
    // The exact reproduction: the placeholder was renamed, so `{tracker_id}`
    // substitution leaves `{id}` in place.
    tracker_url_template: "https://example.com/issues/{id}",
  });
  try {
    const [tracker, detail, list] = await drive(dir, [
      { name: "tracker", arguments: {} },
      { name: "task-detail", arguments: { taskId: "001" } },
      { name: "task", arguments: { action: "list" } },
    ]);

    // widget payload: the card is still tracked, it simply has no URL
    assert.equal(tracker.structuredContent.tasks.length, 1);
    const card = tracker.structuredContent.tasks[0];
    assert.equal(card.tracker_id, "OSI-101");
    assert.equal(card.tracker_url, null, "an unusable template derives no URL");

    // every other payload that carries a card agrees
    assert.equal(detail.structuredContent.tracker_url, null);
    assert.equal(list.structuredContent.tasks[0].tracker_url, null);

    // no surface anywhere renders a link built from the unusable template
    for (const [name, res] of Object.entries({ tracker, detail, list })) {
      const text = textOf(res);
      assertNoPlaceholderLink(text, name);
      assert.doesNotMatch(text, /\]\(https:\/\/example\.com/, `${name}: no link to nowhere`);
      assert.match(text, /OSI-101/, `${name}: the id still shows, just unlinked`);
      assert.doesNotMatch(
        JSON.stringify(res.structuredContent),
        /\{id\}/,
        `${name}: no placeholder URL in the widget payload`,
      );
    }

    // and the reason is stated where the missing link shows
    assert.match(textOf(tracker), /tracker_url_template/);
    assert.match(textOf(tracker), /no `\{tracker_id\}` placeholder/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a template with a second placeholder nobody fills derives no URL", async () => {
  const { dir } = seedProject({
    tracker_url_template: "https://example.com/{project}/browse/{tracker_id}",
  });
  try {
    const [tracker] = await drive(dir, [{ name: "tracker", arguments: {} }]);

    assert.equal(
      tracker.structuredContent.tasks[0].tracker_url,
      null,
      "`{tracker_id}` alone is substituted, so `{project}` would survive into the URL",
    );
    assertNoPlaceholderLink(textOf(tracker), "tracker");
    assert.match(textOf(tracker), /leaves `\{project\}` unsubstituted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unusable template costs only itself — the rest of the config still applies", async () => {
  const { dir } = seedProject({
    base_branch: "release-2026",
    tracker_url_template: "https://example.com/issues/{id}",
    gates: { test: "npm run test:unit" },
    statuses: [
      { key: "backlog", role: "todo" },
      { key: "in-progress", role: "wip" },
      { key: "shipped", role: "done" },
    ],
  });
  try {
    const [view] = await drive(dir, [{ name: "task", arguments: { action: "config" } }]);
    const text = textOf(view);

    // the whole-file fallback would have reset these to their defaults
    assert.match(text, /\*\*base_branch:\*\* `release-2026` _\(from config\)_/);
    assert.match(text, /\| backlog \| todo \| — \|/);
    assert.match(text, /\| shipped \| done \| — \|/);
    assert.doesNotMatch(text, /\| todo \| todo \|/, "the default vocabulary is NOT in force");

    // only the template was dropped, and the view says so rather than leaving
    // "not set" to contradict the file
    assert.match(text, /\*\*tracker_url_template:\*\* _not set_/);
    assert.match(
      text,
      /⚠ `tracker_url_template` "https:\/\/example\.com\/issues\/\{id\}" is ignored/,
    );
    assert.doesNotMatch(text, /showing defaults/, "this is a per-setting fallback, not a file one");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the dashboard reports the dropped template without claiming defaults", async () => {
  const { dir } = seedProject({ tracker_url_template: "https://example.com/issues/{id}" });
  try {
    const [dash] = await drive(dir, [{ name: "dashboard", arguments: {} }]);

    assert.match(textOf(dash), /⚠ config: `tracker_url_template`.*is ignored/);
    assert.doesNotMatch(textOf(dash), /using defaults/);
    assert.equal(
      dash.structuredContent.config.tracker_url_template,
      null,
      "the state contract reports the effective value, which is now null",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── read side: a usable template still works ─────────────────────────────

test("a usable template substitutes every occurrence of {tracker_id}", async () => {
  const { dir } = seedProject({
    // Two occurrences: `.replace()` would have substituted only the first and
    // left the second in the URL.
    tracker_url_template: "https://acme.atlassian.net/browse/{tracker_id}?title={tracker_id}",
  });
  try {
    const [tracker] = await drive(dir, [{ name: "tracker", arguments: {} }]);

    assert.equal(
      tracker.structuredContent.tasks[0].tracker_url,
      "https://acme.atlassian.net/browse/OSI-101?title=OSI-101",
    );
    const text = textOf(tracker);
    assert.match(text, /\[OSI-101\]\(https:\/\/acme\.atlassian\.net\/browse\/OSI-101/);
    assert.doesNotMatch(text, /is ignored/, "a usable template raises no warning");
    assert.doesNotMatch(text, /no tracker URL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── write side: the config surface refuses what the loader would drop ────

test("the config action refuses an unusable template and writes nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-tracker-url-"));
  try {
    const results = await drive(dir, [
      {
        name: "task",
        arguments: { action: "config", tracker_url_template: "https://example.com/issues/{id}" },
      },
      {
        name: "task",
        arguments: { action: "config", tracker_url_template: "https://example.com/issues" },
      },
      {
        name: "task",
        arguments: {
          action: "config",
          tracker_url_template: "https://example.com/{project}/{tracker_id}",
        },
      },
    ]);

    for (const res of results) {
      assert.equal(res.isError, true);
      assert.match(textOf(res), /Invalid `tracker_url_template`/);
      assert.match(textOf(res), /Nothing was written/);
      assert.match(textOf(res), /\{tracker_id\}/, "the error shows the placeholder to use");
    }
    assert.match(textOf(results[0]), /no `\{tracker_id\}` placeholder/);
    assert.match(textOf(results[2]), /leaves `\{project\}` unsubstituted/);

    assert.ok(
      !existsSync(join(dir, ".marvin", "config.json")),
      "fail-closed: the refused write created no file",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an existing config survives a refused template edit", async () => {
  const { dir, configPath } = seedProject({
    base_branch: "main",
    tracker_url_template: "https://acme.atlassian.net/browse/{tracker_id}",
  });
  try {
    const [res] = await drive(dir, [
      {
        name: "task",
        arguments: { action: "config", tracker_url_template: "https://example.com/issues/{id}" },
      },
    ]);

    assert.equal(res.isError, true);
    const onDisk = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(
      onDisk.tracker_url_template,
      "https://acme.atlassian.net/browse/{tracker_id}",
      "the working template was not overwritten by the refused one",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the elicitation form is held to the same rule as the arguments", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-tracker-url-"));
  try {
    // The form path used to fill the patch directly, skipping the argument
    // branch's check entirely — a bad template typed into it reached disk.
    const [res] = await drive(
      dir,
      [{ name: "task", arguments: { action: "config", edit: true } }],
      {
        accept: { tracker_url_template: "https://example.com/issues/{id}" },
      },
    );

    assert.equal(res.isError, true);
    assert.match(textOf(res), /Invalid `tracker_url_template`/);
    assert.ok(!existsSync(join(dir, ".marvin", "config.json")), "fail-closed: nothing written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a usable template is still accepted through the config action", async () => {
  const dir = mkdtempSync(join(tmpdir(), "marvin-tracker-url-"));
  try {
    const [res] = await drive(dir, [
      {
        name: "task",
        arguments: {
          action: "config",
          tracker_url_template: "https://acme.atlassian.net/browse/{tracker_id}",
        },
      },
    ]);

    assert.notEqual(res.isError, true);
    const onDisk = JSON.parse(readFileSync(join(dir, ".marvin", "config.json"), "utf8"));
    assert.equal(onDisk.tracker_url_template, "https://acme.atlassian.net/browse/{tracker_id}");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
