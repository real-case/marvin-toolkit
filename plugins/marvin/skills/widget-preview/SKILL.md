---
name: widget-preview
description: Open a marvin widget as a real rendered panel with this project's own data, on any host — renders the bound ui:// widget plus its live payload into one self-contained HTML file under .marvin/preview/ and opens it in a browser. Use when the user says "show me the widget", "open the help widget", "I want to see the dashboard as a widget", "покажи виджет", "/marvin:widget-preview", or asks why a widget is not showing up in the terminal.
---

# Widget Preview

Render one of marvin's `ui://` widgets — with this project's live data — into a file the user
can open, and open it.

## Why this exists

A widget only appears when the MCP host resolves the tool's `_meta.ui.resourceUri`. The Claude
Code CLI does not implement that at all, so `/marvin:help` renders its markdown fallback there
and every widget in the family is unreachable from the terminal. This command does what a rich
host would do — call the tool, fetch the widget document, run the handshake, hand over the
payload — and leaves the result as a self-contained file (ADR-0034).

Do not explain the widget's contents afterwards. The panel is the output; the user reads it.

## Input

`$ARGUMENTS` — optionally the widget to open, and optionally arguments for its tool as JSON.

## Bound widgets

`help`, `dashboard`, `reports`, `task-list`, `task-detail`, `task-summary`, `tracker-list`,
`handoffs`, `audit`.

The list is not hard-coded anywhere: running the command with an unknown name prints the widgets
the installed server actually binds. Prefer that over guessing.

## Workflow

### 1. Resolve the widget

Map what the user asked for to a widget name. "the help widget", "the welcome screen" → `help`;
"the toolbox state", "the dashboard" → `dashboard`; "my reports" → `reports`; "the board" →
`task-list`. If the request is ambiguous, ask once, offering the two closest names — do not
render several.

### 2. Run the command

The script ships inside the plugin. Invoke it with the plugin root that this prompt's
plugin-resources preamble names (ADR-0008); from a plugin installed by `/plugin install` that is
the marketplace cache path, and in the marvin repository itself it is `plugins/marvin`.

```bash
node <plugin-root>/mcp/server/bin/widget-preview.mjs <widget> --open
```

Pass tool arguments as a JSON string when the widget needs them:

```bash
node <plugin-root>/mcp/server/bin/widget-preview.mjs task-list '{"action":"list"}' --open
```

The command prints the absolute path of the written file on stdout and nothing else. Everything
under `.marvin/preview/` is git-ignored by a `.gitignore` the command writes itself.

### 3. Report the result

Tell the user the panel is open and give the path in one line, so they can reopen it later.

## Failure paths

- **`unknown widget "<name>"`** — the message lists every widget the server binds. Pick from that
  list and re-run; do not invent a name.
- **`returned no widget payload`** — the tool ran but produced nothing to render, and its own
  message says why. Usually it needs arguments: re-run with them, e.g.
  `task-list '{"action":"list"}'`. An empty board or a project with no reports is the other
  common cause; say so plainly rather than opening an empty panel.
- **No browser (a remote shell, CI, a container)** — `--open` is best-effort and never fails the
  run. The path is already on stdout: give it to the user and stop.
- **`server bundle not found`** — the plugin is installed from source without a build. Run
  `npm run build` in `plugins/marvin/mcp/server`, or reinstall the plugin.

## Notes

- The file is a rendering of data the tool already returned. It is written inside the project,
  ignored by git, and safe to delete at any time.
- The panel follows the operating system's light/dark scheme.
- This is not the report export. `/marvin:report-export` produces a shareable document from a
  `.marvin/` report; this opens a live widget over the current state.
