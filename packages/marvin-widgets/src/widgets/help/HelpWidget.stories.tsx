import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { HelpView, HelpWidget, groupTitle, type HelpSeam } from "./HelpWidget";
import {
  helpFixture,
  noServersHelpFixture,
  noStatusesHelpFixture,
  noGitHelpFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";
import { waitForCondition } from "../../lib/story-helpers";

/**
 * Stories for the help widget (ADR-0024): static visual states over the pure
 * `HelpView` (both host themes, the empty-data branches, the connection trio),
 * a play-driven drill-down per command group whose post-play DOM is that group's
 * detail screenshot, and a mock-host story whose `play` drives the real ext-apps
 * handshake over an in-memory transport — the `@storybook/test-runner`
 * (test-storybook) oracle.
 */
const meta: Meta<typeof HelpView> = {
  title: "Widgets/Help",
  component: HelpView,
};
export default meta;

/** Static story — the pure view rendering the full fixture directly. */
export const Fixture: StoryObj<typeof HelpView> = {
  args: { data: helpFixture },
};

/** The same full fixture under the dark host palette (pinned via parameters). */
export const FixtureDark: StoryObj<typeof HelpView> = {
  args: { data: helpFixture },
  parameters: { hostTheme: "dark" },
};

/** No MCP servers configured — the italic "none configured" note. */
export const NoServers: StoryObj<typeof HelpView> = {
  args: { data: noServersHelpFixture },
};

/** Empty status vocabulary — the board row shows "no statuses configured". */
export const NoStatuses: StoryObj<typeof HelpView> = {
  args: { data: noStatusesHelpFixture },
};

/** Null git branch — the git summary row shows "not in a git repo". */
export const NotGitRepo: StoryObj<typeof HelpView> = {
  args: { data: noGitHelpFixture },
};

/**
 * One "Read more" detail story per command group — every group's group-detail
 * view is rendered (and snapshotted), and the play oracle asserts the layout is
 * *consistent across groups*: each command in the opened group shows both a Direct
 * call chip and at least three prose phrases. `GroupDetailOpen` keeps its stable
 * story id (and committed baseline); the six siblings cover the rest.
 */
function groupDetailStory(group: string): StoryObj<typeof HelpView> {
  return {
    name: groupTitle(group),
    args: { data: helpFixture },
    play: async ({ canvasElement }) => {
      const more = canvasElement.querySelector<HTMLElement>(
        `[data-testid="help-more"][data-group="${group}"]`,
      );
      if (!more) throw new Error(`detail story: no Read more link for group "${group}"`);
      more.click();
      await waitForCondition(
        () =>
          canvasElement.querySelector('[data-testid="help-detail-title"]')?.textContent ===
          groupTitle(group),
        `the ${group} group detail view`,
      );
      // Consistency oracle: every command in the group renders the two-way layout.
      const rows = canvasElement.querySelectorAll('[data-testid="help-detail-command"]');
      if (rows.length === 0) throw new Error(`detail story: group "${group}" rendered no commands`);
      rows.forEach((row) => {
        const cmd = row.getAttribute("data-command");
        if (!row.querySelector('[data-testid="help-detail-direct"]')) {
          throw new Error(`detail story: ${group}/${cmd} is missing its Direct call`);
        }
        if (row.querySelectorAll('[data-testid="help-detail-phrase"]').length < 3) {
          throw new Error(`detail story: ${group}/${cmd} has fewer than 3 prose phrases`);
        }
      });
    },
  };
}

export const GroupDetailOpen = groupDetailStory("core");
export const AdrDetail = groupDetailStory("adr");
export const PrDetail = groupDetailStory("pr");
export const TaskDetail = groupDetailStory("task");
export const SecDetail = groupDetailStory("sec");
export const RefactorDetail = groupDetailStory("refactor");
export const TrackDetail = groupDetailStory("track");

/** Handshake in flight, no data yet — the "Connecting…" placeholder. */
export const Connecting: StoryObj<typeof HelpView> = {
  args: { data: null, connecting: true },
};

/** Connected but no tool-result arrived — the "No help data." copy. */
export const NoData: StoryObj<typeof HelpView> = {
  args: { data: null, connecting: false },
};

/** Transport error fallback (named ErrorState — "Error" shadows the global). */
export const ErrorState: StoryObj<typeof HelpView> = {
  args: { data: null, error: "kaboom: transport dropped" },
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

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  parameters: { visual: false },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="help-wordmark"]') !== null,
      "the help panel to render from the mock-host handshake",
    );
    if (!canvasElement.querySelector('[data-testid="help-servers"]')) {
      throw new Error("mock-host story: expected the MCP servers section to render");
    }
  },
};
