import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/preact";
import { TaskDetailView, TaskDetailWidget } from "./TaskDetailWidget";
import { taskDetailFixture } from "./fixture";
import { createMockHost } from "../../lib/mock-host";

describe("TaskDetailWidget — pure view over the fixture", () => {
  it("renders the card fields and links from the fixture", () => {
    render(<TaskDetailView data={taskDetailFixture} />);

    // single-row master, consistent with task-list's list shell
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("wip");
    expect(options[0].textContent).toContain("Fix login timeout on slow networks");

    // the detail pane carries every card field
    const pane = screen.getByTestId("list-detail-pane");
    expect(within(pane).getByTestId("detail-title").textContent).toContain(
      "Fix login timeout on slow networks",
    );
    expect(pane.textContent).toContain("001"); // id
    expect(pane.textContent).toContain("bug"); // type
    expect(pane.textContent).toContain("wip"); // status key
    expect(pane.textContent).toContain("(wip)"); // status role
    expect(pane.textContent).toContain("fix/001-OSI-101--login-timeout"); // branch
    expect(pane.textContent).toContain("slow-network-retry"); // spec slug (distinct from branch)

    // tracker + PR render as link buttons (ADR-0024 link model)
    expect(within(pane).getByRole("button", { name: /OSI-101/ })).toBeTruthy();
    expect(within(pane).getByRole("button", { name: /PR #12/ })).toBeTruthy();
  });

  it("renders the markdown body as elements", () => {
    render(<TaskDetailView data={taskDetailFixture} />);
    const body = screen.getByTestId("detail-body");

    // the <Markdown> primitive emits real DOM elements, proving reuse not
    // re-implementation and not raw markdown text
    const md = within(body).getByTestId("markdown");
    expect(md.querySelector("h2")).toBeTruthy(); // "## Summary"
    expect(md.querySelector("h3")).toBeTruthy(); // "### Steps to reproduce"
    expect(md.querySelector("li")).toBeTruthy(); // "- Throttle…"
    expect(md.querySelector("pre code")).toBeTruthy(); // fenced code block
    // and the markers themselves are gone (rendered, not literal)
    expect(body.textContent).not.toContain("## Summary");
    expect(body.textContent).toContain("Summary");
  });
});

describe("TaskDetailWidget — mock-host handshake", () => {
  it("mock-host handshake delivers a TaskDetail the widget renders", async () => {
    const host = createMockHost(taskDetailFixture);
    await host.start();
    try {
      render(<TaskDetailWidget seam={host.seam} />);

      // starts in its connecting state, then the pushed tool-result's task
      // appears once the handshake completes (findByTestId waits for it)
      const title = await screen.findByTestId("detail-title", {}, { timeout: 5000 });
      expect(title.textContent).toContain("Fix login timeout on slow networks");
      expect(screen.queryByTestId("task-detail-connecting")).toBeNull();

      // the markdown body reached the view too
      expect(screen.getByTestId("markdown").querySelector("pre code")).toBeTruthy();
    } finally {
      host.close();
    }
  });
});
