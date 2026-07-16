import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
// Value import (the zod schema, not just the type) — allowed in tests only,
// where the built mcp-shared dist is available; fixtures/stories stay type-only.
import { ReportListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { ReportsView, ReportsWidget } from "./ReportsWidget";
import { TOKENS } from "../../theme";
import {
  REPORTS_NOW,
  cleanReportsFixture,
  deepLinkReportsFixture,
  emptyReportsFixture,
  gatesFailedFixture,
  reportsFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";

/** Stub the async clipboard and return its writeText spy. */
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

const renderFixture = (data = reportsFixture, onOpenLink?: (l: unknown) => void) =>
  render(<ReportsView data={data} now={REPORTS_NOW} onOpenLink={onOpenLink as never} />);

describe("reports fixtures — contract conformance", () => {
  it("every fixture parses under the ReportListPayload zod contract", () => {
    const fixtures = {
      reportsFixture,
      deepLinkReportsFixture,
      emptyReportsFixture,
      cleanReportsFixture,
      gatesFailedFixture,
    };
    for (const [name, fixture] of Object.entries(fixtures)) {
      const parsed = ReportListPayload.safeParse(fixture);
      expect(parsed.success, `${name}: ${parsed.success ? "ok" : parsed.error.message}`).toBe(true);
    }
  });
});

describe("ReportsView — header, KPIs and list over the fixture", () => {
  it("renders the count, all rows newest-first, deterministic ages and the KPI strip", () => {
    renderFixture();

    expect(screen.getByTestId("reports-count").textContent).toBe("8");

    const rows = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(rows).toHaveLength(8);
    expect(rows[0]).toContain("Verification");
    expect(rows[0]).toContain("task · task-verify · 5h");
    expect(rows[1]).toContain("Security scan");
    expect(rows[6]).toContain("Dependency audit");
    expect(rows[6]).toContain("· stale"); // amber stale suffix on the row meta

    // Status pills: worst severity / pass / n-m progress / document tag.
    expect(rows[0]).toContain("pass");
    expect(rows[1]).toContain("critical");
    expect(rows[4]).toContain("2/6");
    expect(rows[5]).toContain("spec");

    // KPI strip — summary-derived numbers, not visible-row counts.
    expect(screen.getByTestId("kpi-open").textContent).toContain("43");
    expect(screen.getByTestId("kpi-spark")).toBeTruthy();
    const critical = screen.getByTestId("kpi-critical");
    expect(critical.textContent).toContain("3");
    expect(critical.textContent).toContain("2 scan · 1 deps");
    const gates = screen.getByTestId("kpi-gates");
    expect(gates.textContent).toContain("Pass");
    expect(gates.textContent).toContain("4/4 · 5h ago");
    const stale = screen.getByTestId("kpi-stale");
    expect(stale.textContent).toContain("1");
    expect(stale.textContent).toContain("oldest 9d · deps");
  });

  it("group segments and the search input narrow the list (case-insensitively)", async () => {
    renderFixture();

    const groupFilter = screen.getByTestId("group-filter");
    fireEvent.click(within(groupFilter).getByRole("button", { name: /^Refactor/ }));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(
      within(groupFilter)
        .getByRole("button", { name: /^Refactor/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(within(groupFilter).getByRole("button", { name: /^All/ }));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(8));

    const search = screen.getByTestId("reports-search") as HTMLInputElement;
    fireEvent.input(search, { target: { value: "PLAN" } }); // title, case-insensitive
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    expect(screen.getByRole("option", { name: /Plan: storage split/ })).toBeTruthy();

    fireEvent.input(search, { target: { value: "security" } }); // group + path
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));

    fireEvent.input(search, { target: { value: "no-such-report" } });
    await waitFor(() =>
      expect(screen.getByTestId("list-detail-empty").textContent).toContain(
        "No reports match the current filters.",
      ),
    );
  });
});

describe("ReportsView — detail envelope and the three bodies", () => {
  it("findings: envelope meta, severity chips, disclosure rows, truncation note", async () => {
    const onOpenLink = vi.fn();
    renderFixture(reportsFixture, onOpenLink);

    fireEvent.click(screen.getByRole("option", { name: /Security scan/ }));
    await waitFor(() =>
      expect(screen.getByTestId("detail-title").textContent).toBe("Security scan"),
    );

    // Envelope meta: path chip · producing command · age.
    const pane = screen.getByTestId("list-detail-pane");
    expect(pane.textContent).toContain(".marvin/security/scan-report.md");
    expect(pane.textContent).toContain("/marvin:sec-scan");
    expect(pane.textContent).toContain("· 2d ago");

    // Severity chips reflect the visible findings; truncation note the file total.
    const filter = screen.getByTestId("severity-filter");
    expect(within(filter).getByRole("button", { name: /^All/ }).textContent).toContain("6");
    expect(screen.getByTestId("truncated-note").textContent).toBe("+ 13 more in the report file");

    // Filter to high: 3 rows remain, the note hides, the chip reads pressed.
    fireEvent.click(within(filter).getByRole("button", { name: /^high/ }));
    await waitFor(() => expect(pane.querySelectorAll("button[aria-expanded]")).toHaveLength(3));
    expect(screen.queryByTestId("truncated-note")).toBeNull();
    expect(within(filter).getByRole("button", { name: /^high/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(within(filter).getByRole("button", { name: /^All/ }));
    await waitFor(() => expect(pane.querySelectorAll("button[aria-expanded]")).toHaveLength(6));

    // Expand F1: evidence block, external link with the ext icon, location button.
    const head = screen.getByRole("button", { name: /Command injection in exec wrapper/ });
    expect(head.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(head);
    await waitFor(() => expect(head.getAttribute("aria-expanded")).toBe("true"));
    expect(screen.getByTestId("finding-evidence").textContent).toContain(
      "reaches the shell unescaped",
    );
    const external = within(pane).getByRole("button", { name: /CWE-78/ });
    expect(external.querySelector("svg")).toBeTruthy(); // the ↗ glyph
    fireEvent.click(external);
    expect(onOpenLink).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://cwe.mitre.org/data/definitions/78.html" }),
    );
    // Exact name: the disclosure header also CONTAINS the location chip text.
    expect(within(pane).getByRole("button", { name: "lib/exec.ts:42" })).toBeTruthy();
  });

  it("refactor findings carry direction, effort and a copyable fix chip; Re-run copies too", async () => {
    const writeText = stubClipboard();
    renderFixture();

    fireEvent.click(screen.getByRole("option", { name: /Smells: api layer/ }));
    await waitFor(() =>
      expect(screen.getByTestId("detail-title").textContent).toBe("Smells: api layer"),
    );

    fireEvent.click(screen.getByRole("button", { name: /God module: server\.ts/ }));
    const direction = await screen.findByTestId("finding-direction");
    expect(direction.textContent).toContain("extract registry/ and io/ modules");
    expect(direction.textContent).toContain("effort L");

    // Re-run in the detail header copies the envelope's rerunCommand.
    fireEvent.click(screen.getByTestId("detail-rerun"));
    expect(writeText).toHaveBeenCalledWith("/marvin:refactor-smells");
    await screen.findByText("Copied");

    // A security finding's fix chip copies its fixCommand.
    fireEvent.click(screen.getByRole("option", { name: /Security scan/ }));
    await waitFor(() =>
      expect(screen.getByTestId("detail-title").textContent).toBe("Security scan"),
    );
    fireEvent.click(screen.getByRole("button", { name: /Command injection/ }));
    fireEvent.click(await screen.findByTestId("finding-fix"));
    expect(writeText).toHaveBeenCalledWith("/marvin:sec-fix scan F1");
  });

  it("checks: the d/t roll-up, notes and per-status icon squares; document: markdown", async () => {
    renderFixture();

    // Verification is the first row — selected on mount.
    const checks = screen.getByTestId("checks-body");
    expect(checks.textContent).toContain("4/4");
    expect(checks.textContent).toContain("all green");
    expect(checks.textContent).toContain("186 passed · 41s");

    // The refactor plan renders progress (2/6) with pending rows.
    fireEvent.click(screen.getByRole("option", { name: /Plan: storage split/ }));
    await waitFor(() => expect(screen.getByTestId("checks-body").textContent).toContain("2/6"));
    expect(screen.getByTestId("checks-body").textContent).toContain("in progress");

    // Documents render through <Markdown>, constrained to the 34rem measure.
    fireEvent.click(screen.getByRole("option", { name: /Spec: widget family/ }));
    const doc = await screen.findByTestId("document-body");
    const md = within(doc).getByTestId("markdown");
    expect(md.querySelector("h2")?.textContent).toBe("Goal");
    expect(md.querySelectorAll("li").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByTestId("detail-rerun")).toBeNull(); // specs are not re-run

    // Design-contract typography (§F): the document body is scoped by
    // .mvrep-doc, whose injected rules turn headings into microlabels and set
    // 12.5px/1.6 secondary-text paragraphs and 1.7 lists.
    expect(doc.classList.contains("mvrep-doc")).toBe(true);
    const css = document.getElementById("mv-reports-styles")?.textContent ?? "";
    const rule = (selector: string) =>
      css
        .split("\n")
        .find((line) => line.startsWith(selector))
        ?.match(/\{([^}]*)\}/)?.[1];
    const headings = rule(".mvrep-doc h1");
    expect(headings).toContain("font-size:10.5px");
    expect(headings).toContain("font-weight:500");
    expect(headings).toContain("text-transform:uppercase");
    expect(headings).toContain(`color:${TOKENS.t3}`);
    const paragraphs = rule(".mvrep-doc p");
    expect(paragraphs).toContain("font-size:12.5px");
    expect(paragraphs).toContain("line-height:1.6");
    expect(paragraphs).toContain(`color:${TOKENS.t2}`);
    const lists = rule(".mvrep-doc ul");
    expect(lists).toContain("font-size:12.5px");
    expect(lists).toContain("line-height:1.7");
    expect(lists).toContain(`color:${TOKENS.t2}`);
  });

  it("gates-failed payload: fail pill in the envelope, red rows with failure notes", () => {
    renderFixture(gatesFailedFixture);
    const pane = screen.getByTestId("list-detail-pane");
    expect(pane.textContent).toContain("fail");
    const checks = screen.getByTestId("checks-body");
    expect(checks.textContent).toContain("2/4");
    expect(checks.textContent).toContain("7 errors");
    expect(checks.textContent).toContain("dist drift");
    expect(screen.getByTestId("kpi-gates").textContent).toContain("Fail");
  });
});

describe("ReportsView — deep-link and KPI interactions", () => {
  it("payload.selected pre-selects its report row", async () => {
    renderFixture(deepLinkReportsFixture);
    await waitFor(() =>
      expect(screen.getByTestId("detail-title").textContent).toBe("Spec: widget family"),
    );
    expect(
      screen.getByRole("option", { name: /Spec: widget family/ }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("critical card filters to critical, gates card selects verification, stale card the oldest stale", async () => {
    renderFixture();

    // Critical: jumps to the newest critical-carrying report with the filter on.
    fireEvent.click(screen.getByTestId("kpi-critical"));
    await waitFor(() =>
      expect(screen.getByTestId("detail-title").textContent).toBe("Security scan"),
    );
    const filter = screen.getByTestId("severity-filter");
    expect(
      within(filter)
        .getByRole("button", { name: /^critical/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByTestId("kpi-critical").getAttribute("aria-pressed")).toBe("true");
    expect(
      within(screen.getByTestId("group-filter"))
        .getByRole("button", { name: /^Security/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    // Gates: selects the verification report (outside the security group → All).
    fireEvent.click(screen.getByTestId("kpi-gates"));
    await waitFor(() =>
      expect(screen.getByTestId("detail-title").textContent).toBe("Verification"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("kpi-gates").getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByTestId("kpi-critical").getAttribute("aria-pressed")).toBe("false");

    // Stale: selects the oldest stale report.
    fireEvent.click(screen.getByTestId("kpi-stale"));
    await waitFor(() =>
      expect(screen.getByTestId("detail-title").textContent).toBe("Dependency audit"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("kpi-stale").getAttribute("aria-pressed")).toBe("true"),
    );

    // Open findings: a reset — back to All, never engaged.
    fireEvent.click(screen.getByTestId("kpi-open"));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("group-filter"))
          .getByRole("button", { name: /^All/ })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    expect(screen.getByTestId("kpi-open").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("ReportsView — copy chips when the clipboard is denied", () => {
  /**
   * Mask happy-dom's clipboard and stub execCommand to refuse — the sandboxed
   * MCP Apps host that grants neither path. Selection is proven through a spied
   * getSelection (happy-dom's own Selection is a stub).
   */
  const denyClipboard = () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    (document as unknown as Record<string, unknown>).execCommand = vi.fn(() => false);
    const removeAllRanges = vi.fn();
    const addRange = vi.fn();
    const getSelection = vi
      .spyOn(window, "getSelection")
      .mockReturnValue({ removeAllRanges, addRange } as unknown as Selection);
    return {
      addRange,
      restore: () => {
        getSelection.mockRestore();
        delete (navigator as unknown as Record<string, unknown>).clipboard;
        delete (document as unknown as Record<string, unknown>).execCommand;
      },
    };
  };

  it("Re-run never claims Copied; it reveals the command pre-selected instead", async () => {
    const deny = denyClipboard();
    try {
      renderFixture();
      fireEvent.click(screen.getByRole("option", { name: /Smells: api layer/ }));
      await waitFor(() =>
        expect(screen.getByTestId("detail-title").textContent).toBe("Smells: api layer"),
      );
      const chip = screen.getByTestId("detail-rerun");
      fireEvent.click(chip);
      // Select-on-click fallback: the raw command replaces the label…
      await waitFor(() => expect(chip.textContent).toContain("/marvin:refactor-smells"));
      expect(chip.textContent).not.toContain("Copied"); // no false success claim
      // …and its text is selected so a manual copy lands in one gesture.
      expect(deny.addRange).toHaveBeenCalledTimes(1);
      const range = deny.addRange.mock.calls[0][0] as Range;
      expect(
        range.commonAncestorContainer === chip || chip.contains(range.commonAncestorContainer),
      ).toBe(true);
    } finally {
      deny.restore();
    }
  });

  it("the empty-state CTA falls back the same way", async () => {
    const deny = denyClipboard();
    try {
      renderFixture(emptyReportsFixture);
      const cta = screen.getByTestId("reports-empty-cta");
      fireEvent.click(cta);
      await waitFor(() => expect(cta.textContent).toContain("/marvin:sec-scan"));
      expect(cta.textContent).not.toContain("Copied");
      expect(deny.addRange).toHaveBeenCalledTimes(1);
    } finally {
      deny.restore();
    }
  });
});

describe("ReportsView — states", () => {
  it("degraded empty offers the first-scan CTA as a copy chip", async () => {
    const writeText = stubClipboard();
    renderFixture(emptyReportsFixture);
    const empty = screen.getByTestId("reports-empty");
    expect(empty.textContent).toContain("No reports yet");
    fireEvent.click(screen.getByTestId("reports-empty-cta"));
    expect(writeText).toHaveBeenCalledWith("/marvin:sec-scan");
    await screen.findByText("Copied /marvin:sec-scan");
  });

  it("a clean findings report renders the all-clear state (and a clean row pill)", () => {
    renderFixture(cleanReportsFixture);
    expect(screen.getByRole("option", { name: /Secrets scan/ }).textContent).toContain("clean");
    const clean = screen.getByTestId("report-clean");
    expect(clean.textContent).toContain("All clear");
    expect(clean.textContent).toContain("Secrets scan · no findings · 2h ago");
  });

  it("connecting renders a wordless skeleton; errors render the red one-liner", () => {
    const { rerender } = render(<ReportsView data={null} connecting />);
    const skeleton = screen.getByTestId("reports-connecting");
    expect(skeleton.textContent).toBe("");
    expect(skeleton.querySelectorAll("div")).toHaveLength(4);

    rerender(<ReportsView data={null} error="kaboom: transport dropped" />);
    expect(screen.getByTestId("reports-error").textContent).toContain("kaboom: transport dropped");

    rerender(<ReportsView data={null} connecting={false} />);
    expect(screen.getByTestId("reports-nodata").textContent).toBe("No data.");
  });
});

describe("ReportsWidget — mock-host handshake", () => {
  beforeEach(() => {
    stubClipboard();
  });

  it("the handshake delivers a ReportListPayload the widget renders", async () => {
    const host = createMockHost(reportsFixture);
    await host.start();
    try {
      render(<ReportsWidget seam={host.seam} />);
      await screen.findByTestId("reports-kpis", {}, { timeout: 5000 });
      expect(screen.getByTestId("reports-count").textContent).toBe("8");
      expect(screen.getAllByRole("option")).toHaveLength(8);
      expect(screen.queryByTestId("reports-connecting")).toBeNull();
      expect(screen.getByTestId("detail-title").textContent).toBe("Verification");
    } finally {
      host.close();
    }
  });
});
