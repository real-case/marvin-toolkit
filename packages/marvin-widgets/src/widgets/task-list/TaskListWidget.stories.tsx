import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TaskListView, TaskListWidget, type TaskListSeam } from "./TaskListWidget";
import {
  emptyTaskListFixture,
  minimalCardFixture,
  singleTaskFixture,
  stressTaskListFixture,
  taskListFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";
import { waitForCondition } from "../../lib/story-helpers";

/**
 * Stories for the task-list widget (ADR-0024): static stories over the fixtures
 * cover every render shape the pure view has (board, dark host, empty, single,
 * minimal card, stress content, connecting/no-data/error), a `play` story drives
 * row selection, and the mock-host story runs the real ext-apps handshake over an
 * in-memory transport — the `@storybook/test-runner` (test-storybook) oracle.
 */
const meta: Meta<typeof TaskListView> = {
  title: "Widgets/TaskList",
  component: TaskListView,
};
export default meta;

type Story = StoryObj<typeof TaskListView>;

/** Static story — the pure view rendering the fixture directly. */
export const Fixture: Story = {
  args: { data: taskListFixture },
};

/** The fixture under the dark host theme (the preview decorator applies the vars). */
export const FixtureDark: Story = {
  args: { data: taskListFixture },
  parameters: { hostTheme: "dark" },
};

/** A freshly initialised board — "0 tasks" header over the ListDetail empty label. */
export const EmptyBoard: Story = {
  args: { data: emptyTaskListFixture },
};

/** Exactly one card — the singular "1 task" header and a fully-featured detail pane. */
export const SingleTask: Story = {
  args: { data: singleTaskFixture },
};

/** The minimal legal card — the detail renders no link buttons and no Spec row. */
export const MinimalCard: Story = {
  args: { data: minimalCardFixture },
};

/** 25 cards with ~140-char titles, a many-segment branch, and unicode/emoji — the truncation/wrap stress shot. */
export const LongContent: Story = {
  args: { data: stressTaskListFixture },
};

/** Clicking the second row swaps the detail pane to the second card. */
export const SecondTaskSelected: Story = {
  args: { data: taskListFixture },
  play: async ({ canvasElement }) => {
    const options = canvasElement.querySelectorAll<HTMLElement>('[role="option"]');
    if (options.length < 2) {
      throw new Error("SecondTaskSelected: expected at least two rows to render");
    }
    options[1].click();
    await waitForCondition(
      () =>
        canvasElement.querySelector('[data-testid="detail-title"]')?.textContent ===
        taskListFixture.tasks[1].title,
      "the detail pane to show the second card's title",
    );
  },
};

/** Two statuses picked — the multi-select filter narrows the board to wip + blocked. */
export const FilteredByStatus: Story = {
  args: { data: taskListFixture },
  play: async ({ canvasElement }) => {
    const chip = (role: string) =>
      canvasElement.querySelector<HTMLElement>(`[data-testid="role-filter"][data-role="${role}"]`);
    for (const role of ["wip", "blocked"]) {
      const target = chip(role);
      if (!target) throw new Error(`FilteredByStatus: no "${role}" filter chip rendered`);
      target.click();
    }
    await waitForCondition(
      () => canvasElement.querySelectorAll('[role="option"]').length === 2,
      "the list to narrow to the two selected statuses",
    );
  },
};

/** The handshake-in-flight state — no data yet, "Connecting…" placeholder. */
export const Connecting: Story = {
  args: { data: null, connecting: true },
};

/** Connected but the host never delivered a payload — the "No data." copy. */
export const NoData: Story = {
  args: { data: null, connecting: false },
};

/** A transport error — the danger-coloured failure banner. (Named ErrorState — `Error` shadows the global.) */
export const ErrorState: Story = {
  args: { data: null, error: "kaboom: transport dropped" },
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

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. Excluded from screenshots (`visual: false`): its settled DOM duplicates Fixture. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  parameters: { visual: false },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () =>
        canvasElement.querySelectorAll('[role="option"]').length === taskListFixture.tasks.length,
      "the mock-host handshake to deliver the fixture's cards",
    );
  },
};
