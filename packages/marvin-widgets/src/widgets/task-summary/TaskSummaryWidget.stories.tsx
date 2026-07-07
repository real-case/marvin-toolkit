import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TaskSummaryView, TaskSummaryWidget, type TaskSummarySeam } from "./TaskSummaryWidget";
import { taskSummaryFixture } from "./fixture";
import { createMockHost } from "../../lib/mock-host";

/**
 * Stories for the task-summary widget (ADR-0024 #3): a static component story over the
 * fixture (visual/dev), and a mock-host story whose `play` drives the real ext-apps
 * handshake over an in-memory transport and asserts the panel (and an AC statement's
 * inline markdown) render — the `@storybook/test-runner` (test-storybook) oracle.
 */
const meta: Meta<typeof TaskSummaryView> = {
  title: "Widgets/TaskSummary",
  component: TaskSummaryView,
};
export default meta;

/** Static story — the pure view rendering the fixture directly. */
export const Fixture: StoryObj<typeof TaskSummaryView> = {
  args: { data: taskSummaryFixture },
};

/** Wire the widget to a fresh mock-host and connect once the host is armed. */
function MockHostHarness() {
  const [seam, setSeam] = useState<TaskSummarySeam | null>(null);
  useEffect(() => {
    const host = createMockHost(taskSummaryFixture);
    let live = true;
    host.start().then(() => {
      if (live) setSeam(host.seam);
    });
    return () => {
      live = false;
      host.close();
    };
  }, []);
  return seam ? <TaskSummaryWidget seam={seam} /> : <div>Starting mock host…</div>;
}

async function waitForPanel(root: HTMLElement) {
  for (let i = 0; i < 50; i += 1) {
    if (root.querySelector('[data-testid="summary-header"]')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("mock-host story: expected the task summary panel to render");
}

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  play: async ({ canvasElement }) => {
    await waitForPanel(canvasElement);
    if (!canvasElement.querySelector('[data-testid="summary-acceptance"] [data-testid="ac-row"]')) {
      throw new Error("mock-host story: expected the acceptance rows to render");
    }
    if (
      !canvasElement.querySelector('[data-testid="ac-statement"] [data-testid="markdown"] code')
    ) {
      throw new Error("mock-host story: expected the AC statement to render as inline markdown");
    }
  },
};
