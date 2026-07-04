import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TaskListView, TaskListWidget, type TaskListSeam } from "./TaskListWidget";
import { taskListFixture } from "./fixture";
import { createMockHost } from "../../lib/mock-host";

/**
 * Stories for the task-list widget (ADR-0024): a static component story over the
 * fixture (visual/dev), and a mock-host story whose `play` drives the real
 * ext-apps handshake over an in-memory transport and asserts the cards render —
 * the `@storybook/test-runner` (test-storybook) oracle.
 */
const meta: Meta<typeof TaskListView> = {
  title: "Widgets/TaskList",
  component: TaskListView,
};
export default meta;

/** Static story — the pure view rendering the fixture directly. */
export const Fixture: StoryObj<typeof TaskListView> = {
  args: { data: taskListFixture },
};

/** Wire the widget to a fresh mock-host and connect once the host is armed. */
function MockHostHarness() {
  const [seam, setSeam] = useState<TaskListSeam | null>(null);
  useEffect(() => {
    const host = createMockHost(taskListFixture);
    let live = true;
    host.start().then(() => {
      if (live) setSeam(host.seam);
    });
    return () => {
      live = false;
      host.close();
    };
  }, []);
  return seam ? <TaskListWidget seam={seam} /> : <div>Starting mock host…</div>;
}

async function waitForCards(root: HTMLElement, count: number) {
  for (let i = 0; i < 50; i += 1) {
    if (root.querySelectorAll('[role="option"]').length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`mock-host story: expected ${count} cards to render`);
}

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  play: async ({ canvasElement }) => {
    await waitForCards(canvasElement, taskListFixture.tasks.length);
  },
};
