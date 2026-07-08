import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TrackerListView, TrackerListWidget, type TrackerListSeam } from "./TrackerListWidget";
import { trackerListFixture } from "./fixture";
import { createMockHost } from "../../lib/mock-host";

/**
 * Stories for the tracker-list widget (ADR-0024 #6): a static component story over
 * the fixture (visual/dev), and a mock-host story whose `play` drives the real
 * ext-apps handshake over an in-memory transport and asserts the tracked tasks (and
 * the external link-out button) render — the `@storybook/test-runner` oracle.
 */
const meta: Meta<typeof TrackerListView> = {
  title: "Widgets/TrackerList",
  component: TrackerListView,
};
export default meta;

/** Static story — the pure view rendering the fixture directly. */
export const Fixture: StoryObj<typeof TrackerListView> = {
  args: { data: trackerListFixture },
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

async function waitForList(root: HTMLElement) {
  for (let i = 0; i < 50; i += 1) {
    if (root.querySelector('[data-testid="tracker-counts"]')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("mock-host story: expected the tracker list to render");
}

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  play: async ({ canvasElement }) => {
    await waitForList(canvasElement);
    if (!canvasElement.querySelector('[data-testid="tracker-link"]')) {
      throw new Error("mock-host story: expected the tracker link-out button to render");
    }
  },
};
