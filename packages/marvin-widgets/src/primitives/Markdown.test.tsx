import { describe, it, expect } from "vitest";
import { render } from "@testing-library/preact";
import { Markdown } from "./Markdown";

// Build a source with every supported construct. Fences are spelled as a string
// so the backticks don't terminate this file's template literals.
const FENCE = "```";
const FULL = [
  "# Heading one",
  "## Heading two",
  "###### Heading six",
  "",
  "A paragraph with **bold**, *italic*, `inline` and a [site](https://example.com/x).",
  "",
  "- alpha",
  "- beta",
  "",
  "1. first",
  "2. second",
  "",
  "> quoted text",
  "",
  "---",
  "",
  FENCE,
  "const answer = 42;",
  FENCE,
  "",
  "| Name | Role |",
  "| --- | --- |",
  "| Ada | author |",
].join("\n");

describe("Markdown — AC1 (construct → element mapping)", () => {
  it("renders the supported markdown constructs to their elements", () => {
    const { container } = render(<Markdown source={FULL} />);

    // headings by depth
    expect(container.querySelector("h1")?.textContent).toBe("Heading one");
    expect(container.querySelector("h2")?.textContent).toBe("Heading two");
    expect(container.querySelector("h6")?.textContent).toBe("Heading six");

    // inline emphasis + code
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    // the inline `inline` code span (not the fenced block, which is inside <pre>)
    const inlineCode = Array.from(container.querySelectorAll("code")).find(
      (c) => !c.closest("pre"),
    );
    expect(inlineCode?.textContent).toBe("inline");

    // link with its href
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/x");
    expect(link?.textContent).toBe("site");

    // unordered + ordered lists
    const uls = container.querySelectorAll("ul");
    expect(uls).toHaveLength(1);
    expect(Array.from(uls[0].querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "alpha",
      "beta",
    ]);
    const ols = container.querySelectorAll("ol");
    expect(ols).toHaveLength(1);
    expect(Array.from(ols[0].querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "first",
      "second",
    ]);

    // blockquote, thematic break, fenced code
    expect(container.querySelector("blockquote")?.textContent).toContain("quoted text");
    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.querySelector("pre code")?.textContent).toBe("const answer = 42;");

    // table — header row + body cells
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(Array.from(table!.querySelectorAll("th")).map((th) => th.textContent)).toEqual([
      "Name",
      "Role",
    ]);
    expect(Array.from(table!.querySelectorAll("tbody td")).map((td) => td.textContent)).toEqual([
      "Ada",
      "author",
    ]);
  });
});

describe("Markdown — AC2 (graceful degradation)", () => {
  const MALFORMED = [
    "",
    FENCE, // unterminated fence — no closing ```
    "unclosed code body",
    "a | lone | pipe with no delimiter row",
    "*emphasis with no close",
    "`code with no close",
    "> quote then nothing",
    "plain user body — TODO(marvin): ship it & <keep> me",
  ].join("\n");

  it("degrades unknown or malformed input to text without throwing", () => {
    let result: ReturnType<typeof render> | undefined;
    expect(() => {
      result = render(<Markdown source={MALFORMED} />);
    }).not.toThrow();

    const text = result!.container.textContent ?? "";
    // no source text is dropped
    expect(text).toContain("unclosed code body");
    expect(text).toContain("a | lone | pipe with no delimiter row");
    expect(text).toContain("*emphasis with no close");
    expect(text).toContain("`code with no close");
    expect(text).toContain("quote then nothing");
    expect(text).toContain("TODO(marvin): ship it & <keep> me");

    // the lone-pipe line is NOT promoted to a table (no delimiter row)
    expect(result!.container.querySelector("table")).toBeNull();

    // an empty source renders without throwing and produces no blocks
    expect(() => render(<Markdown source="" />)).not.toThrow();
  });
});

describe("Markdown — AC3 (no HTML injection)", () => {
  it("escapes raw HTML and never injects markup", () => {
    const source = "Danger: <script>alert(1)</script> and <img src=x onerror=alert(2)>.";
    const { container } = render(<Markdown source={source} />);

    // the raw HTML is inert text, not live elements
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();

    // the angle-bracketed markup appears as literal text
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain("<img src=x onerror=alert(2)>");
  });
});

describe("Markdown — AC4 (unsafe link schemes neutralised)", () => {
  it("neutralises unsafe link schemes", () => {
    const source =
      "[evil](javascript:alert(1)) [data](data:text/html,x) [ok](https://ok.example/p) [rel](/local)";
    const { container } = render(<Markdown source={source} />);

    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    // no anchor carries an unsafe scheme
    expect(hrefs.some((h) => /^\s*javascript:/i.test(h ?? ""))).toBe(false);
    expect(hrefs.some((h) => /^\s*data:/i.test(h ?? ""))).toBe(false);
    // the safe links survive as real anchors
    expect(hrefs).toContain("https://ok.example/p");
    expect(hrefs).toContain("/local");
    // the unsafe links degrade to their visible text (no dropped content)
    expect(container.textContent).toContain("evil");
    expect(container.textContent).toContain("data");
  });
});
