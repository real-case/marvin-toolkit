import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/preact";
import { useEffect, useState, type ReactNode } from "react";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { useHostTheme } from "./host-theme";
import { createMockHost, type WidgetSeam } from "./mock-host";

import { AuditWidget } from "../widgets/audit/AuditWidget";
import { DashboardWidget } from "../widgets/dashboard/DashboardWidget";
import { HandoffsWidget } from "../widgets/handoffs/HandoffsWidget";
import { HelpWidget } from "../widgets/help/HelpWidget";
import { ReportsWidget } from "../widgets/reports/ReportsWidget";
import { TaskDetailWidget } from "../widgets/task-detail/TaskDetailWidget";
import { TaskListWidget } from "../widgets/task-list/TaskListWidget";
import { TaskSummaryWidget } from "../widgets/task-summary/TaskSummaryWidget";
import { TrackerListWidget } from "../widgets/tracker-list/TrackerListWidget";

import { auditListFixture } from "../widgets/audit/fixture";
import { dashboardFixture } from "../widgets/dashboard/fixture";
import { handoffsFixture } from "../widgets/handoffs/fixture";
import { helpFixture } from "../widgets/help/fixture";
import { reportsFixture } from "../widgets/reports/fixture";
import { taskDetailFixture } from "../widgets/task-detail/fixture";
import { taskListFixture } from "../widgets/task-list/fixture";
import { taskSummaryFixture } from "../widgets/task-summary/fixture";
import { trackerListFixture } from "../widgets/tracker-list/fixture";

/**
 * Tests for the host-theme capability (spec `widget-host-theme`).
 *
 * Three groups, deliberately in one file:
 *   1. the resolver itself, driven through a real `App` and the mock host;
 *   2. a behavioural table over ALL NINE widgets, so the capability is proven
 *      where it ships rather than on one representative;
 *   3. a structural scan asserting both wirings of every widget resolve AND
 *      forward the theme — the only reachable proof for the live path, which
 *      `useApp()` makes undriveable under happy-dom.
 */

afterEach(() => cleanup());

const payload = (fixture: unknown) => fixture as unknown as Record<string, unknown>;

// ── 1. the resolver ──────────────────────────────────────────────────────────

/**
 * A minimal consumer of the hook. It mirrors a widget's seam wiring — connect in
 * an effect, track `connected` — and renders both the resolved theme and the
 * connection state, so a test can await a POSITIVE signal that the handshake
 * finished before asserting that no theme arrived.
 */
function ThemeProbe({ seam }: { seam: WidgetSeam }) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    seam.app.connect(seam.transport).then(
      () => {
        if (!cancelled) setConnected(true);
      },
      () => {
        /* the probe asserts on theme, not on connection failures */
      },
    );
    return () => {
      cancelled = true;
    };
  }, [seam]);

  const theme = useHostTheme(seam.app, connected);

  return (
    <div data-testid="probe" data-connected={connected ? "yes" : "no"}>
      {theme ?? "none"}
    </div>
  );
}

describe("useHostTheme — the resolver", () => {
  it("adopts the theme present in the host context at connect", async () => {
    const host = createMockHost({}, "marvin-theme-probe", { theme: "dark" });
    await host.start();
    try {
      render(<ThemeProbe seam={host.seam} />);
      await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("dark"));
    } finally {
      host.close();
    }
  });

  it("follows a host-context change pushed after connect", async () => {
    const host = createMockHost({}, "marvin-theme-probe", { theme: "dark" });
    await host.start();
    try {
      render(<ThemeProbe seam={host.seam} />);
      await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("dark"));

      host.setHostContext({ theme: "light" });
      await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("light"));
    } finally {
      host.close();
    }
  });

  it("returns undefined when the host advertises no theme", async () => {
    // No hostContext — the bridge answers `ui/initialize` with its empty default,
    // exactly as the website's embed host does.
    const host = createMockHost({}, "marvin-theme-probe");
    await host.start();
    try {
      render(<ThemeProbe seam={host.seam} />);

      await waitFor(() =>
        expect(screen.getByTestId("probe").getAttribute("data-connected")).toBe("yes"),
      );

      // Then SETTLE before asserting. Every cheaper form of this wait was
      // measured against a resolver mutated to default to "light", and each one
      // stayed green: awaiting `connected`, awaiting the payload to render, and
      // a bare `await act(async () => {})` all observe the DOM before the
      // resolver's effect has written its state, so "not resolved yet" reads
      // exactly like "resolved to nothing". A real timer inside `act` is what
      // flushes the effect — under the mutation this assertion then reports
      // "light", which is the whole point of the criterion.
      //
      // Removing an advertised theme is not an alternative route to this: the
      // SDK MERGES host-context notification params into its internal context,
      // so a later `{}` cannot un-advertise a theme. Initial absence is the only
      // observable form of "the host advertises none".
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(screen.getByTestId("probe").textContent).toBe("none");
    } finally {
      host.close();
    }
  });
});

// ── 2. the nine widgets ──────────────────────────────────────────────────────

interface WidgetRow {
  /** Widget directory name — also what the structural scan derives its names from. */
  dir: string;
  mount: (seam: WidgetSeam) => ReactNode;
  payload: Record<string, unknown>;
}

const WIDGETS: WidgetRow[] = [
  {
    dir: "audit",
    mount: (seam) => <AuditWidget seam={seam} />,
    payload: payload(auditListFixture),
  },
  {
    dir: "dashboard",
    mount: (seam) => <DashboardWidget seam={seam} />,
    payload: payload(dashboardFixture),
  },
  {
    dir: "handoffs",
    mount: (seam) => <HandoffsWidget seam={seam} />,
    payload: payload(handoffsFixture),
  },
  { dir: "help", mount: (seam) => <HelpWidget seam={seam} />, payload: payload(helpFixture) },
  {
    dir: "reports",
    mount: (seam) => <ReportsWidget seam={seam} />,
    payload: payload(reportsFixture),
  },
  {
    dir: "task-detail",
    mount: (seam) => <TaskDetailWidget seam={seam} />,
    payload: payload(taskDetailFixture),
  },
  {
    dir: "task-list",
    mount: (seam) => <TaskListWidget seam={seam} />,
    payload: payload(taskListFixture),
  },
  {
    dir: "task-summary",
    mount: (seam) => <TaskSummaryWidget seam={seam} />,
    payload: payload(taskSummaryFixture),
  },
  {
    dir: "tracker-list",
    mount: (seam) => <TrackerListWidget seam={seam} />,
    payload: payload(trackerListFixture),
  },
];

describe("the widget family adopts the host theme", () => {
  it("every widget adopts the host's initial dark theme", async () => {
    // Non-vacuity guard only. Whether the table covers every widget is settled
    // by the directory reconciliation in the wiring-coverage scan, so a tenth
    // widget fails in one place with one message rather than in three.
    expect(WIDGETS.length).toBeGreaterThanOrEqual(9);

    for (const widget of WIDGETS) {
      const host = createMockHost(widget.payload, `marvin-${widget.dir}-mock`, { theme: "dark" });
      await host.start();
      try {
        render(widget.mount(host.seam));
        await waitFor(
          () =>
            expect(
              screen.getByTestId("mv-root").getAttribute("data-theme"),
              `${widget.dir} did not adopt the host theme`,
            ).toBe("dark"),
          { timeout: 5000 },
        );
      } finally {
        host.close();
        cleanup();
      }
    }
  });

  it("every widget follows a later host theme change", async () => {
    // Run over the whole table, not one representative. A view wrapped in
    // `memo()` with a comparator that ignores `theme` — an ordinary performance
    // refactor — still passes its initial-dark row and is invisible to the
    // structural scan, so only a per-widget update assertion catches it.
    for (const widget of WIDGETS) {
      const host = createMockHost(widget.payload, `marvin-${widget.dir}-mock`, { theme: "dark" });
      await host.start();
      try {
        render(widget.mount(host.seam));
        await waitFor(
          () => expect(screen.getByTestId("mv-root").getAttribute("data-theme")).toBe("dark"),
          { timeout: 5000 },
        );

        host.setHostContext({ theme: "light" });
        await waitFor(
          () =>
            expect(
              screen.getByTestId("mv-root").getAttribute("data-theme"),
              `${widget.dir} did not follow the host theme change`,
            ).toBe("light"),
          { timeout: 5000 },
        );
      } finally {
        host.close();
        cleanup();
      }
    }
  });

  it("no widget invents a theme when the host advertises none", async () => {
    // AC3's consequence one level up, across the whole family. Pinning this to a
    // single representative left the other eight free to reintroduce a concrete
    // default — inside a view's prop default or its own `?? "light"` — which the
    // wiring scan cannot see, the dark-theme rows cannot see, and the site's e2e
    // cannot see either, since Preact skips the unchanged write on a light page.
    for (const widget of WIDGETS) {
      const host = createMockHost(widget.payload, `marvin-${widget.dir}-mock`);
      await host.start();
      try {
        render(widget.mount(host.seam));

        // Settle rather than assert immediately: the theme would land a render
        // after the handshake, so an unsettled DOM cannot distinguish "resolved
        // to nothing" from "not resolved yet".
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        });

        expect(
          screen.getByTestId("mv-root").getAttribute("data-theme"),
          `${widget.dir} invented a theme the host never advertised`,
        ).toBeNull();
      } finally {
        host.close();
        cleanup();
      }
    }
  });
});

// ── 3. the structural scan ───────────────────────────────────────────────────

const WIDGETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "widgets");

/** `task-detail` → `TaskDetail`. The wirings are named from the directory, not from the view. */
function pascal(dir: string): string {
  return dir
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

/**
 * Slice one function's BODY out of a source file.
 *
 * The braces are matched from the `{` that follows the parameter list's closing
 * `)` — never from the first `{` after the declaration, which on every seam
 * wiring is the destructured `{ seam }` parameter and yields an eight-character
 * "body" that reports a false negative on all nine widgets.
 */
function functionBody(source: string, name: string): string {
  const declaration = source.indexOf(`function ${name}(`);
  if (declaration === -1) throw new Error(`${name} not found`);

  const parenStart = source.indexOf("(", declaration);
  let depth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) {
      parenEnd = i;
      break;
    }
  }
  if (parenEnd === -1) throw new Error(`${name}: unbalanced parameter list`);

  const bodyStart = source.indexOf("{", parenEnd);
  if (bodyStart === -1) throw new Error(`${name}: no body`);

  depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(bodyStart, i + 1);
  }
  throw new Error(`${name}: unbalanced body`);
}

describe("wiring coverage", () => {
  it("every widget wiring resolves and forwards the theme on both paths", () => {
    // Reconcile the table against the directory rather than pinning its length.
    // A tenth widget then fails HERE, loudly, instead of shipping unproven —
    // which is AC1's own trap ("the other eight would ship the defect")
    // displaced in time.
    //
    // A directory counts as a widget only if it holds the wiring module the
    // scan would read. Treating every subdirectory as a widget would turn a
    // future `src/widgets/shared/` into a table mismatch and an ENOENT on
    // otherwise correct code.
    const dirs = readdirSync(WIDGETS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((dir) => existsSync(join(WIDGETS_DIR, dir, `${pascal(dir)}Widget.tsx`)))
      .sort();
    // Non-vacuity only. The reconciliation below is what a tenth widget must
    // fail on, and it should fail there once, with a message that says why.
    expect(
      dirs.length,
      "no widget directories found — the scan would pass vacuously",
    ).toBeGreaterThanOrEqual(9);
    expect(
      WIDGETS.map((widget) => widget.dir).sort(),
      "the behavioural table does not cover every widget directory",
    ).toEqual(dirs);

    for (const dir of dirs) {
      const base = pascal(dir);
      const source = readFileSync(join(WIDGETS_DIR, dir, `${base}Widget.tsx`), "utf8");

      // The EXACT statement, not a substring. A substring match on
      // `useHostTheme(` accepts `useHostTheme(app, false)` and
      // `useHostTheme(null, isConnected)`, either of which would leave all nine
      // shipped documents ignoring the host theme with the whole suite green;
      // matching through the semicolon additionally rejects a `?? "light"`
      // default appended at the wiring site, which no behavioural test here can
      // see because the table advertises dark and Preact skips the unchanged
      // write on the website's light page.
      const expected: Record<string, string> = {
        [`${base}LiveWidget`]: "const theme = useHostTheme(app, isConnected);",
        [`${base}SeamWidget`]: "const theme = useHostTheme(seam.app, connected);",
      };

      for (const [wiring, statement] of Object.entries(expected)) {
        const body = functionBody(source, wiring);

        // A body this short means the slice caught the parameter list, not the
        // body — fail loudly rather than reporting a missing call.
        expect(body.length, `${wiring}: suspiciously short body — check the slice`).toBeGreaterThan(
          100,
        );
        expect(body, `${wiring} does not resolve the host theme as specified`).toContain(statement);
        expect(body, `${wiring} resolves the theme but never forwards it`).toContain(
          "theme={theme}",
        );
      }
    }
  });
});
