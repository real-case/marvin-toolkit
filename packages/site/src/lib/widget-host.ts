// widget-host.ts (spec 011-website-widget-embeds, F3) — a minimal MCP Apps host over postMessage.
//
// The committed widget documents (plugins/marvin/widgets/*.html, copied to /widget-demos/ by
// scripts/gen-widget-demos.mjs) are real MCP Apps views: each mounts with no seam, so it runs the
// production `useApp()` path, which hard-wires an ext-apps `PostMessageTransport` aimed at
// `window.parent`. Framed on this site, that parent is us — so the page only has to answer.
//
// We speak the wire directly instead of importing `@modelcontextprotocol/ext-apps` + the MCP SDK.
// That bundle is ~95% zod and is precisely what makes each widget document ~300 KB; pulling it into
// the site's own JavaScript would undo the near-zero-JS budget the static phases hold. The surface
// actually required is one request, two notifications, and two request answers — this file.
//
// Verified against the SDK rather than guessed:
//   - `PostMessageTransport` sends with `postMessage(message, "*")` and validates the peer by
//     `event.source`, NOT by origin — so a sandboxed frame with an opaque origin still connects.
//   - `event.data` IS the raw JSON-RPC message; there is no envelope.
//   - `ui/initialize`'s result requires all four of protocolVersion / hostInfo / hostCapabilities /
//     hostContext, and the view performs NO version negotiation on it — echoing the requested
//     version back is safe.
//   - `ui/notifications/tool-result` requires `content` as well as `structuredContent`. Omitting it
//     fails the view's zod parse, and the SDK swallows notification-handler errors — so the frame
//     would sit on "Connecting…" forever with nothing in the console. This is the single most
//     likely way to break a demo; keep `content` present.
//
// Shapes are pinned from node_modules/@modelcontextprotocol/ext-apps/dist/src/generated/schema.json.

/** JSON-RPC 2.0, the subset that crosses this boundary. */
interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

export interface WidgetHostHandle {
  /** Resolves once the tool result was delivered; rejects if the handshake stalls past the timeout. */
  ready: Promise<void>;
  /** Detach listeners and cancel the timer. Safe to call twice. */
  dispose(): void;
}

export interface WidgetHostOptions {
  /** The frame running the widget document. Must already be in the document. */
  iframe: HTMLIFrameElement;
  /** The widget's fixture, delivered verbatim as the tool result's `structuredContent`. */
  payload: Record<string, unknown>;
  /** How long to wait for the handshake before giving up. */
  timeoutMs?: number;
  /** Called on `ui/notifications/size-changed` so the caller can size the frame. */
  onResize?: (height: number) => void;
}

const PROTOCOL_VERSION_FALLBACK = "2025-11-21";
const DEFAULT_TIMEOUT_MS = 4000;

/**
 * Drive one framed widget through the MCP Apps handshake and hand it a fixture.
 *
 * Call this in the SAME synchronous task in which the frame is created: the listener must be
 * attached before the framed document boots, or its `ui/initialize` request lands with nobody
 * listening and the demo stalls until the timeout.
 */
export function mountWidgetHost({
  iframe,
  payload,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onResize,
}: WidgetHostOptions): WidgetHostHandle {
  let settled = false;
  let timer: number | undefined;
  let resolveReady!: () => void;
  let rejectReady!: (reason: Error) => void;

  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  // `ready` rejects on timeout AND on dispose, so a caller that tears a stage down without
  // awaiting would raise an unhandled rejection. Today's caller always awaits, but this file is
  // meant to be a drop-in seam for an ext-apps AppBridge, and that trap should not be part of the
  // contract it hands its replacement. A no-op handler marks the promise as observed; callers that
  // do await still see the rejection.
  void ready.catch(() => {});

  const send = (message: JsonRpcMessage) => {
    // The frame can be torn down mid-flight (a fast Screenshot toggle); a missing contentWindow is
    // an ordinary race, not an error.
    iframe.contentWindow?.postMessage(message, "*");
  };

  const respond = (id: string | number, result: Record<string, unknown>) =>
    send({ jsonrpc: "2.0", id, result });

  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    if (error) rejectReady(error);
    else resolveReady();
  };

  const onMessage = (event: MessageEvent) => {
    // Same check the SDK's own transport makes: identity of the peer window, never its origin.
    if (event.source !== iframe.contentWindow) return;
    const message = event.data as JsonRpcMessage | undefined;
    if (!message || message.jsonrpc !== "2.0" || !message.method) return;

    switch (message.method) {
      case "ui/initialize": {
        if (message.id === undefined) return;
        const requested = message.params?.protocolVersion;
        respond(message.id, {
          protocolVersion: typeof requested === "string" ? requested : PROTOCOL_VERSION_FALLBACK,
          hostInfo: { name: "marvin-site-demo", version: "1.0.0" },
          // `openLinks` is advertised because the widgets' link model calls `app.openLink`; the
          // rest of the host capabilities are genuinely absent here (no server to proxy to).
          hostCapabilities: { openLinks: {} },
          hostContext: {},
        });
        return;
      }

      case "ui/notifications/initialized": {
        // Ordering is part of the contract: tool-input must precede tool-result.
        send({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: {} } });
        send({
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: {
            // Required by the schema — see the header note. Also the text a terminal-only host
            // would render, which is what this demo stands in for.
            content: [{ type: "text", text: "marvin widget demo" }],
            structuredContent: payload,
          },
        });
        finish();
        return;
      }

      case "ui/notifications/size-changed": {
        const height = message.params?.height;
        if (typeof height === "number" && height > 0) onResize?.(height);
        return;
      }

      // Both of these are REQUESTS. Left unanswered they hang until the SDK's 60 s request timeout,
      // so a demo link-out or the reports Sync button would freeze rather than no-op. The demos are
      // deliberately inert (spec Non-goals) — answering keeps them honest instead of broken.
      case "ui/open-link":
      case "ui/message": {
        if (message.id !== undefined) respond(message.id, {});
        return;
      }

      default:
        return;
    }
  };

  window.addEventListener("message", onMessage);
  timer = window.setTimeout(
    () => finish(new Error(`widget handshake did not complete within ${timeoutMs}ms`)),
    timeoutMs,
  );

  return {
    ready,
    dispose() {
      window.removeEventListener("message", onMessage);
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      // A disposed host must not leave `ready` pending forever for an awaiting caller.
      finish(new Error("widget host disposed"));
    },
  };
}
