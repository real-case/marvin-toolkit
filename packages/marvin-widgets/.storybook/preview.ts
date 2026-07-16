import { createElement } from "react";
import type { Decorator, Preview } from "@storybook/react";
import { MV_ROOT_CLASS, ensureMvThemeStyles } from "../src/theme";

/**
 * Storybook page canvas for the mvroot widget family (ADR-0024 restyle).
 *
 * The widgets carry their own theme scope — every view wraps itself in
 * `<MvRoot>` (or, for the primitives, the story's own `withMvRoot` decorator
 * stands in for the owning widget). Their story files map the `hostTheme`
 * dimension onto the view's `theme` prop themselves, reading
 * `parameters.hostTheme ?? globals.hostTheme` — so the toolbar global keeps
 * flipping every static story, while `parameters.hostTheme` pins explicit
 * dark variants (`<Base>Dark`) deterministically for the visual baselines.
 *
 * What is left for the GLOBAL decorator is the page itself: the preview body
 * must sit on the active theme's canvas (a dark story on a white page would
 * poison the dark screenshots). It joins the same token system: the body
 * becomes an `.mvroot` scope with the resolved theme pinned via `data-theme`,
 * and paints `var(--bg)` — the exact tokens the widgets render on.
 */
const withMvCanvas: Decorator = (Story, context) => {
  const t: unknown = context.parameters.hostTheme ?? context.globals.hostTheme;
  const theme = t === "dark" ? "dark" : "light";
  // The token stylesheet is id-keyed — safe to call before any widget renders.
  ensureMvThemeStyles();
  document.body.classList.add(MV_ROOT_CLASS);
  document.body.setAttribute("data-theme", theme);
  // `.mvroot` already carries color + typography; the background is the one
  // thing it deliberately leaves to the canvas owner.
  document.body.style.background = "var(--bg)";
  return createElement(Story);
};

const preview: Preview = {
  parameters: {
    layout: "padded",
  },
  globalTypes: {
    hostTheme: {
      description: "Host theme (light/dark) — stories map it onto MvRoot's `theme`",
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
  decorators: [withMvCanvas],
};

export default preview;
