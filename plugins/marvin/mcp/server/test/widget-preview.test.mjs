import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { callTool, hermeticEnv } from "./_driver.mjs";
import { DOCUMENT, PAYLOAD, WIDGET } from "./_split-write-server.mjs";

/**
 * The `widget-preview` command (spec 021-widget-preview-door, ADR-0034): renders a
 * bound `ui://` widget plus its live payload into one self-contained file under
 * `.marvin/preview/`.
 *
 * WHAT THIS SUITE PROVES AND HOW. There is no browser here, so "the widget appeared"
 * is not the assertion. Instead each half is pinned where it can actually be
 * falsified: the composition by byte-identity against the committed document and
 * deep-equality against a second, independent tool call, and the protocol by running
 * the generated file's OWN host script under `node:vm` against a stub frame and
 * reading the exact JSON-RPC it emits. That second half matters because every way
 * this host can be wrong fails SILENTLY in a real host — a `tool-result` without a
 * `content` block array fails the view's schema parse, the SDK swallows the handler
 * error, and the panel sits on "Connecting…" with nothing in the console.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "bin", "widget-preview.mjs");
const WIDGETS_DIR = join(HERE, "..", "..", "..", "widgets");

/** Run the command in its own throwaway project and return the raw result. */
function runPreview(args, dir) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: hermeticEnv(process.env, { CLAUDE_PROJECT_DIR: dir }),
  });
}

/** A fresh project directory, cleaned up by the caller. */
function project(label) {
  return mkdtempSync(join(tmpdir(), `marvin-preview-${label}-`));
}

const previewPath = (dir, widget) => join(dir, ".marvin", "preview", `${widget}.html`);

/** The base64 widget document the preview embeds, decoded back to text. */
function embeddedDocument(preview) {
  const match = /<script type="text\/plain" id="mv-doc">([^<]*)<\/script>/.exec(preview);
  assert.ok(match, "the preview embeds an mv-doc block");
  return Buffer.from(match[1].trim(), "base64").toString("utf8");
}

/**
 * The wire form of a value the vm produced. Objects created inside a `node:vm`
 * context carry THAT realm's prototypes, so `deepStrictEqual` against a host-realm
 * literal fails on the prototype alone. Serializing first compares what actually
 * crosses `postMessage` rather than which realm minted the object.
 */
const wire = (value) => JSON.parse(JSON.stringify(value));

/** The widget payload the preview embeds. */
function embeddedPayload(preview) {
  const match = /<script type="application\/json" id="mv-payload">([\s\S]*?)<\/script>/.exec(
    preview,
  );
  assert.ok(match, "the preview embeds an mv-payload block");
  return JSON.parse(match[1]);
}

test("writes a preview embedding the committed widget document byte-identically", async () => {
  const dir = project("compose");
  try {
    const run = runPreview(["help"], dir);
    assert.equal(run.status, 0, `expected success, got: ${run.stderr}`);

    const out = previewPath(dir, "help");
    assert.equal(run.stdout.trim(), out, "stdout carries the written path and nothing else");
    assert.ok(existsSync(out), "the preview file exists");

    const preview = readFileSync(out, "utf8");
    // Byte-identity against the committed artifact. This is what catches a broken
    // decode path: the documents are UTF-8 with em dashes and arrows in them, so a
    // naive `atob` without TextDecoder round-trips to mojibake rather than to this.
    assert.equal(
      embeddedDocument(preview),
      readFileSync(join(WIDGETS_DIR, "help.html"), "utf8"),
      "the embedded document is the committed widget, byte for byte",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reassembles a document whose character is split across two stdout reads", async () => {
  const dir = project("split");
  try {
    // The real CLI, unmodified, driven against a server that splits its
    // `resources/read` response inside a multibyte character. The CLI resolves its
    // server as `../dist/server.js` relative to itself, so staging a copy of each is
    // what puts the stub in that slot — no test hook in the shipped script.
    //
    // This is the deterministic form of the byte-identity assertion above. That one
    // catches a per-chunk decoder only when the kernel happens to slice a ~300 KB
    // document on a continuation byte: ~29% of runs, which read as an intermittent
    // CI failure on an unrelated test rather than as this defect. Here the boundary
    // is placed, so the failure is every run.
    const bin = join(dir, "bin");
    const dist = join(dir, "dist");
    const projectDir = join(dir, "project");
    for (const d of [bin, dist, projectDir]) mkdirSync(d, { recursive: true });
    copyFileSync(CLI, join(bin, "widget-preview.mjs"));
    copyFileSync(join(HERE, "_split-write-server.mjs"), join(dist, "server.js"));

    const run = spawnSync(process.execPath, [join(bin, "widget-preview.mjs"), WIDGET], {
      encoding: "utf8",
      env: hermeticEnv(process.env, { CLAUDE_PROJECT_DIR: projectDir }),
    });
    assert.equal(run.status, 0, `expected success, got: ${run.stderr}`);

    const preview = readFileSync(previewPath(projectDir, WIDGET), "utf8");
    const embedded = embeddedDocument(preview);
    // Named explicitly: a per-chunk decode turns the split character into U+FFFD, and
    // reporting that beats a diff of two near-identical documents.
    assert.ok(
      !embedded.includes("�"),
      "the document carries no replacement characters — a chunk boundary was decoded in isolation",
    );
    assert.equal(embedded, DOCUMENT, "the split character is reassembled");
    assert.deepEqual(embeddedPayload(preview), PAYLOAD, "the payload survives the same read path");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("embeds the tool's structuredContent verbatim", async () => {
  const dir = project("payload");
  try {
    const run = runPreview(["help"], dir);
    assert.equal(run.status, 0, `expected success, got: ${run.stderr}`);

    // The comparison value comes from an INDEPENDENT call against the same project,
    // not from the preview itself — otherwise this only proves the file parses.
    const direct = await callTool("help", {}, { env: { CLAUDE_PROJECT_DIR: dir } });
    assert.ok(direct.structuredContent, "the help tool returns a payload for this fixture");

    assert.deepEqual(
      embeddedPayload(readFileSync(previewPath(dir, "help"), "utf8")),
      direct.structuredContent,
      "the embedded payload is the tool's own structuredContent",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolves any bound widget through tools-list and rejects an unknown name", async () => {
  const dir = project("resolve");
  try {
    // A second, unrelated widget through the identical code path.
    const dashboard = runPreview(["dashboard"], dir);
    assert.equal(dashboard.status, 0, `expected success, got: ${dashboard.stderr}`);
    assert.equal(
      embeddedDocument(readFileSync(previewPath(dir, "dashboard"), "utf8")),
      readFileSync(join(WIDGETS_DIR, "dashboard.html"), "utf8"),
      "the dashboard preview embeds the dashboard document",
    );

    // THE falsifying case, and the reason this test can fail a wrong implementation
    // at all. The `task-summary` widget is bound to a tool named `summary`: any
    // mapping derived from the widget NAME would look for a `task-summary` tool,
    // which does not exist, and report an unknown widget. Reaching `summary` is
    // possible only through `_meta.ui.resourceUri` — which is what AC3 claims.
    // (This fixture has no specs, so `summary` then declines to produce a payload.
    // That is the AC9 path, and it is downstream of the resolution proved here.)
    const summary = runPreview(["task-summary"], dir);
    assert.match(
      summary.stderr,
      /the `summary` tool returned no widget payload/,
      "the task-summary widget resolved to the differently-named tool it is bound to",
    );

    const unknown = runPreview(["not-a-widget"], dir);
    assert.equal(unknown.status, 1, "an unknown widget name fails");
    assert.equal(unknown.stdout.trim(), "", "nothing is written to stdout on failure");
    assert.match(unknown.stderr, /unknown widget "not-a-widget"/);
    // Every bound widget, not a spot check: a dropped binding is exactly the drift
    // this list exists to surface, and a subset would not see it.
    const bound = readdirSync(WIDGETS_DIR)
      .filter((f) => f.endsWith(".html"))
      .map((f) => f.replace(/\.html$/, ""));
    assert.equal(bound.length, 9, "the committed widget set is the expected size");
    for (const name of bound) {
      assert.match(unknown.stderr, new RegExp(`\\b${name}\\b`), `lists the ${name} widget`);
    }
    assert.ok(!existsSync(previewPath(dir, "not-a-widget")), "no file is written");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the embedded host completes the handshake and answers both host-bound requests", async () => {
  const dir = project("protocol");
  try {
    assert.equal(runPreview(["help"], dir).status, 0);
    const preview = readFileSync(previewPath(dir, "help"), "utf8");
    const payload = embeddedPayload(preview);

    // The LAST inline script is the host. Running the shipped text — rather than a
    // re-implementation of it — is what makes this a test of the artifact.
    const scripts = [...preview.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1, "the preview carries exactly one executable script");

    const sent = [];
    const contentWindow = { postMessage: (message) => sent.push(message) };
    const frame = { contentWindow, srcdoc: null };
    let onMessage;
    const blocks = {
      "mv-doc": {
        textContent: /<script type="text\/plain" id="mv-doc">([^<]*)<\/script>/.exec(preview)[1],
      },
      "mv-payload": { textContent: JSON.stringify(payload) },
      "mv-args": { textContent: "{}" },
      "mv-frame": frame,
    };
    const documentElement = {
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    };
    const context = createContext({
      atob,
      TextDecoder,
      Uint8Array,
      JSON,
      document: {
        documentElement,
        getElementById: (id) => blocks[id] ?? null,
      },
      window: {
        addEventListener: (type, handler) => {
          if (type === "message") onMessage = handler;
        },
      },
    });
    runInContext(scripts[0][1], context);

    assert.equal(typeof onMessage, "function", "the host subscribes to message events");
    // Boot order: the frame is only fed AFTER the listener exists, or the view's
    // ui/initialize lands with nobody listening and the preview hangs.
    assert.equal(
      frame.srcdoc,
      readFileSync(join(WIDGETS_DIR, "help.html"), "utf8"),
      "the host decodes the document into the frame",
    );

    // A message from anything but the frame is ignored.
    onMessage({ source: {}, data: { jsonrpc: "2.0", id: 1, method: "ui/initialize" } });
    assert.equal(sent.length, 0, "messages from another window are ignored");

    onMessage({
      source: contentWindow,
      data: {
        jsonrpc: "2.0",
        id: 7,
        method: "ui/initialize",
        params: { protocolVersion: "2026-01-26" },
      },
    });
    assert.equal(sent.length, 1);
    const init = sent[0];
    assert.equal(init.id, 7);
    assert.equal(
      init.result.protocolVersion,
      "2026-01-26",
      "the requested version is echoed, not pinned — the view does no negotiation",
    );
    assert.ok(init.result.hostCapabilities.openLinks, "openLinks is advertised");
    assert.ok(init.result.hostInfo.name, "hostInfo is present");
    assert.deepEqual(
      wire(init.result.hostContext),
      {},
      "no theme is advertised, so the document keeps the OS scheme",
    );

    sent.length = 0;
    onMessage({
      source: contentWindow,
      data: { jsonrpc: "2.0", method: "ui/notifications/initialized" },
    });
    assert.deepEqual(
      sent.map((m) => m.method),
      ["ui/notifications/tool-input", "ui/notifications/tool-result"],
      "tool-input precedes tool-result",
    );
    const result = sent[1].params;
    assert.ok(Array.isArray(result.content), "content is a block ARRAY");
    assert.equal(result.content[0].type, "text");
    assert.equal(typeof result.content[0].text, "string");
    assert.deepEqual(
      wire(result.structuredContent),
      payload,
      "the payload rides on structuredContent",
    );
    assert.equal(
      documentElement.attributes["data-mv-preview"],
      "delivered",
      "delivery is observable from the document",
    );

    // Both are requests; unanswered they hang on the SDK's 60s timeout. They are
    // answered DIFFERENTLY on purpose. A link's result is discarded by the widgets'
    // link model, so an empty answer is unobservable. A chat message's is not:
    // `lib/actions.ts` reads anything but `isError: true` as delivered, and the views
    // render nothing on success — so an empty answer would turn every chat chip in a
    // preview into a dead control with no feedback. Refusing is what sends a widget
    // that checks the result — the dashboard does; handoffs and reports discard it —
    // down its own clipboard-then-manual ladder.
    const answers = {
      "ui/open-link": {},
      "ui/message": { isError: true },
    };
    for (const [method, expected] of Object.entries(answers)) {
      sent.length = 0;
      onMessage({ source: contentWindow, data: { jsonrpc: "2.0", id: 42, method } });
      assert.deepEqual(
        wire(sent),
        [{ jsonrpc: "2.0", id: 42, result: expected }],
        `${method} is answered`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("self-ignores the preview directory", async () => {
  const dir = project("ignore");
  try {
    assert.equal(runPreview(["help"], dir).status, 0);
    const gitignore = join(dir, ".marvin", "preview", ".gitignore");
    assert.ok(existsSync(gitignore), "the preview directory writes its own .gitignore");
    assert.equal(readFileSync(gitignore, "utf8").trim(), "*", "it ignores everything inside");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sizes the framed document to the viewport", async () => {
  const dir = project("layout");
  try {
    assert.equal(runPreview(["help"], dir).status, 0);
    const preview = readFileSync(previewPath(dir, "help"), "utf8");

    // An iframe with no height rule takes its intrinsic 150px and the panel shows as
    // a clipped strip; a 100%-height frame inside the UA's default 8px body margin
    // overflows into a scrollbar. Both rules are load-bearing, so both are pinned.
    const style = /<style>([\s\S]*?)<\/style>/.exec(preview)?.[1] ?? "";
    assert.match(style, /html,\s*body\s*\{[^}]*margin:\s*0/, "the body margin is zeroed");
    assert.match(style, /html,\s*body\s*\{[^}]*height:\s*100%/, "the page fills the window");
    assert.match(style, /iframe\s*\{[^}]*height:\s*100%/, "the frame fills the page");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exits with the tool's message when the call returns no payload", async () => {
  const dir = project("nopayload");
  try {
    // `task` with no action needs an elicitation the preview client cannot answer, so
    // it returns its instructive error instead. The client declares NO capabilities
    // precisely so this degrades to a message rather than hanging on a form nobody
    // will fill in.
    const run = runPreview(["task-list", "{}"], dir);
    assert.equal(run.status, 1, "the run fails");
    assert.equal(run.stdout.trim(), "", "stdout stays reserved for the path");
    assert.match(run.stderr, /returned no widget payload/);
    assert.match(
      run.stderr,
      /does not support interactive forms/,
      "the tool's own text is what the user is shown",
    );
    assert.ok(!existsSync(previewPath(dir, "task-list")), "no half-built preview is left behind");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
