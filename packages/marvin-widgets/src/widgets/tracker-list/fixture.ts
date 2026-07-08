import type { TrackerListPayload } from "@marvin-toolkit/mcp-shared/contracts";

/**
 * A representative TrackerListPayload (ADR-0024 #6) shared by the tests and the
 * story. It carries two tracked tasks so both link states render:
 *  - OSI-101 has a `tracker_url` → the external link-out button (AC2, app.openLink);
 *  - OSI-140 has a `tracker_url` of `null` (the `tracker_url_template` is
 *    unconfigured) → the id-as-text + configure hint, no dead link (AC6).
 * Only tracker-bearing tasks appear — the `tracker` tool filters the board before
 * building this payload. Timestamps are fixed literals (no `Date.now()`) to keep the
 * story and snapshots deterministic.
 */
export const trackerListFixture: TrackerListPayload = {
  tasks: [
    {
      id: "001",
      type: "bug",
      status: { key: "wip", role: "wip" },
      title: "Fix login timeout on slow networks",
      branch: "fix/001-OSI-101--login-timeout",
      tracker_id: "OSI-101",
      tracker_url: "https://tracker.example/browse/OSI-101",
      pr: { url: "https://github.com/acme/app/pull/12", number: 12 },
      created: "2026-07-01T10:00:00.000Z",
      updated: "2026-07-03T14:15:00.000Z",
    },
    {
      id: "002",
      type: "feature",
      status: { key: "todo", role: "todo" },
      title: "Add SSO onboarding flow",
      branch: "feat/002-OSI-140--sso-onboarding",
      tracker_id: "OSI-140",
      // No derived URL — the project's tracker_url_template is unset (AC6 branch).
      tracker_url: null,
      pr: null,
      created: "2026-07-02T09:00:00.000Z",
      updated: "2026-07-02T09:00:00.000Z",
    },
  ],
};

/** An empty payload — no task carries a tracker id (AC4 empty state). */
export const emptyTrackerListFixture: TrackerListPayload = { tasks: [] };
