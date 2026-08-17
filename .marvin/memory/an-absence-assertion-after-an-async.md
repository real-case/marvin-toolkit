---
id: an-absence-assertion-after-an-async
type: process
title: An absence assertion after an async click passes without the guard —
  waitFor checks before Preact patches
created: 2026-07-29
tags: testing, preact, vitest, testing-library, async, oracles, widgets, false-green
source: dashboard-widget-rework
---

A test shaped "click, resolve, then `await waitFor(() => expect(queryByTestId(x)).toBeNull())`" proves nothing in the widgets workspace: the component's `.then` continuation runs in the microtask BEFORE the test's `await` continuation, Preact defers the resulting patch by another microtask via `debounceRendering`, and `waitFor` performs its first `checkCallback()` SYNCHRONOUSLY after installing its observer — so it sees the not-yet-rendered DOM, the assertion passes, and the element appears unobserved a tick later. Measured on the dashboard's click-race guard: the test passed with both generation checks deleted. Fix by asserting POSITIVELY on the state that should have won ("the line still shows the SECOND command") rather than on the absence of the state that should have lost; that formulation went red under the same mutation. The safe variant of an absence check is to `await waitFor(() => expect(spy).toHaveBeenCalled())` FIRST — its `asyncAct` teardown flushes the render queue — and only then assert the absence synchronously. General rule this is an instance of: any test whose passing condition is "nothing happened" needs a mutation check before you trust it, because "nothing happened yet" and "nothing will happen" are indistinguishable to the assertion. See [[a-rule-that-exists-to-distinguish-two]].
