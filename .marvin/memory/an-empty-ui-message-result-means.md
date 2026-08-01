---
id: an-empty-ui-message-result-means
type: gotcha
title: An empty ui/message result means "delivered" — a preview host must refuse
  with isError
created: 2026-07-31
tags: mcp-apps, widgets, ext-apps, sendMessage, silent-failure, preview,
  template-literal
source: widget-preview-door
---

Any hand-rolled MCP Apps host (the website's embed host, the widget-preview command) must answer `ui/message` with `{ isError: true }`, not `{}`. `packages/marvin-widgets/src/lib/actions.ts` reads `result?.isError !== true` as SUCCESS, and the views deliberately render nothing on success — so an empty answer turns every chat control into a dead affordance with no error anywhere, which is the exact failure `actions.ts` was written to prevent. Refusing sends a widget that checks the result down its clipboard-then-manual ladder instead. `ui/open-link` is different only because the link model discards the result: unobservable today, but `isError` is the durable answer there too. Note only DashboardWidget checks; HandoffsWidget.tsx:550 and ReportsWidget.tsx:1480,1529 still do `void app.sendMessage(...).catch(() => {})` and stay inert regardless.

A second, unrelated trap from the same file: when a script GENERATES HTML from a template literal, every backtick in the embedded JS — including ones inside comments — terminates the literal. It bit twice in one session; the language server flags it as "';' expected" plus "unreachable code", which reads like a logic error rather than a string that ended early. Escape them as \\`.

**Why:** both failures are silent — a green suite and a rendered panel with controls that do nothing. **How to apply:** when reviewing a host implementation, check what each REQUEST answer means to the consumer, not just that it was answered; a syntactically valid reply can still be a lie.
