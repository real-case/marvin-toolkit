import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { DashboardView, DashboardWidget, type DashboardSeam } from "./DashboardWidget";
import {
  dashboardFixture,
  coreOnlyDashboardFixture,
  freshDashboardFixture,
  noGitDashboardFixture,
  longPathsDashboardFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";
import { waitForCondition } from "../../lib/story-helpers";

/**
 * Stories for the dashboard widget (ADR-0024 #8). Static stories over the fixture
 * family cover the render range — full payload (light + dark host), the help-narrow
 * core-only shape, the present-but-zeroed fresh project, the git-less header, the
 * long-paths stress shape, and the connecting / no-data / error trio — as the
 * visual-regression screenshot surface. The mock-host story's `play` drives the
 * real ext-apps handshake over an in-memory transport and asserts the panel
 * renders — the `@storybook/test-runner` (test-storybook) oracle.
 */
const meta: Meta<typeof DashboardView> = {
  title: "Widgets/Dashboard",
  component: DashboardView,
};
export default meta;

/** Static story — the pure view rendering the full fixture directly. */
export const Fixture: StoryObj<typeof DashboardView> = {
  args: { data: dashboardFixture },
};

/** The full fixture under the dark host theme (the preview decorator applies the host vars). */
export const FixtureDark: StoryObj<typeof DashboardView> = {
  args: { data: dashboardFixture },
  parameters: { hostTheme: "dark" },
};

/** The help-narrow payload — every extended section absent, only the 5 core cards render. */
export const CoreOnly: StoryObj<typeof DashboardView> = {
  args: { data: coreOnlyDashboardFixture },
};

/** A fresh project — extended sections present but zeroed, so each card shows its zero-state. */
export const FreshProject: StoryObj<typeof DashboardView> = {
  args: { data: freshDashboardFixture },
};

/** Outside a git repository — the header shows ✗ badges and "(not in a git repo)". */
export const NoGitRepo: StoryObj<typeof DashboardView> = {
  args: { data: noGitDashboardFixture },
};

/** Monorepo-deep paths and a long base branch — the `<code>` break-all stress shot. */
export const LongPaths: StoryObj<typeof DashboardView> = {
  args: { data: longPathsDashboardFixture },
};

/** No data yet while the handshake is in flight — the "Connecting…" placeholder. */
export const Connecting: StoryObj<typeof DashboardView> = {
  args: { data: null, connecting: true },
};

/** Connected but no payload arrived — the "No dashboard data." copy. */
export const NoData: StoryObj<typeof DashboardView> = {
  args: { data: null, connecting: false },
};

/** A transport error replaces the panel with the danger-coloured message. */
export const ErrorState: StoryObj<typeof DashboardView> = {
  args: { data: null, error: "kaboom: transport dropped" },
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

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  // The render depends on the async handshake, so it is excluded from screenshots.
  parameters: { visual: false },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="dashboard-header"]') !== null,
      "the dashboard panel to render after the mock-host handshake",
    );
    if (!canvasElement.querySelector('[data-testid="card-board"]')) {
      throw new Error("mock-host story: expected the board card to render");
    }
    if (!canvasElement.querySelector('[data-testid="card-usage"]')) {
      throw new Error("mock-host story: expected the usage card to render from the payload");
    }
  },
};
