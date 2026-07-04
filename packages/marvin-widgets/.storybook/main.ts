import type { StorybookConfig } from "@storybook/react-vite";

/**
 * Storybook (react-vite) config for the widgets. Stories are the dev/verify
 * harness for the widget components (ADR-0024); `@storybook/test-runner` executes
 * their `play` functions in CI as the test-storybook oracle.
 */
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
};

export default config;
