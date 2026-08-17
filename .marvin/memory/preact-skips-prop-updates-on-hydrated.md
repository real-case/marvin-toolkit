---
id: preact-skips-prop-updates-on-hydrated
type: gotcha
title: Preact skips prop updates on hydrated DOM — seed island state after
  mount, not in useState
created: 2026-07-20
tags: astro, preact, hydration, island, ssr, url-state, website, e2e
source: website-interactive-islands
---

An Astro + Preact island that server-renders its own markup cannot seed interactive state from the URL (or any client-only source) in a `useState` lazy initializer: Preact's hydration reuses the server DOM and skips all non-function prop updates, so the initializer's value drives the vnode but never reaches the DOM. In the /commands search island this silently broke deep links — `?q=scan&group=sec` filtered the card list correctly while the `<input>` stayed empty and the wrong chip kept its `on` class, because `value` and `class` were never patched onto the hydrated elements. Fix: start from the state the server rendered, then apply the client-only values in a `useEffect(() => …, [])` mount effect, which is a real post-hydration render Preact patches normally; guard any effect that WRITES back to that source (a `history.replaceState` URL sync) with a ref that skips the mount pass, or it will clobber the deep link with the not-yet-applied defaults. Test for it with an assertion on the DOM property rather than the filtered output — `expect(input).toHaveValue("scan")` fails under the naive version while a card-count assertion still passes.
