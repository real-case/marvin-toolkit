/**
 * A stub MCP server that answers `resources/read` in TWO writes split INSIDE a
 * multibyte character.
 *
 * WHY THIS EXISTS. A stdio client that decodes each stdout chunk on its own
 * (`buf += chunk.toString()`) corrupts any character whose UTF-8 bytes straddle a
 * chunk boundary: the trailing bytes of the first chunk and the leading bytes of the
 * second each decode to U+FFFD, so one character becomes three and the payload is
 * silently wrong by two characters. Against the real server that depends on how the
 * kernel happens to slice a ~300 KB document into pipe reads — 4.3% of byte offsets
 * in `help.html` are continuation bytes, so it reproduces on a loaded CI runner and
 * hides on an idle laptop. That is not a property a test can assert on.
 *
 * So the boundary is placed here instead of being waited for. The split is exact and
 * the delay between the writes makes two `data` events certain, which turns a race
 * into a fact: any client that decodes per chunk fails this every time, and one that
 * decodes through a streaming decoder passes it every time.
 *
 * Copied over `dist/server.js` next to a copy of the real `bin/widget-preview.mjs`,
 * which resolves its server as `../dist/server.js`. See widget-preview.test.mjs.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The widget name the stub binds, matching the real `ui://marvin/<name>.html` shape. */
export const WIDGET = "help";

/** The tool the widget is bound to. Deliberately NOT named after the widget. */
export const TOOL = "help";

/**
 * The document served as the widget. The em dash is the character the write is split
 * inside; the arrow and Khmer letter stand in for the rest of what the real documents
 * carry (zod's bundled locale strings are where the production corruption landed).
 */
export const DOCUMENT = [
  "<!doctype html>",
  "<title>marvin — split-write fixture</title>",
  "<p>an em dash — an arrow → and Khmer ល</p>",
  "</html>",
  "",
].join("\n");

/** The payload the stub's tool returns, echoed back through the preview. */
export const PAYLOAD = { fixture: "split-write", note: "em dash — survives" };

function serve() {
  const uri = `ui://marvin/${WIDGET}.html`;
  const reply = (id, result) =>
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);

  process.stdin.setEncoding("utf8");
  let buf = "";
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id == null) continue; // notifications need no answer

      if (msg.method === "initialize") {
        reply(msg.id, {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "marvin-split-write-stub", version: "0" },
        });
      } else if (msg.method === "tools/list") {
        reply(msg.id, { tools: [{ name: TOOL, _meta: { ui: { resourceUri: uri } } }] });
      } else if (msg.method === "tools/call") {
        reply(msg.id, {
          content: [{ type: "text", text: "stub" }],
          structuredContent: PAYLOAD,
        });
      } else if (msg.method === "resources/read") {
        writeSplit(msg.id, uri);
      }
    }
  });
}

/**
 * The whole point of the fixture: one JSON-RPC line, written as two chunks whose
 * boundary falls between the first and second byte of the em dash.
 */
function writeSplit(id, uri) {
  const line = `${JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      contents: [{ uri, mimeType: "text/html;profile=mcp-app", text: DOCUMENT }],
    },
  })}\n`;

  const bytes = Buffer.from(line, "utf8");
  // +1 lands after the em dash's lead byte, leaving its two continuation bytes for
  // the next chunk. An assertion rather than a search result: if the document ever
  // loses its em dash this must fail loudly, not silently stop splitting anything.
  const at = bytes.indexOf(Buffer.from("—", "utf8")) + 1;
  if (at <= 0) throw new Error("fixture document has no em dash to split");

  process.stdout.write(bytes.subarray(0, at));
  // Two writes are not two reads unless the reader is given the chance to wake up in
  // between. Without the gap the kernel coalesces them and the fixture proves nothing.
  setTimeout(() => process.stdout.write(bytes.subarray(at)), 30);
}

// Runs as a server only when executed; importing it for the constants above must not
// start reading stdin.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) serve();
