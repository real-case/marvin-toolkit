import { useEffect, useState } from "react";
import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { AuditListView, AuditWidget, type AuditSeam } from "./AuditWidget";
import {
  auditListFixture,
  cleanAuditFixture,
  emptyAuditFixture,
  longEvidenceFixture,
  minimalFindingFixture,
} from "./fixture";
import { createMockHost } from "../../lib/mock-host";
import { waitForCondition } from "../../lib/story-helpers";

/**
 * Stories for the audit widget (ADR-0024 #7). Static stories drive the pure
 * {@link AuditListView} straight through args — the full fixture (light + dark
 * theme), both empty shapes (never-scanned vs all-clear), a bare-minimum finding,
 * a markdown-heavy finding, and the connecting/no-data/error trio — so every
 * render state is a deterministic screenshot. Two `play` stories add behaviour:
 * severity filtering over the fixture, and a mock-host story whose `play` drives
 * the real ext-apps handshake over an in-memory transport and asserts the
 * findings (and a finding's markdown evidence) render — the
 * `@storybook/test-runner` (test-storybook) oracle.
 */

/**
 * The view renders its own `MvRoot`, so theme pinning goes through the view's
 * `theme` prop rather than a wrapping decorator (a nested unpinned `.mvroot`
 * would re-declare the light tokens and defeat the pin). The forced theme
 * follows the story's `hostTheme` parameter (or the toolbar global), matching
 * the primitives' stories convention — `FixtureDark` stays a pinned screenshot
 * while the toolbar keeps flipping every other story for humans.
 */
const withMvTheme: Decorator = (Story, context) => {
  const t: unknown = context.parameters.hostTheme ?? context.globals.hostTheme;
  return Story({
    args: { ...context.args, theme: t === "dark" ? "dark" : t === "light" ? "light" : undefined },
  });
};

const meta: Meta<typeof AuditListView> = {
  title: "Widgets/Audit",
  component: AuditListView,
  decorators: [withMvTheme],
};
export default meta;

type Story = StoryObj<typeof AuditListView>;

/** Static story — the pure view rendering the fixture directly. */
export const Fixture: Story = {
  args: { data: auditListFixture },
};

/** The fixture under the dark theme (forces `data-theme="dark"` on the MvRoot). */
export const FixtureDark: Story = {
  args: { data: auditListFixture },
  parameters: { hostTheme: "dark" },
};

/** Degraded empty — no reports at all: the "run a /marvin:sec-* scan" prompt. */
export const NoReports: Story = {
  args: { data: emptyAuditFixture },
};

/** Positive empty — two reports, zero findings: the "all clear" state. */
export const CleanScan: Story = {
  args: { data: cleanAuditFixture },
};

/** A required-fields-only finding — the detail shows just Category/Scanner/Scanned. */
export const MinimalFinding: Story = {
  args: { data: minimalFindingFixture },
};

/** Markdown-heavy evidence + remediation — code fences, lists and a table in the detail. */
export const LongEvidence: Story = {
  args: { data: longEvidenceFixture },
};

/** Click the "critical" chip — only critical rows remain and the chip reads pressed. */
export const FilteredCritical: Story = {
  args: { data: auditListFixture },
  play: async ({ canvasElement }) => {
    const chip = Array.from(
      canvasElement.querySelectorAll<HTMLButtonElement>('[data-testid="severity-filter"] button'),
    ).find((b) => (b.textContent ?? "").trim().startsWith("critical"));
    if (!chip) throw new Error("FilteredCritical: the critical filter chip did not render");
    chip.click();
    await waitForCondition(() => {
      const options = Array.from(canvasElement.querySelectorAll('[role="option"]'));
      return (
        options.length > 0 &&
        options.every((o) => (o.textContent ?? "").trim().startsWith("critical"))
      );
    }, "every rendered finding row to lead with a critical severity pill");
    const pressed = Array.from(
      canvasElement.querySelectorAll<HTMLButtonElement>('[data-testid="severity-filter"] button'),
    ).find((b) => (b.textContent ?? "").trim().startsWith("critical"));
    if (pressed?.getAttribute("aria-pressed") !== "true") {
      throw new Error("FilteredCritical: the critical chip is not aria-pressed after the click");
    }
  },
};

/** The pre-handshake state — no data yet, the widget shows "Connecting…". */
export const Connecting: Story = {
  args: { data: null, connecting: true },
};

/** Connected but the tool never delivered a payload — the "No data." copy. */
export const NoData: Story = {
  args: { data: null, connecting: false },
};

/** A transport/handshake failure — the error fallback. (Named to dodge the global Error.) */
export const ErrorState: Story = {
  args: { data: null, error: "kaboom: transport dropped" },
};

/** Wire the widget to a fresh mock-host and connect once the host is armed. */
function MockHostHarness() {
  const [seam, setSeam] = useState<AuditSeam | null>(null);
  useEffect(() => {
    const host = createMockHost(auditListFixture);
    let live = true;
    host.start().then(() => {
      if (live) setSeam(host.seam);
    });
    return () => {
      live = false;
      host.close();
    };
  }, []);
  return seam ? <AuditWidget seam={seam} /> : <div>Starting mock host…</div>;
}

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  parameters: { visual: false },
  play: async ({ canvasElement }) => {
    await waitForCondition(
      () => canvasElement.querySelector('[data-testid="audit-counts"]') !== null,
      "the audit findings to render after the mock-host handshake",
    );
    if (!canvasElement.querySelector('[data-testid="detail-title"]')) {
      throw new Error("mock-host story: expected a finding detail to render");
    }
    if (
      !canvasElement.querySelector(
        '[data-testid="finding-evidence"] [data-testid="markdown"] pre code',
      )
    ) {
      throw new Error("mock-host story: expected the finding evidence to render as markdown");
    }
  },
};
