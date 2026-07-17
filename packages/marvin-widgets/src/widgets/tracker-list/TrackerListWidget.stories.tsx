import { useEffect, useState } from "react";
import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { TrackerListView, TrackerListWidget, type TrackerListSeam } from "./TrackerListWidget";
import { trackerListFixture, noUrlTrackerFixture, emptyTrackerFixture } from "./fixture";
import { createMockHost } from "../../lib/mock-host";
import { waitForCondition } from "../../lib/story-helpers";

/**
 * Stories for the tracker-list widget (ADR-0024 #6): static stories over the pure
 * view cover every render state (fixture in both themes, the url-less
 * configure-hint branch, empty board, PR link-out, and the connecting/no-data/error
 * trio) for the visual-regression screenshots, and a mock-host story whose `play`
 * drives the real ext-apps handshake over an in-memory transport and asserts the
 * tracked tasks (and the external link-out button) render — the
 * `@storybook/test-runner` oracle.
 *
 * The view wraps itself in `MvRoot`, so stories pass no wrapper; the pinned dark
 * variant forces the theme through the view's story-only `theme` prop (production
 * omits it, following the host/OS scheme). `parameters.hostTheme` still rides
 * along so the preview decorator darkens the body canvas behind the panel.
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

const meta: Meta<typeof TrackerListView> = {
  title: "Widgets/TrackerList",
  component: TrackerListView,
  decorators: [withMvTheme],
};
export default meta;

/** Static story — the pure view rendering the fixture directly. */
export const Fixture: StoryObj<typeof TrackerListView> = {
  args: { data: trackerListFixture },
};

/** The fixture pinned dark (`MvRoot theme="dark"` via the view's theme prop). */
export const FixtureDark: StoryObj<typeof TrackerListView> = {
  args: { data: trackerListFixture },
  parameters: { hostTheme: "dark" },
};

/** Tracker ids without a tracker_url (AC6): the configure hint, and no dead link button. */
export const NoTrackerUrl: StoryObj<typeof TrackerListView> = {
  args: { data: noUrlTrackerFixture },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="tracker-hint"]') !== null,
      "the configure hint to render for a url-less tracker id",
    );
    if (canvasElement.querySelector('[data-testid="tracker-link"]')) {
      throw new Error("NoTrackerUrl: expected no tracker link-out button when tracker_url is null");
    }
  },
};

/** No task carries a tracker id — the guidance empty state instead of the split view. */
export const Empty: StoryObj<typeof TrackerListView> = {
  args: { data: emptyTrackerFixture },
};

/** A card carrying both links: the tracker link-out button next to its PR button. */
export const WithPr: StoryObj<typeof TrackerListView> = {
  args: { data: { tasks: [trackerListFixture.tasks[0]] } },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="tracker-link"]') !== null,
      "the tracker link-out button to render",
    );
    const section = canvasElement.querySelector('[data-testid="tracker-section"]');
    if (!section?.textContent?.includes("PR #12")) {
      throw new Error("WithPr: expected the PR link button to render beside the tracker link");
    }
  },
};

/** The pre-handshake state — no data yet, the connecting placeholder. */
export const Connecting: StoryObj<typeof TrackerListView> = {
  args: { data: null, connecting: true },
};

/** Connected but no tool-result ever arrived — the no-data copy. */
export const NoData: StoryObj<typeof TrackerListView> = {
  args: { data: null, connecting: false },
};

/** A handshake failure — the error fallback. (Named ErrorState: `Error` shadows the global.) */
export const ErrorState: StoryObj<typeof TrackerListView> = {
  args: { data: null, error: "kaboom: transport dropped" },
};

/** Wire the widget to a fresh mock-host and connect once the host is armed. */
function MockHostHarness() {
  const [seam, setSeam] = useState<TrackerListSeam | null>(null);
  useEffect(() => {
    const host = createMockHost(trackerListFixture);
    let live = true;
    host.start().then(() => {
      if (live) setSeam(host.seam);
    });
    return () => {
      live = false;
      host.close();
    };
  }, []);
  return seam ? <TrackerListWidget seam={seam} /> : <div>Starting mock host…</div>;
}

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  parameters: { visual: false },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="tracker-counts"]') !== null,
      "the tracker list to render after the mock-host handshake",
    );
    if (!canvasElement.querySelector('[data-testid="tracker-link"]')) {
      throw new Error("mock-host story: expected the tracker link-out button to render");
    }
  },
};
