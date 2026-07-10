import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/preact";
// Value import (the zod schema, not just the type) — allowed in tests only,
// where the built mcp-shared dist is available; fixtures/stories stay type-only.
import { AuditListPayload } from "@marvin-toolkit/mcp-shared/contracts";
import { AuditListView, AuditWidget } from "./AuditWidget";
import {
  auditListFixture,
  cleanAuditFixture,
  emptyAuditFixture,
  longEvidenceFixture,
  minimalFindingFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";

describe("audit fixtures — contract conformance", () => {
  it("every fixture parses under the AuditListPayload zod contract", () => {
    const fixtures = {
      auditListFixture,
      emptyAuditFixture,
      cleanAuditFixture,
      minimalFindingFixture,
      longEvidenceFixture,
    };
    for (const [name, fixture] of Object.entries(fixtures)) {
      const parsed = AuditListPayload.safeParse(fixture);
      expect(parsed.success, `${name}: ${parsed.success ? "ok" : parsed.error.message}`).toBe(true);
    }
  });
});

describe("AuditListView — severity triage over the fixture", () => {
  it("flattens and sorts findings critical-first, and the severity filter narrows the list", () => {
    render(<AuditListView data={auditListFixture} />);

    // header counts every finding across all three reports
    expect(screen.getByTestId("audit-counts").textContent).toContain("6 findings");

    // master list is flattened + sorted critical → high → medium → low → info; the
    // two highs tie-break by report scanned_at desc (SCAN-1 07-05 before DEP-2 07-04),
    // which is only provable because the fixture scrambles severities across reports
    const order = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(order).toHaveLength(6);
    expect(order[0]).toContain("AWS secret key committed to the repo"); // critical
    expect(order[1]).toContain("SQL injection in the login handler"); // high, 07-05
    expect(order[2]).toContain("minimist ReDoS reachable through a transitive dep"); // high, 07-04
    expect(order[3]).toContain("lodash 4.17.15 has a prototype-pollution CVE"); // medium
    expect(order[4]).toContain("Session cookie missing SameSite"); // low
    expect(order[5]).toContain("Unused dependency left-pad"); // info

    // filter to just the highs — the two high findings, nothing else, and the
    // active chip flips to aria-pressed while "All" releases
    const filter = screen.getByTestId("severity-filter");
    fireEvent.click(within(filter).getByRole("button", { name: /^high/i }));
    const highs = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(highs).toHaveLength(2);
    expect(highs.every((t) => /SQL injection|minimist/.test(t))).toBe(true);
    expect(screen.queryByRole("option", { name: /AWS secret key/ })).toBeNull();
    expect(
      within(filter).getByRole("button", { name: /^high/i }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(within(filter).getByRole("button", { name: /^All/ }).getAttribute("aria-pressed")).toBe(
      "false",
    );

    // "All" restores the full list
    fireEvent.click(within(filter).getByRole("button", { name: /^All/ }));
    expect(screen.getAllByRole("option")).toHaveLength(6);
  });

  it("finding detail renders evidence and remediation as markdown and links as buttons", () => {
    const onOpenLink = vi.fn();
    render(<AuditListView data={auditListFixture} onOpenLink={onOpenLink} />);

    // select the critical AWS-secret finding (deterministic regardless of sort)
    fireEvent.click(screen.getByRole("option", { name: /AWS secret key committed/ }));

    const pane = screen.getByTestId("list-detail-pane");
    expect(within(pane).getByTestId("detail-title").textContent).toContain(
      "AWS secret key committed to the repo",
    );
    expect(pane.textContent).toContain("CWE-798"); // category
    expect(pane.textContent).toContain(".env.example:3"); // location file:line
    expect(pane.textContent).toContain("secrets"); // scanner kind
    expect(pane.textContent).toContain("2026-07-06"); // scanned_at via formatDate…
    expect(pane.textContent).not.toContain("14:30"); // …date only, time dropped

    // evidence renders through <Markdown> as a real fenced code block, not text
    const evidence = within(pane).getByTestId("finding-evidence");
    expect(within(evidence).getByTestId("markdown").querySelector("pre code")).toBeTruthy();
    expect(evidence.textContent).not.toContain("```"); // fence markers gone

    // remediation renders bold + inline code as elements
    const remediation = within(pane).getByTestId("finding-remediation");
    const remMd = within(remediation).getByTestId("markdown");
    expect(remMd.querySelector("strong")).toBeTruthy(); // **Rotate**
    expect(remMd.querySelector("code")).toBeTruthy(); // `git filter-repo`
    expect(remediation.textContent).not.toContain("**"); // markers gone

    // links: an external one (↗) and an internal ADR ref; clicking the external
    // one dispatches through the injected onOpenLink with the link url
    const external = within(pane).getByRole("button", { name: /CWE-798/ });
    expect(external.textContent).toContain("↗");
    expect(within(pane).getByRole("button", { name: /ADR-0002/ })).toBeTruthy();
    fireEvent.click(external);
    expect(onOpenLink).toHaveBeenCalledTimes(1);
    expect(onOpenLink).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://cwe.mitre.org/data/definitions/798.html" }),
    );
  });

  it("a required-fields-only finding renders just Category/Scanner/Scanned, nothing optional", () => {
    render(<AuditListView data={minimalFindingFixture} />);

    // the single finding starts selected; its detail carries the three fixed rows
    const pane = screen.getByTestId("list-detail-pane");
    expect(within(pane).getByTestId("detail-title").textContent).toContain("world-readable");
    const labels = Array.from(pane.querySelectorAll("dt")).map((dt) => dt.textContent);
    expect(labels).toEqual(["Category", "Scanner", "Scanned"]); // no Target/Location rows
    expect(pane.textContent).toContain("STRIDE — Information Disclosure");
    expect(pane.textContent).toContain("threat-model");
    expect(pane.textContent).toContain("2026-07-03");

    // and none of the optional blocks: sections, link buttons
    expect(within(pane).queryByTestId("finding-evidence")).toBeNull();
    expect(within(pane).queryByTestId("finding-remediation")).toBeNull();
    expect(within(pane).queryByRole("button")).toBeNull();
  });

  it("markdown-heavy evidence and remediation render fences, lists and a table as elements", () => {
    render(<AuditListView data={longEvidenceFixture} />);

    const evidence = within(screen.getByTestId("list-detail-pane")).getByTestId("finding-evidence");
    const evidenceMd = within(evidence).getByTestId("markdown");
    expect(evidenceMd.querySelector("pre code")).toBeTruthy(); // fenced repro snippet
    expect(evidenceMd.querySelector("ol")).toBeTruthy(); // the numbered repro steps
    expect(evidenceMd.querySelector("table")).toBeTruthy(); // the responses table
    expect(evidence.textContent).not.toContain("| --- |"); // delimiter row consumed

    const remediation = screen.getByTestId("finding-remediation");
    const remediationMd = within(remediation).getByTestId("markdown");
    expect(remediationMd.querySelector("ul")).toBeTruthy(); // the bullet checklist
    expect(remediationMd.querySelector("pre code")).toBeTruthy(); // the fixed query
  });

  it("renders the degraded empty state with no reports and the all-clear state with zero findings", () => {
    const { rerender } = render(<AuditListView data={{ reports: [] }} />);

    const empty = screen.getByTestId("audit-empty");
    expect(empty.textContent).toMatch(/No audit reports yet/);
    expect(empty.textContent).toMatch(/sec-/); // prompts a sec-* scan
    expect(screen.queryByTestId("audit-counts")).toBeNull();

    // reports present but zero findings → the positive all-clear state
    const clearPayload: AuditListPayload = {
      reports: [
        {
          kind: "scan",
          scanned_at: "2026-07-06T10:00:00.000Z",
          target: "acme-api",
          summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          findings: [],
        },
      ],
    };
    rerender(<AuditListView data={clearPayload} />);
    const clear = screen.getByTestId("audit-clear");
    expect(clear.textContent).toMatch(/all clear/i);
    expect(clear.textContent).toContain("1 report");
    expect(screen.queryByTestId("audit-empty")).toBeNull();

    // the shared clean fixture (two reports) pluralizes the count
    rerender(<AuditListView data={cleanAuditFixture} />);
    expect(screen.getByTestId("audit-clear").textContent).toContain("2 reports");

    // and the shared empty fixture reaches the same degraded state as the inline one
    rerender(<AuditListView data={emptyAuditFixture} />);
    expect(screen.getByTestId("audit-empty")).toBeTruthy();
  });
});

describe("AuditWidget — mock-host handshake", () => {
  it("mock-host handshake delivers an AuditListPayload the widget renders", async () => {
    const host = createMockHost(auditListFixture);
    await host.start();
    try {
      render(<AuditWidget seam={host.seam} />);

      // starts connecting, then the pushed tool-result's findings render
      const counts = await screen.findByTestId("audit-counts", {}, { timeout: 5000 });
      expect(counts.textContent).toContain("6 findings");
      expect(screen.queryByTestId("audit-connecting")).toBeNull();
      // a finding from the payload reached the view (the top-sorted critical one)
      expect(screen.getByTestId("detail-title").textContent).toContain("AWS secret key");
    } finally {
      host.close();
    }
  });
});
