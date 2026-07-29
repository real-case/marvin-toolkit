---
id: a-host-refusing-sendmessage-resolves
type: gotcha
title: A host refusing sendMessage RESOLVES with isError — a widget action that
  only catches rejections is silently dead
created: 2026-07-29
tags: mcp-apps, widgets, ext-apps, sendMessage, silent-failure, actions, testing
source: dashboard-widget-rework
---

`app.sendMessage` in `@modelcontextprotocol/ext-apps` reports a host refusal as a RESOLVED `{ isError: true }`, not a rejected promise (`dist/src/spec.types.d.ts:113` — "true if the host rejected or failed to deliver the message"), and `McpUiHostCapabilities` carries NO messaging flag, so there is nothing to feature-detect beforehand: a refusal is only ever observable after the call. The idiom both pre-existing call sites use — `void app.sendMessage(...).catch(() => {})` at `HandoffsWidget.tsx:548` and `ReportsWidget.tsx:1475` — therefore treats every refusal as success, and the affordance does nothing with no error anywhere. Typing a wrapper's return as `Promise<unknown>` reproduces the bug by discarding the field. Use `packages/marvin-widgets/src/lib/actions.ts` (`runChatAction`): it treats a rejection, a resolved `{ isError: true }`, AND a null host as the same refusal, falling through to the clipboard and then to a caller-rendered reveal. Test the resolved-refusal case explicitly — a suite covering only the rejection path stays fully green under the broken implementation, which is how this shipped twice already. Related: on the website every such control is inert but reports success, because the demo host answers `ui/message` with `{}` (`packages/site/src/lib/widget-host.ts:151-153`).
