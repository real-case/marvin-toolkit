---
id: a-tsc-invocation-that-names-files-on
type: gotcha
title: A tsc invocation that names files on the command line silently discards
  tsconfig.json
created: 2026-07-21
tags: typescript, tsc, tsconfig, astro, site, ci, silent-failure, type-checking
source: website-agent-surface-seo
---

`packages/site`'s type gate is `tsc --noEmit --strict --skipLibCheck --resolveJsonModule --module esnext --moduleResolution bundler src/data/catalog.ts src/data/casts.ts` (package.json `check:catalog`, wired as `pretest`). Naming files on the command line makes tsc IGNORE `tsconfig.json` entirely — this is documented tsc behaviour but invisible here, because the two files it currently checks are trivial type-only re-exports that pass under any settings. Two consequences, both verified against TypeScript 5.9.3 in this repo.

(1) **The default target is still ES5, so ordinary modern code fails to compile.** Adding a module that groups items with a `Map` and spreads `.entries()` — the idiomatic way to group commands by group — fails with `TS2802: Type 'MapIterator<...>' can only be iterated through when using the '--downlevelIteration' flag or with a '--target' of 'es2015' or higher`, plus cascading `TS7006` implicit-any errors that make the real cause hard to see. Note TS2802 is TARGET-gated, not lib-gated: the default lib is ES2020+DOM, so `flatMap`, `Object.entries`, `Set`, `URL` and `padStart` all resolve fine and give a false impression that the toolchain is modern. Because the script is `pretest`, this turns `npm run test -w @marvin-toolkit/site` red on BOTH CI legs. The tempting wrong recovery is to drop files from the tsc list to go green, which silently reopens the type-check gap the script exists to close.

(2) **Worse, a green result means less than it looks.** The discarded `tsconfig.json` extends `astro/tsconfigs/strict`, which sets `verbatimModuleSyntax`, `isolatedModules`, `jsx: preserve` and `target: ESNext` — none of which the flag string passes. Measured: a `PageMeta` imported as a value but used only as a type is ACCEPTED by the flag-string form (exit 0) and REJECTED by a project-based check as `TS1484 — 'PageMeta' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled`. So the gate can pass code the real `astro build` rejects.

**Fix:** use a project file, not a longer flag string — `tsconfig.check.json` with `extends: "./tsconfig.json"`, `include: []`, and an explicit `files` list, run as `tsc -p tsconfig.check.json`. Verified exit 0 over a realistic Astro endpoint using `Map` iteration, `import type { APIRoute } from "astro"`, a JSON import, `new URL(path, site)` and `Response`.

**Two non-obvious details.** `include: []` is load-bearing for CI-leg parity, not tidiness: it keeps `.astro/types.d.ts` out of the program, and that file never exists on the Node-20 leg because `scripts/build.mjs` no-ops the build below Node 22.12 — a check config that depended on it would pass on one leg and fail on the other. Confirm with `tsc -p tsconfig.check.json --listFiles | grep -c '.astro/types'` returning 0. And switching to the project form newly subjects the previously-checked files to the stricter inherited options, so re-run it over the EXISTING files before adding new ones; `catalog.ts` and `casts.ts` were verified to pass.

**Adjacent trap when probing this:** a probe module too simple to use `Map`/`Set` iteration or ES2021+ methods compiles fine under the flag string and gives a false all-clear. The first probe in this session did exactly that and reported exit 0; the failure only surfaced once the probe used the grouping code the real module would need. Probe with representative code, not minimal code.

Related: `astro/tsconfigs/base.json` sets `noEmit: true`, so `tsc -p` writes nothing next to the sources. ESLint here is type-unaware (`eslint.config.mjs` — no `parserOptions.project`), so a second tsconfig does not affect linting; Astro/Vite discover `tsconfig.json` by exact name and ignore `tsconfig.check.json`; and Prettier infers the `json` parser for it, which tolerates `//` comments.
