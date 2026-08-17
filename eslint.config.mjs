// Flat ESLint config for the marvin-toolkit monorepo.
// Type-unaware preset (no parserOptions.project) keeps linting fast and avoids
// per-workspace tsconfig wiring across the 5 workspaces. eslint-config-prettier
// is applied last so formatting is owned exclusively by Prettier.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default [
  {
    // storybook-static is the marvin-widgets Storybook build output; **/.astro is the
    // packages/site generated-types dir (both gitignored, regenerated on demand) — without
    // the ignore a stale local build floods `eslint .` with errors from generated code.
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      ".claude/**",
      "**/storybook-static/**",
      "**/.astro/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // A leading underscore marks an intentionally-unused binding — used for
      // handler parameters kept only to share a uniform dispatch signature.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // The marvin-widgets workspace is the repo's first browser + JSX/React code
    // (ADR-0024). The base config supplies only `globals.node` and no JSX block,
    // so add browser globals and JSX parsing for these files — otherwise `eslint .`
    // flags `document`/`window`/`setTimeout` as undefined and cannot parse `.tsx`.
    files: ["packages/marvin-widgets/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    // The site workspace (packages/site) is the second browser-facing workspace — Astro +
    // Preact + Playwright TS/mjs. Node globals already apply from the base block; add browser
    // globals + JSX parsing so `eslint .` resolves document/window/localStorage and parses JSX.
    // (.astro files stay unlinted — no astro parser is wired — which is acceptable here.)
    files: ["packages/site/**/*.{ts,tsx,mjs}"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  prettier,
];
