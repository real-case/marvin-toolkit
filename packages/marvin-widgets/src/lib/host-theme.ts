import { useEffect, useState } from "react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { MvTheme } from "../theme";

/**
 * The shared host-theme resolver for the widget family (ADR-0024).
 *
 * An MCP host advertises its light/dark appearance over the protocol, in the
 * `theme` field of the host context. Until this module existed nothing in
 * `packages/marvin-widgets/src` read it, so every widget followed the operating
 * system's `prefers-color-scheme` instead and a dark host rendered a light
 * widget whenever the OS was light. This hook is the one place that reads it;
 * each widget forwards the result to its view's `theme` prop, which `MvRoot`
 * turns into the `data-theme` attribute the token overrides key on.
 *
 * **Why one shared expression rather than per-widget code.** `useApp()` cannot
 * be driven under happy-dom, so only the seam wiring is reachable from a test
 * (see `DashboardWidget.tsx`'s transport-seam note). Two separate
 * implementations would mean the covered path and the SHIPPED path were
 * different code. Both wirings calling this hook is what transfers the seam
 * tests' coverage to production — the same reasoning that produced
 * {@link ./actions.ts}'s `runChatAction`.
 *
 * **Why the effect both reads and subscribes.** The SDK asks that handlers be
 * registered before `connect()` so no notification is missed, and `useApp()`
 * connects internally — it publishes its `app` only after `connect()` resolves,
 * so this effect can only ever run post-handshake. The seeding read is
 * therefore not an optimisation but the only way the INITIAL context is ever
 * observed. It also recovers anything the subscription missed: the SDK merges
 * notification params into the internal host context before any handler fires,
 * so `getHostContext()` is authoritative in both cases and one read path serves
 * both. That is also why the listener ignores its params and re-reads instead —
 * a partial notification can never produce a half-applied theme.
 *
 * **Why `connected` is a parameter.** On the seam path the App identity is
 * stable across the handshake, so an effect keyed only on `app` would never
 * re-run to observe the initial context. The caller already tracks the
 * connection state; passing it in is what makes the effect re-run at the moment
 * there is something to read.
 *
 * **Why `addEventListener` rather than the `onhostcontextchanged` setter.** The
 * setter is deprecated, and assignment replaces any previously-registered
 * handler — it would make this resolver mutually exclusive with every other
 * consumer of the same event.
 *
 * **A dropped connection keeps the last theme.** The effect returns early once
 * `connected` goes false, and the resolved value stays in state rather than
 * reverting to undefined. That is deliberate: clearing it would flash the widget
 * back to the OS scheme at the exact moment it is already showing an error, and
 * the host's appearance has not changed just because the transport failed.
 *
 * This module never touches the DOM. A resolver that wrote `data-theme` itself
 * would stop being provable through the seam, and would compete with the
 * website's embed host, which sets the attribute on the framed `.mvroot` by
 * hand (`packages/site/src/components/WidgetDemo.tsx`).
 *
 * @param app The widget's connected `App`, or null before one exists.
 * @param connected Whether the handshake has completed.
 * @returns The host's advertised theme, or `undefined` when it advertises none
 *   — in which case `MvRoot` renders no `data-theme` and `prefers-color-scheme`
 *   still governs. Returning a concrete default instead would override both the
 *   OS scheme and the website host's deliberate write.
 */
export function useHostTheme(app: App | null, connected: boolean): MvTheme | undefined {
  const [theme, setTheme] = useState<MvTheme | undefined>(undefined);

  useEffect(() => {
    if (!app || !connected) return;

    const readTheme = () => setTheme(app.getHostContext()?.theme);

    readTheme();
    app.addEventListener("hostcontextchanged", readTheme);
    return () => app.removeEventListener("hostcontextchanged", readTheme);
  }, [app, connected]);

  return theme;
}
