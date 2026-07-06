import type { Meta, StoryObj } from "@storybook/react";
import { Markdown } from "./Markdown";

/**
 * Stories for the `<Markdown>` primitive (ADR-0024). A single story renders a
 * representative fixture covering every supported construct; its `play` asserts
 * the key elements rendered in a real browser (the `@storybook/test-runner` /
 * test-storybook oracle), complementing the vitest suite.
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

const meta: Meta<typeof Markdown> = {
  title: "Primitives/Markdown",
  component: Markdown,
};
export default meta;

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
