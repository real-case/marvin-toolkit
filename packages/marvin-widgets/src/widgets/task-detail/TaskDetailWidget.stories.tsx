import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TaskDetailView, TaskDetailWidget, type TaskDetailSeam } from "./TaskDetailWidget";
import { taskDetailFixture } from "./fixture";
import { createMockHost } from "../../lib/mock-host";

/**
 * Stories for the task-detail widget (ADR-0024 #2): a static component story over
 * the fixture (visual/dev), and a mock-host story whose `play` drives the real
 * ext-apps handshake over an in-memory transport and asserts the detail (and its
 * markdown body) render — the `@storybook/test-runner` (test-storybook) oracle.
 */
const meta: Meta<typeof TaskDetailView> = {
  title: "Widgets/TaskDetail",
  component: TaskDetailView,
};
export default meta;

/** Static story — the pure view rendering the fixture directly. */
export const Fixture: StoryObj<typeof TaskDetailView> = {
  args: { data: taskDetailFixture },
};

/** Wire the widget to a fresh mock-host and connect once the host is armed. */
function MockHostHarness() {
  const [seam, setSeam] = useState<TaskDetailSeam | null>(null);
  useEffect(() => {
    const host = createMockHost(taskDetailFixture);
    let live = true;
    host.start().then(() => {
      if (live) setSeam(host.seam);
    });
    return () => {
      live = false;
      host.close();
    };
  }, []);
  return seam ? <TaskDetailWidget seam={seam} /> : <div>Starting mock host…</div>;
}

async function waitForDetail(root: HTMLElement) {
  for (let i = 0; i < 50; i += 1) {
    if (root.querySelector('[data-testid="detail-title"]')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("mock-host story: expected the task detail to render");
}

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  play: async ({ canvasElement }) => {
    await waitForDetail(canvasElement);
    if (!canvasElement.querySelector('[data-testid="markdown"] pre code')) {
      throw new Error("mock-host story: expected the markdown body to render as elements");
    }
  },
};
