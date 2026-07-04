import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/preact";
import { TaskListView, TaskListWidget } from "./TaskListWidget";
import { taskListFixture } from "./fixture";
import { createMockHost } from "../../lib/mock-host";

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
