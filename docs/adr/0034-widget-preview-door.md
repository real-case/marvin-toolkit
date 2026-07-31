# ADR 0034 — A local preview door renders widgets on hosts that cannot

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Proposed** |
| Date          | 2026-07-31 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0024](0024-mcp-apps-widget-architecture.md) (the MCP Apps widget layer), [ADR-0033](0033-report-export.md) (report export is template-only), [ADR-0013](0013-self-contained-server-bundle.md) (committed self-contained bundle), [ADR-0030](0030-toolbox-dashboard-and-usage-log.md) (self-ignoring working directories), [ADR-0008](0008-mcp-door-resource-resolution.md) (door-3 resource resolution) |

## Context

[ADR-0024](0024-mcp-apps-widget-architecture.md) built nine `ui://` widgets and bound each to a
tool through `_meta.ui.resourceUri`. It also predicted the cost: "terminal users never see a
widget; the payoff is for Desktop/web/IDE users."

Measured on 2026-07-31, that cost is larger than the prediction. The MCP client that runs marvin
is the Claude Code CLI itself — the server process's parent is the `claude-code` binary — and that
binary contains **no MCP Apps implementation at all**: `resourceUri`, `profile=mcp-app`, `ui://`
and `io.modelcontextprotocol/ui` each occur zero times in it, while `structuredContent`, `_meta`
and `resources/read` occur 49, 354 and 11 times respectively, so the absence is real rather than
an artifact of how it was searched. The Claude desktop application's bundle does contain the
extension: its local MCP client advertises `io.modelcontextprotocol/ui` with the
`text/html;profile=mcp-app` mime type, behind a feature flag. That client is the one that connects
the servers configured in `claude_desktop_config.json`; the plugin server here is spawned by the
CLI instead, which was confirmed by checking the server process's parent. A widget-bound tool on a
server registered the desktop way was observed rendering, so the difference is which client holds
the connection rather than which surface the user is looking at. That is an observation about a
third party's build at a point in time, not a contract — treat it as the reason this door exists,
not as a supported configuration.

So marvin's primary audience cannot reach the widget family at all, and the wiring is not at
fault: it is byte-correct against the specification and renders immediately in a host that
implements it.

Three ways out were considered. Waiting for host support leaves the feature dark for an unknown
period. Asking users to register the server as a desktop connector works today but pins one
project directory per entry and contradicts the plugin's install story. Rendering locally is the
only option that puts a real widget in front of a terminal user, with their own project's data,
on the host they already use.

The constraint that shapes the design is [ADR-0033](0033-report-export.md): no artifact rendering
ships in the MCP server. That decision was about **export** — producing a shareable document from
a report — and its rationale was that a PDF engine or a headless browser is incompatible with a
committed, dependency-free bundle. A preview is a different thing, and the boundary needs
recording rather than assuming.

## Decision

**A preview is a local rendering of a payload the tool already returned; an export is a shareable
artifact. Preview ships as a command in the plugin, not as a tool action and not as a template
the model fills.**

- The plugin ships `mcp/server/bin/widget-preview.mjs`: a dependency-free Node script, no build
  target of its own. It drives the committed `dist/server.js` over stdio the way the repository's
  own dev driver does, then writes one self-contained HTML file to `.marvin/preview/<widget>.html`
  and prints its path.
- **Nothing is hard-coded per widget.** The script resolves a widget name by scanning `tools/list`
  for a tool whose `_meta.ui.resourceUri` is `ui://marvin/<widget>.html`, and fetches the document
  from that same URI over `resources/read`. The binding the server already publishes is the only
  registry.
- The generated file embeds the committed widget document base64-encoded and assigns it through
  `iframe.srcdoc` after decoding with `TextDecoder`, plus roughly ninety lines that answer the five
  protocol messages a framed view needs. Nothing is loaded from a second URL, so the file behaves
  identically from disk, over HTTP, or copied elsewhere.
- `.marvin/preview/` writes its own `.gitignore` of `*` on first use, the convention
  [ADR-0030](0030-toolbox-dashboard-and-usage-log.md) established for `.marvin/usage/`.
- The surface is a skill-backed prompt, `widget-preview`, reachable through all three doors.

### Why not a tool action

`help { open: true }` would have been one call instead of two steps. It was rejected because it
turns a read-only tool into one that writes to the filesystem inside an MCP request, and because
the payload would then be produced by the same request that renders it — losing the property that
makes this design cheap.

### Why not the template-only shape ADR-0033 uses

The model would have to re-emit the payload into the file it writes. For the `help` widget that
payload is 19,514 bytes compact: roughly six thousand tokens spent per showing, plus transcription
risk. The export path pays that cost once for a document a human will keep; a preview is opened
casually and often.

### Why no second build target

`dist/server.js` is one committed `tsup` entry with `splitting: false`
([ADR-0013](0013-self-contained-server-bundle.md)). A second entry duplicates the shared code —
about a megabyte of committed bundle — and adds a second target to the freshness guard, for a
command a user runs by hand where a one-second child process is unnoticeable.

## Consequences

- **The widget family becomes reachable from the terminal**, with real project data, at the cost
  of one command and a file the user opens.
- **The protocol is now implemented twice** in this repository: here, and in the website's embed
  host (`packages/site/src/lib/widget-host.ts`). The plugin ships standalone and cannot import
  from the site workspace, so the duplication is deliberate. The failures this host can cause are
  *silent* ones in a real host, so its answers are pinned by tests that run the shipped script's
  own host code and assert the exact JSON-RPC it emits: the echoed protocol version, the advertised
  `openLinks` capability, an empty host context, a `tool-result` whose `content` is the required
  block array, and a `ui/message` answered with `isError` rather than an empty result. That last
  one is the shape of failure worth naming: an empty answer means *delivered* to the widget layer,
  and the views render nothing on success, so a preview would have shown dead chat controls with no
  feedback at all. Pinning a host's answers is not the same as proving the family renders — the
  tests can only fail an answer someone thought to specify.
- **The refusal only helps the widget that reads it.** `runChatAction`
  (`packages/marvin-widgets/src/lib/actions.ts`) treats a resolved `{ isError: true }` as a refusal
  and falls back to the clipboard, then to a revealed command; the dashboard binds it. The handoffs
  and reports widgets still call `sendMessage` as `void … .catch(() => {})` and discard the result,
  so their chat controls are inert in a preview whatever the host answers — including the reports
  Sync button, which was on screen during the manual browser run above. Teaching those two the
  ladder is a widget change, deliberately outside this door's scope, and it is the follow-up this
  record hands over.
- **No browser assertion ships.** One failure class is removed by construction: HTML escaping
  cannot fail because the document is never markup. Clipping is a weaker claim — the frame is
  styled to fill the viewport, but a test with no engine can only assert that the rule was written,
  never that the layout came out right. A defect visible only in a real engine would go unnoticed.
  This is an accepted risk rather than an impossibility: the repository owns Playwright and a
  Storybook test-runner, in workspaces this script does not belong to. The shipped configuration —
  a `srcdoc` frame under `sandbox="allow-scripts"`, which nothing else in this repository uses —
  was exercised by hand in Chromium over `file://` for the `help`, `dashboard` and `reports`
  widgets before merge: handshake completed, live payload rendered, full-height frame, no console
  errors. That is evidence, not a gate; it will not re-run for the next change.
- **The preview follows the operating system's scheme.** The host advertises no theme, which is
  what leaves the widget on `prefers-color-scheme` after
  [ADR-0024](0024-mcp-apps-widget-architecture.md)'s theme work; forcing one is a later flag.
- **If a host gains MCP Apps support**, this door does not become wrong — it keeps its value for
  sharing a rendered snapshot — but its urgency disappears, and this record should be revisited
  rather than the code deleted reflexively.
