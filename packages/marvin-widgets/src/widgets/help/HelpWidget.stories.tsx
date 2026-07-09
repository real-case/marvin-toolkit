import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { HelpView, HelpWidget, type HelpSeam } from "./HelpWidget";
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
 * a play-driven drill-down whose post-play DOM is the group-detail screenshot,
 * and a mock-host story whose `play` drives the real ext-apps handshake over an
 * in-memory transport — the `@storybook/test-runner` (test-storybook) oracle.
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

/** Empty status vocabulary — the kanban row shows "no statuses configured". */
export const NoStatuses: StoryObj<typeof HelpView> = {
  args: { data: noStatusesHelpFixture },
};

/** Null git branch — the git summary row shows "not in a git repo". */
export const NotGitRepo: StoryObj<typeof HelpView> = {
  args: { data: noGitHelpFixture },
};

/** Play-driven drill-down — Read more opens a group's detail; the post-play DOM is the screenshot. */
export const GroupDetailOpen: StoryObj<typeof HelpView> = {
  args: { data: helpFixture },
  play: async ({ canvasElement }) => {
    const more = canvasElement.querySelector<HTMLElement>('[data-testid="help-more"]');
    if (!more) throw new Error("group-detail story: expected a Read more link");
    const group = more.getAttribute("data-group");
    more.click();
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="help-detail"]') !== null,
      "the group detail view after Read more",
    );
    const title = canvasElement.querySelector('[data-testid="help-detail-title"]');
    if (!title || title.textContent !== group) {
      throw new Error(
        `group-detail story: expected the detail title "${group}", got "${title?.textContent}"`,
      );
    }
    if (!canvasElement.querySelector('[data-testid="help-detail-example"]')) {
      throw new Error("group-detail story: expected an example line in the detail view");
    }
  },
};

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
