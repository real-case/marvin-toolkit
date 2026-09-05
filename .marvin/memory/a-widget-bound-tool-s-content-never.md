---
id: a-widget-bound-tool-s-content-never
type: gotcha
title: A widget-bound tool's `content` never reaches the model —
  `structuredContent` replaces it
created: 2026-08-18
tags: mcp-apps, widgets, structuredContent, tool-result, host, measurement,
  help, duplication
source: capability-gated-tool-text
---

Measured 2026-08-18 across four calls, two tools and two connections. When a marvin tool returns a `structuredContent`, the model receives THAT and does not receive `content[0].text` at all. `help` returns markdown beginning `# >_ MARVIN` (tools/help.ts) plus a `HelpState` payload; on both the plugin connection (which advertises no MCP Apps extension) and the `marvin-dev` desktop connection (which does — the widget rendered for the user in the same call), the model got `HelpState` and no markdown. `handoff` behaved identically. Tools with no `structuredContent` — `spec`, `adr` — deliver their text in full. So the substitution is a property of the Claude Code harness, not of the UI extension, and it holds on the rendering path as well as the fallback path.

Two consequences worth carrying. First, any fix aimed at what the model does with a widget-bound tool's output MUST travel in `structuredContent`; editing `content` changes a channel the model does not read, and a test asserting the emitted string passes while the behaviour is unchanged. Spec `capability-gated-tool-text` was designed against `content` and had to be reworked after this measurement — neither the mechanical DoR gate nor two critic passes caught it, because it is only observable by calling a tool on a live host and looking at what comes back.

Second, this is the real mechanism behind the duplicated Help panel: the model is handed the whole payload and, told by the command prose to "present the dashboard as-is", rebuilds the panel from it. The widget rendering and the model's reconstruction are two independent renderings of one payload.

**Why:** it inverts where a presentation fix has to live. **How to apply:** before specifying anything about how a tool's output reaches the model, call the tool and read what actually arrives; for a tool with a widget, assume `content` is invisible to the model until measured otherwise. Related: [[the-committed-widget-html-can-be-framed]], [[an-empty-ui-message-result-means-delivered]].
