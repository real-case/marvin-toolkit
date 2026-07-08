import type { StorybookConfig } from "@storybook/react-vite";

/**
 * Storybook (react-vite) config for the widgets. Stories are the dev/verify
 * harness for the widget components (ADR-0024); `@storybook/test-runner` executes
 * their `play` functions in CI as the test-storybook oracle.
 *
 * The widgets render on Preact (react/react-dom aliased to preact/compat via
 * @preact/preset-vite — see vite.config.ts). Storybook keeps the react-vite
 * framework but its Vite config gets the same compat aliases via `viteFinal`, so
 * @storybook/react's renderer mounts the Preact vnodes correctly and the story
 * files' `@storybook/react` (type) imports stay unchanged.
 */
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal: async (config) => {
    const { mergeConfig } = await import("vite");
    return mergeConfig(config, {
      resolve: {
        alias: {
          react: "preact/compat",
          "react-dom": "preact/compat",
          "react-dom/client": "preact/compat",
          "react/jsx-runtime": "preact/jsx-runtime",
          "react/jsx-dev-runtime": "preact/jsx-runtime",
          "react-dom/test-utils": "preact/test-utils",
        },
      },
    });
  },
};

export default config;
