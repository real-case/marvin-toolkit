import { createElement } from "react";
import type { Decorator, Preview } from "@storybook/react";

/**
 * Host-style variables so the widgets render standalone in Storybook. A real
 * MCP Apps host pushes these via `ui/notifications/host-context-changed`; the
 * widgets read them through `var(--…, fallback)`, so Storybook only has to set
 * the same custom properties to preview the host look — in BOTH host themes.
 *
 * The theme is a dimension, not a fixed default: the `hostTheme` toolbar global
 * flips it for humans, and `parameters.hostTheme` pins it per story so dark
 * variants are explicit stories (`<Base>Dark`) that the visual-regression
 * screenshots capture deterministically.
 */
const LIGHT_HOST_VARS: Record<string, string> = {
  "--color-background-primary": "#ffffff",
  "--color-background-secondary": "#f4f4f5",
  "--color-background-info": "#eef4ff",
  "--color-background-success": "#e6f4ea",
  "--color-background-warning": "#fef7e0",
  "--color-background-danger": "#fdecea",
  "--color-text-primary": "#1a1a1a",
  "--color-text-secondary": "#555",
  "--color-text-info": "#0b57d0",
  "--color-text-success": "#137333",
  "--color-text-warning": "#8a6d00",
  "--color-text-danger": "#b00020",
  "--color-border-primary": "#e2e2e2",
  "--color-border-secondary": "#f0f0f0",
  "--color-border-info": "#0b57d0",
  "--border-radius-sm": "4px",
  "--border-radius-md": "8px",
  "--font-sans": "system-ui, -apple-system, sans-serif",
  "--font-mono": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

/** A plausible dark host: same keys as light so switching always overwrites. */
const DARK_HOST_VARS: Record<string, string> = {
  "--color-background-primary": "#1e1e22",
  "--color-background-secondary": "#2a2a30",
  "--color-background-info": "#1c2a45",
  "--color-background-success": "#16281c",
  "--color-background-warning": "#2e2812",
  "--color-background-danger": "#3a1d1d",
  "--color-text-primary": "#e8e8ea",
  "--color-text-secondary": "#a0a0ab",
  "--color-text-info": "#8ab4f8",
  "--color-text-success": "#81c995",
  "--color-text-warning": "#fdd663",
  "--color-text-danger": "#f28b82",
  "--color-border-primary": "#3a3a42",
  "--color-border-secondary": "#2f2f36",
  "--color-border-info": "#8ab4f8",
  "--border-radius-sm": "4px",
  "--border-radius-md": "8px",
  "--font-sans": "system-ui, -apple-system, sans-serif",
  "--font-mono": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

const HOST_PALETTES: Record<string, Record<string, string>> = {
  light: LIGHT_HOST_VARS,
  dark: DARK_HOST_VARS,
};

/**
 * Apply the host palette for the story's theme. Story-level `parameters.hostTheme`
 * beats the toolbar global (a pinned dark variant must stay dark while a human
 * browses in light). Both palettes carry the identical key set, so re-applying
 * on every render is idempotent AND switching back to light restores every
 * value — no `removeProperty` bookkeeping needed. The body colours are set too
 * because widgets paint on the host's canvas, not their own background.
 */
const withHostTheme: Decorator = (Story, context) => {
  const theme: string = context.parameters.hostTheme ?? context.globals.hostTheme ?? "light";
  const palette = HOST_PALETTES[theme] ?? LIGHT_HOST_VARS;
  for (const [name, value] of Object.entries(palette)) {
    document.documentElement.style.setProperty(name, value);
  }
  document.body.style.background = palette["--color-background-primary"];
  document.body.style.color = palette["--color-text-primary"];
  // Hosts render widgets in a document whose base font is the host sans stack;
  // without this the primitives' standalone stories (no widget wrapper to set
  // fontFamily) fall back to the browser's default serif.
  document.body.style.fontFamily = palette["--font-sans"];
  return createElement(Story);
};

const preview: Preview = {
  parameters: {
    layout: "padded",
  },
  globalTypes: {
    hostTheme: {
      description: "Host theme (the CSS custom properties an MCP Apps host would push)",
      toolbar: {
        title: "Host theme",
        icon: "paintbrush",
        items: ["light", "dark"],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    hostTheme: "light",
  },
  decorators: [withHostTheme],
};

export default preview;
