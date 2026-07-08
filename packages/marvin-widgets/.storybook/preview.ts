import type { Preview } from "@storybook/react";

/**
 * Host-style-variable defaults so the widgets render standalone in Storybook.
 * A real MCP Apps host pushes these via `ui/notifications/host-context-changed`;
 * the widgets read them through `var(--…, fallback)`, so this only makes the
 * standalone story match the host look. Injected as a `<style>` (this file is a
 * plain `.ts`, so no JSX decorator).
 */
const HOST_STYLE_DEFAULTS = `
  :root {
    --color-background-primary: #ffffff;
    --color-background-secondary: #f4f4f5;
    --color-background-info: #eef4ff;
    --color-text-primary: #1a1a1a;
    --color-text-secondary: #555;
    --color-text-info: #0b57d0;
    --color-text-danger: #b00020;
    --color-border-primary: #e2e2e2;
    --color-border-secondary: #f0f0f0;
    --border-radius-sm: 4px;
    --font-sans: system-ui, -apple-system, sans-serif;
  }
`;

if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.setAttribute("data-marvin-host-defaults", "");
  style.textContent = HOST_STYLE_DEFAULTS;
  document.head.appendChild(style);
}

const preview: Preview = {
  parameters: {
    layout: "padded",
  },
};

export default preview;
