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
  readyEnglishFixture,
  readyFixture,
  runningFixture,
  waitingFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";
import { waitForCondition } from "../../lib/story-helpers";

/**
 * Stories for the autopilot-status widget (ADR-0051): one per card state — running, waiting on
 * an answer, ready, halted (with a session name long enough to clamp) — plus the running card
 * with its history unfolded, the final card dark, with its tokens by role and evidence unfolded,
 * and in English with the gaps a run can leave, a quiet English interval, the running card pinned dark, and the
 * connecting / no-data / error trio. The mock-host story drives
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

/** The events unfolded to the whole run: the toggle is clicked before the capture. */
export const RunningHistory: Story = {
  args: { data: runningFixture },
  play: async ({ canvasElement }) => {
    const toggle = canvasElement.querySelector<HTMLButtonElement>(
      '[data-testid="autopilot-history-toggle"]',
    );
    if (!toggle) throw new Error("RunningHistory: no history toggle");
    toggle.click();
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="autopilot-history-divider"]') !== null,
      "the history to unfold",
    );
  },
};

export const Waiting: Story = { args: { data: waitingFixture } };

/** The final card (ADR-0051): the run summed up once it is over, with no footer. */
export const Ready: Story = { args: { data: readyFixture } };

export const ReadyDark: Story = {
  args: { data: readyFixture },
  parameters: { hostTheme: "dark" },
};

/** The final card with its tokens by role and the criteria's evidence unfolded. */
export const ReadyUnfolded: Story = {
  args: { data: readyFixture },
  play: async ({ canvasElement }) => {
    for (const id of ["autopilot-tokens-toggle", "autopilot-proof-toggle"]) {
      const toggle = canvasElement.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
      if (!toggle) throw new Error(`ReadyUnfolded: no ${id}`);
      toggle.click();
    }
    await waitForCondition(
      () =>
        canvasElement.querySelector('[data-testid="autopilot-tokens-roles"]') !== null &&
        canvasElement.querySelector('[data-testid="autopilot-proof"]') !== null,
      "the token table and the evidence to unfold",
    );
  },
};

/** The final card in English, without tokens, CI figures or a retro record. */
export const ReadyEnglish: Story = { args: { data: readyEnglishFixture } };

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
