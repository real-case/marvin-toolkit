import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { DashboardView, DashboardWidget, type DashboardSeam } from "./DashboardWidget";
import { dashboardFixture } from "./fixture";
import { createMockHost } from "../../lib/mock-host";

/**
 * Stories for the dashboard widget (ADR-0024 #8): a static component story over the
 * fixture (visual/dev), and a mock-host story whose `play` drives the real ext-apps
 * handshake over an in-memory transport and asserts the panel renders — the
 * `@storybook/test-runner` (test-storybook) oracle.
 */
const meta: Meta<typeof DashboardView> = {
  title: "Widgets/Dashboard",
  component: DashboardView,
};
export default meta;

/** Static story — the pure view rendering the fixture directly. */
export const Fixture: StoryObj<typeof DashboardView> = {
  args: { data: dashboardFixture },
};

/** Wire the widget to a fresh mock-host and connect once the host is armed. */
function MockHostHarness() {
  const [seam, setSeam] = useState<DashboardSeam | null>(null);
  useEffect(() => {
    const host = createMockHost(dashboardFixture);
    let live = true;
    host.start().then(() => {
      if (live) setSeam(host.seam);
    });
    return () => {
      live = false;
      host.close();
    };
  }, []);
  return seam ? <DashboardWidget seam={seam} /> : <div>Starting mock host…</div>;
}

async function waitForPanel(root: HTMLElement) {
  for (let i = 0; i < 50; i += 1) {
    if (root.querySelector('[data-testid="dashboard-header"]')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("mock-host story: expected the dashboard panel to render");
}

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  play: async ({ canvasElement }) => {
    await waitForPanel(canvasElement);
    if (!canvasElement.querySelector('[data-testid="card-kanban"]')) {
      throw new Error("mock-host story: expected the kanban card to render");
    }
    if (!canvasElement.querySelector('[data-testid="card-usage"]')) {
      throw new Error("mock-host story: expected the usage card to render from the payload");
    }
  },
};
