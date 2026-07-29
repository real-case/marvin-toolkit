import { useEffect, useState } from "react";
import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { DashboardView, DashboardWidget, type DashboardSeam } from "./DashboardWidget";
import {
  dashboardFixture,
  coreOnlyDashboardFixture,
  freshDashboardFixture,
  noGitDashboardFixture,
  longPathsDashboardFixture,
  scannedCleanDashboardFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";
import { waitForCondition } from "../../lib/story-helpers";

/**
 * Stories for the reworked dashboard widget (ADR-0024 #8). Static stories over
 * the fixture family cover the render range — full payload (default light +
 * pinned dark), the help-narrow core-only shape, the present-but-zeroed fresh
 * project, the git-less identity strip, the long-paths stress shape, the
 * scanned-clean-versus-never-scanned audit pair, and the connecting / no-data /
 * error trio — as the visual-regression screenshot surface. The mock-host
 * story's `play` drives the real ext-apps handshake over an in-memory transport
 * and asserts the panel renders — the `@storybook/test-runner` oracle.
 *
 * The view renders its own `<MvRoot>` (family theme), so `withMvTheme` pins the
 * theme through the view's `theme` prop. The default stories leave `theme` unset
 * — the OS/host scheme applies, light in the headless runner — and the dark
 * variant pins the view's MvRoot via the story-only `theme` prop (plus
 * `hostTheme` so the Storybook canvas behind the widget matches).
 *
 * The runner pins the viewport at 1000×800, so NO story here exercises a
 * responsive breakpoint. The four breakpoint rules are asserted on the injected
 * stylesheet's text in the unit test instead.
 */
const withMvTheme: Decorator = (Story, context) => {
  const t: unknown = context.parameters.hostTheme ?? context.globals.hostTheme;
  return Story({
    args: { ...context.args, theme: t === "dark" ? "dark" : t === "light" ? "light" : undefined },
  });
};

const meta: Meta<typeof DashboardView> = {
  title: "Widgets/Dashboard",
  component: DashboardView,
  decorators: [withMvTheme],
};
export default meta;

/** Static story — the pure view rendering the full v2 fixture directly. */
export const Fixture: StoryObj<typeof DashboardView> = {
  args: { data: dashboardFixture },
};

/** The full fixture with the widget's MvRoot pinned dark (deterministic dark baseline). */
export const FixtureDark: StoryObj<typeof DashboardView> = {
  args: { data: dashboardFixture },
  parameters: { hostTheme: "dark" },
};

/** The help-narrow payload — every optional section absent, so the v2 zones are omitted. */
export const CoreOnly: StoryObj<typeof DashboardView> = {
  args: { data: coreOnlyDashboardFixture },
};

/** A fresh project — sections present but empty, so each renders its zero-state. */
export const FreshProject: StoryObj<typeof DashboardView> = {
  args: { data: freshDashboardFixture },
};

/**
 * The discriminating audit pair: security scanned clean (a report exists and
 * found nothing) beside refactor never scanned (no report at all). The two must
 * NOT render identically — a never-scanned area reading as clean is the single
 * most misleading thing this widget could say.
 */
export const AuditsScannedClean: StoryObj<typeof DashboardView> = {
  args: { data: scannedCleanDashboardFixture },
};

/** Outside a git repository — the identity strip dims its badges. */
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
    for (const testid of ["dashboard-sidebar", "zone-project", "zone-work", "zone-toolbox"]) {
      if (!canvasElement.querySelector(`[data-testid="${testid}"]`)) {
        throw new Error(`mock-host story: expected ${testid} to render`);
      }
    }
    if (!canvasElement.querySelector('[data-testid="card-audits"]')) {
      throw new Error("mock-host story: expected the audits card to render from the payload");
    }
  },
};
