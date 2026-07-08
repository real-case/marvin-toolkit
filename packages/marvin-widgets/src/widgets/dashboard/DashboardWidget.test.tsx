import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/preact";
import type { DashboardState } from "@marvin-toolkit/mcp-shared/contracts";
import { DashboardView, DashboardWidget } from "./DashboardWidget";
import { dashboardFixture } from "./fixture";
import { createMockHost } from "../../lib/mock-host";

describe("DashboardView — panel over the full fixture", () => {
  it("renders every section from a full DashboardState", () => {
    render(<DashboardView data={dashboardFixture} />);

    // header: title + version + git/gh availability + branch
    const header = screen.getByTestId("dashboard-header");
    expect(header.textContent).toContain("toolbox dashboard");
    expect(screen.getByTestId("dashboard-version").textContent).toContain("v0.1.0");
    expect(header.textContent).toContain("git ✓");
    expect(header.textContent).toContain("gh ✓");
    expect(screen.getByTestId("dashboard-branch").textContent).toContain("feat/widget-dashboard");

    // paths: the three project paths as code
    expect(screen.getByTestId("card-paths").textContent).toContain("/Users/dev/acme-api");

    // config: base branch, the resolved tracker template, gate chips, the statuses vocabulary
    const config = screen.getByTestId("card-config");
    expect(config.textContent).toContain("main");
    const tracker = within(config).getByTestId("config-tracker");
    expect(tracker.textContent).toContain("linear.app");
    expect(tracker.textContent).not.toContain("not configured");
    const gates = within(config).getByTestId("config-gates");
    for (const g of ["test", "lint", "typecheck", "build"]) expect(gates.textContent).toContain(g);
    const statuses = within(config).getByTestId("config-statuses");
    expect(statuses.textContent).toContain("backlog");
    expect(statuses.textContent).toContain("in-review · review"); // key ≠ role gets the role note

    // kanban: role roll-up + one row per configured status, count from the right field
    const kanban = screen.getByTestId("card-kanban");
    expect(kanban.textContent).toContain("Kanban (15)"); // total across statuses
    expect(within(kanban).getByTestId("kanban-roles").textContent).toContain("done 7");
    const statusRows = within(kanban).getAllByTestId("kanban-status");
    expect(statusRows).toHaveLength(5);
    const doneRow = statusRows.find((r) => r.getAttribute("data-status") === "done");
    expect(doneRow?.textContent).toContain("7");

    // artifacts: stat tiles + verification freshness rendered human-friendly
    const artifacts = screen.getByTestId("card-artifacts");
    expect(within(artifacts).getByTestId("artifacts-specs").textContent).toContain("3");
    expect(within(artifacts).getByTestId("artifacts-verification").textContent).toContain("2d ago");

    // adr: total + per-status counts + the malformed note
    const adr = screen.getByTestId("card-adr");
    expect(adr.textContent).toContain("ADR (30)");
    expect(adr.textContent).toContain("accepted 24");
    expect(within(adr).getByTestId("adr-malformed").textContent).toContain("1 malformed");

    // security + refactor inventories — assert the values (not just labels), so a
    // field-swap regression is caught, plus the human-friendly age
    const security = screen.getByTestId("card-security");
    expect(within(security).getByTestId("security-reports").textContent).toContain("1");
    expect(within(security).getByTestId("security-newest").textContent).toContain("6d ago");
    const refactor = screen.getByTestId("card-refactor");
    expect(within(refactor).getByTestId("refactor-audits").textContent).toContain("2");
    expect(within(refactor).getByTestId("refactor-smells").textContent).toContain("1");
    expect(within(refactor).getByTestId("refactor-plans").textContent).toContain("1");

    // lessons: total + by-type breakdown
    const lessons = screen.getByTestId("card-lessons");
    expect(lessons.textContent).toContain("Lessons (5)");
    expect(lessons.textContent).toContain("bug-pattern 2");

    // usage: event count + window + top prompts/tools
    const usage = screen.getByTestId("card-usage");
    expect(usage.textContent).toContain("Usage (128)");
    expect(within(usage).getByTestId("usage-window").textContent).toContain(
      "2026-06-01 → 2026-07-07",
    );
    const top = within(usage).getAllByTestId("usage-top");
    expect(top).toHaveLength(3);
    expect(top[0].textContent).toContain("commit");

    // commands: group tallies + the total in the title
    const commands = screen.getByTestId("card-commands");
    expect(commands.textContent).toContain("Commands (40)"); // 9+4+5+10+12
    expect(commands.textContent).toContain("sec 10");
  });
});

describe("DashboardView — fresh-project and narrow (help-shaped) states", () => {
  // The dashboard tool's REAL fresh-project payload: the extended sections are PRESENT
  // but zeroed, ages/branch/tracker are null, and usage is absent (no log yet).
  const fresh: DashboardState = {
    version: "0.1.0",
    paths: {
      project: "/tmp/new",
      tasks_dir: "/tmp/new/.marvin/kanban",
      config_path: "/tmp/new/.marvin/config.json",
    },
    config: {
      base_branch: "main",
      tracker_url_template: null,
      statuses: [
        { key: "todo", role: "todo" },
        { key: "doing", role: "wip" },
        { key: "done", role: "done" },
      ],
    },
    kanban_counts: { todo: 0, doing: 0, done: 0 },
    kanban_role_counts: { todo: 0, wip: 0, review: 0, done: 0, blocked: 0 },
    git: { has_git: false, has_gh: false, branch: null },
    artifacts: {
      specs: 0,
      handoffs: 0,
      audits: 0,
      lessons: 0,
      verification: { exists: false, age_days: null },
    },
    command_groups: [
      { group: "core", count: 9 },
      { group: "kanban", count: 12 },
    ],
    adr: {
      dir: "docs/adr",
      total: 0,
      counts: { proposed: 0, accepted: 0, deprecated: 0, superseded: 0, rejected: 0 },
      malformed: 0,
    },
    security: { reports: 0, newest_age_days: null },
    refactor: { audits: 0, smells: 0, plans: 0 },
    lessons: { total: 0, by_type: {}, by_tag: {} },
    // usage intentionally absent — the tool spreads it only when the log exists
  };

  it("renders neutral zero-states on a fresh project", () => {
    const { rerender } = render(<DashboardView data={fresh} />);

    // the panel renders (no throw on null ages / absent usage)
    expect(screen.getByTestId("dashboard-panel")).toBeTruthy();

    // git unavailable → ✗ badges and the neutral branch note
    expect(screen.getByTestId("dashboard-branch").textContent).toContain("not in a git repo");
    expect(screen.getByTestId("dashboard-header").textContent).toContain("git ✗");

    // config neutral placeholders
    expect(screen.getByTestId("config-tracker").textContent).toContain("not configured");
    expect(screen.getByTestId("config-gates").textContent).toContain("defaults");

    // artifacts: a present-but-not-existing verification → "none" (null age never dereferenced)
    expect(screen.getByTestId("artifacts-verification").textContent).toContain("none");

    // present-but-zeroed extended sections DO render a card, with a neutral zero-state …
    expect(screen.getByTestId("card-adr").textContent).toContain("No records yet");
    expect(screen.queryByTestId("adr-malformed")).toBeNull(); // 0 malformed → no note
    expect(screen.getByTestId("security-newest").textContent).toContain("none"); // formatAge(null)
    expect(screen.getByTestId("card-lessons").textContent).toContain("No lessons captured yet");

    // … but `usage` is ABSENT here, so its card is omitted entirely (present ≠ absent)
    expect(screen.queryByTestId("card-usage")).toBeNull();

    // A narrower, help-shaped payload omits the extended sections entirely — every
    // extended card disappears, while the always-present cards stay.
    const narrow: DashboardState = {
      version: fresh.version,
      paths: fresh.paths,
      config: fresh.config,
      kanban_counts: fresh.kanban_counts,
      kanban_role_counts: fresh.kanban_role_counts,
      git: fresh.git,
      artifacts: { specs: 0, handoffs: 0, audits: 0, lessons: 0 }, // no verification either
      command_groups: fresh.command_groups,
      // adr / security / refactor / lessons / usage all absent
    };
    rerender(<DashboardView data={narrow} />);
    for (const id of ["card-adr", "card-security", "card-refactor", "card-lessons", "card-usage"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    // the always-present cards survive, and an absent verification renders as "—"
    expect(screen.getByTestId("card-kanban")).toBeTruthy();
    expect(screen.getByTestId("card-commands")).toBeTruthy();
    expect(screen.getByTestId("artifacts-verification").textContent).toContain("—");

    // connecting / no-data / error states
    rerender(<DashboardView data={null} />);
    expect(screen.getByTestId("dashboard-connecting").textContent).toContain("Connecting");
    rerender(<DashboardView data={null} connecting={false} />);
    expect(screen.getByTestId("dashboard-connecting").textContent).toContain("No dashboard data");
    rerender(<DashboardView data={null} error="boom" />);
    expect(screen.getByTestId("dashboard-error").textContent).toContain("boom");
    expect(screen.queryByTestId("dashboard-panel")).toBeNull();
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
      expect(header.textContent).toContain("toolbox dashboard");
      expect(screen.queryByTestId("dashboard-connecting")).toBeNull();
      // a section from the delivered payload reached the view
      expect(screen.getByTestId("card-usage").textContent).toContain("Usage (128)");
    } finally {
      host.close();
    }
  });
});
