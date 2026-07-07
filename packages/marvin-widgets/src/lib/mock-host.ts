import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/**
 * A widget-agnostic seam: an ext-apps `App` plus the transport its widget
 * connects. It is structurally identical to each widget's own `*Seam` type
 * (`TaskListSeam`, `TaskDetailSeam`, …), so a host's `seam` drops straight into
 * any widget's `seam` prop without a per-widget mock host.
 */
export interface WidgetSeam {
  app: App;
  transport: NonNullable<Parameters<App["connect"]>[0]>;
}

export interface MockHost {
  /** Inject into a widget's `seam` prop. */
  seam: WidgetSeam;
  /**
   * URLs the widget opened via `app.openLink` (→ `ui/open-link`), in call order.
   * Recorded by the host bridge's `onopenlink` handler, so a test can assert the
   * external-link path (ADR-0024 #6) end-to-end through the real SDK, not a spy.
   */
  openedLinks: string[];
  /**
   * Connect the host (`AppBridge`) side and arm delivery: once the view completes
   * the `ui/initialize` handshake, the host pushes a tool-input then the
   * tool-result carrying `payload`. Call before the widget connects its App.
   */
  start(): Promise<void>;
  /** Tear down both protocol peers. Best-effort. */
  close(): void;
}

/**
 * A fake ext-apps host over an in-memory `Transport` pair (the MCP SDK
 * `InMemoryTransport` pattern) — NOT `PostMessageTransport`. It round-trips the
 * real handshake (`ui/initialize` → `ui/notifications/initialized`) and a
 * `ui/notifications/tool-result` whose `structuredContent` is `payload`, entirely
 * inside vitest/happy-dom with no dependency on `window.parent` (which is
 * `=== window` under happy-dom, so a same-window postMessage handshake can't be
 * proven). Both sides run the real SDK, so the handshake shapes are never guessed.
 *
 * Generic over the payload so every widget (task-list, task-detail, …) shares one
 * host: pass the widget's own `structuredContent` payload and it is delivered
 * verbatim, exactly as a real host forwards a tool result.
 */
export function createMockHost(
  payload: Record<string, unknown>,
  appName = "marvin-widget-mock",
): MockHost {
  const [appTransport, hostTransport] = InMemoryTransport.createLinkedPair();

  const app = new App(
    { name: appName, version: "0.0.0-test" },
    {},
    // happy-dom lacks ResizeObserver; disable auto-resize so connect() stays
    // headless. Production (useApp) keeps the default.
    { autoResize: false },
  );

  // Advertise the `openLinks` host capability (matches the ext-apps host ctor
  // examples) so `app.openLink` round-trips here. Additive — the task-list and
  // task-detail suites never call openLink, so their handshakes are unaffected.
  const bridge = new AppBridge(
    null,
    { name: "marvin-mock-host", version: "0.0.0-test" },
    { openLinks: {} },
  );

  // Record every link the widget opens via `app.openLink` → `ui/open-link`. This
  // is the seam a test asserts the external-link path against (ADR-0024 #6).
  const openedLinks: string[] = [];
  bridge.onopenlink = ({ url }) => {
    openedLinks.push(url);
    return Promise.resolve({});
  };

  return {
    seam: { app, transport: appTransport },
    openedLinks,
    async start() {
      bridge.addEventListener("initialized", () => {
        // The host MUST send tool-input before tool-result (ext-apps contract).
        void (async () => {
          await bridge.sendToolInput({ arguments: {} });
          await bridge.sendToolResult({
            content: [{ type: "text", text: "widget payload" }],
            structuredContent: payload,
          });
        })();
      });
      await bridge.connect(hostTransport);
    },
    close() {
      try {
        void app.close();
      } catch {
        /* already closed */
      }
      try {
        void bridge.close();
      } catch {
        /* already closed */
      }
    },
  };
}
