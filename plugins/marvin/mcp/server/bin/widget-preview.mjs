#!/usr/bin/env node
/*
 * widget-preview — render a bound `ui://` widget, with this project's live data,
 * into one self-contained HTML file the user can open in a browser (ADR-0034).
 *
 *   node <plugin-root>/mcp/server/bin/widget-preview.mjs <widget> [toolArgsJson] [--open]
 *
 * WHY THIS EXISTS. A widget only renders on a host that resolves a tool's
 * `_meta.ui.resourceUri`. The Claude Code CLI does not — measured, it contains no
 * MCP Apps code at all — so `/marvin:help` shows markdown there and the whole widget
 * family is unreachable for marvin's primary audience. This is the escape hatch:
 * everything a rich host would do (call the tool, fetch the `ui://` document, run the
 * handshake, hand over the payload) happens here instead, and the result is a file.
 *
 * NOTHING IS HARD-CODED PER WIDGET. The binding is data the server already publishes:
 * `tools/list` carries each tool's `_meta.ui.resourceUri`, so the widget name selects
 * the tool, and the document comes from that same URI over `resources/read`. Add,
 * rename or rebind a widget and this file keeps working untouched.
 *
 * This is a plain, dependency-free script on purpose (spec 021-widget-preview-door):
 * a second `tsup` entry would duplicate ~1.2 MB of committed bundle for a command a
 * user runs by hand. It speaks the same stdio JSON-RPC as `scripts/mcp-call.mjs`.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The committed server bundle this drives (ADR-0013), next door in `dist/`. */
const SERVER_PATH = join(HERE, "..", "dist", "server.js");

/** Client-side protocol version, matching the stdio test driver. */
const PROTOCOL_VERSION = "2025-03-26";

/**
 * Fallback answer to the framed view's `ui/initialize` when it sends no version.
 * The view performs no negotiation, so echoing what it asked for is correct and
 * this constant is only ever reached by a malformed request.
 */
const UI_PROTOCOL_FALLBACK = "2025-11-21";

/** Generous: the whole run is four round trips against a locally spawned server. */
const TIMEOUT_MS = 30000;

/**
 * Report and stop. `process.exit` does not unwind, so the server child is killed
 * here rather than in a `finally` that would never run on a failure path. Without
 * it the spawned server survives until its stdin closes — which happens to work,
 * and is exactly the kind of implicit dependency worth not having in a script
 * whose whole job is owning a child process.
 */
function die(message) {
  process.stderr.write(`widget-preview: ${message}\n`);
  killServer();
  process.exit(1);
}

/** The spawned server, once there is one. `null` until then so `die()` is safe. */
let child = null;

/** Kill the spawned server if one is running. Safe before the spawn and twice. */
function killServer() {
  try {
    child?.kill();
  } catch {
    /* already gone */
  }
}

// ── arguments ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let openAfter = false;
const positional = [];
for (const arg of argv) {
  if (arg === "--open") openAfter = true;
  else positional.push(arg);
}

const widget = positional[0];
if (!widget || widget.startsWith("-")) {
  die("usage: widget-preview <widget> [toolArgsJson] [--open]  (e.g. widget-preview help)");
}

let toolArgs = {};
try {
  toolArgs = JSON.parse(positional[1] ?? "{}");
} catch (err) {
  die(`invalid tool arguments — expected JSON: ${err.message}`);
}

if (!existsSync(SERVER_PATH)) {
  die(`server bundle not found at ${SERVER_PATH} — run \`npm run build\` first.`);
}

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const widgetUri = `ui://marvin/${widget}.html`;

// ── stdio JSON-RPC client ────────────────────────────────────────────────────
// Deliberately declares NO capabilities. `scripts/mcp-call.mjs` declares
// `elicitation` so interactive tools run, but a preview has nobody to answer a
// form: with the capability declared, an elicitation-gated call (`task` with no
// action, say) would issue `elicitation/create` and hang until the timeout. With
// it undeclared, `canElicit` is false and the tool returns its instructive error
// instead — a message the user can act on.
// Declared before the spawn so `die()` can reach it from the argument-parsing
// failures above, where no child exists yet.
child = spawn(process.execPath, [SERVER_PATH], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
});

const pending = new Map();
let nextId = 1;
let buffer = "";

const timer = setTimeout(() => {
  child.kill();
  die(`timed out after ${TIMEOUT_MS}ms waiting for the marvin server`);
}, TIMEOUT_MS);

child.on("error", (err) => die(`could not start the server: ${err.message}`));
child.on("exit", (code) => {
  if (pending.size > 0) die(`the server exited early (code ${code ?? "null"})`);
});

// Decode through the stream's own StringDecoder. A per-chunk `chunk.toString()`
// decodes each pipe read in isolation, so a character whose UTF-8 bytes straddle a
// chunk boundary becomes U+FFFD on both sides of it — one character silently turning
// into three. The widget documents are ~300 KB with ~4% of their byte offsets sitting
// on a continuation byte, so whether it corrupts depends on how the kernel slices the
// read: reliably on a loaded machine, never on an idle one.
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue; // not our frame; the server never writes anything else to stdout
    }
    const entry = message.id != null ? pending.get(message.id) : undefined;
    if (!entry) continue;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message ?? "server error"));
    else entry.resolve(message.result);
  }
});

const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);

const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });

const notify = (method, params = {}) => send({ jsonrpc: "2.0", method, params });

// ── the run ──────────────────────────────────────────────────────────────────
try {
  await request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "marvin-widget-preview", version: "1.0.0" },
  });
  notify("notifications/initialized");

  const listed = await request("tools/list", {});
  const tools = listed?.tools ?? [];
  const tool = tools.find((t) => t?._meta?.ui?.resourceUri === widgetUri);
  if (!tool) {
    const bound = tools
      .map((t) => t?._meta?.ui?.resourceUri)
      .filter((uri) => typeof uri === "string")
      .map((uri) => uri.replace(/^ui:\/\/marvin\//, "").replace(/\.html$/, ""))
      .sort();
    die(`unknown widget "${widget}". Bound widgets: ${bound.join(", ") || "none"}`);
  }

  const called = await request("tools/call", { name: tool.name, arguments: toolArgs });
  const payload = called?.structuredContent;
  if (!payload) {
    // The tool ran but produced no widget payload — an empty board, a spec-less
    // project, or arguments it needs and did not get. Its own text says which, and
    // it is far more useful than anything this script could invent. stdout stays
    // empty so a scripted caller never mistakes a diagnostic for a path.
    const text = (called?.content ?? [])
      .map((block) => block?.text ?? "")
      .filter(Boolean)
      .join("\n");
    die(
      `the \`${tool.name}\` tool returned no widget payload.\n` +
        (text ? `${text}\n` : "") +
        `Pass arguments if the tool needs them, e.g. widget-preview ${widget} '{"action":"list"}'`,
    );
  }

  const document = await request("resources/read", { uri: widgetUri });
  const html = document?.contents?.[0]?.text;
  if (typeof html !== "string" || html.length === 0) {
    die(`the server returned no document for ${widgetUri}`);
  }

  const previewDir = join(projectDir, ".marvin", "preview");
  mkdirSync(previewDir, { recursive: true });
  // Self-ignoring directory, the `.marvin/usage/` convention (ADR-0030): a preview
  // is a derived artifact and must never reach a commit. Written once, never
  // overwritten, so a user who edits it keeps their edit.
  const gitignore = join(previewDir, ".gitignore");
  if (!existsSync(gitignore)) writeFileSync(gitignore, "*\n");

  const outPath = join(previewDir, `${widget}.html`);
  writeFileSync(outPath, composePreview({ widget, toolName: tool.name, html, payload, toolArgs }));

  process.stdout.write(`${outPath}\n`);
  if (openAfter) openInBrowser(outPath);
} catch (err) {
  die(err.message);
} finally {
  clearTimeout(timer);
  killServer();
}

// ── composition ──────────────────────────────────────────────────────────────

/**
 * One self-contained document: the widget, its payload, and a host that speaks the
 * five messages the framed view needs.
 *
 * The widget document is embedded base64-encoded and assigned through `srcdoc` from
 * script, which removes two whole failure classes rather than mitigating them. HTML
 * escaping cannot go wrong because the document never appears as markup, and there is
 * no cross-origin question because nothing is loaded from a second URL — the file
 * behaves identically opened from disk, served over HTTP, or copied to another machine.
 *
 * `atob` alone would not do: it yields a binary string, and the widget documents are
 * UTF-8 with em dashes and arrows in them, so the decode goes through `TextDecoder`.
 * Skipping that renders mojibake in the wordmark.
 */
function composePreview({ widget, toolName, html, payload, toolArgs }) {
  const encodedDoc = Buffer.from(html, "utf8").toString("base64");
  // `<` is escaped so neither block can terminate its own <script> element.
  const payloadJson = JSON.stringify(payload).replace(/</g, "\\u003c");
  const argsJson = JSON.stringify(toolArgs ?? {}).replace(/</g, "\\u003c");
  const label = `marvin · ${widget}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${label}</title>
    <style>
      /* The frame fills the window. Without this the iframe takes its intrinsic
         150px height and the panel shows as a clipped strip — a failure that looks
         like a broken widget rather than a missing style. The zeroed margin is
         load-bearing too: the UA default is 8px, which a 100%-height frame would
         overflow into a scrollbar. */
      :root {
        color-scheme: light dark;
      }
      html,
      body {
        margin: 0;
        padding: 0;
        height: 100%;
      }
      iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
      }
    </style>
  </head>
  <body>
    <iframe id="mv-frame" title="${label}" sandbox="allow-scripts"></iframe>
    <script type="text/plain" id="mv-doc">${encodedDoc}</script>
    <script type="application/json" id="mv-payload">${payloadJson}</script>
    <script type="application/json" id="mv-args">${argsJson}</script>
    <script>
      (function () {
        var frame = document.getElementById("mv-frame");
        var payload = JSON.parse(document.getElementById("mv-payload").textContent);
        var toolArguments = JSON.parse(document.getElementById("mv-args").textContent);

        function send(message) {
          if (frame.contentWindow) frame.contentWindow.postMessage(message, "*");
        }
        function respond(id, result) {
          send({ jsonrpc: "2.0", id: id, result: result });
        }

        // The peer is identified by window identity, never by origin — the same check
        // the SDK's own transport makes, which is why a sandboxed frame with an opaque
        // origin still connects.
        window.addEventListener("message", function (event) {
          if (event.source !== frame.contentWindow) return;
          var message = event.data;
          if (!message || message.jsonrpc !== "2.0" || !message.method) return;

          if (message.method === "ui/initialize") {
            if (message.id === undefined) return;
            var requested = message.params && message.params.protocolVersion;
            respond(message.id, {
              // Echoed, not pinned: the view does no negotiation, so answering with
              // whatever it asked for is what keeps this host version-proof.
              protocolVersion: typeof requested === "string" ? requested : ${JSON.stringify(UI_PROTOCOL_FALLBACK)},
              hostInfo: { name: "marvin-widget-preview", version: "1.0.0" },
              // Advertised to match what a real host offers for the widgets' link
              // model. The SDK gates only sampling on capabilities, so this changes
              // nothing observable today; it is here so a view that DOES start
              // feature-detecting sees the same shape the site's host advertises.
              hostCapabilities: { openLinks: {} },
              // Deliberately empty. Advertising a theme here would override the OS
              // scheme the family falls back to when the host is silent.
              hostContext: {},
            });
            return;
          }

          if (message.method === "ui/notifications/initialized") {
            // Order is part of the contract: tool-input precedes tool-result.
            send({
              jsonrpc: "2.0",
              method: "ui/notifications/tool-input",
              params: { arguments: toolArguments },
            });
            send({
              jsonrpc: "2.0",
              method: "ui/notifications/tool-result",
              params: {
                // \`content\` is REQUIRED alongside structuredContent, and must be the
                // block array — a string or a bare object fails the view's schema
                // parse, the SDK swallows the error, and the panel sits on
                // "Connecting…" forever with nothing in the console.
                content: [{ type: "text", text: ${JSON.stringify(`marvin ${toolName} preview`).replace(/</g, "\\u003c")} }],
                structuredContent: payload,
              },
            });
            // A handshake signal on the outer document. The framed view has no
            // outward-visible "ready" state, so without this any harness — the test
            // suite, a browser check by hand — has to poll rendered text and guess.
            document.documentElement.setAttribute("data-mv-preview", "delivered");
            return;
          }

          // Both are REQUESTS. Unanswered, they hang on the SDK's 60s request timeout,
          // so a link or a chat action would freeze the preview instead of no-opping.
          if (message.method === "ui/open-link") {
            // Unobservable today: the widgets' link model discards the result. It is
            // not strictly truthful — the preview opens nothing — and \`isError\` would
            // be the durable answer here too, for the same reason it is below.
            if (message.id !== undefined) respond(message.id, {});
            return;
          }

          if (message.method === "ui/message") {
            // REFUSED, not accepted. A preview has no chat to deliver into, and
            // \`isError\` is the protocol's word for exactly that. An empty result
            // reads as SUCCESS to the widget layer (lib/actions.ts: \`isError !== true\`),
            // and the views deliberately render nothing on success — so every chat
            // affordance in a previewed panel would be a dead control with no
            // feedback at all. Refusing sends a widget that CHECKS the result down its
            // own fallback ladder instead: clipboard first, then a manual reveal of the
            // command. Only the dashboard checks today — the handoffs and reports
            // widgets discard it, so their chat controls stay inert in a preview
            // either way. Refusing is still the honest answer, and it is what they
            // would need the day they start checking.
            if (message.id !== undefined) respond(message.id, { isError: true });
            return;
          }
        });

        // Listener first, then boot the frame: the view sends ui/initialize as soon as
        // it runs, and a listener attached afterwards would miss it.
        var encoded = document.getElementById("mv-doc").textContent.trim();
        var bytes = Uint8Array.from(atob(encoded), function (c) {
          return c.charCodeAt(0);
        });
        frame.srcdoc = new TextDecoder().decode(bytes);
      })();
    </script>
  </body>
</html>
`;
}

/**
 * Hand the file to the platform opener. Best effort by design: a headless machine
 * has already been told the path on stdout, and failing the run over a missing
 * `xdg-open` would be worse than useless.
 */
function openInBrowser(path) {
  // On Windows the opener is a `cmd` builtin, and its first quoted argument is read
  // as the WINDOW TITLE — `start "<path>"` opens an empty console for any path with
  // a space in it. The empty title argument is what makes the path a path.
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [path]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", path]]
        : ["xdg-open", [path]];
  try {
    const opener = spawn(command, args, { stdio: "ignore", detached: true });
    opener.on("error", () => {});
    opener.unref();
  } catch {
    // ignored — the path is already on stdout
  }
}
