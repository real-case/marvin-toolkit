import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { ListDetail } from "./ListDetail";
import { MvRoot, TOKENS } from "../theme";
import { waitForCondition } from "../lib/story-helpers";

/**
 * Stories for the `<ListDetail>` primitive (ADR-0024) — the master-detail shell
 * behind the task-list / task-detail / handoffs / tracker-list widgets. Static
 * stories cover the render shapes (default, empty, custom empty label, two-line
 * rows) for screenshots; the `play` stories drive the keyboard contract (arrow
 * navigation, End on a scrolling list) in a real browser via test-storybook.
 */
interface DemoItem {
  id: string;
  title: string;
  note: string;
}

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

const demoItems: DemoItem[] = [
  { id: "alpha", title: "Alpha", note: "The first row of the demo board." },
  { id: "beta", title: "Beta", note: "A second row with its own detail." },
  { id: "gamma", title: "Gamma", note: "Third row — click or arrow to me." },
  { id: "delta", title: "Delta", note: "Fourth row, nothing special." },
  { id: "omega", title: "Omega", note: "The last row of the demo set." },
];

// 40 rows so the master column genuinely overflows a 320px-tall viewport —
// the LongList play scrolls it with End.
const longItems: DemoItem[] = Array.from({ length: 40 }, (_, i) => ({
  id: `row-${i + 1}`,
  title: `Row ${i + 1}`,
  note: `Generated note for row ${i + 1}.`,
}));

const baseArgs = {
  items: demoItems,
  getKey: (item: DemoItem) => item.id,
  renderRow: (item: DemoItem) => <span>{item.title}</span>,
  renderDetail: (item: DemoItem) => (
    <div>
      <h3
        style={{
          margin: "0 0 0.5rem",
          fontSize: "14.5px",
          fontWeight: 500,
          letterSpacing: "-0.01em",
        }}
      >
        {item.title}
      </h3>
      <p style={{ margin: 0 }}>{item.note}</p>
    </div>
  ),
  ariaLabel: "demo items",
};

const meta: Meta<typeof ListDetail<DemoItem>> = {
  title: "Primitives/ListDetail",
  component: ListDetail,
  decorators: [withMvRoot],
};
export default meta;

type Story = StoryObj<typeof ListDetail<DemoItem>>;

/** Baseline: five simple rows with minimal renderers; the first row starts selected. */
export const Default: Story = {
  args: baseArgs,
};

/** An empty `items` renders the default placeholder instead of the split view. */
export const Empty: Story = {
  args: { ...baseArgs, items: [] },
};

/** The empty state accepts an arbitrary node — here prose with an inline `<code>`. */
export const CustomEmptyLabel: Story = {
  args: {
    ...baseArgs,
    items: [],
    emptyLabel: (
      <span>
        No handoffs yet — run <code>/marvin:handoff</code> first.
      </span>
    ),
  },
};

/** Two-line rows (design D): a 500-weight title over an 11.5px meta line in t3. */
export const TwoLineRows: Story = {
  args: {
    ...baseArgs,
    renderRow: (item: DemoItem) => (
      <span style={{ display: "block" }}>
        <span style={{ display: "block", fontWeight: 500 }}>{item.title}</span>
        <span style={{ display: "block", fontSize: "11.5px", color: TOKENS.t3 }}>{item.note}</span>
      </span>
    ),
  },
};

/** 40 rows in a 320px viewport — End jumps to (and scrolls to) the last row. */
export const LongList: Story = {
  args: { ...baseArgs, items: longItems },
  decorators: [
    (Story) => (
      <div style={{ height: "320px", overflow: "hidden" }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const listbox = canvasElement.querySelector<HTMLElement>('[role="listbox"]');
    if (!listbox) throw new Error("LongList: the listbox did not render");
    listbox.focus();
    listbox.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await waitForCondition(() => {
      const options = canvasElement.querySelectorAll('[role="option"]');
      return options[options.length - 1]?.getAttribute("aria-selected") === "true";
    }, "the last option to become aria-selected after End");
  },
};

/** Two ArrowDowns from the top select the third row and swap its detail in. */
export const KeyboardNavigation: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const listbox = canvasElement.querySelector<HTMLElement>('[role="listbox"]');
    if (!listbox) throw new Error("KeyboardNavigation: the listbox did not render");
    listbox.focus();
    listbox.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    listbox.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await waitForCondition(
      () =>
        canvasElement.querySelectorAll('[role="option"]')[2]?.getAttribute("aria-selected") ===
        "true",
      "the third option to become aria-selected after two ArrowDowns",
    );
    const pane = canvasElement.querySelector('[data-testid="list-detail-pane"]');
    if (!pane?.textContent?.includes(demoItems[2].note)) {
      throw new Error("KeyboardNavigation: the detail pane does not show the third item");
    }
  },
};

/** Default under the dark theme (forces `data-theme="dark"` on the MvRoot). */
export const DefaultDark: Story = {
  args: baseArgs,
  parameters: { hostTheme: "dark" },
};
