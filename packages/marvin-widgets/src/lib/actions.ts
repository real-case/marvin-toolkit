/**
 * The shared chat-action primitive for the widget family (ADR-0024).
 *
 * A widget affordance means "run this marvin command". The host may or may not
 * accept that: `ui/message` is an optional capability, so every affordance needs
 * a degradation path rather than a single call that quietly fails. This module
 * owns that ladder once, beside {@link ./links.ts} and {@link ./format.ts}:
 *
 *   1. **send**  — `app.sendMessage`, the real thing: the command lands in the
 *                  conversation and the host runs it.
 *   2. **copy**  — the clipboard, so the user pastes it themselves.
 *   3. **manual** — neither landed; the caller reveals the command text for a
 *                  select-on-click ⌘C.
 *
 * **Refusal is not only a rejection.** `McpUiMessageResult` carries
 * `isError?: boolean` — "true if the host rejected or failed to deliver the
 * message" — so a host that declines RESOLVES with `{ isError: true }` rather
 * than throwing. `McpUiHostCapabilities` has no messaging flag either, so there
 * is nothing to feature-detect up front: a refusal is only ever observable
 * after the call. Treating the resolved-refusal case as success is the whole
 * failure mode this module exists to prevent, and it is exactly what a naive
 * `void app.sendMessage(...).catch(() => {})` does.
 *
 * A `null` host is a refusal too, not a silent no-op: pure-render contexts
 * (stories, tests) still put the command on the clipboard, which is the most
 * useful thing available when there is no conversation to send to.
 *
 * This module never touches the DOM beyond the clipboard write. The "manual"
 * reveal belongs to the view, which owns the element to select — see
 * `ReportsWidget`'s `useManualSelect`.
 */

/**
 * The slice of the ext-apps `App` this module needs. Structural, like
 * {@link ./links.ts}'s `LinkHost`, so nothing here depends on the SDK types and
 * a fake host is a two-line object literal in tests. A real `App` satisfies it:
 * its `sendMessage` returns `Promise<{ [x: string]: unknown; isError?: boolean }>`,
 * and `{ type: "text"; text: string }[]` is assignable to `ContentBlock[]`.
 */
export interface ChatActionHost {
  sendMessage(params: {
    role: "user";
    content: { type: "text"; text: string }[];
  }): Promise<{ isError?: boolean }>;
}

/** Which rung of the ladder the command actually reached. */
export type ChatActionResult = "sent" | "copied" | "manual";

/**
 * Ask the host to run `command`, degrading to the clipboard and then to a
 * caller-rendered manual reveal. Never throws.
 */
export async function runChatAction(
  host: ChatActionHost | null,
  command: string,
): Promise<ChatActionResult> {
  if (await trySend(host, command)) return "sent";
  return (await copyText(command)) ? "copied" : "manual";
}

/**
 * True only when the host accepted the message. A rejected promise and a
 * resolved `{ isError: true }` are the same answer — the host did not take it.
 */
async function trySend(host: ChatActionHost | null, command: string): Promise<boolean> {
  if (!host) return false;
  try {
    const result = await host.sendMessage({
      role: "user",
      content: [{ type: "text", text: command }],
    });
    return result?.isError !== true;
  } catch {
    return false;
  }
}

/**
 * Copy through the async clipboard API when the host grants it, else the classic
 * hidden-textarea + `execCommand` path. Returns whether the text actually
 * reached the clipboard: a sandboxed host that blocks both yields `false`, which
 * is what sends the caller to the manual reveal. Mirrors the implementation this
 * generalises from `ReportsWidget`.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the execCommand attempt */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    try {
      area.select();
      return document.execCommand("copy") === true;
    } finally {
      area.remove();
    }
  } catch {
    return false; // clipboard unavailable in this host — nothing further to try
  }
}

/**
 * Select an element's contents — the "manual" rung's other half, which the view
 * calls once {@link runChatAction} reports `manual`. Best-effort, never throws.
 */
export function selectNodeText(el: HTMLElement | null): void {
  if (!el || typeof window === "undefined") return;
  const selection = window.getSelection?.();
  if (!selection) return;
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  } catch {
    /* selection is best-effort — the revealed text stays hand-selectable */
  }
}
