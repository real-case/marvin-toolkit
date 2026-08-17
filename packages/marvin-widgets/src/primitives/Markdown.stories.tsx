import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { Markdown } from "./Markdown";
import { MvRoot } from "../theme";
import { waitForCondition } from "../lib/story-helpers";

/**
 * Stories for the `<Markdown>` primitive (ADR-0024). `Sample`/`KitchenSink`
 * render representative fixtures covering every supported construct (the
 * screenshot surface, plus a dark-host variant); the remaining stories pin the
 * safety properties — task-list checkboxes, unsafe-scheme link dropping, raw-HTML
 * escaping, unterminated-fence recovery — with `play` assertions executed by
 * `@storybook/test-runner` (test-storybook), complementing the vitest suite.
 */
const FENCE = "```";
const SAMPLE = [
  "# Marvin markdown",
  "",
  "A paragraph with **bold**, *italic*, `inline code`, and a [link](https://example.com).",
  "",
  "## Lists",
  "",
  "- alpha",
  "- beta",
  "",
  "1. first",
  "2. second",
  "",
  "> A blockquote for context.",
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

// One source exercising EVERY block/inline feature the parser supports — the
// single screenshot that shows the whole rendering surface at once.
const KITCHEN_SINK = [
  "# Heading one",
  "",
  "## Heading two",
  "",
  "### Heading three",
  "",
  "A paragraph with **bold**, *italic*, ~~struck through~~, `inline code`,",
  "and a [safe link](https://example.com/docs).",
  "",
  "> A blockquote spanning",
  "> two source lines.",
  "",
  "- unordered alpha",
  "- unordered beta",
  "",
  "1. ordered first",
  "2. ordered second",
  "",
  "- [ ] task still open",
  "- [x] task already done",
  "",
  FENCE + "ts",
  'const greeting: string = "hello";',
  FENCE,
  "",
  "| Name | Role |",
  "| --- | --- |",
  "| Ada | author |",
  "| Grace | reviewer |",
  "",
  "---",
  "",
  "The end.",
].join("\n");

/**
 * In production the OWNING WIDGET renders the `.mvroot` theme scope; the
 * primitive never wraps itself. This decorator stands in for the widget here.
 * The forced `theme` follows the story's `hostTheme` parameter (or the toolbar
 * global), so pinned dark variants stay deterministic for visual baselines.
 */
const withMvRoot: Decorator = (Story, context) => {
  const t: unknown = context.parameters.hostTheme ?? context.globals.hostTheme;
  return (
    <MvRoot theme={t === "dark" ? "dark" : t === "light" ? "light" : undefined}>
      <Story />
    </MvRoot>
  );
};

const meta: Meta<typeof Markdown> = {
  title: "Primitives/Markdown",
  component: Markdown,
  decorators: [withMvRoot],
};
export default meta;

/** The original representative fixture; `play` asserts the key elements exist. */
export const Sample: StoryObj<typeof Markdown> = {
  args: { source: SAMPLE },
  play: async ({ canvasElement }) => {
    const missing: string[] = [];
    for (const sel of [
      "h1",
      "strong",
      "em",
      "a[href]",
      "ul li",
      "ol li",
      "blockquote",
      "hr",
      "pre code",
      "table td",
    ]) {
      if (!canvasElement.querySelector(sel)) missing.push(sel);
    }
    if (missing.length > 0) {
      throw new Error(`Markdown story: expected elements not rendered: ${missing.join(", ")}`);
    }
  },
};

/** Every supported construct in one source — the full-surface screenshot story. */
export const KitchenSink: StoryObj<typeof Markdown> = {
  args: { source: KITCHEN_SINK },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="markdown"]') !== null,
      "the markdown wrapper to render",
    );
    const missing: string[] = [];
    for (const sel of [
      "h1",
      "h2",
      "h3",
      "strong",
      "em",
      "del",
      "a[href]",
      "ul li",
      "ol li",
      "li input[type=checkbox]",
      "blockquote",
      "hr",
      "pre code",
      "table th",
      "table td",
    ]) {
      if (!canvasElement.querySelector(sel)) missing.push(sel);
    }
    if (missing.length > 0) {
      throw new Error(`KitchenSink: expected elements not rendered: ${missing.join(", ")}`);
    }
  },
};

/** Task-list items render read-only: disabled checkboxes with the right states. */
export const TaskChecklist: StoryObj<typeof Markdown> = {
  args: {
    source: ["- [ ] write the spec", "- [x] ship the widget", "- [X] uppercase also done"].join(
      "\n",
    ),
  },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelectorAll("input[type=checkbox]").length === 3,
      "three task checkboxes to render",
    );
    const boxes = Array.from(
      canvasElement.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
    );
    if (!boxes.every((b) => b.disabled)) {
      throw new Error("TaskChecklist: expected every checkbox to be disabled");
    }
    const states = boxes.map((b) => b.checked).join(",");
    if (states !== "false,true,true") {
      throw new Error(`TaskChecklist: wrong checked states: ${states}`);
    }
  },
};

/** An unsafe `javascript:` link is dropped to plain text; the safe one survives. */
export const UnsafeLinkDropped: StoryObj<typeof Markdown> = {
  args: {
    source: "Do not click [x](javascript:alert(1)), but [ok](https://example.com) is fine.",
  },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="markdown"]') !== null,
      "the markdown wrapper to render",
    );
    const anchors = Array.from(canvasElement.querySelectorAll("a"));
    if (anchors.length !== 1) {
      throw new Error(`UnsafeLinkDropped: expected exactly one anchor, got ${anchors.length}`);
    }
    const href = anchors[0].getAttribute("href") ?? "";
    if (!href.startsWith("https")) {
      throw new Error(`UnsafeLinkDropped: the surviving href is not https: ${href}`);
    }
  },
};

/** Raw HTML in the source reaches the DOM only as escaped literal text. */
export const RawHtmlEscaped: StoryObj<typeof Markdown> = {
  args: { source: "Raw HTML stays text: <script>alert(1)</script> and <b>bold?</b>" },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="markdown"]') !== null,
      "the markdown wrapper to render",
    );
    if (canvasElement.querySelector("[data-testid='markdown'] script")) {
      throw new Error("RawHtmlEscaped: a script element rendered from the source");
    }
    if (canvasElement.querySelector("[data-testid='markdown'] b")) {
      throw new Error("RawHtmlEscaped: a <b> element rendered from the source");
    }
    const text = canvasElement.textContent ?? "";
    if (!text.includes("<script>alert(1)</script>") || !text.includes("<b>bold?</b>")) {
      throw new Error("RawHtmlEscaped: the raw HTML is not present as literal text");
    }
  },
};

/** A fence that never closes renders to EOF as one code block — never throws. */
export const UnterminatedFence: StoryObj<typeof Markdown> = {
  args: {
    source: ["Before the fence.", "", FENCE, "const stillCode = true;", "// never closed"].join(
      "\n",
    ),
  },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector("pre code") !== null,
      "the unterminated fence to render as a code block",
    );
    const code = canvasElement.querySelector("pre code")?.textContent ?? "";
    if (!code.includes("const stillCode = true;") || !code.includes("// never closed")) {
      throw new Error("UnterminatedFence: the fence body did not render to EOF as code");
    }
  },
};

/** The kitchen sink under the dark theme (forces `data-theme="dark"` on the MvRoot). */
export const KitchenSinkDark: StoryObj<typeof Markdown> = {
  args: { source: KITCHEN_SINK },
  parameters: { hostTheme: "dark" },
};
