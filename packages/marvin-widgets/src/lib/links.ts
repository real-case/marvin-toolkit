import type { LinkRef } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * The widget link model (ADR-0024). Every marvin artifact stores links as data
 * (`LinkRef`) and the widget layer renders them through one of three behaviours,
 * keyed off which field is populated:
 *
 *  - `url` present → external navigation, opened through the host (`app.openLink`).
 *  - `ref` present → internal navigation, routed inside the widget (no host call).
 *  - neither       → an advisory chat action, keyed off `kind`. `LinkRef` carries
 *                    no chat-action payload, so this slice surfaces the label only
 *                    (no live `sendMessage` / `callServerTool` round-trip yet).
 *
 * `url` wins over `ref` when both are present (open the canonical target).
 */
export type LinkAction =
  | { type: "external"; url: string; label: string }
  | { type: "internal"; ref: string; label: string }
  | { type: "chat"; kind: LinkRef["kind"]; label: string };

/** Pure mapping from a stored `LinkRef` to the behaviour it triggers. */
export function classifyLink(link: LinkRef): LinkAction {
  if (link.url) return { type: "external", url: link.url, label: link.label };
  if (link.ref) return { type: "internal", ref: link.ref, label: link.label };
  return { type: "chat", kind: link.kind, label: link.label };
}

/**
 * The subset of the ext-apps `App` this module needs — the host-mediated
 * `openLink`. Kept structural so `links.ts` stays decoupled from the SDK types
 * and is trivially faked in tests.
 */
export interface LinkHost {
  openLink(params: { url: string }): Promise<unknown>;
}

/**
 * Perform a link's behaviour. External links open through the host; internal
 * links are returned for the widget to route in place; the advisory chat branch
 * is label-only this slice (no host round-trip). Returns the resolved
 * {@link LinkAction} so the caller can react to internal/chat cases.
 */
export async function dispatchLink(host: LinkHost, link: LinkRef): Promise<LinkAction> {
  const action = classifyLink(link);
  if (action.type === "external") {
    await host.openLink({ url: action.url });
  }
  return action;
}
