---
id: an-eventually-nothing-assertion-needs-a
type: process
title: An "eventually nothing" assertion needs a real settle — connection,
  payload and bare act() all pass too early
created: 2026-07-31
tags: testing, preact, vitest, widgets, oracles, false-green, mcp-apps,
  ext-apps, theme
source: widget-host-theme
---

Any widgets-workspace test whose passing condition is "the DOM ends up WITHOUT something" must settle before asserting, and three obvious settles are not enough. Measured on the host-theme resolver, mutated to default to "light" instead of returning undefined: awaiting the handshake (`data-connected === "yes"`), awaiting the payload to render (`findAllByRole("option")`), and `await act(async () => {})` ALL stayed green, because the hook's state lands a render pass after both the connection flip and the data arrival, and a bare act does not flush Preact's effect queue. Only `await act(async () => { await new Promise(r => setTimeout(r, 50)); })` made the mutation red. Wall-clock dependence is the price; there is no cheaper form that works. Two corollaries worth knowing. First, proving the absence by CONTRAST is not an escape hatch for host context specifically: the SDK MERGES `host-context-changed` params into its internal context (`onEventDispatch` does `{...this._hostContext, ...params}` before any handler fires), so a later `setHostContext({})` cannot un-advertise a theme, and initial absence is the only observable form. Second, a negative assertion pinned to ONE representative widget is a second, independent hole — a default reintroduced inside any other view's prop default or its own `?? "light"` is invisible to a wiring-level source scan, to a table that advertises the opposite value, and to the site e2e (Preact skips the unchanged-value write on a light page). Run the negative over the whole family. Extends [[an-absence-assertion-after-an-async-click]], which covers the same failure for click-driven absence; this is its host-context/hook-state variant.
