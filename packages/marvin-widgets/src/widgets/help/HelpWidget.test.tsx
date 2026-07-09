import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/preact";
import type { HelpState } from "@marvin-toolkit/mcp-shared/contracts";
import { HelpView, HelpWidget } from "./HelpWidget";
import { helpFixture } from "./fixture";
import { createMockHost } from "../../lib/mock-host";

describe("HelpView — panel over the full fixture", () => {
  it("renders the banner, summary, servers, groups and command reference", () => {
    render(<HelpView data={helpFixture} />);

    // banner: gradient wordmark + slogan + version
    expect(screen.getByTestId("help-wordmark").textContent).toContain(">_MARVIN");
    const panel = screen.getByTestId("help-panel");
    expect(panel.textContent).toContain("toolset for AI development without panic");
    expect(screen.getByTestId("help-version").textContent).toContain("v0.1.0");

    // summary: project, git branch + base, kanban statuses, artifacts (specs bold)
    expect(screen.getByTestId("help-project").textContent).toContain("telegram-publications");
    const git = screen.getByTestId("help-git");
    expect(git.textContent).toContain("task/telegram-publications-ingestion");
    expect(git.textContent).toContain("main");
    const kanban = screen.getByTestId("help-kanban");
    for (const s of ["todo", "wip", "review", "done", "blocked"]) {
      expect(kanban.textContent).toContain(s);
    }
    expect(screen.getByTestId("help-artifacts").textContent).toContain("specs");
    expect(screen.getByTestId("help-artifacts").textContent).toContain("40");

    // MCP servers: every configured server present, lit/dim by enabled state
    const servers = within(screen.getByTestId("help-servers")).getAllByTestId("help-server");
    expect(servers).toHaveLength(12);
    const marvin = servers.find((s) => s.getAttribute("data-server") === "marvin");
    expect(marvin?.getAttribute("data-enabled")).toBe("true");
    const playwright = servers.find((s) => s.getAttribute("data-server") === "playwright");
    expect(playwright?.getAttribute("data-enabled")).toBe("false");

    // command groups TOC: each group with its blurb
    const groups = screen.getByTestId("help-groups");
    expect(groups.textContent).toContain("core");
    expect(groups.textContent).toContain("Everyday dev");

    // per-group reference: a section per group, all 57 commands, blurbs, human mark
    for (const g of ["core", "adr", "pr", "task", "sec", "refactor", "kanban"]) {
      expect(screen.getByTestId(`help-ref-${g}`)).toBeTruthy();
    }
    const commands = screen.getAllByTestId("help-command");
    expect(commands).toHaveLength(57);
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
