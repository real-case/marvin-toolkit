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
    ignores: ["**/dist/**", "**/node_modules/**", ".claude/**"],
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
  prettier,
];
