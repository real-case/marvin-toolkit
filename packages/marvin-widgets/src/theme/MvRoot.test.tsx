import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/preact";
import { MvRoot, ensureMvThemeStyles } from "./MvRoot";
import { MV_STYLE_ELEMENT_ID, MV_THEME_CSS } from "./tokens";

const styleElements = () =>
  document.querySelectorAll<HTMLStyleElement>(`style#${MV_STYLE_ELEMENT_ID}`);

describe("MvRoot", () => {
  it("renders children inside the .mvroot scope and injects the stylesheet once across two mounts", () => {
    render(<MvRoot>first child</MvRoot>);
    render(<MvRoot>second child</MvRoot>);

    // both roots render, each carrying the theme class
    expect(screen.getByText("first child")).toBeTruthy();
    expect(screen.getByText("second child")).toBeTruthy();
    for (const root of screen.getAllByTestId("mv-root")) {
      expect(root.className).toBe("mvroot");
    }

    // exactly one style element for the whole document, carrying the token CSS
    const styles = styleElements();
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toBe(MV_THEME_CSS);
  });

  it("passes an extra className through after mvroot", () => {
    render(<MvRoot className="custom extra">x</MvRoot>);
    const root = screen
      .getAllByTestId("mv-root")
      .find((el) => el.classList.contains("custom")) as HTMLElement;
    expect(root.className).toBe("mvroot custom extra");
  });

  it("stamps data-theme only when a theme is forced", () => {
    const { container: forced } = render(<MvRoot theme="dark">dark</MvRoot>);
    const { container: free } = render(<MvRoot>free</MvRoot>);
    expect(forced.querySelector(".mvroot")?.getAttribute("data-theme")).toBe("dark");
    expect(free.querySelector(".mvroot")?.getAttribute("data-theme")).toBeNull();
  });

  it("ensureMvThemeStyles is idempotent when called directly", () => {
    ensureMvThemeStyles();
    ensureMvThemeStyles(document);
    expect(styleElements()).toHaveLength(1);
  });
});
