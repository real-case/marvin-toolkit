import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { HelpView, HelpWidget, type HelpSeam } from "./HelpWidget";
import { helpFixture } from "./fixture";
import { createMockHost } from "../../lib/mock-host";

/**
 * Stories for the help widget (ADR-0024): a static component story over the
 * fixture (visual/dev), and a mock-host story whose `play` drives the real
 * ext-apps handshake over an in-memory transport and asserts the panel renders —
 * the `@storybook/test-runner` (test-storybook) oracle.
 */
const meta: Meta<typeof HelpView> = {
  title: "Widgets/Help",
  component: HelpView,
};
export default meta;

/** Static story — the pure view rendering the fixture directly. */
export const Fixture: StoryObj<typeof HelpView> = {
  args: { data: helpFixture },
};

/** Wire the widget to a fresh mock-host and connect once the host is armed. */
function MockHostHarness() {
  const [seam, setSeam] = useState<HelpSeam | null>(null);
  useEffect(() => {
    const host = createMockHost(helpFixture);
    let live = true;
    host.start().then(() => {
      if (live) setSeam(host.seam);
    });
    return () => {
      live = false;
      host.close();
    };
  }, []);
  return seam ? <HelpWidget seam={seam} /> : <div>Starting mock host…</div>;
}

async function waitForPanel(root: HTMLElement) {
  for (let i = 0; i < 50; i += 1) {
    if (root.querySelector('[data-testid="help-wordmark"]')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("mock-host story: expected the help panel to render");
}

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  play: async ({ canvasElement }) => {
    await waitForPanel(canvasElement);
    if (!canvasElement.querySelector('[data-testid="help-servers"]')) {
      throw new Error("mock-host story: expected the MCP servers section to render");
    }
  },
};
