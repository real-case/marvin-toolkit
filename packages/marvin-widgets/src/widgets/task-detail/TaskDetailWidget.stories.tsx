import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TaskDetailView, TaskDetailWidget, type TaskDetailSeam } from "./TaskDetailWidget";
import {
  taskDetailFixture,
  minimalTaskDetailFixture,
  richBodyTaskDetailFixture,
  longTitleTaskDetailFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";
import { waitForCondition } from "../../lib/story-helpers";

/**
 * Stories for the task-detail widget (ADR-0024 #2): static component stories over
 * the fixtures (the visual-regression surface — fully-populated, dark, minimal,
 * markdown-heavy, overflow, and the connecting/no-data/error states), and a
 * mock-host story whose `play` drives the real ext-apps handshake over an
 * in-memory transport and asserts the detail (and its markdown body) render —
 * the `@storybook/test-runner` (test-storybook) oracle.
 *
 * The view wraps itself in `<MvRoot>` (the family theme scope), so stories need
 * no decorator; the pinned dark variant forces the scope via the view's
 * stories-only `theme` prop AND pins `parameters.hostTheme` so the page canvas
 * behind the widget matches in the visual baseline.
 */
const meta: Meta<typeof TaskDetailView> = {
  title: "Widgets/TaskDetail",
  component: TaskDetailView,
};
export default meta;

/** Static story — the pure view rendering the fixture directly (light theme). */
export const Fixture: StoryObj<typeof TaskDetailView> = {
  args: { data: taskDetailFixture },
};

/** The same fixture with the mvroot theme pinned dark (plus the dark page canvas). */
export const FixtureDark: StoryObj<typeof TaskDetailView> = {
  args: { data: taskDetailFixture, theme: "dark" },
  parameters: { hostTheme: "dark" },
};

/** Sparse task — no tracker, no PR, no spec: the link row and Spec row must vanish. */
export const MinimalTask: StoryObj<typeof TaskDetailView> = {
  args: { data: minimalTaskDetailFixture },
};

/** Markdown-in-context — headings, lists, checkboxes, table, code, quote, strikethrough. */
export const RichMarkdownBody: StoryObj<typeof TaskDetailView> = {
  args: { data: richBodyTaskDetailFixture },
};

/** Overflow probe — a ~140-char title and a long branch stressing row and code cell. */
export const LongTitle: StoryObj<typeof TaskDetailView> = {
  args: { data: longTitleTaskDetailFixture },
};

/** Handshake in flight — no data yet, so the view shows "Connecting…". */
export const Connecting: StoryObj<typeof TaskDetailView> = {
  args: { data: null, connecting: true },
};

/** Connected but empty — the handshake settled without a task, so "No task." shows. */
export const NoData: StoryObj<typeof TaskDetailView> = {
  args: { data: null, connecting: false },
};

/** Transport failure — the error fallback ("ErrorState": `Error` shadows the global). */
export const ErrorState: StoryObj<typeof TaskDetailView> = {
  args: { data: null, error: "kaboom: transport dropped" },
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

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  parameters: { visual: false },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="detail-title"]') !== null,
      "the mock-host task detail to render",
    );
    if (!canvasElement.querySelector('[data-testid="markdown"] pre code')) {
      throw new Error("mock-host story: expected the markdown body to render as elements");
    }
  },
};
