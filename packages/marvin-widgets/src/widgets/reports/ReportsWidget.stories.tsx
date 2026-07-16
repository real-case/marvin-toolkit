import { useEffect, useState } from "react";
import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { ReportsView, ReportsWidget, type ReportsSeam } from "./ReportsWidget";
import {
  REPORTS_NOW,
  cleanReportsFixture,
  deepLinkReportsFixture,
  emptyReportsFixture,
  gatesFailedFixture,
  reportsFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";
import { waitForCondition } from "../../lib/story-helpers";

/**
 * Stories for the reports widget (docs/design/reports-widget.md). Static
 * stories drive the pure {@link ReportsView} straight through args with the
 * pinned {@link REPORTS_NOW} clock, so every age label — and therefore every
 * visual snapshot — is deterministic. The view renders its own `<MvRoot>`
 * boundary; `FixtureDark` pins the dark palette through the view's `theme`
 * prop (production omits it and follows the host/OS scheme). Two `play`
 * stories add behaviour: the filter → select → expand interaction chain, and a
 * mock-host story that drives the real ext-apps handshake over an in-memory
 * transport — the `@storybook/test-runner` oracle.
 */
/**
 * Maps the story's `hostTheme` parameter (or the toolbar global) onto the
 * view's `theme` prop — the view renders its own `MvRoot`, so a wrapping
 * decorator cannot pin the theme (a nested unpinned `.mvroot` would re-declare
 * the light tokens). `FixtureDark` stays a pinned screenshot while the toolbar
 * keeps flipping every static story.
 */
const withMvTheme: Decorator = (Story, context) => {
  const t: unknown = context.parameters.hostTheme ?? context.globals.hostTheme;
  return Story({
    args: { ...context.args, theme: t === "dark" ? "dark" : t === "light" ? "light" : undefined },
  });
};

const meta: Meta<typeof ReportsView> = {
  title: "Widgets/Reports",
  component: ReportsView,
  decorators: [withMvTheme],
};
export default meta;

type Story = StoryObj<typeof ReportsView>;

/** Static story — the full multi-group fixture, light theme. */
export const Fixture: Story = {
  args: { data: reportsFixture, now: REPORTS_NOW },
};

/** The same fixture with the dark palette pinned via MvRoot's theme override. */
export const FixtureDark: Story = {
  args: { data: reportsFixture, now: REPORTS_NOW },
  parameters: { hostTheme: "dark" },
};

/** Deep-link — `payload.selected` pre-selects the spec document's row. */
export const DeepLinked: Story = {
  args: { data: deepLinkReportsFixture, now: REPORTS_NOW },
  play: async ({ canvasElement }) => {
    await waitForCondition(() => {
      const title = canvasElement.querySelector('[data-testid="detail-title"]');
      return title?.textContent === "Spec: widget family";
    }, "the deep-linked spec report to be pre-selected");
  },
};

/** Degraded empty — nothing generated yet: icon square, explainer, filled CTA. */
export const Empty: Story = {
  args: { data: emptyReportsFixture, now: REPORTS_NOW },
};

/** Positive empty — one clean findings report: the all-clear detail state. */
export const Clean: Story = {
  args: { data: cleanReportsFixture, now: REPORTS_NOW },
};

/** A red verification — fail pill in the envelope, red rows, failure notes. */
export const GatesFailed: Story = {
  args: { data: gatesFailedFixture, now: REPORTS_NOW },
};

/** The pre-handshake state — the wordless four-bar skeleton. */
export const Connecting: Story = {
  args: { data: null, connecting: true },
};

/** A transport/handshake failure — the red one-liner. (Named to dodge the global Error.) */
export const ErrorState: Story = {
  args: { data: null, error: "kaboom: transport dropped" },
};

/**
 * The interaction chain: filter to the refactor group, select the smells
 * register, expand its top finding — asserting the group segment presses, the
 * detail switches, and the disclosure opens with evidence + direction.
 */
export const FilterSelectExpand: Story = {
  args: { data: reportsFixture, now: REPORTS_NOW },
  play: async ({ canvasElement }) => {
    const segment = Array.from(
      canvasElement.querySelectorAll<HTMLButtonElement>('[data-testid="group-filter"] button'),
    ).find((b) => (b.textContent ?? "").startsWith("Refactor"));
    if (!segment) throw new Error("FilterSelectExpand: the Refactor segment did not render");
    segment.click();
    await waitForCondition(
      () => canvasElement.querySelectorAll('[role="option"]').length === 2,
      "the list to narrow to the two refactor reports",
    );

    const row = Array.from(canvasElement.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (o) => (o.textContent ?? "").includes("Smells: api layer"),
    );
    if (!row) throw new Error("FilterSelectExpand: the smells register row did not render");
    row.click();
    await waitForCondition(() => {
      const title = canvasElement.querySelector('[data-testid="detail-title"]');
      return title?.textContent === "Smells: api layer";
    }, "the smells register detail to render");

    const head = Array.from(
      canvasElement.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ).find((b) => (b.textContent ?? "").includes("God module"));
    if (!head) throw new Error("FilterSelectExpand: the God-module disclosure row did not render");
    head.click();
    await waitForCondition(
      () =>
        head.getAttribute("aria-expanded") === "true" &&
        canvasElement.querySelector('[data-testid="finding-evidence"]') !== null &&
        canvasElement.querySelector('[data-testid="finding-direction"]') !== null,
      "the finding to expand with evidence and direction",
    );
  },
};

/** Wire the widget to a fresh mock-host and connect once the host is armed. */
function MockHostHarness() {
  const [seam, setSeam] = useState<ReportsSeam | null>(null);
  useEffect(() => {
    const host = createMockHost(reportsFixture);
    let live = true;
    host.start().then(() => {
      if (live) setSeam(host.seam);
    });
    return () => {
      live = false;
      host.close();
    };
  }, []);
  return seam ? <ReportsWidget seam={seam} /> : <div>Starting mock host…</div>;
}

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  parameters: { visual: false },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="reports-kpis"]') !== null,
      "the KPI strip to render after the mock-host handshake",
    );
    const count = canvasElement.querySelector('[data-testid="reports-count"]');
    if (count?.textContent !== "8") {
      throw new Error("mock-host story: expected all eight reports to arrive");
    }
    if (!canvasElement.querySelector('[data-testid="checks-body"]')) {
      throw new Error("mock-host story: expected the verification checks body to render");
    }
  },
};
