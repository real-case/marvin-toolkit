import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/preact";
// Runtime zod import — the contract schema doubles as the DashboardState type;
// tests are the one place the widget workspace may import the schema at runtime.
import { DashboardState } from "@marvin-toolkit/mcp-shared/contracts";
import { DashboardView, DashboardWidget, DASHBOARD_STYLE_ID } from "./DashboardWidget";
import { AFFORDANCE_COMMANDS, type AffordanceId } from "./helpers";
import {
  dashboardFixture,
  coreOnlyDashboardFixture,
  freshDashboardFixture,
  noGitDashboardFixture,
  longPathsDashboardFixture,
  scannedCleanDashboardFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";

/**
 * Dashboard widget render + wiring tests (spec dashboard-widget-rework, AC2/AC9).
 *
 * AC2 covers the three-zone layout, the audit null-versus-clean discriminator
 * and the injected breakpoint rules. AC9 covers the wiring, and does it by
 * ITERATING the exported affordance map rather than hand-listing controls: an
 * entry added later without a rendered control fails, and a control that renders
 * without a handler fails. Hand-listing would let both through.
 */

beforeEach(() => {
  cleanup();
  document.getElementById(DASHBOARD_STYLE_ID)?.remove();
});

describe("fixtures — DashboardState contract", () => {
  // Every fixture the stories render must parse against the real zod contract,
  // so a contract change can never silently drift the visual fixtures.
  const fixtures = {
    dashboardFixture,
    coreOnlyDashboardFixture,
    freshDashboardFixture,
    noGitDashboardFixture,
    longPathsDashboardFixture,
    scannedCleanDashboardFixture,
  };
  for (const [name, fixture] of Object.entries(fixtures)) {
    it(`${name} parses against the DashboardState contract`, () => {
      const parsed = DashboardState.safeParse(fixture);
      expect(parsed.success ? true : parsed.error.issues).toBe(true);
    });
  }

  it("no fixture carries the removed v1 security / refactor inventories", () => {
    for (const fixture of [dashboardFixture, freshDashboardFixture, coreOnlyDashboardFixture]) {
      expect("security" in fixture).toBe(false);
      expect("refactor" in fixture).toBe(false);
    }
  });
});

describe("layout — the nav shell and three zones", () => {
  it("renders the sidebar and all three zones from the full payload", () => {
    render(<DashboardView data={dashboardFixture} />);

    expect(screen.getByTestId("dashboard-sidebar")).toBeTruthy();
    expect(screen.getByTestId("zone-project")).toBeTruthy();
    expect(screen.getByTestId("zone-work")).toBeTruthy();
    expect(screen.getByTestId("zone-toolbox")).toBeTruthy();

    // the v1 cards are gone with the contract fields that fed them
    expect(screen.queryByTestId("card-security")).toBeNull();
    expect(screen.queryByTestId("card-refactor")).toBeNull();

    // …while the security DOCUMENT count survives on the Artifacts card
    expect(screen.getByTestId("artifacts-audits").textContent).toContain("2");
  });

  it("renders the identity strip with version, branch and base", () => {
    render(<DashboardView data={dashboardFixture} />);
    const header = screen.getByTestId("dashboard-header");
    expect(within(header).getByTestId("dashboard-version").textContent).toContain("0.1.0");
    expect(within(header).getByTestId("dashboard-branch").textContent).toContain(
      "feat/dashboard-rework",
    );
    expect(header.textContent).toContain("base main");
  });

  it("outside a git repo the branch reads as a note, not an empty chip", () => {
    render(<DashboardView data={noGitDashboardFixture} />);
    expect(screen.getByTestId("dashboard-branch").textContent).toContain("not in a git repo");
  });

  it("the board bar follows the configured status order and totals every status", () => {
    render(<DashboardView data={dashboardFixture} />);
    expect(screen.getByTestId("board-total").textContent).toBe("15");
    const legend = screen.getAllByTestId("board-bar-legend").map((el) => el.dataset.key);
    expect(legend).toEqual(["backlog", "in-progress", "in-review", "done", "blocked"]);
  });

  it("renders the MCP servers lit and dim by enabled state", () => {
    render(<DashboardView data={dashboardFixture} />);
    const card = screen.getByTestId("card-servers");
    const pills = Array.from(card.querySelectorAll("[data-server]")) as HTMLElement[];
    const byName = Object.fromEntries(pills.map((el) => [el.dataset.server, el.dataset.enabled]));
    expect(byName.marvin).toBe("true");
    expect(byName.playwright).toBe("false");
  });

  it("renders the current-work digest rows for board cards, specs and handoffs", () => {
    render(<DashboardView data={dashboardFixture} />);
    expect(screen.getAllByTestId("current-board-row")).toHaveLength(3);
    expect(screen.getAllByTestId("current-spec-row")).toHaveLength(3);
    expect(screen.getAllByTestId("handoff-row")).toHaveLength(3);
  });

  it("renders the toolbox cards from the extended sections", () => {
    render(<DashboardView data={dashboardFixture} />);
    expect(screen.getByTestId("card-adr").textContent).toContain("Decisions · ADR (30)");
    expect(screen.getByTestId("adr-malformed").textContent).toContain("1 malformed");
    expect(screen.getByTestId("card-lessons").textContent).toContain("Lessons (5)");
    expect(screen.getByTestId("usage-window").textContent).toContain("2026-06-01 → 2026-07-07");
    expect(screen.getAllByTestId("usage-top")).toHaveLength(3);
    expect(screen.getByTestId("card-commands").textContent).toContain("Commands (35)");
  });

  it("a help-narrow payload omits the v2 zones instead of rendering empty ones", () => {
    render(<DashboardView data={coreOnlyDashboardFixture} />);
    // absent (not zero) → the whole work zone has nothing to show
    expect(screen.queryByTestId("zone-work")).toBeNull();
    expect(screen.queryByTestId("card-servers")).toBeNull();
    expect(screen.queryByTestId("card-adr")).toBeNull();
    expect(screen.queryByTestId("card-usage")).toBeNull();
    // the always-present cards still render
    expect(screen.getByTestId("card-paths")).toBeTruthy();
    expect(screen.getByTestId("card-board")).toBeTruthy();
    expect(screen.getByTestId("card-commands")).toBeTruthy();
  });

  it("a fresh project renders present-but-empty sections rather than omitting them", () => {
    render(<DashboardView data={freshDashboardFixture} />);
    // present-but-zero → the zone renders WITH its zero states, which is the
    // opposite of the help-narrow case above. Collapsing the two would make a
    // configured-but-idle project indistinguishable from an unconfigured one.
    expect(screen.getByTestId("zone-work")).toBeTruthy();
    expect(screen.getByTestId("card-servers").textContent).toContain("No MCP servers configured");
    expect(screen.getByTestId("card-usage").textContent).toContain("No events recorded");
    expect(screen.getByTestId("board-total").textContent).toBe("0");
    expect(screen.getByTestId("card-board").textContent).toContain("No cards on the board yet");
  });

  it("longPathsDashboardFixture renders the deep paths and the long base branch", () => {
    render(<DashboardView data={longPathsDashboardFixture} />);
    expect(screen.getByTestId("card-paths").textContent).toContain(
      "payments-orchestration-gateway/.marvin/config.json",
    );
    expect(screen.getByTestId("card-config").textContent).toContain(
      "release/2026.07-payments-orchestration-long-term-support",
    );
  });
});

describe("audit areas — never-scanned is not clean", () => {
  const areaByName = (name: string) =>
    screen.getAllByTestId("audit-area").find((el) => el.dataset.area === name)!;

  it("renders a scanned-clean area differently from a never-scanned one", () => {
    render(<DashboardView data={scannedCleanDashboardFixture} />);

    const security = areaByName("security");
    const refactor = areaByName("refactor");

    // The two areas carry the same renderable numbers — no findings, no
    // severities — so only the discriminant separates them. A widget that
    // collapsed the states would render these two identically and pass any
    // assertion made on counts alone.
    expect(security.dataset.state).toBe("clean");
    expect(refactor.dataset.state).toBe("never-scanned");
    expect(security.dataset.state).not.toBe(refactor.dataset.state);

    expect(within(security).getByTestId("audit-note").textContent).toContain("no findings");
    expect(within(refactor).getByTestId("audit-note").textContent).toContain("never scanned");

    // the scanned area still reports WHEN it was scanned; the other cannot
    expect(security.textContent).toContain("today");
    expect(refactor.textContent).not.toContain("today");
  });

  it("an area with findings renders a ranked severity bar, not payload order", () => {
    render(<DashboardView data={dashboardFixture} />);
    const security = areaByName("security");
    expect(security.dataset.state).toBe("findings");
    expect(within(security).getByTestId("audit-total").textContent).toBe("14");

    // the fixture lists `medium` FIRST in by_severity; the bar must still read
    // critical → high → medium → low
    const legend = within(security)
      .getAllByTestId("audit-bar-legend")
      .map((el) => el.dataset.key);
    expect(legend).toEqual(["critical", "high", "medium", "low"]);
  });

  it("a fresh project shows both areas as never-scanned", () => {
    render(<DashboardView data={freshDashboardFixture} />);
    for (const name of ["security", "refactor"]) {
      expect(areaByName(name).dataset.state).toBe("never-scanned");
    }
  });
});

describe("responsive rules — the injected stylesheet", () => {
  it("carries all four of the mockup's breakpoints", () => {
    render(<DashboardView data={dashboardFixture} />);
    const sheet = document.getElementById(DASHBOARD_STYLE_ID);
    expect(sheet).toBeTruthy();
    const css = sheet?.textContent ?? "";

    // No image baseline can catch a dropped breakpoint: the Storybook runner
    // pins the viewport at 1000×800, above every one of these. The sheet text is
    // the only oracle available, which is why all four are asserted by name.
    // Assert the rule BODY, not just the query header: an empty or mis-targeted
    // media block satisfies a header-only check while reflowing nothing. F13
    // pins each width to a specific grid, so that pairing is what gets asserted.
    const bodyOf = (width: string) => {
      const at = css.indexOf(`@media (max-width:${width})`);
      expect(at, `breakpoint ${width} missing`).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf("\n@media", at + 1) + 1 || undefined);
    };
    expect(bodyOf("860px")).toContain(".mvdash-grid-tb{grid-template-columns:repeat(2");
    expect(bodyOf("720px")).toContain(".mvdash-shell{flex-direction:column}");
    expect(bodyOf("720px")).toContain(".mvdash-sidefoot{display:none}");
    expect(bodyOf("680px")).toContain(".mvdash-grid-sum{grid-template-columns:1fr}");
    expect(bodyOf("600px")).toContain(".mvdash-grid-2{grid-template-columns:1fr}");
  });

  it("guards the entrance animations behind prefers-reduced-motion", () => {
    render(<DashboardView data={dashboardFixture} />);
    const css = document.getElementById(DASHBOARD_STYLE_ID)?.textContent ?? "";
    // ported from the mockup, guard included — the baselines are unaffected
    // because the Storybook runner screenshots with animations: "disabled"
    const at = css.indexOf("@media (prefers-reduced-motion:no-preference)");
    expect(at).toBeGreaterThan(-1);
    // BOUND the slice at the block's closing brace. A one-argument slice runs to
    // the end of the sheet, so the two assertions below would be satisfied by
    // the rules appearing anywhere after the guard OPENS — including outside it,
    // which is exactly the regression this test exists to prevent.
    const guarded = css.slice(at, css.indexOf("\n}", at));
    expect(guarded).toContain(".mvdash-reveal{opacity:0;animation:mvDashUp");
    expect(guarded).toContain(".mvdash-bar{animation:mvDashWipe");
    // `opacity:0` MUST be inside the guard: outside it, a reduced-motion user
    // gets a permanently invisible panel rather than a non-animated one.
    expect(guarded).toContain("opacity:0");
  });

  it("injects the sheet exactly once across repeated renders", () => {
    render(<DashboardView data={dashboardFixture} />);
    cleanup();
    render(<DashboardView data={freshDashboardFixture} />);
    expect(document.querySelectorAll(`#${DASHBOARD_STYLE_ID}`)).toHaveLength(1);
  });
});

describe("connection states", () => {
  it("renders the connecting placeholder", () => {
    render(<DashboardView data={null} connecting />);
    expect(screen.getByTestId("dashboard-connecting").textContent).toContain("Connecting");
  });

  it("renders the no-data placeholder once connected", () => {
    render(<DashboardView data={null} connecting={false} />);
    expect(screen.getByTestId("dashboard-connecting").textContent).toContain("No dashboard data");
  });

  it("renders the transport error", () => {
    render(<DashboardView data={null} error="transport dropped" />);
    expect(screen.getByTestId("dashboard-error").textContent).toContain("transport dropped");
  });
});

describe("AC9 — every affordance is wired to the action handler", () => {
  it("every entry in the affordance map has a control that emits its command", () => {
    const onAction = vi.fn();
    render(<DashboardView data={dashboardFixture} onAction={onAction} />);

    const controls = screen.getAllByTestId("dash-action");
    const rendered = new Set(controls.map((el) => el.dataset.affordance));

    // ITERATE the map, do not hand-list. An entry added to helpers.ts without a
    // control fails here; a control rendered without a handler fails below.
    for (const id of Object.keys(AFFORDANCE_COMMANDS) as AffordanceId[]) {
      expect(rendered.has(id), `affordance ${id} has no rendered control`).toBe(true);
    }

    // EVERY control, not `controls.find(...)`. Two affordances render twice
    // (`nav-tasks` as the sidebar item and the "open board →" footer,
    // `nav-reports` likewise), and `find` always returns the sidebar one — so a
    // dead column-footer link would have gone unproven behind its live twin.
    for (const control of controls) {
      const id = control.dataset.affordance as AffordanceId;
      onAction.mockClear();
      fireEvent.click(control);
      expect(onAction, `a ${id} control did not call the handler`).toHaveBeenCalledTimes(1);
      const emitted = onAction.mock.calls[0]![0] as string;
      // row affordances append their own row's identifier, so the invariant is
      // the PREFIX — asserting equality would force the rows to drop their ids
      expect(emitted.startsWith(AFFORDANCE_COMMANDS[id]), `${id} emitted ${emitted}`).toBe(true);
    }
  });

  it("gives every action control a distinct accessible name", () => {
    render(<DashboardView data={dashboardFixture} onAction={vi.fn()} />);
    // eight controls read "open →" verbatim; without an explicit label a screen
    // reader hears the same control eight times, since the row title is a
    // sibling node and contributes nothing to the accessible name
    const links = screen
      .getAllByTestId("dash-action")
      .filter((el) => el.textContent?.includes("open →"));
    expect(links.length).toBeGreaterThanOrEqual(3);
    const names = links.map((el) => el.getAttribute("aria-label"));
    expect(names.every((n) => n && n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it("row affordances carry their row's identifier, not a bare prefix", () => {
    const onAction = vi.fn();
    render(<DashboardView data={dashboardFixture} onAction={onAction} />);

    const boardRow = screen.getAllByTestId("current-board-row")[0]!;
    fireEvent.click(within(boardRow).getByTestId("dash-action"));
    expect(onAction).toHaveBeenCalledWith("/marvin:track-show 042");

    onAction.mockClear();
    const specRow = screen.getAllByTestId("current-spec-row")[0]!;
    fireEvent.click(within(specRow).getByTestId("dash-action"));
    expect(onAction).toHaveBeenCalledWith("/marvin:task-summary dashboard-widget-rework");
  });

  it("the controls sharing /marvin:reports are separately wired", () => {
    const onAction = vi.fn();
    render(<DashboardView data={dashboardFixture} onAction={onAction} />);

    // nav-reports and audit-open-report carry the same command. Keying the map
    // by COMMAND would have collapsed them, letting a dead audit link hide
    // behind the live nav item.
    const byAffordance = (id: string) =>
      screen.getAllByTestId("dash-action").filter((el) => el.dataset.affordance === id);

    expect(byAffordance("nav-reports")).toHaveLength(2); // sidebar + "open specs →"
    expect(byAffordance("audit-open-report")).toHaveLength(2); // one per audit area

    for (const control of byAffordance("audit-open-report")) {
      onAction.mockClear();
      fireEvent.click(control);
      expect(onAction).toHaveBeenCalledWith("/marvin:reports");
    }
  });

  it("a view with no handler still renders every control without throwing", () => {
    render(<DashboardView data={dashboardFixture} />);
    const controls = screen.getAllByTestId("dash-action");
    expect(controls.length).toBeGreaterThanOrEqual(11);
    expect(() => fireEvent.click(controls[0]!)).not.toThrow();
  });
});

describe("AC9 — the manual recovery line", () => {
  it("reveals the command when the handler reports manual", async () => {
    const onAction = vi.fn().mockResolvedValue("manual" as const);
    render(<DashboardView data={dashboardFixture} onAction={onAction} />);

    expect(screen.queryByTestId("dashboard-manual")).toBeNull();

    const runAudit = screen
      .getAllByTestId("dash-action")
      .find((el) => el.dataset.affordance === "run-audit")!;
    fireEvent.click(runAudit);

    await waitFor(() => expect(screen.getByTestId("dashboard-manual")).toBeTruthy());
    expect(screen.getByTestId("dashboard-manual").textContent).toContain("/marvin:sec-scan");
  });

  it("stays hidden when the command was sent", async () => {
    const onAction = vi.fn().mockResolvedValue("sent" as const);
    render(<DashboardView data={dashboardFixture} onAction={onAction} />);
    fireEvent.click(
      screen.getAllByTestId("dash-action").find((el) => el.dataset.affordance === "run-audit")!,
    );
    await waitFor(() => expect(onAction).toHaveBeenCalled());
    expect(screen.queryByTestId("dashboard-manual")).toBeNull();
  });

  it("acknowledges a clipboard copy instead of looking inert", async () => {
    const onAction = vi.fn().mockResolvedValue("copied" as const);
    render(<DashboardView data={dashboardFixture} onAction={onAction} />);
    fireEvent.click(
      screen.getAllByTestId("dash-action").find((el) => el.dataset.affordance === "run-audit")!,
    );
    await waitFor(() => expect(screen.getByTestId("dashboard-copied")).toBeTruthy());
    // without this the "copied" rung is a button that visibly does nothing while
    // silently overwriting the clipboard
    expect(screen.getByTestId("dashboard-copied").textContent).toContain("/marvin:sec-scan");
    expect(screen.queryByTestId("dashboard-manual")).toBeNull();
  });

  it("shows no line at all when the command was sent", async () => {
    const onAction = vi.fn().mockResolvedValue("sent" as const);
    render(<DashboardView data={dashboardFixture} onAction={onAction} />);
    fireEvent.click(
      screen.getAllByTestId("dash-action").find((el) => el.dataset.affordance === "run-audit")!,
    );
    await waitFor(() => expect(onAction).toHaveBeenCalled());
    // the conversation itself is the feedback
    expect(screen.queryByTestId("dashboard-manual")).toBeNull();
    expect(screen.queryByTestId("dashboard-copied")).toBeNull();
  });

  it("PRE-SELECTS the revealed command, not merely reveals it", async () => {
    // AC9's clause is "reveals that command text pre-selected". Without this
    // assertion, deleting the selection effect leaves the whole suite green —
    // the reveal alone would satisfy every other test here. happy-dom's own
    // Selection is a stub, so spy on it (the ReportsWidget precedent).
    const addRange = vi.fn();
    const removeAllRanges = vi.fn();
    const getSelection = vi
      .spyOn(window, "getSelection")
      .mockReturnValue({ removeAllRanges, addRange } as unknown as Selection);
    try {
      const onAction = vi.fn().mockResolvedValue("manual" as const);
      render(<DashboardView data={dashboardFixture} onAction={onAction} />);
      fireEvent.click(
        screen.getAllByTestId("dash-action").find((el) => el.dataset.affordance === "run-audit")!,
      );
      await waitFor(() => expect(screen.getByTestId("dashboard-manual")).toBeTruthy());
      await waitFor(() => expect(addRange).toHaveBeenCalled());
    } finally {
      getSelection.mockRestore();
    }
  });

  it("announces the outcome line to assistive tech", () => {
    render(
      <DashboardView data={dashboardFixture} onAction={vi.fn().mockResolvedValue("manual")} />,
    );
    fireEvent.click(
      screen.getAllByTestId("dash-action").find((el) => el.dataset.affordance === "run-audit")!,
    );
    return waitFor(() => {
      const line = screen.getByTestId("dashboard-manual");
      // the line can sit ~1400px below the control that produced it
      expect(line.getAttribute("role")).toBe("status");
      expect(line.getAttribute("aria-live")).toBe("polite");
    });
  });

  it("ignores a stale resolution when a second click has already landed", async () => {
    // Overlapping clicks resolve out of order. Without a generation guard the
    // slow first resolution overwrites the fast second one, showing a command
    // the user has moved on from and hijacking the selection to do it.
    //
    // Asserted POSITIVELY — "the line still shows the second command" — not as
    // an absence. An absence assertion passes without the guard: the widget's
    // continuation runs before the test's, Preact defers the patch by another
    // microtask, and waitFor's first synchronous check therefore sees the
    // not-yet-rendered DOM and resolves immediately. Measured, not assumed.
    let releaseSlow: (v: "manual") => void = () => {};
    const slow = new Promise<"manual">((resolve) => {
      releaseSlow = resolve;
    });
    const onAction = vi
      .fn()
      .mockReturnValueOnce(slow)
      .mockReturnValueOnce(Promise.resolve("manual" as const));

    render(<DashboardView data={dashboardFixture} onAction={onAction} />);
    const controls = screen.getAllByTestId("dash-action");
    fireEvent.click(controls.find((el) => el.dataset.affordance === "run-audit")!); // slow
    fireEvent.click(controls.find((el) => el.dataset.affordance === "new-task")!); // fast
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(2));

    // the fast (second) click's line lands first
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-manual").textContent).toContain("/marvin:track-new"),
    );

    releaseSlow("manual");
    await slow;
    await new Promise((r) => setTimeout(r, 0)); // let any stale patch flush

    // …and the slow first click must NOT overwrite it
    const line = screen.getByTestId("dashboard-manual").textContent ?? "";
    expect(line).toContain("/marvin:track-new");
    expect(line).not.toContain("/marvin:sec-scan");
  });
});

describe("AC9 — the wiring layers bind runChatAction", () => {
  it("a control clicked on the seam-wired widget reaches the host as ui/message", async () => {
    // The AC9 tests above inject their own handler, so they prove the VIEW.
    // Nothing proved that either wiring component actually passes `onAction` —
    // deleting both bindings left the suite green. This closes that: it drives
    // the real widget through the mock host and asserts the message arrives.
    const host = createMockHost(dashboardFixture);
    await host.start();
    try {
      const sendMessage = vi
        .spyOn(host.seam.app, "sendMessage")
        .mockResolvedValue({} as Awaited<ReturnType<typeof host.seam.app.sendMessage>>);

      render(<DashboardWidget seam={host.seam} />);
      await screen.findByTestId("dashboard-header", {}, { timeout: 5000 });

      fireEvent.click(
        screen.getAllByTestId("dash-action").find((el) => el.dataset.affordance === "nav-tasks")!,
      );

      await waitFor(() =>
        expect(sendMessage).toHaveBeenCalledWith({
          role: "user",
          content: [{ type: "text", text: "/marvin:track-list" }],
        }),
      );
    } finally {
      host.close();
    }
  });
});

describe("DashboardWidget — mock-host handshake", () => {
  it("mock-host handshake delivers a DashboardState the widget renders", async () => {
    const host = createMockHost(dashboardFixture);
    await host.start();
    try {
      render(<DashboardWidget seam={host.seam} />);

      // starts connecting, then the pushed tool-result's dashboard renders
      const header = await screen.findByTestId("dashboard-header", {}, { timeout: 5000 });
      expect(header.textContent).toContain("acme-api");
      expect(screen.queryByTestId("dashboard-connecting")).toBeNull();
      // a section from the delivered payload reached the view
      expect(screen.getByTestId("card-usage").textContent).toContain("128");
      expect(screen.getByTestId("zone-work")).toBeTruthy();
    } finally {
      host.close();
    }
  });
});
