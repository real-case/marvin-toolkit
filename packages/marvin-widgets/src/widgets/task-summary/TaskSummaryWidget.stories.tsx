import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TaskSummaryView, TaskSummaryWidget, type TaskSummarySeam } from "./TaskSummaryWidget";
import {
  taskSummaryFixture,
  allPassingSummaryFixture,
  failingSummaryFixture,
  emptySummaryFixture,
  longSummaryFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";
import { waitForCondition } from "../../lib/story-helpers";

/**
 * Stories for the task-summary widget (ADR-0024 #3). The visual states are plain
 * args over the pure `TaskSummaryView` — the mixed fixture (light + dark host),
 * the all-green digest, the failure shot, every-section-empty, and a long-content
 * stress render — plus the connecting / no-data / error trio. The mock-host story
 * drives the real ext-apps handshake over an in-memory transport and asserts the
 * panel renders; it opts out of visual capture (`visual: false`) because its
 * settled DOM duplicates `Fixture`.
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

/** The same mixed fixture under the dark host theme (decorator applies host vars). */
export const FixtureDark: StoryObj<typeof TaskSummaryView> = {
  args: { data: taskSummaryFixture },
  parameters: { hostTheme: "dark" },
};

/** The green digest — every AC and every gate passed; the roll-up carries no failure clause. */
export const AllPassing: StoryObj<typeof TaskSummaryView> = {
  args: { data: allPassingSummaryFixture },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () =>
        canvasElement.querySelectorAll('[data-testid="ac-row"]').length ===
        allPassingSummaryFixture.acceptance.length,
      "every acceptance row to render",
    );
    if (canvasElement.querySelector('[data-testid="ac-row"]:not([data-outcome="pass"])')) {
      throw new Error("AllPassing: expected every AC row to carry data-outcome=pass");
    }
    if (canvasElement.querySelector('[data-testid="gate-row"]:not([data-status="pass"])')) {
      throw new Error("AllPassing: expected every gate row to carry data-status=pass");
    }
    const rollup = canvasElement.querySelector('[data-testid="summary-rollup"]')?.textContent ?? "";
    if (!rollup.includes("3/3 acceptance passed") || !rollup.includes("4 gates passed")) {
      throw new Error(`AllPassing: unexpected roll-up: ${rollup}`);
    }
    if (rollup.includes("failed")) {
      throw new Error("AllPassing: the roll-up must not mention failures");
    }
  },
};

/** The mixed shot — a fail AC, a fail gate with detail, and an unknown AC; the roll-up shows the failure. */
export const WithFailures: StoryObj<typeof TaskSummaryView> = {
  args: { data: failingSummaryFixture },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="summary-header"]') !== null,
      "the task summary panel to render",
    );
    if (!canvasElement.querySelector('[data-testid="ac-row"][data-outcome="fail"]')) {
      throw new Error("WithFailures: expected a failed AC row");
    }
    if (!canvasElement.querySelector('[data-testid="ac-row"][data-outcome="unknown"]')) {
      throw new Error("WithFailures: expected an unknown AC row");
    }
    const failGate = canvasElement.querySelector('[data-testid="gate-row"][data-status="fail"]');
    if (!failGate || !(failGate.textContent ?? "").includes("2 failed, 138 passed")) {
      throw new Error("WithFailures: expected the failed gate row with its detail");
    }
    const rollup = canvasElement.querySelector('[data-testid="summary-rollup"]')?.textContent ?? "";
    if (!rollup.includes("1 failed")) {
      throw new Error(`WithFailures: the roll-up must carry the failure clause: ${rollup}`);
    }
  },
};

/** All five collections empty — every empty note visible, the Lessons section absent. */
export const AllEmpty: StoryObj<typeof TaskSummaryView> = {
  args: { data: emptySummaryFixture },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="summary-header"]') !== null,
      "the task summary panel to render",
    );
    for (const testid of ["acceptance-empty", "gates-empty", "commits-empty", "links-empty"]) {
      if (!canvasElement.querySelector(`[data-testid="${testid}"]`)) {
        throw new Error(`AllEmpty: expected the ${testid} note to render`);
      }
    }
    if (canvasElement.querySelector('[data-testid="summary-lessons"]')) {
      throw new Error("AllEmpty: the Lessons section must be omitted when there are no lessons");
    }
  },
};

/** Long AC statements with inline markdown, long commit subjects, a dozen commits — the wrap/overflow stress render. */
export const LongContent: StoryObj<typeof TaskSummaryView> = {
  args: { data: longSummaryFixture },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () =>
        canvasElement.querySelectorAll('[data-testid="commit-row"]').length ===
        longSummaryFixture.commits.length,
      "every commit row to render",
    );
    // the long statements still render through <Markdown> — inline code + bold survive
    if (
      !canvasElement.querySelector('[data-testid="ac-statement"] [data-testid="markdown"] code')
    ) {
      throw new Error("LongContent: expected inline code in an AC statement");
    }
    if (
      !canvasElement.querySelector('[data-testid="ac-statement"] [data-testid="markdown"] strong')
    ) {
      throw new Error("LongContent: expected bold text in an AC statement");
    }
  },
};

/** Pre-handshake state — null data while connecting shows "Connecting…". */
export const Connecting: StoryObj<typeof TaskSummaryView> = {
  args: { data: null, connecting: true },
};

/** Settled without a payload — null data, not connecting, shows the no-data copy. */
export const NoData: StoryObj<typeof TaskSummaryView> = {
  args: { data: null, connecting: false },
};

/** A transport/handshake error replaces the panel with the error surface. */
export const ErrorState: StoryObj<typeof TaskSummaryView> = {
  args: { data: null, error: "kaboom: transport dropped" },
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

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  parameters: { visual: false },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="summary-header"]') !== null,
      "the task summary panel to render after the handshake",
    );
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
