import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { HandoffsView, HandoffsWidget, type HandoffsSeam } from "./HandoffsWidget";
import {
  handoffsFixture,
  emptyHandoffsFixture,
  minimalHandoffFixture,
  longPromptHandoffFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";
import { waitForCondition } from "../../lib/story-helpers";

/**
 * Stories for the handoffs widget (ADR-0024 #5): static component stories over the
 * fixtures (every data shape plus the connecting/no-data/error trio, each a pure
 * `HandoffsView` render for screenshots), and a mock-host story whose `play` drives
 * the real ext-apps handshake over an in-memory transport and asserts the browser
 * (and the selected handoff's markdown body) render — the `@storybook/test-runner`
 * (test-storybook) oracle.
 */
const meta: Meta<typeof HandoffsView> = {
  title: "Widgets/Handoffs",
  component: HandoffsView,
};
export default meta;

/** Static story — the pure view rendering the fixture directly. */
export const Fixture: StoryObj<typeof HandoffsView> = {
  args: { data: handoffsFixture },
};

/** The fixture under the dark host theme (the preview decorator applies the host vars). */
export const FixtureDark: StoryObj<typeof HandoffsView> = {
  args: { data: handoffsFixture },
  parameters: { hostTheme: "dark" },
};

/** Zero handoffs — the "No handoffs yet — run /marvin:handoff…" empty label. */
export const Empty: StoryObj<typeof HandoffsView> = {
  args: { data: emptyHandoffsFixture },
};

/** The minimal card: no base, no spec_slug, pr_url null — Base/Spec rows and PR button absent. */
export const MinimalHandoff: StoryObj<typeof HandoffsView> = {
  args: { data: minimalHandoffFixture },
};

/** A 30-line continue_prompt plus a long body — the prompt `<pre>`'s pre-wrap stress shot. */
export const LongPrompt: StoryObj<typeof HandoffsView> = {
  args: { data: longPromptHandoffFixture },
};

/** No data yet, handshake in flight — the "Connecting…" placeholder. */
export const Connecting: StoryObj<typeof HandoffsView> = {
  args: { data: null, connecting: true },
};

/** No data and the handshake is over — the "No data." copy. */
export const NoData: StoryObj<typeof HandoffsView> = {
  args: { data: null, connecting: false },
};

/** A transport error — the danger-coloured fallback. Named ErrorState: `Error` shadows the global. */
export const ErrorState: StoryObj<typeof HandoffsView> = {
  args: { data: null, error: "kaboom: transport dropped" },
};

/** Wire the widget to a fresh mock-host and connect once the host is armed. */
function MockHostHarness() {
  const [seam, setSeam] = useState<HandoffsSeam | null>(null);
  useEffect(() => {
    const host = createMockHost(handoffsFixture);
    let live = true;
    host.start().then(() => {
      if (live) setSeam(host.seam);
    });
    return () => {
      live = false;
      host.close();
    };
  }, []);
  return seam ? <HandoffsWidget seam={seam} /> : <div>Starting mock host…</div>;
}

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  parameters: { visual: false },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => Boolean(canvasElement.querySelector('[data-testid="detail-title"]')),
      "the handoff detail to render after the mock-host handshake",
    );
    if (!canvasElement.querySelector('[data-testid="markdown"] pre code')) {
      throw new Error("mock-host story: expected the markdown body to render as elements");
    }
  },
};
