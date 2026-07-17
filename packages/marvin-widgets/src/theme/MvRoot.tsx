import type { ReactNode } from "react";
import { MV_ROOT_CLASS, MV_STYLE_ELEMENT_ID, MV_THEME_CSS, type MvTheme } from "./tokens";

/**
 * The theme root every restyled widget renders under (docs/design/reports-widget.md).
 * It does two things: puts the token stylesheet into the document (once), and
 * wraps the children in the `.mvroot` scope that carries the tokens and the base
 * typography. It deliberately does NOT paint the widget canvas — the bordered
 * frame (`background: var(--bg)`, 0.5px `var(--bd)`, radius 4px, 14px padding)
 * belongs to each widget's own panel, so panel-less uses stay possible.
 */
export interface MvRootProps {
  children?: ReactNode;
  /** Extra class(es) appended after `mvroot`. */
  className?: string;
  /**
   * Force a theme via the `data-theme` attribute override (wins over the OS
   * `prefers-color-scheme` in both directions). Omit to follow the OS/host
   * scheme — the default for production widgets; pinned dark/light Storybook
   * stories and theme-forcing hosts set it explicitly.
   */
  theme?: MvTheme;
}

/**
 * Put the theme stylesheet into `doc` (default: the global document) exactly
 * once — keyed by the element id, so repeat calls and multiple MvRoots are
 * no-ops after the first. Safe to call in any order with rendering.
 */
export function ensureMvThemeStyles(doc?: Document): void {
  const target = doc ?? (typeof document === "undefined" ? undefined : document);
  if (!target || target.getElementById(MV_STYLE_ELEMENT_ID)) return;
  const style = target.createElement("style");
  style.id = MV_STYLE_ELEMENT_ID;
  style.textContent = MV_THEME_CSS;
  target.head.appendChild(style);
}

/**
 * `<MvRoot>` — the widget family's theme boundary.
 *
 * The style injection runs during render, not in an effect: the tokens must be
 * in the document before the children's first paint (an effect would flash one
 * unstyled frame), and the id-keyed early return makes the write idempotent, so
 * re-renders and concurrent roots stay side-effect-free after the first call.
 */
export function MvRoot({ children, className, theme }: MvRootProps) {
  ensureMvThemeStyles();
  return (
    <div
      className={className ? `${MV_ROOT_CLASS} ${className}` : MV_ROOT_CLASS}
      data-theme={theme}
      data-testid="mv-root"
    >
      {children}
    </div>
  );
}
