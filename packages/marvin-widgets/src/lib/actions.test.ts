import { describe, it, expect, vi, afterEach } from "vitest";
import { runChatAction, type ChatActionHost } from "./actions";

/**
 * The chat-action ladder (spec dashboard-widget-rework, AC4).
 *
 * Each rung is asserted so that a wrong implementation produces a DIFFERENT
 * result, not merely so the right one passes. The case that matters most is
 * `{ isError: true }`: a host refusal that RESOLVES. An implementation that
 * only catches rejections returns "sent" there, and every other case in this
 * file still passes — which is exactly how the two existing call sites
 * (HandoffsWidget, ReportsWidget) silently treat a refusal as success today.
 */

/** Stub the async clipboard and return its writeText spy. */
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

/** Mask the clipboard AND execCommand, so no copy path can land. */
function denyClipboard() {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  (document as unknown as Record<string, unknown>).execCommand = vi.fn(() => false);
}

afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).clipboard;
  delete (document as unknown as Record<string, unknown>).execCommand;
  vi.restoreAllMocks();
});

/** A host whose sendMessage resolves with the given result. */
const hostResolving = (result: { isError?: boolean } = {}): ChatActionHost => ({
  sendMessage: vi.fn().mockResolvedValue(result),
});

describe("runChatAction — the send → copy → manual ladder", () => {
  it("sends and does NOT touch the clipboard when the host resolves without isError", async () => {
    const writeText = stubClipboard();
    const host = hostResolving();

    await expect(runChatAction(host, "/marvin:track-list")).resolves.toBe("sent");

    expect(host.sendMessage).toHaveBeenCalledWith({
      role: "user",
      content: [{ type: "text", text: "/marvin:track-list" }],
    });
    // the clipboard is the FALLBACK — touching it on the happy path would mean
    // the user's clipboard is silently overwritten by every successful action
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies when the host REJECTS", async () => {
    const writeText = stubClipboard();
    const host: ChatActionHost = { sendMessage: vi.fn().mockRejectedValue(new Error("no host")) };

    await expect(runChatAction(host, "/marvin:reports")).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("/marvin:reports");
  });

  it("copies when the host RESOLVES with { isError: true } — the refusal a naive await swallows", async () => {
    const writeText = stubClipboard();
    const host = hostResolving({ isError: true });

    // McpUiMessageResult.isError is "true if the host rejected or failed to
    // deliver the message". An implementation that only catches rejections
    // returns "sent" here and never copies, leaving the affordance dead.
    await expect(runChatAction(host, "/marvin:sec-scan")).resolves.toBe("copied");
    expect(host.sendMessage).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("/marvin:sec-scan");
  });

  it("still sends when the host resolves with an explicit { isError: false }", async () => {
    const writeText = stubClipboard();

    await expect(runChatAction(hostResolving({ isError: false }), "/marvin:handoff")).resolves.toBe(
      "sent",
    );
    // pins that the check is `isError === true`, not merely "an isError key is
    // present" — a host that always reports the field would otherwise never send
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies without attempting a send when the host is null", async () => {
    const writeText = stubClipboard();

    await expect(runChatAction(null, "/marvin:track-new")).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("/marvin:track-new");
  });

  it("reports manual when the send is refused AND no clipboard write lands", async () => {
    denyClipboard();

    await expect(runChatAction(hostResolving({ isError: true }), "/marvin:handoff")).resolves.toBe(
      "manual",
    );
  });

  it("falls through to execCommand when the async clipboard throws", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")),
      },
      configurable: true,
    });
    const execCommand = vi.fn(() => true);
    (document as unknown as Record<string, unknown>).execCommand = execCommand;

    await expect(runChatAction(null, "/marvin:track-config")).resolves.toBe("copied");
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("never throws, whatever the host does", async () => {
    denyClipboard();
    const exploding: ChatActionHost = {
      sendMessage: vi.fn(() => {
        throw new Error("synchronous explosion");
      }),
    };

    await expect(runChatAction(exploding, "/marvin:dashboard")).resolves.toBe("manual");
  });
});
