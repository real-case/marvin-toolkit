import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
// Runtime zod import: tests are the one place the widget workspace imports a schema at runtime.
import { AutopilotReportPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { AutopilotStatusView, AutopilotStatusWidget } from "./AutopilotStatusWidget";
import {
  haltedFixture,
  quietFixture,
  readyEnglishFixture,
  readyFixture,
  runningFixture,
  waitingFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";

describe("fixtures — AutopilotReportPayload contract", () => {
  const fixtures = {
    runningFixture,
    waitingFixture,
    readyFixture,
    readyEnglishFixture,
    haltedFixture,
    quietFixture,
  };
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

describe("AutopilotStatusView — the final card", () => {
  it("sums the run up in the order of the design, with no footer", () => {
    render(<AutopilotStatusView data={readyFixture} />);
    const card = screen.getByTestId("autopilot-card");
    expect(screen.getByTestId("autopilot-final-title").textContent).toBe(
      "Автопилот · итоговый отчёт",
    );
    expect(screen.getByTestId("autopilot-period").textContent).toMatch(
      /^r-1025-1412-ab3c · \d\d:\d\d → \d\d:\d\d$/,
    );
    expect(card.textContent).not.toContain("#15 • marvin");
    expect(screen.getAllByTestId("rail-duration").map((d) => d.textContent)).toEqual([
      "7 мин",
      "9 мин",
      "28 мин",
      "6 мин",
      "8 мин",
      "10 мин",
      "4 мин",
    ]);
    const figures = screen.getAllByTestId("autopilot-figure").map((f) => f.textContent);
    expect(figures[0]).toContain("1 ч 12 мин");
    expect(figures[0]).toContain("активно 58 мин");
    expect(figures[1]).toContain("$7.48");
    expect(figures[1]).toContain("5 ролей");
    expect(figures[1]).not.toContain("за интервал");
    expect(figures[2]).toContain("Итерации");
    expect(figures[2]).toContain("ступень 1");
    expect(figures[3]).toContain("проверки: 2 блок.");
    expect(screen.getByTestId("autopilot-tokens").textContent).toContain("Токены · 11.3M");
    expect(screen.getAllByTestId("autopilot-token-kind").map((k) => k.textContent)).toEqual([
      "Чтение кэша9.8M",
      "Запись кэша1.1M",
      "Вход210k",
      "Выход190k",
    ]);
    const outcome = screen.getByTestId("autopilot-outcome").textContent;
    expect(outcome).toContain("PR #266 готов к слиянию");
    expect(outcome).toContain("9 файлов · +412 −38 · CI: 5 из 5 · в dev");
    expect(screen.getByTestId("autopilot-open-pr").getAttribute("href")).toBe(
      readyFixture.report.prUrl,
    );
    expect(screen.getByTestId("autopilot-criteria").textContent).toContain(
      "Критерии приёмки · 6 из 6",
    );
    expect(screen.getAllByTestId("autopilot-criterion")).toHaveLength(6);
    expect(screen.getByTestId("autopilot-questions").textContent).toContain(
      "оркестратор ответил на 2, вы на 0",
    );
    expect(screen.getByTestId("autopilot-retro").textContent).toContain(
      "+1 проверка в checks.yaml, +1 урок в .marvin/memory.",
    );
    expect(screen.getAllByTestId("autopilot-assumption")).toHaveLength(1);
    expect(screen.queryByTestId("autopilot-footer")).toBeNull();
    const order = [
      "autopilot-rail",
      "autopilot-tokens",
      "autopilot-outcome",
      "autopilot-criteria",
      "autopilot-questions",
      "autopilot-assumption",
      "autopilot-events",
    ].map((id) => screen.getAllByTestId(id)[0]!);
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("unfolds the tokens by role, amber at 80% of the window, and the evidence", () => {
    render(<AutopilotStatusView data={readyFixture} />);
    expect(screen.queryByTestId("autopilot-tokens-roles")).toBeNull();
    fireEvent.click(screen.getByTestId("autopilot-tokens-toggle"));
    const rows = screen.getAllByTestId("autopilot-token-role").map((r) => r.textContent);
    expect(rows).toEqual([
      "ПланировщикOpus 5.51.6M9%",
      "Автор тестовOpus 5.51.3M7%",
      "Исполнитель × 2Opus 5.56.4M29%",
      "ВерификаторSonnet 5.51.4M84%",
      "РетроSonnet 5.5600k21%",
    ]);
    const bars = screen
      .getAllByTestId("autopilot-token-role")
      .map((r) => (r.querySelector("[aria-hidden] > span") as HTMLElement).style.background);
    expect(bars[3]).toBe("var(--amb)");
    expect(bars[2]).toBe("var(--ac)");
    expect(screen.queryByTestId("autopilot-proof")).toBeNull();
    fireEvent.click(screen.getByTestId("autopilot-proof-toggle"));
    const proofs = screen.getAllByTestId("autopilot-proof");
    expect(proofs.map((p) => p.getAttribute("data-proof"))).toEqual([
      "red_green",
      "red_green",
      "red_green",
      "green",
      "green",
      "green",
    ]);
    expect(proofs[0]!.textContent).toBe("red→green");
    expect(proofs[0]!.style.background).toBe("var(--acbg)");
    expect(proofs[5]!.style.background).toBe("var(--grnbg)");
  });

  it("opens the PR through the host when the host can", () => {
    const opened: string[] = [];
    render(<AutopilotStatusView data={readyFixture} openLink={(u) => opened.push(u)} />);
    fireEvent.click(screen.getByTestId("autopilot-open-pr"));
    expect(opened).toEqual([readyFixture.report.prUrl]);
  });

  it("hides what the run left absent, in English", () => {
    render(<AutopilotStatusView data={readyEnglishFixture} />);
    expect(screen.getByTestId("autopilot-final-title").textContent).toBe(
      "Autopilot · final report",
    );
    expect(screen.queryByTestId("autopilot-tokens")).toBeNull();
    expect(screen.queryByTestId("autopilot-retro")).toBeNull();
    expect(screen.queryByTestId("autopilot-assumption")).toBeNull();
    expect(screen.getAllByTestId("rail-duration")[1]?.textContent).toBe("");
    expect(screen.getAllByTestId("autopilot-figure")[1]?.textContent).toContain(
      "5 roles, some costs unknown",
    );
    expect(screen.getByTestId("autopilot-outcome").textContent).toContain(
      "9 files · +412 −38 · into dev",
    );
    // A ready run's criteria are all met; only the proven one offers evidence.
    expect(screen.getByTestId("autopilot-criteria").textContent).toContain(
      "Acceptance criteria · 2 of 2",
    );
    fireEvent.click(screen.getByTestId("autopilot-proof-toggle"));
    expect(screen.getAllByTestId("autopilot-proof")).toHaveLength(1);
  });

  it("keeps the periodic layout for a final report without a summary", () => {
    const report = { ...readyFixture.report, summary: null };
    render(<AutopilotStatusView data={{ ...readyFixture, report }} />);
    expect(screen.queryByTestId("autopilot-final-title")).toBeNull();
    expect(screen.getByTestId("autopilot-footer")).toBeTruthy();
    expect(screen.queryAllByTestId("rail-duration")).toHaveLength(0);
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
