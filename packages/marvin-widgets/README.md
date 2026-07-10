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
