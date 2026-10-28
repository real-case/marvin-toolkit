import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
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

describe("AutopilotStatusView — the card", () => {
  it("renders the header, the rail, the four figures and the events in Russian", () => {
    render(<AutopilotStatusView data={runningFixture} />);
    expect(screen.getByTestId("mv-root")).toBeTruthy();
    expect(screen.getByTestId("autopilot-pill").textContent).toBe("Идёт");
    // The header names the run and the session, never the task: that is the whole prompt.
    expect(screen.getByTestId("autopilot-card").textContent).toContain(
      "#8 • marvin • r-1025-1412-ab3c",
    );
    expect(screen.getByTestId("autopilot-session").textContent).toBe(
      runningFixture.report.sessionName,
    );
    expect(screen.getByTestId("autopilot-copy").getAttribute("aria-label")).toBe(
      "Скопировать как изображение",
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
    // The line is filled up to the current stage: two of the six spans.
    expect(screen.getByTestId("rail-progress").style.width).toBe("calc(100% * 2 / 7)");
    const figures = screen.getAllByTestId("autopilot-figure").map((f) => f.textContent);
    expect(figures[0]).toContain("38 мин");
    expect(figures[1]).toContain("$4.12");
    expect(figures[1]).toContain("+$0.38 за интервал");
    expect(figures[2]).toContain("ступень 1");
    expect(figures[3]).toContain("проверки: 2 блок.");
    expect(screen.getAllByTestId("autopilot-event")).toHaveLength(3);
    expect(screen.queryByTestId("autopilot-callout")).toBeNull();
    const footer = screen.getByTestId("autopilot-footer").textContent;
    expect(footer).toContain("Opus 5.5 medium effort");
    expect(footer).not.toContain("Исполнитель");
    expect(screen.getByTestId("autopilot-context").textContent).toContain("29% · 287k / 1M");
  });

  it("unfolds the whole run's history and folds it back", () => {
    render(<AutopilotStatusView data={runningFixture} />);
    const toggle = screen.getByTestId("autopilot-history-toggle");
    expect(toggle.textContent).toBe("Вся история · 10");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByTestId("autopilot-event")).toHaveLength(3);
    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("Только с прошлого отчёта");
    expect(screen.getByTestId("autopilot-events").textContent).toContain("С начала работы");
    const events = screen.getAllByTestId("autopilot-event").map((e) => e.textContent ?? "");
    expect(events).toHaveLength(13);
    expect(events[0]).toContain("Запуск");
    expect(events[12]).toContain("продолжает: AC-4");
    expect(screen.getByTestId("autopilot-history-divider").textContent).toBe("с прошлого отчёта");
    fireEvent.click(toggle);
    expect(screen.getAllByTestId("autopilot-event")).toHaveLength(3);
    expect(screen.queryByTestId("autopilot-history-divider")).toBeNull();
  });

  it("counts earlier events no report carried, and offers no toggle without history", () => {
    render(<AutopilotStatusView data={readyFixture} />);
    expect(screen.getByTestId("autopilot-history-toggle").textContent).toBe("Вся история · 14");
    render(<AutopilotStatusView data={quietFixture} />);
    expect(screen.getAllByTestId("autopilot-history-toggle")).toHaveLength(1);
  });

  it("shows the question callout while the run waits", () => {
    render(<AutopilotStatusView data={waitingFixture} />);
    const callout = screen.getByTestId("autopilot-callout");
    expect(callout.getAttribute("data-kind")).toBe("question");
    expect(callout.textContent).toContain("Нужен ответ");
    expect(screen.getAllByTestId("rail-step")[0]?.getAttribute("data-state")).toBe("waiting");
  });

  it("marks the halted stage failed, says why, and clamps a long session name", () => {
    render(<AutopilotStatusView data={haltedFixture} />);
    expect(screen.getAllByTestId("rail-step")[3]?.getAttribute("data-state")).toBe("failed");
    // The retro ran after the halt, but the fill stops at the failed stage.
    expect(screen.getByTestId("rail-progress").style.width).toBe("calc(100% * 3 / 7)");
    expect(screen.getByTestId("autopilot-callout").textContent).toContain("Причина остановки");
    expect(screen.getAllByTestId("autopilot-figure")[1]?.textContent).toContain("$5.60+");
    const name = screen.getByTestId("autopilot-session");
    // jsdom drops -webkit-line-clamp, so the clamp itself is the Halted story's visual baseline;
    // here the full name stays reachable as the tooltip.
    expect(name.style.overflow).toBe("hidden");
    expect(name.getAttribute("title")).toBe(haltedFixture.report.sessionName);
    expect(screen.getByTestId("autopilot-context").textContent).toContain("88% · 176k / 200k");
  });

  it("marks every stage done on a ready card", () => {
    render(<AutopilotStatusView data={readyFixture} />);
    expect(
      screen.getAllByTestId("rail-step").every((s) => s.getAttribute("data-state") === "done"),
    ).toBe(true);
  });

  it("shows the tokens alone when the context window is unknown", () => {
    render(<AutopilotStatusView data={waitingFixture} />);
    expect(screen.getByTestId("autopilot-context").textContent).toBe("Контекст24k");
    expect(screen.getByTestId("autopilot-footer").textContent).toContain("opus high effort");
  });

  it("leaves the footer out when no session has started, and the name when there is none", () => {
    const report = { ...runningFixture.report, session: null, sessionName: null };
    render(<AutopilotStatusView data={{ ...runningFixture, report }} />);
    expect(screen.queryByTestId("autopilot-footer")).toBeNull();
    expect(screen.queryByTestId("autopilot-session")).toBeNull();
  });

  it("says a quiet interval had no events and who is still working, in English", () => {
    render(<AutopilotStatusView data={quietFixture} />);
    expect(screen.getByTestId("autopilot-events").textContent).toContain("No new events.");
    expect(screen.getByTestId("autopilot-active").textContent).toContain("executor");
    expect(screen.getByTestId("autopilot-pill").textContent).toBe("Running");
    expect(screen.getByTestId("autopilot-footer").textContent).toContain("Opus 5.5 medium effort");
    expect(screen.getByTestId("autopilot-copy").getAttribute("aria-label")).toBe("Copy as image");
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
