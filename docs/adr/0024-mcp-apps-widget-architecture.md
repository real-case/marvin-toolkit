# ADR 0024 — MCP Apps widget layer: data-first staging and shared data contracts

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** (solo maintainer sign-off)                     |
| Date          | 2026-06-29                                                  |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0001](0001-single-plugin-consolidation.md) (one plugin / one server), [ADR-0005](0005-portable-spec-contract.md) (typed blocks over prose), [ADR-0008](0008-mcp-door-resource-resolution.md) (resources read from packRoot), [ADR-0013](0013-self-contained-server-bundle.md) (committed server bundle), [ADR-0018](0018-three-doors-instrument-taxonomy.md) (instrument taxonomy), [ADR-0021](0021-lessons-feedback-loop.md) (lessons store), `packages/marvin-mcp-shared/src/contracts/` |

## Context

Every marvin surface is **text today**: the `help` tool renders a markdown
dashboard, the `task` tool prints a board, the `sec-*` scanners emit prose
reports. The **MCP Apps** extension (`@modelcontextprotocol/ext-apps`, wire
protocol `2026-01-26`) now lets an MCP server ship interactive UI: a tool
declares `_meta.ui.resourceUri`, the server serves a `ui://` resource (a
self-contained HTML document), and a **rich host** renders it in a sandboxed
iframe that talks back over a JSON-RPC `postMessage` dialect. Rich hosts are
Claude Desktop, claude.ai web, and some IDEs — **the Claude Code terminal is
not one**; it shows the text fallback.

We intend to ship a **family** of widgets, not one screen: task list, task
detail, "what was done" task summary, a reusable markdown view, handoffs,
tracker-task list, security audits, and a marvin infrastructure dashboard.

Three structural facts shape how that family must be built:

1. **The shared tool contract is text-only.** `marvin-mcp-shared`'s
   `registerTool` maps a handler result to `{ type: "text" }` and **drops
   everything else** — there is no `structuredContent`, no tool `_meta`, and
   `PackBundle` cannot register resources. No widget can receive data until that
   contract is widened.
2. **The data a widget needs is partly missing or unstructured.** PR URLs are
   never stored (the `git` tool's `gh pr create` discards the returned URL);
   `sec-*` output is prose, not typed findings; the handoff artifact has no
   frontmatter. Links that *do* exist already live in artifacts (spec
   frontmatter `tracker`, host-bindings `decision_record.path`, spec-contract
   `depends_on`, kanban `tracker_id` + `branch`).
3. **marvin already prefers typed blocks over prose** (ADR-0005 moved the spec's
   load-bearing structure into a zod-validated `spec-contract` YAML block, and
   the `spec` tool already appends a machine-readable `spec-result` JSON block).

## Decision

Adopt an MCP Apps widget layer as a **progressive enhancement**, built in **two
stages — all data first, no UI until the data layer is done** — over a **single
set of shared data contracts**.

1. **Progressive enhancement.** Every widget-backed tool returns **both** text
   (the terminal fallback, unchanged behaviour) **and** `structuredContent` (the
   widget payload). The terminal never loses function; the widget is additive.

2. **Stack.** Widgets are **React** components (see memory:
   `mcp-apps-react-widgets`) built with Vite + `vite-plugin-singlefile` into one
   self-contained `*.html` per widget, **committed and read at runtime from the
   plugin root** like `SKILL.md` (door-3, ADR-0008) — so the committed
   `dist/server.js` (ADR-0013) is untouched. The `ext-apps` SDK lives **only in
   the browser bundle**; the server keeps its own `defineTool` registration and
   gains resource registration through a widened `PackBundle`, rather than
   pulling a second registration framework into `server.js`.

3. **Reuse.** The eight widgets collapse to **two React primitives** —
   `<Markdown>` and a `<ListDetail>` master-detail shell — plus a **three-type
   link model** (internal nav / external `app.openLink` / chat-action). Reuse is
   at the component/build level; `ui://` iframes are **not** nested.

4. **Data-first staging (load-bearing).**
   - **Stage 1 — data only, zero UI.** Widen the shared contract
     (`ToolDef.meta`, `ToolResult.structuredContent`, `PackBundle.resources` +
     `capabilities.resources`, passthrough in `registerTool`); define a
     `structuredContent` schema per tool; store the PR URL on the artifact at
     `gh pr create`; add handoff frontmatter; build the task-summary aggregator;
     restructure `sec-*` output into typed findings. **Done-criterion: every
     tool returns correct `structuredContent` + text, verifiable through the
     CLI/text path with no widget built.**
   - **Stage 2 — UI, only after Stage 1.** `packages/marvin-widgets`, the two
     primitives, Storybook + a `postMessage` mock host, and `ui://` wiring.

5. **Links in artifacts; structured where possible (extends ADR-0005).** Links
   are **stored in marvin artifacts, never resolved live**. Data is expressed as
   typed blocks, and **one zod schema per artifact block is reused 4×** —
   storage, the DoR/validation gates, `structuredContent`, and React props — so
   the text surface, the gates and the UI cannot drift. This ADR ships that
   single home: **`packages/marvin-mcp-shared/src/contracts/`** (`LinkRef`,
   `TaskCard` / `TaskDetail` / `TaskListPayload`, `TaskSummary`, `HandoffCard`,
   `AuditReport`, `DashboardState`). The module is data-only — it has **no
   runtime effect** on the server until a tool imports a schema.

6. **Resolved scope forks.**
   - **Tracker widget → link-out.** Render local tasks that carry a `tracker_id`
     and link out via the existing `trackerUrl()` builder. A live tracker-API
     integration is rejected: it is live resolution, which contradicts
     decision 5.
   - **Audit widgets → structured findings (Tier-2).** Every `sec-*` scanner
     emits a typed `audit-report` block alongside its prose, enabling
     filter/sort/severity views. Plain prose-rendering (Tier-1) is rejected.

## Consequences

- **One-time gate.** The shared-contract widening touches `marvin-mcp-shared`,
  used by the server's whole tool layer — it is the first Stage-1 change and
  must land with tests proving `_meta` / `structuredContent` passthrough. Until
  it lands, no widget can receive data.
- **Biggest data change is `sec-*` Tier-2** — restructuring every scanner's
  output. The task-summary aggregator (#3) is the only genuinely new tool.
- **New stored fields:** `pr` on the kanban frontmatter (written by the `git`
  tool) and YAML frontmatter on the handoff artifact. Both are additive.
- **Audience caveat.** Terminal users — marvin's primary audience — never see a
  widget; the payoff is for Desktop/web/IDE users. This is acceptable precisely
  because Stage 1 is independently valuable to the text surface.
- **New/young protocol.** `ext-apps` and protocol `2026-01-26` are recent and
  unevenly hosted; exact `_meta` keys and the client SDK surface are pinned
  against the package at Stage-2 implementation time, not assumed here.
- **This ADR adds code with no behaviour change:** the contracts module plus its
  tests. The server bundle (`dist/server.js`) is unchanged, so the committed-dist
  guard stays green. Stage-1 and Stage-2 mechanics are tracked in memory
  (`mcp-apps-widget-architecture`) and will be recorded as they land.
