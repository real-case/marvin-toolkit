# @marvin-toolkit/widgets

The browser workspace for marvin's MCP Apps widgets (ADR-0024). Each widget under
`src/widgets/<name>/` is a React-shaped app rendered on Preact (`react` /
`react-dom` are aliased to `preact/compat`), built by Vite + `vite-plugin-singlefile`
into one self-contained, minified HTML document committed at
`plugins/marvin/widgets/<name>.html` — the `ui://` resources the marvin MCP server
serves to rich hosts. `scripts/verify-widgets.mjs` (repo root) guards that the
committed HTML matches a fresh build.

## Dev loop

```shell
npm run storybook        # Storybook on http://localhost:6006
```

Stories are the dev harness. Two story-level conventions:

- `parameters: { hostTheme: "dark" }` — pins the story to the dark host palette.
  Dark variants are explicit stories named `<Base>Dark` (e.g. `FixtureDark`), so
  the visual tests screenshot both themes. A real MCP Apps host pushes its style
  variables via `ui/notifications/host-context-changed`; `.storybook/preview.ts`
  simulates that with two palettes and a `hostTheme` toolbar select.
- `parameters: { visual: false }` — opts the story out of visual regression.
  Used by the mock-host handshake stories, whose render is redundant or
  nondeterministic for screenshots.

Storybook renders `src/` directly, so it always shows the current source. A locally
installed plugin does not: it serves the committed
`plugins/marvin/widgets/<name>.html`, which only matches after a build. To keep one
widget's document current while editing it, watch that widget:

```shell
npm run build:watch -w @marvin-toolkit/widgets -- dashboard
```

The watch takes exactly one widget name (`vite-plugin-singlefile` forces
`inlineDynamicImports`, which rollup rejects for multiple inputs, so each widget needs
its own build). Rebuilt HTML is picked up on the host's next `resources/read` — no
server rebuild, no session restart. To refresh everything the plugin serves at once,
including `dist/server.js`, run `npm run dev:plugin` from the repo root.

For a standing loop across the whole tree rather than one widget, run `npm run dev:watch`
from the repo root. It watches every source tree the plugin is built from and rebuilds only
what a change can affect — one widget for a change inside that widget's directory, all nine
for shared widget code under `src/lib`, `src/theme` or `src/primitives`. Keep `build:watch`
for the case it is better at: iterating on a single widget, where vite's incremental rebuild
beats a discrete one.

## Tests

```shell
npm test                 # vitest (happy-dom) — component + mock-host unit tests
```

Interaction tests execute every story's `play` function in a real browser, the
same way CI does:

```shell
npm run build-storybook
npx http-server storybook-static --port 6006 --silent   # in one terminal
npm run test-storybook                                  # in another
```

## Visual regression

`.storybook/test-runner.ts` hooks the same `test-storybook` pass: after each
story renders (and its `play` passes), `postVisit` takes a full-page screenshot
and compares it against a committed baseline with jest-image-snapshot
(0.5% failure threshold, diffs written to `__image_snapshots__/__diff_output__/`,
which is git-ignored).

Baselines are **platform-scoped**: font rasterisation differs between darwin and
linux, so baselines live in `__image_snapshots__/<platform>/` and only the
`darwin` set is committed. A platform with no committed baseline dir — CI's
ubuntu today — skips the comparison instead of writing throwaway baselines.

- Update baselines after an intentional visual change (with the static Storybook
  served as above): `npm run test-storybook:update`
- Bootstrap baselines for a new platform: `STORYBOOK_VISUAL=1 npm run test-storybook`,
  then commit the new `__image_snapshots__/<platform>/` directory.
