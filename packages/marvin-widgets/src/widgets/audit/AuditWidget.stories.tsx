import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { AuditListView, AuditWidget, type AuditSeam } from "./AuditWidget";
import { auditListFixture } from "./fixture";
import { createMockHost } from "../../lib/mock-host";

/**
 * Stories for the audit widget (ADR-0024 #7): a static component story over the
 * fixture (visual/dev), and a mock-host story whose `play` drives the real ext-apps
 * handshake over an in-memory transport and asserts the findings (and a finding's
 * markdown evidence) render — the `@storybook/test-runner` (test-storybook) oracle.
 */
const meta: Meta<typeof AuditListView> = {
  title: "Widgets/Audit",
  component: AuditListView,
};
export default meta;

/** Static story — the pure view rendering the fixture directly. */
export const Fixture: StoryObj<typeof AuditListView> = {
  args: { data: auditListFixture },
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

async function waitForFindings(root: HTMLElement) {
  for (let i = 0; i < 50; i += 1) {
    if (root.querySelector('[data-testid="audit-counts"]')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("mock-host story: expected the audit findings to render");
}

/** Mock-host story — the handshake delivers a tool-result and the widget renders it. */
export const MockHost: StoryObj = {
  render: () => <MockHostHarness />,
  play: async ({ canvasElement }) => {
    await waitForFindings(canvasElement);
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
