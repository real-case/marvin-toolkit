import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/preact";
// Runtime zod import: tests are the one place the widget workspace imports a schema at runtime.
import { AutopilotReportPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { AutopilotStatusView, AutopilotStatusWidget } from "./AutopilotStatusWidget";
import {
  haltedFixture,
  quietFixture,
  readyFixture,
  runningFixture,
  waitingFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";

describe("fixtures — AutopilotReportPayload contract", () => {
  const fixtures = { runningFixture, waitingFixture, readyFixture, haltedFixture, quietFixture };
  for (const [name, fixture] of Object.entries(fixtures)) {
    it(`${name} parses against the contract`, () => {
      const parsed = AutopilotReportPayload.safeParse(fixture);
      expect(parsed.success ? true : parsed.error.issues).toBe(true);
    });
  }
});

describe("AutopilotStatusView — the variant A card", () => {
  it("renders the header, the rail, the four figures and the events in Russian", () => {
    render(<AutopilotStatusView data={runningFixture} />);
    expect(screen.getByTestId("mv-root")).toBeTruthy();
    expect(screen.getByTestId("autopilot-pill").textContent).toBe("Идёт");
    expect(screen.getByTestId("autopilot-task").textContent).toBe(
      "Отчёт автопилота не реже раза в 5 минут",
    );
    const steps = screen.getAllByTestId("rail-step");
    expect(steps.map((s) => s.getAttribute("data-state"))).toEqual([
      "done",
      "done",
      "current",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(steps[2]?.textContent).toBe("Исполнение");
    const figures = screen.getAllByTestId("autopilot-figure").map((f) => f.textContent);
    expect(figures[0]).toContain("38 мин");
    expect(figures[1]).toContain("$4.12");
    expect(figures[1]).toContain("+$0.38 за интервал");
    expect(figures[2]).toContain("ступень 1");
    expect(figures[3]).toContain("проверки: 2 блок.");
    expect(screen.getAllByTestId("autopilot-event")).toHaveLength(3);
    expect(screen.queryByTestId("autopilot-callout")).toBeNull();
    expect(screen.getByTestId("autopilot-footer").textContent).toMatch(/следующий ≤ \d\d:\d\d/);
  });

  it("shows the question callout while the run waits", () => {
    render(<AutopilotStatusView data={waitingFixture} />);
    const callout = screen.getByTestId("autopilot-callout");
    expect(callout.getAttribute("data-kind")).toBe("question");
    expect(callout.textContent).toContain("Нужен ответ");
    expect(screen.getAllByTestId("rail-step")[0]?.getAttribute("data-state")).toBe("waiting");
  });

  it("marks the halted stage failed, says why, and ends with a final report", () => {
    render(<AutopilotStatusView data={haltedFixture} />);
    expect(screen.getAllByTestId("rail-step")[3]?.getAttribute("data-state")).toBe("failed");
    expect(screen.getByTestId("autopilot-callout").textContent).toContain("Причина остановки");
    expect(screen.getAllByTestId("autopilot-figure")[1]?.textContent).toContain("$5.60+");
    expect(screen.getByTestId("autopilot-footer").textContent).toContain("Финальный отчёт");
  });

  it("names the pull request on a ready card", () => {
    render(<AutopilotStatusView data={readyFixture} />);
    expect(
      screen.getAllByTestId("rail-step").every((s) => s.getAttribute("data-state") === "done"),
    ).toBe(true);
    expect(screen.getByTestId("autopilot-footer").textContent).toContain("/pull/266");
  });

  it("says a quiet interval had no events and who is still working, in English", () => {
    render(<AutopilotStatusView data={quietFixture} />);
    expect(screen.getByTestId("autopilot-events").textContent).toContain("No new events.");
    expect(screen.getByTestId("autopilot-active").textContent).toContain("executor");
    expect(screen.getByTestId("autopilot-pill").textContent).toBe("Running");
  });

  it("shows connecting, no-data and error states", () => {
    const { rerender } = render(<AutopilotStatusView data={null} connecting />);
    expect(screen.getByTestId("autopilot-connecting").textContent).toBe("Connecting…");
    rerender(<AutopilotStatusView data={null} connecting={false} />);
    expect(screen.getByTestId("autopilot-connecting").textContent).toBe("No autopilot report.");
    rerender(<AutopilotStatusView data={null} error="boom" />);
    expect(screen.getByTestId("autopilot-error").textContent).toContain("boom");
  });
});

describe("AutopilotStatusWidget — over the mock host", () => {
  it("renders the tool result the host delivers", async () => {
    const host = createMockHost(runningFixture);
    await host.start();
    try {
      render(<AutopilotStatusWidget seam={host.seam} />);
      expect(await screen.findByTestId("autopilot-card")).toBeTruthy();
    } finally {
      host.close();
    }
  });
});
