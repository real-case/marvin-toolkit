import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { TaskListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import type { TaskListSeam } from "../widgets/task-list/TaskListWidget";

export interface MockHost {
  /** Inject into `TaskListWidget`'s `seam` prop. */
  seam: TaskListSeam;
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
 * `ui/notifications/tool-result` whose `structuredContent` is a `TaskListPayload`,
 * entirely inside vitest/happy-dom with no dependency on `window.parent` (which
 * is `=== window` under happy-dom, so a same-window postMessage handshake can't be
 * proven). Both sides run the real SDK, so the handshake shapes are never guessed.
 *
 * Shared by the AC3 vitest integration test (F12) and the mock-host story (F15).
 */
export function createMockHost(payload: TaskListPayload): MockHost {
  const [appTransport, hostTransport] = InMemoryTransport.createLinkedPair();

  const app = new App(
    { name: "marvin-task-list", version: "0.0.0-test" },
    {},
    // happy-dom lacks ResizeObserver; disable auto-resize so connect() stays
    // headless. Production (useApp) keeps the default.
    { autoResize: false },
  );

  const bridge = new AppBridge(null, { name: "marvin-mock-host", version: "0.0.0-test" }, {});

  return {
    seam: { app, transport: appTransport },
    async start() {
      bridge.addEventListener("initialized", () => {
        // The host MUST send tool-input before tool-result (ext-apps contract).
        void (async () => {
          await bridge.sendToolInput({ arguments: {} });
          await bridge.sendToolResult({
            content: [{ type: "text", text: "task list" }],
            structuredContent: payload as unknown as Record<string, unknown>,
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
