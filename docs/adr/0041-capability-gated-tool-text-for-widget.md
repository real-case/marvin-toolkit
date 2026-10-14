# ADR 0041 — A widget-bound tool's text is gated on the client's capabilities

| Field         | Value                                                       |
| ------------- | ----------------------------------------------------------- |
| Status        | **Accepted** |
| Date          | 2026-09-05 |
| Supersedes    | —                                                           |
| Superseded by | —                                                           |
| Related       | [ADR-0024](0024-mcp-apps-widget-architecture.md) (the progressive-enhancement decision this narrows), [ADR-0034](0034-widget-preview-door.md) (the measurement of which hosts render `ui://` documents), [ADR-0008](0008-mcp-door-resource-resolution.md) (the shared server as the single point every result passes through) |

## Context

ADR-0024 §1 decided progressive enhancement: every widget-backed tool returns **both** text —
"the terminal fallback, unchanged behaviour" — and a `structuredContent` payload. Its
Consequences repeat the promise, that every widget-backed tool "kept its byte-unchanged terminal
text fallback". The reasoning was that `_meta` is additive, so a host that cannot render the
widget is unaffected.

That reasoning holds. What it does not cover is the host that *can*. There, the payload is drawn
as a widget and the same payload is also handed to the model, which is told by the command prose
to present the result as-is and duly rebuilds the panel in markdown. The user sees one dashboard
twice. The widget rendering and the model's reconstruction are two independent renderings of one
payload, and nothing in the design chose between them.

Two facts were measured on 2026-08-18 rather than reasoned about, and both matter.

**The model does not receive `content` for a widget-bound tool.** Across four calls, two tools
and two connections, when a marvin tool returned a `structuredContent` the model received that
payload and did not receive `content[0].text` at all. `help` returns markdown beginning
`# >_ MARVIN` plus a `HelpState`; on the plugin connection, which advertises no UI extension, and
on the desktop `marvin-dev` connection, which does — confirmed by the widget rendering for the
user in that same call — the model got `HelpState` and no markdown. Tools returning no payload,
`spec` and `adr`, delivered their text in full. The substitution is a property of the Claude Code
harness rather than of the UI extension: it holds on the rendering path and the fallback path
alike. Four calls on two Anthropic-hosted connections establish nothing about a third-party MCP
host, and nothing here should be read as doing so.

This inverted the fix. A change that only rewrote `content` would edit a channel the model does
not read, while every test asserting the emitted string passed — a green suite over an unchanged
behaviour. The first draft of the spec did exactly that, and neither the mechanical readiness gate
nor two critic passes caught it.

**The injected key cannot break a widget.** No widget validates the payload at runtime. Each takes
it by cast, the `contracts/` schemas are type-only imports, and `ToolDef` declares no
`outputSchema`, so the SDK's structured-output validation cannot fire either. That no contract is
`.strict()` is also true, but it is not the operative reason and resting on it would be right by a
route the code does not take.

## Decision

**A widget-bound tool's result is gated on the calling client's advertised capabilities, decided
once in the shared `registerTool`.** ADR-0024's progressive-enhancement decision is narrowed from
"the terminal fallback is unchanged" to "unchanged for a client that does not advertise the UI
extension".

A module-private `widgetDigest(server, def, result)` runs after the handler returns and before the
SDK result is composed. It returns the result untouched unless **all five** facts hold:

1. the tool declares `meta.ui.resourceUri` as a non-empty string;
2. the client's capabilities carry `extensions["io.modelcontextprotocol/ui"]`;
3. the handler produced a `structuredContent`;
4. the result is not an error;
5. that payload has no own `_rendered` key.

When all five hold it makes two changes together. `content` becomes one text block reading
`Rendered as the <name> widget (<uri>). The user can see it; do not reproduce it here.`, and
`structuredContent` becomes a copy carrying one added key — `_rendered = { widget, uri, note }` —
with every key the handler produced untouched. `isError` is never altered on any path.

**The payload half is the operative one.** It travels the channel the measurement shows the model
actually reads. The `content` half is retained because it costs nothing, not because a host
needing it has been observed; it is the unproven half, and the record says so rather than
implying insurance against a known case.

**The three negative conditions are the substance, not defensive noise.** A result with no payload
has nothing for a widget to render, so replacing its text would destroy its only information — the
`task` tool reaches that path on `create`, `move` and `link-pr`. An error must always reach the
model in full. A tool with no binding is outside the rule.

**Condition 5 keeps the rule atomic.** A colliding key means the caller already owns that name, and
a library shared across projects must not destroy a caller's data. Yielding on the payload while
still rewriting `content` would leave a third state, the panel gone and no instruction in its
place, so the gate declines entirely instead. Presence is tested with `in` rather than against
`undefined`: an own key holding `undefined` passes a value test, and the payload spread would then
copy that `undefined` over the injected object, producing exactly the state the condition exists to
prevent. The injected key is written first and the payload spread after it, so a caller's value
wins even if the condition were later relaxed.

**Why `registerTool` and not the nine tools.** It is the single point every tool result already
passes through, and the only place holding both facts the rule needs: the tool's own `_meta`, and
the `server` whose client capabilities decide the path. Applying the rule inside each tool factory
would thread `server` into nine signatures and leave the rule as nine independent obligations, so
the tenth widget-bound tool would inherit nothing. The capability read must happen inside the
dispatch closure rather than at registration: `registerTool` runs from `buildServer`, which is
before `server.connect`, and `getClientCapabilities()` returns undefined until initialize
completes.

The rule stays project-agnostic. It keys on the MCP capability name and the tool's own `_meta`, and
names no marvin tool, so a second project using the shared library inherits the same rule — though
not necessarily the same observable outcome, since what a host does with `content` versus
`structuredContent` was measured here only for the Claude Code harness.

## Consequences

- **A tenth widget-bound tool inherits the rule by construction**, rather than by an author
  remembering to apply it. That is the property the per-tool alternative could not offer.
- **The digest text is a model-facing instruction, and therefore part of the contract.** Its
  wording is asserted character-for-character by its acceptance test, so changing it is a
  deliberate act rather than a tidy-up.
- **ADR-0024 is narrowed, not superseded, and keeps its status.** Its decision survives on a strict
  reading, since the fallback is unchanged for every client that does not advertise the extension.
  The narrowing is real and is recorded here rather than left as an inference.
- **The gate is silent by design.** Nothing logs which path a call took; the only way to tell is
  the shape of the result, which is what the acceptance criteria assert.
- **Rollback is a revert.** No state, file or configuration key is introduced, and no kill switch
  exists: the behaviour has two states, not three.
- **The measurement will age.** When a Claude Code release implements the extension, this decision
  is what makes that release render cleanly instead of doubling the panel.
- **An instruction can still be ignored.** The panel is genuinely gone from `content`, decided
  server-side on an observed fact, but the `_rendered` note is an instruction the model may
  disregard. If it does, it can only rebuild the panel from `structuredContent`, which degrades to
  today's behaviour rather than below it.
