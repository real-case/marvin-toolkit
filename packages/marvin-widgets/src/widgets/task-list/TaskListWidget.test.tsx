import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/preact";
// Runtime zod import — allowed in tests only (the shared package dist is built);
// fixtures/stories stay type-only so no zod ever reaches the widget bundle.
import { TaskListPayload, type LinkRef } from "@marvin-toolkit/mcp-shared/contracts";
import { TaskListView, TaskListWidget } from "./TaskListWidget";
import { taskListFixture, minimalCardFixture, singleTaskFixture } from "./fixture";
import * as fixtures from "./fixture";
import { createMockHost } from "../../lib/mock-host";

describe("task-list fixtures — contract conformance", () => {
  it("every exported fixture parses as a TaskListPayload", () => {
    const entries = Object.entries(fixtures);
    // Guard the guard: an accidental rename to non-exported must not
    // silently turn this into a zero-assertion pass.
    expect(entries.length).toBeGreaterThanOrEqual(5);
    for (const [name, fixture] of entries) {
      const result = TaskListPayload.safeParse(fixture);
      expect(
        result.success,
        `${name} violates the contract: ${result.success ? "" : result.error.message}`,
      ).toBe(true);
    }
  });
});

describe("TaskListWidget — AC2 (pure view over the fixture)", () => {
  it("renders one card per task with counts from the fixture", () => {
    render(<TaskListView data={taskListFixture} />);

    // one card per TaskCard
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(taskListFixture.tasks.length);

    // each row shows its status key + title
    expect(options[0].textContent).toContain("todo");
    expect(options[0].textContent).toContain("Fix login timeout on slow networks");

    // the board counts header
    const header = screen.getByTestId("board-counts");
    expect(header.textContent).toContain("5 tasks");
    expect(header.textContent).toContain("todo 1");
    expect(header.textContent).toContain("wip 1");
    expect(header.textContent).toContain("done 1");

    // selecting a card shows that card's detail
    fireEvent.click(options[1]);
    const pane = screen.getByTestId("list-detail-pane");
    expect(within(pane).getByTestId("detail-title").textContent).toContain(
      "Add dark-mode toggle to settings",
    );
  });

  it("renders Updated as the YYYY-MM-DD date, not the raw ISO datetime", () => {
    render(<TaskListView data={taskListFixture} />);

    // first card starts selected; its updated is 2026-07-01T10:00:00.000Z
    const updated = screen.getByTestId("detail-updated");
    expect(updated.textContent?.trim()).toBe("2026-07-01");
    expect(updated.textContent).not.toContain("T");
  });
});

describe("TaskListWidget — the status filter", () => {
  /** The role toggle in the header for one role, or null when the board has none. */
  const chipOrNull = (role: string) =>
    screen.queryAllByTestId("role-filter").find((button) => button.dataset.role === role) ?? null;
  /** As above, failing loudly rather than silently acting on the wrong chip. */
  const chip = (role: string) => {
    const found = chipOrNull(role);
    if (!found) throw new Error(`no role-filter chip rendered for "${role}"`);
    return found;
  };
  /** The titles currently listed, in order. */
  const listedTitles = () =>
    screen.getAllByRole("option").map((option) => {
      const title = taskListFixture.tasks.find((t) => option.textContent?.includes(t.title));
      return title?.title;
    });

  it("shows every task until a status is picked", () => {
    render(<TaskListView data={taskListFixture} />);

    expect(screen.getAllByRole("option")).toHaveLength(5);
    expect(screen.getByTestId("board-counts").textContent).toContain("5 tasks");
    // No chip is pressed: an empty filter means "all", not "none".
    for (const role of ["todo", "wip", "review", "done", "blocked"]) {
      expect(chip(role).getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("narrows the list to the picked status", () => {
    render(<TaskListView data={taskListFixture} />);
    fireEvent.click(chip("wip"));

    expect(listedTitles()).toEqual(["Add dark-mode toggle to settings"]);
    expect(chip("wip").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("board-counts").textContent).toContain("1 of 5 tasks");
  });

  it("keeps both statuses when a second is picked (multi-select)", () => {
    render(<TaskListView data={taskListFixture} />);
    fireEvent.click(chip("wip"));
    fireEvent.click(chip("blocked"));

    expect(listedTitles()).toEqual([
      "Add dark-mode toggle to settings",
      "Flaky end-to-end suite under load",
    ]);
    expect(chip("wip").getAttribute("aria-pressed")).toBe("true");
    expect(chip("blocked").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("board-counts").textContent).toContain("2 of 5 tasks");
  });

  it("drops one status without dropping the rest", () => {
    render(<TaskListView data={taskListFixture} />);
    fireEvent.click(chip("wip"));
    fireEvent.click(chip("blocked"));
    fireEvent.click(chip("wip"));

    expect(listedTitles()).toEqual(["Flaky end-to-end suite under load"]);
    expect(chip("wip").getAttribute("aria-pressed")).toBe("false");
    expect(chip("blocked").getAttribute("aria-pressed")).toBe("true");
  });

  it("returns to the whole board once the last status is dropped", () => {
    render(<TaskListView data={taskListFixture} />);
    fireEvent.click(chip("done"));
    fireEvent.click(chip("done"));

    expect(screen.getAllByRole("option")).toHaveLength(5);
    expect(screen.getByTestId("board-counts").textContent).toContain("5 tasks");
  });

  it("moves the detail pane onto the filtered list, never a stale task", () => {
    render(<TaskListView data={taskListFixture} />);
    // Select the 4th task, then filter it out: the pane must not keep showing it.
    fireEvent.click(screen.getAllByRole("option")[3]);
    expect(screen.getByTestId("detail-title").textContent).toContain(
      "Evaluate Preact for inline widget bundles",
    );

    fireEvent.click(chip("todo"));
    expect(screen.getByTestId("detail-title").textContent).toContain(
      "Fix login timeout on slow networks",
    );
  });

  it("offers no chip for a role the board does not use", () => {
    // singleTaskFixture has one wip task, so every other role counts zero.
    render(<TaskListView data={singleTaskFixture} />);

    expect(screen.getAllByTestId("role-filter")).toHaveLength(1);
    expect(chip("wip")).toBeTruthy();
    expect(chipOrNull("done")).toBeNull();
    expect(chipOrNull("todo")).toBeNull();
  });
});

describe("TaskListWidget — the detail title opens the task's canonical record", () => {
  /** Render the view capturing every link it dispatches. */
  function renderCapturing(data: TaskListPayload) {
    const opened: LinkRef[] = [];
    render(<TaskListView data={data} onOpenLink={(link) => opened.push(link)} />);
    return opened;
  }

  it("opens the tracker item when the task has one", () => {
    // The first card starts selected; it carries tracker OSI-101 and no PR.
    const opened = renderCapturing(taskListFixture);
    fireEvent.click(screen.getByTestId("detail-title-link"));

    expect(opened).toHaveLength(1);
    expect(opened[0].kind).toBe("tracker");
    expect(opened[0].url).toBe("https://tracker.example/browse/OSI-101");
  });

  it("falls back to the PR when the task has no tracker url", () => {
    const opened = renderCapturing(taskListFixture);
    // The second card: tracker_url null, PR #12.
    fireEvent.click(screen.getAllByRole("option")[1]);
    fireEvent.click(screen.getByTestId("detail-title-link"));

    expect(opened).toHaveLength(1);
    expect(opened[0].kind).toBe("pr");
    expect(opened[0].url).toBe("https://github.com/acme/app/pull/12");
  });

  it("prefers the tracker over the PR when the task carries both", () => {
    // singleTaskFixture has tracker OSI-142 AND PR #83 — the tracker is canonical.
    const opened = renderCapturing(singleTaskFixture);
    fireEvent.click(screen.getByTestId("detail-title-link"));

    expect(opened[0].kind).toBe("tracker");
    expect(opened[0].url).toBe("https://tracker.example/browse/OSI-142");
  });

  it("opens the link from the keyboard, not just the mouse", () => {
    const opened = renderCapturing(taskListFixture);
    fireEvent.keyDown(screen.getByTestId("detail-title-link"), { key: "Enter" });
    expect(opened).toHaveLength(1);
    expect(opened[0].kind).toBe("tracker");
  });

  it("renders a plain title — never a dead link — when the task has neither", () => {
    renderCapturing(minimalCardFixture);

    expect(screen.queryByTestId("detail-title-link")).toBeNull();
    expect(screen.getByTestId("detail-title").textContent).toContain(
      minimalCardFixture.tasks[0].title,
    );
  });
});

describe("TaskListWidget — AC3 (mock-host handshake)", () => {
  it("mock-host handshake delivers a tool-result the widget renders", async () => {
    const host = createMockHost(taskListFixture);
    await host.start();
    try {
      render(<TaskListWidget seam={host.seam} />);

      // the widget starts in its connecting state, then the pushed tool-result's
      // cards appear once the handshake completes (findAllByRole waits for them)
      const options = await screen.findAllByRole("option", {}, { timeout: 5000 });
      expect(options).toHaveLength(taskListFixture.tasks.length);

      // the payload actually reached the view — a row and the counts header from it
      expect(options[0].textContent).toContain("Fix login timeout on slow networks");
      expect(screen.queryByTestId("task-list-connecting")).toBeNull();
      expect(screen.getByTestId("board-counts").textContent).toContain("5 tasks");
    } finally {
      host.close();
    }
  });
});
