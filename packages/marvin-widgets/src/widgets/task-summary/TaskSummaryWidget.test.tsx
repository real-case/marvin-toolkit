import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/preact";
// Runtime zod import — the contract schema doubles as the TaskSummary type; tests
// are the one place the widget workspace may import the schema at runtime.
import { TaskSummary } from "@marvin-toolkit/mcp-shared/contracts";
import { TaskSummaryView, TaskSummaryWidget } from "./TaskSummaryWidget";
import {
  taskSummaryFixture,
  allPassingSummaryFixture,
  failingSummaryFixture,
  emptySummaryFixture,
  longSummaryFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";

describe("fixtures — TaskSummary contract", () => {
  // Every fixture the stories render must parse against the real zod contract,
  // so a contract change can never silently drift the visual fixtures.
  const fixtures = {
    taskSummaryFixture,
    allPassingSummaryFixture,
    failingSummaryFixture,
    emptySummaryFixture,
    longSummaryFixture,
  };
  for (const [name, fixture] of Object.entries(fixtures)) {
    it(`${name} parses against the TaskSummary contract`, () => {
      const parsed = TaskSummary.safeParse(fixture);
      expect(parsed.success ? true : parsed.error.issues).toBe(true);
    });
  }
});

describe("TaskSummaryView — panel over the fixture", () => {
  it("renders the panel sections with per-outcome badges", () => {
    render(<TaskSummaryView data={taskSummaryFixture} />);

    // the view renders inside its own MvRoot theme scope (both wiring paths share it)
    expect(screen.getByTestId("mv-root")).toBeTruthy();

    // header: title + status + the roll-up stat cells computed from the payload
    const header = screen.getByTestId("summary-header");
    expect(header.textContent).toContain("Task-summary MCP Apps widget");
    expect(header.textContent).toContain("in-review");
    const rollup = screen.getByTestId("summary-rollup").textContent ?? "";
    expect(rollup).toContain("Acceptance");
    expect(rollup).toContain("1/3"); // one of three ACs is pass
    expect(rollup).toContain("Gates");
    expect(rollup).toContain("2/4"); // two of four gates passed
    expect(rollup).toContain("1 failed"); // the failure context is spelled out

    // acceptance: three rows whose badge reflects pass / unknown / fail in order
    const acRows = screen.getAllByTestId("ac-row");
    expect(acRows).toHaveLength(3);
    expect(acRows.map((r) => r.getAttribute("data-outcome"))).toEqual(["pass", "unknown", "fail"]);
    // the conservative model: the unknown row must read as its own neutral state, not
    // as a failure — the badge word is "unknown", not "fail"
    const unknownRow = acRows[1];
    expect(within(unknownRow).getByText("unknown")).toBeTruthy();
    expect(within(unknownRow).queryByText("fail")).toBeNull();

    // AC1 statement renders through <Markdown> as a real inline <code>, not literal text
    const ac1 = acRows[0];
    expect(within(ac1).getByTestId("markdown").querySelector("code")).toBeTruthy();
    expect(ac1.textContent).not.toContain("`"); // backticks consumed by the parser
    expect(ac1.textContent).toContain("test"); // its oracle kind annotation

    // gates: four rows spanning pass / skip / fail, with the failure's detail
    const gateRows = screen.getAllByTestId("gate-row");
    expect(gateRows.map((r) => r.getAttribute("data-status"))).toEqual([
      "pass",
      "pass",
      "skip",
      "fail",
    ]);
    const buildRow = gateRows[3];
    expect(buildRow.textContent).toContain("build");
    expect(buildRow.textContent).toContain("exit 1");

    // commits: sha + subject, newest-first as delivered
    const commitRows = screen.getAllByTestId("commit-row");
    expect(commitRows).toHaveLength(2);
    expect(commitRows[0].textContent).toContain("a1b2c3d");
    expect(commitRows[0].textContent).toContain("feat(widgets): task-summary panel view");

    // lessons: present with its single row
    const lessons = screen.getByTestId("summary-lessons");
    expect(within(lessons).getAllByTestId("lesson-row")).toHaveLength(1);
    expect(lessons.textContent).toContain("The Markdown primitive is block-level");
  });

  it("renders links via the three-type link model", () => {
    const onOpenLink = vi.fn();
    render(<TaskSummaryView data={taskSummaryFixture} onOpenLink={onOpenLink} />);
    const links = screen.getByTestId("summary-links");

    // external (url) links carry the ↗ affordance; ref-only links do not
    const pr = within(links).getByRole("button", { name: /PR #91/ });
    expect(pr.textContent).toContain("↗");
    expect(pr.getAttribute("data-external")).toBe("true");
    const spec = within(links).getByRole("button", { name: "widget-task-summary" });
    expect(spec.textContent).not.toContain("↗");
    expect(spec.getAttribute("data-external")).toBe("false");

    // clicking an external link dispatches through onOpenLink with the link (url intact)
    fireEvent.click(pr);
    expect(onOpenLink).toHaveBeenCalledTimes(1);
    expect(onOpenLink).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://github.com/real-case/marvin-toolkit/pull/91" }),
    );
    // clicking a ref-only link still routes through the same handler (the wiring, not
    // the view, decides no host call happens — classifyLink returns "internal")
    fireEvent.click(spec);
    expect(onOpenLink).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "spec", ref: "widget-task-summary" }),
    );
  });

  it("renders empty-state notes and the connecting and error states", () => {
    const thin: TaskSummary = {
      slug: "thin",
      title: "Thin summary",
      status: "ready",
      acceptance: [],
      gates: [],
      commits: [],
      lessons: [],
      links: [],
    };
    const { rerender } = render(<TaskSummaryView data={thin} />);

    // every collection section shows its own empty-state note …
    expect(screen.getByTestId("acceptance-empty")).toBeTruthy();
    expect(screen.getByTestId("gates-empty")).toBeTruthy();
    expect(screen.getByTestId("commits-empty")).toBeTruthy();
    expect(screen.getByTestId("links-empty")).toBeTruthy();
    // … and the Lessons section is omitted entirely when there are no lessons
    expect(screen.queryByTestId("summary-lessons")).toBeNull();

    // null data → connecting; a not-connecting null → the settled "no data" copy
    rerender(<TaskSummaryView data={null} />);
    expect(screen.getByTestId("summary-connecting").textContent).toContain("Connecting");
    rerender(<TaskSummaryView data={null} connecting={false} />);
    expect(screen.getByTestId("summary-connecting").textContent).toContain("No task summary");

    // an error prop replaces the panel with the error surface
    rerender(<TaskSummaryView data={null} error="boom" />);
    expect(screen.getByTestId("summary-error").textContent).toContain("boom");
    expect(screen.queryByTestId("summary-panel")).toBeNull();
  });
});

describe("TaskSummaryWidget — mock-host handshake", () => {
  it("mock-host handshake delivers a TaskSummary the widget renders", async () => {
    const host = createMockHost(taskSummaryFixture);
    await host.start();
    try {
      render(<TaskSummaryWidget seam={host.seam} />);

      // starts connecting, then the pushed tool-result's summary renders
      const header = await screen.findByTestId("summary-header", {}, { timeout: 5000 });
      expect(header.textContent).toContain("Task-summary MCP Apps widget");
      expect(screen.queryByTestId("summary-connecting")).toBeNull();
      // a section from the delivered payload reached the view
      expect(screen.getAllByTestId("ac-row")).toHaveLength(3);
    } finally {
      host.close();
    }
  });
});
