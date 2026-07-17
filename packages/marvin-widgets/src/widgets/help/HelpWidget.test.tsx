import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/preact";
// Runtime zod import — the contract schema doubles as the HelpState type; tests
// are the one place the widget workspace may import the schema at runtime.
import { HelpState } from "@marvin-toolkit/mcp-shared/contracts";
import { HelpView, HelpWidget, groupTitle } from "./HelpWidget";
import {
  helpFixture,
  noServersHelpFixture,
  noStatusesHelpFixture,
  noGitHelpFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";

describe("fixtures — HelpState contract", () => {
  // Every fixture the stories render must parse against the real zod contract,
  // so a contract change can never silently drift the visual fixtures.
  const fixtures = {
    helpFixture,
    noServersHelpFixture,
    noStatusesHelpFixture,
    noGitHelpFixture,
  };
  for (const [name, fixture] of Object.entries(fixtures)) {
    it(`${name} parses against the HelpState contract`, () => {
      const parsed = HelpState.safeParse(fixture);
      expect(parsed.success ? true : parsed.error.issues).toBe(true);
    });
  }
});

describe("HelpView — panel over the full fixture", () => {
  it("renders the banner, summary, servers, groups and command reference", () => {
    render(<HelpView data={helpFixture} />);

    // the view renders under its own MvRoot theme scope (family restyle) —
    // without the .mvroot ancestor every var(--…) token would resolve to nothing
    const panel = screen.getByTestId("help-panel");
    expect(panel.closest(".mvroot")).not.toBeNull();

    // banner: gradient wordmark + slogan + version. The wordmark keeps the
    // sanctioned brand gradient (the one literal-hex flourish of the restyle).
    const wordmark = screen.getByTestId("help-wordmark");
    expect(wordmark.textContent).toContain(">_MARVIN");
    expect(wordmark.style.backgroundImage).toContain("linear-gradient");
    expect(panel.textContent).toContain("toolset for AI development without panic");
    expect(screen.getByTestId("help-version").textContent).toContain("v0.1.0");

    // summary: project, git branch + base, board statuses, artifacts (specs bold)
    expect(screen.getByTestId("help-project").textContent).toContain("telegram-publications");
    const git = screen.getByTestId("help-git");
    expect(git.textContent).toContain("task/telegram-publications-ingestion");
    expect(git.textContent).toContain("main");
    const board = screen.getByTestId("help-board");
    for (const s of ["todo", "wip", "review", "done", "blocked"]) {
      expect(board.textContent).toContain(s);
    }
    expect(screen.getByTestId("help-artifacts").textContent).toContain("specs");
    expect(screen.getByTestId("help-artifacts").textContent).toContain("40");

    // MCP servers: every configured server present, lit/dim by enabled state —
    // an enabled pill carries the status dot, a disabled (neutral) one does not
    const servers = within(screen.getByTestId("help-servers")).getAllByTestId("help-server");
    expect(servers).toHaveLength(12);
    const marvin = servers.find((s) => s.getAttribute("data-server") === "marvin");
    expect(marvin?.getAttribute("data-enabled")).toBe("true");
    expect(marvin?.querySelector('[aria-hidden="true"]')).not.toBeNull();
    const playwright = servers.find((s) => s.getAttribute("data-server") === "playwright");
    expect(playwright?.getAttribute("data-enabled")).toBe("false");
    expect(playwright?.querySelector('[aria-hidden="true"]')).toBeNull();

    // command groups TOC: each group with its blurb
    const groups = screen.getByTestId("help-groups");
    expect(groups.textContent).toContain("core");
    expect(groups.textContent).toContain("Everyday dev");

    // per-group reference: a section per group, all 51 commands, blurbs, human mark
    for (const g of ["core", "adr", "pr", "task", "sec", "refactor", "track"]) {
      expect(screen.getByTestId(`help-ref-${g}`)).toBeTruthy();
    }
    const commands = screen.getAllByTestId("help-command");
    expect(commands).toHaveLength(51);
    const commit = commands.find((c) => c.getAttribute("data-command") === "commit");
    expect(commit).toBeTruthy();
    // the human-run lifecycle commands carry the 👤 mark; ordinary ones do not
    const adrRef = screen.getByTestId("help-ref-adr");
    expect(within(adrRef).getAllByTestId("human-mark")).toHaveLength(3);
    const coreRef = screen.getByTestId("help-ref-core");
    expect(within(coreRef).queryByTestId("human-mark")).toBeNull();
  });
});

describe("HelpView — neutral / connection states", () => {
  it("renders a not-in-a-repo summary and no-server note without throwing", () => {
    const bare: HelpState = {
      ...helpFixture,
      project: "scratch",
      git: { branch: null, base_branch: "main", has_git: false, has_gh: false },
      servers: [],
    };
    render(<HelpView data={bare} />);
    expect(screen.getByTestId("help-git").textContent).toContain("not in a git repo");
    expect(screen.getByTestId("help-servers").textContent).toContain("none configured");
  });

  it("renders each empty-state fixture's degraded branch", () => {
    // the same branches the NoServers / NoStatuses / NotGitRepo stories show
    const noServers = render(<HelpView data={noServersHelpFixture} />);
    expect(screen.getByTestId("help-servers").textContent).toContain("none configured");
    noServers.unmount();

    const noStatuses = render(<HelpView data={noStatusesHelpFixture} />);
    expect(screen.getByTestId("help-board").textContent).toContain("no statuses configured");
    noStatuses.unmount();

    render(<HelpView data={noGitHelpFixture} />);
    expect(screen.getByTestId("help-git").textContent).toContain("not in a git repo");
  });

  it("renders connecting / no-data / error states", () => {
    const { rerender } = render(<HelpView data={null} />);
    expect(screen.getByTestId("help-connecting").textContent).toContain("Connecting");
    rerender(<HelpView data={null} connecting={false} />);
    expect(screen.getByTestId("help-connecting").textContent).toContain("No help data");
    rerender(<HelpView data={null} error="boom" />);
    expect(screen.getByTestId("help-error").textContent).toContain("boom");
    expect(screen.queryByTestId("help-panel")).toBeNull();
  });
});

describe("HelpWidget — mock-host handshake", () => {
  it("mock-host handshake delivers a HelpState the widget renders", async () => {
    const host = createMockHost(helpFixture);
    await host.start();
    try {
      render(<HelpWidget seam={host.seam} />);

      const wordmark = await screen.findByTestId("help-wordmark", {}, { timeout: 5000 });
      expect(wordmark.textContent).toContain(">_MARVIN");
      expect(screen.queryByTestId("help-connecting")).toBeNull();
      // a section from the delivered payload reached the view
      expect(screen.getByTestId("help-project").textContent).toContain("telegram-publications");
    } finally {
      host.close();
    }
  });
});

describe("HelpView — group Read more drill-down", () => {
  it("overview keeps the full reference and adds a Read more link per group", () => {
    render(<HelpView data={helpFixture} />);

    // overview is unchanged: the whole 57-command reference and every group
    // section are still rendered inline (no regression from the new link)
    expect(screen.getByTestId("help-panel")).toBeTruthy();
    expect(screen.getAllByTestId("help-command")).toHaveLength(51);
    for (const g of ["core", "adr", "pr", "task", "sec", "refactor", "track"]) {
      expect(screen.getByTestId(`help-ref-${g}`)).toBeTruthy();
    }

    // one "Read more" link per group, each carrying its group key
    const more = screen.getAllByTestId("help-more");
    expect(more).toHaveLength(7);
    expect(more.map((m) => m.getAttribute("data-group")).sort()).toEqual(
      ["adr", "core", "pr", "refactor", "sec", "task", "track"].sort(),
    );

    // no detail view is open initially
    expect(screen.queryByTestId("help-detail")).toBeNull();
  });

  it("Read more opens the group detail view and back returns", () => {
    render(<HelpView data={helpFixture} />);

    // activate the core group's "Read more"
    const coreMore = screen
      .getAllByTestId("help-more")
      .find((m) => m.getAttribute("data-group") === "core")!;
    fireEvent.click(coreMore);

    // the overview is swapped for the core detail view
    expect(screen.queryByTestId("help-panel")).toBeNull();
    const detail = screen.getByTestId("help-detail");
    expect(screen.getByTestId("help-detail-title").textContent).toBe(groupTitle("core"));

    // every core command renders as /marvin:<name> with its richer description...
    const rows = within(detail).getAllByTestId("help-detail-command");
    expect(rows).toHaveLength(14);
    const commit = rows.find((r) => r.getAttribute("data-command") === "commit")!;
    expect(commit.textContent).toContain("/marvin:commit");
    // the detail row renders the command's real (fixture-mirrored) description
    const commitDesc = helpFixture.commands.find((c) => c.name === "commit")!.description;
    expect(commit.textContent).toContain(commitDesc);

    // ...each showing two ways to call: a Direct chip (always) and ≥3 prose phrases.
    // core has 14 commands → 14 Direct chips.
    expect(within(detail).getAllByTestId("help-detail-direct")).toHaveLength(14);
    // a command with an args example shows it as the direct call; one without falls
    // back to the bare /marvin:<name> (the fixture gives core `commit` an example,
    // `dashboard` none)
    expect(within(commit).getByTestId("help-detail-direct").textContent).toContain(
      "/marvin:commit fix: guard null session",
    );
    const dashboard = rows.find((r) => r.getAttribute("data-command") === "dashboard")!;
    expect(within(dashboard).getByTestId("help-detail-direct").textContent).toBe(
      "/marvin:dashboard",
    );
    // every command lists at least three prose phrases, quoted
    for (const r of rows) {
      expect(within(r).getAllByTestId("help-detail-phrase").length).toBeGreaterThanOrEqual(3);
    }
    expect(within(commit).getAllByTestId("help-detail-phrase")[0].textContent).toContain("marvin");

    // back control restores the unchanged overview
    fireEvent.click(screen.getByTestId("help-back"));
    expect(screen.queryByTestId("help-detail")).toBeNull();
    expect(screen.getByTestId("help-panel")).toBeTruthy();
    expect(screen.getAllByTestId("help-command")).toHaveLength(51);
  });

  it("the detail view shows the human-run legend for a group with human commands", () => {
    render(<HelpView data={helpFixture} />);
    const adrMore = screen
      .getAllByTestId("help-more")
      .find((m) => m.getAttribute("data-group") === "adr")!;
    fireEvent.click(adrMore);

    const detail = screen.getByTestId("help-detail");
    // adr has 3 human-run commands → 3 marks on the rows + 1 in the legend
    expect(within(detail).getAllByTestId("human-mark").length).toBeGreaterThanOrEqual(4);
    expect(detail.textContent).toContain("human-run only");
  });
});
