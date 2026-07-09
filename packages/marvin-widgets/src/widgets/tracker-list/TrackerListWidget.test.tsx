import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/preact";
// Runtime zod import — allowed in tests only (stories/fixtures stay type-only).
import { TrackerListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { TrackerListView, TrackerListWidget } from "./TrackerListWidget";
import { trackerListFixture, noUrlTrackerFixture, emptyTrackerFixture } from "./fixture";
import { createMockHost } from "../../lib/mock-host";

describe("TrackerListWidget — fixtures satisfy the data contract", () => {
  it("every fixture parses as a TrackerListPayload", () => {
    // The fixtures feed the stories and the mock-host handshake; parsing them
    // here pins them to the real zod contract the `tracker` tool emits.
    expect(() => TrackerListPayload.parse(trackerListFixture)).not.toThrow();
    expect(() => TrackerListPayload.parse(noUrlTrackerFixture)).not.toThrow();
    expect(() => TrackerListPayload.parse(emptyTrackerFixture)).not.toThrow();
  });
});

describe("TrackerListWidget — pure view over the fixture", () => {
  it("lists tracked tasks and renders the tracker link-out button", () => {
    render(<TrackerListView data={trackerListFixture} />);

    // thin payload: a count header, no board-role roll-up
    expect(screen.getByTestId("tracker-counts").textContent).toContain("2 tracked tasks");

    // one row per tracked task, in payload order
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Fix login timeout on slow networks");

    // the first (selected) card has a tracker_url → an external link-out button
    const pane = screen.getByTestId("list-detail-pane");
    const link = within(pane).getByTestId("tracker-link");
    expect(link.textContent).toContain("OSI-101");
    expect(link.textContent).toContain("↗"); // external marker
    // and the PR link renders alongside it
    expect(within(pane).getByRole("button", { name: /PR #12/ })).toBeTruthy();

    // Updated renders as the deterministic YYYY-MM-DD date, not the raw ISO string
    expect(pane.textContent).toContain("2026-07-03");
    expect(pane.textContent).not.toContain("2026-07-03T14:15:00.000Z");
  });

  it("a tracker task with no tracker_url renders the id and a configure hint, not a link", () => {
    render(<TrackerListView data={trackerListFixture} />);

    // select the second row (OSI-140, tracker_url === null)
    fireEvent.click(screen.getAllByRole("option")[1]);

    const pane = screen.getByTestId("list-detail-pane");
    expect(within(pane).getByTestId("tracker-id").textContent).toContain("OSI-140");
    expect(within(pane).getByTestId("tracker-hint").textContent).toMatch(/tracker_url_template/);
    // crucially: NO dead/empty link button for a task with no url
    expect(within(pane).queryByTestId("tracker-link")).toBeNull();
  });

  it("empty state renders when no task carries a tracker id", () => {
    render(<TrackerListView data={emptyTrackerFixture} />);
    expect(screen.getByTestId("tracker-empty").textContent).toMatch(/No tasks carry a tracker id/);
    // no master-detail list at all
    expect(screen.queryByRole("option")).toBeNull();
  });
});

describe("TrackerListWidget — mock-host handshake", () => {
  it("mock-host handshake delivers a TrackerListPayload the widget renders", async () => {
    const host = createMockHost(trackerListFixture);
    await host.start();
    try {
      render(<TrackerListWidget seam={host.seam} />);

      // starts connecting, then the pushed tool-result's tasks appear once the
      // handshake completes (findByTestId waits for it)
      const counts = await screen.findByTestId("tracker-counts", {}, { timeout: 5000 });
      expect(counts.textContent).toContain("2 tracked tasks");
      expect(screen.queryByTestId("tracker-list-connecting")).toBeNull();
    } finally {
      host.close();
    }
  });

  it("mock-host activating a tracker link opens it via app.openLink", async () => {
    const host = createMockHost(trackerListFixture);
    await host.start();
    try {
      render(<TrackerListWidget seam={host.seam} />);

      // wait for the handshake, then activate the (selected first card's) link-out
      const link = await screen.findByTestId("tracker-link", {}, { timeout: 5000 });
      fireEvent.click(link);

      // the external-link path round-trips through the real SDK to the host bridge's
      // onopenlink, which the mock host records — proving app.openLink was invoked
      await waitFor(() =>
        expect(host.openedLinks).toContain("https://tracker.example/browse/OSI-101"),
      );
    } finally {
      host.close();
    }
  });
});
