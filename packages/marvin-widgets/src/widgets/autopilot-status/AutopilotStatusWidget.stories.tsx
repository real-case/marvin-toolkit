import { useEffect, useState } from "react";
import type { Decorator, Meta, StoryObj } from "@storybook/react";
import {
  AutopilotStatusView,
  AutopilotStatusWidget,
  type AutopilotStatusSeam,
} from "./AutopilotStatusWidget";
import {
  haltedFixture,
  quietFixture,
  readyFixture,
  runningFixture,
  waitingFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";
import { waitForCondition } from "../../lib/story-helpers";

/**
 * Stories for the autopilot-status widget (ADR-0051): one per card state of the approved
 * variant A — running, waiting on an answer, ready, halted — plus a quiet English interval, the
 * running card pinned dark, and the connecting / no-data / error trio. The mock-host story drives
 * the real ext-apps handshake and opts out of visual capture, since its settled DOM duplicates
 * `Running`.
 */
const withMvTheme: Decorator = (Story, context) => {
  const t: unknown = context.parameters.hostTheme ?? context.globals.hostTheme;
  return Story({
    args: { ...context.args, theme: t === "dark" ? "dark" : t === "light" ? "light" : undefined },
  });
};

const meta: Meta<typeof AutopilotStatusView> = {
  title: "Widgets/AutopilotStatus",
  component: AutopilotStatusView,
  decorators: [withMvTheme],
};
export default meta;

type Story = StoryObj<typeof AutopilotStatusView>;

export const Running: Story = { args: { data: runningFixture } };

export const RunningDark: Story = {
  args: { data: runningFixture },
  parameters: { hostTheme: "dark" },
};

export const Waiting: Story = { args: { data: waitingFixture } };

export const Ready: Story = { args: { data: readyFixture } };

export const Halted: Story = { args: { data: haltedFixture } };

/** No events in the interval: the card says so and names who is still working. */
export const QuietEnglish: Story = { args: { data: quietFixture } };

export const Connecting: Story = { args: { data: null, connecting: true } };

export const NoData: Story = { args: { data: null, connecting: false } };

export const ErrorState: Story = { args: { data: null, error: "kaboom: transport dropped" } };

function MockHostHarness() {
  const [seam, setSeam] = useState<AutopilotStatusSeam | null>(null);
  useEffect(() => {
    const host = createMockHost(runningFixture);
    let live = true;
    host.start().then(() => {
      if (live) setSeam(host.seam);
    });
    return () => {
      live = false;
      host.close();
    };
  }, []);
  return seam ? <AutopilotStatusWidget seam={seam} /> : <div>Starting mock host…</div>;
}

export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  parameters: { visual: false },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="autopilot-card"]') !== null,
      "the autopilot card to render after the handshake",
    );
    if (canvasElement.querySelectorAll('[data-testid="rail-step"]').length !== 7) {
      throw new Error("mock-host story: expected seven rail steps");
    }
  },
};
