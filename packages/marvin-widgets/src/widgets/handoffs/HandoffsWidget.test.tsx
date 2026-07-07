import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/preact";
import { HandoffsView, HandoffsWidget } from "./HandoffsWidget";
import { handoffsFixture } from "./fixture";
import { createMockHost } from "../../lib/mock-host";

const FIRST = handoffsFixture.handoffs[0];

describe("HandoffsWidget — pure view over the fixture", () => {
  it("renders the master list and the selected handoff's fields and markdown body", () => {
    render(<HandoffsView data={handoffsFixture} />);

    // a real multi-row master (three handoffs), unlike task-detail's single row
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0].textContent).toContain(FIRST.id);
    expect(options[0].textContent).toContain(FIRST.objective);

    // the detail pane carries the selected (first, newest) handoff's fields
    const pane = screen.getByTestId("list-detail-pane");
    expect(within(pane).getByTestId("detail-title").textContent).toContain(FIRST.objective);
    expect(pane.textContent).toContain(FIRST.id); // id
    expect(pane.textContent).toContain(FIRST.branch); // branch
    expect(pane.textContent).toContain("dev"); // base
    expect(pane.textContent).toContain("widget-handoffs"); // spec slug
    // the PR link renders from pr_url (handoff-specific — no tracker field exists)
    expect(within(pane).getByRole("button", { name: /PR #88/ })).toBeTruthy();

    // the markdown body renders through the <Markdown> primitive as real elements
    const body = screen.getByTestId("detail-body");
    const md = within(body).getByTestId("markdown");
    expect(md.querySelector("h2")).toBeTruthy(); // "## Objective"
    expect(md.querySelector("h3")).toBeTruthy(); // "### Next steps"
    expect(md.querySelector("li")).toBeTruthy(); // "- Wire…"
    expect(md.querySelector("pre code")).toBeTruthy(); // fenced code block
    expect(body.textContent).not.toContain("## Objective"); // markers gone
    expect(body.textContent).toContain("Objective");
  });

  it("shows the empty state when there are no handoffs", () => {
    render(<HandoffsView data={{ handoffs: [] }} />);
    expect(screen.getByTestId("list-detail-empty").textContent).toMatch(/No handoffs yet/);
  });
});

describe("HandoffsWidget — continue prompt copy-to-chat", () => {
  it("surfaces the continue_prompt and sends it to chat via app.sendMessage on the seam path", async () => {
    // (1) pure view: the prompt is shown verbatim and the button calls onContinue
    // with exactly that prompt (the view→callback half of the wiring). Unmount it
    // before part (2) so the seam render is the only continue-button in the DOM.
    const onContinue = vi.fn();
    const view = render(<HandoffsView data={handoffsFixture} onContinue={onContinue} />);
    const shownPrompt = screen.getByTestId("continue-prompt");
    expect(shownPrompt.textContent).toBe(FIRST.continue_prompt);
    fireEvent.click(screen.getByTestId("continue-button"));
    expect(onContinue).toHaveBeenCalledWith(FIRST.continue_prompt);
    view.unmount();

    // (2) seam path: the live widget's onContinue reaches app.sendMessage with the
    // ext-apps message shape — the genuinely novel glue, proven with a spy, not a
    // mocked callback.
    const host = createMockHost(handoffsFixture);
    const sendMessage = vi
      .spyOn(host.seam.app, "sendMessage")
      .mockResolvedValue({} as Awaited<ReturnType<typeof host.seam.app.sendMessage>>);
    await host.start();
    try {
      render(<HandoffsWidget seam={host.seam} />);
      const button = await screen.findByTestId("continue-button", {}, { timeout: 5000 });
      fireEvent.click(button);
      expect(sendMessage).toHaveBeenCalledWith({
        role: "user",
        content: [{ type: "text", text: FIRST.continue_prompt }],
      });
    } finally {
      host.close();
    }
  });
});

describe("HandoffsWidget — mock-host handshake", () => {
  it("mock-host handshake delivers a HandoffDetailPayload the widget renders", async () => {
    const host = createMockHost(handoffsFixture);
    await host.start();
    try {
      render(<HandoffsWidget seam={host.seam} />);

      // starts connecting, then the pushed tool-result's handoffs appear once the
      // handshake completes (findByTestId waits for it)
      const title = await screen.findByTestId("detail-title", {}, { timeout: 5000 });
      expect(title.textContent).toContain(FIRST.objective);
      expect(screen.queryByTestId("handoffs-connecting")).toBeNull();

      // the whole set arrived (multi-row master) and the body reached the view
      expect(screen.getAllByRole("option")).toHaveLength(3);
      expect(screen.getByTestId("markdown").querySelector("pre code")).toBeTruthy();
    } finally {
      host.close();
    }
  });
});
